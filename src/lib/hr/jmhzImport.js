// Logika pre obrazovku "Načíst JMHZ dotazník": z vysledku extractJmhzFields
// (jmhzPdf.js) zostavi porovnanie povodnych (uz v karte) a navrhovanych (z
// PDF) hodnot, oznaci konflikty a rozhodne, ci sa dany riadok vobec da
// zapisat (opravnenie, existencia pracovneho pomeru, rozpoznatelny format
// datumu). Nic tu nezapisuje do DB - to robi az UI po potvrdeni clovekom
// (PersonalistikaModule.jsx), tato vrstva je cisto pripravna/porovnavacia.

// {{datum_narozeni}} a pod. su v PDF volny text "5.3.1990" (nie DB-validny
// ISO tvar) - parsovanie je zamerne PRISNE (len d.m.rrrr, ziadne hadanie
// ineho formatu): ak sa neda spolahlivo rozpoznat, riadok sa oznaci ako
// nezapisatelny namiesto hadania nespravneho datumu.
export function parseCzechDateToIso(raw) {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const day = Number(d), month = Number(mo);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return `${y}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

// Precita AKTUALNU hodnotu v karte zamestnanca pre dane "target" (z
// jmhzPdf.js field mapy) - vrati { value, writable, reason }. "value" je
// vzdy string (alebo "" ak prazdne/chyba) pre jednoduche porovnanie v UI;
// "writable"=false znamena, ze riadok sa neda zapisat vobec (chybajuce
// opravnenie alebo chybajuci pracovny pomer), nie ze hodnoty su rozdielne.
export function resolveExistingValue(target, ctx) {
  const { employee, sensitive, payroll, currentEmployment, canSensitive, canPayroll, canEditEmployment } = ctx;
  if (!target) return { value: null, writable: false, reason: "Toto pole nemá v kartě určené cílové místo - jen k nahlédnutí." };

  if (target.table === "employees") {
    if (target.path) return { value: employee?.[target.column]?.[target.path] || "", writable: true };
    return { value: employee?.[target.column] ?? "", writable: true };
  }

  if (target.table === "employee_sensitive_data") {
    if (!canSensitive) return { value: null, writable: false, reason: "Chybí oprávnění HR_VIEW_SENSITIVE." };
    if (target.path) return { value: sensitive?.[target.column]?.[target.path] || "", writable: true };
    return { value: sensitive?.[target.column] ?? "", writable: true };
  }

  if (target.table === "employment_relationships") {
    if (!canEditEmployment) return { value: null, writable: false, reason: "Chybí oprávnění HR_EDIT." };
    if (!currentEmployment) return { value: null, writable: false, reason: "Zaměstnanec zatím nemá pracovní poměr - založte jej v záložce Pracovní poměr." };
    return { value: currentEmployment[target.column] ?? "", writable: true };
  }

  if (target.table === "employee_payroll_data") {
    if (!canPayroll) return { value: null, writable: false, reason: "Chybí oprávnění HR_VIEW_PAYROLL." };
    if (target.bucket === "dependents") {
      const slot = (payroll?.dependents || []).find((d) => d.slot === target.slot);
      return { value: slot?.[target.field] ?? "", writable: true };
    }
    const bucket = payroll?.[target.bucket] || {};
    return { value: bucket[target.field] ?? "", writable: true };
  }

  return { value: null, writable: false, reason: "Neznámý cíl zápisu." };
}

function normalizeForCompare(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "ano" : "ne";
  return String(v).trim();
}

// Prevedie surovu hodnotu z PDF (rawValue + kind) na hodnotu, ktora by sa
// SKUTOCNE zapisala do DB - vratane parsovania datumu a prevodu ANO/NE na
// boolean pre jsonb polia. proposedValue=null znamena "nedá se bezpečně
// zapsat" (napr. nerozpoznaný formát data) - riadok potom nejde zaškrtnout.
function resolveProposedValue(fieldResult) {
  const { kind, rawValue, status } = fieldResult;
  if (kind === "checkbox") {
    return { proposedValue: true, proposedDisplay: "zaškrtnuto", unparseable: false };
  }
  if (kind === "radio_ano_ne") {
    const b = status === "POTVRDENE_ANO";
    return { proposedValue: b, proposedDisplay: b ? "Ano" : "Ne", unparseable: false };
  }
  if (kind === "date") {
    const iso = parseCzechDateToIso(rawValue);
    return { proposedValue: iso, proposedDisplay: rawValue, unparseable: iso === null };
  }
  return { proposedValue: rawValue, proposedDisplay: rawValue, unparseable: false };
}

// Hlavna funkcia: extractJmhzFields.results -> zoznam riadkov pre nahlad
// tabulky (povodna / navrhovana hodnota, konflikt, ci sa da zapisat, a s
// akym predvolenym stavom zaskrtavacieho policka). Riadky so status
// NEZADANE sa VYNECHAVAJU - zamestnanec toto pole v dotazniku nevyplnil,
// niet co navrhovat. Riadky VYZADUJE_KONTROLU (pole sa v PDF nenaslo) sa
// zobrazia, ale nikdy nie su predvolene zaskrtnute a nedaju sa zapisat.
export function buildComparisonRows(extractResults, ctx) {
  const rows = [];
  for (const [key, fieldResult] of Object.entries(extractResults)) {
    if (fieldResult.status === "NEZADANE") continue;

    const existing = resolveExistingValue(fieldResult.target, ctx);

    if (fieldResult.status === "VYZADUJE_KONTROLU") {
      rows.push({
        key, label: fieldResult.label, kind: fieldResult.kind, target: fieldResult.target,
        existingValue: existing.value, proposedDisplay: null, proposedValue: null,
        writable: false, hasConflict: false, defaultChecked: false,
        blockedReason: fieldResult.note || "Pole se v PDF nenašlo - ověřte verzi.",
      });
      continue;
    }

    const { proposedValue, proposedDisplay, unparseable } = resolveProposedValue(fieldResult);
    const writable = existing.writable && !unparseable;
    const hasConflict = writable && normalizeForCompare(existing.value) !== "" && normalizeForCompare(existing.value) !== normalizeForCompare(proposedValue);

    rows.push({
      key, label: fieldResult.label, kind: fieldResult.kind, target: fieldResult.target,
      existingValue: existing.value, proposedDisplay, proposedValue,
      writable, hasConflict,
      // Konflikt VZDY vyzaduje explicitne rozhodnutie cloveka (predvolene
      // NEzaskrtnute); ked sa da bezpecne zapisat a nie je konflikt,
      // predvolene zaskrtnute (usetri klikanie pri bezkolizne novych udajoch).
      defaultChecked: writable && !hasConflict,
      blockedReason: writable ? null : (existing.reason || (unparseable ? "Nepodařilo se rozpoznat formát data - opravte ručně." : "Nelze zapsat.")),
    });
  }
  return rows;
}
