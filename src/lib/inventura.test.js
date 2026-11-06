import { describe, it, expect } from "vitest";
import { stavKDatu, polozkyNaPocitanie, vyhodnotInventuru, inventuraOpravy, parseQtyInput, INVENTURA_DOVOD, INVENTURA_PREBYTEK } from "./inventura.js";
import { computeStockLevels } from "./inventory.js";

const rc = (datumPrijatia, material, mnozstvoCislo, mnozstvoJednotka, cenaJednotkovaCzk) => ({ datumPrijatia, material, mnozstvoCislo, mnozstvoJednotka, ...(cenaJednotkovaCzk !== undefined ? { cenaJednotkovaCzk } : {}) });
const is = (datum, material, mnozstvoCislo, mnozstvoJednotka) => ({ datum, material, mnozstvoCislo, mnozstvoJednotka });

const receipts = [
  rc("01.10.2026", "Kukuřice", 1000, "kg", 10),
  rc("15.10.2026", "Kukuřice", 1000, "kg", 12),
  rc("02.11.2026", "Kukuřice", 500, "kg", 20),
  rc("01.10.2026", "Fólie", 20, "ks"),
  rc("01.10.2026", "Krabice", 100, "ks", 5),
];
const issues = [
  is("20.10.2026", "Kukuřice", 400, "kg"),
  is("03.11.2026", "Kukuřice", 100, "kg"),
  is("20.10.2026", "Krabice", 100, "ks"),
];

describe("inventura", () => {
  it("stav k datu bere jen pohyby do data vcetne", () => {
    const k = stavKDatu(receipts, issues, "31.10.2026").find((r) => r.material === "Kukuřice");
    expect(k.stav).toBe(1600);
    expect(k.priemernaCena).toBe(11);
  });

  it("seznam k pocitani je naslepo a bez nulovych polozek", () => {
    const p = polozkyNaPocitanie(receipts, issues, "31.10.2026");
    expect(p.map((x) => x.material)).toEqual(["Fólie", "Kukuřice"]);
    expect(p.every((x) => x.napocitane === "")).toBe(true);
  });

  it("vyhodnoti rozdily, oceni a oznaci nespocitane a bez ceny", () => {
    const inv = { datum: "31.10.2026", polozky: [
      { material: "kukuřice", unit: "KG", napocitane: "1 550,5" },
      { material: "Fólie", unit: "ks", napocitane: "20" },
      { material: "Sůl", unit: "kg", napocitane: "3" },
    ] };
    const v = vyhodnotInventuru(inv, receipts, issues);
    const k = v.rows.find((r) => r.material === "kukuřice");
    expect(k).toMatchObject({ evidovane: 1600, napocitane: 1550.5, rozdil: -49.5, hodnotaSkutecna: 17055.5, hodnotaRozdilu: -544.5 });
    expect(v.rows.find((r) => r.material === "Sůl")).toMatchObject({ evidovane: 0, rozdil: 3, hodnotaSkutecna: null });
    expect(v.bezCeny.map((r) => r.material)).toEqual(["Fólie", "Sůl"]);
    expect(v.nespocitane).toEqual([]);
    expect(v.hodnotaSkutecna).toBe(17055.5);
    expect(v.hodnotaEvidovana).toBe(17600);
  });

  it("evidovana polozka chybejici v seznamu je nespocitana, ne nula", () => {
    const v = vyhodnotInventuru({ datum: "31.10.2026", polozky: [{ material: "Kukuřice", unit: "kg", napocitane: "1600" }] }, receipts, issues);
    expect(v.nespocitane.map((r) => r.material)).toEqual(["Fólie"]);
    expect(inventuraOpravy(v, { inventuraId: "i1", datum: "31.10.2026", cas: "10:00", kdo: "X" })).toEqual({ issues: [], receipts: [] });
  });

  it("opravy srovnaji stav k datu na napocitane mnozstvi", () => {
    const inv = { datum: "31.10.2026", polozky: [
      { material: "Kukuřice", unit: "kg", napocitane: "1550" },
      { material: "Fólie", unit: "ks", napocitane: "25" },
    ] };
    const v = vyhodnotInventuru(inv, receipts, issues);
    const o = inventuraOpravy(v, { inventuraId: "i1", datum: "31.10.2026", cas: "10:00", kdo: "Skladník" });
    expect(o.issues).toHaveLength(1);
    expect(o.issues[0]).toMatchObject({ material: "Kukuřice", mnozstvoCislo: 50, dovod: INVENTURA_DOVOD, inventuraId: "i1" });
    expect(o.receipts[0]).toMatchObject({ material: "Fólie", mnozstvoCislo: 5, dodavatel: INVENTURA_PREBYTEK });
    expect(o.receipts[0].cenaJednotkovaCzk).toBeUndefined();
    const po = stavKDatu([...receipts, ...o.receipts], [...issues, ...o.issues], "31.10.2026");
    expect(po.find((r) => r.material === "Kukuřice").stav).toBe(1550);
    expect(po.find((r) => r.material === "Kukuřice").priemernaCena).toBe(11);
    expect(po.find((r) => r.material === "Fólie").stav).toBe(25);
    // pohyby po datu inventury zostavaju
    expect(computeStockLevels([...receipts, ...o.receipts], [...issues, ...o.issues]).find((r) => r.material === "Kukuřice").stav).toBe(1950);
  });

  it("prebytek s cenou neposune prumernou cenu", () => {
    const v = vyhodnotInventuru({ datum: "31.10.2026", polozky: [{ material: "Kukuřice", unit: "kg", napocitane: "1700" }] }, receipts, issues);
    const o = inventuraOpravy(v, { inventuraId: "i2", datum: "31.10.2026", cas: "10:00", kdo: "X" });
    expect(o.receipts[0].cenaJednotkovaCzk).toBe(11);
    expect(stavKDatu([...receipts, ...o.receipts], issues, "31.10.2026").find((r) => r.material === "Kukuřice").priemernaCena).toBe(11);
  });

  it("cte cislo s carkou a mezerami, prazdne je null", () => {
    expect([parseQtyInput("1 200,5"), parseQtyInput(""), parseQtyInput("x"), parseQtyInput(0)]).toEqual([1200.5, null, null, 0]);
  });
});
