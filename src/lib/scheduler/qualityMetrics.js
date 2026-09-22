// evaluateScheduleQuality() - jediny zdroj pravdy pre porovnanie OLD vs NEW
// (benchmark.test.js) a pre buduci UI/report. Ciste funkcie, ziadny vedlajsi
// efekt na vstupny tyzden.
import { shiftTotal, shiftPeopleIds, weekShiftCount } from "../../PlanSmienView.jsx";
import { employeeDailySequence, countRuns, findBadPatterns } from "./blockAnalysis.js";
import { NORMAL_TARGET_SHIFTS } from "./constants.js";

function variance(nums) {
  if (nums.length === 0) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  return nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
}

function countChangedAssignments(week, referenceWeek) {
  let changed = 0;
  week.shifts.forEach((s) => {
    const ref = referenceWeek.shifts.find((r) => r.id === s.id);
    if (!ref) {
      changed += shiftPeopleIds(s).length;
      return;
    }
    if (s.assigned.pos1 !== ref.assigned.pos1) changed++;
    if (s.assigned.pos3 !== ref.assigned.pos3) changed++;
    const refGeneral = new Set(ref.assigned.general);
    const curGeneral = new Set(s.assigned.general);
    s.assigned.general.forEach((id) => {
      if (!refGeneral.has(id)) changed++;
    });
    ref.assigned.general.forEach((id) => {
      if (!curGeneral.has(id)) changed++;
    });
  });
  return changed;
}

export function evaluateScheduleQuality(week, employees, allWeeks, options = {}) {
  const activeEmployees = employees.filter((e) => e.active);

  let filledSlots = 0,
    totalSlots = 0,
    criticalFilled = 0,
    criticalTotal = 0;
  week.shifts.forEach((s) => {
    const total = shiftTotal(s);
    if (total === 0) return;
    totalSlots += total;
    filledSlots += shiftPeopleIds(s).length;
    criticalTotal += 2;
    if (s.assigned.pos1) criticalFilled++;
    if (s.assigned.pos3) criticalFilled++;
  });

  let fourShiftBlocks = 0,
    threeShiftBlocks = 0,
    twoShiftBlocks = 0,
    isolatedShifts = 0,
    dayToNightTransitions = 0,
    nightToDayTransitions = 0,
    fragmentedPatterns = 0,
    employeesAboveNormalFourShiftTarget = 0;
  const dayTotals = [],
    nightTotals = [];

  activeEmployees.forEach((e) => {
    const seq = employeeDailySequence(week, e.id);
    countRuns(seq).forEach((r) => {
      if (r.length >= 4) fourShiftBlocks++;
      else if (r.length === 3) threeShiftBlocks++;
      else if (r.length === 2) twoShiftBlocks++;
      else isolatedShifts++;
    });
    for (let i = 1; i < seq.length; i++) {
      if (seq[i - 1] === "day" && seq[i] === "night") dayToNightTransitions++;
      if (seq[i - 1] === "night" && seq[i] === "day") nightToDayTransitions++;
    }
    fragmentedPatterns += findBadPatterns(seq).length;
    dayTotals.push(seq.filter((s) => s === "day").length);
    nightTotals.push(seq.filter((s) => s === "night").length);
    if (weekShiftCount(week, e.id) > NORMAL_TARGET_SHIFTS) employeesAboveNormalFourShiftTarget++;
  });

  return {
    coverage: totalSlots ? filledSlots / totalSlots : 1,
    criticalRoleCoverage: criticalTotal ? criticalFilled / criticalTotal : 1,
    fourShiftBlocks,
    threeShiftBlocks,
    twoShiftBlocks,
    isolatedShifts,
    dayToNightTransitions,
    nightToDayTransitions,
    fragmentedPatterns,
    employeesAboveNormalFourShiftTarget,
    fairnessDayVariance: variance(dayTotals),
    fairnessNightVariance: variance(nightTotals),
    changedExistingAssignments: options.referenceWeek ? countChangedAssignments(week, options.referenceWeek) : null,
    warningsCount: options.warnings ? options.warnings.length : 0,
  };
}
