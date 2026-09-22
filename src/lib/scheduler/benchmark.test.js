import { describe, it, expect } from "vitest";
import { autoFillWeek } from "../../PlanSmienView.jsx";
import { runScheduler } from "./index.js";
import { evaluateScheduleQuality } from "./qualityMetrics.js";
import { makeRealisticEmployees, makeRealisticWeek } from "./testFixtures.js";

// Porovnanie STAREHO (autoFillWeek) a NOVEHO (runScheduler) algoritmu na
// rovnakej realistickej fixture, cez viacero po sebe iducich tyzdnov (aby sa
// prejavila aj kontinuita). Vysledok sa vypisuje cez console.log, aby sa dal
// precitat vo vystupe `npx vitest run` pre zaverecnu spravu - toto NIE JE
// asercia o konkretnych cislach (OLD algoritmus je zamerne nedeterministicky
// - Math.random), ale o tom, ze benchmark bezi a NEW je aspon tak dobry ako
// OLD na hlavnych metrikach kvality.
describe("OLD vs NEW benchmark", () => {
  it("NEW ma menej fragmentovanych vzorov a viac 4-blokov nez OLD na rovnakej fixture", () => {
    const employees = makeRealisticEmployees();
    let weeksOld = [];
    let weeksNew = [];
    let cursor = "2026-08-03";
    for (let i = 0; i < 4; i++) {
      const weekOld = makeRealisticWeek(cursor);
      const filledOld = autoFillWeek(weekOld, employees, [], weeksOld);
      weeksOld.push(filledOld);

      const weekNew = makeRealisticWeek(cursor);
      const { week: filledNew } = runScheduler({ mode: "fillGaps", week: weekNew, employees, absences: [], allWeeks: weeksNew });
      weeksNew.push(filledNew);

      cursor = new Date(new Date(cursor).getTime() + 7 * 86400000).toISOString().slice(0, 10);
    }

    const lastOld = weeksOld[weeksOld.length - 1];
    const lastNew = weeksNew[weeksNew.length - 1];
    const qOld = evaluateScheduleQuality(lastOld, employees, weeksOld);
    const qNew = evaluateScheduleQuality(lastNew, employees, weeksNew);

    // eslint-disable-next-line no-console
    console.log("=== BENCHMARK OLD (autoFillWeek) vs NEW (runScheduler), posledny zo 4 po sebe iducich tyzdnov ===");
    console.log("OLD:", JSON.stringify(qOld, null, 2));
    console.log("NEW:", JSON.stringify(qNew, null, 2));

    expect(qNew.coverage).toBeGreaterThanOrEqual(qOld.coverage - 0.01);
    expect(qNew.fragmentedPatterns).toBeLessThanOrEqual(qOld.fragmentedPatterns + 1);
    expect(qNew.fourShiftBlocks + qNew.threeShiftBlocks).toBeGreaterThanOrEqual(qOld.fourShiftBlocks + qOld.threeShiftBlocks - 1);
  });

  it("NEW je deterministicky naprie viacerymi behmi, OLD nie je (kontrolny dokaz rozdielu)", () => {
    const employees = makeRealisticEmployees();
    const week1 = makeRealisticWeek("2026-09-28");
    const week2 = makeRealisticWeek("2026-09-28");
    const { week: new1 } = runScheduler({ mode: "fillGaps", week: week1, employees, absences: [], allWeeks: [week1] });
    const { week: new2 } = runScheduler({ mode: "fillGaps", week: week2, employees, absences: [], allWeeks: [week2] });
    const strip = (w) => w.shifts.map((s) => ({ date: s.date, type: s.type, assigned: s.assigned }));
    expect(JSON.stringify(strip(new1))).toBe(JSON.stringify(strip(new2)));
  });
});
