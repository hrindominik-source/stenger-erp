// Pracovni smlouva - vyplnenie vzorov Stenger (public/hr/sablony/*.docx).
// Vzory dodala firma (CZ obcan / cizinec); bodkovane miesta su nahradene
// {{tagmi}} skriptom, text zmluvy je inak nezmeneny. Udaje sa beru z karty
// zamestnanca (valuesFromRecords), rucne sa vybera len podepisujici, datum
// podpisu a pripadne text povinnosti.
import { CZ, isValuesForeigner, maritalStatusText, optionLabel, HEALTH_INSURANCE_OPTIONS, formatStreetLine } from "./employeeFields.js";
import { formatDateForDoc } from "./docxMapping.js";

const BASE = import.meta.env?.BASE_URL ?? "/";
export const PS_TEMPLATES = {
  pracovni_smlouva: { url: `${BASE}hr/sablony/pracovni_smlouva.docx`, nazev: "Pracovní smlouva" },
  pracovni_smlouva_cizinec: { url: `${BASE}hr/sablony/pracovni_smlouva_cizinec.docx`, nazev: "Pracovní smlouva – cizinec" },
};

// Za zamestnavatele podepisuji na zaklade plne moci jen tyto osoby
// (Ralf Stenger zatim nema pristup). pad7 = "zastoupená kým".
export const PS_PODEPISUJICI = [
  { jmeno: "Bc. Radka Buchová", pad7: "Bc. Radkou Buchovou" },
  { jmeno: "JUDr. Dominik Hríň", pad7: "JUDr. Dominikem Hríněm" },
];

export const psVariant = (v) => (isValuesForeigner(v) ? "pracovni_smlouva_cizinec" : "pracovni_smlouva");

// Povinnosti z puvodniho vzoru (vyroba). Pro jine pozice text dopise HR.
const POVINNOSTI_VYROBA = "výroba popcornu, úklid, sanitace, manipulace s paletami, kontrola a dodržování výrobních postupů, znalosti výrobků a surovin, dodržování IFS/HACCP, dodržování správné výrobní a hygienické praxe a food defense";
export function defaultPovinnosti(v) {
  if (v.pozice_kategorie && v.pozice_kategorie !== "HI-001") return "";
  const kdo = v.gender === "zena" ? "dělnice" : v.gender === "muz" ? "dělníka" : "dělníka / dělnice";
  return `Mezi základní povinnosti ${kdo} patří ${POVINNOSTI_VYROBA}.`;
}

// --- cisla slovy (tydenni uvazek, napr. 38,75 -> "třicet osm celých sedmdesát pět setin")
const JEDN = ["nula", "jedna", "dva", "tři", "čtyři", "pět", "šest", "sedm", "osm", "devět", "deset", "jedenáct", "dvanáct", "třináct", "čtrnáct", "patnáct", "šestnáct", "sedmnáct", "osmnáct", "devatenáct"];
const DES = ["", "", "dvacet", "třicet", "čtyřicet", "padesát", "šedesát", "sedmdesát", "osmdesát", "devadesát"];
function intWords(n) {
  if (n < 20) return JEDN[n];
  if (n < 100) return DES[Math.floor(n / 10)] + (n % 10 ? " " + JEDN[n % 10] : "");
  return String(n);
}
export function hoursInWords(raw) {
  const s = String(raw ?? "").trim().replace(".", ",");
  if (!/^\d{1,2}(,\d{1,2})?$/.test(s)) return "";
  const [cele, des] = s.split(",");
  const n = Number(cele);
  if (!des || Number(des) === 0) return intWords(n);
  const d = Number(des);
  const celych = n === 1 ? "celá" : n >= 2 && n <= 4 ? "celé" : "celých";
  const unit = des.length === 1
    ? (d === 1 ? "desetina" : d <= 4 ? "desetiny" : "desetin")
    : (d === 1 ? "setina" : d <= 4 ? "setiny" : "setin");
  const dw = d === 1 ? "jedna" : d === 2 ? "dvě" : intWords(d);
  return `${intWords(n)} ${celych} ${dw} ${unit}`;
}
export const hoursText = (raw) => String(raw ?? "").trim().replace(".", ",");

export function probationText(months) {
  const m = Number(months);
  if (!m) return "";
  return `${m} ${m === 1 ? "měsíc" : m <= 4 ? "měsíce" : "měsíců"}`;
}

function addressLine(v, prefix) {
  const street = formatStreetLine(v[`${prefix}_ulice`], v[`${prefix}_cp`], v[`${prefix}_co`]);
  const city = [v[`${prefix}_psc`], v[`${prefix}_obec`]].filter(Boolean).join(" ");
  const stat = v[`${prefix}_stat`] && v[`${prefix}_stat`] !== CZ ? v[`${prefix}_stat`] : "";
  return [street, city, stat].filter(Boolean).join(", ");
}

// Hlavni prevod karta -> data sablony.
// opts: { podepisujici (index do PS_PODEPISUJICI), datumPodpisu (iso), povinnosti }
export function buildPsData(v, opts = {}) {
  const cizinec = isValuesForeigner(v);
  const podp = PS_PODEPISUJICI[opts.podepisujici] || null;
  const doklad = cizinec ? (v.cz_doklad_cislo || v.id_document_number) : v.id_document_number;
  const kontakt = addressLine(v, "kontakt") || (cizinec ? addressLine(v, "pobyt") : "") || addressLine(v, "perm");
  const pozice = v.nazev_pozice || v.position_label || "";
  return {
    zastupce: podp?.jmeno || "",
    zastupce_pad7: podp?.pad7 || "",
    zarazeni: pozice,
    druh_prace: pozice,
    cele_jmeno: [v.title, v.first_name, v.last_name].filter(Boolean).join(" "),
    rodne_prijmeni: v.maiden_name || v.last_name || "",
    datum_narozeni: formatDateForDoc(v.date_of_birth),
    misto_narozeni: [v.place_of_birth, v.country_of_birth && v.country_of_birth !== CZ ? v.country_of_birth : ""].filter(Boolean).join(", "),
    narodnost: v.nationality || "",
    statni_prislusnost: v.nationality || "",
    rodne_cislo: v.birth_number || "",
    cislo_pojistence: v.cislo_pojistence || "",
    rodinny_stav: maritalStatusText(v.rodinny_stav, v.gender) || "",
    cislo_dokladu: doklad || "",
    trvala_adresa: addressLine(v, "perm"),
    dorucovaci_adresa: kontakt,
    telefon: v.phone || "",
    email: v.private_email || "",
    pojistovna: v.health_insurance_company ? optionLabel(HEALTH_INSURANCE_OPTIONS, v.health_insurance_company) : "",
    ucet: v.bank_account || "",
    povinnosti: opts.povinnosti ?? defaultPovinnosti(v),
    misto_vykonu: v.misto_vykonu_smlouva || "Plynárenská 366, Příbram",
    datum_nastupu: formatDateForDoc(v.start_date),
    zkusebni_doba: probationText(v.zkusebni_doba_mesice),
    doba_trvani: v.employment_type === "doba_urcita"
      ? (v.fixed_term_end_date ? `určitou, a to do ${formatDateForDoc(v.fixed_term_end_date)}` : "")
      : "neurčitou",
    tydenni_hodiny: hoursText(v.weekly_hours),
    tydenni_hodiny_slovy: hoursInWords(v.weekly_hours),
    datum_podpisu: formatDateForDoc(opts.datumPodpisu),
  };
}

// Popisky + co je povinne. "karta" = doplnuje se v karte zamestnance.
export const PS_FIELDS = [
  { key: "zastupce", label: "Za zaměstnavatele podepisuje", required: true },
  { key: "datum_podpisu", label: "Datum podpisu", required: true },
  { key: "cele_jmeno", label: "Jméno", required: true, karta: true },
  { key: "rodne_prijmeni", label: "Rodné příjmení", karta: true },
  { key: "datum_narozeni", label: "Datum narození", required: true, karta: true },
  { key: "misto_narozeni", label: "Místo narození", required: true, karta: true },
  { key: "narodnost", label: "Národnost", required: true, karta: true, cizinec: true },
  { key: "statni_prislusnost", label: "Příslušnost", required: true, karta: true, cizinec: true },
  { key: "rodne_cislo", label: "Rodné číslo", required: true, karta: true },
  { key: "cislo_pojistence", label: "Rodné číslo OSSZ (číslo pojištěnce)", karta: true, cizinec: true },
  { key: "rodinny_stav", label: "Rodinný stav", karta: true },
  { key: "cislo_dokladu", label: "Číslo dokladu", required: true, karta: true },
  { key: "trvala_adresa", label: "Trvalé bydliště", required: true, karta: true },
  { key: "dorucovaci_adresa", label: "Korespondenční adresa", karta: true },
  { key: "telefon", label: "Telefon", karta: true },
  { key: "email", label: "E-mail", karta: true },
  { key: "pojistovna", label: "Zdravotní pojišťovna", required: true, karta: true },
  { key: "ucet", label: "Číslo bankovního účtu", karta: true },
  { key: "zarazeni", label: "Pracovní zařazení / druh práce", required: true, karta: true },
  { key: "povinnosti", label: "Základní povinnosti (čl. 1.2)", required: true },
  { key: "misto_vykonu", label: "Místo výkonu práce", required: true, karta: true },
  { key: "datum_nastupu", label: "Den nástupu", required: true, karta: true },
  { key: "zkusebni_doba", label: "Zkušební doba", required: true, karta: true },
  { key: "doba_trvani", label: "Doba trvání", required: true, karta: true },
  { key: "tydenni_hodiny", label: "Týdenní pracovní doba (hodin)", required: true, karta: true },
];

export function psFieldsFor(variant) {
  return PS_FIELDS.filter((f) => !f.cizinec || variant === "pracovni_smlouva_cizinec");
}

export function psMissing(data, variant) {
  const out = psFieldsFor(variant).filter((f) => f.required && !String(data[f.key] ?? "").trim()).map((f) => f.label);
  if (data.tydenni_hodiny && !data.tydenni_hodiny_slovy) out.push("Týdenní pracovní doba (neplatné číslo)");
  return out;
}
