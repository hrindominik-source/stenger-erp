import { describe, it, expect } from "vitest";
import { computeTransportPriceForCity, formatEur } from "./pricelist.js";

const pricelist = {
  buckets: [
    { label: "1-2pal", min: 1, max: 2 },
    { label: "3-5pal", min: 3, max: 5 },
  ],
  cities: {
    PRAHA: [100, 150],
    BRNO: [90, null],
  },
  vratkaPal: [10, 15],
};

describe("computeTransportPriceForCity", () => {
  it("vrati chybu ak cennik nie je nahraty", () => {
    const result = computeTransportPriceForCity("Praha", 2, false, null);
    expect(result.matched).toBe(false);
  });

  it("vrati chybu ak pocet paletovych miest chyba", () => {
    const result = computeTransportPriceForCity("Praha", "", false, pricelist);
    expect(result.matched).toBe(false);
  });

  it("vrati chybu ak je pocet miest mimo rozsahu cennika", () => {
    const result = computeTransportPriceForCity("Praha", 10, false, pricelist);
    expect(result.matched).toBe(false);
  });

  it("najde spravny bucket a cenu podla mesta (case-insensitive)", () => {
    const result = computeTransportPriceForCity("praha", 2, false, pricelist);
    expect(result).toMatchObject({ matched: true, city: "PRAHA", bucketLabel: "1-2pal", basePrice: 100, surcharge: 0, total: 100 });
  });

  it("pripocita prirazku za vratku paliet ak je pozadovana", () => {
    const result = computeTransportPriceForCity("Praha", 2, true, pricelist);
    expect(result).toMatchObject({ basePrice: 100, surcharge: 10, total: 110 });
  });

  it("vrati chybu ak mesto v cenniku pre dany rozsah chyba (null cena)", () => {
    const result = computeTransportPriceForCity("Brno", 4, false, pricelist);
    expect(result.matched).toBe(false);
  });

  it("vrati chybu ak mesto vobec nie je v cenniku", () => {
    const result = computeTransportPriceForCity("Neznamemesto", 2, false, pricelist);
    expect(result.matched).toBe(false);
  });

  it("najde cenu aj ked cennik ma mesto skratene a adresa cely nazov (BINGEN vs BINGEN AM RHEIN)", () => {
    const pricelistSkrateny = { ...pricelist, cities: { ...pricelist.cities, BINGEN: [80, 120] } };
    const result = computeTransportPriceForCity("Bingen am Rhein", 2, false, pricelistSkrateny);
    expect(result).toMatchObject({ matched: true, basePrice: 80 });
  });

  it("riadok s viac mestami (OLDENBURG/GRONAU) plati pre kazde z nich", () => {
    const p = { ...pricelist, cities: { ...pricelist.cities, "OLDENBURG/GRONAU": [70, 110] } };
    expect(computeTransportPriceForCity("Gronau", 2, false, p)).toMatchObject({ matched: true, basePrice: 70 });
    expect(computeTransportPriceForCity("Oldenburg", 2, false, p)).toMatchObject({ matched: true, basePrice: 70 });
    expect(computeTransportPriceForCity("Gronausee", 2, false, p).matched).toBe(false);
  });

  it("mesto s prehlaskou najde aj ked cennik ju nema (Nürnberg vs NURNBERG)", () => {
    const p = { ...pricelist, cities: { ...pricelist.cities, NURNBERG: [60, 90], "BAD WUNNENBERG": [61, 91] } };
    expect(computeTransportPriceForCity("NÜRNBERG", 2, false, p)).toMatchObject({ matched: true, basePrice: 60 });
    expect(computeTransportPriceForCity("Bad Wünnenberg", 2, false, p)).toMatchObject({ matched: true, basePrice: 61 });
  });

  it("preklep v cenniku (MARKREWIDTZ pre Marktredwitz)", () => {
    const p = { ...pricelist, cities: { ...pricelist.cities, MARKREWIDTZ: [77, 99], MARL: [10, 20], ALTADSBERG: [55, 66] } };
    expect(computeTransportPriceForCity("MARKTREDWITZ", 2, false, p)).toMatchObject({ matched: true, basePrice: 77 });
    expect(computeTransportPriceForCity("Altlandsberg", 2, false, p)).toMatchObject({ matched: true, basePrice: 55 });
  });

  it("kratke alebo vzdialene nazvy sa podla preklepov nezhoduju", () => {
    const p = { ...pricelist, cities: { ...pricelist.cities, MARL: [10, 20], HAMM: [11, 21], KERPEN: [12, 22] } };
    expect(computeTransportPriceForCity("Kempen", 2, false, p).matched).toBe(false);
    expect(computeTransportPriceForCity("Mainz", 2, false, p).matched).toBe(false);
    expect(computeTransportPriceForCity("Hamburg", 2, false, p).matched).toBe(false);
  });

  it("nezhoduje nesuvisiace mesto so spolocnym prefixom (BINGEN vs BINGENDORF)", () => {
    const pricelistSkrateny = { ...pricelist, cities: { ...pricelist.cities, BINGEN: [80, 120] } };
    const result = computeTransportPriceForCity("Bingendorf", 2, false, pricelistSkrateny);
    expect(result.matched).toBe(false);
  });
});

describe("formatEur", () => {
  it("formatuje cislo s ciarkou a znakom eura", () => {
    expect(formatEur(110)).toBe("110,00 €");
    expect(formatEur(99.5)).toBe("99,50 €");
  });
});
