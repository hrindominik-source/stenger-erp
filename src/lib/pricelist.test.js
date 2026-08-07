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
});

describe("formatEur", () => {
  it("formatuje cislo s ciarkou a znakom eura", () => {
    expect(formatEur(110)).toBe("110,00 €");
    expect(formatEur(99.5)).toBe("99,50 €");
  });
});
