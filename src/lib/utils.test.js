import { describe, it, expect } from "vitest";
import { extractCityFromAddress, formatDateTime, parseSkDate, isoFromSkDateStr, skDateStrFromIso, durationMinutes } from "./utils.js";

describe("durationMinutes", () => {
  it("vypocita rozdiel v minutach", () => {
    expect(durationMinutes("09:00", "09:15")).toBe(15);
    expect(durationMinutes("08:50", "09:05")).toBe(15);
  });

  it("vrati null ak chyba zaciatok alebo koniec", () => {
    expect(durationMinutes("", "09:15")).toBeNull();
    expect(durationMinutes("09:00", "")).toBeNull();
  });

  it("zvladne prestavku cez polnoc", () => {
    expect(durationMinutes("23:50", "00:05")).toBe(15);
  });
});

describe("parseSkDate", () => {
  it("vrati null pre prazdny alebo neplatny vstup", () => {
    expect(parseSkDate("")).toBeNull();
    expect(parseSkDate(null)).toBeNull();
    expect(parseSkDate("nieco")).toBeNull();
  });

  it("naparsuje DD.MM.RRRR na Date", () => {
    const d = parseSkDate("07.08.2026");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(7);
  });
});

describe("isoFromSkDateStr / skDateStrFromIso", () => {
  it("prevedie DD.MM.RRRR na ISO a spat", () => {
    expect(isoFromSkDateStr("07.08.2026")).toBe("2026-08-07");
    expect(skDateStrFromIso("2026-08-07")).toBe("07.08.2026");
  });

  it("vrati prazdny retazec pre neplatny vstup", () => {
    expect(isoFromSkDateStr("")).toBe("");
    expect(isoFromSkDateStr("nieco")).toBe("");
    expect(skDateStrFromIso("")).toBe("");
    expect(skDateStrFromIso("nieco")).toBe("");
  });
});

describe("extractCityFromAddress", () => {
  it("vrati prazdny retazec pre prazdnu adresu", () => {
    expect(extractCityFromAddress("")).toBe("");
    expect(extractCityFromAddress(null)).toBe("");
  });

  it("vytiahne mesto za PSC", () => {
    expect(extractCityFromAddress("Hlavna 1, 811 01 Bratislava")).toBe("BRATISLAVA");
  });

  it("funguje aj s viacriadkovou adresou", () => {
    expect(extractCityFromAddress("Hlavna 1\n811 01 Bratislava\nSlovensko")).toBe("BRATISLAVA");
  });
});

describe("formatDateTime", () => {
  it("vrati prazdny retazec pre prazdnu hodnotu", () => {
    expect(formatDateTime("")).toBe("");
    expect(formatDateTime(null)).toBe("");
  });

  it("formatuje ISO datum na DD.MM.RRRR HH:MM", () => {
    const d = new Date(2026, 7, 4, 9, 5); // mesiac je 0-indexovany => august
    expect(formatDateTime(d.toISOString())).toBe("04.08.2026 09:05");
  });
});
