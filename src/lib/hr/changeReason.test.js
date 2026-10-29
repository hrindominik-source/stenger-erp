import { describe, it, expect } from "vitest";
import { reasonRequiredChanges, REASON_REQUIRED_KEYS } from "./changeReason.js";

describe("povinny dovod zmeny v Karte", () => {
  it("vybrane polia vyzaduju dovod", () => {
    const ch = reasonRequiredChanges({ mzda_castka: "30000", bank_account: "1/0100", phone: "1" }, { mzda_castka: "32000", bank_account: "1/0100", phone: "2" });
    expect(ch.map((c) => c.key)).toEqual(["mzda_castka"]);
    expect(ch[0].label).toBe("Výše základní mzdy");
  });
  it("ostatne polia bez dovodu", () => {
    expect(reasonRequiredChanges({ phone: "1", perm_obec: "A" }, { phone: "2", perm_obec: "B" })).toEqual([]);
  });
  it("pokryva mzdu, poziciu, zmluvu, nastup, RC, ucet a ZP", () => {
    for (const k of ["mzda_platnost_od", "pozice_kategorie", "employment_type", "fixed_term_end_date", "start_date", "termination_date", "birth_number", "bank_account", "health_insurance_company"]) {
      expect(REASON_REQUIRED_KEYS).toContain(k);
    }
    expect(reasonRequiredChanges({ start_date: "2026-01-01" }, { start_date: "2026-02-01" })).toHaveLength(1);
    expect(reasonRequiredChanges({ birth_number: null }, { birth_number: "" })).toEqual([]);
  });
});
