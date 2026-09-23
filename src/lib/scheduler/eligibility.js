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
      // Tvrdy strop je INDIVIDUALNY podla e.weeklyMax (napr. Zuzana=2), s
      // rovnakou +1 "vynimocnou" tolerantnou rezervou ako ma cela firma
      // (NORMAL_TARGET_SHIFTS=4 -> HARD_MAX_SHIFTS=5) - nikdy vsak nad
      // globalny HARD_MAX_SHIFTS=5 bez ohladu na to, aky vysoky je weeklyMax.
      // Predtym sa tu porovnavalo LEN proti globalnemu HARD_MAX_SHIFTS, cim sa
      // individualny (nizsi) weeklyMax automatickym enginom uplne ignoroval -
      // rucne priradenie cez UI (vyber/gulicka) tymto obmedzenim NIE JE viazane,
      // kolega tak stale moze zmenu potvrdit aj mimo tohto ramca.
      weekShiftCount(week, e.id) < Math.min(HARD_MAX_SHIFTS, e.weeklyMax + 1)
  );
}
