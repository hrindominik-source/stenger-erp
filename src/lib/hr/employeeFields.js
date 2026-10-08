// Jedina definicia VSETKYCH udajov zamestnanca, ktore zbierame pri nastupe -
// zjednotenie (union) dvoch zdrojov:
//   1) Registrace zaměstnance ČSSZ (ePortál, "Nástup do zaměstnání") - poradie
//      sekcii a ciselniky presne podla nej (komentare HR v testovacom PDF
//      Duchková Marta + fotky ciselnikov z ePortálu),
//   2) Osobní dotazník JMHZ (MRP, verze 20.3.2026 C) - dane, deti, soubeh,
//      exekuce... (polia, ktore v ČSSZ registracii nie su).
// Z tejto jednej definicie sa renderuje: formular "Nový zaměstnanec",
// uprava v karte zamestnanca (Osobní údaje), tabletovy dotaznik (kiosk) a
// z tych istych plochych hodnot sa vyplna JMHZ PDF (jmhzFill.js).
//
// Hodnoty su PLOCHY objekt {key: value}. Kde sa ktora hodnota uklada, hovori
// `store` - vsetko do UZ EXISTUJUCICH tabuliek/jsonb stlpcov (ziadna SQL
// migracia). Nazvy jsonb podpoli su zamerne ZHODNE s tymi, ktore uz pouziva
// JMHZ import (jmhzPdf.js V20260320C_FIELDS target), aby import a tento
// formular citali/zapisovali to iste miesto.
//   {t:"emp", col}              employees.<col>
//   {t:"emp", col, path}        employees.<col>.<path> (jsonb)
//   {t:"sens", col}             employee_sensitive_data.<col>   (HR_VIEW_SENSITIVE)
//   {t:"sens", col, path}       employee_sensitive_data.<col>.<path>
//   {t:"pay", bucket, field}    employee_payroll_data.<bucket>.<field> (HR_VIEW_PAYROLL)
//   {t:"pay", slot, field}      employee_payroll_data.dependents[slot=<slot>].<field>
//   {t:"job", col}              employment_relationships.<col> (aktualny pomer)
//   {t:"job", col:"data", path} employment_relationships.data.<path>

export const CZ = "Česká republika";

// Pevne miesto vykonu prace (poznamka HR v ČSSZ vzore: "nastavit na tvrdo,
// bez možností výběru a vpisování").
export const FIXED_WORKPLACE = {
  adresa: "Plynárenská 366, 261 01 Příbram",
  obec: "Příbram",
  kod_obce: "539911",
};

const opts = (arr) => arr.map(([value, label]) => ({ value, label: label ?? value }));

export const STATE_OPTIONS = opts([[CZ], ["Slovensko"], ["Ukrajina"], ["Moldavsko"], ["Bulharsko"]]);
export const GENDER_OPTIONS = opts([["zena", "Žena"], ["muz", "Muž"]]);
export const MARITAL_OPTIONS = opts([
  ["zenaty_vdana", "ženatý / vdaná"],
  ["svobodny", "svobodný / svobodná"],
  ["rozvedeny", "rozvedený / rozvedená"],
  ["vdovec", "vdovec / vdova"],
]);
const MARITAL_WORDS = {
  zenaty_vdana: ["ženatý", "vdaná"], svobodny: ["svobodný", "svobodná"],
  rozvedeny: ["rozvedený", "rozvedená"], vdovec: ["vdovec", "vdova"],
};
// Vyber vo formulari: muz -> ženatý/svobodný..., zena -> vdaná/svobodná...
export function maritalOptionsForGender(gender) {
  if (gender !== "muz" && gender !== "zena") return MARITAL_OPTIONS;
  return Object.entries(MARITAL_WORDS).map(([value, w]) => ({ value, label: gender === "muz" ? w[0] : w[1] }));
}
// Tvar podla pohlavia pre dokumenty ("vdaná" / "ženatý"); bez pohlavia oba.
export function maritalStatusText(code, gender) {
  const w = MARITAL_WORDS[code];
  if (!w) return code || "";
  if (gender === "muz") return w[0];
  if (gender === "zena") return w[1];
  return `${w[0]} / ${w[1]}`;
}
export const DRUH_CINNOSTI_OPTIONS = opts([
  ["1", "1 – první pracovní poměr"],
  ["2", "2 – druhý pracovní poměr u téhož zaměstnavatele"],
  ["A", "A – dohoda o pracovní činnosti"],
  ["T", "T – první dohoda o provedení práce u téhož zaměstnavatele"],
]);
export const BLIZSI_URCENI_PPV_OPTIONS = opts([
  ["zadne", "Žádné"],
  ["vykon_trestu", "Výkon trestu odnětí svobody / zabezpečovací detence"],
  ["specificka_skupina", "Pracovní vztah specifické skupiny"],
]);
export const OMEZENI_OPTIONS = opts([
  ["iii", "III. stupeň invalidity"],
  ["iii_mimoradne", "III. stupeň invalidity – schopnost výdělečné činnosti za zcela mimořádných podmínek (§ 39 odst. 4 písm. f zák. 155/1995 Sb.)"],
  ["ii", "II. stupeň invalidity"],
  ["i", "I. stupeň invalidity"],
  ["ozz", "Přiznaný POUZE status OZZ (osoba zdravotně znevýhodněná)"],
]);
// KKOV - kod = pismeno, ako v JMHZ dropdowne ("H - Střední odborné...").
export const EDUCATION_OPTIONS = opts([
  ["A", "Bez vzdělání"],
  ["B", "Neúplné základní vzdělání"],
  ["C", "Základní vzdělání"],
  ["D", "Nižší střední vzdělání"],
  ["E", "Nižší střední odborné vzdělání"],
  ["H", "Střední odborné vzdělání s výučním listem"],
  ["J", "Střední nebo střední odborné vzdělání bez maturity i výučního listu"],
  ["K", "Úplné střední všeobecné vzdělání"],
  ["L", "Úplné střední odborné vzdělání s vyučením i maturitou"],
  ["M", "Úplné střední odborné vzdělání s maturitou (bez vyučení)"],
  ["N", "Vyšší odborné vzdělání"],
  ["P", "Vyšší odborné vzdělání v konzervatoři"],
  ["R", "Vysokoškolské bakalářské vzdělání"],
  ["T", "Vysokoškolské magisterské vzdělání"],
  ["V", "Vysokoškolské doktorské vzdělání"],
  ["NEREL", "Nerelevantní"],
]);
export const HEALTH_INSURANCE_OPTIONS = opts([
  ["111", "111 – Všeobecná zdravotní pojišťovna ČR"],
  ["201", "201 – Vojenská zdravotní pojišťovna ČR"],
  ["205", "205 – Česká průmyslová zdravotní pojišťovna"],
  ["207", "207 – Oborová zdravotní pojišťovna zaměstnanců bank, pojišťoven a stavebnictví"],
  ["209", "209 – Zaměstnanecká pojišťovna ŠKODA"],
  ["211", "211 – Zdravotní pojišťovna Ministerstva vnitra ČR"],
  ["213", "213 – Revírní bratrská pokladna, zdravotní pojišťovna"],
  ["300", "300 – Samoplátce"],
  ["999", "999 – Ostatní"],
]);
export const CIZI_NP_UCAST_OPTIONS = opts([
  ["posledni", "Ano – v posledním (předchozím) zaměstnání"],
  ["soucasny", "Ano – v současném zaměstnání"],
]);
export const SEKTOR_OPTIONS = opts([
  ["Jiné"], ["Pracovní úrazy a nemoci z povolání"], ["Rodinné dávky"], ["Vše"],
  ["Vymáhání a zápočty"], ["Nemoc"], ["Dávky v nezaměstnanosti"], ["Důchody"],
]);
export const DUCHOD_OPTIONS = opts([
  ["starobni", "Starobní"],
  ["invalidni_3", "Invalidní 3. stupně"],
  ["invalidni_12", "Invalidní 1. nebo 2. stupně"],
  ["cizi_starobni", "Cizí charakteru starobního"],
  ["cizi_invalidni_3", "Cizí charakteru invalidního 3. stupně"],
  ["cizi_invalidni_12", "Cizí charakteru invalidního 1. nebo 2. stupně"],
]);
export const PROFESE_OPTIONS = opts([
  ["81830", "81830 – Obsluha strojů na balení, plnění a etiketování"],
  ["81602", "81602 – Obsluha strojů na výrobu pečiva, čokolády a cukrovinek"],
  ["83443", "83443 – Skladníci, obsluha manipulačních vozíků"],
  ["41100", "41100 – Všeobecní administrativní pracovníci"],
  ["12111", "12111 – Ekonomičtí a finanční náměstci"],
]);
export const POSTAVENI_OPTIONS = opts([
  ["1111", "1111 – zaměstnanci v pracovním poměru na dobu neurčitou"],
  ["1112", "1112 – zaměstnanci v pracovním poměru na dobu určitou"],
  ["1211", "1211 – dohoda o pracovní činnosti na dobu neurčitou"],
  ["1212", "1212 – dohoda o pracovní činnosti na dobu určitou"],
  ["1221", "1221 – dohoda o provedení práce na dobu neurčitou"],
  ["1222", "1222 – dohoda o provedení práce na dobu určitou"],
]);
export const REZIM_OPTIONS = opts([
  ["jednosmenny", "Jednosměnný pracovní režim"],
  ["dvousmenny", "Dvousměnný pracovní režim"],
  ["vicesmenny", "Vícesměnný pracovní režim"],
  ["nedefinovano", "Nedefinováno"],
]);
// Pozice pre ČSSZ - kategoria HI-00x a nazov presne ako na pracovnej zmluve,
// zvlast muzsky (m) a zensky (z) tvar; "" = rovnaky pre obe pohlavia.
// `profese` = predvoleny CZ-ISCO kod pri vybere kategorie (HR ho moze zmenit).
export const POSITION_CATEGORIES = [
  {
    code: "HI-001", label: "HI-001 – výroba / provoz", profese: "81830",
    desc: "Přímí pracovníci ve výrobě, kteří vytvářejí hodnotu produktu.",
    names: [
      ["dělník", "m"], ["dělnice", "z"], ["pomocný dělník", "m"], ["pomocná dělnice", "z"],
      ["operátor výroby", "m"], ["operátorka výroby", "z"], ["balič", "m"], ["balička", "z"],
      ["seřizovač", "m"], ["seřizovačka", "z"], ["mistr výroby", "m"], ["mistrová výroby", "z"],
      ["vedoucí výroby", ""],
    ],
  },
  {
    code: "HI-002", label: "HI-002 – logistika / skladové hospodářství", profese: "83443",
    desc: "Pracovníci zajišťující příjem, skladování, expedici a interní manipulaci s materiálem.",
    names: [
      ["skladník", "m"], ["skladnice", "z"], ["řidič VZV", "m"], ["řidička VZV", "z"],
      ["expedient", "m"], ["expedientka", "z"], ["vedoucí skladu", ""],
    ],
  },
  {
    code: "HI-003", label: "HI-003 – administrativa a správa / THP", profese: "41100",
    desc: "Technicko-hospodářští pracovníci zajišťující řízení, podporu, legislativu a chod kanceláří.",
    names: [
      ["personalista", "m"], ["personalistka", "z"], ["účetní", ""], ["mzdový účetní", "m"], ["mzdová účetní", "z"],
      ["administrativní pracovník", "m"], ["administrativní pracovnice", "z"], ["asistent", "m"], ["asistentka", "z"],
      ["obchodní referent", "m"], ["obchodní referentka", "z"], ["nákupčí", ""], ["ekonom", "m"], ["ekonomka", "z"],
      ["vedoucí kanceláře", ""], ["jednatel", "m"], ["jednatelka", "z"],
    ],
  },
];

// Nazvy pre danu kategoriu, filtrovane podla pohlavia (bez pohlavia vsetky).
export function positionNameOptions(categoryCode, gender) {
  const cat = POSITION_CATEGORIES.find((c) => c.code === categoryCode);
  const all = cat ? cat.names : POSITION_CATEGORIES.flatMap((c) => c.names);
  const g = gender === "muz" ? "m" : gender === "zena" ? "z" : null;
  return all.filter(([, ng]) => !g || !ng || ng === g).map(([name]) => ({ value: name, label: name }));
}

// Protejsok v druhom rode (dělník <-> dělnice) - pri zmene pohlavia.
export function positionNameForGender(name, gender) {
  const g = gender === "muz" ? "m" : gender === "zena" ? "z" : null;
  if (!g) return name;
  for (const cat of POSITION_CATEGORIES) {
    const idx = cat.names.findIndex(([n]) => n === name);
    if (idx === -1) continue;
    const [, ng] = cat.names[idx];
    if (!ng || ng === g) return name;
    const partner = ng === "m" ? cat.names[idx + 1] : cat.names[idx - 1];
    return partner && partner[1] === g ? partner[0] : name;
  }
  return name;
}

export const MZDA_TYP_OPTIONS = opts([
  ["hodinova", "Hodinová mzda (Kč/hod)"],
  ["smluvni", "Smluvní základní mzda (Kč měsíčně) – např. THP"],
]);
export const NEZABAVITELNA_OPTIONS = opts(
  Array.from({ length: 11 }, (_, n) => [String(n), n === 0 ? "osoba povinného + 0 vyživovaných osob" : `osoba povinného + ${n} ${n === 1 ? "vyživovaná osoba" : n < 5 ? "vyživované osoby" : "vyživovaných osob"}`]),
);
export const DOKLAD_OPTIONS = opts([["Občanský průkaz"], ["Cestovní pas"], ["Povolení k pobytu"]]);
export const EMPLOYMENT_TYPE_OPTIONS = opts([["doba_neurcita", "Doba neurčitá"], ["doba_urcita", "Doba určitá"]]);

export function optionLabel(options, value) {
  const o = options.find((x) => x.value === value);
  return o ? o.label : value;
}

const isCz = (s) => !s || s === CZ;
const isForeigner = (v) => !!v.is_foreigner || (!!v.nationality && v.nationality !== CZ);

// ---------------------------------------------------------------------------
// Definicia poli. Atributy:
//   type: text | date | select | yesno | check | fixed | position | textarea
//   tier: basic | sensitive | payroll | job  (job = pracovny pomer, basic opravnenie)
//   hr: true   -> pole vyplna len HR (nezobrazuje sa na tablete)
//   kiosk: true -> len na tablete (napr. volny nazov pozicie)
//   createOnly: true -> v karte sa upravuje v zalozke "Pracovní poměr", nie tu
//   allowOther: select povoli vlastnu hodnotu mimo zoznamu
//   showIf(values) -> false = pole sa skryje (a neuklada)
//   def: predvolena hodnota noveho zaznamu
// ---------------------------------------------------------------------------

const addr = (prefix, t, col, pathPrefix, extra = {}) => [
  { key: `${prefix}_ulice`, label: "Ulice", type: "text", store: { t, col, path: `${pathPrefix}ulice` }, ...extra },
  { key: `${prefix}_cp`, label: "Číslo popisné", type: "text", store: { t, col, path: `${pathPrefix}cislo_popisne` }, ...extra },
  { key: `${prefix}_co`, label: "Číslo orientační", type: "text", store: { t, col, path: `${pathPrefix}cislo_orientacni` }, ...extra },
  { key: `${prefix}_obec`, label: "Obec", type: "text", store: { t, col, path: `${pathPrefix}mesto` }, ...extra },
  { key: `${prefix}_psc`, label: "PSČ", type: "text", store: { t, col, path: `${pathPrefix}psc` }, ...extra },
];

const dependent = (slot, title, extraFields, showIf, extra = {}) => ({
  id: `dep_${slot}`,
  title,
  tier: "payroll",
  showIf,
  ...extra,
  fields: [
    { key: `${slot}_jmeno`, label: "Jméno a příjmení", type: "text", store: { t: "pay", slot, field: "jmeno" } },
    { key: `${slot}_datum_rc`, label: "Datum narození, rodné číslo", type: "text", store: { t: "pay", slot, field: "datum_narozeni_rc" } },
    ...extraFields,
  ],
});

// Deti: lubovolny pocet (do MAX_CHILDREN) - "Přidat dítě" zvysi deti_pocet.
// JMHZ PDF ma miesto len pre 4, dalsie su v karte a HR ich prilozi zvlast.
export const MAX_CHILDREN = 10;
export const JMHZ_PDF_CHILDREN = 4;
const CHILD_FIELD_SUFFIXES = ["jmeno", "datum_rc", "narok", "studium", "neuplatneni"];
export const childSlot = (i) => `dite${i}`;
const childExtra = (slot) => [
  { key: `${slot}_narok`, label: "Nárok na daňové zvýhodnění", type: "yesno", store: { t: "pay", slot, field: "narok_danove_zvyhodneni" } },
  { key: `${slot}_studium`, label: "Potvrzení o studiu/předškolní docházce", type: "yesno", store: { t: "pay", slot, field: "potvrzeni_studia" } },
  { key: `${slot}_neuplatneni`, label: "Potvrzení o neuplatnění zvýhodnění druhým poplatníkem", type: "yesno", store: { t: "pay", slot, field: "potvrzeni_neuplatneni_druhym" } },
  { key: `${slot}_rodny_list`, label: "Rodný list (PDF / sken)", type: "file", kind: `rodny_list:${slot}`, hr: true },
  { key: `${slot}_studium_doklad`, label: "Potvrzení o studiu (PDF / sken)", type: "file", kind: `studium:${slot}`, hr: true },
];
// Manzel/ka a jina vyzivovana osoba sa ukazuju az ked su uvedene deti
// (odpocet na deti); uz vyplnene udaje sa nikdy neskryju.
const hasChildren = (v) => Number(v.deti_pocet || 0) > 0;
const childSections = Array.from({ length: MAX_CHILDREN }, (_, idx) => {
  const i = idx + 1;
  return dependent(childSlot(i), `${i}. dítě`, childExtra(childSlot(i)), (v) => Number(v.deti_pocet || 0) >= i, { childIndex: i });
});

export const EMPLOYEE_SECTIONS = [
  {
    id: "zakladni",
    title: "A. Základní údaje",
    fields: [
      { key: "title", label: "Titul", type: "text", store: { t: "emp", col: "title" } },
      { key: "first_name", label: "Jméno *", type: "text", store: { t: "emp", col: "first_name" }, required: true },
      { key: "last_name", label: "Příjmení *", type: "text", store: { t: "emp", col: "last_name" }, required: true },
      { key: "maiden_name", label: "Rodné příjmení", type: "text", store: { t: "emp", col: "maiden_name" } },
      { key: "drivejsi_prijmeni", label: "Dřívější (ostatní) příjmení", type: "text", store: { t: "emp", col: "data", path: "drivejsi_prijmeni" } },
      { key: "date_of_birth", label: "Datum narození", type: "date", store: { t: "emp", col: "date_of_birth" } },
      { key: "birth_number", label: "Rodné číslo (RČ nebo EČP)", type: "text", tier: "sensitive", store: { t: "sens", col: "birth_number" } },
      { key: "gender", label: "Pohlaví", type: "select", options: GENDER_OPTIONS, store: { t: "emp", col: "gender" } },
      { key: "rodinny_stav", label: "Rodinný stav", type: "select", options: MARITAL_OPTIONS, optionsFn: (v) => maritalOptionsForGender(v.gender), store: { t: "emp", col: "data", path: "rodinny_stav" } },
      { key: "nationality", label: "Státní občanství", type: "select", options: STATE_OPTIONS, allowOther: true, def: CZ, store: { t: "emp", col: "nationality" } },
      { key: "country_of_birth", label: "Stát narození", type: "select", options: STATE_OPTIONS, allowOther: true, def: CZ, store: { t: "emp", col: "country_of_birth" } },
      { key: "place_of_birth", label: "Obec narození", type: "text", store: { t: "emp", col: "place_of_birth" } },
      { key: "is_foreigner", label: "Zaměstnanec bez státního občanství ČR (cizinec)", type: "check", store: { t: "emp", col: "is_foreigner" } },
    ],
  },
  {
    id: "evidence",
    title: "Evidence – doplní účetní (nepovinné)",
    hr: true,
    fields: [
      { key: "osobni_cislo", label: "Osobní číslo zaměstnance", type: "text", rowStart: true, store: { t: "emp", col: "data", path: "osobni_cislo" } },
      { key: "oic", label: "OIČ – osobní identifikační číslo (přiděluje ČSSZ)", type: "text", rowStart: true, store: { t: "emp", col: "data", path: "oic" } },
      { key: "id_ppv", label: "ID PPV – identifikátor zaměstnání (přiděluje ČSSZ)", type: "text", tier: "job", store: { t: "job", col: "data", path: "id_ppv" } },
      { key: "cislo_pojistence", label: "Číslo pojištěnce (náhradní / evidenční číslo pojištěnce)", type: "text", rowStart: true, store: { t: "emp", col: "data", path: "cislo_pojistence" } },
      // Prilohy sa ukladaju k mzdovym udajom (payroll.data.prilohy) -> tier payroll.
      { key: "cislo_pojistence_oznameni", label: "Oznámení o přidělení čísla pojištěnce (PDF / sken)", type: "file", kind: "oznameni_cislo_pojistence", tier: "payroll" },
    ],
  },
  {
    id: "cinnost",
    title: "B. Činnost",
    hr: true,
    fields: [
      { key: "druh_cinnosti", label: "Druh výdělečné činnosti", type: "select", options: DRUH_CINNOSTI_OPTIONS, def: "1", tier: "job", store: { t: "job", col: "data", path: "druh_cinnosti" } },
      { key: "blizsi_urceni_ppv", label: "Bližší určení PPV", type: "select", options: BLIZSI_URCENI_PPV_OPTIONS, def: "zadne", tier: "job", store: { t: "job", col: "data", path: "blizsi_urceni_ppv" } },
    ],
  },
  {
    id: "rezidence",
    title: "C. Daňová identifikace ve státě rezidence",
    fields: [
      { key: "stat_rezidence", label: "Stát rezidentury", type: "select", options: STATE_OPTIONS, allowOther: true, def: CZ, store: { t: "emp", col: "data", path: "stat_rezidence" } },
      { key: "typ_danove_identifikace", label: "Typ daňové identifikace", type: "text", tier: "sensitive", showIf: (v) => !isCz(v.stat_rezidence), store: { t: "sens", col: "foreigner_data", path: "typ_danove_identifikace" } },
      { key: "danovy_identifikator", label: "Daňový identifikátor ve státě rezidence", type: "text", tier: "sensitive", showIf: (v) => !isCz(v.stat_rezidence), store: { t: "sens", col: "foreigner_data", path: "danovy_identifikator" } },
      { key: "rezidence_od", label: "Rezidentem od", type: "date", tier: "sensitive", showIf: (v) => !isCz(v.stat_rezidence), store: { t: "sens", col: "foreigner_data", path: "rezidence_od" } },
      ...addr("rez", "sens", "foreigner_data", "rezidence_", { tier: "sensitive", showIf: (v) => !isCz(v.stat_rezidence) }),
      { key: "cizinec_doklady", label: "Doklady cizince (sken pasu, rozhodnutí cizinecké policie apod.)", type: "file", kind: "cizinec_doklady", tier: "payroll", hr: true, showIf: (v) => !isCz(v.stat_rezidence) || isForeigner(v) },
    ],
  },
  {
    id: "adresa_trvala",
    title: "D. Adresa trvalého pobytu",
    fields: [
      ...addr("perm", "emp", "permanent_address", ""),
      { key: "perm_stat", label: "Stát", type: "select", options: STATE_OPTIONS, allowOther: true, def: CZ, store: { t: "emp", col: "permanent_address", path: "stat" } },
    ],
  },
  {
    id: "adresa_cr",
    title: "Adresa pobytu v ČR (je-li trvalý pobyt mimo ČR)",
    showIf: (v) => !isCz(v.perm_stat),
    tier: "sensitive",
    fields: addr("pobyt", "sens", "foreigner_data", "pobyt_cr_"),
  },
  {
    id: "adresa_kontaktni",
    title: "Kontaktní adresa (jen pokud je odlišná od trvalé)",
    fields: [
      ...addr("kontakt", "emp", "correspondence_address", ""),
      { key: "kontakt_stat", label: "Stát", type: "select", options: STATE_OPTIONS, allowOther: true, store: { t: "emp", col: "correspondence_address", path: "stat" } },
    ],
  },
  {
    id: "kontakt",
    title: "Kontakt, doklad a účet",
    fields: [
      { key: "phone", label: "Telefonní číslo", type: "text", store: { t: "emp", col: "phone" } },
      { key: "private_email", label: "E-mailová adresa", type: "text", store: { t: "emp", col: "private_email" } },
      { key: "id_document_type", label: "Typ průkazu", type: "select", options: DOKLAD_OPTIONS, allowOther: true, def: "Občanský průkaz", store: { t: "emp", col: "id_document_type" } },
      { key: "id_document_number", label: "Číslo průkazu", type: "text", tier: "sensitive", store: { t: "sens", col: "id_document_number" } },
      { key: "bank_account", label: "Číslo bankovního účtu pro výplatu mzdy", type: "text", tier: "sensitive", store: { t: "sens", col: "bank_account" } },
      // Heslo na zaheslovane PDF vyplatnej pasky posielanej e-mailom (= JMHZ
      // "Heslo pro elektronickou komunikaci").
      { key: "heslo_pasky", label: "Heslo pro zaslání výplatní pásky e-mailem", type: "text", tier: "sensitive", store: { t: "sens", col: "data", path: "heslo_vyplatni_pasky" } },
    ],
  },
  {
    id: "zdravi",
    title: "E. Zdravotní omezení a ZTP/P",
    tier: "payroll",
    fields: [
      { key: "omezeni_typ", label: "Typ zdravotního omezení", type: "select", options: OMEZENI_OPTIONS, store: { t: "pay", bucket: "pension_insurance_status", field: "omezeni_typ" } },
      { key: "omezeni_od", label: "Zdravotní omezení přiznané od", type: "date", showIf: (v) => !!v.omezeni_typ, store: { t: "pay", bucket: "pension_insurance_status", field: "omezeni_priznane_od" } },
      { key: "omezeni_do", label: "Zdravotní omezení přiznané do", type: "date", showIf: (v) => !!v.omezeni_typ, store: { t: "pay", bucket: "pension_insurance_status", field: "omezeni_priznane_do" } },
      { key: "potvrzeni_invalidite", label: "Potvrzení o invaliditě doloženo", type: "yesno", showIf: (v) => !!v.omezeni_typ, store: { t: "pay", bucket: "pension_insurance_status", field: "potvrzeni_invalidite" } },
      { key: "ztpp_drzitel", label: "Zaměstnanec je držitelem karty ZTP/P", type: "yesno", def: false, store: { t: "pay", bucket: "pension_insurance_status", field: "ztpp_drzitel" } },
      { key: "zdravotni_omezeni_rozhodnuti", label: "Rozhodnutí o zdravotním omezení / průkaz ZTP/P (PDF / sken)", type: "file", kind: "zdravotni_omezeni", hr: true, showIf: (v) => !!v.omezeni_typ || v.ztpp_drzitel === true },
    ],
  },
  {
    id: "vzdelani",
    title: "F. Vzdělání",
    fields: [
      { key: "highest_education", label: "Nejvyšší dosažené vzdělání podle KKOV", type: "select", options: EDUCATION_OPTIONS, store: { t: "emp", col: "highest_education" } },
    ],
  },
  {
    id: "pojisteni",
    title: "G. Pojištění",
    fields: [
      { key: "health_insurance_company", label: "Kód zdravotní pojišťovny", type: "select", options: HEALTH_INSURANCE_OPTIONS, store: { t: "emp", col: "health_insurance_company" } },
      { key: "predchozi_organ_np", label: "Předchozí orgán, který prováděl nemocenské pojištění", type: "text", store: { t: "emp", col: "data", path: "predchozi_organ_np" } },
      { key: "soucasny_organ_np", label: "Současný orgán, který provádí nemocenské pojištění", type: "text", store: { t: "emp", col: "data", path: "soucasny_organ_np" } },
      { key: "cizi_np_ucast", label: "Účast na nemocenském pojištění mimo ČR (cizozemský nositel)", type: "select", options: CIZI_NP_UCAST_OPTIONS, tier: "sensitive", store: { t: "sens", col: "foreigner_data", path: "cizi_np_ucast" } },
      ...[
        ["cizi_np_specifikace", "Specifikace", "cizi_np_specifikace"],
        ["cizi_np_nazev", "Název nositele", "cizi_np_nazev"],
        ["cizi_np_cislo", "Cizozemské číslo pojištění", "cizi_np_cislo"],
      ].map(([key, label, path]) => ({ key, label, type: "text", tier: "sensitive", showIf: (v) => !!v.cizi_np_ucast, store: { t: "sens", col: "foreigner_data", path } })),
      { key: "cizi_np_sektor", label: "Sektor (účel pojištění)", type: "select", options: SEKTOR_OPTIONS, tier: "sensitive", showIf: (v) => !!v.cizi_np_ucast, store: { t: "sens", col: "foreigner_data", path: "cizi_np_sektor" } },
      ...addr("cizinp", "sens", "foreigner_data", "cizi_np_", { tier: "sensitive", showIf: (v) => !!v.cizi_np_ucast }),
      { key: "cizinp_stat", label: "Stát nositele", type: "select", options: STATE_OPTIONS, allowOther: true, tier: "sensitive", showIf: (v) => !!v.cizi_np_ucast, store: { t: "sens", col: "foreigner_data", path: "cizi_np_stat" } },
    ],
  },
  {
    id: "cizinec",
    title: "Zaměstnanec bez státního občanství ČR",
    tier: "sensitive",
    showIf: isForeigner,
    fields: [
      { key: "cz_doklad_typ", label: "Typ dokladu", type: "select", options: DOKLAD_OPTIONS, allowOther: true, store: { t: "sens", col: "foreigner_data", path: "doklad_typ" } },
      { key: "cz_doklad_cislo", label: "Číslo dokladu", type: "text", store: { t: "sens", col: "foreigner_data", path: "doklad_cislo" } },
      { key: "cz_doklad_stat", label: "Stát, který doklad vydal", type: "select", options: STATE_OPTIONS, allowOther: true, store: { t: "sens", col: "foreigner_data", path: "doklad_stat_vydani" } },
      { key: "cz_doklad_organ", label: "Orgán, který doklad vydal v zahraničí", type: "text", store: { t: "sens", col: "foreigner_data", path: "doklad_vydavajici_organ" } },
      { key: "cz_volny_pristup", label: "Volný přístup na trh práce", type: "yesno", store: { t: "sens", col: "foreigner_data", path: "volny_pristup_trh_prace" } },
      { key: "cz_opravneni_id", label: "Identifikátor pracovního oprávnění", type: "text", store: { t: "sens", col: "foreigner_data", path: "opravneni_identifikator" } },
      { key: "cz_opravneni_druh", label: "Druh pracovního oprávnění", type: "text", store: { t: "sens", col: "foreigner_data", path: "typ_pracovniho_opravneni" } },
      { key: "cz_opravneni_up", label: "Vydala Krajská pobočka ÚP ČR", type: "text", store: { t: "sens", col: "foreigner_data", path: "opravneni_vydal_up" } },
      { key: "cz_opravneni_od", label: "Trvání oprávnění od", type: "date", store: { t: "sens", col: "foreigner_data", path: "opravneni_od" } },
      { key: "cz_opravneni_do", label: "Trvání oprávnění do", type: "date", store: { t: "sens", col: "foreigner_data", path: "opravneni_do" } },
      { key: "cz_cislo_pojisteni_zp", label: "Číslo pojištěnce ZP (pokud bylo přiděleno)", type: "text", store: { t: "sens", col: "foreigner_data", path: "cislo_pojisteni_zp_1" } },
    ],
  },
  {
    id: "cizi_predpisy",
    title: "H. Příslušnost k cizím právním předpisům",
    tier: "sensitive",
    fields: [
      { key: "cizi_predpisy", label: "Příslušnost k cizím právním předpisům", type: "yesno", def: false, store: { t: "sens", col: "foreigner_data", path: "podleha_socialnimu_zabezpeceni_jineho_statu" } },
      { key: "cizi_predpisy_stat", label: "Stát", type: "select", options: STATE_OPTIONS, allowOther: true, showIf: (v) => v.cizi_predpisy === true, store: { t: "sens", col: "foreigner_data", path: "kod_statu_socialniho_pojisteni" } },
    ],
  },
  {
    id: "duchod",
    title: "I. Důchod",
    tier: "payroll",
    fields: [
      { key: "duchod_druh", label: "Druh důchodu", type: "select", options: DUCHOD_OPTIONS, store: { t: "pay", bucket: "pension_insurance_status", field: "duchod_druh" } },
      { key: "duchod_od", label: "Důchod pobírán od", type: "date", showIf: (v) => !!v.duchod_druh, store: { t: "pay", bucket: "pension_insurance_status", field: "duchod_pobiran_od" } },
      { key: "duchod_do", label: "Důchod pobírán do", type: "date", showIf: (v) => !!v.duchod_druh, store: { t: "pay", bucket: "pension_insurance_status", field: "duchod_pobiran_do" } },
      { key: "duchod_predcasny", label: "Poživatel předčasného starobního důchodu", type: "yesno", def: false, store: { t: "pay", bucket: "pension_insurance_status", field: "duchod_predcasny_starobni" } },
      { key: "duchod_snizeny_vek", label: "Poživatel starobního důchodu se sníženým důchodovým věkem", type: "yesno", def: false, store: { t: "pay", bucket: "pension_insurance_status", field: "duchod_snizeny_duchodovy_vek" } },
      { key: "duchod_potvrzeni", label: "Potvrzení o přiznání důchodu doloženo", type: "yesno", showIf: (v) => !!v.duchod_druh, store: { t: "pay", bucket: "pension_insurance_status", field: "duchod_potvrzeni_priznani" } },
      { key: "duchod_rozhodnuti", label: "Rozhodnutí o přiznání důchodu (PDF / sken)", type: "file", kind: "duchod", hr: true, showIf: (v) => !!v.duchod_druh || v.duchod_predcasny === true || v.duchod_snizeny_vek === true },
    ],
  },
  {
    id: "pozice",
    title: "J. Vykonávaná pozice zaměstnance",
    tier: "job",
    fields: [
      { key: "position_label", label: "Pracovní pozice (název)", type: "text", kiosk: true },
      // Pozicia zo zoznamu pozicii sa priradi automaticky podla kodu kategorie.
      { key: "position_id", label: "Pozice (seznam)", type: "hidden", hr: true, createOnly: true, store: { t: "job", col: "position_id" } },
      { key: "pozice_kategorie", label: "Pozice", type: "select", options: POSITION_CATEGORIES.map((c) => ({ value: c.code, label: c.label })), hr: true, helpFn: (v) => POSITION_CATEGORIES.find((c) => c.code === v)?.desc, store: { t: "job", col: "data", path: "pozice_kategorie" } },
      { key: "nazev_pozice", label: "Pozice pro ČSSZ", info: "Musí se shodovat s pozicí uvedenou na pracovní smlouvě.", type: "select", optionsFn: (v) => positionNameOptions(v.pozice_kategorie, v.gender), allowOther: true, hr: true, showIf: (v) => !!v.pozice_kategorie || !!v.nazev_pozice, store: { t: "job", col: "data", path: "nazev_pozice" } },
      { key: "start_date", label: "Datum nástupu do zaměstnání", type: "date", createOnly: true, store: { t: "job", col: "start_date" } },
      { key: "vznik_zamestnani", label: "Vznik zaměstnání", type: "date", hr: true, store: { t: "job", col: "data", path: "vznik_zamestnani" } },
      { key: "employment_type", label: "Typ smlouvy", type: "select", options: EMPLOYMENT_TYPE_OPTIONS, def: "doba_neurcita", hr: true, createOnly: true, noEmpty: true, store: { t: "job", col: "employment_type" } },
      { key: "fixed_term_end_date", label: "Konec smlouvy", type: "date", hr: true, createOnly: true, showIf: (v) => v.employment_type === "doba_urcita", store: { t: "job", col: "fixed_term_end_date" } },
      { key: "probation_end_date", label: "Konec zkušební doby", type: "date", hr: true, createOnly: true, store: { t: "job", col: "probation_end_date" } },
      { key: "weekly_hours", label: "Týdenní úvazek (hodin)", type: "text", def: "40", hr: true, createOnly: true, store: { t: "job", col: "weekly_hours" } },
      { key: "maly_rozsah", label: "Zaměstnání malého rozsahu", type: "yesno", def: false, hr: true, store: { t: "job", col: "data", path: "maly_rozsah" } },
      { key: "profese", label: "Profese (CZ-ISCO)", type: "select", options: PROFESE_OPTIONS, allowOther: true, def: "81830", hr: true, store: { t: "job", col: "data", path: "profese" } },
      { key: "postaveni", label: "Postavení v zaměstnání", type: "select", options: POSTAVENI_OPTIONS, hr: true, store: { t: "job", col: "data", path: "postaveni" } },
      { key: "vedouci", label: "Vedoucí zaměstnanec", type: "yesno", def: false, hr: true, store: { t: "job", col: "data", path: "vedouci" } },
      { key: "pracovni_rezim", label: "Pracovní režim", type: "select", options: REZIM_OPTIONS, def: "jednosmenny", hr: true, store: { t: "job", col: "data", path: "pracovni_rezim" } },
      { key: "nepretrzity_provoz", label: "Nepřetržitý provoz", type: "yesno", def: false, hr: true, store: { t: "job", col: "data", path: "nepretrzity_provoz" } },
      { key: "workplace", label: "Místo výkonu práce ze smlouvy", type: "fixed", fixedValue: FIXED_WORKPLACE.adresa, hr: true, store: { t: "job", col: "workplace" } },
      { key: "obec_vykonu", label: "Název obce", type: "fixed", fixedValue: FIXED_WORKPLACE.obec, hr: true, store: { t: "job", col: "data", path: "obec_vykonu" } },
      { key: "kod_obce", label: "Kód obce", type: "fixed", fixedValue: FIXED_WORKPLACE.kod_obce, hr: true, store: { t: "job", col: "data", path: "kod_obce" } },
    ],
  },
  {
    // Mzda patri k mzdovym udajom (HR_VIEW_PAYROLL) - preto v
    // employee_payroll_data.data, nie pri pracovnom pomere (ten vidi kazdy HR).
    id: "mzda",
    title: "K. Mzdové podmínky a příplatky",
    tier: "payroll",
    hr: true,
    fields: [
      { key: "mzda_platnost_od", label: "Platí od", info: "Nová mzda = nové datum platnosti (předchozí zůstane v historii). Se stejným datem se záznam jen opraví.", type: "date", store: { t: "wage", field: "platnost_od" } },
      { key: "mzda_typ", label: "Základní mzda", type: "select", options: MZDA_TYP_OPTIONS, def: "hodinova", noEmpty: true, rowStart: true, store: { t: "wage", field: "mzda_typ" } },
      { key: "mzda_castka", label: "Výše základní mzdy", labelFn: (v) => (v.mzda_typ === "smluvni" ? "Smluvní základní mzda (Kč měsíčně)" : "Hodinová mzda (Kč/hod)"), type: "text", store: { t: "wage", field: "mzda_castka" } },
      { key: "priplatek_prescas", label: "Příplatek za práci přesčas (%)", type: "text", def: "25", rowStart: true, store: { t: "wage", field: "priplatek_prescas_pct" } },
      { key: "priplatek_vikend", label: "Příplatek za práci v sobotu a v neděli (Kč/hod)", type: "text", store: { t: "wage", field: "priplatek_vikend_kc" } },
      { key: "priplatek_noc", label: "Příplatek za práci v noci (Kč/hod)", type: "text", store: { t: "wage", field: "priplatek_noc_kc" } },
      { key: "stravenkovy_pausal", label: "Nárok na stravenkový paušál", type: "yesno", rowStart: true, store: { t: "wage", field: "stravenkovy_pausal" } },
      { key: "dovolena_hod", label: "Nárok na dovolenou (hodin za rok)", type: "text", store: { t: "wage", field: "dovolena_hod" } },
    ],
  },
  {
    id: "dane",
    title: "L. Daně – prohlášení poplatníka",
    tier: "payroll",
    fields: [
      { key: "tax_uplatneni", label: "Uplatňuje prohlášení poplatníka („růžový formulář“)", type: "yesno", store: { t: "pay", bucket: "tax_declaration", field: "uplatneni_prohlaseni" } },
      { key: "tax_zakladni", label: "Základní sleva na poplatníka", type: "check", showIf: (v) => v.tax_uplatneni === true, store: { t: "pay", bucket: "tax_declaration", field: "zakladni_sleva" } },
      { key: "tax_manzel", label: "Sleva na manžela/manželku", type: "check", showIf: (v) => v.tax_uplatneni === true, store: { t: "pay", bucket: "tax_declaration", field: "sleva_manzel" } },
      { key: "tax_invalidita", label: "Sleva na invaliditu (I., II., III. stupeň)", type: "check", showIf: (v) => v.tax_uplatneni === true, store: { t: "pay", bucket: "tax_declaration", field: "sleva_invalidita" } },
      { key: "tax_invalidita_doklad", label: "Rozhodnutí o invalidním důchodu (PDF / sken)", type: "file", kind: "tax_invalidita", hr: true, showIf: (v) => v.tax_uplatneni === true && !!v.tax_invalidita },
      { key: "tax_prohlaseni_doklad", label: "Prohlášení poplatníka – formulář (PDF / sken)", type: "file", kind: "prohlaseni_poplatnika", hr: true },
    ],
  },
  { id: "deti", title: "Děti a vyživované osoby (uveďte všechny děti žijící ve společné domácnosti)", tier: "payroll", control: "children", fields: [] },
  ...childSections,
  dependent("manzel", "Manžel / manželka", [
    { key: "manzel_sleva", label: "Uplatnění slevy na manžela/manželku na dani podle § 35ba odst. 1 zákona", type: "yesno", store: { t: "pay", slot: "manzel", field: "uplatneni_slevy" } },
    { key: "manzel_doklady", label: "Čestné prohlášení o výši příjmu manžela/manželky, potvrzení o zdanitelných příjmech (PDF / sken)", type: "file", kind: "manzel_prijmy", hr: true, showIf: (v) => v.manzel_sleva === true },
  ], (v) => hasChildren(v) || !!v.tax_manzel || !!v.manzel_jmeno),
  {
    id: "dep_jina_osoba",
    title: "Jiná vyživovaná osoba (§ 38k odst. 4 zákona o daních z příjmů)",
    tier: "payroll",
    showIf: (v) => hasChildren(v) || !!v.jina_osoba_jmeno,
    fields: [
      { key: "jina_osoba_tytez", label: "Vyživuje tytéž děti v téže společně hospodařící domácnosti i jiná osoba", type: "yesno", store: { t: "pay", slot: "jina_osoba", field: "vyzivuje_tytez_deti" } },
      ...[
        ["jina_osoba_jmeno", "Příjmení a jméno", "jmeno"],
        ["jina_osoba_datum_rc", "Rodné číslo", "datum_narozeni_rc"],
        ["jina_osoba_adresa", "Adresa", "adresa"],
        ["jina_osoba_platce", "Název plátce daně (zaměstnavatel této osoby)", "nazev_platce_dane"],
      ].map(([key, label, field]) => ({ key, label, type: "text", showIf: (v) => v.jina_osoba_tytez === true || !!v.jina_osoba_jmeno, store: { t: "pay", slot: "jina_osoba", field } })),
      { key: "jina_osoba_doklady", label: "Potvrzení zaměstnavatele druhého z poplatníků, čestné prohlášení (PDF / sken)", type: "file", kind: "jina_osoba_doklady", hr: true, showIf: (v) => v.jina_osoba_tytez === true || !!v.jina_osoba_jmeno },
    ],
  },
  {
    id: "soubeh",
    title: "M. Souběžné zaměstnání a exekuce",
    tier: "payroll",
    fields: [
      { key: "soubeh_tehoz", label: "Souběžný pracovní poměr u téhož zaměstnavatele", type: "yesno", def: false, store: { t: "pay", bucket: "concurrent_employment", field: "soubeh_tehoz_zamestnavatele" } },
      { key: "jiny_zamestnavatel_nazev", label: "Souběh u jiného zaměstnavatele – název, sídlo", type: "text", store: { t: "pay", bucket: "concurrent_employment", field: "jiny_zamestnavatel_nazev_sidlo" } },
      { key: "jiny_zamestnavatel_misto", label: "Souběh u jiného zaměstnavatele – místo výkonu práce, druh vztahu", type: "text", showIf: (v) => !!v.jiny_zamestnavatel_nazev, store: { t: "pay", bucket: "concurrent_employment", field: "jiny_zamestnavatel_misto_druh" } },
      // Ano/Ne vidi kazdy s pristupom ku karte (tier basic, employees.data);
      // doklady len opravnenie HR_EXEKUCE (viz GarnishmentDocs + SQL sekcia 47).
      { key: "exekuce", label: "Exekuční / insolvenční srážky ze mzdy", type: "yesno", def: false, tier: "basic", store: { t: "emp", col: "data", path: "exekuce" } },
      // Parametr vypoctu nezabavitelne castky (samotnu sumu pocita mzdovy
      // program podla aktualnych zakonnych hodnot - tu sa nevymysla).
      { key: "nezabavitelna_osoby", label: "Stanovení nezabavitelné částky – na osobu povinného + počet vyživovaných osob", type: "select", options: NEZABAVITELNA_OPTIONS, def: "0", noEmpty: true, showIf: (v) => v.exekuce === true, store: { t: "pay", bucket: "garnishments", field: "nezabavitelna_vyzivovane_osoby" } },
      { key: "exekuce_doklady", label: "Doklady k exekuci / insolvenci (PDF / sken)", type: "custom", custom: "garnishment", tier: "basic", hr: true, showIf: (v) => v.exekuce === true },
    ],
  },
  {
    id: "poznamka",
    title: "N. Poznámka",
    hr: true,
    fields: [{ key: "notes", label: "Poznámka", type: "textarea", store: { t: "emp", col: "notes" } }],
  },
];

export const ALL_FIELDS = EMPLOYEE_SECTIONS.flatMap((s) => s.fields.map((f) => ({ ...f, tier: f.tier || s.tier || "basic", section: s })));

// Postavenie v zamestnani sa odvodzuje od typu zmluvy (1111 neurcita / 1112
// urcita), kym ho HR rucne nezmeni na nieco ine (DPC/DPP).
export function derivePostaveni(employmentType) {
  return employmentType === "doba_urcita" ? "1112" : "1111";
}

export function emptyEmployeeValues() {
  const v = {};
  for (const f of ALL_FIELDS) {
    if (f.type === "fixed") v[f.key] = f.fixedValue;
    else if (f.def !== undefined) v[f.key] = f.def;
    else if (f.type === "check") v[f.key] = false;
    else if (f.type === "yesno") v[f.key] = "";
    else v[f.key] = "";
  }
  v.postaveni = derivePostaveni(v.employment_type);
  v.deti_pocet = 0;
  v.prilohy = [];
  return v;
}

// Mode: "create" | "edit" | "kiosk". Vrati, ci je pole v danom kontexte
// vobec relevantne (opravnenie, HR-only, kiosk-only, createOnly).
export function fieldVisibleInMode(field, { mode, canSensitive, canPayroll }) {
  if (field.tier === "sensitive" && !canSensitive) return false;
  if (field.tier === "payroll" && !canPayroll) return false;
  if (mode === "kiosk") return !field.hr && !field.section?.hr;
  if (field.kiosk) return false;
  if (mode === "edit" && field.createOnly) return false;
  return true;
}

export function isFieldShown(field, values) {
  if (field.section?.showIf && !field.section.showIf(values)) return false;
  if (field.showIf && !field.showIf(values)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Citanie z DB zaznamov do plochych hodnot (vratane normalizacie starsich /
// importovanych tvarov: "Muž", "H - Střední...", "205 - Česká..." atd.)
// ---------------------------------------------------------------------------

export function normalizeGender(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "";
  if (s.startsWith("m")) return "muz";
  if (s.startsWith("ž") || s.startsWith("z")) return "zena";
  return "";
}
export function normalizeEducation(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const m = s.match(/^([A-Z])\s*[-–]\s/);
  if (m) return m[1];
  if (EDUCATION_OPTIONS.some((o) => o.value === s)) return s;
  const byLabel = EDUCATION_OPTIONS.find((o) => o.label.toLowerCase() === s.toLowerCase());
  return byLabel ? byLabel.value : s;
}
export function normalizeHealthInsurance(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^(\d{3})\b/);
  return m ? m[1] : s;
}

function readStore(store, { employee, sensitive, payroll, employment }) {
  if (!store) return undefined;
  if (store.t === "emp") return store.path ? employee?.[store.col]?.[store.path] : employee?.[store.col];
  if (store.t === "sens") return store.path ? sensitive?.[store.col]?.[store.path] : sensitive?.[store.col];
  if (store.t === "job") return store.path ? employment?.[store.col]?.[store.path] : employment?.[store.col];
  if (store.t === "wage") return currentWage(payroll?.data)?.[store.field];
  if (store.t === "pay") {
    if (store.slot) return (payroll?.dependents || []).find((d) => d.slot === store.slot)?.[store.field];
    return payroll?.[store.bucket]?.[store.field];
  }
  return undefined;
}

const OMEZENI_LEGACY = { iii: "omezeni_typ_iii_stupen", iii_mimoradne: "omezeni_typ_iii_stupen_mimoradne", ii: "omezeni_typ_ii_stupen", i: "omezeni_typ_i_stupen", ozz: "omezeni_ozz" };
const DUCHOD_LEGACY = { starobni: "duchod_starobni", invalidni_3: "duchod_invalidni_3_stupne", invalidni_12: "duchod_invalidni_1_2_stupne", cizi_starobni: "duchod_cizi_charakteru_starobni", cizi_invalidni_3: "duchod_cizi_charakteru_invalidni_3", cizi_invalidni_12: "duchod_cizi_charakteru_invalidni_1_2" };

export function valuesFromRecords(records) {
  const v = emptyEmployeeValues();
  for (const f of ALL_FIELDS) {
    if (!f.store || f.type === "fixed") continue;
    const raw = readStore(f.store, records);
    if (raw === undefined || raw === null) continue;
    if (f.type === "yesno" || f.type === "check") v[f.key] = raw === true || raw === "ANO" ? true : raw === false || raw === "NE" ? false : v[f.key];
    else v[f.key] = String(raw);
  }
  v.gender = normalizeGender(v.gender);
  v.highest_education = normalizeEducation(v.highest_education);
  v.health_insurance_company = normalizeHealthInsurance(v.health_insurance_company);
  const pis = records.payroll?.pension_insurance_status || {};
  if (!v.omezeni_typ) v.omezeni_typ = Object.keys(OMEZENI_LEGACY).find((k) => pis[OMEZENI_LEGACY[k]] === true) || "";
  if (!v.duchod_druh) v.duchod_druh = Object.keys(DUCHOD_LEGACY).find((k) => pis[DUCHOD_LEGACY[k]] === true) || "";
  // Vedouci bol povodne (JMHZ import) ulozeny v payroll.concurrent_employment.
  if (records.employment?.data?.vedouci === undefined && records.payroll?.concurrent_employment?.vedouci_pracovnik !== undefined) {
    v.vedouci = records.payroll.concurrent_employment.vedouci_pracovnik === true;
  }
  if (!records.employment?.data?.postaveni && records.employment) v.postaveni = derivePostaveni(v.employment_type);
  v.deti_pocet = countChildren(v);
  v.prilohy = Array.isArray(records.payroll?.data?.prilohy) ? records.payroll.data.prilohy : [];
  if (records.employee?.data?.exekuce === undefined && typeof records.payroll?.garnishments?.exekuce_insolvence_prohlaseni === "boolean") {
    v.exekuce = records.payroll.garnishments.exekuce_insolvence_prohlaseni;
  }
  return v;
}

// Starsie tabletove dotazniky (pred zjednotenim) mali kluce permanent_street
// / permanent_city / ... - prevedie ich na nove, aby sa nic nestratilo.
export function normalizeLegacyDraft(d) {
  const out = { ...emptyEmployeeValues(), ...d };
  if (d.permanent_street && !d.perm_ulice) out.perm_ulice = d.permanent_street;
  if (d.permanent_city && !d.perm_obec) out.perm_obec = d.permanent_city;
  if (d.permanent_zip && !d.perm_psc) out.perm_psc = d.permanent_zip;
  if (d.permanent_country && !d.perm_stat) out.perm_stat = d.permanent_country;
  out.gender = normalizeGender(out.gender);
  out.highest_education = normalizeEducation(out.highest_education);
  out.health_insurance_company = normalizeHealthInsurance(out.health_insurance_company);
  for (const f of ALL_FIELDS) if (f.type === "fixed") out[f.key] = f.fixedValue;
  out.deti_pocet = Math.max(Number(out.deti_pocet || 0), countChildren(out));
  if (!Array.isArray(out.prilohy)) out.prilohy = [];
  return out;
}

// ---------------------------------------------------------------------------
// Zapis: z plochych hodnot zostavi patch pre kazdu tabulku. jsonb stlpce sa
// ZLUCUJU s existujucim obsahom (nic, co formular nepozna, sa nezmaze).
// Skryte polia (showIf=false) sa ukladaju ako prazdne - napr. ked HR zrusi
// "cizinec", udaje cudzinca sa vycistia, aby v JMHZ nezostali stare hodnoty.
// ---------------------------------------------------------------------------

function toDbValue(field, value) {
  if (field.type === "fixed") return field.fixedValue;
  if (field.type === "yesno") return value === true ? true : value === false ? false : null;
  if (field.type === "check") return !!value;
  if (field.type === "date") return value || null;
  if (field.key === "weekly_hours") return value === "" || value === null || value === undefined ? null : Number(String(value).replace(",", "."));
  const s = value === undefined || value === null ? "" : String(value).trim();
  return s === "" ? null : s;
}

export function buildRecordPatches(rawValues, existing = {}, ctx = {}) {
  // Vyplnene dieta sa nikdy nestrati, ani keby deti_pocet chybal (stary draft).
  const values = { ...rawValues, deti_pocet: Math.max(Number(rawValues.deti_pocet || 0), countChildren(rawValues)) };
  const { mode = "create", canSensitive = true, canPayroll = true } = ctx;
  const emp = {}; const sens = {}; const job = {};
  const pay = {};
  const dependents = JSON.parse(JSON.stringify(existing.payroll?.dependents || []));
  const wage = {};
  let wageTouched = false;
  const touched = { emp: false, sens: false, pay: false, job: false };

  const jsonInto = (target, existingRow, col, path, val) => {
    if (!target[col]) target[col] = { ...(existingRow?.[col] || {}) };
    if (val === null) delete target[col][path];
    else target[col][path] = val;
  };

  for (const f of ALL_FIELDS) {
    if (!f.store) continue;
    if (!fieldVisibleInMode(f, { mode, canSensitive, canPayroll })) continue;
    const shown = isFieldShown(f, values);
    const val = shown ? toDbValue(f, values[f.key]) : (f.type === "check" ? false : null);
    const s = f.store;
    if (s.t === "emp") {
      touched.emp = true;
      if (s.path) jsonInto(emp, existing.employee, s.col, s.path, val);
      else emp[s.col] = f.type === "check" ? !!val : val;
    } else if (s.t === "sens") {
      touched.sens = true;
      if (s.path) jsonInto(sens, existing.sensitive, s.col, s.path, val);
      else sens[s.col] = val;
    } else if (s.t === "job") {
      touched.job = true;
      if (s.path) jsonInto(job, existing.employment, s.col, s.path, val);
      else job[s.col] = val;
    } else if (s.t === "wage") {
      touched.pay = true;
      wageTouched = true;
      wage[s.field] = val;
    } else if (s.t === "pay") {
      touched.pay = true;
      if (s.slot) {
        let d = dependents.find((x) => x.slot === s.slot);
        if (!d) { d = { slot: s.slot }; dependents.push(d); }
        if (val === null) delete d[s.field]; else d[s.field] = val;
      } else {
        if (!pay[s.bucket]) pay[s.bucket] = { ...(existing.payroll?.[s.bucket] || {}) };
        if (val === null) delete pay[s.bucket][s.field]; else pay[s.bucket][s.field] = val;
      }
    }
  }

  // Typ omezeni / druh duchodu su v JMHZ samostatne checkboxy - legacy
  // boolean polia drzime v sulade, aby JMHZ import videl rovnaky stav.
  if (pay.pension_insurance_status) {
    const pis = pay.pension_insurance_status;
    for (const [k, field] of Object.entries(OMEZENI_LEGACY)) pis[field] = pis.omezeni_typ === k;
    for (const [k, field] of Object.entries(DUCHOD_LEGACY)) pis[field] = pis.duchod_druh === k;
  }

  // Mzda sa neprepisuje - zmena = novy zaznam historie s datumom platnosti.
  if (wageTouched) {
    const baseData = { ...(existing.payroll?.data || {}), ...(pay.data || {}) };
    const nextData = applyWageChange(baseData, wage, values.start_date);
    pay.data = { ...(pay.data || {}), mzda_historie: nextData.mzda_historie || [] };
  }

  const cleanDependents = dependents.filter((d) => Object.keys(d).some((k) => k !== "slot"));
  return {
    employees: touched.emp ? emp : null,
    sensitive: touched.sens ? sens : null,
    payroll: touched.pay
      ? { ...pay, dependents: cleanDependents, data: { ...(existing.payroll?.data || {}), ...(pay.data || {}), prilohy: (values.prilohy || []).filter((x) => x.path).map(({ file, ...rest }) => rest) } }
      : null,
    employment: touched.job ? job : null,
  };
}

// Ci je v patchi aspon jedna neprazdna hodnota (aby sme pri zakladani
// nevytvarali prazdne riadky v citlivych tabulkach).
export function patchHasContent(patch) {
  const has = (v) => {
    if (v === null || v === undefined || v === false || v === "") return false;
    if (Array.isArray(v)) return v.some(has);
    if (typeof v === "object") return Object.values(v).some(has);
    return true;
  };
  return !!patch && has(patch);
}

// ---------------------------------------------------------------------------
// Formatovanie pre JMHZ / dokumenty
// ---------------------------------------------------------------------------

export function formatStreetLine(ulice, cp, co) {
  const num = [cp, co].filter(Boolean).join("/");
  return [ulice, num].filter(Boolean).join(" ");
}
export function formatCityLine(obec, psc, stat) {
  return [obec, psc, stat].filter(Boolean).join(", ");
}

export function isValuesForeigner(v) {
  return isForeigner(v);
}

// ---------------------------------------------------------------------------
// Deti - pocet a odobratie (s posunom dalsich deti aj ich priloh)
// ---------------------------------------------------------------------------

const isFilled = (x) => x !== "" && x !== undefined && x !== null;

export function countChildren(v) {
  let n = 0;
  for (let i = 1; i <= MAX_CHILDREN; i++) {
    if (CHILD_FIELD_SUFFIXES.some((suf) => isFilled(v[`${childSlot(i)}_${suf}`]))) n = i;
  }
  return n;
}

export function addChild(v) {
  return { ...v, deti_pocet: Math.min(Number(v.deti_pocet || 0) + 1, MAX_CHILDREN) };
}

export function removeChild(v, index) {
  const count = Number(v.deti_pocet || 0);
  const next = { ...v };
  for (let i = index; i < count; i++) {
    for (const suf of CHILD_FIELD_SUFFIXES) next[`${childSlot(i)}_${suf}`] = v[`${childSlot(i + 1)}_${suf}`];
  }
  for (const suf of CHILD_FIELD_SUFFIXES) next[`${childSlot(count)}_${suf}`] = "";
  // Prilohy odobraneho dietata sa z karty odpoja (subor v ulozisku ostava -
  // bucket nema DELETE, viz schema.sql 45.6), dalsie deti sa posunu o 1.
  const removedSlot = childSlot(index);
  next.prilohy = (v.prilohy || [])
    .filter((p) => !p.kind.endsWith(`:${removedSlot}`))
    .map((p) => {
      const m = p.kind.match(/^(.*):dite(\d+)$/);
      if (m && Number(m[2]) > index) return { ...p, kind: `${m[1]}:dite${Number(m[2]) - 1}` };
      return p;
    });
  next.deti_pocet = Math.max(count - 1, 0);
  return next;
}

// ---------------------------------------------------------------------------
// Historie mzdy (sekce K / zalozka Mzdové podmínky) - employee_payroll_data.
// data.mzda_historie = [{ id, platnost_od, mzda_typ, mzda_castka, ... }].
// Platny je posledny zaznam s platnost_od <= dnes; buduce su "naplanovane".
// ---------------------------------------------------------------------------

export const WAGE_FIELDS = ["mzda_typ", "mzda_castka", "priplatek_prescas_pct", "priplatek_vikend_kc", "priplatek_noc_kc", "stravenkovy_pausal", "dovolena_hod"];
// Aktualne pravidlo: prvy rok 155 Kc/hod, po roku od nastupu 165 Kc/hod.
export const WAGE_STEP = { from: "155", to: "165", afterMonths: 12 };

const todayIso = () => new Date().toISOString().slice(0, 10);
const wageNorm = (x) => (x === true ? "ano" : x === false ? "ne" : x === null || x === undefined ? "" : String(x).trim().replace(",", "."));

export function wageHistory(data) {
  const h = Array.isArray(data?.mzda_historie) ? data.mzda_historie : [];
  if (h.length) return [...h].sort((a, b) => String(a.platnost_od || "").localeCompare(String(b.platnost_od || "")) || String(a.created_at || "").localeCompare(String(b.created_at || "")));
  // Starsi tvar (pred historiou) - ploche polia v payroll.data.
  if (data && WAGE_FIELDS.some((f) => isFilled(data[f]))) {
    return [{ id: "legacy", platnost_od: null, ...Object.fromEntries(WAGE_FIELDS.map((f) => [f, data[f] ?? null])) }];
  }
  return [];
}

export function currentWage(data, today = todayIso()) {
  const valid = wageHistory(data).filter((e) => !e.platnost_od || e.platnost_od <= today);
  return valid[valid.length - 1] || null;
}

export function upcomingWages(data, today = todayIso()) {
  return wageHistory(data).filter((e) => e.platnost_od && e.platnost_od > today);
}

const wageHasContent = (w) => ["mzda_castka", "priplatek_vikend_kc", "priplatek_noc_kc", "dovolena_hod"].some((f) => isFilled(w[f])) || w.stravenkovy_pausal === true;
export const wageEquals = (a, b) => WAGE_FIELDS.every((f) => wageNorm(a?.[f]) === wageNorm(b?.[f]));

// Prida zaznam do historie. Zaznam s rovnakym datumom platnosti sa nahradi
// (oprava), inak sa prida novy. Vrati nove payroll.data.
export function addWageEntry(data, entry) {
  // Starsi ploche udaje sa zmenia na prvy (nedatovany) zaznam historie.
  const base = wageHistory(data).map((e) => (e.id === "legacy" ? { ...e, id: "legacy-" + Date.now() } : e));
  const rest = base.filter((e) => (e.platnost_od || "") !== (entry.platnost_od || ""));
  const row = { id: entry.id || (globalThis.crypto?.randomUUID?.() ?? String(Date.now())), created_at: new Date().toISOString(), ...entry };
  return { ...(data || {}), mzda_historie: [...rest, row].sort((a, b) => String(a.platnost_od || "").localeCompare(String(b.platnost_od || ""))) };
}

// Zmena z formulara (Osobni udaje / Novy zamestnanec): ak sa hodnoty lisia od
// aktualne platnych, vznikne novy zaznam od zadaneho "Platí od"; ak sa zmenil
// len datum, opravi sa datum aktualneho zaznamu.
export function applyWageChange(data, wage, startDate) {
  const current = currentWage(data) || upcomingWages(data)[0] || null;
  const date = wage.platnost_od || startDate || todayIso();
  const fields = Object.fromEntries(WAGE_FIELDS.map((f) => [f, wage[f] ?? null]));
  if (!current) {
    return wageHasContent(fields) ? addWageEntry(data, { platnost_od: date, ...fields }) : { ...(data || {}), mzda_historie: wageHistory(data).filter((e) => e.platnost_od) };
  }
  if (wageEquals(current, fields)) {
    if ((current.platnost_od || "") === (wage.platnost_od || "") || !wage.platnost_od) return addWageEntry(data, { ...current });
    // len oprava datumu platnosti aktualneho zaznamu
    const others = wageHistory(data).filter((e) => e.id !== current.id);
    return { ...(data || {}), mzda_historie: [...others, { ...current, platnost_od: wage.platnost_od }].sort((a, b) => String(a.platnost_od || "").localeCompare(String(b.platnost_od || ""))) };
  }
  return addWageEntry(data, { platnost_od: date, ...fields });
}

// Upozornenie "uplynul rok od nastupu -> 165 Kc/hod", kym zmena nie je zadana.
export function wageStepHint(data, startDate, today = todayIso()) {
  if (!startDate) return null;
  const cur = currentWage(data, today) || upcomingWages(data, today)[0];
  if (!cur || cur.mzda_typ === "smluvni" || wageNorm(cur.mzda_castka) !== WAGE_STEP.from) return null;
  const d = new Date(startDate + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + WAGE_STEP.afterMonths);
  const date = d.toISOString().slice(0, 10);
  if (wageHistory(data).some((e) => e.platnost_od && e.platnost_od >= date)) return null;
  const daysLeft = Math.round((new Date(date) - new Date(today)) / 86400000);
  if (daysLeft > 60) return null;
  return { date, from: WAGE_STEP.from, to: WAGE_STEP.to, overdue: daysLeft < 0 };
}

// Zaznam historie <-> ploche hodnoty formulara (kluce poli sekcie K).
const WAGE_KEY_FIELDS = () => ALL_FIELDS.filter((f) => f.store?.t === "wage").map((f) => [f.key, f.store.field, f.type]);
export function wageToValues(entry) {
  const out = {};
  for (const [key, field, type] of WAGE_KEY_FIELDS()) {
    const raw = entry?.[field];
    out[key] = type === "yesno" ? (raw === true ? true : raw === false ? false : "") : (raw === null || raw === undefined ? "" : String(raw));
  }
  return out;
}
export function valuesToWage(values) {
  const out = {};
  for (const [key, field, type] of WAGE_KEY_FIELDS()) {
    const v = values[key];
    out[field] = type === "yesno" ? (v === true ? true : v === false ? false : null) : (v === "" || v === undefined || v === null ? null : String(v).trim());
  }
  return out;
}
