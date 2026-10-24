import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  isValidEmail, validateKioskEmail, validateKioskCommunication, kioskDocumentPlan, draftEmail, draftFingerprint, buildDeclarationPdf,
} from "../../../supabase/functions/_shared/hr/kioskDocuments.js";
import { extractPdfText } from "./finalPdf.js";
import { sha256Hex } from "../../../supabase/functions/_shared/pdfTextCheck.js";

const root = path.resolve(__dirname, "../../..");
const font = new Uint8Array(fs.readFileSync(path.join(root, "supabase/functions/_shared/fonts/DejaVuSans.ttf")));
const bold = new Uint8Array(fs.readFileSync(path.join(root, "supabase/functions/_shared/fonts/DejaVuSans-Bold.ttf")));
const T = (key, body) => ({ id: `lt-${key}`, version_no: 1, title: key, body: `KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.\n${body}`, body_sha256: "a".repeat(64), status: "KONCEPT" });
const DRAFT = { first_name: "Jana", last_name: "Testová", date_of_birth: "1991-03-07", private_email: " Jana.Testova@Example.test " };

describe("e-mail v kiosku", () => {
  it("format", () => {
    expect(isValidEmail("a@b.cz")).toBe(true);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("a b@c.cz")).toBe(false);
  });
  it("e-mail alebo vyslovne 'Nemám / nechci uvést'", () => {
    expect(validateKioskEmail({ private_email: "" }, "")).toHaveLength(1);
    expect(validateKioskEmail({ private_email: "", no_private_email: true }, "")).toEqual([]);
    expect(validateKioskEmail({ private_email: "jana@example.test" }, "JANA@example.test ")).toEqual([]);
    expect(validateKioskEmail({ private_email: "jana@example.test" }, "jan@example.test")[0]).toMatch(/neshoduje/);
    expect(validateKioskEmail({ private_email: "jana@example" }, "jana@example")[0]).toMatch(/formát/);
  });
  it("bez e-mailu nie je adresa pre vyhlasenia", () => {
    expect(draftEmail({ ...DRAFT, no_private_email: true })).toBe("");
    expect(draftEmail(DRAFT)).toBe("jana.testova@example.test");
  });
});

// schvalene texty (migracia 66: bez schvaleneho textu sa volba neponuka)
const TEXTS = { texts: { S21_ADDRESS_NOTICE: { id: "t21" }, S335_NOTICE: { id: "n" }, S335_CONSENT: { id: "c" } } };

describe("Elektronická komunikace - volby", () => {
  it("bez schvaleneho textu sa § 21 ani § 335 neponuka a dokument nevznikne", () => {
    const d = { ...DRAFT, kiosk_s21: "ANO", kiosk_s335: "ANO", kiosk_s335_notice_id: "n" };
    expect(validateKioskCommunication(DRAFT, { s335_consent_enabled: true, texts: {} })).toEqual([]);
    expect(kioskDocumentPlan(d, { s335_consent_enabled: true, texts: {} })).toEqual(["QUESTIONNAIRE"]);
  });
  it("bez e-mailu sa nic nevolí a vznikne len dotaznik", () => {
    const d = { ...DRAFT, private_email: "", no_private_email: true, kiosk_s21: "ANO", kiosk_s335: "ANO", kiosk_s335_notice_id: "n" };
    expect(validateKioskCommunication(d, { s335_consent_enabled: true })).toEqual([]);
    expect(kioskDocumentPlan(d, { s335_consent_enabled: true })).toEqual(["QUESTIONNAIRE"]);
  });
  it("§ 21 volba nie je predvyplnena", () => {
    expect(validateKioskCommunication(DRAFT, TEXTS)).toHaveLength(1);
    expect(validateKioskCommunication({ ...DRAFT, kiosk_s21: "NE" }, TEXTS)).toEqual([]);
  });
  it("§ 21 ANO: samostatne oznamenie; NE: ziadne", () => {
    expect(kioskDocumentPlan({ ...DRAFT, kiosk_s21: "ANO" }, TEXTS)).toEqual(["QUESTIONNAIRE", "S21"]);
    expect(kioskDocumentPlan({ ...DRAFT, kiosk_s21: "NE" }, TEXTS)).toEqual(["QUESTIONNAIRE"]);
  });
  it("§ 335 predvolene vypnuty - ani suhlas ANO nevytvori dokument", () => {
    expect(kioskDocumentPlan({ ...DRAFT, kiosk_s21: "NE", kiosk_s335: "ANO", kiosk_s335_notice_id: "n" }, {})).toEqual(["QUESTIONNAIRE"]);
  });
  it("§ 335 zapnuty: najprv poucenie, potom samostatna volba; samostatny dokument", () => {
    const cfg = { ...TEXTS, s335_consent_enabled: true };
    expect(validateKioskCommunication({ ...DRAFT, kiosk_s21: "NE" }, cfg)[0]).toMatch(/poučení/);
    expect(validateKioskCommunication({ ...DRAFT, kiosk_s21: "NE", kiosk_s335_notice_id: "n" }, cfg)[0]).toMatch(/souhlasíte/);
    expect(kioskDocumentPlan({ ...DRAFT, kiosk_s21: "ANO", kiosk_s335: "ANO", kiosk_s335_notice_id: "n" }, cfg)).toEqual(["QUESTIONNAIRE", "S21", "S335"]);
    expect(kioskDocumentPlan({ ...DRAFT, kiosk_s21: "NE", kiosk_s335: "ANO" }, cfg)).toEqual(["QUESTIONNAIRE"]);
  });
  it("odtlacok konceptu je deterministicky a nezavisi od poradia klucov", async () => {
    expect(await draftFingerprint({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(await draftFingerprint({ b: [1, { d: 3, c: 2 }], a: 1 }));
    expect(await draftFingerprint({ a: 1 })).not.toBe(await draftFingerprint({ a: 2 }));
  });
});

describe("PDF vyhlaseni", () => {
  const createdAt = "2026-10-22T08:00:00Z";
  it("§ 21 oznamenie obsahuje adresu, text konceptu a verziu", async () => {
    const bytes = await buildDeclarationPdf({ kind: "S21", draft: DRAFT, text: T("S21_ADDRESS_NOTICE", "Prohlašuji, že adresa není v dispozici zaměstnavatele. Lhůta 7 dnů."), createdAt, fontBytes: font, boldFontBytes: bold });
    const text = (await extractPdfText(bytes)).text;
    expect(text).toContain("jana.testova@example.test");
    expect(text).toContain("KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU");
    expect(text).toContain("není v dispozici zaměstnavatele");
    expect(text).toContain("S21_ADDRESS_NOTICE verze 1");
    expect(text).not.toContain("Poučení");
  });
  it("§ 335 suhlas obsahuje cele poucenie pred textom suhlasu", async () => {
    const bytes = await buildDeclarationPdf({
      kind: "S335", draft: DRAFT, text: T("S335_CONSENT", "Souhlasím s doručováním."),
      notice: { ...T("S335_NOTICE", "Fikce doručení 15. dnem. Souhlas lze odvolat."), title: "Poučení § 335" }, createdAt, fontBytes: font, boldFontBytes: bold,
    });
    const text = (await extractPdfText(bytes)).text;
    expect(text.indexOf("Fikce doručení")).toBeGreaterThan(0);
    expect(text.indexOf("Fikce doručení")).toBeLessThan(text.indexOf("Souhlasím s doručováním"));
    expect(text).toContain("S335_NOTICE verze 1");
  });
  it("deterministicke pre rovnaky vstup; bez e-mailu sa nevytvori", async () => {
    const args = { kind: "S21", draft: DRAFT, text: T("S21_ADDRESS_NOTICE", "x"), createdAt, fontBytes: font, boldFontBytes: bold };
    expect(await sha256Hex(await buildDeclarationPdf(args))).toBe(await sha256Hex(await buildDeclarationPdf(args)));
    await expect(buildDeclarationPdf({ ...args, draft: { ...DRAFT, no_private_email: true } })).rejects.toThrow(/e-mailove/);
    await expect(buildDeclarationPdf({ ...args, kind: "S335", notice: null })).rejects.toThrow(/pouceni/);
  });
});

describe("serverove kopie suborov", () => {
  it("vzor dotaznika, pismo a logo na serveri su zhodne s verejnymi", () => {
    for (const [a, b] of [
      ["public/hr/JMHZ_dotaznik_2026-03-20C.pdf", "supabase/functions/_shared/hr/JMHZ_dotaznik_2026-03-20C.pdf"],
      ["public/hr/DejaVuSerif.ttf", "supabase/functions/_shared/hr/DejaVuSerif.ttf"],
      ["public/hr/DejaVuSans.ttf", "supabase/functions/_shared/fonts/DejaVuSans.ttf"],
      ["public/stenger-logo.png", "supabase/functions/_shared/hr/stenger-logo.png"],
    ]) expect(fs.readFileSync(path.join(root, a)).equals(fs.readFileSync(path.join(root, b))), b).toBe(true);
  });
});
