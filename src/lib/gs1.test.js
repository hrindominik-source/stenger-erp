import { describe, it, expect } from "vitest";
import { parseGs1, parseGs1Detail, gs1Datum, mergeScans, dmtZTrvanlivosti, mnozstvoPalety } from "./gs1.js";

const GS = "\u001d";

// Vymyslene cisla v tvare skutocnych etikiet (SSCC 18, GTIN 14 cislic).
describe("parseGs1", () => {
  it("surovy kod s GS oddelovacom a symbology prefixom", () => {
    const r = parseGs1(`]C10212345678901231370084${GS}15291016`);
    expect(r.gtin).toBe("12345678901231");
    expect(r.pocet).toBe(84);
    expect(r.dmt).toBe("16.10.2029");
  });

  it("SSCC + sarza na konci bez GS", () => {
    const r = parseGs1("00123456789012345675" + "10LOT-A1");
    expect(r.sscc).toBe("123456789012345675");
    expect(r.sarza).toBe("LOT-A1");
  });

  it("zatvorkovy zapis a viac kodov jednej etikety naraz", () => {
    const r = parseGs1("(400)123/0511(11)261104(10)55501\n(02)04012345678901(91)900000000001(37)00001080\n(00)340123456789012340");
    expect(r.objednavka).toBe("123/0511");
    expect(r.datumVyroby).toBe("04.11.2026");
    expect(r.sarza).toBe("55501");
    expect(r.gtin).toBe("04012345678901");
    expect(r.pocet).toBe(1080);
    expect(r.sscc).toBe("340123456789012340");
  });

  it("premenna dlzka (400) pred dalsim AI oddelena GS", () => {
    const r = parseGs1(`400123/0511${GS}1126110410ABC`);
    expect(r.objednavka).toBe("123/0511");
    expect(r.datumVyroby).toBe("04.11.2026");
    expect(r.sarza).toBe("ABC");
  });

  it("netto hmotnost 310x", () => {
    expect(parseGs1("02123456789012313103760000").nettoKg).toBe(760);
    expect(parseGs1("0212345678901231310100084" + "0").nettoKg).toBe(84);
  });

  it("kod bez udajov palety alebo neznamy kod hodi chybu", () => {
    expect(() => parseGs1("")).toThrow();
    expect(() => parseGs1("15131814")).toThrow();
    expect(() => parseGs1("(37)01")).toThrow(/neobsahuje/);
  });
});

describe("gs1Datum", () => {
  it("RRMMDD a den 00 = posledny den mesiaca", () => {
    expect(gs1Datum("270925")).toBe("25.09.2027");
    expect(gs1Datum("280200")).toBe("29.02.2028");
    expect(gs1Datum("261300")).toBe("");
    expect(gs1Datum("")).toBe("");
  });
});

describe("mergeScans", () => {
  it("doplni chybajuce udaje z druheho kodu", () => {
    const a = parseGs1("(37)01(15)270925(10)V1");
    const b = parseGs1("(00)335770000000000005(15)270925");
    const m = mergeScans(a, b);
    expect(m).toMatchObject({ sscc: "335770000000000005", sarza: "V1", dmt: "25.09.2027", pocet: 1 });
  });
});

describe("dmtZTrvanlivosti", () => {
  it("datum vyroby + mesiace", () => {
    expect(dmtZTrvanlivosti("23.07.2026", 12)).toBe("23.07.2027");
    expect(dmtZTrvanlivosti("", 12)).toBe("");
    expect(dmtZTrvanlivosti("23.07.2026", "")).toBe("");
  });
});

describe("mnozstvoPalety", () => {
  it("pocet x mnozstvo v jednom baleni, netto kg ma prednost", () => {
    expect(mnozstvoPalety({ pocet: 84, nettoKg: null }, { jednotka: "kg", mnozstvoNaKs: 10 })).toBe(840);
    expect(mnozstvoPalety({ pocet: 1, nettoKg: 760 }, { jednotka: "kg", mnozstvoNaKs: 1 })).toBe(760);
    expect(mnozstvoPalety({ pocet: 1080, nettoKg: null }, { jednotka: "ks", mnozstvoNaKs: 1 })).toBe(1080);
    expect(mnozstvoPalety({ pocet: 1080, nettoKg: null }, null)).toBe(1080);
    expect(mnozstvoPalety({ pocet: null, nettoKg: null }, null)).toBe(null);
  });
});

describe("kontrolne cislice", () => {
  it("vlastny kod dodavatela zacinajuci 00 sa neprecita ako SSCC", () => {
    expect(() => parseGs1("00010124305400000086553819")).toThrow();
    expect(() => parseGs1("00123456789012345670")).toThrow(/SSCC/);
    expect(() => parseGs1("0212345678901232")).toThrow(/GTIN/);
  });
});

describe("prijem a PDA pouzivaju ten isty parser", () => {
  it("nahradny oddelovac | (DataWedge bez GS) funguje aj v prijme", () => {
    const r = parseGs1("0212345678901231" + "3784|10LOT7");
    expect(r.pocet).toBe(84);
    expect(r.sarza).toBe("LOT7");
  });

  it("chybajuci GS za mnozstvom = zrozumitelna chyba namiesto zlych udajov", () => {
    expect(() => parseGs1("0212345678901231" + "378410LOT7")).toThrow(/FNC1|GS/);
  });

  it("storocie datumu podla GS1 (nie natvrdo 20xx)", () => {
    const dnes = new Date(Date.UTC(2026, 10, 6));
    expect(gs1Datum("991231", dnes)).toBe("31.12.1999");
    expect(gs1Datum("270925", dnes)).toBe("25.09.2027");
  });

  it("PDA detail vracia chyby namiesto vynimky", () => {
    const r = parseGs1Detail("(10)L1");
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/SSCC/);
    expect(parseGs1Detail("(00)123456789012345675").sscc).toBe("123456789012345675");
  });
});
