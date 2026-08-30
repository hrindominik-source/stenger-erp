import { describe, it, expect } from "vitest";
import { diffProductionPlanFields, isPlanZmenaActive, formatZmenaText } from "./planZmena.js";

describe("diffProductionPlanFields", () => {
  it("vrati prazdny diff ak sa nic nezmenilo", () => {
    const current = { datum: "01.09.2026", linka: "1", produktNazov: "Popcorn", mnozstvo: 30, mnozstvoJednotka: "pal" };
    expect(diffProductionPlanFields(current, {})).toEqual({ zmenene: [], detail: [] });
  });

  it("zaznamena jednoduchu zmenu pola s citatelnym labelom", () => {
    const current = { datum: "01.09.2026", poznamka: "" };
    const patch = { poznamka: "zmena zmeny" };
    const { zmenene, detail } = diffProductionPlanFields(current, patch);
    expect(zmenene).toEqual(["poznamka"]);
    expect(detail).toEqual([{ pole: "poznamka", label: "Poznámka", stara: "", nova: "zmena zmeny" }]);
  });

  it("zluci mnozstvo a mnozstvoJednotka do jedneho detailu 'Množství'", () => {
    const current = { mnozstvo: 30, mnozstvoJednotka: "pal" };
    const patch = { mnozstvo: 32 };
    const { zmenene, detail } = diffProductionPlanFields(current, patch);
    expect(zmenene).toEqual(["mnozstvo"]);
    expect(detail).toEqual([{ pole: "mnozstvo", label: "Množství", stara: "30 pal", nova: "32 pal" }]);
  });

  it("pouzije linkaLabel na prevod kodu linky na citatelny popisok", () => {
    const current = { linka: "1" };
    const patch = { linka: "2" };
    const linkaLabel = (v) => (v === "1" ? "Linka A" : v === "2" ? "Linka B" : v);
    const { detail } = diffProductionPlanFields(current, patch, linkaLabel);
    expect(detail).toEqual([{ pole: "linka", label: "Linka", stara: "Linka A", nova: "Linka B" }]);
  });

  it("nezmenene polia nechodia dopatch - pouzije sa hodnota z current", () => {
    const current = { datum: "01.09.2026", terminDodania: "05.09.2026" };
    const patch = { datum: "02.09.2026" };
    const { zmenene, detail } = diffProductionPlanFields(current, patch);
    expect(zmenene).toEqual(["datum"]);
    expect(detail).toEqual([{ pole: "datum", label: "Datum", stara: "01.09.2026", nova: "02.09.2026" }]);
  });

  it("zvladne viacero zmenenych poli naraz", () => {
    const current = { datum: "01.09.2026", produktNazov: "Popcorn", mnozstvo: 30, mnozstvoJednotka: "pal" };
    const patch = { datum: "02.09.2026", produktNazov: "Chipsy", mnozstvo: 40 };
    const { zmenene, detail } = diffProductionPlanFields(current, patch);
    expect(zmenene.sort()).toEqual(["datum", "mnozstvo", "produktNazov"].sort());
    expect(detail).toContainEqual({ pole: "datum", label: "Datum", stara: "01.09.2026", nova: "02.09.2026" });
    expect(detail).toContainEqual({ pole: "produktNazov", label: "Produkt", stara: "Popcorn", nova: "Chipsy" });
    expect(detail).toContainEqual({ pole: "mnozstvo", label: "Množství", stara: "30 pal", nova: "40 pal" });
  });
});

describe("isPlanZmenaActive", () => {
  it("je aktivna, ak su nastavene zmenene polia a zmena je mladsia ako 24h", () => {
    const row = { zmenenePolia: ["datum"], zmeneneKedy: new Date().toISOString() };
    expect(isPlanZmenaActive(row)).toBe(true);
  });

  it("nie je aktivna, ak chyba zoznam zmenenych poli", () => {
    const row = { zmenenePolia: [], zmeneneKedy: new Date().toISOString() };
    expect(isPlanZmenaActive(row)).toBe(false);
  });

  it("nie je aktivna, ak je zmena starsia ako 24h", () => {
    const staraKedy = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const row = { zmenenePolia: ["datum"], zmeneneKedy: staraKedy };
    expect(isPlanZmenaActive(row)).toBe(false);
  });

  it("nie je aktivna, ak chyba zmeneneKedy", () => {
    const row = { zmenenePolia: ["datum"] };
    expect(isPlanZmenaActive(row)).toBe(false);
  });
});

describe("formatZmenaText", () => {
  it("vrati prazdny retazec, ak zmena nie je aktivna", () => {
    const row = { zmenenePolia: [], zmeneneKedy: new Date().toISOString(), zmenyDetail: [{ label: "Datum", stara: "01.09.2026", nova: "02.09.2026" }] };
    expect(formatZmenaText(row)).toBe("");
  });

  it("vrati prazdny retazec, ak chyba zmenyDetail", () => {
    const row = { zmenenePolia: ["datum"], zmeneneKedy: new Date().toISOString() };
    expect(formatZmenaText(row)).toBe("");
  });

  it("naformatuje jeden riadok textu so sipkou medzi starou a novou hodnotou", () => {
    const row = {
      zmenenePolia: ["datum"],
      zmeneneKedy: new Date().toISOString(),
      zmenyDetail: [{ label: "Datum", stara: "01.09.2026", nova: "02.09.2026" }],
    };
    expect(formatZmenaText(row)).toBe("Datum: 01.09.2026 → 02.09.2026");
  });

  it("spoji viacero zmien pomocou ' · ' a pouzije — pre prazdnu hodnotu", () => {
    const row = {
      zmenenePolia: ["datum", "poznamka"],
      zmeneneKedy: new Date().toISOString(),
      zmenyDetail: [
        { label: "Datum", stara: "01.09.2026", nova: "02.09.2026" },
        { label: "Poznámka", stara: "", nova: "nova poznamka" },
      ],
    };
    expect(formatZmenaText(row)).toBe("Datum: 01.09.2026 → 02.09.2026 · Poznámka: — → nova poznamka");
  });
});
