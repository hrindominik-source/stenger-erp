import { describe, it, expect } from "vitest";
import { parseGs1 } from "./gs1.js";
import { pridajSken, doplnPaletu, sumaPaliet, suhrnPaliet, kontrolaPrijmu, chybajuceNaPalete, chybajucePovinne } from "./prijemPalety.js";

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

  const jokey = [`(400)451/0511(11)261104(10)L1`, `(02)${GTIN}(37)1080`, `(00)${SSCC1}`];
  const naskenuj = (kody, st = { palety: [], rozpracovana: null }) => kody.reduce((s, k) => pridajSken(s.palety, s.rozpracovana, parseGs1(k)), st);

  it.each([[[0, 1, 2]], [[0, 2, 1]], [[2, 0, 1]], [[2, 1, 0]], [[1, 2, 0]], [[1, 0, 2]]])("tri kody etikety v poradi %j = jedna uplna paleta", (poradie) => {
    const st = naskenuj(poradie.map((i) => jokey[i]));
    expect(st.rozpracovana).toBe(null);
    expect(st.palety).toHaveLength(1);
    expect(st.palety[0]).toMatchObject({ sscc: SSCC1, gtin: GTIN, sarza: "L1", pocet: 1080, objednavka: "451/0511" });
  });

  it("cislo objednavky (400) bez oddelovaca pred dalsim AI", () => {
    expect(parseGs1("400451/05111126110410L1")).toMatchObject({ objednavka: "451/0511", datumVyroby: "04.11.2026", sarza: "L1" });
    expect(parseGs1("400451/05111033")).toMatchObject({ objednavka: "451/0511", sarza: "33" });
    expect(parseGs1("(02)12345678901231(400)ABC-1")).toMatchObject({ objednavka: "ABC-1" });
  });

  it("etikety bez oddelovaca FNC1 z PDA", () => {
    expect(parseGs1(`02${GTIN}9140078436825053700001080`)).toMatchObject({ gtin: GTIN, pocet: 1080 });
    expect(parseGs1(`02${GTIN}378415291016`)).toMatchObject({ gtin: GTIN, pocet: 84, dmt: "16.10.2029" });
    expect(parseGs1("37011527092510V37952")).toMatchObject({ pocet: 1, dmt: "25.09.2027", sarza: "V37952" });
    expect(parseGs1(`02${GTIN}3732`)).toMatchObject({ gtin: GTIN, pocet: 32 });
  });

  it("opakovany sken SSCC nezacne novu paletu", () => {
    const st = naskenuj([jokey[0], jokey[2], jokey[2], jokey[1]]);
    expect(st.palety).toHaveLength(1);
    expect(st.palety[0]).toMatchObject({ sscc: SSCC1, gtin: GTIN, pocet: 1080 });
  });

  it("druha paleta tej istej sarze sa nezleje s prvou", () => {
    const druha = [jokey[0], jokey[1], `(00)${SSCC2}`];
    const st = naskenuj([...jokey, ...druha]);
    expect(st.rozpracovana).toBe(null);
    expect(st.palety.map((p) => p.sscc)).toEqual([SSCC1, SSCC2]);
    expect(st.palety[1]).toMatchObject({ gtin: GTIN, sarza: "L1", pocet: 1080 });
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

describe("kompletnost palety a povinne udaje", () => {
  it("co palete chyba", () => {
    expect(chybajuceNaPalete({ sscc: SSCC1, mnozstvo: 800, sarza: "L1" })).toEqual([]);
    expect(chybajuceNaPalete({ gtin: GTIN, mnozstvo: null })).toEqual(["SSCC", "množství", "šarže"]);
  });
  it("mnozstvo vzdy, sarza a DMT len pri surovine", () => {
    expect(chybajucePovinne({ mnozstvo: "", sarza: "", dmt: "", jeSurovina: false })).toEqual(["množství"]);
    expect(chybajucePovinne({ mnozstvo: "5", sarza: "", dmt: " ", jeSurovina: true })).toEqual(["šarže", "DMT"]);
    expect(chybajucePovinne({ mnozstvo: "5", sarza: "L", dmt: "01.01.2030", jeSurovina: true })).toEqual([]);
  });
  it("rozpracovana paleta je chyba prijmu", () => {
    expect(kontrolaPrijmu({ rozpracovana: true, dnes: new Date(2026, 10, 5) }).map((k) => k.uroven)).toEqual(["chyba"]);
  });
  it("dva kody zliate do jedneho skenu", () => {
    expect(parseGs1(`02${GTIN}11260723373200${SSCC1}10L1`)).toMatchObject({ gtin: GTIN, pocet: 32, sscc: SSCC1, sarza: "L1" });
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
