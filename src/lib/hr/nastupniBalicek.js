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
  // zaznam o skoleni zostava u zamestnavatela - nic sa neodovzdava
  { key: "skoleni", label: "Vstupní školení BOZP", types: ["vstupni_skoleni"], preset: "vstupni_skoleni", noHandover: true },
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

// Dokument je "predany", ked ma dorucenie (delivered_at) - osobne odovzdanie
// vyhotovenia alebo dorucenie § 334. Rucny historicky zaznam sa berie ako hotovy.
const handedOver = (d, deliveries) => d.is_manual_history_entry || deliveries.some((x) => x.hr_document_id === d.id && x.delivered_at);

// stav: missing (chybi) | created (k podpisu) | signed (podepsano - nepredano) | done
// action: { tab, preset? } - kam prepnout v detailu zamestnance
export function nastupChecklist({ employee, employment, documents = [], deliveries = [], agenda = [], timeline = [], payroll, uplatnujeSlevy, canPayroll, today }) {
  const start = employment?.start_date || today;
  const docs = documents.filter((d) => !d.employment_id || d.employment_id === employment?.id);
  const items = [];
  for (const def of NASTUP_DOCS) {
    if (def.payroll && !canPayroll) continue;
    const mine = docs.filter((d) => def.types.includes(d.doc_type) && !["ARCHIVED", "VOIDED", "SUPERSEDED"].includes(d.status));
    const signed = mine.filter((d) => d.status === "SIGNED");
    const done = signed.find((d) => def.noHandover || handedOver(d, deliveries));
    const state = done ? "done" : signed.length ? "signed" : mine.length ? "created" : "missing";
    items.push({
      key: def.key, label: def.label, state,
      detail: {
        done: def.noHandover ? "podepsáno" : "podepsáno a předáno",
        signed: "podepsáno – nepředáno",
        created: mine.some((d) => d.locked_at) ? "k podpisu – čeká na další podpis" : "k podpisu",
        missing: "chybí",
      }[state],
      action: { tab: "dokumenty", preset: def.preset },
    });
  }
  const dotaznik = timeline.find((t) => t.event_type === "JMHZ_EXPORT" && String(t.event_date || "") >= addDays(start, -60));
  const dotaznikPodepsan = documents.some((d) => d.doc_type === "osobni_dotaznik" && d.status === "SIGNED");
  items.push({
    key: "dotaznik", label: "Osobní dotazník zaměstnance",
    state: dotaznik || dotaznikPodepsan ? "done" : "missing",
    detail: dotaznikPodepsan ? "podepsán (dotazník na tabletu)" : dotaznik ? "vytištěn – podepsaný uložte do Dokumentů" : "chybí",
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
    notHanded: items.filter((i) => i.state === "signed").length,
    overdue: items.some((i) => i.overdue),
    done: items.every((i) => i.state === "done"),
  };
}
