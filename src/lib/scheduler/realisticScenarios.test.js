import { describe, it, expect } from "vitest";
import { runScheduler } from "./index.js";
import { evaluateScheduleQuality } from "./qualityMetrics.js";
import { countRuns } from "./blockAnalysis.js";
import { employeeDailySequence } from "./blockAnalysis.js";
import { formatWeekRoster } from "./reportFormat.js";
import { makeRealisticEmployees, makeRealisticWeek } from "./testFixtures.js";
import { weekShiftCount } from "../../PlanSmienView.jsx";

// Validacne scenare A-E podla poziadavky na "poslednu validacnu fazu" -
// vsetko na test fixtures (makeRealisticWeek/makeRealisticEmployees), ZIADNE
// produkcne data. Kazdy scenar vypise plny human-readable roster + metriky
// do konzoly (npx vitest run) a zaroven overuje zakladne invarianty.
const MON = "2026-09-28";

function summarizeBlocks(week, employees) {
  let ddd = 0,
    nnn = 0,
    ddOrNn = 0,
    dddd = 0,
    nnnn = 0;
  employees
    .filter((e) => e.active)
    .forEach((e) => {
      countRuns(employeeDailySequence(week, e.id)).forEach((r) => {
        if (r.type === "day" && r.length >= 4) dddd++;
        else if (r.type === "night" && r.length >= 4) nnnn++;
        else if (r.length === 3) r.type === "day" ? ddd++ : nnn++;
        else if (r.length === 2) ddOrNn++;
      });
    });
  return { dddd, nnnn, ddd, nnn, ddOrNn };
}

function report(label, week, employees, warnings, allWeeks) {
  const q = evaluateScheduleQuality(week, employees, allWeeks, { warnings });
  const blocks = summarizeBlocks(week, employees);
  console.log(`\n================ SCENARIO ${label} ================`);
  console.log(formatWeekRoster(week, employees, warnings));
  console.log("\nMetrics:", JSON.stringify({ ...q, ...blocks }, null, 2));
  console.log("Warnings:", warnings.length ? JSON.stringify(warnings, null, 2) : "(none)");
  return q;
}

describe("Realisticke validacne scenare (A-E)", () => {
  it("A) bez absencii", () => {
    const employees = makeRealisticEmployees();
    const week = makeRealisticWeek(MON);
    const { week: result, warnings } = runScheduler({ mode: "fillGaps", week, employees, absences: [], allWeeks: [week] });
    const q = report("A - bez absencii", result, employees, warnings, [result]);
    expect(q.coverage).toBeGreaterThan(0.9);
    employees.forEach((e) => expect(weekShiftCount(result, e.id)).toBeLessThanOrEqual(5));
  });

  it("B) 1 dovolena cely tyden", () => {
    const employees = makeRealisticEmployees();
    const week = makeRealisticWeek(MON);
    const absences = [{ employeeId: "gen3", from: MON, to: "2026-10-02" }]; // vratane piatkovej sanitacie
    const { week: result, warnings } = runScheduler({ mode: "fillGaps", week, employees, absences, allWeeks: [week] });
    const q = report("B - 1 dovolena cely tyden (gen3)", result, employees, warnings, [result]);
    expect(weekShiftCount(result, "gen3")).toBe(0);
    employees.forEach((e) => expect(weekShiftCount(result, e.id)).toBeLessThanOrEqual(5));
  });

  it("C) 2 zamestnanci dovolenka/PN v rovnakom tyzdni", () => {
    const employees = makeRealisticEmployees();
    const week = makeRealisticWeek(MON);
    const absences = [
      { employeeId: "gen3", from: MON, to: "2026-10-02" }, // dovolenka cely tyden (vratane piatkovej sanitacie)
      { employeeId: "gen1", from: "2026-09-29", to: "2026-09-30" }, // PN 2 dni
    ];
    const { week: result, warnings } = runScheduler({ mode: "fillGaps", week, employees, absences, allWeeks: [week] });
    const q = report("C - 2 zamestnanci absencia (gen3 tyzden, gen1 PN)", result, employees, warnings, [result]);
    expect(weekShiftCount(result, "gen3")).toBe(0);
    employees.forEach((e) => expect(weekShiftCount(result, e.id)).toBeLessThanOrEqual(5));
  });

  it("D) absencia u cloveka s kritickou kvalifikaciou pos1/pos3", () => {
    const employees = makeRealisticEmployees();
    const week = makeRealisticWeek(MON);
    const absences = [{ employeeId: "hrncova1", from: MON, to: "2026-09-30" }]; // po-st, hrncova1 (pos1) mimo
    const { week: result, warnings } = runScheduler({ mode: "fillGaps", week, employees, absences, allWeeks: [week] });
    const q = report("D - absencia pos1 (hrncova1 po-st)", result, employees, warnings, [result]);
    // hrncova2 (jediny dalsi pos1) musi prevziat kriticke role pocas absencie
    ["2026-09-28", "2026-09-29", "2026-09-30"].forEach((d) => {
      const dayShift = result.shifts.find((s) => s.date === d && s.type === "day");
      expect(dayShift.assigned.pos1).not.toBe("hrncova1");
    });
    employees.forEach((e) => expect(weekShiftCount(result, e.id)).toBeLessThanOrEqual(5));
  });

  it("E) kombinovany tazsi tyzden (dovolenka + PN + lekar + part-time + nedostatok kvalifikacie)", () => {
    const employees = makeRealisticEmployees().map((e) =>
      e.id === "poz3b" ? { ...e, active: false } : e
    ); // nedostatok kritickej kvalifikacie pos3 - len poz3a zostava
    const week = makeRealisticWeek(MON);
    const absences = [
      { employeeId: "gen2", from: MON, to: "2026-10-01" }, // dovolenka cely tyden
      { employeeId: "gen4", from: "2026-09-29", to: "2026-09-30" }, // PN
      { employeeId: "poz3a", from: "2026-10-01", to: "2026-10-01" }, // lekar - jediny zostavajuci pos3 chyba jeden den
    ];
    const preferences = { zuzana: { targetWeeklyShifts: 2, preferredShiftMix: "balanced" } }; // part-time
    const { week: result, warnings } = runScheduler({ mode: "fillGaps", week, employees, absences, allWeeks: [week], preferences });
    const q = report("E - kombinovany tazky tyzden", result, employees, warnings, [result]);
    // ocakavame realny CRITICAL_ROLE_SHORTAGE na stvrtok (jediny pos3 chyba) - toto MA byt zaznamenane, nie potichu obidene
    const thursdayShortage = warnings.some((w) => w.code === "CRITICAL_ROLE_SHORTAGE" && w.shiftId.includes("2026-10-01"));
    expect(thursdayShortage).toBe(true);
    expect(weekShiftCount(result, "zuzana")).toBeLessThanOrEqual(2);
    employees.forEach((e) => expect(weekShiftCount(result, e.id)).toBeLessThanOrEqual(5));
  });
});
