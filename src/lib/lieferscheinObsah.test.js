import { describe, it, expect } from "vitest";
import { obsahBalenia, nazovSuboruDodaku } from "./lieferscheinObsah.js";

describe("obsahBalenia", () => {
  it("gramaz, kusy v kartone, kartony na palete", () => {
    expect(obsahBalenia({ gramaz: "200", ksVKartone: 15, kartonovNaPalete: 16 })).toBe("200 g · 15 Stk/KRT · 16 KRT/PAL");
  });
  it("gramaz s jednotkou ostava, doplni text inhlt", () => {
    expect(obsahBalenia({ gramaz: "75 g", ksVKartone: "20", inhlt: "Beutel" })).toBe("75 g · 20 Stk/KRT\nBeutel");
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
