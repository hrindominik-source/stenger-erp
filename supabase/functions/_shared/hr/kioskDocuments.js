// Faza D - dokumenty vstupneho dotaznika (kiosk). Spolocne pre prehliadac
// (kiosk UI - co sa bude podpisovat) aj server (Edge Function hr-kiosk -
// jediny, kto PDF generuje a uklada). Ciste funkcie, bez Supabase.
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { sha256Hex } from "../pdfTextCheck.js";

export const COMPANY = { name: "Stenger Czech s.r.o.", ico: "28501381" };

// Kluce v draft_data, ktore patria len kiosku (nie su to polia karty
// zamestnanca - jedine pole e-mailu ostava private_email).
export const KIOSK_DRAFT_KEYS = ["no_private_email", "kiosk_s21", "kiosk_s335", "kiosk_s335_notice_id"];

export const KIOSK_DOCS = {
  QUESTIONNAIRE: { doc_type: "osobni_dotaznik", title: "Osobní dotazník zaměstnance", intentKey: "INTENT_QUESTIONNAIRE" },
  S21: { doc_type: "s21_oznameni_adresy", title: "Oznámení elektronické adresy (§ 21 ZP)", textKey: "S21_ADDRESS_NOTICE", intentKey: "INTENT_EMPLOYEE_DECLARATION", declarationKind: "S21_ADDRESS_NOTICE" },
  S335: { doc_type: "s335_souhlas", title: "Souhlas s elektronickým doručováním (§ 335 ZP)", textKey: "S335_CONSENT", noticeKey: "S335_NOTICE", intentKey: "INTENT_EMPLOYEE_DECLARATION", declarationKind: "S335_CONSENT" },
};

export function isValidEmail(s) {
  const v = String(s || "").trim();
  return v.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v);
}

export function normalizeEmail(s) {
  return String(s || "").trim().toLowerCase();
}

export function draftEmail(draft) {
  if (draft?.no_private_email) return "";
  const e = normalizeEmail(draft?.private_email);
  return isValidEmail(e) ? e : "";
}

// Krok "Bydliště a kontakt": bud e-mail (spravny format, dvakrat rovnako),
// alebo vyslovne "Nemám / nechci uvést". Vracia zoznam chyb (prazdny = OK).
export function validateKioskEmail(draft, confirm) {
  if (draft?.no_private_email) return [];
  const e = String(draft?.private_email || "").trim();
  if (!e) return ["Vyplňte soukromý e-mail, nebo zaškrtněte „Nemám / nechci uvést soukromý e-mail“."];
  if (!isValidEmail(e)) return ["E-mailová adresa nemá správný formát."];
  if (normalizeEmail(confirm) !== normalizeEmail(e)) return ["E-mailová adresa pro kontrolu se neshoduje."];
  return [];
}

// Krok "Elektronická komunikace": volby nie su predvyplnene - treba ich
// vyslovne zvolit (ANO/NE). Bez e-mailu sa nic nevolí.
export function validateKioskCommunication(draft, config) {
  const errors = [];
  if (!draftEmail(draft)) return errors;
  if (!["ANO", "NE"].includes(draft.kiosk_s21)) errors.push("Zvolte, zda oznamujete e-mail pro účely § 21 zákoníku práce.");
  if (config?.s335_consent_enabled) {
    if (!draft.kiosk_s335_notice_id) errors.push("Přečtěte si poučení o elektronickém doručování.");
    else if (!["ANO", "NE"].includes(draft.kiosk_s335)) errors.push("Zvolte, zda souhlasíte s elektronickým doručováním písemností.");
  }
  return errors;
}

// Ktore dokumenty sa pripravia na podpis. Dotaznik vzdy; § 21 a § 335 len
// pri platnom e-maile a vyslovnej volbe; § 335 len ak je zapnuty v konfigu-
// racii a poucenie (verzia) bolo zobrazene. Nikdy sa nespajaju.
export function kioskDocumentPlan(draft, config) {
  const plan = ["QUESTIONNAIRE"];
  const email = draftEmail(draft);
  if (email && draft.kiosk_s21 === "ANO") plan.push("S21");
  if (email && config?.s335_consent_enabled && draft.kiosk_s335 === "ANO" && draft.kiosk_s335_notice_id) plan.push("S335");
  return plan;
}

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

// Odtlacok konceptu - zmena udajov pred podpisom = nove PDF.
export async function draftFingerprint(draft) {
  return sha256Hex(new TextEncoder().encode(canonical(draft || {})));
}

export function personName(draft) {
  return [draft?.title, draft?.first_name, draft?.last_name].filter(Boolean).map((s) => String(s).trim()).join(" ");
}

function isoToCz(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])}. ${Number(m[2])}. ${m[1]}` : "";
}

function pragueDate(iso) {
  return new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", dateStyle: "long", timeStyle: "short" }).format(new Date(iso));
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

// PDF samostatneho vyhlasenia (§ 21 oznamenie / § 335 suhlas). Pri § 335 je
// v dokumente CELE poucenie (s verziou) pred textom suhlasu. Deterministicke
// pre rovnaky vstup (datum vytvorenia je parameter).
export async function buildDeclarationPdf({ kind, draft, text, notice, createdAt, fontBytes, boldFontBytes }) {
  const def = KIOSK_DOCS[kind];
  if (!def || kind === "QUESTIONNAIRE") throw new Error(`Neznamy druh vyhlaseni: ${kind}`);
  const email = draftEmail(draft);
  if (!email) throw new Error("Vyhlaseni bez platne e-mailove adresy nelze vytvorit.");
  if (!text?.body) throw new Error("Chybi text vyhlaseni.");
  if (kind === "S335" && !notice?.body) throw new Error("Souhlas § 335 vyzaduje pouceni.");

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const bold = await pdf.embedFont(boldFontBytes || fontBytes, { subset: true });
  const W = 595.28, H = 841.89, M = 56, TW = W - 2 * M;
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

  line(`${COMPANY.name}, IČO ${COMPANY.ico}`, { size: 9, color: rgb(0.35, 0.35, 0.35) });
  space(10);
  line(text.title, { f: bold, size: 15 });
  space(8);
  line(`Zaměstnanec / uchazeč: ${personName(draft) || "—"}`);
  if (draft.date_of_birth) line(`Datum narození: ${isoToCz(draft.date_of_birth)}`);
  line(`Elektronická adresa: ${email}`, { f: bold });
  space(10);
  if (kind === "S335") {
    line(`${notice.title} (verze ${notice.version_no})`, { f: bold, size: 11 });
    space(2);
    line(notice.body, { size: 10 });
    space(12);
    line(text.title, { f: bold, size: 11 });
    space(2);
  }
  line(text.body);
  space(14);
  line(`Vytvořeno: ${pragueDate(createdAt)}`, { size: 9, color: rgb(0.35, 0.35, 0.35) });
  line(`Text: ${def.textKey} verze ${text.version_no}${text.status ? ` (${text.status})` : ""}, SHA-256 ${text.body_sha256 || "—"}`, { size: 8, color: rgb(0.35, 0.35, 0.35) });
  if (kind === "S335") line(`Poučení: ${def.noticeKey} verze ${notice.version_no}, SHA-256 ${notice.body_sha256 || "—"}`, { size: 8, color: rgb(0.35, 0.35, 0.35) });
  line("Podpis zaměstnance: elektronicky – viz důkazní list podepsaného originálu, nebo vlastnoruční podpis níže.", { size: 9 });
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
