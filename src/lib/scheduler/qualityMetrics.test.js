import { describe, it, expect } from "vitest";
import { evaluateScheduleQuality } from "./qualityMetrics.js";
import { makeRealisticEmployees, makeRealisticWeek, findShift } from "./testFixtures.js";

describe("evaluateScheduleQuality", () => {
  it("prazdny tyzden ma pokrytie 0", () => {
    const employees = makeRealisticEmployees();
    const week = makeRealisticWeek("2026-09-28");
    const q = evaluateScheduleQuality(week, employees, [week]);
    expect(q.coverage).toBe(0);
    expect(q.criticalRoleCoverage).toBe(0);
  });

  it("plne obsadeny 4-blok sa pocita ako fourShiftBlocks", () => {
    const employees = makeRealisticEmployees();
    const week = makeRealisticWeek("2026-09-28");
    ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"].forEach((d) => {
      findShift(week, d, "day").assigned.general.push("gen1");
    });
    const q = evaluateScheduleQuality(week, employees, [week]);
    expect(q.fourShiftBlocks).toBe(1);
    expect(q.isolatedShifts).toBe(0);
  });

  it("changedExistingAssignments pocita rozdiel oproti referencnemu tyzdnu", () => {
    const employees = makeRealisticEmployees();
    const week = makeRealisticWeek("2026-09-28");
    const reference = makeRealisticWeek("2026-09-28");
    findShift(week, "2026-09-28", "day").assigned.pos1 = "hrncova1";
    const q = evaluateScheduleQuality(week, employees, [week], { referenceWeek: reference });
    expect(q.changedExistingAssignments).toBe(1);
  });
});
