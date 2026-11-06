import { describe, it, expect } from "vitest";
import { riadkyZDodaku, priradPalety } from "./prijemPalety.js";

const dodak = {
  polozky: [
    { nazov: "JET red", materialNas: "Kýble red", mnozstvo: 16200, jednotka: "ks", sarza: "A1, A2", dmt: "", palety: [{ sscc: "86773610" }] },
    { nazov: "DET", materialNas: "", mnozstvo: 16200, jednotka: "Stk", sarza: "D1", dmt: "", palety: [] },
    { nazov: "Cukr", materialNas: "Cukr", mnozstvo: 840.5, jednotka: "kg", sarza: "C1", dmt: "16.10.2029", palety: [] },
  ],
};

describe("riadkyZDodaku", () => {
  it("riadok na polozku, jednotka len povolena, ciarka v mnozstve", () => {
    const r = riadkyZDodaku(dodak, ["ks", "kg"]);
    expect(r).toHaveLength(3);
    expect(r[0]).toMatchObject({ key: 0, zahrnut: true, material: "Kýble red", mnozstvoNum: "16200", mnozstvoUnit: "ks", sarza: "A1, A2", stavPrevzatia: "V poriadku" });
    expect(r[1]).toMatchObject({ material: "", mnozstvoUnit: "ks" });
    expect(r[2]).toMatchObject({ mnozstvoNum: "840,5", mnozstvoUnit: "kg", dmt: "16.10.2029" });
    expect(riadkyZDodaku(null)).toEqual([]);
  });
});

describe("priradPalety", () => {
  const riadky = riadkyZDodaku(dodak, ["ks", "kg"]);
  it("podla karty, cisla palety (NVE), sarze; zvysok nepriradeny", () => {
    const skeny = [
      { sscc: "340000000867736101", gtin: "", sarza: "X" },
      { sscc: "", gtin: "12345678901231", sarza: "" },
      { sscc: "", gtin: "", sarza: "d1" },
      { sscc: "", gtin: "", sarza: "Z9" },
    ];
    const { podlaRiadku, nepriradene } = priradPalety(skeny, riadky, [{ gtin: "12345678901231", material: "cukr" }]);
    expect(podlaRiadku.get(0)).toEqual([skeny[0]]);
    expect(podlaRiadku.get(2)).toEqual([skeny[1]]);
    expect(podlaRiadku.get(1)).toEqual([skeny[2]]);
    expect(nepriradene).toEqual([skeny[3]]);
  });
  it("nezahrnute riadky sa preskocia, pri jednom zahrnutom ide vsetko k nemu", () => {
    const len1 = riadky.map((r) => ({ ...r, zahrnut: r.key === 2 }));
    const { podlaRiadku, nepriradene } = priradPalety([{ sscc: "", gtin: "", sarza: "Q" }], len1, []);
    expect(podlaRiadku.has(0)).toBe(false);
    expect(podlaRiadku.get(2)).toHaveLength(1);
    expect(nepriradene).toEqual([]);
  });
});
