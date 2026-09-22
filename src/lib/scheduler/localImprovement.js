// Ohranicene lokalne vylepsenie (bounded local search) po prvotnej
// konstrukcii. V TEJTO FAZE rieši len vymeny pre pos1/pos3 (1:1 osoba na
// zmenu, priamociary swap) - "general" pole viacerych ludi zamerne
// NEOPTIMALIZUJE lokalnym hladanim, aby sa obmedzilo riziko/zlozitost tejto
// faze (zaznamenane ako vedomy kompromis v zaverecnej sprave).
//
// Kazda vymena sa prijme LEN AK: (a) neporusi ziadnu tvrdu podmienku pre
// ani jedneho zamestnanca na novej zmene (absencia, sused, aktivny stav,
// rola), (b) netyka sa rucne potvrdeneho (preserveOnReplan) priradenia,
// (c) sucet kvality bloku oboch zamestnancov sa NAOZAJ zlepsi. Pevny strop
// iteracii - ziadny Math.random, poradie prehladavania je deterministicke
// (podla poradia zmien a zamestnancov vo vstupnych poliach).
import { cloneWeek, isOnAbsence, neighborIdsFor } from "../../PlanSmienView.jsx";
import { employeeDailySequence, blockQualityScore } from "./blockAnalysis.js";
import { isPreserved } from "./manualPreserve.js";

const MAX_ITERATIONS = 60;

function canTakeShift(shift, empId, role, employees, absences, week) {
  const emp = employees.find((e) => e.id === empId);
  if (!emp || !emp.active) return false;
  const hasRole = emp.roles.includes(role) || (role === "pos1" && emp.roles.includes("pos1-backup"));
  if (!hasRole) return false;
  if (isOnAbsence(empId, shift.date, absences, shift.type)) return false;
  if (neighborIdsFor(week, shift.id).has(empId)) return false;
  return true;
}

export function localImprovement({ week, employees, absences }) {
  const w = cloneWeek(week);
  const activeEmployees = employees.filter((e) => e.active);
  let iterations = 0;

  ["pos1", "pos3"].forEach((role) => {
    const roleShifts = w.shifts.filter((s) => s.assigned[role]);
    for (let i = 0; i < roleShifts.length && iterations < MAX_ITERATIONS; i++) {
      for (let j = i + 1; j < roleShifts.length && iterations < MAX_ITERATIONS; j++) {
        iterations++;
        const shiftA = roleShifts[i];
        const shiftB = roleShifts[j];
        const empA = shiftA.assigned[role];
        const empB = shiftB.assigned[role];
        if (empA === empB) continue;
        if (isPreserved(shiftA, role) || isPreserved(shiftB, role)) continue;
        if (!canTakeShift(shiftB, empA, role, activeEmployees, absences, w)) continue;
        if (!canTakeShift(shiftA, empB, role, activeEmployees, absences, w)) continue;

        const before = blockQualityScore(employeeDailySequence(w, empA)) + blockQualityScore(employeeDailySequence(w, empB));
        shiftA.assigned[role] = empB;
        shiftB.assigned[role] = empA;
        const after = blockQualityScore(employeeDailySequence(w, empA)) + blockQualityScore(employeeDailySequence(w, empB));

        if (after <= before) {
          // ziadne skutocne zlepsenie - vrat spat
          shiftA.assigned[role] = empA;
          shiftB.assigned[role] = empB;
        }
      }
    }
  });

  return w;
}
