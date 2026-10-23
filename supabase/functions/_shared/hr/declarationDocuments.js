// Faza I - vyhlasenia a poucenia pre existujuceho zamestnanca, generovane
// serverom (Edge Function hr-declarations) z verzovanych textov
// hr_legal_text_versions. Ciste funkcie, bez Supabase. Kiosk ma vlastny
// generator (kioskDocuments.js), aby sa nezmenili hashe jeho dokumentov.
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { COMPANY, isValidEmail, normalizeEmail } from "./kioskDocuments.js";

// declarationKind = co vznikne v employee_contact_declarations po uplnom
// podpise (trigger hr_documents_declaration_signed); null = len dokument.
export const DECLARATION_DOCS = {
  S21: { doc_type: "s21_oznameni_adresy", title: "Oznámení elektronické adresy (§ 21 ZP)", textKey: "S21_ADDRESS_NOTICE", declarationKind: "S21_ADDRESS_NOTICE", needsEmail: true },
  S335_NOTICE: { doc_type: "s335_pouceni", title: "Poučení o elektronickém doručování (§ 335 ZP)", textKey: "S335_NOTICE", declarationKind: null, needsEmail: false },
  S335: { doc_type: "s335_souhlas", title: "Souhlas s elektronickým doručováním (§ 335 ZP)", textKey: "S335_CONSENT", noticeKey: "S335_NOTICE", declarationKind: "S335_CONSENT", needsEmail: true },
  S335_REVOCATION: { doc_type: "s335_odvolani", title: "Odvolání souhlasu s elektronickým doručováním (§ 335 ZP)", textKey: "S335_REVOCATION", declarationKind: "S335_REVOCATION", needsEmail: true },
  RECEIPT: { doc_type: "potvrzeni_prevzeti", title: "Potvrzení o převzetí písemnosti", textKey: "RECEIPT_CONFIRMATION", declarationKind: null, needsEmail: false },
};

export const employeeName = (e) => [e?.title, e?.first_name, e?.last_name].filter(Boolean).map((s) => String(s).trim()).join(" ");

// Vstupy pre generovanie; vracia zoznam chyb (prazdny = OK).
export function declarationInputErrors(kind, { employee, email, text, notice, target, s335Enabled } = {}) {
  const def = DECLARATION_DOCS[kind];
  if (!def) return ["Neznámý druh dokumentu."];
  const out = [];
  if (!employee?.first_name || !employee?.last_name) out.push("Chybí jméno zaměstnance.");
  if (def.needsEmail && !isValidEmail(email)) out.push("Zaměstnanec nemá platný soukromý e-mail.");
  if (!text?.body) out.push(`Chybí text ${def.textKey}.`);
  if (def.noticeKey && !notice?.body) out.push("Souhlas § 335 vyžaduje poučení.");
  if ((kind === "S335" || kind === "S335_NOTICE") && s335Enabled !== true) out.push("Elektronické doručování podle § 335 je vypnuté (nastavení s335_consent_enabled).");
  if (kind === "RECEIPT" && (!target?.title || !/^[0-9a-f]{64}$/.test(target?.sha256 || ""))) out.push("Potvrzení o převzetí potřebuje podepsaný dokument.");
  return out;
}

function wrap(text, font, size, width) {
  const out = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(t, size) > width) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}
const isoToCz = (iso) => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${Number(m[3])}. ${Number(m[2])}. ${m[1]}` : ""; };
const pragueDate = (iso) => new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", dateStyle: "long", timeStyle: "short" }).format(new Date(iso));

// Deterministicke pre rovnaky vstup (datum vytvorenia je parameter).
export async function buildEmployeeDeclarationPdf({ kind, employee, email, text, notice, target, createdAt, fontBytes, boldFontBytes, s335Enabled = true }) {
  const errors = declarationInputErrors(kind, { employee, email, text, notice, target, s335Enabled });
  if (errors.length) throw new Error(errors.join(" "));
  const def = DECLARATION_DOCS[kind];
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const bold = await pdf.embedFont(boldFontBytes || fontBytes, { subset: true });
  const W = 595.28, H = 841.89, M = 56, TW = W - 2 * M;
  const grey = rgb(0.35, 0.35, 0.35);
  let page = pdf.addPage([W, H]);
  let y = H - M;
  const line = (s, { f = font, size = 10.5, gap = 4, color = rgb(0, 0, 0) } = {}) => {
    for (const l of wrap(s, f, size, TW)) {
      if (y < M + 40) { page = pdf.addPage([W, H]); y = H - M; }
      page.drawText(l, { x: M, y, size, font: f, color });
      y -= size + gap;
    }
  };
  const space = (h) => { y -= h; };

  line(`${COMPANY.name}, IČO ${COMPANY.ico}`, { size: 9, color: grey });
  space(10);
  line(text.title, { f: bold, size: 15 });
  space(8);
  line(`Zaměstnanec: ${employeeName(employee)}`);
  if (employee.date_of_birth) line(`Datum narození: ${isoToCz(employee.date_of_birth)}`);
  if (def.needsEmail) line(`Elektronická adresa: ${normalizeEmail(email)}`, { f: bold });
  if (kind === "RECEIPT") {
    line(`Písemnost: ${target.title}${target.version_no ? ` (verze ${target.version_no})` : ""}`, { f: bold });
    line(`Otisk SHA-256 předaného vyhotovení: ${target.sha256}`, { size: 8.5 });
  }
  space(10);
  if (def.noticeKey) {
    line(`${notice.title} (verze ${notice.version_no})`, { f: bold, size: 11 });
    space(2);
    line(notice.body, { size: 10 });
    space(12);
    line(text.title, { f: bold, size: 11 });
    space(2);
  }
  line(text.body);
  space(14);
  line(`Vytvořeno: ${pragueDate(createdAt)}`, { size: 9, color: grey });
  line(`Text: ${def.textKey} verze ${text.version_no}${text.status ? ` (${text.status})` : ""}, SHA-256 ${text.body_sha256 || "—"}`, { size: 8, color: grey });
  if (def.noticeKey) line(`Poučení: ${def.noticeKey} verze ${notice.version_no}, SHA-256 ${notice.body_sha256 || "—"}`, { size: 8, color: grey });
  line(kind === "RECEIPT" ? "Datum převzetí: ....................   Podpis zaměstnance:" : "Podpis zaměstnance: elektronicky – viz důkazní list podepsaného originálu, nebo vlastnoruční podpis níže.", { size: 9 });
  space(30);
  line("..................................................", { size: 10 });

  pdf.setTitle(def.title);
  pdf.setAuthor(COMPANY.name);
  pdf.setCreator("Stenger ONE");
  pdf.setProducer("Stenger ONE");
  pdf.setCreationDate(new Date(createdAt));
  pdf.setModificationDate(new Date(createdAt));
  return pdf.save({ useObjectStreams: false });
}
