import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {
  verifyFinalPdf, checkPdfAgainstSnapshot, extractDocxText, extractPdfText, extractPdfPages, normalizeForMatch,
  isPdfBytes, buildFinalPdfUploadPath,
} from "./finalPdf.js";
import { buildSignedOriginal, verifySignedOriginal } from "./signedOriginal.js";
import { sha256Hex } from "./documentHash.js";

const root = path.resolve(__dirname, "../../..");
const font = fs.readFileSync(path.join(root, "public/hr/DejaVuSans.ttf"));
const bold = fs.readFileSync(path.join(root, "public/hr/DejaVuSans-Bold.ttf"));

// Vymyslene udaje
const snapshot = {
  jmeno: "Jan Vzorový",
  datum_nastupu: "1. 11. 2026",
  mzda: "32 500 Kč",
  pozice: "dělník výroby",
  zastupce: "Bc. Testovací Personalistka",
  nepouzita_hodnota: "Tato hodnota v šabloně není",
  pocet: 40,
  prazdne: "",
};

const BODY = [
  "PRACOVNÍ SMLOUVA",
  "Zaměstnanec: Jan Vzorový",
  "Den nástupu do práce: 1. 11. 2026",
  "Druh práce: dělník výroby, týdenní pracovní doba 40 hodin.",
  "Mzda: 32 500 Kč měsíčně. Ostatní práva a povinnosti se řídí zákoníkem práce a vnitřními předpisy zaměstnavatele.",
  "Za zaměstnavatele: Bc. Testovací Personalistka, na základě plné moci",
];

function makeDocx(lines) {
  const zip = new PizZip();
  const paras = lines.map((l) => `<w:p><w:r><w:t xml:space="preserve">${l.replace(/&/g, "&amp;")}</w:t></w:r></w:p>`).join("");
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${paras}</w:body></w:document>`);
  return zip.generate({ type: "uint8array" });
}

async function makePdf(lines, { withText = true } = {}) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const f = await doc.embedFont(font, { subset: true });
  const page = doc.addPage([595, 842]);
  if (withText) {
    // Word casto zalomi riadok inde nez docx - simulacia: dlhy riadok rozdeleny
    let y = 800;
    for (const l of lines) {
      const parts = l.length > 60 ? [l.slice(0, 55), l.slice(55)] : [l];
      for (const p of parts) { page.drawText(p, { x: 40, y, size: 10, font: f }); y -= 14; }
    }
  } else {
    page.drawRectangle({ x: 40, y: 400, width: 200, height: 100 });
  }
  return doc.save();
}

// 1x1 PNG
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));

describe("finalne PDF - kontrola textu", () => {
  const docx = makeDocx(BODY);

  it("normalizacia ignoruje medzery, NBSP, velkost pismen a ligatury", () => {
    expect(normalizeForMatch("32 500 Kč")).toBe(normalizeForMatch("32 500\nkč"));
    expect(normalizeForMatch("ﬁrma")).toBe("firma");
  });

  it("text z docx vratane entit", () => {
    expect(extractDocxText(makeDocx(["A & B"]))).toContain("A & B");
  });

  it("zhodne PDF prejde, nepouzite hodnoty sa nekontroluju", async () => {
    const pdf = await makePdf(BODY);
    const { sha256, check } = await verifyFinalPdf({ pdfBytes: pdf, docxBytes: docx, snapshot });
    expect(sha256).toBe(await sha256Hex(pdf.slice().buffer));
    expect(check.ok).toBe(true);
    expect(check.checked_keys).toEqual(["datum_nastupu", "jmeno", "mzda", "pocet", "pozice", "zastupce"]);
    expect(check.checked_keys).not.toContain("nepouzita_hodnota");
    expect(check.missing_keys).toEqual([]);
    expect(JSON.stringify(check)).not.toContain("Vzorový"); // do DB idu len kluce
  });

  it("PDF so zmenenou mzdou sa zablokuje", async () => {
    const pdf = await makePdf(BODY.map((l) => l.replace("32 500", "23 500")));
    const { check } = await verifyFinalPdf({ pdfBytes: pdf, docxBytes: docx, snapshot });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("VALUES_MISSING");
    expect(check.missing_keys).toEqual(["mzda"]);
  });

  it("PDF bez textovej vrstvy sa odmietne", async () => {
    const pdf = await makePdf(BODY, { withText: false });
    const { check } = await verifyFinalPdf({ pdfBytes: pdf, docxBytes: docx, snapshot });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("NO_TEXT_LAYER");
  });

  it("subor, ktory nie je PDF, sa odmietne", async () => {
    const { check } = await verifyFinalPdf({ pdfBytes: docx, docxBytes: docx, snapshot });
    expect(check.reason).toBe("NOT_PDF");
    expect(isPdfBytes(docx)).toBe(false);
  });

  it("bez snapshotu nie je co kontrolovat - podpis blokovany", () => {
    const r = checkPdfAgainstSnapshot({ pdfText: BODY.join(" "), docxText: BODY.join(" "), snapshot: {} });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("NO_VALUES_TO_CHECK");
  });

  it("upload finalneho PDF ide do priecinka dokumentu (server cestu overi)", () => {
    expect(buildFinalPdfUploadPath({ id: "doc-1", employee_id: "emp-1" }, "abc")).toBe("zamestnanci/emp-1/doc-1/finalni-abc.pdf");
    expect(buildFinalPdfUploadPath({ id: "doc-2", employee_id: null, onboarding_session_id: "onb-1" }, "x")).toBe("dotaznik/onb-1/doc-2/finalni-x.pdf");
  });
});

describe("normalizacia textu", () => {
  const same = (a, b) => expect(normalizeForMatch(a)).toBe(normalizeForMatch(b));
  it("delenie slov na konci riadku", () => same("Zaměst-\nnankyně se zavazuje", "Zaměstnankyně se zavazuje"));
  it("nedelitelne a uzke medzery, zalomenia", () => same("32 500 Kč\nměsíčně", "32 500 Kč měsíčně"));
  it("typograficke uvodzovky a pomlcky", () => same("„dělnice“ – výroba", "\"dělnice\" - výroba"));
  it("ligatury", () => same("ﬁrma ﬂotila", "firma flotila"));
  it("formaty datumu", () => {
    same("01.11.2026", "1. 11. 2026");
    same("1.11.2026", "1. 11. 2026");
    expect(normalizeForMatch("1. 11. 2026")).not.toBe(normalizeForMatch("11. 1. 2026"));
  });
  it("formaty cisel", () => {
    same("32.500,00 Kč", "32 500 Kč");
    same("32 500,- Kč", "32 500 Kč");
    same("32'500 Kč", "32 500 Kč");
    expect(normalizeForMatch("32 500 Kč")).not.toBe(normalizeForMatch("23 500 Kč"));
  });
  it("datum nepokazi pravidlo pre tisice", () => expect(normalizeForMatch("dne 1. 11. 2026 mzda 1.250 Kč")).toBe("dne1.11.2026mzda1250kč"));
});

describe("PDF ulozene skutocnym Wordom (fixture)", () => {
  const dir = path.join(root, "src/lib/hr/__fixtures__/word_final_pdf");
  const read = (f) => new Uint8Array(fs.readFileSync(path.join(dir, f)));
  let SNAP;
  it("nacitanie snapshotu fixture", async () => {
    ({ SNAPSHOT: SNAP } = await import("./__fixtures__/word_final_pdf/make_docx.mjs"));
    expect(SNAP.mzda).toBe("32 500 Kč");
  });
  it("zalomeny text, delenie slov a NBSP z Wordu prejde", async () => {
    const { check } = await verifyFinalPdf({ pdfBytes: read("zmluva.pdf"), docxBytes: read("zmluva.docx"), snapshot: SNAP });
    expect(check.missing_keys).toEqual([]);
    expect(check.ok).toBe(true);
    expect(check.checked_keys).not.toContain("nepouzite");
    expect(check.checked_keys).toEqual(expect.arrayContaining(["jmeno", "mzda", "datum_nastupu", "pozice", "adresa", "zastupce"]));
  });
  it("PDF s inou mzdou neprejde (pole mzda)", async () => {
    const { check } = await verifyFinalPdf({ pdfBytes: read("zmluva_ina_mzda.pdf"), docxBytes: read("zmluva.docx"), snapshot: SNAP });
    expect(check.ok).toBe(false);
    expect(check.missing_keys).toEqual(["mzda"]);
  });
  it("PDF s inym menom neprejde (pole jmeno)", async () => {
    const { check } = await verifyFinalPdf({ pdfBytes: read("zmluva_ine_meno.pdf"), docxBytes: read("zmluva.docx"), snapshot: SNAP });
    expect(check.ok).toBe(false);
    expect(check.missing_keys).toEqual(["jmeno"]);
  });
});

describe("podpisany original s doznou stranou", () => {
  it("povodne strany ostanu, pribudne dokazna strana s hashom", async () => {
    const original = await makePdf(BODY);
    const originalCopy = original.slice();
    const sha = await sha256Hex(original.slice().buffer);
    const r = await buildSignedOriginal({
      originalPdfBytes: original, expectedSha256: sha, fontBytes: font, boldFontBytes: bold,
      document: { id: "doc-1", title: "Pracovní smlouva", employeeName: "Jan Vzorový" },
      signatures: [
        { signer_type: "EMPLOYEE", signed_by_name: "Jan Vzorový", signed_at: "2026-10-22T08:15:00Z", method: "ELECTRONIC_TABLET",
          intent_text: "Seznámil/a jsem se s celým obsahem a uzavírám tuto smlouvu.", intent_text_version: 1,
          intent_text_sha256: "b".repeat(64), evidence_sha256: "c".repeat(64), signature_png: PNG },
        { signer_type: "EMPLOYER", signed_by_name: "Bc. Testovací Personalistka", signed_at: "2026-10-22T08:20:00Z",
          method: "ELECTRONIC_TABLET", evidence_sha256: "d".repeat(64), signature_png: PNG },
      ],
      createdAt: "2026-10-22T08:21:00Z",
    });
    expect(Buffer.from(original).equals(Buffer.from(originalCopy))).toBe(true); // vstup nezmeneny
    expect(r.originalPageCount).toBe(1);
    expect(r.totalPages).toBe(2);
    expect(r.sha256).not.toBe(sha);
    const { text } = await extractPdfText(r.bytes);
    expect(text).toContain("Jan Vzorový");
    const flat = normalizeForMatch(text);
    expect(flat).toContain(sha);
    expect(flat).toContain(normalizeForMatch("DŮKAZNÍ LIST"));
    expect(flat).toContain("d".repeat(64));
    expect(flat).toContain(normalizeForMatch("22. 10. 2026 10:15:00")); // Europe/Prague (CEST)
  });

  it("overenie: nezmenene strany a dokazna strana podla DB", async () => {
    const final = await makePdf(BODY);
    const finalSha = await sha256Hex(final);
    const sigs = [{ signer_type: "EMPLOYEE", signed_by_name: "Jan Vzorový", signed_at: "2026-10-22T08:15:00Z", method: "ELECTRONIC_TABLET",
      evidence_sha256: "c".repeat(64), signature_png: PNG }];
    const common = { fontBytes: font, boldFontBytes: bold, document: { id: "doc-1", title: "Pracovní smlouva", employeeName: "Jan Vzorový" }, createdAt: "2026-10-22T08:21:00Z" };
    const good = await buildSignedOriginal({ ...common, originalPdfBytes: final, expectedSha256: finalSha, signatures: sigs });
    const opts = { finalBytes: final, finalSha256: finalSha, extractPages: extractPdfPages, normalize: normalizeForMatch };
    expect(await verifySignedOriginal({ ...opts, signedBytes: good.bytes, signatures: sigs })).toEqual({ ok: true, problems: [] });

    // podvrhnuta strana: original postaveny z ineho PDF (ina mzda)
    const forged = await makePdf(BODY.map((l) => l.replace("32 500", "52 500")));
    const bad = await buildSignedOriginal({ ...common, originalPdfBytes: forged, expectedSha256: await sha256Hex(forged), signatures: sigs });
    const r1 = await verifySignedOriginal({ ...opts, signedBytes: bad.bytes, signatures: sigs });
    expect(r1.ok).toBe(false);
    expect(r1.problems).toEqual(expect.arrayContaining(["PAGE_1_TEXT_CHANGED", "EVIDENCE_FINAL_HASH_MISSING"]));

    // dokazna strana nesedi so zaznamom v DB (iny hash dokazov)
    const r2 = await verifySignedOriginal({ ...opts, signedBytes: good.bytes, signatures: [{ ...sigs[0], evidence_sha256: "e".repeat(64) }] });
    expect(r2.problems).toEqual(["EVIDENCE_SIGNER_1_HASH_MISSING"]);
  });

  it("nesediaci hash finalneho PDF zastavi vytvorenie", async () => {
    const original = await makePdf(BODY);
    await expect(buildSignedOriginal({
      originalPdfBytes: original, expectedSha256: "0".repeat(64), fontBytes: font, document: { id: "x", title: "x", employeeName: "x" },
      signatures: [{ signer_type: "EMPLOYEE", method: "ELECTRONIC_TABLET" }], createdAt: "2026-10-22T08:00:00Z",
    })).rejects.toThrow(/hash/);
  });
});
