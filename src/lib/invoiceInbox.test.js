import { describe, it, expect } from "vitest";
import { isPdfAttachment, parseClaudeJson, prijataFakturaId, processInbox, sinceFromEnv, base64FromBytes } from "../../supabase/functions/invoice-inbox/inbox.js";
import { MiniImap, imapQuote, imapDate } from "../../supabase/functions/invoice-inbox/imap.js";

const te = new TextEncoder();
const td = new TextDecoder();

// maily: { uid, messageId, maPdf, size, mail: { subject, from, date, attachments } }
function fakeImap(maily) {
  const calls = { stiahnute: [] };
  return {
    calls,
    uidValidity: "7",
    async searchSince() {
      return maily.map((m) => m.uid);
    },
    async overview(uids) {
      return maily.filter((m) => uids.includes(m.uid)).map(({ uid, messageId, maPdf, size }) => ({ uid, messageId, maPdf, size: size || 1000 }));
    },
    async message(uid) {
      calls.stiahnute.push(uid);
      return uid;
    },
  };
}
const parseMailFor = (maily) => async (uid) => maily.find((m) => m.uid === uid).mail;

function memStore() {
  const rows = [];
  const files = {};
  return {
    rows,
    files,
    async existingIds(ids) {
      return new Set(ids.filter((id) => rows.some((r) => r.id === id)));
    },
    async uploadPdf(path, bytes) {
      files[path] = td.decode(bytes);
    },
    async insert(row) {
      rows.push(row);
    },
  };
}

const pdfMail = (uid, pdfCount = 1) => ({
  uid,
  messageId: `<m${uid}@x>`,
  maPdf: true,
  mail: {
    subject: `Faktura ${uid}`,
    from: { address: "fakturace@dodavatel.test" },
    date: "2026-11-04T08:00:00Z",
    attachments: [
      { filename: "logo.png", mimeType: "image/png", content: te.encode("png") },
      ...Array.from({ length: pdfCount }, (_, i) => ({ filename: `FA${uid}-${i}.pdf`, mimeType: "application/pdf", content: te.encode(`pdf-${uid}-${i}`) })),
    ],
  },
});

describe("isPdfAttachment", () => {
  it("PDF podla typu alebo pripony", () => {
    expect(isPdfAttachment({ mimeType: "application/pdf" })).toBe(true);
    expect(isPdfAttachment({ mimeType: "application/octet-stream", filename: "A.PDF" })).toBe(true);
    expect(isPdfAttachment({ mimeType: "application/octet-stream", filename: "a.xml" })).toBe(false);
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
  it("je stabilne a rozne pre rozne PDF", async () => {
    const a = await prijataFakturaId("<m1@x>", 0);
    expect(a).toBe(await prijataFakturaId("<m1@x>", 0));
    expect(a).not.toBe(await prijataFakturaId("<m1@x>", 1));
    expect(a).toMatch(/^pf-[0-9a-f]{32}$/);
  });
});

describe("base64FromBytes", () => {
  it("koduje bajty", () => {
    expect(base64FromBytes(te.encode("ahoj"))).toBe("YWhvag==");
  });
});

describe("processInbox", () => {
  it("ulozi PDF a vytazenie, mail bez PDF nestahuje, druhy beh nic nezopakuje", async () => {
    const maily = [pdfMail(11), { uid: 12, messageId: "<bez@x>", maPdf: false }];
    const imap = fakeImap(maily);
    const store = memStore();
    let aiCalls = 0;
    const extract = async () => {
      aiCalls++;
      return { dodavatel: "Dodavatel s.r.o.", cisloFaktury: "FA11", mena: "eur ", polozky: [] };
    };
    const args = { imap, parseMail: parseMailFor(maily), store, extract, since: new Date("2026-11-01") };
    expect(await processInbox(args)).toEqual({ nove: 1, chyby: 0, zostava: 0 });
    expect(imap.calls.stiahnute).toEqual([11]);
    const row = store.rows[0];
    expect(row.stav).toBe("KE_KONTROLE");
    expect(row.extrakce.mena).toBe("EUR");
    expect(row.od).toBe("fakturace@dodavatel.test");
    expect(row.nazovSuboru).toBe("FA11-0.pdf");
    expect(store.files[row.fakturaPath]).toBe("pdf-11-0");

    expect((await processInbox(args)).nove).toBe(0);
    expect(aiCalls).toBe(1);
    expect(imap.calls.stiahnute).toEqual([11]);
  });

  it("viac PDF v jednom maile = viac zaznamov s roznym id", async () => {
    const maily = [pdfMail(1, 2)];
    const store = memStore();
    await processInbox({ imap: fakeImap(maily), parseMail: parseMailFor(maily), store, extract: async () => ({}), since: new Date() });
    expect(store.rows.map((r) => r.nazovSuboru)).toEqual(["FA1-0.pdf", "FA1-1.pdf"]);
    expect(new Set(store.rows.map((r) => r.id)).size).toBe(2);
  });

  it("dokument, ktory nie je faktura, aj chyba AI sa zapisu (bez opakovania)", async () => {
    const maily = [pdfMail(1), pdfMail(2)];
    const store = memStore();
    const extract = async (bytes) => {
      if (td.decode(bytes).includes("pdf-1")) return { jeFaktura: false };
      throw new Error("AI chyba (529)");
    };
    const s = await processInbox({ imap: fakeImap(maily), parseMail: parseMailFor(maily), store, extract, since: new Date() });
    expect(s).toEqual({ nove: 2, chyby: 1, zostava: 0 });
    expect(store.rows[0].stav).toBe("NIE_JE_FAKTURA");
    expect(store.rows[1].stav).toBe("KE_KONTROLE");
    expect(store.rows[1].chyba).toContain("529");
    expect(store.rows[1].fakturaPath).not.toBe("");
  });

  it("spracuje najviac maxNew mailov, zvysok necha na dalsi beh", async () => {
    const maily = [pdfMail(1), pdfMail(2), pdfMail(3)];
    const store = memStore();
    const args = { imap: fakeImap(maily), parseMail: parseMailFor(maily), store, extract: async () => ({}), since: new Date(), maxNew: 2 };
    expect(await processInbox(args)).toEqual({ nove: 2, chyby: 0, zostava: 1 });
    expect(await processInbox(args)).toEqual({ nove: 1, chyby: 0, zostava: 0 });
  });

  it("po deadline uz dalsi mail nezacne", async () => {
    const maily = [pdfMail(1), pdfMail(2), pdfMail(3)];
    const store = memStore();
    let t = 0;
    const extract = async () => {
      t += 60_000;
      return {};
    };
    const s = await processInbox({ imap: fakeImap(maily), parseMail: parseMailFor(maily), store, extract, since: new Date(), deadline: 90_000, now: () => new Date(t) });
    expect(s).toEqual({ nove: 2, chyby: 0, zostava: 1 });
  });

  it("prilis velky mail sa nestahuje, zapise sa s chybou", async () => {
    const maily = [{ ...pdfMail(5), size: 30 * 1024 * 1024 }];
    const imap = fakeImap(maily);
    const store = memStore();
    await processInbox({ imap, parseMail: parseMailFor(maily), store, extract: async () => ({}), since: new Date() });
    expect(imap.calls.stiahnute).toEqual([]);
    expect(store.rows[0].chyba).toContain("příliš velký");
  });
});

// Skriptovany IMAP server v pamati: na kazdy prikaz vrati odpoved z mapy (po kuskoch).
function scriptedServer(odpovede) {
  let ctrl;
  const prikazy = [];
  const readable = new ReadableStream({
    start(c) {
      ctrl = c;
      c.enqueue(te.encode("* OK Dovecot ready.\r\n"));
    },
  });
  const writable = new WritableStream({
    write(chunk) {
      const line = td.decode(chunk).trim();
      const sp = line.indexOf(" ");
      const tag = line.slice(0, sp);
      const cmd = line.slice(sp + 1);
      prikazy.push(cmd);
      const key = Object.keys(odpovede).find((k) => cmd.startsWith(k));
      const out = te.encode((key ? odpovede[key] : "") + `${tag} OK hotovo\r\n`);
      for (let i = 0; i < out.length; i += 7) ctrl.enqueue(out.slice(i, i + 7));
    },
  });
  return { readable, writable, prikazy };
}

describe("MiniImap", () => {
  it("prihlasi sa, otvori len na citanie, najde maily s PDF a stiahne mail s literalom", async () => {
    const raw = "Subject: x\r\n\r\nobsah";
    const hdr = "Message-ID: <a@b.test>\r\n\r\n";
    const srv = scriptedServer({
      EXAMINE: "* OK [UIDVALIDITY 42] UIDs valid\r\n* OK [READ-ONLY]\r\n",
      "UID SEARCH": "* SEARCH 3 7\r\n",
      "UID FETCH 3,7":
        `* 1 FETCH (UID 3 RFC822.SIZE 900 BODYSTRUCTURE (("text" "plain" NIL NIL NIL "7bit" 5 1)("application" "pdf" ("name" "FA.pdf") NIL NIL "base64" 400) "mixed") BODY[HEADER.FIELDS (MESSAGE-ID)] {${hdr.length}}\r\n${hdr})\r\n` +
        '* 2 FETCH (UID 7 RFC822.SIZE 100 BODYSTRUCTURE ("text" "plain" NIL NIL NIL "7bit" 5 1) BODY[HEADER.FIELDS (MESSAGE-ID)] {2}\r\n\r\n)\r\n',
      "UID FETCH 3 (UID BODY.PEEK[])": `* 1 FETCH (UID 3 BODY[] {${raw.length}}\r\n${raw})\r\n`,
      LOGOUT: "* BYE\r\n",
    });
    const imap = new MiniImap(srv);
    await imap.greeting();
    await imap.login("invoice@firma.test", 'he"slo');
    await imap.examine("INBOX");
    expect(imap.uidValidity).toBe("42");
    expect(await imap.searchSince(new Date("2026-10-29T00:00:00Z"))).toEqual([3, 7]);
    expect(await imap.overview([3, 7])).toEqual([
      { uid: 3, size: 900, messageId: "<a@b.test>", maPdf: true },
      { uid: 7, size: 100, messageId: "", maPdf: false },
    ]);
    expect(td.decode(await imap.message(3))).toBe(raw);
    await imap.logout();
    expect(srv.prikazy[0]).toBe('LOGIN "invoice@firma.test" "he\\"slo"');
    expect(srv.prikazy[1]).toBe('EXAMINE "INBOX"');
    expect(srv.prikazy[2]).toBe("UID SEARCH SINCE 29-Oct-2026");
    expect(srv.prikazy.some((p) => /STORE|EXPUNGE|SELECT|DELETE|MOVE/.test(p))).toBe(false);
  });

  it("NO od servera sa vrati ako chyba bez hesla v texte", async () => {
    const imap = new MiniImap({
      readable: new ReadableStream({
        start(c) {
          c.enqueue(te.encode("* OK ready\r\nA1 NO [AUTHENTICATIONFAILED] Authentication failed.\r\n"));
        },
      }),
      writable: new WritableStream({ write() {} }),
    });
    await imap.greeting();
    const err = await imap.login("u", "tajne").catch((e) => e);
    expect(err.message).toMatch(/IMAP LOGIN: NO \[AUTHENTICATIONFAILED\]/);
    expect(err.message).not.toContain("tajne");
  });

  it("server neodpovie - chyba po timeoute", async () => {
    const imap = new MiniImap({ readable: new ReadableStream({}), writable: new WritableStream({}), timeoutMs: 50 });
    await expect(imap.greeting()).rejects.toThrow(/neodpovedá/);
  });

  it("pomocne funkcie", () => {
    expect(imapQuote('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(imapDate(new Date("2026-01-05T10:00:00Z"))).toBe("5-Jan-2026");
  });
});

describe("sinceFromEnv", () => {
  it("DD.MM.RRRR alebo poslednych 7 dni", () => {
    expect(sinceFromEnv("01.11.2026").toISOString()).toBe("2026-11-01T00:00:00.000Z");
    const now = new Date("2026-11-05T10:00:00Z");
    expect(sinceFromEnv("", now).toISOString()).toBe("2026-10-29T10:00:00.000Z");
  });
});
