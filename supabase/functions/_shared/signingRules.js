// Kto musi dokument podpisat (zrkadlo DB funkcii hr_default_legal_act_type,
// hr_required_signers, hr_document_missing_signers - migracia 51). Rozhoduje
// DB; toto sluzi na zobrazenie v UI ("ceka na podpis zamestnavatele").
// Zamknuty (aspon jeden podpis) != podpisany (vsetky pozadovane podpisy).

export function defaultLegalActType(docType) {
  if (["pracovni_smlouva", "pracovni_smlouva_cizinec", "dodatek", "dohoda_o_skonceni", "dpp", "dpc"].includes(docType)) return "BILATERAL_CONTRACT";
  if (["platovy_vymer", "mzdovy_vymer", "vypoved_zamestnavatele"].includes(docType)) return "EMPLOYER_UNILATERAL";
  if (["vypoved_zamestnance", "osobni_dotaznik", "s21_oznameni_adresy", "s335_souhlas", "s335_odvolani"].includes(docType)) return "EMPLOYEE_DECLARATION";
  if (["hi001_naplen_prace_delnice", "popis_pracovniho_mista", "s335_pouceni", "potvrzeni_prevzeti"].includes(docType)) return "RECEIPT_ACKNOWLEDGEMENT";
  if (docType === "vstupni_skoleni") return "TRAINING_RECORD";
  return null;
}

export function requiredSigners(legalActType) {
  if (legalActType === "BILATERAL_CONTRACT") return ["EMPLOYEE", "EMPLOYER"];
  if (legalActType === "EMPLOYER_UNILATERAL") return ["EMPLOYER"];
  return ["EMPLOYEE"];
}

export function documentRequiredSigners(doc) {
  return requiredSigners(doc?.legal_act_type || defaultLegalActType(doc?.doc_type));
}

const ELECTRONIC = ["ELECTRONIC_TABLET", "ELECTRONIC_QUALIFIED"];

export function missingSigners(doc, signatures = []) {
  return documentRequiredSigners(doc).filter((r) => !signatures.some((s) => s.signer_type === r && (
    s.method === "PAPER" || (ELECTRONIC.includes(s.method) && doc.final_pdf_sha256 && s.signed_content_sha256 === doc.final_pdf_sha256)
  )));
}

export const SIGNER_LABELS = { EMPLOYEE: "zaměstnanec", EMPLOYER: "zaměstnavatel" };

// Stav podpisu na zobrazenie: unsigned | partial | signed
export function signingState(doc, signatures = []) {
  if (doc?.status === "SIGNED" || doc?.status === "ARCHIVED") return { state: "signed", missing: [] };
  const missing = missingSigners(doc, signatures);
  const required = documentRequiredSigners(doc);
  return { state: missing.length < required.length ? "partial" : "unsigned", missing };
}

// Pisomnost § 334 (zrkadlo DB hr_is_s334_document, migracia 52): osobne sa
// dorucuje len proti podpisu potvrdenia prevzatia. KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.
export function isS334Document(doc) {
  return (doc?.legal_act_type || defaultLegalActType(doc?.doc_type)) === "EMPLOYER_UNILATERAL"
    || ["platovy_vymer", "mzdovy_vymer", "vypoved_zamestnavatele", "zruseni_ve_zkusebni_dobe"].includes(doc?.doc_type);
}

export const LEGAL_ACT_LABELS = {
  BILATERAL_CONTRACT: "dvoustranná smlouva",
  EMPLOYER_UNILATERAL: "jednostranný úkon zaměstnavatele",
  EMPLOYEE_DECLARATION: "prohlášení zaměstnance",
  RECEIPT_ACKNOWLEDGEMENT: "potvrzení převzetí",
  TRAINING_RECORD: "záznam o školení",
};

export const SIGNATURE_METHOD_LABELS = {
  PAPER: "papír (sken)",
  ELECTRONIC_TABLET: "tablet",
  ELECTRONIC_QUALIFIED: "kvalifikovaný el. podpis",
};

// Elektronicky podpis rukou na obrazovke - rozlisenie podla kanala v dokazoch
// (zamestnanec na tablete vs. prihlaseny pouzivatel na svojej obrazovke).
export const SIGNATURE_CHANNEL_LABELS = {
  HR_TABLET_IN_PERSON: "tablet (zaměstnanec)",
  KIOSK_TABLET: "tablet – nástupní kiosk (zaměstnanec)",
  HR_TABLET_EMPLOYER: "elektronicky – přihlášený uživatel",
};

export function signatureMethodLabel(s) {
  if (s?.method === "ELECTRONIC_TABLET") return SIGNATURE_CHANNEL_LABELS[s.evidence?.channel] || SIGNATURE_METHOD_LABELS.ELECTRONIC_TABLET;
  return SIGNATURE_METHOD_LABELS[s?.method] || s?.method || "—";
}

// Pocita sa podpis k aktualnej verzii? (rovnake pravidlo ako missingSigners)
export function signatureCounts(doc, s) {
  return s.method === "PAPER" || (ELECTRONIC.includes(s.method) && !!doc?.final_pdf_sha256 && s.signed_content_sha256 === doc.final_pdf_sha256);
}
