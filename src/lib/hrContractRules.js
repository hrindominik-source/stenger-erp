// Pravidla pro pracovní poměr na dobu určitou podle §39 zákoníku práce (ČR):
// mezi týmiž stranami nesmí trvání přesáhnout celkem 3 roky ode dne vzniku
// prvního pracovního poměru na dobu určitou, a lze jej opakovat (prodloužit)
// nejvýše 2x - tedy nejvýše 3 navazující období celkem.
//
// Drženo jako KONFIGUROVATELNÉ hodnoty (ne hardcodované v UI komponentách) -
// viz sekce D "PROPOSED DATA MODEL" a rozhodnutí "legal rules are not hidden/
// hard-coded throughout UI components" v .claude/plans/cryptic-munching-quill.md.
// Případná výjimka (is_legal_override na employment_contract_events) umožňuje
// administrátorovi vědomě obejít tento výpočet s uvedeným důvodem - podkladová
// fakta (jednotlivé události) zůstávají nezměněná a auditovatelná.
export const FIXED_TERM_RULES = {
  maxTotalMonths: 36,
  maxExtensions: 2,
};

// Cisto datovy vypocet (bez zavislosti na React/appke), aby sa dal pouzivat
// aj v testoch aj v komponentach.
export function addMonthsIso(iso, months) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setMonth(d.getMonth() + months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// events: pole employment_contract_events pre jeden pracovny pomer (employment_id),
// ocakava aspon {event_type, is_legal_override}. Poradie nie je podstatne.
export function computeFixedTermStatus({ startDate, currentEndDate, events = [] }, rules = FIXED_TERM_RULES) {
  const extensionsCount = events.filter((e) => e.event_type === "EXTENDED").length;
  const hasOverride = events.some((e) => e.is_legal_override);
  const remainingExtensions = Math.max(0, rules.maxExtensions - extensionsCount);
  const maxAllowedEndDate = startDate ? addMonthsIso(startDate, rules.maxTotalMonths) : null;

  const overExtensionLimit = extensionsCount >= rules.maxExtensions;
  const overDurationLimit = Boolean(currentEndDate && maxAllowedEndDate && currentEndDate > maxAllowedEndDate);
  const withinLimits = !overExtensionLimit && !overDurationLimit;

  return {
    extensionsCount,
    remainingExtensions,
    maxAllowedEndDate,
    overExtensionLimit,
    overDurationLimit,
    withinLimits,
    hasOverride,
    // Bez override treba respektovat vypocitane limity; s override (administrator
    // vedome zaznamenal vynimku) sa nova zmluva/predlzenie moze vytvorit aj tak.
    canExtendWithoutOverride: withinLimits,
  };
}

// Ci konkretny navrhovany novy koniec zmluvy (pri "Prodlouzit smlouvu") je v
// suladu s pravidlami - pouziva sa PRED ulozenim predlzenia v UI.
export function canProposeExtension({ startDate, proposedEndDate, events = [] }, rules = FIXED_TERM_RULES) {
  return computeFixedTermStatus({ startDate, currentEndDate: proposedEndDate, events }, rules);
}
