// Citanie vyplnitelneho JMHZ PDF dotaznika (AcroForm polia) - pdf-lib (MIT).
// KRITICKE pravidlo z MASTER_PROMPT: "Nespoliehaj sa na poradie polí ani
// názvy typu Textové pole 1 bez mapy konkrétnej verzie. Neznáma verzia →
// manuálna kontrola, nie tiché nesprávne mapovanie." Preto je tu VERZIOVANA
// mapa (field name -> {key, kind}) - ziadna univerzalna "over vsetko podla
// poradia" heuristika. Nevybrane checkbox pole NIKDY neznamena "Nie" -
// vracia sa ako explicitny stav "NEZADANE", nie false/prazdny retazec.
import { PDFDocument } from "pdf-lib";

export const FIELD_STATUS = {
  NEZADANE: "NEZADANE",
  POTVRDENE_ANO: "POTVRDENE_ANO",
  POTVRDENE_NIE: "POTVRDENE_NIE",
  NEUPLATNUJE_SA: "NEUPLATNUJE_SA",
  VYZADUJE_KONTROLU: "VYZADUJE_KONTROLU",
};

// Mapa pre PRESNE tu jednu overenu verziu (vyplneny vzor "20.3.2026 C" z
// analyzy) - kluce su PDF field names, hodnoty su {key, kind}. kind:
// "text" | "checkbox". Toto NIE JE kompletna mapa vsetkych 111 poli D1
// (original nebol sprístupneny do repozitara) - je to KOSTRA s malou
// mnozinou poli na demonstraciu mechanizmu; realne pole treba doplnit az
// pri ziskani konkretneho PDF na kontrolu (viz JmhzFieldMap nizsie ako
// rozsiritelny format).
export const JMHZ_FIELD_MAPS = {
  "20.3.2026 C": {
    versionLabel: "20.3.2026 C",
    fields: {
      // Priklad struktury - DOPLNIT az podla skutocneho PDF pri kontrole
      // (nazvy poli sa zistia cez listAcroFormFieldNames nizsie).
      // "Jmeno": { key: "jmeno", kind: "text" },
      // "Prijmeni": { key: "prijmeni", kind: "text" },
    },
  },
  "25.3.2026": {
    versionLabel: "25.3.2026",
    fields: {
      // Prazdny vzor stiahnuty z MRP - mapovanie sa nesmie zamienat s
      // vyssie uvedenou verziou (rozne cislovanie/nazvy poli mozu byt inak).
    },
  },
};

// Precitaj VSETKY AcroForm/Widget polia z PDF (nazov, typ, hodnota) - toto
// je diagnosticky krok na zistenie skutocnych nazvov poli KONKRETNEHO PDF
// pred vytvorenim/rozsirenim JMHZ_FIELD_MAPS pre danu verziu.
export async function listAcroFormFieldNames(pdfArrayBuffer) {
  const pdfDoc = await PDFDocument.load(pdfArrayBuffer, { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  return form.getFields().map((f) => ({ name: f.getName(), type: f.constructor.name }));
}

// Precitaj hodnotu jedneho pola bez ohladu na typ (text/checkbox/radio) -
// vrati surovu hodnotu (retazec alebo boolean pre checkbox/radio), NIKDY
// nedomysla "nevyplnene = Nie".
function readFieldRaw(field) {
  const ctorName = field.constructor.name;
  if (ctorName === "PDFTextField") {
    const v = field.getText();
    return v === undefined || v === null ? null : v;
  }
  if (ctorName === "PDFCheckBox") {
    return field.isChecked(); // true/false - NEoznacene = false, ale volajuci
    // (extractJmhzFields nizsie) toto explicitne prevedie na NEZADANE, nie
    // rovno na "Nie", ak sa este nedopatrilo ku skutocnej hodnote.
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

// Hlavna funkcia: precitaj PDF podla ZNAMEJ verzie (musi byt v
// JMHZ_FIELD_MAPS). Ak verzia nie je znama, vrati { status: 'NEZNAMA_VERZIA' }
// namiesto tichej (nesprávnej) extrakcie - presne podla MASTER_PROMPT.
export async function extractJmhzFields(pdfArrayBuffer, versionLabel) {
  const map = JMHZ_FIELD_MAPS[versionLabel];
  if (!map) {
    return { status: "NEZNAMA_VERZIA", versionLabel, results: {} };
  }
  const pdfDoc = await PDFDocument.load(pdfArrayBuffer, { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  const results = {};

  for (const [pdfFieldName, mapping] of Object.entries(map.fields)) {
    let field;
    try {
      field = form.getField(pdfFieldName);
    } catch {
      results[mapping.key] = { status: FIELD_STATUS.VYZADUJE_KONTROLU, rawValue: null, note: `Pole "${pdfFieldName}" v PDF nenájdeno - overiť verziu/mapu.` };
      continue;
    }
    const raw = readFieldRaw(field);
    if (mapping.kind === "checkbox") {
      // Nevybrane checkbox = NEZADANE (nikdy automaticky "Nie") - presne
      // MASTER_PROMPT poziadavka.
      results[mapping.key] = { status: raw === true ? FIELD_STATUS.POTVRDENE_ANO : FIELD_STATUS.NEZADANE, rawValue: raw };
    } else {
      const isEmpty = raw === null || raw === undefined || raw === "";
      results[mapping.key] = { status: isEmpty ? FIELD_STATUS.NEZADANE : FIELD_STATUS.POTVRDENE_ANO, rawValue: isEmpty ? null : raw };
    }
  }
  return { status: "OK", versionLabel, results };
}

// Detekcia verzie PDF - MRP verzny label je zvycajne niekde v texte/metadata
// dokumentu. Toto je NAVRH rozhrania (nie spolahliva auto-detekcia) -
// vracia kandidatov, appka VZDY vyzaduje potvrdenie HR pred pouzitim
// konkretnej mapy (nikdy tichu automaticku volbu).
export async function detectJmhzVersionCandidates(pdfArrayBuffer) {
  const pdfDoc = await PDFDocument.load(pdfArrayBuffer, { ignoreEncryption: true });
  const title = pdfDoc.getTitle() || "";
  const subject = pdfDoc.getSubject() || "";
  const combined = `${title} ${subject}`;
  const known = Object.keys(JMHZ_FIELD_MAPS);
  const matches = known.filter((v) => combined.includes(v));
  return { detectedFrom: combined, candidates: matches, knownVersions: known };
}
