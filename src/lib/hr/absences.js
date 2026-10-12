// Neprítomnosti zamestnanca (PN, OČR, materska, rodicovska, neplatene volno).
// Zaznamy (druh, od, do) su v employees.data.nepritomnosti - stav "je v PN"
// vidi kazdy, kto vidi kartu. Doklady k nim (hlasenia z DS, ziadosti o davky)
// su v employee_payroll_data.data.nepritomnosti_doklady (HR_VIEW_PAYROLL).
// Ziadne prepojenie s planom zmien (rozhodnutie HR).

export const ABSENCE_TYPES = [
  { value: "pn_nemoc", label: "PN – nemoc", status: "V pracovní neschopnosti", pn: true },
  { value: "pn_uraz", label: "PN – úraz", status: "V pracovní neschopnosti (úraz)", pn: true },
  { value: "pn_pracovni_uraz", label: "PN – pracovní úraz", status: "V pracovní neschopnosti (pracovní úraz)", pn: true },
  { value: "ocr", label: "OČR – ošetřování člena rodiny", status: "Na OČR" },
  { value: "materska", label: "Mateřská (peněžitá pomoc v mateřství)", status: "Na mateřské" },
  { value: "rodicovska", label: "Rodičovská dovolená", status: "Na rodičovské dovolené" },
  { value: "neplacene_volno", label: "Neplacené volno", status: "Neplacené volno" },
  { value: "jine", label: "Jiná nepřítomnost", status: "Nepřítomen" },
];

export const ABSENCE_DOC_TYPES = [
  "Hlášení o vzniku", "Hlášení o trvání", "Hlášení o ukončení", "Žádost o dávku", "Rozhodnutí / odpověď úřadu", "Jiné",
].map((t) => ({ value: t, label: t }));

const todayIso = () => new Date().toISOString().slice(0, 10);

export function absenceType(value) {
  return ABSENCE_TYPES.find((t) => t.value === value) || ABSENCE_TYPES[ABSENCE_TYPES.length - 1];
}

export function absenceList(employee) {
  const removed = new Set((employee?.data?.nepritomnosti_odstranene || []).map((x) => x.id));
  return [...(employee?.data?.nepritomnosti || [])]
    .filter((x) => !removed.has(x.id))
    .sort((a, b) => String(b.od || "").localeCompare(String(a.od || "")));
}

export function isAbsenceActive(a, today = todayIso()) {
  return !!a.od && a.od <= today && (!a.do || a.do >= today);
}

// Aktualne platna neprítomnost (najnovsia), alebo null.
export function activeAbsence(employee, today = todayIso()) {
  return absenceList(employee).find((a) => isAbsenceActive(a, today)) || null;
}

const fmt = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d}.${m}.${y}`;
};

export function absenceStatusText(a) {
  if (!a) return "";
  const t = absenceType(a.druh);
  return `${t.status} od ${fmt(a.od)}${a.do ? ` do ${fmt(a.do)}` : ""}`;
}

const dayMs = 86400000;
const toDate = (iso) => new Date(iso + "T00:00:00Z");

export function addDaysIso(iso, days) {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

// Pocet celych dni neprítomnosti v skusobnej dobe (§ 35 odst. 4 ZP: skusobna
// doba sa predlzuje o celodenne prekazky v praci a celodennu dovolenku).
// Pocita sa len pre UKONCENU neprítomnost - kym trva, nie je znamy koniec.
export function probationOverlapDays(absence, employment) {
  if (!absence?.od || !absence?.do || !employment?.probation_end_date) return 0;
  const from = employment.start_date && employment.start_date > absence.od ? employment.start_date : absence.od;
  const to = absence.do < employment.probation_end_date ? absence.do : employment.probation_end_date;
  if (to < from) return 0;
  return Math.round((toDate(to) - toDate(from)) / dayMs) + 1;
}

// Prebieha neprítomnost v skusobnej dobe? (pre upozornenie, kym este trva)
export function absenceInProbation(absence, employment) {
  if (!absence?.od || !employment?.probation_end_date) return false;
  return absence.od <= employment.probation_end_date && (!employment.start_date || !absence.do || absence.do >= employment.start_date);
}
