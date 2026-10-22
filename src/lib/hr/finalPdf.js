import PizZip from "pizzip";
import {
  checkPdfAgainstSnapshot, docxXmlToText, isPdfBytes, sha256Hex, documentFolder, TEXT_CHECK_METHOD,
} from "../../../supabase/functions/_shared/pdfTextCheck.js";

export { checkPdfAgainstSnapshot, normalizeForMatch, isPdfBytes, TEXT_CHECK_METHOD, MIN_TEXT_CHARS }
  from "../../../supabase/functions/_shared/pdfTextCheck.js";

// Finalne PDF na podpis (faza C, docs/podpisy-dorucovani): HR ulozi vyplneny
// .docx vo Worde ako PDF a nahra ho. DOVERYHODNY vysledok (hash + kontrola
// textu) pocita LEN server (Edge Function hr-finalize-pdf) - databaza prijme
// finalne PDF iba od neho. Tato klientska kontrola je len rychla spatna vazba
// pred uploadom (rovnake pravidlo zo supabase/functions/_shared).

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      if (typeof window !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) {
        const { default: workerUrl } = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      }
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

// Text po stranach (rovnaky tvar ako na serveri: pole textov stran).
export async function extractPdfPages(bytes) {
  const pdfjs = await loadPdfjs();
  // pdf.js si buffer prevezme (detach) - kopia, aby sa nepokazil hash/upload
  const data = new Uint8Array(bytes.slice(0));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((it) => (it.str || "") + (it.hasEOL ? "\n" : "")).join(""));
  }
  await doc.destroy();
  return pages;
}

export async function extractPdfText(bytes) {
  const pages = await extractPdfPages(bytes);
  return { text: pages.join("\n"), pages: pages.length };
}

// Text vyplneneho .docx (telo + hlavicky/paty).
export function extractDocxText(docxBytes) {
  const zip = new PizZip(docxBytes);
  return Object.keys(zip.files)
    .filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n))
    .sort()
    .map((n) => docxXmlToText(zip.file(n).asText()))
    .join("\n");
}

// Rychla kontrola v prehliadaci pred uploadom (NEDOVERYHODNA - len UX).
export async function verifyFinalPdf({ pdfBytes, docxBytes, snapshot }) {
  if (!isPdfBytes(pdfBytes)) {
    return { sha256: null, check: { method: TEXT_CHECK_METHOD, ok: false, reason: "NOT_PDF", checked_keys: [], missing_keys: [] } };
  }
  const sha256 = await sha256Hex(pdfBytes);
  let pdfText = "", pages = null;
  try {
    ({ text: pdfText, pages } = await extractPdfText(pdfBytes));
  } catch (e) {
    return { sha256, check: { method: TEXT_CHECK_METHOD, ok: false, reason: "UNREADABLE_PDF", error: String(e?.message || e), checked_keys: [], missing_keys: [] } };
  }
  const docxText = docxBytes ? extractDocxText(docxBytes) : null;
  const check = checkPdfAgainstSnapshot({ pdfText, pages, docxText, snapshot });
  return { sha256, check: { ...check, checked_at: new Date().toISOString() } };
}

export const TEXT_CHECK_REASON_LABELS = {
  NOT_PDF: "Soubor není PDF.",
  UNREADABLE_PDF: "PDF nelze přečíst.",
  NO_TEXT_LAYER: "PDF neobsahuje text (sken nebo obrázek) – uložte dokument z Wordu jako PDF.",
  NO_VALUES_TO_CHECK: "Dokument nemá uložené hodnoty ke kontrole – elektronický podpis není možný, použijte papír.",
  VALUES_MISSING: "PDF neodpovídá vygenerovanému dokumentu – chybí pole:",
  PATH_MISMATCH: "Soubor není uložen u tohoto dokumentu.",
  DOCUMENT_LOCKED: "Dokument je už podepsaný – finální PDF nelze změnit.",
};

// Docasna cesta uploadu - finalnu cestu a hash potvrdi server. Nahodny
// suffix: kazdy upload je novy objekt (bez upsert), nic sa neprepise.
export function buildFinalPdfUploadPath(doc, suffix) {
  return `${documentFolder(doc)}finalni-${suffix}.pdf`;
}
