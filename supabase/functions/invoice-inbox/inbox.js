// Jadro citania schranky s fakturami (invoice@). Ciste JS bez Deno API, aby sa
// dalo testovat aj v Node (vitest) - IMAP klient, ulozisko a AI sa podavaju zvonku.
//
// Schranka sa otvara LEN NA CITANIE (EXAMINE): nic sa nemaze, neoznacuje ako
// precitane ani nepresuva, takze doterajsia praca s mailami ostava bez zmeny.
// Kazde PDF z mailu sa spracuje raz - id zaznamu je hash z Message-ID a casti mailu.

import { INVOICE_EXTRACT_INSTRUCTIONS } from "./prompt.js";

export const PRIJATA_FAKTURA_STAV = {
  KE_KONTROLE: "Ke kontrole",
  ZPRACOVANA: "Zpracována",
  NESKLADOVA: "Není pro sklad",
  NIE_JE_FAKTURA: "Není faktura",
};

export const INBOX_EXTRA_INSTRUCTIONS =
  '\nAk dokument vobec nie je faktura ani danovy doklad od dodavatela (napr. dodaci list, objednavka, cenova ponuka, upomienka, reklama), vrat len {"jeFaktura": false}.';

export const MAX_PDF_BYTES = 20 * 1024 * 1024;

// Najde v bodyStructure (format imapflow) vsetky casti, ktore su PDF prilohy.
export function findPdfParts(node, out = []) {
  if (!node) return out;
  if (Array.isArray(node.childNodes) && node.childNodes.length > 0) {
    for (const child of node.childNodes) findPdfParts(child, out);
    return out;
  }
  const type = String(node.type || "").toLowerCase();
  const filename = (node.dispositionParameters && node.dispositionParameters.filename) || (node.parameters && node.parameters.name) || "";
  const isPdf = type === "application/pdf" || ((type === "application/octet-stream" || type === "application/x-pdf") && /\.pdf$/i.test(filename));
  if (isPdf) out.push({ part: node.part || "1", filename: filename || "faktura.pdf", size: node.size || 0 });
  return out;
}

export function parseClaudeJson(text) {
  const clean = String(text || "").replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("AI nevrátila platný JSON");
  return JSON.parse(clean.slice(start, end + 1));
}

export async function prijataFakturaId(messageKey, part) {
  const bytes = new TextEncoder().encode(`${messageKey}|${part}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
  return "pf-" + hex.slice(0, 32);
}

export function base64FromBytes(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}

// Zavola Claude s PDF. Vrati vytazene data alebo { jeFaktura: false }.
export async function extractInvoice(bytes, apiKey, fetchImpl = fetch) {
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-5-5",
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64FromBytes(bytes) } },
            { type: "text", text: INVOICE_EXTRACT_INSTRUCTIONS + INBOX_EXTRA_INSTRUCTIONS },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error("AI chyba (" + res.status + "). " + t.slice(0, 200));
  }
  const data = await res.json();
  return parseClaudeJson((data.content || []).map((b) => b.text || "").join("\n"));
}

async function streamToBytes(stream) {
  const chunks = [];
  let len = 0;
  for await (const c of stream) {
    const u = c instanceof Uint8Array ? c : new Uint8Array(c);
    chunks.push(u);
    len += u.length;
  }
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

// imap: pripojeny ImapFlow klient. store: { existingIds(ids) -> Set, uploadPdf(path, bytes), insert(row) }.
// extract(bytes) -> data z faktury. Spracuje najviac maxNew novych PDF (zvysok pri dalsom behu).
export async function processInbox({ imap, store, extract, since, maxNew = 4, now = () => new Date() }) {
  const summary = { nove: 0, chyby: 0, zostava: 0 };
  const lock = await imap.getMailboxLock("INBOX", { readOnly: true });
  try {
    const uids = (await imap.search({ since }, { uid: true })) || [];
    if (uids.length === 0) return summary;
    const kandidati = [];
    for await (const msg of imap.fetch(uids.join(","), { uid: true, envelope: true, bodyStructure: true }, { uid: true })) {
      const env = msg.envelope || {};
      const messageKey = env.messageId || `uid:${imap.mailbox && imap.mailbox.uidValidity}:${msg.uid}`;
      for (const p of findPdfParts(msg.bodyStructure)) {
        kandidati.push({
          id: await prijataFakturaId(messageKey, p.part),
          uid: msg.uid,
          part: p.part,
          filename: p.filename,
          size: p.size,
          od: (env.from && env.from[0] && env.from[0].address) || "",
          predmet: env.subject || "",
          prijato: env.date ? new Date(env.date).toISOString() : "",
        });
      }
    }
    if (kandidati.length === 0) return summary;
    const existing = await store.existingIds(kandidati.map((k) => k.id));
    const nove = kandidati.filter((k) => !existing.has(k.id));
    summary.zostava = Math.max(0, nove.length - maxNew);
    for (const k of nove.slice(0, maxNew)) {
      const row = { id: k.id, od: k.od, predmet: k.predmet, prijato: k.prijato, nazovSuboru: k.filename, nacitanoAt: now().toISOString(), fakturaPath: "", extrakce: null, chyba: "" };
      try {
        if (k.size > MAX_PDF_BYTES) throw new Error("PDF je příliš velké pro AI, zpracujte ručně.");
        const { content } = await imap.download(String(k.uid), k.part, { uid: true });
        const bytes = await streamToBytes(content);
        row.fakturaPath = `${k.id}/faktura.pdf`;
        await store.uploadPdf(row.fakturaPath, bytes);
        try {
          row.extrakce = await extract(bytes);
        } catch (e) {
          row.chyba = String((e && e.message) || e);
          summary.chyby++;
        }
      } catch (e) {
        row.chyba = String((e && e.message) || e);
        summary.chyby++;
      }
      row.stav = row.extrakce && row.extrakce.jeFaktura === false ? "NIE_JE_FAKTURA" : "KE_KONTROLE";
      if (row.extrakce && row.extrakce.mena) row.extrakce.mena = String(row.extrakce.mena).toUpperCase().trim();
      await store.insert(row);
      summary.nove++;
    }
  } finally {
    lock.release();
  }
  return summary;
}

// "DD.MM.RRRR" -> Date, inak posledne 7 dni.
export function sinceFromEnv(value, now = new Date()) {
  const m = String(value || "").match(/^\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*$/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return new Date(now.getTime() - 7 * 24 * 3600 * 1000);
}
