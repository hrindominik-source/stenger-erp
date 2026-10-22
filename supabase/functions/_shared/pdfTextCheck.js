// Spolocna (cista, bez zavislosti) logika kontroly textu finalneho PDF voci
// variables_snapshot. Pouziva ju prehliadac (rychla spatna vazba,
// src/lib/hr/finalPdf.js) AJ Edge Function hr-finalize-pdf (jediny
// doveryhodny vysledok) - aby oba vysledky vznikali rovnakym pravidlom.
//
// Pravidlo: kazda hodnota zo snapshotu, ktora sa vyskytuje v texte
// vygenerovaneho .docx, musi byt aj v texte PDF. Do vysledku idu len NAZVY
// poli, nikdy hodnoty (osobne udaje).

export const TEXT_CHECK_METHOD = "pdftext-docx-snapshot-v2";
export const MIN_TEXT_CHARS = 80;

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };
export function decodeXml(s) {
  return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return XML_ENTITIES[e.toLowerCase()] ?? m;
  });
}

// Text z XML casti .docx (word/document.xml, header*, footer*).
export function docxXmlToText(xml) {
  return decodeXml(
    xml
      .replace(/<w:noBreakHyphen\/>/g, "-")
      .replace(/<w:softHyphen\/>/g, "")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<w:(tab|br|cr)\/>/g, " ")
      .replace(/<[^>]+>/g, ""),
  );
}

// Datum d.m.rrrr v akomkolvek zapise (01.11.2026, 1. 11. 2026, 1.11.2026)
// -> 1.11.2026. Vola sa az po odstraneni medzier.
function canonicalDates(s) {
  return s.replace(/(^|\D)0?(\d{1,2})\.0?(\d{1,2})\.(\d{4})(?!\d)/g, "$1$2.$3.$4");
}

// Cisla: oddelovace tisicov (32 500 / 32.500 / 32'500 -> 32500) a nulove
// desatinne miesta (32500,00 / 32500,- / 32500.00 -> 32500). Datumy su uz
// kanonicke (d.m.rrrr) - za bodkou v nich nie su presne 3 cislice a necislica
// (den/mesiac max. 2 cislice, rok 4), takze ich pravidlo nezasiahne.
function canonicalNumbers(s) {
  let out = s, prev;
  do { prev = out; out = out.replace(/(\d)['.](\d{3})(?=\D|$)/g, "$1$2"); } while (out !== prev);
  return out.replace(/(\d)[,.]00(?=\D|$)/g, "$1").replace(/(\d),-(?=\D|$)/g, "$1");
}

export function normalizeForMatch(input) {
  let s = String(input).normalize("NFKC"); // ligatury (fi, fl), siroke znaky
  s = s
    .replace(/­/g, "") // makke delenie
    .replace(/([\p{L}])[-‐‑]\s*\n\s*([\p{Ll}])/gu, "$1$2") // delenie slova na konci riadku
    .toLowerCase()
    .replace(/[‐-―−]/g, "-") // pomlcky
    .replace(/[„“”«»″"]/g, "\"") // uvodzovky
    .replace(/[‘’‚′`']/g, "'")
    .replace(/…/g, "...")
    .replace(/[\s   ​﻿]+/gu, ""); // vsetky medzery vratane NBSP
  return canonicalNumbers(canonicalDates(s));
}

function flattenSnapshot(obj, prefix = "", out = []) {
  if (obj == null || typeof obj === "boolean") return out;
  if (typeof obj === "string" || typeof obj === "number") {
    out.push({ key: prefix, value: String(obj) });
  } else if (Array.isArray(obj)) {
    obj.forEach((v, i) => flattenSnapshot(v, `${prefix}[${i}]`, out));
  } else if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) flattenSnapshot(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

export function checkPdfAgainstSnapshot({ pdfText, pages = null, docxText, snapshot }) {
  const pdfNorm = normalizeForMatch(pdfText || "");
  const base = { method: TEXT_CHECK_METHOD, text_chars: pdfNorm.length, pages };
  if (pdfNorm.length < MIN_TEXT_CHARS) {
    return { ...base, ok: false, reason: "NO_TEXT_LAYER", checked_keys: [], missing_keys: [] };
  }
  const docxNorm = docxText != null ? normalizeForMatch(docxText) : null;
  const byValue = new Map(); // normalizovana hodnota -> nazvy poli
  for (const { key, value } of flattenSnapshot(snapshot || {})) {
    const v = normalizeForMatch(value);
    if (v.length < 2) continue;
    if (docxNorm != null && !docxNorm.includes(v)) continue; // sablona hodnotu nepouziva
    if (!byValue.has(v)) byValue.set(v, []);
    byValue.get(v).push(key);
  }
  if (byValue.size === 0) {
    return { ...base, ok: false, reason: "NO_VALUES_TO_CHECK", checked_keys: [], missing_keys: [] };
  }
  const checked = [], missing = [];
  for (const [v, keys] of byValue) {
    checked.push(...keys);
    if (!pdfNorm.includes(v)) missing.push(...keys);
  }
  return {
    ...base,
    ok: missing.length === 0,
    reason: missing.length ? "VALUES_MISSING" : null,
    checked_keys: checked.sort(),
    missing_keys: missing.sort(),
  };
}

export function isPdfBytes(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return String.fromCharCode(...u.subarray(0, 5)) === "%PDF-";
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Cesty v ulozisku - finalne PDF a podpisany original vzdy pod priecinkom
// dokumentu, aby server vedel overit, ze cesta patri k danemu dokumentu.
export function documentFolder(doc) {
  return doc.employee_id
    ? `zamestnanci/${doc.employee_id}/${doc.id}/`
    : `dotaznik/${doc.onboarding_session_id}/${doc.id}/`;
}
