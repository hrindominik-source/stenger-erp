import { describe, it, expect } from "vitest";
import { objednavkaProVydajku, porovnajVydajku, varovaniaPalety, problemyVydajky, jeSkenovanyZakaznik, jeSkenovanaObjednavka, prijemcaObjednavky, hlavickaObjednavky, kratkyNazov, prekazkaSkenuExpedice, paletyBezStopy } from "./pdaObjednavka.js";

const A = { id: "A", cisloArtikluSW: "62 99901", eanKarton: "4001234000015" };
const B = { id: "B", cisloArtikluSW: "62 99902", eanKarton: "4001234000022" };
const products = [A, B];
const GTIN_A = "04001234000015";
const GTIN_B = "04001234000022";
const dnesIso = "2026-11-09";
const pal = (gtin, extra = {}) => ({ gtin, bbd: "2027-05-28", mnozstvo: 16, ...extra });
const objednavka = objednavkaProVydajku({
  id: "O1", cislo_objednavky_dopravy: "0043/2509", zakaznik: "Test", pocet_paliet: "9",
  polozky: [{ popis: "Popcorn A", artikel: "6299901", palet: "2" }],
});

describe("povinny sken expedicie", () => {
  it("skenovani zakaznici", () => {
    for (const z of ["EDEKA Zentrale", "Picnic GmbH", "Globus SB"]) expect(jeSkenovanyZakaznik(z)).toBe(true);
    expect(jeSkenovanyZakaznik("Netto Marken-Discount AG & Co. KG")).toBe(false);
  });
  it("objednavka cez Stenger Waffeln s dodanim na Edeku", () => {
    const o = { zakaznik: "Stenger Waffeln GmbH", adresa_dodania_nazov: "EDEKA Zentrallager Süd", adresa_dodania: "" };
    expect(jeSkenovanaObjednavka(o)).toBe(true);
    expect(prijemcaObjednavky(o)).toBe("EDEKA Zentrallager Süd");
    expect(objednavkaProVydajku({ id: "X", ...o })).toMatchObject({ zakaznik: "EDEKA Zentrallager Süd", objednavatel: "Stenger Waffeln GmbH" });
    expect(jeSkenovanaObjednavka({ zakaznik: "Stenger Waffeln GmbH", adresa_dodania_nazov: "Kaufland" })).toBe(false);
    expect(prijemcaObjednavky({ zakaznik: "Rau" })).toBe("Rau");
  });
  it("bez vydajky, nedokoncena, chybaju, navyse, sedi", () => {
    expect(prekazkaSkenuExpedice({ vydajky: [], ocakavane: 2 })).toContain("povinný");
    expect(prekazkaSkenuExpedice({ vydajky: [{ stav: "rozpracovana", palet: 2 }], ocakavane: 2 })).toContain("není dokončená");
    expect(prekazkaSkenuExpedice({ vydajky: [{ stav: "dokoncena", palet: 31 }], ocakavane: 33 })).toContain("Chybí 2 pal.");
    expect(prekazkaSkenuExpedice({ vydajky: [{ stav: "dokoncena", palet: 34 }], ocakavane: 33 })).toContain("Navíc 1 pal.");
    expect(prekazkaSkenuExpedice({ vydajky: [{ stav: "dokoncena", palet: 20 }, { stav: "dokoncena", palet: 13 }], ocakavane: 33 })).toBe("");
    expect(prekazkaSkenuExpedice({ vydajky: [{ stav: "dokoncena", palet: 5 }], ocakavane: 0 })).toBe("");
  });
});

describe("paletyBezStopy", () => {
  it("staci sarza alebo BBD", () => {
    expect(paletyBezStopy([{ sarza: "L1" }, { bbd: "2027-01-01" }, { sarza: " ", bbd: null }])).toHaveLength(1);
  });
});

describe("hlavickaObjednavky", () => {
  it("mesto, nemecke LS a nas DL", () => {
    const o = { adresa_dodania: "Edeka Zentrallager, Industriestr. 5, 77656 Offenburg", nemecky_dodak_cislo: " 8123456 ", cislo_dodacieho_listu: "60738/1211" };
    expect(hlavickaObjednavky(o)).toEqual({ mesto: "OFFENBURG", lsDe: "8123456", dl: "60738/1211" });
    expect(objednavkaProVydajku({ id: "X", ...o })).toMatchObject({ mesto: "OFFENBURG", lsDe: "8123456", dl: "60738/1211" });
    expect(hlavickaObjednavky({})).toEqual({ mesto: "", lsDe: "", dl: "" });
  });
});

describe("kratkyNazov", () => {
  it("prve slovo prijemcu + mesto", () => {
    expect(kratkyNazov({ zakaznik: "Stenger Waffeln GmbH", adresa_dodania_nazov: "EDEKA SB Handels Stiftung & Co. KG", adresa_dodania: "Zentrallager, 86899 Landsberg am Lech" })).toBe("EDEKA LANDSBERG");
    expect(kratkyNazov({ zakaznik: "Globus Logistik 0582 GmbH & Co.KG", mesto: "BINGEN" })).toBe("GLOBUS BINGEN");
    expect(kratkyNazov({ zakaznik: "Globus", mesto: "BINGEN AM RHEIN" })).toBe("GLOBUS BINGEN");
    expect(kratkyNazov({ zakaznik: "Netto Marken-Discount AG", mesto: "" })).toBe("NETTO");
    expect(kratkyNazov(null)).toBe("");
  });
});

describe("objednavkaProVydajku", () => {
  it("pocet palet z poloziek, inak z objednavky", () => {
    expect(objednavka).toMatchObject({ id: "O1", cislo: "0043/2509", palet: 2 });
    expect(objednavkaProVydajku({ id: "O2", pocet_paliet: "33", polozky: [] }).palet).toBe(33);
  });
});

describe("porovnajVydajku", () => {
  it("pocita palety po polozkach a nasiel vyrobok mimo objednavky", () => {
    const v = porovnajVydajku(objednavka, [pal(GTIN_A), pal(GTIN_B)], products);
    expect(v).toMatchObject({ ocakavane: 2, naskenovane: 2, mimo: [GTIN_B] });
    expect(v.riadky).toEqual([{ popis: "Popcorn A", ocakavane: 2, naskenovane: 1 }]);
  });
  it("bez sparovania poloziek ostava len celkovy pocet", () => {
    const o = objednavkaProVydajku({ id: "O", polozky: [{ popis: "X", artikel: "NIC", palet: 1 }] });
    expect(porovnajVydajku(o, [pal(GTIN_B)], products)).toMatchObject({ mimo: [], riadky: [], naskenovane: 1 });
  });
});

describe("varovaniaPalety", () => {
  it("po DMT, neznamy vyrobok, mimo objednavky", () => {
    expect(varovaniaPalety(pal(GTIN_A, { bbd: "2026-11-08" }), { objednavka, products, dnesIso })).toEqual(["DMT palety už prošlo!"]);
    expect(varovaniaPalety(pal("09999999999999"), { products, dnesIso })).toEqual(["Výrobek není v Stenger ONE."]);
    expect(varovaniaPalety(pal(GTIN_B), { objednavka, products, dnesIso })).toEqual(["Výrobek není na této objednávce!"]);
    expect(varovaniaPalety(pal(GTIN_A), { objednavka, products, dnesIso })).toEqual([]);
  });
  it("bez nacitanych produktov nevarnuje o vyrobku", () => {
    expect(varovaniaPalety(pal("09999999999999"), { products: [], dnesIso })).toEqual([]);
  });
});

describe("problemyVydajky", () => {
  it("sedi = ziadny problem", () => {
    expect(problemyVydajky({ objednavka, palety: [pal(GTIN_A), pal(GTIN_A)], products, dnesIso })).toEqual([]);
  });
  it("rozdiel v pocte a chybajuce udaje", () => {
    const r = problemyVydajky({ objednavka, palety: [pal(GTIN_A, { mnozstvo: null, bbd: null })], products, dnesIso });
    expect(r).toEqual(["Podle objednávky má jet 2 palet, naskenováno 1.", "Popcorn A: má jet 2 palet, naskenováno 1.", "Bez množství: 1 palet."]);
  });
  it("bez objednavky kontroluje len palety", () => {
    expect(problemyVydajky({ objednavka: null, palety: [pal(GTIN_A)], products, dnesIso })).toEqual([]);
  });
});
