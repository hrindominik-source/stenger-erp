// Vyplnenie PRAZDNEHO JMHZ dotaznika (MRP, verze 20.3.2026 C) udajmi zo
// systemu - opacny smer k jmhzPdf.js (import). Pouziva TU ISTU overenu mapu
// poli (JMHZ_FIELD_MAPS["20.3.2026 C"]) - ziadne hadanie podla poradia.
// Hodnoty su ploche hodnoty z employeeFields.js (valuesFromRecords).
// Datum a podpis na poslednej strane sa zamerne NEVYPLNUJU (podpisuje
// zamestnanec), rovnako "Heslo pro elektronickou komunikaci".
import { PDFDocument, PDFName, PDFBool } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { JMHZ_FIELD_MAPS, buildDecodedFieldIndex } from "./jmhzPdf.js";
import {
  CZ, EDUCATION_OPTIONS, STATE_OPTIONS, optionLabel, formatStreetLine, formatCityLine, isValuesForeigner,
} from "./employeeFields.js";

export const JMHZ_FILL_VERSION = "20.3.2026 C";
export const JMHZ_TEMPLATE_URL = "/hr/JMHZ_dotaznik_2026-03-20C.pdf";
export const JMHZ_FONT_URL = "/hr/DejaVuSans.ttf";

// ISO "1972-06-16" -> "16.6.1972" (rovnaky format, aky cita JMHZ import).
export function isoToCz(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  return `${d}.${m}.${y}`;
}

const yn = (b) => (b === true ? "ANO" : b === false ? "NE" : null);

function composeWorkingTime(v) {
  const hours = String(v.weekly_hours || "").trim();
  if (!hours) return "";
  const full = Number(hours.replace(",", ".")) >= 40;
  return `${full ? "plný úvazek" : "zkrácený úvazek"}, ${hours} h/týden`;
}

function composeForeignDoc(v, legacy) {
  const parts = [v.cz_doklad_cislo, v.cz_doklad_typ].filter(Boolean);
  return parts.length ? parts.join(", ") : (legacy?.doklad_cislo_typ || "");
}

function composeTaxResidence(v) {
  if (!v.stat_rezidence || v.stat_rezidence === CZ) return "";
  const street = formatStreetLine(v.rez_ulice, v.rez_cp, v.rez_co);
  const city = [v.rez_psc, v.rez_obec].filter(Boolean).join(" ");
  const from = v.rezidence_od ? `od ${isoToCz(v.rezidence_od)}` : "";
  return [v.stat_rezidence, street, city, from].filter(Boolean).join(", ");
}

function composeCzStay(v) {
  const street = formatStreetLine(v.pobyt_ulice, v.pobyt_cp, v.pobyt_co);
  return [street, [v.pobyt_psc, v.pobyt_obec].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

function composeWorkPermit(v) {
  const validity = v.cz_opravneni_od || v.cz_opravneni_do
    ? `platnost ${isoToCz(v.cz_opravneni_od) || "?"} – ${isoToCz(v.cz_opravneni_do) || "?"}`
    : "";
  return [v.cz_opravneni_id, v.cz_opravneni_up, validity].filter(Boolean).join(", ");
}

// Kluce = `key` z JMHZ mapy (jmhzPdf.js). Hodnota: string (text/date/
// dropdown), "ANO"/"NE"/null (radio), true/false (checkbox).
export function buildJmhzFillValues(v, extra = {}) {
  const foreigner = isValuesForeigner(v);
  const hasKontakt = !!(v.kontakt_ulice || v.kontakt_obec);
  const legacyForeign = extra.legacyForeignerData || {};
  return {
    titul: v.title,
    jmeno: v.first_name,
    prijmeni: v.last_name,
    rodne_prijmeni: v.maiden_name,
    ostatni_prijmeni: v.drivejsi_prijmeni,
    datum_narozeni: isoToCz(v.date_of_birth),
    pohlavi: v.gender === "muz" ? "Muž" : v.gender === "zena" ? "Žena" : "",
    misto_narozeni: v.place_of_birth,
    stat_narozeni: optionLabel(STATE_OPTIONS, v.country_of_birth),
    rodne_cislo: v.birth_number,
    statni_obcanstvi: optionLabel(STATE_OPTIONS, v.nationality),
    typ_prukazu: v.id_document_type,
    cislo_prukazu: v.id_document_number,
    trvale_ulice: formatStreetLine(v.perm_ulice, v.perm_cp, v.perm_co),
    trvale_obec: formatCityLine(v.perm_obec, v.perm_psc, v.perm_stat),
    koresp_ulice: hasKontakt ? formatStreetLine(v.kontakt_ulice, v.kontakt_cp, v.kontakt_co) : "",
    koresp_obec: hasKontakt ? formatCityLine(v.kontakt_obec, v.kontakt_psc, v.kontakt_stat) : "",
    telefon: v.phone,
    email: v.private_email,
    heslo_elektronicka_komunikace: "",
    cislo_uctu: v.bank_account,
    nejvyssi_vzdelani: v.highest_education && v.highest_education !== "NEREL" ? `${v.highest_education} - ${optionLabel(EDUCATION_OPTIONS, v.highest_education)}` : "",
    zdravotni_pojistovna: v.health_insurance_company,

    tax_uplatneni_prohlaseni: yn(v.tax_uplatneni === "" ? null : v.tax_uplatneni),
    tax_zakladni_sleva: v.tax_uplatneni === true && !!v.tax_zakladni,
    tax_sleva_manzel: v.tax_uplatneni === true && !!v.tax_manzel,
    tax_sleva_invalidita: v.tax_uplatneni === true && !!v.tax_invalidita,

    ...Object.fromEntries(["dite1", "dite2", "dite3", "dite4"].flatMap((s) => [
      [`${s}_jmeno`, v[`${s}_jmeno`]],
      [`${s}_datum_rc`, v[`${s}_datum_rc`]],
      [`${s}_narok`, v[`${s}_jmeno`] ? yn(v[`${s}_narok`]) : null],
      [`${s}_studium`, v[`${s}_jmeno`] ? yn(v[`${s}_studium`]) : null],
      [`${s}_neuplatneni`, v[`${s}_jmeno`] ? yn(v[`${s}_neuplatneni`]) : null],
    ])),
    manzel_jmeno: v.manzel_jmeno,
    manzel_datum_rc: v.manzel_datum_rc,
    manzel_narok: v.manzel_jmeno ? yn(v.manzel_narok) : null,
    manzel_sleva: v.manzel_jmeno ? yn(v.manzel_sleva) : null,
    manzel_prohlaseni_prijmu: v.manzel_jmeno ? yn(v.manzel_prohlaseni) : null,
    jina_osoba_jmeno: v.jina_osoba_jmeno,
    jina_osoba_datum_rc: v.jina_osoba_datum_rc,
    jina_osoba_tytez_deti: v.jina_osoba_jmeno ? yn(v.jina_osoba_tytez) : null,

    pracovni_pozice_nazev: v.nazev_pozice || extra.positionName || "",
    datum_nastupu: isoToCz(v.start_date),
    sjednana_pracovni_doba: composeWorkingTime(v),
    adresa_vykonu_prace: v.workplace,
    vedouci_pracovnik: yn(v.vedouci),
    soubeh_tehoz_zamestnavatele: yn(v.soubeh_tehoz),
    jiny_zamestnavatel_nazev: v.jiny_zamestnavatel_nazev,
    jiny_zamestnavatel_misto: v.jiny_zamestnavatel_misto,
    exekuce_insolvence: yn(v.exekuce),
    ztpp_drzitel: yn(v.ztpp_drzitel),

    omezeni_typ_iii_plain: v.omezeni_typ === "iii",
    omezeni_typ_iii_mimoradne: v.omezeni_typ === "iii_mimoradne",
    omezeni_typ_ii: v.omezeni_typ === "ii",
    omezeni_typ_i: v.omezeni_typ === "i",
    omezeni_ozz: v.omezeni_typ === "ozz",
    omezeni_od: v.omezeni_typ ? isoToCz(v.omezeni_od) : "",
    omezeni_do: v.omezeni_typ ? isoToCz(v.omezeni_do) : "",
    potvrzeni_invalidite: v.omezeni_typ ? yn(v.potvrzeni_invalidite) : null,

    duchod_starobni: v.duchod_druh === "starobni",
    duchod_invalidni_3: v.duchod_druh === "invalidni_3",
    duchod_invalidni_12: v.duchod_druh === "invalidni_12",
    duchod_cizi_starobni: v.duchod_druh === "cizi_starobni",
    duchod_cizi_invalidni_3: v.duchod_druh === "cizi_invalidni_3",
    duchod_cizi_invalidni_12: v.duchod_druh === "cizi_invalidni_12",
    duchod_od: v.duchod_druh ? isoToCz(v.duchod_od) : "",
    duchod_do: v.duchod_druh ? isoToCz(v.duchod_do) : "",
    duchod_predcasny: yn(v.duchod_predcasny),
    duchod_snizeny_vek: yn(v.duchod_snizeny_vek),
    duchod_potvrzeni_priznani: v.duchod_druh ? yn(v.duchod_potvrzeni) : null,

    // Strana 7 "Údaje o cizinci" - len pre cudzinca.
    cizinec_doklad_cislo_typ: foreigner ? composeForeignDoc(v, legacyForeign) : "",
    cizinec_doklad_organ: foreigner ? v.cz_doklad_organ : "",
    cizinec_doklad_stat: foreigner ? optionLabel(STATE_OPTIONS, v.cz_doklad_stat) : "",
    cizinec_adresa_cr: foreigner ? composeCzStay(v) : "",
    cizinec_danova_rezidence: foreigner ? composeTaxResidence(v) : "",
    cizinec_danovy_identifikator: foreigner ? v.danovy_identifikator : "",
    cizinec_typ_danove_identifikace: foreigner ? v.typ_danove_identifikace : "",
    cizinec_typ_pracovniho_opravneni: foreigner ? v.cz_opravneni_druh : "",
    cizinec_cislo_pracovniho_opravneni: foreigner ? composeWorkPermit(v) : "",
    cizinec_cislo_pojisteni_zp_1: foreigner ? v.cz_cislo_pojisteni_zp : "",
    cizinec_cislo_pojisteni_zp_2: "",
    cizinec_podleha_socialnimu_zabezpeceni: foreigner ? yn(v.cizi_predpisy) : null,
    cizinec_kod_statu_socialni_pojisteni: foreigner && v.cizi_predpisy === true ? v.cizi_predpisy_stat : "",

    prohlaseni_datum: "",
    prohlaseni_podpis: "",
  };
}

// Dropdown v PDF ma presne texty (napr. "205 - Česká průmyslová ...\t") -
// vyber podla zaciatku (kod), nikdy nevymyslaj novu moznost.
function pickDropdownOption(options, wanted) {
  if (!wanted) return null;
  const w = String(wanted).trim().toLowerCase();
  return options.find((o) => o.trim().toLowerCase() === w)
    || options.find((o) => o.trim().toLowerCase().startsWith(w))
    || null;
}

// Dlhy text (napr. "Rožmitál pod Třemšínem, 26242, Česká republika") by sa
// pri 12 pt orezal - zmensi pismo, kym sa zmesti (min. 7 pt). `reserve` =
// miesto na okraje (u dropdownu aj sipka).
function fitFontSize(field, font, text, reserve) {
  const width = field.acroField.getWidgets()[0].getRectangle().width - reserve;
  let size = 12;
  while (size > 7 && font.widthOfTextAtSize(text, size) > width) size -= 0.5;
  field.setFontSize(size);
}

// Vrati { bytes, filled, skipped } - skipped = polia, ktore sa nepodarilo
// nastavit (napr. hodnota mimo ciselnika PDF), aby ich UI mohlo ukazat.
export async function fillJmhzPdf(templateBytes, fontBytes, values, extra = {}) {
  const map = JMHZ_FIELD_MAPS[JMHZ_FILL_VERSION];
  const pdfDoc = await PDFDocument.load(templateBytes);
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(fontBytes, { subset: true });
  const form = pdfDoc.getForm();
  const index = buildDecodedFieldIndex(form);
  const data = buildJmhzFillValues(values, extra);
  const filled = [];
  const skipped = [];

  for (const [pdfName, mapping] of Object.entries(map.fields)) {
    const field = index.get(pdfName);
    const val = data[mapping.key];
    if (!field) { skipped.push({ label: mapping.label, reason: "pole v PDF nenalezeno" }); continue; }
    try {
      if (mapping.kind === "checkbox") {
        if (val === true) { field.check(); filled.push(mapping.key); } else field.uncheck();
      } else if (mapping.kind === "radio_ano_ne") {
        if (val === "ANO" || val === "NE") { field.select(val); filled.push(mapping.key); }
      } else if (mapping.kind === "dropdown") {
        if (!val) continue;
        const opt = pickDropdownOption(field.getOptions(), val);
        if (opt) { field.select(opt); fitFontSize(field, font, opt.trim(), 20); filled.push(mapping.key); } else skipped.push({ label: mapping.label, reason: `hodnota "${val}" není v nabídce PDF` });
      } else {
        const text = val === undefined || val === null ? "" : String(val);
        field.setText(text);
        if (text) { fitFontSize(field, font, text, 6); filled.push(mapping.key); }
      }
    } catch (e) {
      skipped.push({ label: mapping.label, reason: e.message || String(e) });
    }
  }

  form.updateFieldAppearances(font);
  // LibreOffice vzor ma NeedAppearances=true -> prehliadac by polia prekreslil
  // vlastnym pismom (/He = Helvetica bez ceskych znakov: "eská republika").
  // Vypnutim sa pouziju nase vygenerovane vzhlady s vlozenym DejaVu Sans.
  form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.False);
  const bytes = await pdfDoc.save();
  return { bytes, filled, skipped };
}
