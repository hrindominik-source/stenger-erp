import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { poaSignatoryFor, poaHeader, appendPoaCopy } from "../../../supabase/functions/_shared/hr/poaAttach.js";

const fontBytes = fs.readFileSync(path.resolve("public/hr/DejaVuSans.ttf"));
const sig = (o) => ({ id: "s1", full_name: "Bc. Testovací Zástupkyně", valid_from: "2025-07-01", valid_to: "2030-07-01", poa_copy_path: "plne-moci/s1-kopie-x.pdf", ...o });

describe("kopie plné moci k dokumentu", () => {
  it("vybere osobu podle zástupce v dokumentu, platnou a s kopií", () => {
    const snap = { zastupce: "Bc. Testovací Zástupkyně" };
    expect(poaSignatoryFor([sig()], snap, "2026-10-30")?.id).toBe("s1");
    expect(poaSignatoryFor([sig()], { zastupce: "bc. testovaci  zastupkyne" }, "2026-10-30")?.id).toBe("s1");
    expect(poaSignatoryFor([sig({ poa_copy_path: null })], snap, "2026-10-30")).toBeNull();
    expect(poaSignatoryFor([sig()], snap, "2030-07-02")).toBeNull();
    expect(poaSignatoryFor([sig()], { zastupce: "Jiná Osoba" }, "2026-10-30")).toBeNull();
    expect(poaSignatoryFor([sig()], {}, "2026-10-30")).toBeNull();
    expect(poaSignatoryFor([sig({ id: "old", valid_from: "2020-01-01" }), sig({ id: "new" })], snap, "2026-10-30").id).toBe("new");
  });

  it("připojí PDF i obrázek jako poslední strany", async () => {
    const fin = await PDFDocument.create(); fin.addPage(); fin.addPage();
    const finBytes = await fin.save();
    const copy = await PDFDocument.create(); copy.addPage([595, 842]);
    const r = await appendPoaCopy(finBytes, await copy.save(), "application/pdf", { fontBytes, header: poaHeader(sig()) });
    expect(r.pagesAdded).toBe(1);
    expect((await PDFDocument.load(r.bytes)).getPageCount()).toBe(3);
    const png = fs.readFileSync(path.resolve("public/stenger-logo.png"));
    const r2 = await appendPoaCopy(finBytes, png, "image/png", { fontBytes, header: poaHeader(sig()) });
    expect((await PDFDocument.load(r2.bytes)).getPageCount()).toBe(3);
  });
});
