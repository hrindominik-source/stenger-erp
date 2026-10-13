// Dane po rokoch (zalozka "Daně") - ciste funkcie bez pdf-lib:
// mesiace narokov na deti pre potvrdenie 5558, polozky rocneho zuctovania
// (5457/B), stav roka a upozornenia (15.2.). Data roka su v
// employee_payroll_data.data.dane[rok].
import { MAX_CHILDREN, childSlot } from "./employeeFields.js";
import { birthDateFrom, ageOn, extractBirthNumber, splitName } from "./taxChildren.js";

// Platca dane (zamestnavatel) - hlavicka tiskopisov.
export const PLATCE_DANE = { dic: "CZ28501381", nazev: "Stenger Czech s.r.o.", adresa: "Plynárenská 366, 261 01 Příbram" };

// Nezdanitelne casti zakladu dane (§ 15 ZDP) v poradi riadkov tiskopisu 5457/B.
export const RZ_POLOZKY = [
  { key: "dary", label: "Bezúplatná plnění – dary (odst. 1)", doklad: "potvrzení o daru" },
  { key: "uroky", label: "Úroky z úvěru na financování bytových potřeb (odst. 3 a 4)", doklad: "potvrzení banky o zaplacených úrocích, výpis z LV, smlouva o úvěru" },
  { key: "penzijni_pripojisteni", label: "Příspěvek na penzijní připojištění se státním příspěvkem", doklad: "potvrzení penzijní společnosti", stari: true },
  { key: "dps", label: "Příspěvek na doplňkové penzijní spoření", doklad: "potvrzení penzijní společnosti", stari: true },
  { key: "penzijni_pojisteni", label: "Příspěvek na penzijní pojištění u instituce penzijního pojištění", doklad: "potvrzení instituce", stari: true },
  { key: "zivotni", label: "Příspěvek pojistného na soukromé životní pojištění", doklad: "potvrzení pojišťovny", stari: true },
  { key: "dip", label: "Příspěvek na majetek připsaný ve prospěch dlouhodobého investičního produktu", doklad: "potvrzení poskytovatele DIP", stari: true },
  { key: "dlouhodoba_pece", label: "Příspěvek pojistného na pojištění dlouhodobé péče", doklad: "potvrzení pojišťovny", stari: true },
];
// Slevy uplatnovane az v rocnom zuctovani (str. 2 tiskopisu).
export const RZ_SLEVY = [
  { key: "exekuce", label: "Sleva za zastavenou exekuci (§ 35 odst. 4)", doklad: "potvrzení exekutora o přiznané náhradě" },
  { key: "manzel", label: "Sleva na manžela/manželku (§ 35bb)", doklad: "oddací list, rodný list dítěte do 3 let, doklad o příjmu manžela, průkaz ZTP/P" },
  { key: "predchozi", label: "Příjmy od předchozích plátců daně", doklad: "potvrzení o zdanitelných příjmech od předchozího zaměstnavatele" },
];
export const STARI_LIMIT = 48000;

export const VYUCTOVANI = [
  { value: "rz", label: "Žádost o roční zúčtování (MFin 5457/B)" },
  { value: "potvrzeni", label: "Potvrzení o zdanitelných příjmech (podává si přiznání sám)" },
];

export function taxYearRecord(payroll, year) {
  return payroll?.data?.dane?.[String(year)] || {};
}

const monthStart = (year, m) => `${year}-${String(m).padStart(2, "0")}-01`;
const monthEnd = (year, m) => new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);

// Mesiace roka, v ktorych trval pracovny pomer (aspon cast mesiaca).
export function employedMonths(year, employment) {
  const out = [];
  const from = employment?.start_date || null;
  const to = employment?.termination_date || null;
  for (let m = 1; m <= 12; m++) {
    if (from && from > monthEnd(year, m)) continue;
    if (to && to < monthStart(year, m)) continue;
    out.push(m);
  }
  return out;
}

// Deti s narokom a pocet mesiacov v roku: nárok od mesiaca narodenia, do
// mesiaca, na zaciatku ktoreho este nema 26 rokov, a len za mesiace pomeru.
// Stĺpec podla poradia (1./2./3.+) ako v prohlaseni.
export function childMonthsForYear(v, year, employment) {
  const employed = employedMonths(year, employment);
  const out = [];
  let order = 0;
  for (let i = 1; i <= MAX_CHILDREN; i++) {
    const s = childSlot(i);
    if (!v[`${s}_jmeno`] || v[`${s}_narok`] !== true) continue;
    order += 1;
    const birth = birthDateFrom(v[`${s}_datum_rc`]);
    const months = employed.filter((m) => {
      if (!birth) return true;
      if (birth > monthEnd(year, m)) return false;
      const age = ageOn(birth, monthStart(year, m));
      return age === null || age < 26;
    }).length;
    out.push({ ...splitName(v[`${s}_jmeno`]), rc: extractBirthNumber(v[`${s}_datum_rc`]) || (birth ? birth.split("-").reverse().map(Number).join(".") : ""), poradi: Math.min(order, 3), mesice: months });
  }
  return out.filter((c) => c.mesice > 0);
}

// Deti do 3 rokov v danom roku - kandidati pre slevu na manzela.
export function childrenUnder3(v, year) {
  const out = [];
  for (let i = 1; i <= MAX_CHILDREN; i++) {
    const s = childSlot(i);
    if (!v[`${s}_jmeno`]) continue;
    const birth = birthDateFrom(v[`${s}_datum_rc`]);
    if (!birth || ageOn(birth, `${year}-01-01`) >= 3) continue;
    out.push({ ...splitName(v[`${s}_jmeno`]), rc: extractBirthNumber(v[`${s}_datum_rc`]) });
  }
  return out;
}

export function sumStari(rz) {
  return RZ_POLOZKY.filter((p) => p.stari).reduce((a, p) => a + (Number(rz?.polozky?.[p.key]) || 0), 0);
}

// Upozornenia k vyplneniu RZ (limity zakona) - len informativne.
export function rzWarnings(rz) {
  const w = [];
  const stari = sumStari(rz);
  if (stari > STARI_LIMIT) w.push(`Produkty spoření na stáří a pojištění dlouhodobé péče: celkem ${stari.toLocaleString("cs-CZ")} Kč – limit je ${STARI_LIMIT.toLocaleString("cs-CZ")} Kč.`);
  const uroky = Number(rz?.polozky?.uroky) || 0;
  if (uroky > 0 && !rz?.uver_pred2021 && !rz?.uver_od2021) w.push("Úroky: označte, zda jde o úvěr na bytovou potřebu obstaranou před 1. 1. 2021 nebo od 1. 1. 2021.");
  if (uroky > 300000 || (rz?.uver_od2021 && !rz?.uver_pred2021 && uroky > 150000)) w.push(`Úroky ${uroky.toLocaleString("cs-CZ")} Kč překračují zákonný limit (150 000 Kč od 2021, celkem max. 300 000 Kč).`);
  if (uroky > 0 && !String(rz?.adresa_bytu || "").trim()) w.push("Úroky: doplňte adresu bytové potřeby.");
  if (rz?.manzel?.prijmeni && !(rz?.manzel_deti || []).some((c) => c.jmeno || c.prijmeni)) w.push("Sleva na manžela: uveďte dítě do 3 let žijící ve společné domácnosti.");
  return w;
}

// Stav roka pre prehlad a upozornenia.
export function taxYearStatus(payroll, year) {
  const rec = taxYearRecord(payroll, year);
  const docs = rec.doklady || [];
  const prohlaseni = (payroll?.data?.prohlaseni_poplatnika || []).some((d) => d.rok === Number(year));
  const zadostPodepsana = docs.some((d) => d.polozka === "zadost_rz");
  const potvrzeniPrijmy = docs.some((d) => d.polozka === "potvrzeni_prijmy");
  let vyuctovani = "nezvoleno";
  if (rec.vyuctovani === "rz") vyuctovani = zadostPodepsana ? "rz_hotovo" : "rz_rozpracovano";
  if (rec.vyuctovani === "potvrzeni") vyuctovani = potvrzeniPrijmy ? "potvrzeni_hotovo" : "potvrzeni_chybi";
  return { prohlaseni, vyuctovani, potvrzeni5558: (rec.potvrzeni_5558 || []).length, doklady: docs.length };
}

export const VYUCTOVANI_STAV = {
  nezvoleno: { text: "nezvoleno", cls: "text-slate-400" },
  rz_rozpracovano: { text: "roční zúčtování – chybí podepsaná žádost", cls: "text-amber-700" },
  rz_hotovo: { text: "roční zúčtování – žádost podepsána", cls: "text-emerald-700" },
  potvrzeni_chybi: { text: "potvrzení o příjmech – nenahráno", cls: "text-amber-700" },
  potvrzeni_hotovo: { text: "potvrzení o příjmech – vydáno", cls: "text-emerald-700" },
};

// Pripomienka: za predchadzajuci rok treba do 15.2. vyriesit RZ / potvrdenie
// (od 1.1. oranzovo, po 15.2. do 31.3. cerveno). Len ak zamestnanec u nas
// za ten rok podepsal prohlaseni (alebo ho uplatnuje).
export function settlementWarning(payroll, uplatnuje, today = new Date()) {
  const y = today.getFullYear() - 1;
  const m = today.getMonth() + 1;
  const d = today.getDate();
  if (m > 3) return null;
  const st = taxYearStatus(payroll, y);
  if (!st.prohlaseni && !uplatnuje) return null;
  if (st.vyuctovani === "rz_hotovo" || st.vyuctovani === "potvrzeni_hotovo") return null;
  const late = m > 2 || (m === 2 && d > 15);
  const what = st.vyuctovani === "nezvoleno" ? "rozhodnout roční zúčtování / potvrzení o příjmech" : VYUCTOVANI_STAV[st.vyuctovani].text;
  return { level: late ? "red" : "amber", message: `Daně ${y}: ${what}${late ? " – termín 15.2. uplynul" : " (do 15.2.)"}` };
}
