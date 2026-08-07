import { describe, it, expect } from "vitest";
import { mergeSupplierCatalog } from "./supplierCatalog.js";

describe("mergeSupplierCatalog", () => {
  it("prida nove polozky ktore este nie su v katalogu", () => {
    const { tovary, added, updated } = mergeSupplierCatalog([], [
      { artikel: "123", popis: "Krabica A", balenie: "S2300BB, 700 ks/paleta" },
    ]);
    expect(added).toBe(1);
    expect(updated).toBe(0);
    expect(tovary).toEqual([{ popis: "Krabica A", artikel: "123", balenie: "S2300BB, 700 ks/paleta" }]);
  });

  it("aktualizuje popis a balenie existujucej polozky podla artiklu, ale neduplikuje ju", () => {
    const existing = [{ popis: "Stary popis", artikel: "123", balenie: "stare balenie" }];
    const { tovary, added, updated } = mergeSupplierCatalog(existing, [
      { artikel: "123", popis: "Novy popis", balenie: "S2300BB, 700 ks/paleta" },
    ]);
    expect(added).toBe(0);
    expect(updated).toBe(1);
    expect(tovary).toEqual([{ popis: "Novy popis", artikel: "123", balenie: "S2300BB, 700 ks/paleta" }]);
  });

  it("normalizuje legacy retazcove polozky namiesto ich rozbitia na znaky", () => {
    const existing = ["Fólie AG 7 076mm x 300m"];
    const { tovary, added } = mergeSupplierCatalog(existing, [
      { artikel: "1100000022039", popis: "AG 7 076mm x 300m OUT", balenie: "MJ: ks" },
    ]);
    expect(added).toBe(1);
    expect(tovary).toEqual([
      { popis: "Fólie AG 7 076mm x 300m", artikel: "", balenie: "" },
      { popis: "AG 7 076mm x 300m OUT", artikel: "1100000022039", balenie: "MJ: ks" },
    ]);
  });

  it("necha nedotknute polozky ktore v importe nie su", () => {
    const existing = [{ popis: "Ina polozka", artikel: "999", balenie: "" }];
    const { tovary } = mergeSupplierCatalog(existing, [
      { artikel: "123", popis: "Nova", balenie: "" },
    ]);
    expect(tovary).toEqual([
      { popis: "Ina polozka", artikel: "999", balenie: "" },
      { popis: "Nova", artikel: "123", balenie: "" },
    ]);
  });
});
