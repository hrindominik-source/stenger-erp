import { describe, it, expect } from "vitest";
import { parseGs1 } from "./gs1.js";
import { pridajSken, doplnPaletu, sumaPaliet, suhrnPaliet, kontrolaPrijmu } from "./prijemPalety.js";

// Vymyslene cisla s platnymi kontrolnymi cislicami.
const SSCC1 = "123456789012345675";
const SSCC2 = "340123456789012340";
const GTIN = "12345678901231";

describe("pridajSken", () => {
  it("tri kody jednej etikety v lubovolnom poradi = jedna paleta", () => {
    let st = { palety: [], rozpracovana: null };
    st = pridajSken(st.palety, st.rozpracovana, parseGs1("(10)L1"));
    st = pridajSken(st.palety, st.rozpracovana, parseGs1(`(02)${GTIN}(37)84(15)291016`));
    expect(st.palety).toHaveLength(0);
    st = pridajSken(st.palety, st.rozpracovana, parseGs1(`(00)${SSCC1}`));
    expect(st.palety).toHaveLength(1);
    expect(st.palety[0]).toMatchObject({ sscc: SSCC1, gtin: GTIN, sarza: "L1", pocet: 84, dmt: "16.10.2029" });
    expect(st.rozpracovana).toBe(null);
  });

  it("nova etiketa (iny SSCC alebo ina sarza) zacne novu paletu", () => {
    let st = pridajSken([], null, parseGs1("(10)L1"));
    st = pridajSken(st.palety, st.rozpracovana, parseGs1("(10)L2"));
    expect(st.palety).toHaveLength(1);
    expect(st.rozpracovana.sarza).toBe("L2");
    st = pridajSken(st.palety, st.rozpracovana, parseGs1(`(00)${SSCC1}(10)L2`));
    st = pridajSken(st.palety, st.rozpracovana, parseGs1(`(00)${SSCC2}(10)L2`));
    expect(st.palety.map((p) => p.sscc)).toEqual(["", SSCC1, SSCC2]);
  });
});

describe("doplnPaletu", () => {
  it("mnozstvo z karty a DMT z trvanlivosti, ked ho etiketa nema", () => {
    const p = doplnPaletu(parseGs1(`(02)${GTIN}(11)260723(37)32`), { jednotka: "kg", mnozstvoNaKs: 25, trvanlivostMesiace: 12 });
    expect(p.mnozstvo).toBe(800);
    expect(p.dmt).toBe("23.07.2027");
    expect(p.dmtVypocitane).toBe(true);
  });
  it("bez karty = pocet kusov", () => {
    expect(doplnPaletu(parseGs1(`(02)${GTIN}(37)1080`), null).mnozstvo).toBe(1080);
  });
});

describe("suhrn", () => {
  it("unikatne sarze a najskorsie DMT", () => {
    const palety = [
      { sarza: "A", dmt: "10.05.2027", mnozstvo: 840 },
      { sarza: "B", dmt: "01.03.2027", mnozstvo: 840 },
      { sarza: "A", dmt: "10.05.2027", mnozstvo: 840.5 },
    ];
    expect(suhrnPaliet(palety)).toEqual({ sarza: "A, B", dmt: "01.03.2027" });
    expect(sumaPaliet(palety)).toBe(2520.5);
  });
});

describe("kontrolaPrijmu", () => {
  const dnes = new Date(2026, 10, 5);
  const uroven = (r, u) => r.filter((x) => x.uroven === u).map((x) => x.text).join(" | ");

  it("bez problemov nic nehlasi", () => {
    const r = kontrolaPrijmu({ material: "Cukr", mnozstvo: "840", jednotka: "kg", sarza: "L1", dmt: "16.10.2029", palety: [{ sscc: SSCC1, gtin: GTIN, mnozstvo: 840, dmt: "16.10.2029", datumVyroby: "16.10.2026" }], karty: [{ gtin: GTIN, material: "Cukr" }], jeSurovina: true, dnes });
    expect(r).toEqual([]);
  });

  it("duplicitna paleta a uz prijata paleta su chyby", () => {
    const r = kontrolaPrijmu({ palety: [{ sscc: SSCC1 }, { sscc: SSCC1 }, { sscc: SSCC2 }], prijateSscc: new Set([SSCC2]), dnes });
    expect(uroven(r, "chyba")).toContain("dvakrát");
    expect(uroven(r, "chyba")).toContain(`${SSCC2} už byla přijata`);
  });

  it("iny material podla karty je chyba, rozne GTIN upozornenie", () => {
    const r = kontrolaPrijmu({ material: "Sůl", palety: [{ gtin: GTIN }, { gtin: "04012345678901" }], karty: [{ gtin: GTIN, material: "Cukr" }], dnes });
    expect(uroven(r, "chyba")).toContain("jiný materiál (Cukr)");
    expect(uroven(r, "upozornenie")).toContain("různými kódy");
  });

  it("objednavka: ine cislo na etikete a ine mnozstvo", () => {
    const r = kontrolaPrijmu({ mnozstvo: "1000", jednotka: "ks", palety: [{ objednavka: "451/0511", mnozstvo: 1000 }], objednavka: { cislo: "451/0600", mnozstvo: "1 080 ks" }, dnes });
    expect(uroven(r, "upozornenie")).toContain("Etiketa uvádí objednávku 451/0511");
    expect(uroven(r, "upozornenie")).toContain("objednáno bylo 1080 ks");
  });

  it("sucet palet nesedi so zapisanym mnozstvom, paleta bez mnozstva", () => {
    const r = kontrolaPrijmu({ mnozstvo: "1600", jednotka: "kg", palety: [{ mnozstvo: 840 }, { mnozstvo: 840 }], dnes });
    expect(uroven(r, "upozornenie")).toContain("Součet naskenovaných palet je 1680 kg");
    const r2 = kontrolaPrijmu({ mnozstvo: "", jednotka: "ks", palety: [{ mnozstvo: null }], dnes });
    expect(uroven(r2, "upozornenie")).toContain("neuvádí množství");
  });

  it("DMT: zly format, prosle, nie po datume vyroby", () => {
    expect(uroven(kontrolaPrijmu({ dmt: "2027-01-01", dnes }), "chyba")).toContain("DD.MM.RRRR");
    expect(uroven(kontrolaPrijmu({ dmt: "04.11.2026", dnes }), "chyba")).toContain("prošlo");
    expect(kontrolaPrijmu({ dmt: "05.11.2026", dnes })).toEqual([]);
    expect(uroven(kontrolaPrijmu({ palety: [{ dmt: "01.01.2026", datumVyroby: "02.01.2026" }], dnes }), "upozornenie")).toContain("není po datu výroby");
  });

  it("surovina bez sarze a DMT upozorni, obal nie", () => {
    expect(kontrolaPrijmu({ jeSurovina: true, dnes })).toHaveLength(2);
    expect(kontrolaPrijmu({ jeSurovina: false, dnes })).toHaveLength(0);
  });
});
