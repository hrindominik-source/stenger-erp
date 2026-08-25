import { describe, it, expect } from "vitest";
import {
  shiftInterval,
  clampShiftStart,
  subtractBreaks,
  isPublicHoliday,
  classifyInterval,
  computeDayHours,
  summarizeMonth,
  MESACNA_NORMA_HOD,
} from "./dochadzka.js";

describe("shiftInterval", () => {
  it("postavi interval v ramci jedneho dna", () => {
    const i = shiftInterval("17.08.2026", "08:00", "16:00");
    expect(i.start.getHours()).toBe(8);
    expect(i.end.getHours()).toBe(16);
    expect((i.end.getTime() - i.start.getTime()) / 60000).toBe(480);
  });

  it("zvladne prechod cez polnoc", () => {
    const i = shiftInterval("17.08.2026", "22:00", "06:00");
    expect((i.end.getTime() - i.start.getTime()) / 60000).toBe(480);
    expect(i.end.getDate()).toBe(18);
  });

  it("vrati null pri chybajucich udajoch", () => {
    expect(shiftInterval("17.08.2026", "08:00", "")).toBeNull();
    expect(shiftInterval("", "08:00", "16:00")).toBeNull();
  });
});

describe("clampShiftStart", () => {
  const nastaveny = "06:00";

  it("orezne skory prichod v ramci povoleneho okna", () => {
    const i = shiftInterval("17.08.2026", "05:30", "14:00");
    const c = clampShiftStart(i, nastaveny);
    expect(c.start.getHours()).toBe(6);
    expect(c.start.getMinutes()).toBe(0);
  });

  it("neorezne prichod mimo povoleneho okna (napr. nocna zmena)", () => {
    const i = shiftInterval("17.08.2026", "01:00", "09:00");
    const c = clampShiftStart(i, nastaveny, 4);
    expect(c.start.getHours()).toBe(1);
  });

  it("nemeni interval ak prichod je po zaciatku zmeny", () => {
    const i = shiftInterval("17.08.2026", "06:15", "14:00");
    const c = clampShiftStart(i, nastaveny);
    expect(c.start.getHours()).toBe(6);
    expect(c.start.getMinutes()).toBe(15);
  });

  it("nemeni interval ak nie je nastaveny zaciatok zmeny", () => {
    const i = shiftInterval("17.08.2026", "05:30", "14:00");
    const c = clampShiftStart(i, null);
    expect(c.start.getHours()).toBe(5);
  });
});

describe("subtractBreaks", () => {
  it("odpocita prestavku v strede zmeny", () => {
    const shift = shiftInterval("17.08.2026", "08:00", "16:00");
    const brk = shiftInterval("17.08.2026", "12:00", "12:30");
    const segs = subtractBreaks(shift, [brk]);
    const totalMin = segs.reduce((s, seg) => s + (seg.end.getTime() - seg.start.getTime()) / 60000, 0);
    expect(totalMin).toBe(450);
    expect(segs.length).toBe(2);
  });

  it("zluci prekryvajuce sa prestavky", () => {
    const shift = shiftInterval("17.08.2026", "08:00", "16:00");
    const b1 = shiftInterval("17.08.2026", "12:00", "12:40");
    const b2 = shiftInterval("17.08.2026", "12:30", "13:00");
    const segs = subtractBreaks(shift, [b1, b2]);
    const totalMin = segs.reduce((s, seg) => s + (seg.end.getTime() - seg.start.getTime()) / 60000, 0);
    expect(totalMin).toBe(420);
  });

  it("orezne prestavku presahujucu hranice zmeny", () => {
    const shift = shiftInterval("17.08.2026", "08:00", "16:00");
    const brk = shiftInterval("17.08.2026", "07:00", "09:00");
    const segs = subtractBreaks(shift, [brk]);
    expect(segs[0].start.getHours()).toBe(9);
  });
});

describe("isPublicHoliday", () => {
  it("rozpozna fixny sviatok", () => {
    expect(isPublicHoliday(new Date(2026, 4, 1))).toBe(true);
    expect(isPublicHoliday(new Date(2026, 9, 28))).toBe(true);
  });

  it("rozpozna pohyblivy Velkonocny pondelok", () => {
    expect(isPublicHoliday(new Date(2026, 3, 6))).toBe(true);
  });

  it("bezny den ani vikend nie je sviatok", () => {
    expect(isPublicHoliday(new Date(2026, 7, 17))).toBe(false);
    expect(isPublicHoliday(new Date(2026, 7, 22))).toBe(false);
  });
});

describe("classifyInterval", () => {
  it("bezny pracovny den bez noci a vikendu", () => {
    const i = shiftInterval("17.08.2026", "08:00", "16:00");
    const c = classifyInterval(i);
    expect(c).toEqual({ totalMin: 480, nightMin: 0, weekendMin: 0, holidayMin: 0 });
  });

  it("smena presahujuca do nocneho okna (18:00-06:00)", () => {
    const i = shiftInterval("17.08.2026", "16:00", "20:00");
    const c = classifyInterval(i);
    expect(c.totalMin).toBe(240);
    expect(c.nightMin).toBe(120);
  });

  it("nocna smena cez polnoc - cele odpracovane su nocne hodiny", () => {
    const i = shiftInterval("17.08.2026", "22:00", "06:00");
    const c = classifyInterval(i);
    expect(c.totalMin).toBe(480);
    expect(c.nightMin).toBe(480);
  });

  it("vikendova smena", () => {
    const i = shiftInterval("22.08.2026", "08:00", "16:00");
    const c = classifyInterval(i);
    expect(c.weekendMin).toBe(480);
    expect(c.holidayMin).toBe(0);
  });

  it("sviatocna smena ma prioritu pred vikendom", () => {
    const i = shiftInterval("01.05.2026", "08:00", "16:00");
    const c = classifyInterval(i);
    expect(c.holidayMin).toBe(480);
    expect(c.weekendMin).toBe(0);
  });
});

describe("computeDayHours", () => {
  it("bezny zaznam bez prestavky a bez orezania", () => {
    const rec = { meno: "Jana", datum: "17.08.2026", casZaciatku: "08:00", casKonca: "16:00" };
    const h = computeDayHours(rec, [], null);
    expect(h.totalMin).toBe(480);
  });

  it("orezanie skoreho prichodu podla nastaveneho zaciatku zmeny", () => {
    const rec = { meno: "Jana", datum: "17.08.2026", casZaciatku: "05:30", casKonca: "14:00" };
    const h = computeDayHours(rec, [], "06:00");
    expect(h.totalMin).toBe(480);
  });

  it("neorezava prichod mimo povoleneho okna", () => {
    const rec = { meno: "Jana", datum: "17.08.2026", casZaciatku: "01:00", casKonca: "09:00" };
    const h = computeDayHours(rec, [], "06:00");
    expect(h.totalMin).toBe(480);
  });

  it("vrati null pre nedokonceny zaznam", () => {
    const rec = { meno: "Jana", datum: "17.08.2026", casZaciatku: "08:00", casKonca: "" };
    expect(computeDayHours(rec, [], null)).toBeNull();
  });

  it("odpocita uzavretu prestavku rovnakeho pracovnika", () => {
    const rec = { meno: "Jana", datum: "17.08.2026", casZaciatku: "08:00", casKonca: "16:00" };
    const pauzy = [{ meno: "Jana", datum: "17.08.2026", casZaciatku: "12:00", casKonca: "12:30" }];
    const h = computeDayHours(rec, pauzy, null);
    expect(h.totalMin).toBe(450);
  });

  it("ignoruje prestavku ineho pracovnika", () => {
    const rec = { meno: "Jana", datum: "17.08.2026", casZaciatku: "08:00", casKonca: "16:00" };
    const pauzy = [{ meno: "Petr", datum: "17.08.2026", casZaciatku: "12:00", casKonca: "12:30" }];
    const h = computeDayHours(rec, pauzy, null);
    expect(h.totalMin).toBe(480);
  });

  it("otvorena prestavka pocas zmeny blokuje cely den", () => {
    const rec = { meno: "Jana", datum: "17.08.2026", casZaciatku: "08:00", casKonca: "16:00" };
    const pauzy = [{ meno: "Jana", datum: "17.08.2026", casZaciatku: "12:00", casKonca: "" }];
    expect(computeDayHours(rec, pauzy, null)).toBeNull();
  });
});

describe("summarizeMonth", () => {
  it("scita hodiny len pre spravneho pracovnika a pocita prescas nad 160h", () => {
    const prestavky = [];
    for (let d = 1; d <= 21; d++) {
      const datum = `${String(d).padStart(2, "0")}.08.2026`;
      prestavky.push({ id: `p${d}`, meno: "Jana", datum, casZaciatku: "08:00", casKonca: "16:00" });
    }
    prestavky.push({ id: "px", meno: "Petr", datum: "17.08.2026", casZaciatku: "08:00", casKonca: "12:00" });

    const workersByMeno = { Jana: { typ: "vyroba" }, Petr: { typ: "sklad" } };
    const nastavenia = { zaciatokVyroba: "08:00", zaciatokSklad: "08:00" };
    const summary = summarizeMonth(prestavky, [], workersByMeno, nastavenia);

    expect(summary.Jana.celkemHod).toBe(168);
    expect(summary.Jana.prescasHod).toBe(168 - MESACNA_NORMA_HOD);
    expect(summary.Petr.celkemHod).toBe(4);
    expect(summary.Petr.prescasHod).toBe(0);
  });

  it("neorezanemu pracovnikovi bez znameho typu sa nemeni prichod", () => {
    const prestavky = [{ id: "p1", meno: "Neznamy", datum: "17.08.2026", casZaciatku: "05:00", casKonca: "13:00" }];
    const summary = summarizeMonth(prestavky, [], {}, { zaciatokVyroba: "08:00", zaciatokSklad: "08:00" });
    expect(summary.Neznamy.celkemHod).toBe(8);
  });
});
