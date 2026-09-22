import { describe, it, expect } from "vitest";
import { computeWeeklyIntent } from "./intent.js";
import { INTENT } from "./constants.js";
import { makeRealisticEmployees, makeRealisticWeek, findShift } from "./testFixtures.js";

describe("computeWeeklyIntent", () => {
  const employees = makeRealisticEmployees();
  const emp = employees.find((e) => e.id === "gen1");

  it("bez predchadzajuceho tyzdna a bez preferencie => FLEXIBLE", () => {
    const week = makeRealisticWeek("2026-09-28");
    const intent = computeWeeklyIntent(emp, { week, absences: [], allWeeks: [week], preferences: {} });
    expect(intent.type).toBe(INTENT.FLEXIBLE);
  });

  it("kontinuita z minuleho tyzdna (prevazne denne zmeny) => DAY_BLOCK", () => {
    const prevWeek = makeRealisticWeek("2026-09-21");
    ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"].forEach((d) => {
      findShift(prevWeek, d, "day").assigned.general.push("gen1");
    });
    const week = makeRealisticWeek("2026-09-28");
    const intent = computeWeeklyIntent(emp, { week, absences: [], allWeeks: [prevWeek, week], preferences: {} });
    expect(intent.type).toBe(INTENT.DAY_BLOCK);
  });

  it("kontinuita z minuleho tyzdna (prevazne nocne zmeny) => NIGHT_BLOCK", () => {
    const prevWeek = makeRealisticWeek("2026-09-21");
    ["2026-09-21", "2026-09-22", "2026-09-23"].forEach((d) => {
      findShift(prevWeek, d, "night").assigned.general.push("gen1");
    });
    const week = makeRealisticWeek("2026-09-28");
    const intent = computeWeeklyIntent(emp, { week, absences: [], allWeeks: [prevWeek, week], preferences: {} });
    expect(intent.type).toBe(INTENT.NIGHT_BLOCK);
  });

  it("explicitna preferencia (data-driven) prebije kontinuitu z minula", () => {
    const prevWeek = makeRealisticWeek("2026-09-21");
    findShift(prevWeek, "2026-09-21", "night").assigned.general.push("zuzana");
    const week = makeRealisticWeek("2026-09-28");
    const zuzana = employees.find((e) => e.id === "zuzana");
    const intent = computeWeeklyIntent(zuzana, {
      week,
      absences: [],
      allWeeks: [prevWeek, week],
      preferences: { zuzana: { targetWeeklyShifts: 2, preferredShiftMix: "day" } },
    });
    expect(intent.type).toBe(INTENT.DAY_BLOCK);
    expect(intent.targetShifts).toBe(2);
  });

  it("vysoke pokrytie absenciou => OFF_PARTIAL so znizenym cielom", () => {
    const week = makeRealisticWeek("2026-09-28");
    const absences = [{ employeeId: "gen1", from: "2026-09-28", to: "2026-10-01" }]; // po-ct = cely hlavny tyzden
    const intent = computeWeeklyIntent(emp, { week, absences, allWeeks: [week], preferences: {} });
    expect(intent.type).toBe(INTENT.OFF_PARTIAL);
  });
});
