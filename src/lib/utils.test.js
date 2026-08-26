import { describe, it, expect } from "vitest";
import { extractCityFromAddress, formatDateTime, parseSkDate, isoFromSkDateStr, skDateStrFromIso, durationMinutes, formatMinutes, computeNextDue, daysUntil } from "./utils.js";

function skDateFromOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

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

describe("formatMinutes", () => {
  it("zobrazi len minuty ak je to menej nez hodina", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(0)).toBe("0 min");
  });

  it("zobrazi hodiny a minuty", () => {
    expect(formatMinutes(281)).toBe("4 h 41 min");
  });

  it("zobrazi len hodiny ak su minuty presne 0", () => {
    expect(formatMinutes(120)).toBe("2 h");
  });

  it("vrati prazdny retazec pre null/undefined", () => {
    expect(formatMinutes(null)).toBe("");
    expect(formatMinutes(undefined)).toBe("");
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

  it("preskoci samostatny riadok s nazvom krajiny na konci adresy", () => {
    expect(extractCityFromAddress("Mesonweg 2\n3542AL UTRECHT\nNIEDERLANDE")).toBe("UTRECHT");
    expect(extractCityFromAddress("Edekastraße 1\n76437 Rastatt\nDEUTSCHLAND")).toBe("RASTATT");
  });
});

describe("computeNextDue", () => {
  it("pripocita dni/tyzdne/mesiace/roky k poslednemu datumu", () => {
    expect(computeNextDue("01.01.2026", "dni", 10)).toBe("11.01.2026");
    expect(computeNextDue("01.01.2026", "tyzdne", 2)).toBe("15.01.2026");
    expect(computeNextDue("01.01.2026", "mesiace", 1)).toBe("01.02.2026");
    expect(computeNextDue("01.01.2026", "roky", 1)).toBe("01.01.2027");
  });

  it("vrati prazdny retazec pre neplatny vstup", () => {
    expect(computeNextDue("", "dni", 10)).toBe("");
    expect(computeNextDue("01.01.2026", "dni", 0)).toBe("");
    expect(computeNextDue("01.01.2026", "nieco", 5)).toBe("");
  });
});

describe("daysUntil", () => {
  it("vrati kladne cislo pre datum v buducnosti", () => {
    expect(daysUntil(skDateFromOffset(5))).toBe(5);
  });

  it("vrati zaporne cislo pre datum po terminu", () => {
    expect(daysUntil(skDateFromOffset(-5))).toBe(-5);
  });

  it("vrati null pre neplatny vstup", () => {
    expect(daysUntil("")).toBeNull();
    expect(daysUntil("nieco")).toBeNull();
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
