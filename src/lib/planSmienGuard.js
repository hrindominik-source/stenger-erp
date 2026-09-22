// Centralna ochrana existujucich (uz naplanovanych) tyzdnov v Plane smien
// pred automatickym prepisanim/zmazanim.
//
// Pravidlo: NIC, co uz niekto naplanoval, sa nesmie automaticky zmazat ani
// prepisat. Minuly a aktualny kalendarny tyzden su VZDY chranene (uplny
// zakaz automatickych/hromadnych zmien). Novy automaticky scheduler smie
// pracovat len od zaciatku NASLEDUJUCEHO tyzdna - a aj tam, ak uz obsahuje
// rucne zadane priradenia, tie su FIXED INPUT (doplnanie prazdnych miest ich
// nikdy neprepisuje) a hromadne akcie (Vycistit / Vycistit a preplanovat)
// vyzaduju explicitne potvrdenie pouzivatelom pred zmazanim.
//
// Volane AJ z UI (disable/hide tlacidiel, zobrazenie potvrdzovacieho dialogu)
// AJ priamo z mutacnych funkcii v PlanSmienView.jsx (defense-in-depth) - aj
// keby UI kontrolu niekto obisiel, samotna operacia sa bez povolenia
// nevykona.

function pad2(n) {
  return String(n).padStart(2, "0");
}
function toISOLocal(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function parseISOLocal(s) {
  const [y, m, d] = String(s).split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDaysLocal(iso, n) {
  const d = parseISOLocal(iso);
  d.setDate(d.getDate() + n);
  return toISOLocal(d);
}
function mondayOfLocal(iso) {
  const d = parseISOLocal(iso);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toISOLocal(d);
}

// Pondelok aktualneho kalendarneho tyzdna (vzhladom na dany "dnesok" -
// testovatelne bez zavislosti na skutocnom systemovom case).
export function currentPlanningWeekStart(todayIso) {
  return mondayOfLocal(todayIso);
}

// Dynamicky vypocitana hranica ("cutover") - pondelok NASLEDUJUCEHO tyzdna.
// Nikdy natvrdo zapisane konkretne datum - pocita sa vzdy nanovo z "dneska".
export function nextPlanningWeekStart(todayIso) {
  return addDaysLocal(currentPlanningWeekStart(todayIso), 7);
}

// 'past' | 'current' | 'future' - vzdy vzhladom k danemu "dnesku".
export function weekTemporalStatus(weekId, todayIso) {
  const currentStart = currentPlanningWeekStart(todayIso);
  if (weekId < currentStart) return "past";
  if (weekId === currentStart) return "current";
  return "future";
}

// Ci tyzden uz obsahuje akekolvek rucne/automaticky zadane priradenie -
// pouziva sa na rozhodnutie, ci hromadna akcia (Vycistit/Preplanovat) potrebuje
// explicitne potvrdenie (mazanie prazdneho tyzdna netreba potvrdzovat).
export function weekHasAnyAssignments(week) {
  return (week.shifts || []).some((s) => {
    const a = s.assigned || {};
    return Boolean(a.pos1) || Boolean(a.pos3) || (a.general && a.general.length > 0) || (s.extra && s.extra.length > 0);
  });
}

const REASON_PAST = "Tento týden je v minulosti - je to chráněný, již odpracovaný rozpis. Automatické úpravy jsou zakázány.";
const REASON_CURRENT = "Toto je aktuální (probíhající) týden - je chráněný stejně jako minulé týdny. Automatické úpravy jsou zakázány.";

// "Doplnit prázdná místa" - nikdy neprepisuje existujuce priradenia (uz z
// principu algoritmu), ale na minulom/aktualnom tyzdni je zakazane aj
// spustit (nech neexistuje ziadna cesta, ako by sa doplnil zabudnuty
// prazdny slot v uz odpracovanom tyzdni bez vedomia planovaca).
export function canAutoFill(week, todayIso) {
  const status = weekTemporalStatus(week.id, todayIso);
  if (status === "past") return { allowed: false, requiresConfirmation: false, reason: REASON_PAST };
  if (status === "current") return { allowed: false, requiresConfirmation: false, reason: REASON_CURRENT };
  return { allowed: true, requiresConfirmation: false, reason: null };
}

// "Vycistit" (zmaze priradenia bez opatovneho naplanovania) - na buduci
// tyzden vzdy vyzaduje potvrdenie (bez ohladu na to, ci uz je vyplneny).
export function canClearOnly(week, todayIso) {
  const status = weekTemporalStatus(week.id, todayIso);
  if (status === "past") return { allowed: false, requiresConfirmation: false, reason: REASON_PAST };
  if (status === "current") return { allowed: false, requiresConfirmation: false, reason: REASON_CURRENT };
  return { allowed: true, requiresConfirmation: true, reason: null };
}

// "Vycistit a preplanovat" - na prazdnom buducom tyzdni ide rovno (nie je co
// stratit), na buducom tyzdni uz s nejakym priradenim vyzaduje explicitne
// potvrdenie PRED zmazanim (presne toto bolo predtym nebezpecne - fungovalo
// jednym klikom bez potvrdenia).
export function canReplan(week, todayIso) {
  const status = weekTemporalStatus(week.id, todayIso);
  if (status === "past") return { allowed: false, requiresConfirmation: false, reason: REASON_PAST };
  if (status === "current") return { allowed: false, requiresConfirmation: false, reason: REASON_CURRENT };
  return { allowed: true, requiresConfirmation: weekHasAnyAssignments(week), reason: null };
}
