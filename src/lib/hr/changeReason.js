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

// DB (migracia 77) odmietne zmenu vybranych poli bez dovodu: dovod sa zapise
// PRED ulozenim (hr_change_reason_begin), po ulozeni sa naviazu zmeny z auditu.
export async function withChangeReason(supabase, employeeId, reason, fields, save) {
  const text = String(reason || "").trim();
  if (!text) return save();
  const { data: id, error } = await supabase.rpc("hr_change_reason_begin", { p_employee_id: employeeId, p_reason: text, p_fields: fields || [] });
  if (error) throw error;
  const result = await save();
  const { error: fErr } = await supabase.rpc("hr_change_reason_finish", { p_id: id });
  if (fErr) throw fErr;
  return result;
}
