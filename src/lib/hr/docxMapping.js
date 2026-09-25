// Presna definicia {{kluc}} placeholderov pre nase 3 DOCX vzory - podla
// MASTER_PROMPT_Claude_Code_Stenger_ONE.txt sekcia "MAPOVANIE PRILOŽENÝCH
// DOCX". Kluce su bez diakritiky, hodnoty su bezny cesky text s diakritikou.
// ZIADNA automaticka logika/vypocet pracovnopravnych veci tu - len format.

// Allowlist VSETKYCH znamych klucov (union naprieč vsetkymi sablonami) -
// pouziva sa na validateTemplateKeysAgainstAllowlist (docxTemplate.js),
// aby sa nemapovany/cudzi tag v novo nahranej sablone dal odhalit PRED
// aktivaciou.
export const KNOWN_TEMPLATE_KEYS = [
  "cele_jmeno", "rodne_prijmeni", "datum_narozeni", "misto_narozeni",
  "rodne_cislo", "rodinny_stav", "cislo_dokladu", "trvala_adresa",
  "dorucovaci_adresa", "telefon", "email", "pojistovna", "ucet",
  "zarazeni", "druh_prace", "mzda_hod", "priplatek_noc", "priplatek_vikend",
  "datum", "datum_dokumentu", "datum_skoleni", "zastupce", "zastupce_pad7",
  "predavajici", "skolitel",
];

// Presne, ktore kluce POUZIVA ktora z nasich 3 sablon (overene priamo z
// word/document.xml kazdeho vzoru) - pouziva sa na kontrolu povinnych poli
// PRED generovanim KONKRETNEHO typu dokumentu (nie univerzalne).
export const TEMPLATE_REQUIRED_KEYS = {
  platovy_vymer: [
    "cele_jmeno", "cislo_dokladu", "datum_narozeni", "datum", "dorucovaci_adresa",
    "druh_prace", "email", "misto_narozeni", "mzda_hod", "pojistovna",
    "priplatek_noc", "priplatek_vikend", "rodinny_stav", "rodne_cislo",
    "rodne_prijmeni", "telefon", "trvala_adresa", "ucet", "zarazeni",
    "zastupce_pad7", "zastupce",
  ],
  hi001_naplen_prace_delnice: ["cele_jmeno", "datum_dokumentu", "predavajici"],
  vstupni_skoleni: [
    "cele_jmeno", "cislo_dokladu", "datum_narozeni", "datum_skoleni",
    "dorucovaci_adresa", "email", "misto_narozeni", "pojistovna",
    "rodinny_stav", "rodne_cislo", "rodne_prijmeni", "skolitel", "telefon",
    "trvala_adresa", "ucet", "zarazeni",
  ],
};

const pad2 = (n) => String(n).padStart(2, "0");

// {{datum_narozeni}}, {{datum}}, {{datum_dokumentu}}, {{datum_skoleni}} -
// format d.m.rrrr presne podla MASTER_PROMPT (nie 0-padded, "5.3.2026" nie
// "05.03.2026").
export function formatDateForDoc(isoDate) {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return "";
  return `${d}.${m}.${y}`;
}

// Adresa je jsonb v DB - skutocny tvar pouzity v PersonalistikaModule.jsx
// (employees.permanent_address/correspondence_address) je {ulice, mesto,
// psc, stat}; {street, city, zip} sa podporuje tiez (povodny navrh planu),
// aby sa funkcia dala pouzit z oboch miest bez rozchodu formatu. "" ak nic
// nie je vyplnene.
export function formatAddress(addr) {
  if (!addr || typeof addr !== "object") return "";
  const street = addr.street || addr.ulice;
  const zip = addr.zip || addr.psc;
  const city = addr.city || addr.mesto;
  const parts = [street, [zip, city].filter(Boolean).join(" ")].filter(Boolean);
  return parts.join(", ");
}

// {{ucet}} - cele formatovane cislo uctu vratane predcislia/kodu banky.
// Vstup je uz zlozeny retazec (predcislie-cislo/kod, prip. + nazov banky) -
// tento modul len over ze je to string a vrati ho tak, ako je (originalny
// zapis sa zachovava, MASTER_PROMPT: "zachovať originál").
export function formatBankAccount(accountRaw) {
  return accountRaw ? String(accountRaw) : "";
}

// {{mzda_hod}}, {{priplatek_noc}}, {{priplatek_vikend}} - OPRAVENE ZISTENIE
// (predchadzajuca verzia tohto komentara bola nespravna, viz nizsie).
// Presna surova XML struktura vsetkych troch miest v skutocnej sablone
// 01_PLATOVY_VYMER_vzor.docx (overene priamo v word/document.xml):
//   "- Dohodnutá mzda bude činit -{{mzda_hod}}Kč/ hod."
//   "-Příplatek za práci v noci:-{{priplatek_noc}}Kč/hod"
//   "-Příplatek za práci v sobotu a v neděli:-{{priplatek_vikend}}Kč/hod."
// Prva pomlcka na kazdom riadku je oddelovac odrazky vety (s medzerou za
// ňou, napr. "- Dohodnutá..."), NIE sucast cisla. Druha pomlcka, tesne pred
// samotnym tagom bez medzery ("čini t -{{mzda_hod}}"), je zamerna a ma sa
// spravat ako pociatok zapisu ceskej ciastky bez haleru v tvare "N,-Kč" -
// teda hodnota vlozena za nu MUSI byt uz vo formate "155,-", nie hole cislo
// "155". Predchadzajuca verzia tejto funkcie hole cislo vratila priamo, cim
// vznikal nespravny vysledok "-155Kč/ hod." namiesto spravneho
// "-155,-Kč/ hod." - chyba objavena a opravena podla vizualneho porovnania
// so skutocnym pôvodným výměrom (nie len s doslovnym textom sablony).
// formatMoneyField preto teraz DOPLNI ",-" priponu, ak v zadanej hodnote
// este nie je (HR moze zadat "155" aj rovno uz "155,-" - obe davaju
// rovnaky vysledok, hodnota sa nikdy neduplikuje).
export function formatMoneyField(rawAmount) {
  if (rawAmount === undefined || rawAmount === null || rawAmount === "") return "";
  const trimmed = String(rawAmount).trim();
  return trimmed.endsWith(",-") ? trimmed : `${trimmed},-`;
}

// Zostavi kompletny data objekt pre docxTemplate.fillDocxTemplate() z
// oddelenych zdrojov (master zaznam osoby + konkretne pracovne/mzdove
// udaje zadane pri generovani tohto konkretneho dokumentu). Explicitne
// VYNECHAVA akukolvek logiku "ak chyba, pouzi predvolenu hodnotu" - to je
// ulohou validateRequiredKeys pred volanim tejto funkcie, nie tejto funkcie.
export function buildDocumentData({ person, sensitive, documentFields }) {
  return {
    cele_jmeno: documentFields.cele_jmeno ?? "",
    rodne_prijmeni: person?.maiden_name ?? "",
    datum_narozeni: formatDateForDoc(person?.date_of_birth),
    misto_narozeni: person?.place_of_birth ?? "",
    rodne_cislo: sensitive?.birth_number ?? "",
    rodinny_stav: documentFields.rodinny_stav ?? "",
    cislo_dokladu: sensitive?.id_document_number ?? "",
    trvala_adresa: formatAddress(person?.permanent_address),
    dorucovaci_adresa: formatAddress(person?.correspondence_address || person?.permanent_address),
    telefon: person?.phone ?? "",
    email: person?.private_email ?? "",
    pojistovna: documentFields.pojistovna ?? "",
    ucet: formatBankAccount(sensitive?.bank_account),
    zarazeni: documentFields.zarazeni ?? "",
    druh_prace: documentFields.druh_prace ?? "",
    mzda_hod: formatMoneyField(documentFields.mzda_hod),
    priplatek_noc: formatMoneyField(documentFields.priplatek_noc),
    priplatek_vikend: formatMoneyField(documentFields.priplatek_vikend),
    datum: formatDateForDoc(documentFields.datum),
    datum_dokumentu: formatDateForDoc(documentFields.datum_dokumentu),
    datum_skoleni: formatDateForDoc(documentFields.datum_skoleni),
    zastupce: documentFields.zastupce ?? "",
    zastupce_pad7: documentFields.zastupce_pad7 ?? "",
    predavajici: documentFields.predavajici ?? "",
    skolitel: documentFields.skolitel ?? "",
  };
}
