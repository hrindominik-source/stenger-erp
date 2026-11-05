import { describe, it, expect } from "vitest";
import { findPdfParts, parseClaudeJson, prijataFakturaId, processInbox, sinceFromEnv, base64FromBytes } from "../../supabase/functions/invoice-inbox/inbox.js";

function fakeImap(messages) {
  const calls = { lockOpts: null, released: false, downloads: [] };
  return {
    calls,
    mailbox: { uidValidity: 7 },
    async getMailboxLock(path, opts) {
      calls.lockOpts = { path, ...opts };
      return { release: () => (calls.released = true) };
    },
    async search() {
      return messages.map((m) => m.uid);
    },
    async *fetch() {
      for (const m of messages) yield m;
    },
    async download(uid, part) {
      calls.downloads.push(`${uid}:${part}`);
      async function* gen() {
        yield new TextEncoder().encode(`pdf-${uid}-${part}`);
      }
      return { content: gen() };
    },
  };
}

function memStore(existing = []) {
  const rows = [];
  const files = {};
  return {
    rows,
    files,
    async existingIds(ids) {
      return new Set(ids.filter((id) => existing.includes(id) || rows.some((r) => r.id === id)));
    },
    async uploadPdf(path, bytes) {
      files[path] = new TextDecoder().decode(bytes);
    },
    async insert(row) {
      rows.push(row);
    },
  };
}

const pdfMsg = (uid, extra = {}) => ({
  uid,
  envelope: { messageId: `<m${uid}@x>`, subject: `Faktura ${uid}`, from: [{ address: "fakturace@dodavatel.test" }], date: "2026-11-04T08:00:00Z" },
  bodyStructure: {
    childNodes: [
      { part: "1", type: "text/plain" },
      { part: "2", type: "application/pdf", dispositionParameters: { filename: `FA${uid}.pdf` }, size: 1000 },
    ],
  },
  ...extra,
});

describe("findPdfParts", () => {
  it("najde PDF aj octet-stream s priponou .pdf, ignoruje ostatne", () => {
    const parts = findPdfParts({
      childNodes: [
        { part: "1", type: "text/html" },
        { part: "2", type: "application/pdf", parameters: { name: "a.pdf" } },
        { childNodes: [{ part: "3.1", type: "application/octet-stream", dispositionParameters: { filename: "B.PDF" } }, { part: "3.2", type: "image/png" }] },
        { part: "4", type: "application/octet-stream", dispositionParameters: { filename: "c.xml" } },
      ],
    });
    expect(parts.map((p) => p.part)).toEqual(["2", "3.1"]);
    expect(parts[1].filename).toBe("B.PDF");
  });
  it("mail len s jednou castou PDF", () => {
    expect(findPdfParts({ type: "application/pdf" })).toEqual([{ part: "1", filename: "faktura.pdf", size: 0 }]);
  });
});

describe("parseClaudeJson", () => {
  it("vytiahne JSON aj z markdown bloku", () => {
    expect(parseClaudeJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("bez JSON hodi chybu", () => {
    expect(() => parseClaudeJson("nic")).toThrow();
  });
});

describe("prijataFakturaId", () => {
  it("je stabilne a rozne pre rozne casti", async () => {
    const a = await prijataFakturaId("<m1@x>", "2");
    expect(a).toBe(await prijataFakturaId("<m1@x>", "2"));
    expect(a).not.toBe(await prijataFakturaId("<m1@x>", "3"));
    expect(a).toMatch(/^pf-[0-9a-f]{32}$/);
  });
});

describe("base64FromBytes", () => {
  it("koduje bajty", () => {
    expect(base64FromBytes(new TextEncoder().encode("ahoj"))).toBe("YWhvag==");
  });
});

describe("processInbox", () => {
  it("otvori schranku len na citanie, ulozi PDF a vytazenie, druhy beh nic nezopakuje", async () => {
    const imap = fakeImap([pdfMsg(11), { uid: 12, envelope: { messageId: "<bez@x>" }, bodyStructure: { type: "text/plain" } }]);
    const store = memStore();
    let aiCalls = 0;
    const extract = async () => {
      aiCalls++;
      return { dodavatel: "Dodavatel s.r.o.", cisloFaktury: "FA11", mena: "eur ", polozky: [] };
    };
    const s1 = await processInbox({ imap, store, extract, since: new Date("2026-11-01") });
    expect(imap.calls.lockOpts).toEqual({ path: "INBOX", readOnly: true });
    expect(imap.calls.released).toBe(true);
    expect(s1).toEqual({ nove: 1, chyby: 0, zostava: 0 });
    expect(store.rows).toHaveLength(1);
    const row = store.rows[0];
    expect(row.stav).toBe("KE_KONTROLE");
    expect(row.extrakce.mena).toBe("EUR");
    expect(row.od).toBe("fakturace@dodavatel.test");
    expect(row.nazovSuboru).toBe("FA11.pdf");
    expect(store.files[row.fakturaPath]).toBe("pdf-11-2");

    const s2 = await processInbox({ imap, store, extract, since: new Date("2026-11-01") });
    expect(s2.nove).toBe(0);
    expect(aiCalls).toBe(1);
  });

  it("dokument, ktory nie je faktura, aj chyba AI sa zapisu (bez opakovania)", async () => {
    const imap = fakeImap([pdfMsg(1), pdfMsg(2)]);
    const store = memStore();
    const extract = async (bytes) => {
      if (new TextDecoder().decode(bytes).includes("pdf-1")) return { jeFaktura: false };
      throw new Error("AI chyba (529)");
    };
    const s = await processInbox({ imap, store, extract, since: new Date() });
    expect(s).toEqual({ nove: 2, chyby: 1, zostava: 0 });
    expect(store.rows[0].stav).toBe("NIE_JE_FAKTURA");
    expect(store.rows[1].stav).toBe("KE_KONTROLE");
    expect(store.rows[1].chyba).toContain("529");
    expect(store.rows[1].fakturaPath).not.toBe("");
  });

  it("spracuje najviac maxNew, zvysok necha na dalsi beh", async () => {
    const imap = fakeImap([pdfMsg(1), pdfMsg(2), pdfMsg(3)]);
    const store = memStore();
    const s = await processInbox({ imap, store, extract: async () => ({}), since: new Date(), maxNew: 2 });
    expect(s).toEqual({ nove: 2, chyby: 0, zostava: 1 });
    const s2 = await processInbox({ imap, store, extract: async () => ({}), since: new Date(), maxNew: 2 });
    expect(s2).toEqual({ nove: 1, chyby: 0, zostava: 0 });
  });

  it("prilis velke PDF sa nestahuje", async () => {
    const big = pdfMsg(5);
    big.bodyStructure.childNodes[1].size = 30 * 1024 * 1024;
    const imap = fakeImap([big]);
    const store = memStore();
    await processInbox({ imap, store, extract: async () => ({}), since: new Date() });
    expect(imap.calls.downloads).toEqual([]);
    expect(store.rows[0].chyba).toContain("příliš velké");
  });
});

describe("sinceFromEnv", () => {
  it("DD.MM.RRRR alebo poslednych 7 dni", () => {
    expect(sinceFromEnv("01.11.2026").toISOString()).toBe("2026-11-01T00:00:00.000Z");
    const now = new Date("2026-11-05T10:00:00Z");
    expect(sinceFromEnv("", now).toISOString()).toBe("2026-10-29T10:00:00.000Z");
  });
});
