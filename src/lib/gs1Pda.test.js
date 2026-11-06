import { describe, it, expect } from "vitest";
import { parseGs1, parseGs1Date, gs1Year, gs1CheckDigitOk, visibleControlChars, GS } from "./gs1Pda.js";

const SSCC = "106141411234567897";
const GTIN = "14001234000012";
const TODAY = new Date(2026, 9, 13);

describe("gs1CheckDigitOk", () => {
  it("platne SSCC a GTIN", () => {
    expect(gs1CheckDigitOk(SSCC)).toBe(true);
    expect(gs1CheckDigitOk("359012345000000013")).toBe(true);
    expect(gs1CheckDigitOk(GTIN)).toBe(true);
    expect(gs1CheckDigitOk("08594008000015")).toBe(true);
  });
  it("chybna kontrolna cislica", () => {
    expect(gs1CheckDigitOk("106141411234567898")).toBe(false);
    expect(gs1CheckDigitOk("14001234000013")).toBe(false);
  });
});

describe("gs1Year (GS1 7.12)", () => {
  it("aktualne storocie pri malom rozdiele", () => {
    expect(gs1Year(26, TODAY)).toBe(2026);
    expect(gs1Year(30, TODAY)).toBe(2030);
    expect(gs1Year(76, TODAY)).toBe(2076); // rozdiel +50 -> stale aktualne
    expect(gs1Year(0, TODAY)).toBe(2000);
  });
  it("rozdiel 51..99 -> minule storocie", () => {
    expect(gs1Year(77, TODAY)).toBe(1977);
    expect(gs1Year(99, TODAY)).toBe(1999);
  });
  it("rozdiel -50 a menej -> buduce storocie", () => {
    expect(gs1Year(48, new Date(2098, 0, 1))).toBe(2148);
    expect(gs1Year(49, new Date(2098, 0, 1))).toBe(2049);
  });
});

describe("parseGs1Date", () => {
  it("bezny datum", () => {
    expect(parseGs1Date("270315", TODAY)).toEqual({ iso: "2027-03-15", dayMissing: false });
  });
  it("den 00 = posledny den mesiaca (vratane priestupneho februara)", () => {
    expect(parseGs1Date("280200", TODAY)).toEqual({ iso: "2028-02-29", dayMissing: true });
    expect(parseGs1Date("270200", TODAY)).toEqual({ iso: "2027-02-28", dayMissing: true });
    expect(parseGs1Date("271100", TODAY).iso).toBe("2027-11-30");
  });
  it("neplatny mesiac/den", () => {
    expect(parseGs1Date("271315", TODAY).error).toBeTruthy();
    expect(parseGs1Date("270231", TODAY).error).toBeTruthy();
    expect(parseGs1Date("270000", TODAY).error).toBeTruthy();
  });
});

describe("parseGs1 - SSCC kod", () => {
  it("cisty (00) kod", () => {
    const r = parseGs1("00" + SSCC, TODAY);
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("sscc");
    expect(r.sscc).toBe(SSCC);
  });
  it("so symbology identifierom ]C1 a Enterom na konci", () => {
    const r = parseGs1("]C100" + SSCC + "\r\n", TODAY);
    expect(r.ok).toBe(true);
    expect(r.sscc).toBe(SSCC);
  });
  it("uvodny FNC1 ako GS", () => {
    expect(parseGs1(GS + "00" + SSCC, TODAY).sscc).toBe(SSCC);
  });
  it("chybna kontrolna cislica SSCC = chyba", () => {
    const r = parseGs1("00106141411234567898", TODAY);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/kontrolní číslici/);
  });
  it("kratke SSCC = chyba", () => {
    expect(parseGs1("0010614141123456789", TODAY).ok).toBe(false);
  });
});

describe("parseGs1 - produktovy kod", () => {
  it("(02)(15)(37) + GS + (10) - typicky NVE produktovy kod", () => {
    const r = parseGs1("02" + GTIN + "15270315" + "3748" + GS + "10L2610A", TODAY);
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("produkt");
    expect(r.gtin).toBe(GTIN);
    expect(r.gtinAi).toBe("02");
    expect(r.bbd).toBe("2027-03-15");
    expect(r.bbdAi).toBe("15");
    expect(r.count).toBe(48);
    expect(r.batch).toBe("L2610A");
  });
  it("AI 37 s premenlivou dlzkou na konci kodu (bez GS)", () => {
    expect(parseGs1("02" + GTIN + "37" + "1200", TODAY).count).toBe(1200);
    expect(parseGs1("02" + GTIN + "37" + "5", TODAY).count).toBe(5);
    expect(parseGs1("02" + GTIN + "37" + "12345678", TODAY).count).toBe(12345678);
  });
  it("AI 37 dlhsie nez 8 cislic = chyba (chyba oddelovac)", () => {
    const r = parseGs1("02" + GTIN + "37" + "48" + "10" + "1234567", TODAY);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/oddělovač/);
  });
  it("chybajuci GS medzi AI 37 a AI 10 (sarza s pismenami) = napoveda o oddelovaci", () => {
    const r = parseGs1("02" + GTIN + "3748" + "10L1", TODAY);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/nechybí oddělovač FNC1\/GS/);
  });
  it("AI 37 pred AI 10 oddelene GS", () => {
    const r = parseGs1("02" + GTIN + "37" + "60" + GS + "10" + "ABC" + GS + "15" + "270400", TODAY);
    expect(r.ok).toBe(true);
    expect(r.count).toBe(60);
    expect(r.batch).toBe("ABC");
    expect(r.bbd).toBe("2027-04-30");
    expect(r.warnings.length).toBe(1);
  });
  it("AI 17 (datum spotreby) ked chyba AI 15", () => {
    const r = parseGs1("01" + GTIN + "17" + "261231", TODAY);
    expect(r.bbd).toBe("2026-12-31");
    expect(r.bbdAi).toBe("17");
  });
  it("ma prednost AI 15 pred 17", () => {
    const r = parseGs1("01" + GTIN + "17261231" + "15261130", TODAY);
    expect(r.bbdAi).toBe("15");
    expect(r.bbd).toBe("2026-11-30");
  });
  it("nadbytocny GS za pevnym AI je tolerovany", () => {
    const r = parseGs1("02" + GTIN + GS + "15270315" + GS + "3748", TODAY);
    expect(r.ok).toBe(true);
    expect(r.count).toBe(48);
  });
  it("nahradny oddelovac | (ak Chrome zahodi GS)", () => {
    const r = parseGs1("02" + GTIN + "3748|10L1|15270315", TODAY);
    expect(r.ok).toBe(true);
    expect(r.count).toBe(48);
    expect(r.batch).toBe("L1");
  });
  it("hmotnost 3103", () => {
    const r = parseGs1("02" + GTIN + "3103" + "012345", TODAY);
    expect(r.ok).toBe(true);
    expect(r.elements[1].number).toBeCloseTo(12.345);
  });
  it("chybny GTIN check digit", () => {
    expect(parseGs1("02" + "14001234000013" + "3748", TODAY).ok).toBe(false);
  });
  it("neplatny datum v AI 15", () => {
    expect(parseGs1("02" + GTIN + "15271340", TODAY).ok).toBe(false);
  });
});

describe("parseGs1 - kombinovany a zatvorkovy format", () => {
  it("jeden kod s SSCC aj produktom", () => {
    const r = parseGs1("00" + SSCC + "02" + GTIN + "3748", TODAY);
    expect(r.kind).toBe("oboje");
  });
  it("rucne zadany format so zatvorkami", () => {
    const r = parseGs1("(02)" + GTIN + "(15)270315(37)48(10)L1", TODAY);
    expect(r.ok).toBe(true);
    expect(r.count).toBe(48);
    expect(r.batch).toBe("L1");
  });
});

describe("parseGs1 - neplatne vstupy", () => {
  it("prazdny", () => {
    expect(parseGs1("", TODAY).ok).toBe(false);
  });
  it("EAN-13 a ITF-14", () => {
    expect(parseGs1("8594008000015", TODAY).errors[0]).toMatch(/EAN/);
    expect(parseGs1(GTIN, TODAY).errors[0]).toMatch(/EAN/);
  });
  it("neznamy AI", () => {
    expect(parseGs1("99" + "x".repeat(91), TODAY).ok).toBe(false);
    expect(parseGs1("8888123", TODAY).ok).toBe(false);
  });
  it("kod bez SSCC aj GTIN", () => {
    const r = parseGs1("10ABC", TODAY);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/SSCC/);
  });
});

describe("visibleControlChars", () => {
  it("zobrazi GS a CR", () => {
    expect(visibleControlChars("01" + GS + "\r")).toBe("01⟨GS⟩⟨0d⟩");
  });
});
