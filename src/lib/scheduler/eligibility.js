// Tvrde podmienky vyberu kandidata - obaluje/znovupouziva UZ OVERENU logiku
// z PlanSmienView.jsx (isOnAbsence vratane nightOnFromOk/nightOnToOk hranicnych
// vynimiek, neighborIdsFor pravidlo o odpocinku) namiesto jej reimplementacie.
import { isOnAbsence, neighborIdsFor, shiftPeopleIds, weekShiftCount } from "../../PlanSmienView.jsx";
import { HARD_MAX_SHIFTS } from "./constants.js";

export function eligibleForRole(shift, roleFlag, employees, absences, week, excludeIds = new Set()) {
  const neighborIds = neighborIdsFor(week, shift.id);
  const usedInShift = new Set(shiftPeopleIds(shift));
  return employees.filter(
    (e) =>
      e.active &&
      e.roles.includes(roleFlag) &&
      !isOnAbsence(e.id, shift.date, absences, shift.type) &&
      !neighborIds.has(e.id) &&
      !usedInShift.has(e.id) &&
      !excludeIds.has(e.id) &&
      // 6. zmena je vzdy zakazana bez ohladu na employee.weeklyMax (tvrdy strop) -
      // 4/5. zmena sa rieši mäkko cez skore (scoring.js), nie tu.
      weekShiftCount(week, e.id) < HARD_MAX_SHIFTS
  );
}
