import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { inspectPades, employerSignatory, allPagesViewed, validSignatureImage, trainingIntentDetail, validPairingCode, validDeviceId, CERTIFICATE_STATUS_LABELS } from "../../../supabase/functions/_shared/hr/tabletSigning.js";
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

describe("podpis za zamestnavatela (plna moc z DB)", () => {
  const sig = { id: "s1", full_name: "Mgr. Jana Zkušební", valid_from: "2026-01-01", valid_to: null };
  it("len platna osoba s plnou mocou; ak je v dokumente uvedena, musi to byt ona", () => {
    expect(employerSignatory(sig, {}, "2026-10-23")).toEqual({ ok: true, name: "Mgr. Jana Zkušební", signatoryId: "s1" });
    expect(employerSignatory(null, {}, "2026-10-23").ok).toBe(false);
    expect(employerSignatory({ ...sig, valid_to: "2026-06-30" }, {}, "2026-10-23").reason).toMatch(/platnou plnou moc/);
    expect(employerSignatory({ ...sig, valid_from: "2026-11-01" }, {}, "2026-10-23").ok).toBe(false);
    expect(employerSignatory(sig, { zastupce: "Ing. Petr Vzorový" }, "2026-10-23").reason).toMatch(/Petr Vzorový/);
    expect(employerSignatory(sig, { zastupce: "Mgr. Jana  Zkusebni" }, "2026-10-23").ok).toBe(true);
  });
});

describe("osobna pritomnost a certifikat", () => {
  it("kod z obrazovky HR a identifikator zariadenia", () => {
    expect(validPairingCode("012345")).toBe(true);
    expect(validPairingCode("12345")).toBe(false);
    expect(validPairingCode("12345a")).toBe(false);
    expect(validDeviceId("tablet-0123456789abcdef")).toBe(true);
    expect(validDeviceId("kratke")).toBe(false);
    expect(validDeviceId("x'; drop table")).toBe(false);
  });
  it("uznavany podpis bez overenia = certifikat neovereny", () => {
    expect(CERTIFICATE_STATUS_LABELS.NOT_VERIFIED).toBe("podpis přítomen, certifikát neověřen");
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
