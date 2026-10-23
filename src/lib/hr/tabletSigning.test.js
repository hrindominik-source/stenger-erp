import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { inspectPades, employerSignatory, allPagesViewed, validSignatureImage, trainingIntentDetail } from "../../../supabase/functions/_shared/hr/tabletSigning.js";
import { signaturePng } from "./__fixtures__/signaturePng.js";

const enc = (s) => new TextEncoder().encode(s);
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

// Simulacia PAdES prirastkovej aktualizacie (bez skutocnej kryptografie -
// overuje sa len struktura a vazba na finalne PDF).
function fakePades(finalBytes, { subFilter = "ETSI.CAdES.detached", contents = "3082ABCD", cover = true } = {}) {
  const head = enc(`\n9 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /${subFilter} /ByteRange [0 XXXXXXXXXX YYYYYYYYYY ZZZZZZZZZZ] /Contents `);
  const sig = enc(`<${contents}>`);
  const end = enc(" >>\nendobj\n%%EOF\n");
  const b = finalBytes.length + head.length;
  const c = b + sig.length;
  const total = c + end.length;
  const pad = (n) => String(n).padStart(10, " ");
  const h = new TextDecoder().decode(head).replace("XXXXXXXXXX", pad(b)).replace("YYYYYYYYYY", pad(c)).replace("ZZZZZZZZZZ", pad(cover ? total - c : total - c - 1));
  return concat(finalBytes, enc(h), sig, end);
}

describe("PAdES (uznavany el. podpis) - struktura a vazba na finalne PDF", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const finalBytes = await pdf.save();
  it("platna prirastkova aktualizacia finalneho PDF", () => {
    expect(inspectPades(fakePades(finalBytes), finalBytes)).toMatchObject({ ok: true, subFilter: "ETSI.CAdES.detached", certificateValidation: "NOT_PERFORMED" });
  });
  it("PDF inej verzie odmietnute", () => {
    const other = finalBytes.slice(); other[20] ^= 1;
    expect(inspectPades(fakePades(other), finalBytes).reason).toMatch(/nevychází z finálního PDF/);
  });
  it("bez podpisu, zly SubFilter, neuplny ByteRange, prazdny podpis", () => {
    expect(inspectPades(concat(finalBytes, enc("\n%%EOF\n")), finalBytes).reason).toMatch(/chybí elektronický podpis/);
    expect(inspectPades(fakePades(finalBytes, { subFilter: "x.custom" }), finalBytes).reason).toMatch(/SubFilter/);
    expect(inspectPades(fakePades(finalBytes, { cover: false }), finalBytes).reason).toMatch(/nepokrývá/);
    expect(inspectPades(fakePades(finalBytes, { contents: "0000" }), finalBytes).reason).toMatch(/prázdný/);
  });
});

describe("podpis za zamestnavatela (plna moc)", () => {
  it("len osoba s plnou mocou; ak je v dokumente uvedena, musi to byt ona", () => {
    expect(employerSignatory("Dominik Hrin", {})).toEqual({ ok: true, name: "JUDr. Dominik Hríň" });
    expect(employerSignatory("Test Personalista", {}).ok).toBe(false);
    expect(employerSignatory("Dominik Hrin", { zastupce: "Bc. Radka Buchová" }).reason).toMatch(/Radka Buchová/);
    expect(employerSignatory("Radka Buchova", { zastupce: "Bc. Radka Buchová" }).ok).toBe(true);
  });
});

describe("prehliadnutie a obrazok podpisu", () => {
  it("vsetky strany", () => {
    expect(allPagesViewed(3, [1, 2, 3])).toBe(true);
    expect(allPagesViewed(3, [1, 3])).toBe(false);
    expect(allPagesViewed(0, [])).toBe(false);
  });
  it("PNG a minimalny pocet bodov", () => {
    const png = signaturePng(1);
    const strokes = [Array.from({ length: 12 }, (_, i) => [i, i])];
    expect(validSignatureImage(png, strokes)).toBe(true);
    expect(validSignatureImage(png, [[[1, 1]]])).toBe(false);
    expect(validSignatureImage(enc("not a png at all, definitely not"), strokes)).toBe(false);
  });
  it("udaje skolenia v prejave vule", () => {
    expect(trainingIntentDetail({ scope: "Vstupní BOZP", trained_at: "2026-10-02", trainer_name: "Ing. X", knowledge_checked_at: "2026-10-02", knowledge_check_result: "PASSED" }))
      .toBe("Školení: Vstupní BOZP, 02.10.2026, školitel Ing. X. Ověření znalostí: 02.10.2026, úspěšné.");
  });
});
