// Tyzdenny "zamer" zmeny pre kazdeho zamestnanca - pocita sa PRED priradenim
// jednotlivych slotov (na rozdiel od povodneho algoritmu, kde poradie plnenia
// bolo jedinym zdrojom kontinuity). Zamer urcuje, ci sa ma clovek tento tyzden
// snazit o DAY_BLOCK / NIGHT_BLOCK / je FLEXIBLE / alebo ma len OFF_PARTIAL
// kapacitu kvoli absencii.
import { isOnAbsence } from "../../PlanSmienView.jsx";
import { addDaysLocal } from "./dateUtils.js";
import { INTENT, NORMAL_TARGET_SHIFTS } from "./constants.js";
import { employeeDailySequence } from "./blockAnalysis.js";

function priorWeek(allWeeks, week) {
  const prevId = addDaysLocal(week.startDate, -7);
  return allWeeks.find((w) => w.id === prevId) || null;
}

// Kontinuita z predchadzajuceho tyzdna - ak niekto minuly tyzden robil hlavne
// denne zmeny, defaultne sa preferuje ist v tom aj tento tyzden (a naopak).
function priorWeekIntentHint(allWeeks, week, empId) {
  const prev = priorWeek(allWeeks, week);
  if (!prev) return null;
  const seq = employeeDailySequence(prev, empId);
  const dayCount = seq.filter((s) => s === "day").length;
  const nightCount = seq.filter((s) => s === "night").length;
  if (dayCount === 0 && nightCount === 0) return null;
  return dayCount >= nightCount ? INTENT.DAY_BLOCK : INTENT.NIGHT_BLOCK;
}

// Hruby odhad "ako vela z tyzdna moze odpracovat" - pomer hlavnych dni (po-ct),
// kedy je na absencii, k celkovemu poctu hlavnych dni.
function absenceCoverageRatio(empId, week, absences) {
  const days = [...new Set(week.shifts.filter((s) => s.type !== "sanitation").map((s) => s.date))];
  if (days.length === 0) return 0;
  const onAbsence = days.filter((d) => isOnAbsence(empId, d, absences)).length;
  return onAbsence / days.length;
}

export function computeWeeklyIntent(employee, ctx) {
  const { week, absences, allWeeks, preferences } = ctx;
  const pref = preferences && preferences[employee.id];
  const target = Math.min(employee.weeklyMax, (pref && pref.targetWeeklyShifts) || NORMAL_TARGET_SHIFTS);

  const coverage = absenceCoverageRatio(employee.id, week, absences);
  if (coverage >= 0.6) {
    return { type: INTENT.OFF_PARTIAL, targetShifts: Math.max(0, Math.round(target * (1 - coverage))), preferredMix: null };
  }

  if (pref && pref.preferredShiftMix === "day") return { type: INTENT.DAY_BLOCK, targetShifts: target, preferredMix: "day" };
  if (pref && pref.preferredShiftMix === "night") return { type: INTENT.NIGHT_BLOCK, targetShifts: target, preferredMix: "night" };
  if (pref && pref.preferredShiftMix === "balanced") return { type: INTENT.FLEXIBLE, targetShifts: target, preferredMix: "balanced" };

  const hint = priorWeekIntentHint(allWeeks, week, employee.id);
  if (hint) return { type: hint, targetShifts: target, preferredMix: null };

  return { type: INTENT.FLEXIBLE, targetShifts: target, preferredMix: null };
}

export function computeWeeklyIntents(employees, ctx) {
  const map = new Map();
  employees
    .filter((e) => e.active)
    .forEach((e) => map.set(e.id, computeWeeklyIntent(e, ctx)));
  return map;
}
