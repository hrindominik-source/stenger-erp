import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DECLARATION_DOCS, declarationInputErrors, buildEmployeeDeclarationPdf, employeeName,
} from "../../../supabase/functions/_shared/hr/declarationDocuments.js";
import { defaultLegalActType } from "../../../supabase/functions/_shared/signingRules.js";
import { extractPdfText } from "./finalPdf.js";
import { sha256Hex } from "../../../supabase/functions/_shared/pdfTextCheck.js";

const root = path.resolve(__dirname, "../../..");
const font = new Uint8Array(fs.readFileSync(path.join(root, "supabase/functions/_shared/fonts/DejaVuSans.ttf")));
const bold = new Uint8Array(fs.readFileSync(path.join(root, "supabase/functions/_shared/fonts/DejaVuSans-Bold.ttf")));
const T = (key, body, v = 1) => ({ id: `lt-${key}-v${v}`, version_no: v, title: key, body: `KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.\n${body}`, body_sha256: "a".repeat(64), status: "KONCEPT" });
const EMP = { title: "Ing.", first_name: "Petra", last_name: "Vzorová", date_of_birth: "1988-05-04" };
const AT = "2026-10-23T08:00:00Z";
const base = { employee: EMP, createdAt: AT, fontBytes: font, boldFontBytes: bold };

describe("vyhlasenia pre zamestnanca (faza I)", () => {
  it("typy dokumentov maju spravny pravny ukon (rovnako ako DB)", () => {
    expect(defaultLegalActType("s21_oznameni_adresy")).toBe("EMPLOYEE_DECLARATION");
    expect(defaultLegalActType("s335_souhlas")).toBe("EMPLOYEE_DECLARATION");
    expect(defaultLegalActType("s335_odvolani")).toBe("EMPLOYEE_DECLARATION");
    expect(defaultLegalActType("s335_pouceni")).toBe("RECEIPT_ACKNOWLEDGEMENT");
    expect(defaultLegalActType("potvrzeni_prevzeti")).toBe("RECEIPT_ACKNOWLEDGEMENT");
    expect(Object.values(DECLARATION_DOCS).map((d) => d.doc_type)).toEqual(["s21_oznameni_adresy", "s335_pouceni", "s335_souhlas", "s335_odvolani", "potvrzeni_prevzeti"]);
  });

  it("vstupy: e-mail, text, poucenie, nastavenie § 335, podpisany dokument", () => {
    expect(declarationInputErrors("S21", { employee: EMP, email: "", text: T("S21", "x") })[0]).toMatch(/e-mail/);
    expect(declarationInputErrors("S21", { employee: EMP, email: "p@example.test", text: T("S21", "x") })).toEqual([]);
    expect(declarationInputErrors("S335", { employee: EMP, email: "p@example.test", text: T("C", "x"), s335Enabled: true })[0]).toMatch(/poučení/);
    expect(declarationInputErrors("S335", { employee: EMP, email: "p@example.test", text: T("C", "x"), notice: T("N", "y"), s335Enabled: false })[0]).toMatch(/vypnuté/);
    expect(declarationInputErrors("RECEIPT", { employee: EMP, text: T("R", "x"), target: { title: "Smlouva", sha256: "z" } })[0]).toMatch(/podepsaný dokument/);
    expect(declarationInputErrors("XYZ", {})).toEqual(["Neznámý druh dokumentu."]);
  });

  it("§ 335 suhlas obsahuje cele poucenie s verziou; deterministicky hash", async () => {
    const args = { ...base, kind: "S335", email: "Petra@Example.test", text: T("S335_CONSENT", "Souhlasím s doručováním."), notice: T("S335_NOTICE", "Poučení: odmítnutí převzetí…", 2) };
    const a = await buildEmployeeDeclarationPdf(args);
    const b = await buildEmployeeDeclarationPdf(args);
    expect(await sha256Hex(a)).toBe(await sha256Hex(b));
    const text = (await extractPdfText(a)).text.replace(/\s+/g, " ");
    expect(text).toContain("Ing. Petra Vzorová");
    expect(text).toContain("petra@example.test");
    expect(text).toContain("Poučení: odmítnutí převzetí");
    expect(text).toContain("S335_NOTICE verze 2");
    expect(text).toContain("KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU");
  });

  it("zmena textu = iny dokument (podpisy ostavaju viazane na staru verziu)", async () => {
    const v1 = await buildEmployeeDeclarationPdf({ ...base, kind: "S21", email: "p@example.test", text: T("S21_ADDRESS_NOTICE", "Oznamuji adresu.", 1) });
    const v2 = await buildEmployeeDeclarationPdf({ ...base, kind: "S21", email: "p@example.test", text: T("S21_ADDRESS_NOTICE", "Oznamuji adresu (upraveno).", 2) });
    expect(await sha256Hex(v1)).not.toBe(await sha256Hex(v2));
    expect((await extractPdfText(v2)).text.replace(/\s+/g, " ")).toContain("S21_ADDRESS_NOTICE verze 2");
  });

  it("potvrdenie o prevzati nesie otisk podpisaneho originalu", async () => {
    const sha = "b".repeat(64);
    const pdf = await buildEmployeeDeclarationPdf({ ...base, kind: "RECEIPT", text: T("RECEIPT_CONFIRMATION", "Potvrzuji převzetí."), target: { title: "Mzdový výměr", version_no: 2, sha256: sha } });
    const text = (await extractPdfText(pdf)).text.replace(/\s+/g, " ");
    expect(text).toContain("Mzdový výměr (verze 2)");
    expect(text).toContain(sha);
    expect(employeeName({ first_name: "A", last_name: "B" })).toBe("A B");
  });
});
