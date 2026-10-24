import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { sha256Hex } from "./pdfTextCheck.js";

// "Podpisany original" (faza C): NOVY subor = strany finalneho PDF bez zmeny
// obsahu + pripojena dokazna strana (manifest). Povodne finalne PDF sa
// nemeni a ostava ulozene samostatne so svojim hashom - manifest na neho
// odkazuje. Podpisany original ma vlastny hash (hr_documents.signed_pdf_sha256).

export const SIGNER_LABELS = { EMPLOYEE: "Zaměstnanec", EMPLOYER: "Za zaměstnavatele" };
export const METHOD_LABELS = {
  ELECTRONIC_TABLET: "Vlastnoruční podpis na tabletu (jednoduchý elektronický podpis)",
  ELECTRONIC_QUALIFIED: "Uznávaný elektronický podpis (externě podepsané PDF)",
  PAPER: "Podpis na papíře (sken)",
};
// Podpis rukou na obrazovke - kto a kde (kanal z dokazov podpisu)
export const CHANNEL_LABELS = {
  HR_TABLET_IN_PERSON: "Vlastnoruční podpis zaměstnance na tabletu za přítomnosti HR (jednoduchý elektronický podpis)",
  KIOSK_TABLET: "Vlastnoruční podpis zaměstnance na tabletu v nástupním kiosku (jednoduchý elektronický podpis)",
  HR_TABLET_EMPLOYER: "Vlastnoruční podpis přihlášeného uživatele na jeho obrazovce (jednoduchý elektronický podpis)",
};

const PAGE = [595.28, 841.89]; // A4
const MARGIN = 50;

export function formatPragueDateTime(iso) {
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague", day: "numeric", month: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short",
  }).format(new Date(iso));
}

function wrap(text, font, size, width) {
  const out = [];
  for (const para of String(text ?? "").split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) { line = next; continue; }
      if (line) out.push(line);
      // dlhe slovo bez medzier (hash) - rozdelit po znakoch
      let w = word;
      while (font.widthOfTextAtSize(w, size) > width) {
        let i = w.length;
        while (i > 1 && font.widthOfTextAtSize(w.slice(0, i), size) > width) i--;
        out.push(w.slice(0, i));
        w = w.slice(i);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

/**
 * @param {object} p
 * @param {ArrayBuffer|Uint8Array} p.originalPdfBytes finalne PDF (presne ulozene bajty)
 * @param {string} p.expectedSha256 hr_documents.final_pdf_sha256 - musi sediet
 * @param {ArrayBuffer|Uint8Array} p.fontBytes, p.boldFontBytes DejaVuSans (diakritika)
 * @param {{id: string, title: string, employeeName: string}} p.document
 * @param {Array<{signer_type, signed_by_name, signed_at, method, intent_text, intent_text_version, intent_text_sha256,
 *   identity_verification_label, evidence_sha256, signature_png}>} p.signatures
 * @param {string} p.createdAt ISO cas vytvorenia originalu
 */
export async function buildSignedOriginal({ originalPdfBytes, expectedSha256, fontBytes, boldFontBytes, document, signatures, createdAt }) {
  const originalSha = await sha256Hex(originalPdfBytes instanceof Uint8Array ? originalPdfBytes.slice().buffer : originalPdfBytes.slice(0));
  if (originalSha !== expectedSha256) {
    throw new Error("Finální PDF neodpovídá uloženému hashi - podepsaný originál nelze vytvořit.");
  }
  if (!signatures?.length) throw new Error("Dokument nemá žádný podpis.");

  const original = await PDFDocument.load(originalPdfBytes, { updateMetadata: false });
  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  const pages = await out.copyPages(original, original.getPageIndices());
  pages.forEach((p) => out.addPage(p));
  const originalPageCount = pages.length;

  const font = await out.embedFont(fontBytes, { subset: true });
  const bold = await out.embedFont(boldFontBytes || fontBytes, { subset: true });
  const width = PAGE[0] - 2 * MARGIN;
  let page = out.addPage(PAGE);
  let y = PAGE[1] - MARGIN;
  const newPageIfNeeded = (h) => {
    if (y - h < MARGIN + 30) { page = out.addPage(PAGE); y = PAGE[1] - MARGIN; }
  };
  const text = (t, { size = 9, f = font, gap = 3, color = rgb(0, 0, 0) } = {}) => {
    for (const line of wrap(t, f, size, width)) {
      newPageIfNeeded(size + gap);
      page.drawText(line, { x: MARGIN, y: y - size, size, font: f, color });
      y -= size + gap;
    }
  };
  const space = (h) => { y -= h; };

  text("DŮKAZNÍ LIST K ELEKTRONICKY PODEPSANÉMU DOKUMENTU", { size: 13, f: bold });
  space(6);
  text(`Dokument: ${document.title}`, { size: 10, f: bold });
  text(`Zaměstnanec: ${document.employeeName}`);
  text(`ID dokumentu: ${document.id}`);
  text(`Strany 1–${originalPageCount} jsou beze změny převzaty z finálního PDF dokumentu.`);
  text(`SHA-256 finálního PDF (podepsaný obsah): ${expectedSha256}`, { f: bold });
  space(10);

  for (const [i, s] of signatures.entries()) {
    newPageIfNeeded(150);
    text(`${i + 1}. ${SIGNER_LABELS[s.signer_type] || s.signer_type}: ${s.signed_by_name || ""}`, { size: 11, f: bold });
    text(`Čas podpisu (serverový): ${s.signed_at ? formatPragueDateTime(s.signed_at) : "—"}`);
    text(`Způsob: ${CHANNEL_LABELS[s.channel] || METHOD_LABELS[s.method] || s.method}`);
    if (s.identity_verification_label) text(`Ověření totožnosti: ${s.identity_verification_label}`);
    if (s.intent_text) {
      text(`Prohlášení podepisujícího${s.intent_text_version ? ` (verze ${s.intent_text_version})` : ""}: „${s.intent_text}“`);
      if (s.intent_text_sha256) text(`SHA-256 textu prohlášení: ${s.intent_text_sha256}`, { size: 8, color: rgb(0.3, 0.3, 0.3) });
    }
    if (s.evidence_sha256) text(`SHA-256 důkazního záznamu: ${s.evidence_sha256}`, { size: 8, color: rgb(0.3, 0.3, 0.3) });
    if (s.signature_png) {
      const img = await out.embedPng(s.signature_png);
      const scale = Math.min(200 / img.width, 70 / img.height, 1);
      const w = img.width * scale, h = img.height * scale;
      newPageIfNeeded(h + 10);
      page.drawImage(img, { x: MARGIN, y: y - h - 4, width: w, height: h });
      page.drawLine({ start: { x: MARGIN, y: y - h - 6 }, end: { x: MARGIN + 200, y: y - h - 6 }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
      y -= h + 12;
    }
    space(10);
  }

  space(6);
  text(`Důkazní list vytvořil systém Stenger ONE dne ${formatPragueDateTime(createdAt)}. Úplný důkazní záznam (zobrazení všech stran, zařízení, časy) je uložen v systému u dokumentu ${document.id}.`, { size: 8, color: rgb(0.3, 0.3, 0.3) });

  out.setTitle(`${document.title} – podepsaný originál`);
  out.setProducer("Stenger ONE");
  out.setCreationDate(new Date(createdAt));
  out.setModificationDate(new Date(createdAt));
  const bytes = await out.save({ useObjectStreams: false });
  return { bytes, sha256: await sha256Hex(bytes.slice().buffer), originalPageCount, totalPages: out.getPageCount() };
}

// Overenie podpisaneho originalu (server, hr-signed-original): strany
// finalneho PDF su nezmenene (pocet, rozmery, text) a dokazna strana obsahuje
// udaje zo zaznamov v DB (hash finalneho PDF, podpisujuci, hash dokazov).
// extractPages(bytes) -> Promise<string[]> (text po stranach) - dodava
// prostredie (pdf.js v prehliadaci/testoch, unpdf na serveri).
export async function verifySignedOriginal({ signedBytes, finalBytes, finalSha256, signatures, extractPages, normalize }) {
  const problems = [];
  if (await sha256Hex(finalBytes) !== finalSha256) problems.push("FINAL_PDF_HASH_MISMATCH");
  const [finalDoc, signedDoc] = await Promise.all([PDFDocument.load(finalBytes), PDFDocument.load(signedBytes)]);
  const n = finalDoc.getPageCount();
  if (signedDoc.getPageCount() <= n) problems.push("EVIDENCE_PAGE_MISSING");
  for (let i = 0; i < Math.min(n, signedDoc.getPageCount()); i++) {
    const a = finalDoc.getPage(i).getSize(), b = signedDoc.getPage(i).getSize();
    if (Math.abs(a.width - b.width) > 0.01 || Math.abs(a.height - b.height) > 0.01) problems.push(`PAGE_${i + 1}_SIZE_CHANGED`);
  }
  const [finalPages, signedPages] = await Promise.all([extractPages(finalBytes), extractPages(signedBytes)]);
  for (let i = 0; i < n; i++) {
    if (normalize(finalPages[i] || "") !== normalize(signedPages[i] || "")) problems.push(`PAGE_${i + 1}_TEXT_CHANGED`);
  }
  const evidence = normalize(signedPages.slice(n).join("\n"));
  if (!evidence.includes(finalSha256)) problems.push("EVIDENCE_FINAL_HASH_MISSING");
  for (const [i, s] of signatures.entries()) {
    if (s.signed_by_name && !evidence.includes(normalize(s.signed_by_name))) problems.push(`EVIDENCE_SIGNER_${i + 1}_NAME_MISSING`);
    if (s.evidence_sha256 && !evidence.includes(s.evidence_sha256)) problems.push(`EVIDENCE_SIGNER_${i + 1}_HASH_MISSING`);
    if (s.signed_at && !evidence.includes(normalize(formatPragueDateTime(s.signed_at)))) problems.push(`EVIDENCE_SIGNER_${i + 1}_TIME_MISSING`);
  }
  return { ok: problems.length === 0, problems };
}
