import { describe, it, expect } from "vitest";
import {
  computeStockLevels,
  computeFinishedGoodsStock,
  computeProductionIssues,
  wouldExceed,
  materialShortages,
  extraKnownMaterials,
  suggestReceiptMatches,
} from "./inventory.js";

describe("suggestReceiptMatches", () => {
  const receipts = [
    { id: "1", dodavatel: "AAK Sweden AB", material: "Akosnac NT MB", cenaJednotkovaCzk: "" },
    { id: "2", dodavatel: "AAK Sweden AB", material: "Fritex Horo", cenaJednotkovaCzk: "" },
    { id: "3", dodavatel: "Nataïs SAS", material: "Kukurica Mushroom Yellow", cenaJednotkovaCzk: "" },
    { id: "4", dodavatel: "AAK Sweden AB", material: "Akosnac NT MB", cenaJednotkovaCzk: 25.4 }, // uz ocenene
  ];

  it("uprednostni presnu zhodu materialu aj dodavatela", () => {
    const result = suggestReceiptMatches({ popis: "Akosnac NT MB" }, "AAK Sweden AB", receipts);
    expect(result[0].id).toBe("1");
  });

  it("vynecha uz ocenene prijmy", () => {
    const result = suggestReceiptMatches({ popis: "Akosnac NT MB" }, "AAK Sweden AB", receipts);
    expect(result.find((r) => r.id === "4")).toBeUndefined();
  });

  it("vrati prazdny zoznam ked nic nezodpoveda", () => {
    const result = suggestReceiptMatches({ popis: "Uplne iny material" }, "Iny dodavatel", receipts);
    expect(result).toHaveLength(0);
  });
});

describe("computeStockLevels", () => {
  it("scita prijmy a odpocitava vydaje podla materialu a jednotky", () => {
    const receipts = [
      { material: "Cukr", mnozstvoCislo: 100, mnozstvoJednotka: "kg" },
      { material: "cukr", mnozstvoCislo: 50, mnozstvoJednotka: "KG" },
    ];
    const issues = [{ material: "Cukr", mnozstvoCislo: 30, mnozstvoJednotka: "kg" }];
    const stock = computeStockLevels(receipts, issues);
    expect(stock).toHaveLength(1);
    expect(stock[0]).toMatchObject({ material: "Cukr", unit: "kg", prijate: 150, vydane: 30, stav: 120 });
  });

  it("drzi rozne jednotky toho isteho materialu oddelene", () => {
    const receipts = [
      { material: "Folie", mnozstvoCislo: 10, mnozstvoJednotka: "ks" },
      { material: "Folie", mnozstvoCislo: 5, mnozstvoJednotka: "kg" },
    ];
    const stock = computeStockLevels(receipts, []);
    expect(stock).toHaveLength(2);
  });

  it("ignoruje zaznamy bez materialu alebo bez citatelneho mnozstva", () => {
    const stock = computeStockLevels([{ material: "", mnozstvoCislo: 5 }, { mnozstvoCislo: 5 }], []);
    expect(stock).toHaveLength(0);
  });

  it("pocita hodnotu skladu ako vazeny priemer ceny z ocenenych prijmov", () => {
    const receipts = [
      { material: "Cukr", mnozstvoCislo: 100, mnozstvoJednotka: "kg", cenaJednotkovaCzk: 20 },
      { material: "Cukr", mnozstvoCislo: 50, mnozstvoJednotka: "kg", cenaJednotkovaCzk: 26 },
    ];
    const stock = computeStockLevels(receipts, []);
    // priemer = (100*20 + 50*26) / 150 = 22, hodnota = 150 * 22
    expect(stock[0].priemernaCena).toBeCloseTo(22);
    expect(stock[0].hodnota).toBeCloseTo(3300);
    expect(stock[0].neocenenePrijmy).toBe(0);
  });

  it("neocenene prijmy nevstupuju do priemeru, ale zapocitaju sa do mnozstva a oznacia sa", () => {
    const receipts = [
      { material: "Sol", mnozstvoCislo: 100, mnozstvoJednotka: "kg", cenaJednotkovaCzk: 10 },
      { material: "Sol", mnozstvoCislo: 40, mnozstvoJednotka: "kg" }, // este bez faktury
    ];
    const stock = computeStockLevels(receipts, []);
    expect(stock[0].prijate).toBe(140);
    expect(stock[0].priemernaCena).toBeCloseTo(10);
    expect(stock[0].neocenenePrijmy).toBe(1);
  });

  it("hodnota je null ked ziadny prijem nema cenu", () => {
    const stock = computeStockLevels([{ material: "Tuk", mnozstvoCislo: 10, mnozstvoJednotka: "kg" }], []);
    expect(stock[0].priemernaCena).toBeNull();
    expect(stock[0].hodnota).toBeNull();
    expect(stock[0].neocenenePrijmy).toBe(1);
  });
});

describe("computeFinishedGoodsStock", () => {
  it("pocita stav ako vyrobene minus expedovane na produkt", () => {
    const outputs = [
      { produktId: "p1", produktNazov: "Popcorn 100g", mnozstvo: 10 },
      { produktId: "p1", produktNazov: "Popcorn 100g", mnozstvo: 5 },
    ];
    const dispatches = [{ produktId: "p1", produktNazov: "Popcorn 100g", pocetPaliet: 4 }];
    const stock = computeFinishedGoodsStock(outputs, dispatches);
    expect(stock).toEqual([{ produktId: "p1", produktNazov: "Popcorn 100g", vyrobene: 15, expedovane: 4, stav: 11 }]);
  });
});

describe("computeProductionIssues", () => {
  it("prepocita recepturu na 1 paletu podla poctu paliet v plane", () => {
    const product = {
      receptura: [
        { material: "Kukurica", mnozstvo: "12.5", jednotka: "kg" },
        { material: "Sol", mnozstvo: "0.4", jednotka: "kg" },
      ],
    };
    const issues = computeProductionIssues({ mnozstvo: 4, mnozstvoJednotka: "paliet" }, product);
    expect(issues).toEqual([
      { material: "Kukurica", mnozstvoCislo: 50, mnozstvoJednotka: "kg", mnozstvo: "50 kg" },
      { material: "Sol", mnozstvoCislo: 1.6, mnozstvoJednotka: "kg", mnozstvo: "1.6 kg" },
    ]);
  });

  it("vrati prazdny zoznam ak produkt nema recepturu", () => {
    expect(computeProductionIssues({ mnozstvo: 4, mnozstvoJednotka: "paliet" }, { receptura: [] })).toEqual([]);
    expect(computeProductionIssues({ mnozstvo: 4, mnozstvoJednotka: "paliet" }, null)).toEqual([]);
  });
});

describe("wouldExceed", () => {
  it("vrati false ak plan nie je zadany", () => {
    expect(wouldExceed(10, 5, 0)).toBe(false);
    expect(wouldExceed(10, 5, "")).toBe(false);
  });

  it("vrati false ak sa nic nepridava", () => {
    expect(wouldExceed(10, 0, 12)).toBe(false);
    expect(wouldExceed(10, "", 12)).toBe(false);
  });

  it("detekuje prekrocenie planu", () => {
    expect(wouldExceed(10, 3, 12)).toBe(true);
    expect(wouldExceed(10, 2, 12)).toBe(false);
  });

  it("podporuje desatinnu ciarku", () => {
    expect(wouldExceed(10, "2,5", 12)).toBe(true);
  });
});

describe("materialShortages", () => {
  it("vrati len suroviny, kde potrebne mnozstvo presahuje dostupne", () => {
    const required = [
      { material: "Cukr", mnozstvoCislo: 50, mnozstvoJednotka: "kg" },
      { material: "Sol", mnozstvoCislo: 2, mnozstvoJednotka: "kg" },
    ];
    const stock = [
      { material: "Cukr", unit: "kg", stav: 40 },
      { material: "Sol", unit: "kg", stav: 10 },
    ];
    const shortages = materialShortages(required, stock);
    expect(shortages).toHaveLength(1);
    expect(shortages[0]).toMatchObject({ material: "Cukr", dostupne: 40 });
  });

  it("povazuje material bez zaznamu v stocku za dostupny=0", () => {
    const shortages = materialShortages([{ material: "Tuk", mnozstvoCislo: 1, mnozstvoJednotka: "kg" }], []);
    expect(shortages).toHaveLength(1);
    expect(shortages[0].dostupne).toBe(0);
  });
});

describe("extraKnownMaterials", () => {
  it("vrati materialy z prijmov/vydajov, ktore este nie su medzi presetmi", () => {
    const receipts = [{ material: "Kukurica" }, { material: "Vlastny obal" }];
    const issues = [{ material: "Ina prisada" }];
    const extra = extraKnownMaterials(receipts, issues, ["Kukurica", "Cukr"]);
    expect(extra).toEqual(["Ina prisada", "Vlastny obal"]);
  });

  it("nie je citlive na velkost pismen pri porovnani s presetmi", () => {
    const extra = extraKnownMaterials([{ material: "kukurica" }], [], ["Kukurica"]);
    expect(extra).toEqual([]);
  });
});
