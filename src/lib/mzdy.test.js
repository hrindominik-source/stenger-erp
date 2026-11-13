import { describe, it, expect } from "vitest";
import { vypocitajMzdu, zaokruhliHodiny, pracovneDni, jeNocnaZmena, dochadzkaPreMzdy, legendaPreMesiac, MZDY_LEGENDA_VYCHODZIA, dochadzkaMesiacaPreMzdy, skupinaPracovnika } from "./mzdy.js";
import { mzdyRiadkyExportu, mzdyRiadkyLegendy } from "./mzdyExport.js";

const m = (s) => { const [h, mm] = s.split(":").map(Number); return h * 60 + mm; };
const L = MZDY_LEGENDA_VYCHODZIA;
const vypocet = (skupina, denne, nocne, vstup, zmeny = 0) =>
  vypocitajMzdu({ skupina, mesiac: "2026-10", legenda: L, dochadzka: { denneMin: m(denne), nocneMin: m(nocne), vikendMin: 0, zmeny }, vstup });

describe("pomocne", () => {
  it("minuty: do 29 nadol, od 30 nahor", () => {
    expect(zaokruhliHodiny(m("205:05"))).toBe(205);
    expect(zaokruhliHodiny(m("192:25"))).toBe(192);
    expect(zaokruhliHodiny(m("96:30"))).toBe(97);
    expect(zaokruhliHodiny(m("132:55"))).toBe(133);
  });
  it("pracovne dni bez sviatkov (10/2026: 28.10.)", () => {
    expect(pracovneDni("2026-10")).toBe(21);
  });
  it("nocna zmena podla zaciatku", () => {
    expect(jeNocnaZmena("17:55")).toBe(true);
    expect(jeNocnaZmena("05:55")).toBe(false);
    expect(jeNocnaZmena("00:30")).toBe(true);
  });
  it("suhrn zmien: cela zmena denna alebo nocna, vikend len denne", () => {
    const s = dochadzkaPreMzdy([
      { datum: new Date(2026, 9, 1), casZaciatku: "05:55", minuty: 725 },
      { datum: new Date(2026, 9, 3), casZaciatku: "05:55", minuty: 725 }, // sobota
      { datum: new Date(2026, 9, 4), casZaciatku: "17:55", minuty: 725 },
    ]);
    expect(s).toEqual({ denneMin: 1450, nocneMin: 725, vikendMin: 725, zmeny: 3 });
  });
  it("legenda podla platnosti od mesiaca", () => {
    const verzie = [
      { platnostOd: "2026-10", data: { skupiny: { ostatne: { premia: 4500 } } } },
      { platnostOd: "2027-01", data: { skupiny: { ostatne: { premia: 5000 } } } },
    ];
    expect(legendaPreMesiac(verzie, "2026-12").skupiny.ostatne.premia).toBe(4500);
    expect(legendaPreMesiac(verzie, "2027-02").skupiny.ostatne.premia).toBe(5000);
    expect(legendaPreMesiac([], "2026-10").skupiny.hrncova.zaSmenu).toBe(100);
  });
});

// Rijen 2026 - anonymizovane udaje z podkladov kolegu (suhrn hodin + MZDA).
// Tam, kde kolega pocital podla dohodnutych pravidiel, vysledok sedi na korunu.
describe("mzdy 10/2026 ako tabulka kolegu", () => {
  it("pozice 3, plny fond (P05): nadcas + uklid + premie + mesicni priplatok", () => {
    const r = vypocet("pozicia3", "108:25", "96:40", { uklidy: 4, dovolenkaDni: 0 }, 17);
    expect(r).toMatchObject({ hodinyCelkem: 205, fond: 168, nadcasHod: 37, nadcasKc: 7631.25, uklidKc: 1400, premia: 4500, mesacnyPriplatok: 500, celkem: 14031.25 });
  });
  it("pozice 3, plny fond (P08)", () => {
    expect(vypocet("pozicia3", "120:30", "84:35", { uklidy: 3 }, 17).celkem).toBe(13681.25);
  });
  it("pozice 3, polovicny fond (P09): premie aj priplatok kratene fondom", () => {
    const r = vypocet("pozicia3", "48:20", "48:20", { fond: 84 }, 8);
    expect(r).toMatchObject({ hodinyCelkem: 97, premia: 2250, mesacnyPriplatok: 250, celkem: 5181.25 });
  });
  it("ostatni (P11)", () => {
    expect(vypocet("ostatne", "120:30", "72:30", { uklidy: 3 }, 16).celkem).toBe(10706.25);
  });
  it("hrncova: 30 Kc na kazdu hodinu, 100 Kc za smenu, uklid 500, premie kratena dovolenkou", () => {
    const r = vypocet("hrncova", "60:05", "145:00", { uklidy: 2, dovolenkaDni: 3 }, 17);
    expect(r).toMatchObject({ fond: 144, nadcasHod: 61, nadcasKc: 12581.25, priplatokHodKc: 6150, smenyKc: 1700, uklidKc: 1000, premia: 5143 });
    expect(r.celkem).toBe(26574.25);
  });
  it("korekcia hodin (doplatit) a rucne premie v zkusebni dobe", () => {
    expect(vypocet("ostatne", "12:05", "12:05", { fond: 24, korekciaHod: 12 }, 2)).toMatchObject({ hodinyCelkem: 36, nadcasKc: 2475, premia: 643 });
    expect(vypocet("skusobna", "52:05", "12:05", { fond: 72, mimoriadnaPremia: 250 }, 5).celkem).toBe(250);
  });
  it("skladnik: bez uklidu, dochazkova premie + pohybliva", () => {
    const r = vypocet("skladnik", "187:30", "0:00", { uklidy: 3, pohyblivaPremia: 2500 }, 19);
    expect(r).toMatchObject({ hodinyCelkem: 188, nadcasHod: 20, nadcasKc: 5500, uklidKc: 0, premia: 2500, celkem: 10500 });
  });
  it("rucne prepisane hodnoty maju prednost pred navrhom", () => {
    const r = vypocet("hrncova", "60:05", "145:00", { dovolenkaDni: 3, premia: 6000, hodinyCelkem: 200 }, 17);
    expect(r).toMatchObject({ navrhPremia: 5143, premia: 6000, hodinyCelkem: 200, nadcasHod: 56 });
  });
});

describe("zastup na hrnci (pozicia 3)", () => {
  it("ina sadzba uklidu a zaklad premie, bez priplatku za hodinu a za smenu", () => {
    const r = vypocet("pozicia3", "119:50", "72:30", { uklidy: 3, dovolenkaDni: 2, fond: 152, sadzbaUklid: 500, premiaZaklad: 6000 }, 16);
    expect(r).toMatchObject({ uklidKc: 1500, priplatokHodKc: 0, smenyKc: 0, navrhPremia: 5429, mesacnyPriplatok: 452 });
  });
});

describe("dochadzka mesiaca pre mzdy", () => {
  const workers = { V: { typ: "vyroba" }, S: { typ: "sklad" } };
  const nastavenia = { zaciatokVyroba: "05:55", zaciatokVyrobaNoc: "17:55", zaciatokSklad: "" };
  const prestavky = [
    { id: "1", meno: "V", datum: "01.10.2026", casZaciatku: "05:40", casKonca: "18:00" },
    { id: "2", meno: "V", datum: "02.10.2026", casZaciatku: "17:45", casKonca: "06:00" },
    { id: "3", meno: "V", datum: "05.10.2026", casZaciatku: "05:50" },
    { id: "4", meno: "S", datum: "01.10.2026", casZaciatku: "07:40", casKonca: "17:05" },
  ];
  const pauzy = [{ id: "b", meno: "V", datum: "01.10.2026", casZaciatku: "12:00", casKonca: "12:30" }];
  it("zarovnanie na 05:55/17:55, platene prestavky, nedokoncene zvlast, sklad presne", () => {
    const d = dochadzkaMesiacaPreMzdy(prestavky, pauzy, workers, nastavenia);
    expect(d.V).toEqual({ denneMin: 725, nocneMin: 725, vikendMin: 0, zmeny: 2, nedokoncene: 1 });
    expect(d.S).toMatchObject({ denneMin: 565, zmeny: 1 });
  });
  it("skupina: mesacna > ulozena > podla typu", () => {
    expect(skupinaPracovnika("S", {}, workers, null)).toBe("skladnik");
    expect(skupinaPracovnika("V", {}, workers, null)).toBe("ostatne");
    expect(skupinaPracovnika("V", { V: { skupina: "pozicia3" } }, workers, null)).toBe("pozicia3");
    expect(skupinaPracovnika("V", { V: { skupina: "pozicia3" } }, workers, { skupina: "hrncova" })).toBe("hrncova");
  });
});

describe("export pre uctovnicku", () => {
  it("riadok na pracovnika + sucet, legenda", () => {
    const r1 = vypocet("pozicia3", "108:25", "96:40", { uklidy: 4 }, 17);
    const r2 = vypocet("ostatne", "120:30", "72:30", { uklidy: 3 }, 16);
    const riadky = mzdyRiadkyExportu([{ meno: "P1", r: r1 }, { meno: "P2", r: r2, poznamka: "x" }]);
    expect(riadky).toHaveLength(3);
    expect(riadky[0]).toMatchObject({ "Jméno": "P1", "Skupina": "Pozice 3", "CELKEM Kč": 14031.25 });
    expect(riadky[2]).toMatchObject({ "Jméno": "CELKEM", "CELKEM Kč": 24737.5 });
    expect(mzdyRiadkyLegendy(L)[0]).toMatchObject({ "Hrncová": 165, "Skladník": 220 });
  });
});