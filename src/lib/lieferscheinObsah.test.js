import { describe, it, expect } from "vitest";
import { obsahBalenia, nazovSuboruDodaku, nazovSGramazou, najdiProduktPolozky } from "./lieferscheinObsah.js";

describe("najdiProduktPolozky", () => {
  const products = [
    { id: "a", cisloArtiklu: "6215200", cisloArtikluSW: "11000000329" },
    { id: "b", cisloArtikluZakaznika: "403 00058" },
  ];
  it("podla artikloveho cisla zakaznika, aj s inymi medzerami", () => {
    expect(najdiProduktPolozky({ artikel: "403 00058" }, null, products).id).toBe("b");
    expect(najdiProduktPolozky({ artikel: "40300058" }, null, products).id).toBe("b");
    expect(najdiProduktPolozky({ artikel: "11000000329" }, null, products).id).toBe("a");
  });
  it("katalog zakaznika ma prednost, nezname cislo nic", () => {
    expect(najdiProduktPolozky({ artikel: "X1" }, { katalog: [{ artikel: "x 1", produktId: "a" }] }, products).id).toBe("a");
    expect(najdiProduktPolozky({ artikel: "999" }, null, products)).toBe(null);
    expect(najdiProduktPolozky({ artikel: "" }, null, products)).toBe(null);
  });
});

describe("nazovSGramazou", () => {
  it("gramaz za nazvom produktu", () => {
    expect(nazovSGramazou('"Stenger" Popcorn süß', { gramaz: "200" })).toBe('"Stenger" Popcorn süß 200 g');
    expect(nazovSGramazou("Popcorn", { gramaz: "75 g" })).toBe("Popcorn 75 g");
  });
  it("nezdvoji gramaz, ked uz je v nazve", () => {
    expect(nazovSGramazou('"AMERICAN STYLE" POPCORN SÜß 200 g', { gramaz: "200" })).toBe('"AMERICAN STYLE" POPCORN SÜß 200 g');
    expect(nazovSGramazou("Popcorn 200g", { gramaz: "200" })).toBe("Popcorn 200g");
  });
  it("bez produktu alebo gramaze nazov bez zmeny", () => {
    expect(nazovSGramazou("Popcorn", null)).toBe("Popcorn");
    expect(nazovSGramazou("Popcorn", {})).toBe("Popcorn");
  });
});

describe("obsahBalenia", () => {
  it("kusy v kartone a kartony na palete", () => {
    expect(obsahBalenia({ gramaz: "200", ksVKartone: 15, kartonovNaPalete: 16 })).toBe("15 Stk/KRT · 16 KRT/PAL");
  });
  it("doplni text inhlt", () => {
    expect(obsahBalenia({ ksVKartone: "20", inhlt: "Beutel" })).toBe("20 Stk/KRT\nBeutel");
  });
  it("bez produktu prazdne", () => {
    expect(obsahBalenia(null)).toBe("");
    expect(obsahBalenia({})).toBe("");
  });
});

describe("nazovSuboruDodaku", () => {
  it("cislo dodaku a mesto", () => {
    expect(nazovSuboruDodaku("60879/1611", "Bottrop")).toBe("60879-1611 BOTTROP");
    expect(nazovSuboruDodaku("60895/1911", "LANDSBERG AM LECH")).toBe("60895-1911 LANDSBERG AM LECH");
  });
  it("bez mesta len cislo", () => {
    expect(nazovSuboruDodaku("60879/1611", "")).toBe("60879-1611");
  });
});
