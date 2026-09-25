// Interne upozornenia (bez emailu/n8n, viz zadanie bod 9) - cisto datovy
// vypocet zoznamu warningov z uz nacitanych dat (zmluvy koncia, prehliadky
// koncia/prepadli). Prahy su KONFIGUROVATELNE tu na jednom mieste, nie
// natvrdo v komponentach - UI len vykresli, co tato funkcia vrati.
import { computeMedicalStatus, MEDICAL_STATUS } from "./hrMedicalStatus.js";

export const HR_WARNING_THRESHOLDS = {
  contractRedDays: 14,
  contractOrangeDays: 45,
  medicalOrangeDays: 30,
};

function daysBetween(fromIso, toIso) {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  const from = new Date(fy, fm - 1, fd);
  const to = new Date(ty, tm - 1, td);
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

// employments: [{id, employee_id, fixed_term_end_date, status}], employees:
// [{id, first_name, last_name, title}], medicalExams: [{id, employee_id,
// valid_until}] (najnovsia/najrelevantnejsia na zamestnanca uz vyselektovana
// volajucim). todayIso a thresholds volitelne (testovatelnost, ziadny
// skryty Date.now() v jadre vypoctu).
export function computeHrWarnings({ employments = [], employees = [], medicalExams = [] }, todayIso, thresholds = HR_WARNING_THRESHOLDS) {
  const today = todayIso || new Date().toISOString().slice(0, 10);
  const byEmployeeId = new Map(employees.map((e) => [e.id, e]));
  const warnings = [];

  for (const em of employments) {
    if (!em.fixed_term_end_date) continue;
    const daysLeft = daysBetween(today, em.fixed_term_end_date);
    if (daysLeft < 0) continue; // uz po termine - to rieši ENDED/manualny zasah, nie warning "koncí za"
    if (daysLeft <= thresholds.contractRedDays) {
      warnings.push({ level: "red", type: "CONTRACT_ENDING", employeeId: em.employee_id, employmentId: em.id, daysLeft, message: `smlouva končí za ${daysLeft} ${daysLeft === 1 ? "den" : daysLeft < 5 ? "dny" : "dní"}` });
    } else if (daysLeft <= thresholds.contractOrangeDays) {
      warnings.push({ level: "orange", type: "CONTRACT_ENDING", employeeId: em.employee_id, employmentId: em.id, daysLeft, message: `smlouva končí za ${daysLeft} dní` });
    }
  }

  for (const exam of medicalExams) {
    const status = computeMedicalStatus(exam.valid_until, today);
    if (status === MEDICAL_STATUS.EXPIRED) {
      warnings.push({ level: "red", type: "MEDICAL_EXPIRED", employeeId: exam.employee_id, medicalExamId: exam.id, message: "lékařská prohlídka propadla" });
    } else if (status === MEDICAL_STATUS.EXPIRING) {
      const daysLeft = daysBetween(today, exam.valid_until);
      if (daysLeft <= thresholds.medicalOrangeDays) {
        warnings.push({ level: "orange", type: "MEDICAL_EXPIRING", employeeId: exam.employee_id, medicalExamId: exam.id, daysLeft, message: `lékařská prohlídka končí za ${daysLeft} dní` });
      }
    }
  }

  return warnings.map((w) => ({ ...w, employeeName: byEmployeeId.has(w.employeeId) ? [byEmployeeId.get(w.employeeId).title, byEmployeeId.get(w.employeeId).first_name, byEmployeeId.get(w.employeeId).last_name].filter(Boolean).join(" ") : null }));
}
