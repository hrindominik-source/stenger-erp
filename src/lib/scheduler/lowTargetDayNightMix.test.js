import { describe, it, expect } from "vitest";
import { runScheduler } from "./index.js";
import { employeeDailySequence } from "./blockAnalysis.js";
import { makeRealisticEmployees, makeRealisticWeek } from "./testFixtures.js";
import { weekShiftCount } from "../../PlanSmienView.jsx";

// Poziadavka: zamestnanec s nizkym osobnym cielom (napr. Svobodova,
// weeklyMax=2) by mal defaultne dostat 1 dennu + 1 nocnu zmenu, nie dve
// rovnake za sebou - na rozdiel od plneho tímu, kde je suvisly blok
// zelanym stavom. Je to len mäkke vodidlo (kolega to moze rucne zmenit),
// nie tvrde pravidlo.
const MON = "2026-09-28";

describe("nizky osobny ciel (<=2) preferuje 1 dennu + 1 nocnu pred dvoma rovnakymi", () => {
  it("Svobodova (weeklyMax=2) dostane pri plnom dopyte na oboch typoch zmien jednu dennu a jednu nocnu", () => {
    const employees = makeRealisticEmployees(); // zuzana.weeklyMax=2 (viz testFixtures.js)
    const week = makeRealisticWeek(MON);
    const { week: result } = runScheduler({ mode: "fillGaps", week, employees, absences: [], allWeeks: [week] });

    expect(weekShiftCount(result, "zuzana")).toBeLessThanOrEqual(2);
    const seq = employeeDailySequence(result, "zuzana");
    const dayCount = seq.filter((s) => s === "day").length;
    const nightCount = seq.filter((s) => s === "night").length;
    // ak dostala presne 2 zmeny, mali by byt 1 denna + 1 nocna (nie 2x rovnaky typ)
    if (dayCount + nightCount === 2) {
      expect(dayCount).toBe(1);
      expect(nightCount).toBe(1);
    }
  });

  it("normalny zamestnanec (weeklyMax=4) NIE JE touto zmenou ovplyvneny - suvisly blok zostava preferovany", () => {
    const employees = makeRealisticEmployees();
    const week = makeRealisticWeek(MON);
    const { week: result } = runScheduler({ mode: "fillGaps", week, employees, absences: [], allWeeks: [week] });
    const seq = employeeDailySequence(result, "gen1"); // weeklyMax=4, ziadna specialna preferencia
    const dayCount = seq.filter((s) => s === "day").length;
    const nightCount = seq.filter((s) => s === "night").length;
    // typicky dostane suvisly blok jedneho typu (DDDD alebo NNNN), nie mix - toto len potvrdzuje,
    // ze noveho pravidlo neovplyvnuje ludi s personalTarget>2
    expect(dayCount === 0 || nightCount === 0).toBe(true);
  });
});
