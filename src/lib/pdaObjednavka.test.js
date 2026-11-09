import { describe, it, expect } from "vitest";
import { objednavkaProVydajku, porovnajVydajku, varovaniaPalety, problemyVydajky } from "./pdaObjednavka.js";

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
    expect(r).toEqual(["Podle objednávky má jet 2 palet, naskenováno 1.", "Popcorn A: má jet 2 palet, naskenováno 1.", "Bez množství: 1 palet.", "Bez DMT: 1 palet."]);
  });
  it("bez objednavky kontroluje len palety", () => {
    expect(problemyVydajky({ objednavka: null, palety: [pal(GTIN_A)], products, dnesIso })).toEqual([]);
  });
});
