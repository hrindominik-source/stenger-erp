import { describe, it, expect } from "vitest";
import { jeVratnaPaleta, volbyPaliet, rozdelStav, prijmyPaliet, vlastnikPalety } from "./palety.js";
import { computeStockLevels } from "./inventory.js";

describe("vratne palety", () => {
  it("rozozna vratnu paletu podla nazvu", () => {
    expect(jeVratnaPaleta("Vratná paleta CHEP mini")).toBe(true);
    expect(jeVratnaPaleta(" vratná paleta LPR EUR ")).toBe(true);
    expect(jeVratnaPaleta("Paleta EUR tmavá (120x80cm)")).toBe(false);
    expect(vlastnikPalety("Vratná paleta LPR mini")).toBe("LPR");
  });

  it("volby: nase palety z katalogu, vratne zvlast", () => {
    const v = volbyPaliet(["Kartony", "Paleta EUR tmavá (120x80cm)", "Paleta EUR tmavá (120x80cm)", "Vratná paleta CHEP EUR", "Paletizační fólie"]);
    expect(v.nase).toEqual(["Paleta EUR tmavá (120x80cm)"]);
    expect(v.vratne).toContain("Vratná paleta CHEP mini");
  });

  it("prijmy: scita rovnaky typ, vynecha prazdne, vratne bez ceny", () => {
    const z = { dodavatel: "Tereos TTD, a.s.", datumPrijatia: "07.11.2026", cenaJednotkovaCzk: 5 };
    const r = prijmyPaliet(
      [
        { material: "Vratná paleta CHEP mini", pocet: "10" },
        { material: "Vratná paleta CHEP mini", pocet: "2" },
        { material: "Paleta EUR tmavá (120x80cm)", pocet: "3,0" },
        { material: "", pocet: "5" },
        { material: "Vratná paleta LPR mini", pocet: "0" },
      ],
      { dodavatel: z.dodavatel, datumPrijatia: z.datumPrijatia }
    );
    expect(r).toHaveLength(2);
    const chep = r.find((x) => x.material === "Vratná paleta CHEP mini");
    expect(chep).toMatchObject({ mnozstvo: "12 ks", mnozstvoCislo: 12, mnozstvoJednotka: "ks", vratnaPaleta: true, vlastnikPalety: "CHEP", dodavatel: "Tereos TTD, a.s." });
    expect(chep.cenaJednotkovaCzk).toBeUndefined();
    expect(r.find((x) => x.material.startsWith("Paleta")).vratnaPaleta).toBeUndefined();
  });

  it("stav: prijem minus vratenie, rozdelene od materialu", () => {
    const prijmy = prijmyPaliet([{ material: "Vratná paleta CHEP mini", pocet: "12" }], {});
    const vratenie = { material: "Vratná paleta CHEP mini", mnozstvo: "8 ks", mnozstvoCislo: 8, mnozstvoJednotka: "ks" };
    const stock = computeStockLevels([...prijmy, { material: "Kartony", mnozstvoCislo: 5, mnozstvoJednotka: "ks" }], [vratenie]);
    const { materialy, vratne } = rozdelStav(stock);
    expect(materialy.map((r) => r.material)).toEqual(["Kartony"]);
    expect(vratne).toHaveLength(1);
    expect(vratne[0].stav).toBe(4);
  });
});

describe("vratne palety v inventure", () => {
  it("su na konci zoznamu a nehlasia sa ako bez ceny", async () => {
    const { polozkyNaPocitanie, vyhodnotInventuru } = await import("./inventura.js");
    const receipts = [
      { material: "Vratná paleta CHEP mini", mnozstvoCislo: 10, mnozstvoJednotka: "ks", datumPrijatia: "01.11.2026", vratnaPaleta: true },
      { material: "Kartony", mnozstvoCislo: 5, mnozstvoJednotka: "ks", datumPrijatia: "01.11.2026", cenaJednotkovaCzk: 10 },
      { material: "Zz fólie", mnozstvoCislo: 2, mnozstvoJednotka: "kg", datumPrijatia: "01.11.2026" },
    ];
    expect(polozkyNaPocitanie(receipts, [], "07.11.2026").map((p) => p.material)).toEqual(["Kartony", "Zz fólie", "Vratná paleta CHEP mini"]);
    const v = vyhodnotInventuru(
      { datum: "07.11.2026", polozky: [{ material: "Vratná paleta CHEP mini", unit: "ks", napocitane: "9" }, { material: "Zz fólie", unit: "kg", napocitane: "2" }] },
      receipts,
      []
    );
    expect(v.bezCeny.map((r) => r.material)).toEqual(["Zz fólie"]);
    expect(v.rows[v.rows.length - 1]).toMatchObject({ material: "Vratná paleta CHEP mini", vratna: true, rozdil: -1 });
  });

  it("neoceneny prijem vratnej palety necaka na fakturu", () => {
    const [row] = computeStockLevels([{ material: "Vratná paleta LPR EUR", mnozstvoCislo: 3, mnozstvoJednotka: "ks" }], []);
    expect(row.neocenenePrijmy).toBe(0);
    expect(row.vratna).toBe(true);
  });
});
