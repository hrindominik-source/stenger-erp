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

describe("prijate od dodavatelov", () => {
  it("rozpis len pri 2+ dodavateloch, zoradeny podla mnozstva", async () => {
    const { prijateOdText } = await import("./inventory.js");
    const m = "Paleta EUR tmavá (použitá)";
    const stock = computeStockLevels(
      [
        { material: m, dodavatel: "Flexipal a.s.", mnozstvoCislo: 300, mnozstvoJednotka: "ks" },
        { material: m, dodavatel: "Paletten service logistik s.r.o.", mnozstvoCislo: 561, mnozstvoJednotka: "ks" },
        { material: m, dodavatel: "Flexipal a.s.", mnozstvoCislo: 20, mnozstvoJednotka: "ks" },
        { material: "Kartony", dodavatel: "Smurfit", mnozstvoCislo: 5, mnozstvoJednotka: "ks" },
      ],
      [{ material: m, mnozstvoCislo: 100, mnozstvoJednotka: "ks" }]
    );
    const pal = stock.find((r) => r.material === m);
    expect(pal.stav).toBe(781);
    expect(prijateOdText(pal)).toBe("Paletten service logistik s.r.o. 561 · Flexipal a.s. 320");
    expect(prijateOdText(stock.find((r) => r.material === "Kartony"))).toBe("");
  });
});

describe("palety pri expedicii a paletove konto", () => {
  it("vydaj pri expedicii, vratenie, vyrovnanie a zostatok", async () => {
    const { vydajePalietExpedice, prijmyPalietZExpedice, paletoveKonto, PALETA_EXPEDICE, EXPEDICE_DOVOD } = await import("./palety.js");
    const vydaje = vydajePalietExpedice(
      [{ material: PALETA_EXPEDICE, pocet: "33" }, { material: "", pocet: "2" }, { material: PALETA_EXPEDICE, pocet: "0" }],
      { zakaznik: "Netto", orderId: "o1" }
    );
    expect(vydaje).toHaveLength(1);
    expect(vydaje[0]).toMatchObject({ material: PALETA_EXPEDICE, mnozstvoCislo: 33, dovod: EXPEDICE_DOVOD, paletyExpedice: true, zakaznik: "Netto" });
    const vratene = prijmyPalietZExpedice([{ material: PALETA_EXPEDICE, pocet: "20" }], { zakaznik: "netto ", dodavatel: "Dorys" });
    expect(vratene[0].paletyZExpedice).toBe(true);
    expect(vratene[0].paletySDodavkou).toBeUndefined();
    const konto = paletoveKonto(
      [...vydaje, { material: PALETA_EXPEDICE, mnozstvoCislo: 10, paletyExpedice: true, zakaznik: "Edeka" }, { material: "x", mnozstvoCislo: 5, zakaznik: "Netto" }],
      vratene,
      [{ nazov: "Netto", paletyVyrovnani: [{ typ: "vyfakturovano", material: PALETA_EXPEDICE, pocet: 3 }] }]
    );
    expect(konto.map((z) => [z.zakaznik, z.zbyva])).toEqual([["Edeka", 10], ["Netto", 10]]);
    expect(konto[1].palety[0]).toMatchObject({ odeslo: 33, vraceno: 20, vyfakturovano: 3, odepsano: 0, zbyva: 10 });
    // stav skladu: vydaj a vratenie sa prejavi v zasobach
    const stock = computeStockLevels(vratene, vydaje);
    expect(stock.find((r) => r.material === PALETA_EXPEDICE).stav).toBe(-13);
  });
});
