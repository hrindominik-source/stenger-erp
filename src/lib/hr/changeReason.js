// Dovod zmeny v Karte (rozhodnutie 2026-10-29): povinny len pri vybranych
// poliach; ostatne zmeny bez dovodu (zapisu sa do auditu).
import { EMPLOYEE_SECTIONS } from "./employeeFields.js";

const WAGE_KEYS = EMPLOYEE_SECTIONS.find((s) => s.id === "mzda")?.fields.map((f) => f.key) || [];

export const REASON_REQUIRED_KEYS = [
  ...WAGE_KEYS, // mzda
  "position_label", "position_id", "pozice_kategorie", "nazev_pozice", // pozicia / druh prace
  "employment_type", "fixed_term_end_date", // typ a doba zmluvy
  "start_date", "termination_date", // nastup a skoncenie
  "birth_number", "bank_account", "health_insurance_company",
];

const norm = (v) => (v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

// Zmenene polia, pri ktorych je dovod povinny -> [{ key, label }]
export function reasonRequiredChanges(before = {}, after = {}) {
  const labels = Object.fromEntries(EMPLOYEE_SECTIONS.flatMap((s) => s.fields).map((f) => [f.key, f.label]));
  return REASON_REQUIRED_KEYS.filter((k) => k in after && norm(after[k]) !== norm(before[k]))
    .map((k) => ({ key: k, label: (labels[k] || k).replace(/\s*\*$/, "") }));
}
