// Citanie vyplnitelneho JMHZ PDF dotaznika (AcroForm polia) - pdf-lib (MIT).
// KRITICKE pravidlo z MASTER_PROMPT: "Nespoliehaj sa na poradie polí ani
// názvy typu Textové pole 1 bez mapy konkrétnej verzie. Neznáma verzia →
// manuálna kontrola, nie tiché nesprávne mapovanie." Preto je tu VERZIOVANA
// mapa (field name -> {key, kind, target}) - ziadna univerzalna "over vsetko
// podla poradia" heuristika. Nevybrane checkbox pole NIKDY neznamena "Nie" -
// vracia sa ako explicitny stav "NEZADANE", nie false/prazdny retazec.
import { PDFDocument } from "pdf-lib";

// LibreOffice Writer (zdroj tohto konkretneho PDF - "Writer" v /Creator
// metadata) exportuje AcroForm nazvy poli s diakritikou DVOJITO PDF-name-
// escapnute: spravny UTF-8 bajt (napr. 0xC3 0xA9 pre "é") je najprv
// zapisany ako PDF #XX escape ("#C3#A9"), a potom cely tento retazec je
// escapnuty este raz - vysledok, ktory pdf-lib.getName() vrati PO SVOJOM
// (jednom) odstraneni escapovania, je teda DOSLOVNY retazec "Textov#C3#A9
// pole 1" (znaky '#','C','3',...), nie "Textové pole 1". Overene priamo na
// stiahnutom verejnom vzore (99 poli, kazde s '#XX' vzorom pri diakritike).
// Tento dekoder odstrani ESTE JEDNU vrstvu escapovania rucne (zoskupi
// susedne #XX na UTF-8 bajtovy blok a dekoduje), aby sa dalo mapovat podla
// citatelneho ceskeho nazvu namiesto hardcodovania zdeformovanych retazcov.
export function decodeLibreOfficeFieldName(raw) {
  let out = "";
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === "#" && /^[0-9A-Fa-f]{2}$/.test(raw.slice(i + 1, i + 3))) {
      const bytes = [];
      while (raw[i] === "#" && /^[0-9A-Fa-f]{2}$/.test(raw.slice(i + 1, i + 3))) {
        bytes.push(parseInt(raw.slice(i + 1, i + 3), 16));
        i += 3;
      }
      out += new TextDecoder("utf-8").decode(new Uint8Array(bytes));
    } else {
      out += raw[i];
      i += 1;
    }
  }
  return out;
}

export const FIELD_STATUS = {
  NEZADANE: "NEZADANE",
  POTVRDENE_ANO: "POTVRDENE_ANO",
  POTVRDENE_NIE: "POTVRDENE_NIE",
  NEUPLATNUJE_SA: "NEUPLATNUJE_SA",
  VYZADUJE_KONTROLU: "VYZADUJE_KONTROLU",
};

// "target" hovori importnej obrazovke (jmhzImport.js), KAM navrhovana hodnota
// smeruje po potvrdeni clovekom - nikdy sa nezapisuje automaticky bez tohto
// kroku. null target = cisto informativne pole (napr. heslo pre elektronickou
// komunikaci s FU - citlivy udaj bez urceneho miesta v karte, HR ho musi
// spracovat mimo tento import).
//   {table:'employees', column} - priamy stlpec zakladnej karty
//   {table:'employee_sensitive_data', column} - HR_VIEW_SENSITIVE cast
//   {table:'employee_sensitive_data', column:'foreigner_data', path} - jsonb podpole
//   {table:'employment_relationships', column} - navrh pre aktualny/novy pracovny pomer
//   {table:'employee_payroll_data', bucket, field} - plocha jsonb bucket (tax_declaration/
//     concurrent_employment/garnishments/pension_insurance_status)
//   {table:'employee_payroll_data', bucket:'dependents', slot, field} - jeden z 6 "slotov"
//     (dite1-4, manzel, jina_osoba) v poli dependents

// Mapa PRESNE tej jednej overenej, VEREJNE DOSTUPNEJ verzie ("Verze dokumentu
// ze dne 25.3.2026", https://faq.mrp.cz/faqcz/obrazky/mrpks/dotaznik_mrp_jmhz4.pdf,
// prazdny/nevyplneny original stiahnuty a preskumany priamo - 99 AcroForm poli
// na 8 stranach). Poradie poli vo /Fields poli PDF NEZODPOVEDA vizualnemu
// poradiu (viacero "Pole pro datum N" a dropdown poli je vlozenych mimo
// poradia) - kazdy riadok nizsie je preto priradeny podla SKUTOCNEJ pozicie
// widgetu na strane (súradnice), nie podla indexu v poli, a paralelne overeny
// oproti textu vytlacenych popiskov na danej strane.
//
// DOLEZITE: uz DODANY vyplneny vzor v hr-podklady/ (lokalny, necommitnuty) MA
// INU verziu nez tato - jeho mapovanie TU OVERENE NIE JE (viz poznamka pri
// extractJmhzFields nizsie a zaverecna sprava). Original prazdny formular tej
// druhej verzie nebol dodany, takze jej presne rozlozenie poli nemozno overit
// rovnakym sposobom - detekcia verzie ho preto oznaci ako neznamu verziu a
// zastavi sa na manualnu kontrolu, presne podla MASTER_PROMPT.
const V20260325_FIELDS = {
  // --- strana 1: Identifikacni udaje zamestnance ---
  "Textové pole 1": { key: "titul", label: "Titul", kind: "text", target: { table: "employees", column: "title" } },
  "Textové pole 1_2": { key: "jmeno", label: "Jméno", kind: "text", target: { table: "employees", column: "first_name" } },
  "Textové pole 1_3": { key: "prijmeni", label: "Příjmení", kind: "text", target: { table: "employees", column: "last_name" } },
  "Textové pole 1_4": { key: "rodne_prijmeni", label: "Rodné příjmení", kind: "text", target: { table: "employees", column: "maiden_name" } },
  "Textové pole 1_5": { key: "ostatni_prijmeni", label: "Ostatní příjmení", kind: "text", target: null },
  "Pole pro datum 1": { key: "datum_narozeni", label: "Datum narození", kind: "date", target: { table: "employees", column: "date_of_birth" } },
  "Textové pole 1_6": { key: "pohlavi", label: "Pohlaví", kind: "dropdown", target: { table: "employees", column: "gender" } },
  "Textové pole 1_7": { key: "misto_narozeni", label: "Místo narození", kind: "text", target: { table: "employees", column: "place_of_birth" } },
  "Textové pole 1_8": { key: "stat_narozeni", label: "Stát narození", kind: "text", target: { table: "employees", column: "country_of_birth" } },
  "Textové pole 1_9": { key: "rodne_cislo", label: "Rodné číslo, pokud uděleno", kind: "text", target: { table: "employee_sensitive_data", column: "birth_number" } },
  "Textové pole 1_10": { key: "statni_obcanstvi", label: "Státní občanství", kind: "text", target: { table: "employees", column: "nationality" } },
  "Textové pole 1_11": { key: "typ_prukazu", label: "Typ průkazu", kind: "text", target: { table: "employees", column: "id_document_type" } },
  "Textové pole 1_12": { key: "cislo_prukazu", label: "Číslo průkazu", kind: "text", target: { table: "employee_sensitive_data", column: "id_document_number" } },
  "Textové pole 1_13": { key: "trvale_ulice", label: "Trvalé bydliště – ulice, č.p./orientační", kind: "text", target: { table: "employees", column: "permanent_address", path: "ulice" } },
  "Textové pole 1_14": { key: "trvale_obec", label: "Trvalé bydliště – obec, PSČ, stát", kind: "text", target: { table: "employees", column: "permanent_address", path: "mesto" } },

  // --- strana 2: Korespondencni adresa, kontakt, vzdelani, pojistovna, slevy ---
  "Textové pole 1_15": { key: "koresp_ulice", label: "Korespondenční adresa – ulice, č.p./orientační", kind: "text", target: { table: "employees", column: "correspondence_address", path: "ulice" } },
  "Textové pole 1_16": { key: "koresp_obec", label: "Korespondenční adresa – obec, PSČ, stát", kind: "text", target: { table: "employees", column: "correspondence_address", path: "mesto" } },
  "Textové pole 1_17": { key: "telefon", label: "Telefonní číslo", kind: "text", target: { table: "employees", column: "phone" } },
  "Textové pole 1_18": { key: "email", label: "E-mailová adresa", kind: "text", target: { table: "employees", column: "private_email" } },
  "Textové pole 1_19": { key: "heslo_elektronicka_komunikace", label: "Heslo pro elektronickou komunikaci", kind: "text", target: null },
  "Textové pole 1_20": { key: "cislo_uctu", label: "Číslo bankovního účtu pro výplatu mzdy", kind: "text", target: { table: "employee_sensitive_data", column: "bank_account" } },
  "Textové pole 1_21": { key: "nejvyssi_vzdelani", label: "Nejvyšší dosažené vzdělání", kind: "dropdown", target: { table: "employees", column: "highest_education" } },
  "Textové pole 1_22": { key: "zdravotni_pojistovna", label: "Zdravotní pojišťovna", kind: "dropdown", target: { table: "employees", column: "health_insurance_company" } },
  "UplatneniProhlaseni1": { key: "tax_uplatneni_prohlaseni", label: "Uplatnění prohlášení poplatníka (\"růžový formulář\")", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "tax_declaration", field: "uplatneni_prohlaseni" } },
  "Základní slevy na poplatníka": { key: "tax_zakladni_sleva", label: "Uplatňované slevy – základní sleva na poplatníka", kind: "checkbox", target: { table: "employee_payroll_data", bucket: "tax_declaration", field: "zakladni_sleva" } },
  "Sleva na manžela/manželku": { key: "tax_sleva_manzel", label: "Uplatňované slevy – sleva na manžela/manželku", kind: "checkbox", target: { table: "employee_payroll_data", bucket: "tax_declaration", field: "sleva_manzel" } },
  "Sleva na invaliditu (I., II., III. stupeň)": { key: "tax_sleva_invalidita", label: "Uplatňované slevy – sleva na invaliditu", kind: "checkbox", target: { table: "employee_payroll_data", bucket: "tax_declaration", field: "sleva_invalidita" } },

  // --- strana 3-4: Deti / manzel(ka) / jina vyzivovana osoba (6 "slotov") ---
  "Textové pole 1_23": { key: "dite1_jmeno", label: "1. dítě – jméno a příjmení", kind: "text", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite1", field: "jmeno" } },
  "Textové pole 1_24": { key: "dite1_datum_rc", label: "1. dítě – datum narození, rodné číslo", kind: "text", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite1", field: "datum_narozeni_rc" } },
  "NarokOsoba1": { key: "dite1_narok", label: "1. dítě – nárok na daňové zvýhodnění", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite1", field: "narok_danove_zvyhodneni" } },
  "PotvrzeniStudia1": { key: "dite1_studium", label: "1. dítě – potvrzení o studiu/předškolní docházce", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite1", field: "potvrzeni_studia" } },
  "PotvrzeniNeuplatneni1": { key: "dite1_neuplatneni", label: "1. dítě – potvrzení o neuplatnění zvýhodnění druhým poplatníkem", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite1", field: "potvrzeni_neuplatneni_druhym" } },

  "Textové pole 1_25": { key: "dite2_jmeno", label: "2. dítě – jméno a příjmení", kind: "text", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite2", field: "jmeno" } },
  "Textové pole 1_26": { key: "dite2_datum_rc", label: "2. dítě – datum narození, rodné číslo", kind: "text", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite2", field: "datum_narozeni_rc" } },
  "NarokOsoba2": { key: "dite2_narok", label: "2. dítě – nárok na daňové zvýhodnění", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite2", field: "narok_danove_zvyhodneni" } },
  "PotvrzeniStudia2": { key: "dite2_studium", label: "2. dítě – potvrzení o studiu/předškolní docházce", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite2", field: "potvrzeni_studia" } },
  "PotvrzeniNeuplatneni2": { key: "dite2_neuplatneni", label: "2. dítě – potvrzení o neuplatnění zvýhodnění druhým poplatníkem", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite2", field: "potvrzeni_neuplatneni_druhym" } },

  "Textové pole 1_27": { key: "dite3_jmeno", label: "3. dítě – jméno a příjmení", kind: "text", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite3", field: "jmeno" } },
  "Textové pole 1_28": { key: "dite3_datum_rc", label: "3. dítě – datum narození, rodné číslo", kind: "text", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite3", field: "datum_narozeni_rc" } },
  "NarokOsoba3": { key: "dite3_narok", label: "3. dítě – nárok na daňové zvýhodnění", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite3", field: "narok_danove_zvyhodneni" } },
  "PotvrzeniStudia3": { key: "dite3_studium", label: "3. dítě – potvrzení o studiu/předškolní docházce", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite3", field: "potvrzeni_studia" } },
  "PotvrzeniNeuplatneni3": { key: "dite3_neuplatneni", label: "3. dítě – potvrzení o neuplatnění zvýhodnění druhým poplatníkem", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite3", field: "potvrzeni_neuplatneni_druhym" } },

  "Textové pole 1_29": { key: "dite4_jmeno", label: "4. dítě – jméno a příjmení", kind: "text", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite4", field: "jmeno" } },
  "Textové pole 1_30": { key: "dite4_datum_rc", label: "4. dítě – datum narození, rodné číslo", kind: "text", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite4", field: "datum_narozeni_rc" } },
  "NarokOsoba4": { key: "dite4_narok", label: "4. dítě – nárok na daňové zvýhodnění", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite4", field: "narok_danove_zvyhodneni" } },
  "PotvrzeniStudia4": { key: "dite4_studium", label: "4. dítě – potvrzení o studiu/předškolní docházce", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite4", field: "potvrzeni_studia" } },
  "PotvrzeniNeuplatneni4": { key: "dite4_neuplatneni", label: "4. dítě – potvrzení o neuplatnění zvýhodnění druhým poplatníkem", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite4", field: "potvrzeni_neuplatneni_druhym" } },

  "Textové pole 1_31": { key: "manzel_jmeno", label: "Manžel/ka – jméno a příjmení", kind: "text", target: { table: "employee_payroll_data", bucket: "dependents", slot: "manzel", field: "jmeno" } },
  "Textové pole 1_32": { key: "manzel_datum_rc", label: "Manžel/ka – datum narození, rodné číslo", kind: "text", target: { table: "employee_payroll_data", bucket: "dependents", slot: "manzel", field: "datum_narozeni_rc" } },
  "NarokOsoba5": { key: "manzel_narok", label: "Manžel/ka – nárok na daňové zvýhodnění", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "manzel", field: "narok_danove_zvyhodneni" } },
  "SlevaOsoba5": { key: "manzel_sleva", label: "Manžel/ka – uplatnění slevy na manžela/manželku", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "manzel", field: "uplatneni_slevy" } },
  "ProhlaseniPrijmu5": { key: "manzel_prohlaseni_prijmu", label: "Manžel/ka – čestné prohlášení o výši příjmů", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "manzel", field: "cestne_prohlaseni_prijmu" } },

  "Textové pole 1_33": { key: "jina_osoba_jmeno", label: "Jiná vyživovaná osoba – jméno a příjmení", kind: "text", target: { table: "employee_payroll_data", bucket: "dependents", slot: "jina_osoba", field: "jmeno" } },
  "Textové pole 1_34": { key: "jina_osoba_datum_rc", label: "Jiná vyživovaná osoba – datum narození, rodné číslo", kind: "text", target: { table: "employee_payroll_data", bucket: "dependents", slot: "jina_osoba", field: "datum_narozeni_rc" } },
  "TytezDeti6": { key: "jina_osoba_tytez_deti", label: "Jiná vyživovaná osoba – vyživuje tytéž děti v téže domácnosti", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "jina_osoba", field: "vyzivuje_tytez_deti" } },

  // --- strana 5: Zamestnani / pracovnepravni vztah, exekuce ---
  "Textové pole 1_35": { key: "pracovni_pozice_nazev", label: "Název pracovní pozice dle pracovní smlouvy", kind: "text", target: null },
  "Pole pro datum 1_2": { key: "datum_nastupu", label: "Datum nástupu do zaměstnání", kind: "date", target: { table: "employment_relationships", column: "start_date" } },
  "Textové pole 1_36": { key: "sjednana_pracovni_doba", label: "Sjednaná pracovní doba (úvazek, rozsah)", kind: "text", target: null },
  "Textové pole 1_37": { key: "adresa_vykonu_prace", label: "Adresa místa výkonu práce", kind: "text", target: { table: "employment_relationships", column: "workplace" } },
  "VedouciPracovnik1": { key: "vedouci_pracovnik", label: "Vedoucí pracovník", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "concurrent_employment", field: "vedouci_pracovnik" } },
  "SoubehTehoz1": { key: "soubeh_tehoz_zamestnavatele", label: "Souběžný pracovní poměr u téhož zaměstnavatele", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "concurrent_employment", field: "soubeh_tehoz_zamestnavatele" } },
  "Textové pole 1_38": { key: "jiny_zamestnavatel_nazev", label: "Souběžný pracovní poměr – název zaměstnavatele, sídlo", kind: "text", target: { table: "employee_payroll_data", bucket: "concurrent_employment", field: "jiny_zamestnavatel_nazev_sidlo" } },
  "Textové pole 1_39": { key: "jiny_zamestnavatel_misto", label: "Souběžný pracovní poměr – místo výkonu práce, druh vztahu", kind: "text", target: { table: "employee_payroll_data", bucket: "concurrent_employment", field: "jiny_zamestnavatel_misto_druh" } },
  "Exekuce1": { key: "exekuce_insolvence", label: "Prohlašuji, že exekuční/insolvenční srážky", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "garnishments", field: "exekuce_insolvence_prohlaseni" } },
  "ztpp1": { key: "ztpp_drzitel", label: "Držitel průkazu ZTP/P", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "ztpp_drzitel" } },

  // --- strana 5-6: Typ zdravotniho omezeni (5 nezavislych checkboxov) ---
  "III. stupeň invalidity": { key: "omezeni_typ_iii_plain", label: "Typ zdravotního omezení – III. stupeň invalidity", kind: "checkbox", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "omezeni_typ_iii_stupen" } },
  "III. stupeň invalidity – schopnost výdělečné činnostiza zcela mimořádných podmínek": { key: "omezeni_typ_iii_mimoradne", label: "Typ zdravotního omezení – III. stupeň, schopnost výdělečné činnosti za zcela mimořádných podmínek", kind: "checkbox", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "omezeni_typ_iii_stupen_mimoradne" } },
  "II. stupeň invalidity": { key: "omezeni_typ_ii", label: "Typ zdravotního omezení – II. stupeň invalidity", kind: "checkbox", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "omezeni_typ_ii_stupen" } },
  "I. stupeň invalidity": { key: "omezeni_typ_i", label: "Typ zdravotního omezení – I. stupeň invalidity", kind: "checkbox", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "omezeni_typ_i_stupen" } },
  "Přiznaný POUZE statut OZZ (osoba zdravotně znevýhodněná)": { key: "omezeni_ozz", label: "Typ zdravotního omezení – přiznaný pouze statut OZZ", kind: "checkbox", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "omezeni_ozz" } },

  "Pole pro datum 1_3": { key: "omezeni_od", label: "Zdravotní omezení přiznané od", kind: "date", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "omezeni_priznane_od" } },
  "Pole pro datum 1_4": { key: "omezeni_do", label: "Zdravotní omezení přiznané do", kind: "date", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "omezeni_priznane_do" } },
  "Invalida1": { key: "potvrzeni_invalidite", label: "Potvrzení o invaliditě", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "potvrzeni_invalidite" } },

  // --- strana 6: Evidence duchodu (6 checkboxov) ---
  "Starobní": { key: "duchod_starobni", label: "Evidence důchodu – starobní", kind: "checkbox", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "duchod_starobni" } },
  "Invalidní 3. stupně": { key: "duchod_invalidni_3", label: "Evidence důchodu – invalidní 3. stupně", kind: "checkbox", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "duchod_invalidni_3_stupne" } },
  "Invalidní 1. nebo 2. stupně": { key: "duchod_invalidni_12", label: "Evidence důchodu – invalidní 1. nebo 2. stupně", kind: "checkbox", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "duchod_invalidni_1_2_stupne" } },
  "Cizí charakteru starobního": { key: "duchod_cizi_starobni", label: "Evidence důchodu – cizí charakteru starobního", kind: "checkbox", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "duchod_cizi_charakteru_starobni" } },
  "Cizí charakteru invalidního 3. stupně": { key: "duchod_cizi_invalidni_3", label: "Evidence důchodu – cizí charakteru invalidního 3. stupně", kind: "checkbox", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "duchod_cizi_charakteru_invalidni_3" } },
  "Cizí charakteru invalidního 1. nebo 2. stupně": { key: "duchod_cizi_invalidni_12", label: "Evidence důchodu – cizí charakteru invalidního 1. nebo 2. stupně", kind: "checkbox", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "duchod_cizi_charakteru_invalidni_1_2" } },

  "Pole pro datum 1_5": { key: "duchod_od", label: "Důchod pobírán od", kind: "date", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "duchod_pobiran_od" } },
  "Pole pro datum 1_6": { key: "duchod_do", label: "Důchod pobírán do", kind: "date", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "duchod_pobiran_do" } },
  "StarobniPredcasny1": { key: "duchod_predcasny", label: "Předčasný starobní důchod", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "duchod_predcasny_starobni" } },
  "StarobniSnizeny1": { key: "duchod_snizeny_vek", label: "Poživatel starobního důchodu se sníženým důchodovým věkem", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "duchod_snizeny_duchodovy_vek" } },
  "StarobniPotvrzeni1": { key: "duchod_potvrzeni_priznani", label: "Potvrzení o přiznání důchodu", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "duchod_potvrzeni_priznani" } },

  // --- strana 7: Udaje o cizinci ---
  "Textové pole 1_40": { key: "cizinec_doklad_cislo_typ", label: "Cizinec – číslo a typ cestovního dokladu", kind: "text", target: { table: "employee_sensitive_data", column: "foreigner_data", path: "doklad_cislo_typ" } },
  "Textové pole 1_41": { key: "cizinec_doklad_organ", label: "Cizinec – orgán vydávající doklad", kind: "text", target: { table: "employee_sensitive_data", column: "foreigner_data", path: "doklad_vydavajici_organ" } },
  "Textové pole 1_42": { key: "cizinec_doklad_stat", label: "Cizinec – stát vydání dokladu", kind: "text", target: { table: "employee_sensitive_data", column: "foreigner_data", path: "doklad_stat_vydani" } },
  "Textové pole 1_43": { key: "cizinec_adresa_cr", label: "Cizinec – adresa pobytu v ČR", kind: "text", target: { table: "employee_sensitive_data", column: "foreigner_data", path: "adresa_pobytu_cr" } },
  "Textové pole 1_44": { key: "cizinec_danova_rezidence", label: "Cizinec – stát a adresa daňové rezidence (včetně data od)", kind: "text", target: { table: "employee_sensitive_data", column: "foreigner_data", path: "danova_rezidence" } },
  "Textové pole 1_45": { key: "cizinec_danovy_identifikator", label: "Cizinec – daňový identifikátor", kind: "text", target: { table: "employee_sensitive_data", column: "foreigner_data", path: "danovy_identifikator" } },
  "Textové pole 1_46": { key: "cizinec_typ_danove_identifikace", label: "Cizinec – typ daňové identifikace", kind: "text", target: { table: "employee_sensitive_data", column: "foreigner_data", path: "typ_danove_identifikace" } },
  "Textové pole 1_47": { key: "cizinec_typ_pracovniho_opravneni", label: "Cizinec – typ pracovního oprávnění", kind: "text", target: { table: "employee_sensitive_data", column: "foreigner_data", path: "typ_pracovniho_opravneni" } },
  "Textové pole 1_48": { key: "cizinec_cislo_pracovniho_opravneni", label: "Cizinec – číslo pracovního oprávnění, orgán vydání, platnost", kind: "text", target: { table: "employee_sensitive_data", column: "foreigner_data", path: "cislo_pracovniho_opravneni" } },
  "Textové pole 1_49": { key: "cizinec_cislo_pojisteni_zp_1", label: "Cizinec – číslo pojištění ZP (1)", kind: "text", target: { table: "employee_sensitive_data", column: "foreigner_data", path: "cislo_pojisteni_zp_1" } },
  "Textové pole 1_50": { key: "cizinec_cislo_pojisteni_zp_2", label: "Cizinec – číslo pojištění ZP (2)", kind: "text", target: { table: "employee_sensitive_data", column: "foreigner_data", path: "cislo_pojisteni_zp_2" } },
  "Podleha1": { key: "cizinec_podleha_socialnimu_zabezpeceni", label: "Podléhá zaměstnanec právním předpisům sociálního zabezpečení jiného státu", kind: "radio_ano_ne", target: { table: "employee_sensitive_data", column: "foreigner_data", path: "podleha_socialnimu_zabezpeceni_jineho_statu" } },
  "Textové pole 1_51": { key: "cizinec_kod_statu_socialni_pojisteni", label: "Kód státu cizí státní příslušnosti sociálního pojištění", kind: "text", target: { table: "employee_sensitive_data", column: "foreigner_data", path: "kod_statu_socialniho_pojisteni" } },

  // --- strana 8: Prohlaseni zamestnance (podpis - informativne, nezapisuje sa) ---
  "Textové pole 1_52": { key: "prohlaseni_datum", label: "Datum prohlášení/podpisu", kind: "text", target: null },
  "Textové pole 1_53": { key: "prohlaseni_podpis", label: "Podpis zaměstnance (vyplněno textově cez \"Vyplnit a podepsat\")", kind: "text", target: null },
};

// Mapa pre druhu SKUTOCNE DODANU vzorku (hr-podklady/JMHZ_dotaznik_vyplneny_original.pdf,
// lokalny, necommitnuty subor). Jej verzia "20.3.2026 C" je overena NIE z
// vizualneho textu na strane (poppler/pdftoppm nie je v tomto prostredi k
// dispozicii, viz zaverecna sprava bod J), ale z XMP metadat vlozenych priamo
// v PDF (overitelne kedykolvek, bez renderovania stranky): dc:date/CreationDate
// = 2026-03-20T13:57:53+01:00, pdf:Producer = "LibreOffice 25.8.3.2" - presne
// zodpoveda oznaceniu "20.3.2026 C".
//
// Rigorozne porovnanie VSETKYCH 99 AcroForm poli tohto suboru oproti
// verejnemu 25.3.2026 vzoru (nazov PO decodeLibreOfficeFieldName, typ
// PDFField, strana, x/y pozicia widgetu s toleranciou 3pt) NEZISTILO ANI
// JEDEN strukturalny rozdiel - viz src/lib/hr/jmhzPdf.crossVersionParity.test.js,
// ktory tento vysledok overuje priamo proti obom realnym suborom pri kazdom
// behu testov (zlyha, ak sa niekedy zistí odchylka). Obsah mapy je preto
// zhodny s V20260325_FIELDS, ale je to ZAMERNE samostatny objekt (nie
// referencia/alias na V20260325_FIELDS) - podla poziadavky "nesnaž se obě
// verze násilně sjednotit": kazda verzia ma svoju vlastnu, nezavisle
// upravitelnu definiciu, ktora by sa v buducnosti mohla rozist bez dopadu
// na tu druhu.
const V20260320C_FIELDS = {
  // --- strana 1: Identifikacni udaje zamestnance ---
  "Textové pole 1": { key: "titul", label: "Titul", kind: "text", target: { table: "employees", column: "title" } },
  "Textové pole 1_2": { key: "jmeno", label: "Jméno", kind: "text", target: { table: "employees", column: "first_name" } },
  "Textové pole 1_3": { key: "prijmeni", label: "Příjmení", kind: "text", target: { table: "employees", column: "last_name" } },
  "Textové pole 1_4": { key: "rodne_prijmeni", label: "Rodné příjmení", kind: "text", target: { table: "employees", column: "maiden_name" } },
  "Textové pole 1_5": { key: "ostatni_prijmeni", label: "Ostatní příjmení", kind: "text", target: null },
  "Pole pro datum 1": { key: "datum_narozeni", label: "Datum narození", kind: "date", target: { table: "employees", column: "date_of_birth" } },
  "Textové pole 1_6": { key: "pohlavi", label: "Pohlaví", kind: "dropdown", target: { table: "employees", column: "gender" } },
  "Textové pole 1_7": { key: "misto_narozeni", label: "Místo narození", kind: "text", target: { table: "employees", column: "place_of_birth" } },
  "Textové pole 1_8": { key: "stat_narozeni", label: "Stát narození", kind: "text", target: { table: "employees", column: "country_of_birth" } },
  "Textové pole 1_9": { key: "rodne_cislo", label: "Rodné číslo, pokud uděleno", kind: "text", target: { table: "employee_sensitive_data", column: "birth_number" } },
  "Textové pole 1_10": { key: "statni_obcanstvi", label: "Státní občanství", kind: "text", target: { table: "employees", column: "nationality" } },
  "Textové pole 1_11": { key: "typ_prukazu", label: "Typ průkazu", kind: "text", target: { table: "employees", column: "id_document_type" } },
  "Textové pole 1_12": { key: "cislo_prukazu", label: "Číslo průkazu", kind: "text", target: { table: "employee_sensitive_data", column: "id_document_number" } },
  "Textové pole 1_13": { key: "trvale_ulice", label: "Trvalé bydliště – ulice, č.p./orientační", kind: "text", target: { table: "employees", column: "permanent_address", path: "ulice" } },
  "Textové pole 1_14": { key: "trvale_obec", label: "Trvalé bydliště – obec, PSČ, stát", kind: "text", target: { table: "employees", column: "permanent_address", path: "mesto" } },

  // --- strana 2: Korespondencni adresa, kontakt, vzdelani, pojistovna, slevy ---
  "Textové pole 1_15": { key: "koresp_ulice", label: "Korespondenční adresa – ulice, č.p./orientační", kind: "text", target: { table: "employees", column: "correspondence_address", path: "ulice" } },
  "Textové pole 1_16": { key: "koresp_obec", label: "Korespondenční adresa – obec, PSČ, stát", kind: "text", target: { table: "employees", column: "correspondence_address", path: "mesto" } },
  "Textové pole 1_17": { key: "telefon", label: "Telefonní číslo", kind: "text", target: { table: "employees", column: "phone" } },
  "Textové pole 1_18": { key: "email", label: "E-mailová adresa", kind: "text", target: { table: "employees", column: "private_email" } },
  "Textové pole 1_19": { key: "heslo_elektronicka_komunikace", label: "Heslo pro elektronickou komunikaci", kind: "text", target: null },
  "Textové pole 1_20": { key: "cislo_uctu", label: "Číslo bankovního účtu pro výplatu mzdy", kind: "text", target: { table: "employee_sensitive_data", column: "bank_account" } },
  "Textové pole 1_21": { key: "nejvyssi_vzdelani", label: "Nejvyšší dosažené vzdělání", kind: "dropdown", target: { table: "employees", column: "highest_education" } },
  "Textové pole 1_22": { key: "zdravotni_pojistovna", label: "Zdravotní pojišťovna", kind: "dropdown", target: { table: "employees", column: "health_insurance_company" } },
  "UplatneniProhlaseni1": { key: "tax_uplatneni_prohlaseni", label: "Uplatnění prohlášení poplatníka (\"růžový formulář\")", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "tax_declaration", field: "uplatneni_prohlaseni" } },
  "Základní slevy na poplatníka": { key: "tax_zakladni_sleva", label: "Uplatňované slevy – základní sleva na poplatníka", kind: "checkbox", target: { table: "employee_payroll_data", bucket: "tax_declaration", field: "zakladni_sleva" } },
  "Sleva na manžela/manželku": { key: "tax_sleva_manzel", label: "Uplatňované slevy – sleva na manžela/manželku", kind: "checkbox", target: { table: "employee_payroll_data", bucket: "tax_declaration", field: "sleva_manzel" } },
  "Sleva na invaliditu (I., II., III. stupeň)": { key: "tax_sleva_invalidita", label: "Uplatňované slevy – sleva na invaliditu", kind: "checkbox", target: { table: "employee_payroll_data", bucket: "tax_declaration", field: "sleva_invalidita" } },

  // --- strana 3-4: Deti / manzel(ka) / jina vyzivovana osoba (6 "slotov") ---
  "Textové pole 1_23": { key: "dite1_jmeno", label: "1. dítě – jméno a příjmení", kind: "text", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite1", field: "jmeno" } },
  "Textové pole 1_24": { key: "dite1_datum_rc", label: "1. dítě – datum narození, rodné číslo", kind: "text", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite1", field: "datum_narozeni_rc" } },
  "NarokOsoba1": { key: "dite1_narok", label: "1. dítě – nárok na daňové zvýhodnění", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite1", field: "narok_danove_zvyhodneni" } },
  "PotvrzeniStudia1": { key: "dite1_studium", label: "1. dítě – potvrzení o studiu/předškolní docházce", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite1", field: "potvrzeni_studia" } },
  "PotvrzeniNeuplatneni1": { key: "dite1_neuplatneni", label: "1. dítě – potvrzení o neuplatnění zvýhodnění druhým poplatníkem", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite1", field: "potvrzeni_neuplatneni_druhym" } },

  "Textové pole 1_25": { key: "dite2_jmeno", label: "2. dítě – jméno a příjmení", kind: "text", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite2", field: "jmeno" } },
  "Textové pole 1_26": { key: "dite2_datum_rc", label: "2. dítě – datum narození, rodné číslo", kind: "text", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite2", field: "datum_narozeni_rc" } },
  "NarokOsoba2": { key: "dite2_narok", label: "2. dítě – nárok na daňové zvýhodnění", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite2", field: "narok_danove_zvyhodneni" } },
  "PotvrzeniStudia2": { key: "dite2_studium", label: "2. dítě – potvrzení o studiu/předškolní docházce", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite2", field: "potvrzeni_studia" } },
  "PotvrzeniNeuplatneni2": { key: "dite2_neuplatneni", label: "2. dítě – potvrzení o neuplatnění zvýhodnění druhým poplatníkem", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite2", field: "potvrzeni_neuplatneni_druhym" } },

  "Textové pole 1_27": { key: "dite3_jmeno", label: "3. dítě – jméno a příjmení", kind: "text", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite3", field: "jmeno" } },
  "Textové pole 1_28": { key: "dite3_datum_rc", label: "3. dítě – datum narození, rodné číslo", kind: "text", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite3", field: "datum_narozeni_rc" } },
  "NarokOsoba3": { key: "dite3_narok", label: "3. dítě – nárok na daňové zvýhodnění", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite3", field: "narok_danove_zvyhodneni" } },
  "PotvrzeniStudia3": { key: "dite3_studium", label: "3. dítě – potvrzení o studiu/předškolní docházce", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite3", field: "potvrzeni_studia" } },
  "PotvrzeniNeuplatneni3": { key: "dite3_neuplatneni", label: "3. dítě – potvrzení o neuplatnění zvýhodnění druhým poplatníkem", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite3", field: "potvrzeni_neuplatneni_druhym" } },

  "Textové pole 1_29": { key: "dite4_jmeno", label: "4. dítě – jméno a příjmení", kind: "text", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite4", field: "jmeno" } },
  "Textové pole 1_30": { key: "dite4_datum_rc", label: "4. dítě – datum narození, rodné číslo", kind: "text", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite4", field: "datum_narozeni_rc" } },
  "NarokOsoba4": { key: "dite4_narok", label: "4. dítě – nárok na daňové zvýhodnění", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite4", field: "narok_danove_zvyhodneni" } },
  "PotvrzeniStudia4": { key: "dite4_studium", label: "4. dítě – potvrzení o studiu/předškolní docházce", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite4", field: "potvrzeni_studia" } },
  "PotvrzeniNeuplatneni4": { key: "dite4_neuplatneni", label: "4. dítě – potvrzení o neuplatnění zvýhodnění druhým poplatníkem", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "dite4", field: "potvrzeni_neuplatneni_druhym" } },

  "Textové pole 1_31": { key: "manzel_jmeno", label: "Manžel/ka – jméno a příjmení", kind: "text", target: { table: "employee_payroll_data", bucket: "dependents", slot: "manzel", field: "jmeno" } },
  "Textové pole 1_32": { key: "manzel_datum_rc", label: "Manžel/ka – datum narození, rodné číslo", kind: "text", target: { table: "employee_payroll_data", bucket: "dependents", slot: "manzel", field: "datum_narozeni_rc" } },
  "NarokOsoba5": { key: "manzel_narok", label: "Manžel/ka – nárok na daňové zvýhodnění", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "manzel", field: "narok_danove_zvyhodneni" } },
  "SlevaOsoba5": { key: "manzel_sleva", label: "Manžel/ka – uplatnění slevy na manžela/manželku", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "manzel", field: "uplatneni_slevy" } },
  "ProhlaseniPrijmu5": { key: "manzel_prohlaseni_prijmu", label: "Manžel/ka – čestné prohlášení o výši příjmů", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "manzel", field: "cestne_prohlaseni_prijmu" } },

  "Textové pole 1_33": { key: "jina_osoba_jmeno", label: "Jiná vyživovaná osoba – jméno a příjmení", kind: "text", target: { table: "employee_payroll_data", bucket: "dependents", slot: "jina_osoba", field: "jmeno" } },
  "Textové pole 1_34": { key: "jina_osoba_datum_rc", label: "Jiná vyživovaná osoba – datum narození, rodné číslo", kind: "text", target: { table: "employee_payroll_data", bucket: "dependents", slot: "jina_osoba", field: "datum_narozeni_rc" } },
  "TytezDeti6": { key: "jina_osoba_tytez_deti", label: "Jiná vyživovaná osoba – vyživuje tytéž děti v téže domácnosti", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "dependents", slot: "jina_osoba", field: "vyzivuje_tytez_deti" } },

  // --- strana 5: Zamestnani / pracovnepravni vztah, exekuce ---
  "Textové pole 1_35": { key: "pracovni_pozice_nazev", label: "Název pracovní pozice dle pracovní smlouvy", kind: "text", target: null },
  "Pole pro datum 1_2": { key: "datum_nastupu", label: "Datum nástupu do zaměstnání", kind: "date", target: { table: "employment_relationships", column: "start_date" } },
  "Textové pole 1_36": { key: "sjednana_pracovni_doba", label: "Sjednaná pracovní doba (úvazek, rozsah)", kind: "text", target: null },
  "Textové pole 1_37": { key: "adresa_vykonu_prace", label: "Adresa místa výkonu práce", kind: "text", target: { table: "employment_relationships", column: "workplace" } },
  "VedouciPracovnik1": { key: "vedouci_pracovnik", label: "Vedoucí pracovník", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "concurrent_employment", field: "vedouci_pracovnik" } },
  "SoubehTehoz1": { key: "soubeh_tehoz_zamestnavatele", label: "Souběžný pracovní poměr u téhož zaměstnavatele", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "concurrent_employment", field: "soubeh_tehoz_zamestnavatele" } },
  "Textové pole 1_38": { key: "jiny_zamestnavatel_nazev", label: "Souběžný pracovní poměr – název zaměstnavatele, sídlo", kind: "text", target: { table: "employee_payroll_data", bucket: "concurrent_employment", field: "jiny_zamestnavatel_nazev_sidlo" } },
  "Textové pole 1_39": { key: "jiny_zamestnavatel_misto", label: "Souběžný pracovní poměr – místo výkonu práce, druh vztahu", kind: "text", target: { table: "employee_payroll_data", bucket: "concurrent_employment", field: "jiny_zamestnavatel_misto_druh" } },
  "Exekuce1": { key: "exekuce_insolvence", label: "Prohlašuji, že exekuční/insolvenční srážky", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "garnishments", field: "exekuce_insolvence_prohlaseni" } },
  "ztpp1": { key: "ztpp_drzitel", label: "Držitel průkazu ZTP/P", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "ztpp_drzitel" } },

  // --- strana 5-6: Typ zdravotniho omezeni (5 nezavislych checkboxov) ---
  "III. stupeň invalidity": { key: "omezeni_typ_iii_plain", label: "Typ zdravotního omezení – III. stupeň invalidity", kind: "checkbox", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "omezeni_typ_iii_stupen" } },
  "III. stupeň invalidity – schopnost výdělečné činnostiza zcela mimořádných podmínek": { key: "omezeni_typ_iii_mimoradne", label: "Typ zdravotního omezení – III. stupeň, schopnost výdělečné činnosti za zcela mimořádných podmínek", kind: "checkbox", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "omezeni_typ_iii_stupen_mimoradne" } },
  "II. stupeň invalidity": { key: "omezeni_typ_ii", label: "Typ zdravotního omezení – II. stupeň invalidity", kind: "checkbox", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "omezeni_typ_ii_stupen" } },
  "I. stupeň invalidity": { key: "omezeni_typ_i", label: "Typ zdravotního omezení – I. stupeň invalidity", kind: "checkbox", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "omezeni_typ_i_stupen" } },
  "Přiznaný POUZE statut OZZ (osoba zdravotně znevýhodněná)": { key: "omezeni_ozz", label: "Typ zdravotního omezení – přiznaný pouze statut OZZ", kind: "checkbox", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "omezeni_ozz" } },

  "Pole pro datum 1_3": { key: "omezeni_od", label: "Zdravotní omezení přiznané od", kind: "date", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "omezeni_priznane_od" } },
  "Pole pro datum 1_4": { key: "omezeni_do", label: "Zdravotní omezení přiznané do", kind: "date", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "omezeni_priznane_do" } },
  "Invalida1": { key: "potvrzeni_invalidite", label: "Potvrzení o invaliditě", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "potvrzeni_invalidite" } },

  // --- strana 6: Evidence duchodu (6 checkboxov) ---
  "Starobní": { key: "duchod_starobni", label: "Evidence důchodu – starobní", kind: "checkbox", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "duchod_starobni" } },
  "Invalidní 3. stupně": { key: "duchod_invalidni_3", label: "Evidence důchodu – invalidní 3. stupně", kind: "checkbox", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "duchod_invalidni_3_stupne" } },
  "Invalidní 1. nebo 2. stupně": { key: "duchod_invalidni_12", label: "Evidence důchodu – invalidní 1. nebo 2. stupně", kind: "checkbox", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "duchod_invalidni_1_2_stupne" } },
  "Cizí charakteru starobního": { key: "duchod_cizi_starobni", label: "Evidence důchodu – cizí charakteru starobního", kind: "checkbox", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "duchod_cizi_charakteru_starobni" } },
  "Cizí charakteru invalidního 3. stupně": { key: "duchod_cizi_invalidni_3", label: "Evidence důchodu – cizí charakteru invalidního 3. stupně", kind: "checkbox", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "duchod_cizi_charakteru_invalidni_3" } },
  "Cizí charakteru invalidního 1. nebo 2. stupně": { key: "duchod_cizi_invalidni_12", label: "Evidence důchodu – cizí charakteru invalidního 1. nebo 2. stupně", kind: "checkbox", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "duchod_cizi_charakteru_invalidni_1_2" } },

  "Pole pro datum 1_5": { key: "duchod_od", label: "Důchod pobírán od", kind: "date", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "duchod_pobiran_od" } },
  "Pole pro datum 1_6": { key: "duchod_do", label: "Důchod pobírán do", kind: "date", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "duchod_pobiran_do" } },
  "StarobniPredcasny1": { key: "duchod_predcasny", label: "Předčasný starobní důchod", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "duchod_predcasny_starobni" } },
  "StarobniSnizeny1": { key: "duchod_snizeny_vek", label: "Poživatel starobního důchodu se sníženým důchodovým věkem", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "duchod_snizeny_duchodovy_vek" } },
  "StarobniPotvrzeni1": { key: "duchod_potvrzeni_priznani", label: "Potvrzení o přiznání důchodu", kind: "radio_ano_ne", target: { table: "employee_payroll_data", bucket: "pension_insurance_status", field: "duchod_potvrzeni_priznani" } },

  // --- strana 7: Udaje o cizinci ---
  "Textové pole 1_40": { key: "cizinec_doklad_cislo_typ", label: "Cizinec – číslo a typ cestovního dokladu", kind: "text", target: { table: "employee_sensitive_data", column: "foreigner_data", path: "doklad_cislo_typ" } },
  "Textové pole 1_41": { key: "cizinec_doklad_organ", label: "Cizinec – orgán vydávající doklad", kind: "text", target: { table: "employee_sensitive_data", column: "foreigner_data", path: "doklad_vydavajici_organ" } },
  "Textové pole 1_42": { key: "cizinec_doklad_stat", label: "Cizinec – stát vydání dokladu", kind: "text", target: { table: "employee_sensitive_data", column: "foreigner_data", path: "doklad_stat_vydani" } },
  "Textové pole 1_43": { key: "cizinec_adresa_cr", label: "Cizinec – adresa pobytu v ČR", kind: "text", target: { table: "employee_sensitive_data", column: "foreigner_data", path: "adresa_pobytu_cr" } },
  "Textové pole 1_44": { key: "cizinec_danova_rezidence", label: "Cizinec – stát a adresa daňové rezidence (včetně data od)", kind: "text", target: { table: "employee_sensitive_data", column: "foreigner_data", path: "danova_rezidence" } },
  "Textové pole 1_45": { key: "cizinec_danovy_identifikator", label: "Cizinec – daňový identifikátor", kind: "text", target: { table: "employee_sensitive_data", column: "foreigner_data", path: "danovy_identifikator" } },
  "Textové pole 1_46": { key: "cizinec_typ_danove_identifikace", label: "Cizinec – typ daňové identifikace", kind: "text", target: { table: "employee_sensitive_data", column: "foreigner_data", path: "typ_danove_identifikace" } },
  "Textové pole 1_47": { key: "cizinec_typ_pracovniho_opravneni", label: "Cizinec – typ pracovního oprávnění", kind: "text", target: { table: "employee_sensitive_data", column: "foreigner_data", path: "typ_pracovniho_opravneni" } },
  "Textové pole 1_48": { key: "cizinec_cislo_pracovniho_opravneni", label: "Cizinec – číslo pracovního oprávnění, orgán vydání, platnost", kind: "text", target: { table: "employee_sensitive_data", column: "foreigner_data", path: "cislo_pracovniho_opravneni" } },
  "Textové pole 1_49": { key: "cizinec_cislo_pojisteni_zp_1", label: "Cizinec – číslo pojištění ZP (1)", kind: "text", target: { table: "employee_sensitive_data", column: "foreigner_data", path: "cislo_pojisteni_zp_1" } },
  "Textové pole 1_50": { key: "cizinec_cislo_pojisteni_zp_2", label: "Cizinec – číslo pojištění ZP (2)", kind: "text", target: { table: "employee_sensitive_data", column: "foreigner_data", path: "cislo_pojisteni_zp_2" } },
  "Podleha1": { key: "cizinec_podleha_socialnimu_zabezpeceni", label: "Podléhá zaměstnanec právním předpisům sociálního zabezpečení jiného státu", kind: "radio_ano_ne", target: { table: "employee_sensitive_data", column: "foreigner_data", path: "podleha_socialnimu_zabezpeceni_jineho_statu" } },
  "Textové pole 1_51": { key: "cizinec_kod_statu_socialni_pojisteni", label: "Kód státu cizí státní příslušnosti sociálního pojištění", kind: "text", target: { table: "employee_sensitive_data", column: "foreigner_data", path: "kod_statu_socialniho_pojisteni" } },

  // --- strana 8: Prohlaseni zamestnance (podpis - informativne, nezapisuje sa) ---
  "Textové pole 1_52": { key: "prohlaseni_datum", label: "Datum prohlášení/podpisu", kind: "text", target: null },
  "Textové pole 1_53": { key: "prohlaseni_podpis", label: "Podpis zaměstnance (vyplněno textově cez \"Vyplnit a podepsat\")", kind: "text", target: null },
};

export const JMHZ_FIELD_MAPS = {
  "25.3.2026": {
    versionLabel: "25.3.2026",
    sourceNote: "Verejne dostupny prazdny vzor (MRP): https://faq.mrp.cz/faqcz/obrazky/mrpks/dotaznik_mrp_jmhz4.pdf - " +
      "vsetky polia overene podla skutocnej pozicie widgetu na strane a textu popisku, nie len podla nazvu poľa.",
    fields: V20260325_FIELDS,
  },
  "20.3.2026 C": {
    versionLabel: "20.3.2026 C",
    sourceNote: "Skutocne dodany vyplneny original (hr-podklady/JMHZ_dotaznik_vyplneny_original.pdf, lokalny, " +
      "necommitnuty). Verzia potvrdena z XMP CreationDate (2026-03-20). Vsetkych 99 AcroForm poli overenych " +
      "priamo z tohto suboru (nazov, typ, pozicia) - zhodne s 25.3.2026, ale mapovane a udrziavane samostatne.",
    fields: V20260320C_FIELDS,
  },
};

// Precitaj VSETKY AcroForm/Widget polia z PDF (citatelny dekodovany nazov,
// surovy nazov ako ho ulozil PDF, typ) - diagnosticky krok na zistenie
// skutocnych nazvov poli KONKRETNEHO PDF pred vytvorenim/rozsirenim
// JMHZ_FIELD_MAPS pre danu verziu. "name" je uz po decodeLibreOfficeFieldName
// (co realne uvidi HR/vyvojar v UI aj v mape nizsie); "rawName" je povodny
// retazec presne tak, ako ho vracia pdf-lib.getName().
export async function listAcroFormFieldNames(pdfArrayBuffer) {
  const pdfDoc = await PDFDocument.load(pdfArrayBuffer, { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  return form.getFields().map((f) => {
    const rawName = f.getName();
    return { name: decodeLibreOfficeFieldName(rawName), rawName, type: f.constructor.name };
  });
}

// Index dekodovany-citatelny-nazov -> skutocny PDFField objekt (potrebny,
// pretoze form.getField(nazov) v pdf-lib hlada podla SUROVEHO, nie
// dekodovaneho nazvu - viz komentar pri decodeLibreOfficeFieldName vyssie).
export function buildDecodedFieldIndex(form) {
  const index = new Map();
  for (const f of form.getFields()) {
    index.set(decodeLibreOfficeFieldName(f.getName()), f);
  }
  return index;
}

// Precitaj hodnotu jedneho pola bez ohladu na typ - vrati surovu hodnotu,
// NIKDY nedomysla "nevyplnene = Nie".
function readFieldRaw(field, kind) {
  const ctorName = field.constructor.name;
  if (ctorName === "PDFTextField") {
    const v = field.getText();
    return v === undefined || v === null || v === "" ? null : v;
  }
  if (ctorName === "PDFCheckBox") {
    return field.isChecked();
  }
  if (ctorName === "PDFRadioGroup") {
    return field.getSelected() ?? null;
  }
  if (ctorName === "PDFDropdown") {
    const sel = field.getSelected();
    return sel && sel.length ? sel[0] : null;
  }
  return null;
}

function statusForKind(kind, raw) {
  if (kind === "checkbox") {
    // Nevybrane checkbox = NEZADANE (nikdy automaticky "Nie").
    return { status: raw === true ? FIELD_STATUS.POTVRDENE_ANO : FIELD_STATUS.NEZADANE, rawValue: raw };
  }
  if (kind === "radio_ano_ne") {
    // Radio ANO/NE JE explicitna odpoved - "NE" tu (na rozdiel od checkboxu)
    // znamena skutocne "Nie", pretoze ziadna volba = null (odlisitelne).
    if (raw === "ANO") return { status: FIELD_STATUS.POTVRDENE_ANO, rawValue: raw };
    if (raw === "NE") return { status: FIELD_STATUS.POTVRDENE_NIE, rawValue: raw };
    return { status: FIELD_STATUS.NEZADANE, rawValue: null };
  }
  // text / date / dropdown
  const isEmpty = raw === null || raw === undefined || raw === "";
  return { status: isEmpty ? FIELD_STATUS.NEZADANE : FIELD_STATUS.POTVRDENE_ANO, rawValue: isEmpty ? null : raw };
}

// Hlavna funkcia: precitaj PDF podla ZNAMEJ verzie (musi byt v
// JMHZ_FIELD_MAPS a mat neprazdnu mapu poli). Ak verzia nie je znama alebo
// jej mapa poli este nie je vyplnena, vrati { status: 'NEZNAMA_VERZIA' }
// namiesto tichej (nesprávnej) extrakcie - presne podla MASTER_PROMPT.
export async function extractJmhzFields(pdfArrayBuffer, versionLabel) {
  const map = JMHZ_FIELD_MAPS[versionLabel];
  if (!map || !map.fields || Object.keys(map.fields).length === 0) {
    return { status: "NEZNAMA_VERZIA", versionLabel, results: {} };
  }
  const pdfDoc = await PDFDocument.load(pdfArrayBuffer, { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  const decodedIndex = buildDecodedFieldIndex(form);
  const results = {};

  for (const [pdfFieldName, mapping] of Object.entries(map.fields)) {
    const field = decodedIndex.get(pdfFieldName);
    if (!field) {
      results[mapping.key] = { status: FIELD_STATUS.VYZADUJE_KONTROLU, rawValue: null, label: mapping.label, kind: mapping.kind, target: mapping.target, note: `Pole "${pdfFieldName}" v PDF nenájdeno - overiť verziu/mapu.` };
      continue;
    }
    const raw = readFieldRaw(field, mapping.kind);
    const { status, rawValue } = statusForKind(mapping.kind, raw);
    results[mapping.key] = { status, rawValue, label: mapping.label, kind: mapping.kind, target: mapping.target };
  }
  return { status: "OK", versionLabel, results };
}

// Detekcia verzie PDF - MRP verzny label je v texte kazdej strany ("Verze
// dokumentu ze dne D.M.RRRR") aj v title metadate. Toto je NAVRH rozhrania
// (nie spolahliva auto-detekcia) - vracia kandidatov, appka VZDY vyzaduje
// potvrdenie HR pred pouzitim konkretnej mapy (nikdy tichu automaticku volbu).
export async function detectJmhzVersionCandidates(pdfArrayBuffer) {
  const pdfDoc = await PDFDocument.load(pdfArrayBuffer, { ignoreEncryption: true });
  const title = pdfDoc.getTitle() || "";
  const subject = pdfDoc.getSubject() || "";
  const combined = `${title} ${subject}`;
  const known = Object.keys(JMHZ_FIELD_MAPS);
  const matches = known.filter((v) => combined.includes(v));
  return { detectedFrom: combined, candidates: matches, knownVersions: known };
}

// Verzia je typicky vytlacena aj priamo v texte kazdej strany ("Verze
// dokumentu ze dne 25.3.2026") - text sa neda spolahlivo vytiahnut z
// AcroForm/pdf-lib (nie je to formularove pole), preto ho appka necha
// PRECITAT clovekom z otvoreneho PDF a POTVRDIT vyberom zo zoznamu (viz
// JmhzImportScreen) namiesto pokusu o OCR/text-layer parsing.
export function knownJmhzVersions() {
  return Object.keys(JMHZ_FIELD_MAPS).map((v) => ({ value: v, label: v, hasMapping: Object.keys(JMHZ_FIELD_MAPS[v].fields).length > 0 }));
}
