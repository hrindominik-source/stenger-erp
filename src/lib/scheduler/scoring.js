// Deterministicke skorovanie kandidata na konkretnu zmenu. Vyssie skore =
// lepsi kandidat. ZIADNY Math.random nikde v tomto module ani v pickBest
// (construct.js) - remizy sa lamu stabilne podla ID zamestnanca.
import { weekShiftCount, globalStats, shiftPeopleIds } from "../../PlanSmienView.jsx";
import { employeeDailySequence, employeeDailySequenceWithOverride, blockQualityScore } from "./blockAnalysis.js";
import { addDaysLocal } from "./dateUtils.js";
import { INTENT, NORMAL_TARGET_SHIFTS, HARD_MAX_SHIFTS } from "./constants.js";

export function scoreCandidate(candidate, shift, ctx) {
  const { week, allWeeks, intents, referenceWeek } = ctx;
  let score = 0;
  const intent = intents.get(candidate.id) || { type: INTENT.FLEXIBLE, targetShifts: NORMAL_TARGET_SHIFTS };

  // 1) zhoda so zamerom tyzdna (DAY_BLOCK/NIGHT_BLOCK/FLEXIBLE/OFF_PARTIAL)
  if (shift.type === "day" && intent.type === INTENT.DAY_BLOCK) score += 8;
  else if (shift.type === "night" && intent.type === INTENT.NIGHT_BLOCK) score += 8;
  else if (shift.type === "day" && intent.type === INTENT.NIGHT_BLOCK) score -= 6;
  else if (shift.type === "night" && intent.type === INTENT.DAY_BLOCK) score -= 6;

  // 2) delta kvality bloku PO pridani tejto zmeny (DDDD/NNNN preferovane,
  //    pomenovane zle vzory penalizovane - viz blockAnalysis.js)
  if (shift.type === "day" || shift.type === "night") {
    const before = blockQualityScore(employeeDailySequence(week, candidate.id));
    const after = blockQualityScore(employeeDailySequenceWithOverride(week, candidate.id, shift));
    score += (after - before) * 2;
  }

  // 3) zataz / mäkký strop 4 zmeny, 5. len ako vynimka (nikdy 6.,
  //    to uz vylucuje eligibleForRole)
  const currentCount = weekShiftCount(week, candidate.id);
  if (currentCount + 1 > NORMAL_TARGET_SHIFTS) score -= 20;
  if (currentCount + 1 >= HARD_MAX_SHIFTS) score -= 10;

  // 4) stabilita pri prepocitani (replan) - bonus za zachovanie povodneho
  //    priradenia znizuje zbytocne zmeny (minimal-diff poziadavka)
  if (referenceWeek) {
    const refShift = referenceWeek.shifts.find((s) => s.id === shift.id);
    if (refShift) {
      const hadIt =
        refShift.assigned.pos1 === candidate.id ||
        refShift.assigned.pos3 === candidate.id ||
        refShift.assigned.general.includes(candidate.id);
      if (hadIt) score += 15;
    }
  }

  // 5) dlhodoba (nie tyzdenna) spravodlivost - slaby tie-break, nie hlavny faktor
  const hist = globalStats(allWeeks, candidate.id);
  score += Math.max(0, 20 - hist.total) * 0.05;

  // 6) sanitacia - explicitny bonus za nadvaznost na stvrtkovu dennu zmenu
  //    (mostik na piatok), rovnaky princip kontinuity ako povodny algoritmus,
  //    ale ako explicitna zlozka skore, nie trik v poradi iteracie.
  if (shift.type === "sanitation") {
    const thursdayDate = addDaysLocal(week.startDate, 3);
    const thursdayDay = week.shifts.find((s) => s.type === "day" && s.date === thursdayDate);
    if (thursdayDay && shiftPeopleIds(thursdayDay).includes(candidate.id)) score += 5;
  }

  return score;
}
