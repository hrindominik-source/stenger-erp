import { describe, it, expect } from "vitest";
import { stopaPalety, buildDohladatelnost, filtrujDohladatelnost, dohladatelnostSheets } from "./pdaDohladatelnost.js";

const GTIN = "04001234000015";
const products = [{ id: "A", znacka: "POPCORN", gramaz: "200", cisloArtikluSW: "62 99901", eanKarton: "4001234000015" }];
const vydajky = [
  { id: "V1", cislo_lieferschein: "LS1", stav: "dokoncena", dokoncena_at: "2026-11-03T10:00:00Z", data: { objednavka: { zakaznik: "Edeka", cislo: "0043/2509" } } },
  { id: "V2", cislo_lieferschein: "LS2", stav: "rozpracovana", created_at: "2026-11-05T10:00:00Z", data: {} },
];
const pal = (vydajka_id, sscc, extra = {}) => ({ vydajka_id, sscc, gtin: GTIN, bbd: "2027-05-28", sarza: null, mnozstvo: 16, ...extra });
const palety = [pal("V1", "111"), pal("V2", "222"), pal("V1", "333", { sarza: "2607A", mnozstvo: null }), pal("IBA", "999")];

describe("dohladatelnost", () => {
  it("bez sarze plati BBD", () => {
    expect(stopaPalety({ sarza: "", bbd: "2027-05-28" })).toBe("28.05.2027");
    expect(stopaPalety({ sarza: "2607A", bbd: "2027-05-28" })).toBe("2607A");
    expect(stopaPalety({})).toBe("");
  });
  it("zoskupi produkt + sarza + BBD a doplni zakaznika", () => {
    const r = buildDohladatelnost(vydajky, palety, products);
    expect(r).toHaveLength(2);
    const bbd = r.find((x) => !x.sarza);
    expect(bbd).toMatchObject({ produkt: "POPCORN 200g", stopa: "28.05.2027", mnozstvo: 32, zakaznici: ["Edeka"], datumOd: "2026-11-03T10:00:00Z", datumDo: "2026-11-05T10:00:00Z" });
    expect(bbd.palety.map((p) => p.sscc)).toEqual(["111", "222"]);
    expect(r.find((x) => x.sarza)).toMatchObject({ mnozstvoNeuplne: true, stopa: "2607A" });
  });
  it("hlada lot, datum, produkt, SSCC aj zakaznika", () => {
    const r = buildDohladatelnost(vydajky, palety, products);
    expect(filtrujDohladatelnost(r, "2607a")).toHaveLength(1);
    expect(filtrujDohladatelnost(r, "28.05.2027")).toHaveLength(2);
    expect(filtrujDohladatelnost(r, "popcorn")).toHaveLength(2);
    expect(filtrujDohladatelnost(r, "222")).toHaveLength(1);
    expect(filtrujDohladatelnost(r, "edeka")).toHaveLength(2);
    expect(filtrujDohladatelnost(r, "nic")).toHaveLength(0);
  });
  it("export ma suhrn a palety", () => {
    const [souhrn, pl] = dohladatelnostSheets(buildDohladatelnost(vydajky, palety, products));
    expect(souhrn.rows).toHaveLength(2);
    expect(pl.rows).toHaveLength(3);
    expect(pl.rows.find((x) => x.SSCC === "111")).toMatchObject({ "Zákazník": "Edeka", "Lieferschein": "LS1", "Šarže / lot": "28.05.2027" });
    expect(dohladatelnostSheets([])[0].rows).toEqual([{ Info: "Žádné palety" }]);
  });
});
