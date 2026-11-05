// Jadro citania schranky s fakturami (invoice@). Ciste JS bez Deno API, aby sa
// dalo testovat aj v Node (vitest) - IMAP klient (imap.js), parser mailov,
// ulozisko a AI sa podavaju zvonku.
//
// Schranka sa otvara LEN NA CITANIE (EXAMINE): nic sa nemaze, neoznacuje ako
// precitane ani nepresuva, takze doterajsia praca s mailami ostava bez zmeny.
// Kazde PDF z mailu sa spracuje raz - id zaznamu je hash z Message-ID a poradia PDF v maile.

import { INVOICE_EXTRACT_INSTRUCTIONS } from "./prompt.js";

export const PRIJATA_FAKTURA_STAV = {
  KE_KONTROLE: "Ke kontrole",
  ZPRACOVANA: "Zpracována",
  NESKLADOVA: "Není pro sklad",
  NIE_JE_FAKTURA: "Není faktura",
};

export const INBOX_EXTRA_INSTRUCTIONS =
  '\nAk dokument vobec nie je faktura ani danovy doklad od dodavatela (napr. dodaci list, objednavka, cenova ponuka, upomienka, reklama), vrat len {"jeFaktura": false}.';

export const MAX_MAIL_BYTES = 25 * 1024 * 1024;

export function isPdfAttachment(att) {
  const type = String(att.mimeType || "").toLowerCase();
  return type === "application/pdf" || type === "application/x-pdf" || /\.pdf$/i.test(att.filename || "");
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
    signal: AbortSignal.timeout(50_000),
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

// imap: MiniImap po LOGIN + EXAMINE. parseMail(bytes) -> { subject, from: { address }, date,
// attachments: [{ filename, mimeType, content }] } (postal-mime). store: { existingIds(ids) -> Set,
// uploadPdf(path, bytes), insert(row) }. extract(bytes) -> data z faktury.
// Mail bez PDF v BODYSTRUCTURE sa vobec nestahuje. Po deadline (ms) sa dalsi mail nezacne -
// funkcia ma casovy limit, zvysok sa spracuje pri dalsom behu.
export async function processInbox({ imap, parseMail, store, extract, since, maxNew = 10, deadline = Infinity, now = () => new Date(), log = () => {} }) {
  const summary = { nove: 0, chyby: 0, zostava: 0 };
  const uids = await imap.searchSince(since);
  log(`mailov od ${since.toISOString().slice(0, 10)}: ${uids.length}`);
  const prehlad = (await imap.overview(uids)).filter((m) => m.maPdf);
  if (prehlad.length === 0) return summary;
  for (const m of prehlad) {
    m.key = m.messageId || `uid:${imap.uidValidity || ""}:${m.uid}`;
    m.prveId = await prijataFakturaId(m.key, 0);
  }
  const existing = await store.existingIds(prehlad.map((m) => m.prveId));
  const nove = prehlad.filter((m) => !existing.has(m.prveId));
  log(`mailov s PDF: ${prehlad.length}, novych: ${nove.length}`);
  summary.zostava = nove.length;
  for (const m of nove) {
    if (summary.nove >= maxNew || now().getTime() >= deadline) break;
    const zaklad = { od: "", predmet: "", prijato: "", nacitanoAt: now().toISOString(), fakturaPath: "", extrakce: null, chyba: "" };
    let pdfs = [];
    try {
      if (m.size > MAX_MAIL_BYTES) throw new Error("Mail je příliš velký, PDF otevřete přímo v pošte.");
      const mail = await parseMail(await imap.message(m.uid));
      zaklad.od = (mail.from && mail.from.address) || "";
      zaklad.predmet = mail.subject || "";
      zaklad.prijato = mail.date ? new Date(mail.date).toISOString() : "";
      pdfs = (mail.attachments || []).filter(isPdfAttachment);
    } catch (e) {
      const row = { ...zaklad, id: m.prveId, nazovSuboru: "", chyba: String((e && e.message) || e), stav: "KE_KONTROLE" };
      await store.insert(row);
      summary.nove++;
      summary.chyby++;
      summary.zostava--;
      log(`chyba mailu uid ${m.uid}: ${row.chyba.slice(0, 120)}`);
      continue;
    }
    for (let i = 0; i < pdfs.length; i++) {
      const bytes = pdfs[i].content instanceof Uint8Array ? pdfs[i].content : new Uint8Array(pdfs[i].content);
      const id = i === 0 ? m.prveId : await prijataFakturaId(m.key, i);
      const row = { ...zaklad, id, nazovSuboru: pdfs[i].filename || "faktura.pdf", fakturaPath: `${id}/faktura.pdf` };
      try {
        await store.uploadPdf(row.fakturaPath, bytes);
        row.extrakce = await extract(bytes);
      } catch (e) {
        row.chyba = String((e && e.message) || e);
        summary.chyby++;
      }
      row.stav = row.extrakce && row.extrakce.jeFaktura === false ? "NIE_JE_FAKTURA" : "KE_KONTROLE";
      if (row.extrakce && row.extrakce.mena) row.extrakce.mena = String(row.extrakce.mena).toUpperCase().trim();
      await store.insert(row);
      summary.nove++;
      log(`ulozene ${row.nazovSuboru}: ${row.stav}${row.chyba ? " (" + row.chyba.slice(0, 120) + ")" : ""}`);
    }
    summary.zostava--;
  }
  return summary;
}

// "DD.MM.RRRR" -> Date, inak posledne 7 dni.
export function sinceFromEnv(value, now = new Date()) {
  const m = String(value || "").match(/^\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*$/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return new Date(now.getTime() - 7 * 24 * 3600 * 1000);
}
