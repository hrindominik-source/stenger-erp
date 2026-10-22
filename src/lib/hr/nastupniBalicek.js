// Nastupni balicek - kontrolni seznam dokumentu pri nastupu zamestnance.
// Stav se pocita z existujicich zaznamu (hr_documents, agenda uradu,
// prohlaseni poplatnika, timeline) - balicek sam nic neuklada.

// Jak dlouho po nastupu se balicek zobrazuje (pak uz nestraši u starsich zamestnancu).
export const NASTUP_DNY = 90;
// Prihlaska CSSZ / ZP do 8 dnu od nastupu.
export const PRIHLASKA_DNY = 8;

export const NASTUP_DOCS = [
  { key: "ps", label: "Pracovní smlouva", types: ["pracovni_smlouva", "pracovni_smlouva_cizinec"], preset: "pracovni_smlouva" },
  { key: "vymer", label: "Mzdový výměr", types: ["platovy_vymer", "mzdovy_vymer"], preset: "platovy_vymer", payroll: true },
  { key: "napln", label: "Náplň práce", types: ["hi001_naplen_prace_delnice", "popis_pracovniho_mista"], preset: "hi001_naplen_prace_delnice" },
  { key: "skoleni", label: "Vstupní školení BOZP", types: ["vstupni_skoleni"], preset: "vstupni_skoleni" },
];

const dayDiff = (a, b) => Math.round((new Date(a + "T00:00:00Z") - new Date(b + "T00:00:00Z")) / 86400000);
const czDate = (iso) => (iso ? iso.slice(0, 10).split("-").reverse().join(".") : "");
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Zobrazit balicek? Jen u aktivniho pomeru s nastupem v budoucnu nebo
// pred max. NASTUP_DNY dny.
export function nastupRelevant(employment, today) {
  if (!employment?.start_date || !["ACTIVE", "NOTICE_PERIOD"].includes(employment.status || "ACTIVE")) return false;
  return dayDiff(today, employment.start_date) <= NASTUP_DNY;
}

// Registrace u CSSZ je dokoncena, kdyz CSSZ pridelila OIC (karta) a ID PPV
// (pracovni pomer) - signal, ze zamestnanec muze do pracovniho procesu.
export function registraceCssz(employee, employment) {
  const oic = String(employee?.data?.oic || "").trim();
  const idPpv = String(employment?.data?.id_ppv || "").trim();
  return { oic, idPpv, done: !!(oic && idPpv) };
}

function lastRegistration(agenda, urad) {
  return (agenda || []).filter((x) => x.urad === urad && ["Přihláška", "Odhláška", "Storno"].includes(x.typ))
    .sort((a, b) => String(b.datum || "").localeCompare(String(a.datum || "")))[0] || null;
}

// stav: missing | created (vytvoreno, ceka na podpis) | done
// action: { tab, preset? } - kam prepnout v detailu zamestnance
export function nastupChecklist({ employee, employment, documents = [], agenda = [], timeline = [], payroll, uplatnujeSlevy, canPayroll, today }) {
  const start = employment?.start_date || today;
  const docs = documents.filter((d) => !d.employment_id || d.employment_id === employment?.id);
  const items = [];
  for (const def of NASTUP_DOCS) {
    if (def.payroll && !canPayroll) continue;
    const mine = docs.filter((d) => def.types.includes(d.doc_type) && d.status !== "ARCHIVED");
    const signed = mine.find((d) => d.status === "SIGNED");
    items.push({
      key: def.key, label: def.label,
      state: signed ? "done" : mine.length ? "created" : "missing",
      detail: signed ? "podepsáno" : mine.some((d) => d.locked_at) ? "čeká na další podpis" : mine.length ? "vytvořeno – nahrajte podepsaný sken" : "chybí",
      action: { tab: "dokumenty", preset: def.preset },
    });
  }
  const dotaznik = timeline.find((t) => t.event_type === "JMHZ_EXPORT" && String(t.event_date || "") >= addDays(start, -60));
  items.push({
    key: "dotaznik", label: "Osobní dotazník zaměstnance",
    state: dotaznik ? "done" : "missing",
    detail: dotaznik ? "vytištěn – podepsaný uložte do Dokumentů" : "chybí",
    action: { tab: "jmhz" },
  });
  if (canPayroll) {
    const rok = Number(String(start).slice(0, 4));
    const prohl = (payroll?.data?.prohlaseni_poplatnika || []).some((p) => Number(p.rok) === rok);
    items.push({
      key: "prohlaseni", label: `Prohlášení poplatníka ${rok}`,
      state: prohl || uplatnujeSlevy === false ? "done" : "missing",
      detail: prohl ? "podepsáno" : uplatnujeSlevy === false ? "neuplatňuje (nepodepisuje)" : "chybí",
      action: { tab: "dane" },
    });
  }
  const lhuta = addDays(start, PRIHLASKA_DNY);
  for (const [urad, label] of [["cssz", "Přihláška ČSSZ"], ["zp", "Přihláška zdravotní pojišťovně"]]) {
    const last = lastRegistration(agenda, urad);
    const registrovan = urad === "cssz" && registraceCssz(employee, employment).done;
    const ok = last?.typ === "Přihláška" || registrovan;
    items.push({
      key: urad, label,
      state: ok ? "done" : "missing",
      detail: last?.typ === "Přihláška" ? `podáno ${czDate(last.datum)}` : registrovan ? "registrace dokončena (OIČ + ID PPV)" : `podat do ${czDate(lhuta)}`,
      overdue: !ok && today > lhuta,
      action: { tab: "jmhz" },
    });
  }
  return items;
}

export function nastupSummary(items) {
  return {
    missing: items.filter((i) => i.state === "missing").length,
    toSign: items.filter((i) => i.state === "created").length,
    overdue: items.some((i) => i.overdue),
    done: items.every((i) => i.state === "done"),
  };
}
