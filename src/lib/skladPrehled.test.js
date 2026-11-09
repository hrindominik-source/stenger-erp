import { describe, it, expect } from "vitest";
import { parseMnozstvo, prijmyNaVyriesenie, rozdielyObjednavok, porovnanieFaktury, expedicieNaPotvrdenie, cakaNaPrijem, jeZPredoslehoDna } from "./skladPrehled.js";

const prijem = (extra = {}) => ({ id: "R", material: "Cukr", mnozstvo: "800 kg", mnozstvoCislo: 800, mnozstvoJednotka: "kg", stavPrevzatia: "V poriadku", kontroly: [], ...extra });

describe("parseMnozstvo", () => {
  it("cislo a jednotka", () => {
    expect(parseMnozstvo("840 kg")).toEqual({ cislo: 840, jednotka: "kg" });
    expect(parseMnozstvo("1 200,5 KG")).toEqual({ cislo: 1200.5, jednotka: "kg" });
    expect(parseMnozstvo("")).toBeNull();
  });
});

describe("prijmyNaVyriesenie", () => {
  it("kontroly alebo zly stav, vyriesene nie", () => {
    const r = prijmyNaVyriesenie([
      prijem({ id: "ok" }),
      prijem({ id: "k", kontroly: ["Chybí šarže"], createdAt: "2026-11-09T08:00:00Z" }),
      prijem({ id: "s", stavPrevzatia: "Poskodene", createdAt: "2026-11-10T08:00:00Z" }),
      prijem({ id: "v", kontroly: ["X"], vyriesene: { kto: "Office" } }),
    ]);
    expect(r.map((x) => x.id)).toEqual(["s", "k"]);
    expect(r[0].dovody).toEqual(["Stav převzetí: Poskodene"]);
  });
});

describe("rozdielyObjednavok", () => {
  const o = { id: "O1", mnozstvo: "840 kg", polozky: [] };
  it("sucet prijmov vs objednane", () => {
    expect(rozdielyObjednavok([o], [prijem({ materialObjednavkaId: "O1" })])).toMatchObject([{ objednane: 840, prijate: 800, rozdiel: -40, jednotka: "kg" }]);
    expect(rozdielyObjednavok([o], [prijem({ materialObjednavkaId: "O1" }), prijem({ materialObjednavkaId: "O1", mnozstvoCislo: 40 })])).toEqual([]);
  });
  it("ina jednotka, viac poloziek, bez prijmu, vyriesene = nic", () => {
    expect(rozdielyObjednavok([o], [prijem({ materialObjednavkaId: "O1", mnozstvoJednotka: "ks" })])).toEqual([]);
    expect(rozdielyObjednavok([{ ...o, polozky: [{}, {}] }], [prijem({ materialObjednavkaId: "O1" })])).toEqual([]);
    expect(rozdielyObjednavok([o], [])).toEqual([]);
    expect(rozdielyObjednavok([{ ...o, rozdielVyrieseny: { kto: "x" } }], [prijem({ materialObjednavkaId: "O1" })])).toEqual([]);
  });
});

describe("porovnanieFaktury", () => {
  const orders = [{ id: "O1", mnozstvo: "840 kg" }];
  it("faktura vs prijate a objednane", () => {
    expect(porovnanieFaktury({ mnozstvoCislo: 840, mnozstvoJednotka: "kg" }, prijem({ materialObjednavkaId: "O1" }), orders)).toEqual({
      riadky: [{ co: "Přijato", text: "800 kg" }, { co: "Objednáno", text: "840 kg" }],
      nesedi: true,
    });
    expect(porovnanieFaktury({ mnozstvoCislo: "800", mnozstvoJednotka: "KG" }, prijem(), orders).nesedi).toBe(false);
    expect(porovnanieFaktury({ mnozstvoCislo: 5, mnozstvoJednotka: "t" }, prijem(), orders).nesedi).toBe(false);
    expect(porovnanieFaktury({}, null, orders)).toBeNull();
  });
});

describe("expedicie a cakajuce objednavky", () => {
  it("nalozene alebo naskenovane, nie expedovane ani storno", () => {
    const orders = [{ id: "A" }, { id: "B" }, { id: "C", stavExpedicie: "Expedovana" }, { id: "D", stornovana: true }, { id: "E" }];
    const dispatches = [{ orderId: "A", pocetPaliet: 3 }, { orderId: "A", typ: "kontrola" }, { orderId: "C", pocetPaliet: 1 }, { orderId: "D", pocetPaliet: 1 }];
    const vydajky = [{ stav: "dokoncena", data: { objednavka: { id: "B" } } }, { stav: "rozpracovana", data: { objednavka: { id: "E" } } }];
    expect(expedicieNaPotvrdenie(orders, dispatches, vydajky)).toEqual([
      { order: { id: "A" }, nalozenePalet: 3, vydajek: 0 },
      { order: { id: "B" }, nalozenePalet: 0, vydajek: 1 },
    ]);
  });
  it("objednavky bez prijmu", () => {
    expect(cakaNaPrijem([{ id: "O1" }, { id: "O2" }, { id: "O3", stornovana: true }], [prijem({ materialObjednavkaId: "O1" })]).map((o) => o.id)).toEqual(["O2"]);
  });
  it("predosly den", () => {
    const dnes = new Date(2026, 10, 10, 9, 0);
    expect(jeZPredoslehoDna(new Date(2026, 10, 9, 23, 0).toISOString(), dnes)).toBe(true);
    expect(jeZPredoslehoDna(new Date(2026, 10, 10, 1, 0).toISOString(), dnes)).toBe(false);
    expect(jeZPredoslehoDna("", dnes)).toBe(false);
  });
});
