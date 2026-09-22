// Verejne API noveho schedulovacieho enginu.
//
// mode: 'fillGaps' - nikdy neprepisuje existujuce priradenia, len doplna
//                     prazdne miesta (rovnaka zaruka ako povodny autoFillWeek).
//     | 'replan'   - cisty prepocet cele tyzdna, zachovava LEN priradenia
//                     explicitne oznacene shift.preserveOnReplan.
//
// Nikdy sa nevola na tyzden, ktory canReplan/canAutoFill (planSmienGuard.js)
// oznacilo ako blokovany (past/current) - to je zodpovednost volajuceho v
// PlanSmienView.jsx, presne ako pri povodnom autoFillWeek.
import { constructSchedule } from "./construct.js";
import { localImprovement } from "./localImprovement.js";
import { evaluateScheduleQuality } from "./qualityMetrics.js";
import { INTENT, WARNING, NORMAL_TARGET_SHIFTS, HARD_MAX_SHIFTS } from "./constants.js";

export function runScheduler({ mode, week, employees, absences, allWeeks, preferences, referenceWeek }) {
  if (mode !== "fillGaps" && mode !== "replan") {
    throw new Error(`runScheduler: neznamy mode "${mode}" (ocakava sa 'fillGaps' alebo 'replan')`);
  }
  const { week: constructed, warnings } = constructSchedule({ mode, week, employees, absences, allWeeks, preferences, referenceWeek });
  const improved = localImprovement({ week: constructed, employees, absences });
  const allWeeksWithImproved = allWeeks.map((w) => (w.id === week.id ? improved : w));
  const quality = evaluateScheduleQuality(improved, employees, allWeeksWithImproved, {
    referenceWeek: referenceWeek || week,
    warnings,
  });
  return { week: improved, warnings, quality };
}

export { evaluateScheduleQuality };
export { INTENT, WARNING, NORMAL_TARGET_SHIFTS, HARD_MAX_SHIFTS };
