import { describe, it, expect } from "vitest";
import { stopaPalety, normStopa, rucnaDavka, buildDohladatelnost, filtrujDohladatelnost, dohladatelnostSheets, davkyZoSkenu } from "./pdaDohladatelnost.js";

const GTIN = "04001234000015";
const products = [{ id: "A", znacka: "POPCORN", gramaz: "200", cisloArtikluSW: "62 99901", eanKarton: "4001234000015" }];
const vydajky = [
  { id: "V1", cislo_lieferschein: "LS1", stav: "dokoncena", dokoncena_at: "2026-11-03T10:00:00Z", data: { objednavka: { zakaznik: "Edeka", cislo: "0043/2509" } } },
  { id: "V2", cislo_lieferschein: "LS2", stav: "rozpracovana", created_at: "2026-11-05T10:00:00Z", data: {} },
];
const pal = (vydajka_id, sscc, extra = {}) => ({ vydajka_id, sscc, gtin: GTIN, bbd: "2027-05-28", sarza: null, mnozstvo: 16, ...extra });
const palety = [pal("V1", "111"), pal("V2", "222"), pal("V1", "333", { sarza: "2607A", mnozstvo: null }), pal("IBA", "999")];
const rucnyRow = (data, extra = {}) => ({ created_at: "2026-11-07T08:00:00Z", data, orders: { zakaznik: "Stenger Waffeln GmbH", adresa_dodania_nazov: "Netto", cislo_objednavky_dopravy: "0050/2511", cislo_dodacieho_listu: "LS9" }, ...extra });

describe("stopa", () => {
  it("bez sarze plati BBD", () => {
    expect(stopaPalety({ sarza: "", bbd: "2027-05-28" })).toBe("28.05.2027");
    expect(stopaPalety({ sarza: "2607A", bbd: "2027-05-28" })).toBe("2607A");
    expect(stopaPalety({})).toBe("");
  });
  it("normalizuje datum a pismena", () => {
    expect(normStopa(" 28.5.2027 ")).toBe("28.05.2027");
    expect(normStopa("2607A")).toBe("2607a");
  });
});

describe("rucnaDavka", () => {
  it("berie len rucne davky", () => {
    expect(rucnaDavka(rucnyRow({ produktId: "A", sarza: "28.5.2027", pocetPaliet: 4, datum: "07.11.2026", zapisal: "Sklad" }))).toMatchObject({ produktId: "A", pocetPaliet: 4, datum: "2026-11-07T12:00:00", zakaznik: "Netto", cisloLs: "LS9" });
    expect(rucnaDavka(rucnyRow({ typ: "kontrola" }))).toBeNull();
    expect(rucnaDavka(rucnyRow({ produktId: "A", zdroj: "pda" }))).toBeNull();
  });
});

describe("dohladatelnost", () => {
  it("zoskupi produkt + stopa a doplni zakaznika", () => {
    const r = buildDohladatelnost(vydajky, palety, products);
    expect(r).toHaveLength(2);
    const bbd = r.find((x) => !x.sarza);
    expect(bbd).toMatchObject({ produkt: "POPCORN 200g", stopa: "28.05.2027", mnozstvo: 32, paletCelkom: 2, zakaznici: ["Edeka"], datumOd: "2026-11-03T10:00:00Z", datumDo: "2026-11-05T10:00:00Z" });
    expect(bbd.palety.map((p) => p.sscc)).toEqual(["111", "222"]);
    expect(r.find((x) => x.sarza)).toMatchObject({ mnozstvoNeuplne: true, stopa: "2607A" });
  });
  it("rucna davka s rovnakou stopou je v tom istom riadku", () => {
    const rucne = [rucnaDavka(rucnyRow({ produktId: "A", sarza: "28.5.2027", pocetPaliet: 4, datum: "07.11.2026" }))];
    const r = buildDohladatelnost(vydajky, palety, products, rucne);
    expect(r).toHaveLength(2);
    expect(r.find((x) => !x.sarza || x.sarza === "28.5.2027")).toMatchObject({ paletCelkom: 6, zakaznici: ["Edeka", "Netto"] });
  });
  it("hlada lot, datum, produkt, SSCC aj zakaznika", () => {
    const r = buildDohladatelnost(vydajky, palety, products);
    expect(filtrujDohladatelnost(r, "2607a")).toHaveLength(1);
    expect(filtrujDohladatelnost(r, "28.5.2027")).toHaveLength(2);
    expect(filtrujDohladatelnost(r, "popcorn")).toHaveLength(2);
    expect(filtrujDohladatelnost(r, "222")).toHaveLength(1);
    expect(filtrujDohladatelnost(r, "edeka")).toHaveLength(2);
    expect(filtrujDohladatelnost(r, "nic")).toHaveLength(0);
  });
  it("export ma suhrn a palety", () => {
    const [souhrn, pl] = dohladatelnostSheets(buildDohladatelnost(vydajky, palety, products));
    expect(souhrn.rows).toHaveLength(2);
    expect(pl.rows).toHaveLength(3);
    expect(pl.rows.find((x) => x.SSCC === "111")).toMatchObject({ "Zdroj": "Sken", "Zákazník": "Edeka", "Lieferschein": "LS1", "Šarže / lot": "28.05.2027" });
    expect(dohladatelnostSheets([])[0].rows).toEqual([{ Info: "Žádné palety" }]);
  });
});

describe("davkyZoSkenu", () => {
  it("po produkte a stope, nezname GTIN zvlast", () => {
    const { zaznamy, bezProduktu } = davkyZoSkenu([pal("V1", "1"), pal("V1", "2"), pal("V1", "3", { sarza: "L2" }), pal("V1", "4", { gtin: "09999999999999" })], products, (p) => p.znacka);
    expect(zaznamy).toEqual([
      { produktId: "A", produktNazov: "POPCORN", sarza: "28.05.2027", pocetPaliet: 2, pocetKartonov: null, zdroj: "pda" },
      { produktId: "A", produktNazov: "POPCORN", sarza: "L2", pocetPaliet: 1, pocetKartonov: null, zdroj: "pda" },
    ]);
    expect(bezProduktu).toEqual(["09999999999999"]);
  });
});
