// Kto musi dokument podpisat (zrkadlo DB funkcii hr_default_legal_act_type,
// hr_required_signers, hr_document_missing_signers - migracia 51). Rozhoduje
// DB; toto sluzi na zobrazenie v UI ("ceka na podpis zamestnavatele").
// Zamknuty (aspon jeden podpis) != podpisany (vsetky pozadovane podpisy).

export function defaultLegalActType(docType) {
  if (["pracovni_smlouva", "pracovni_smlouva_cizinec", "dodatek", "dohoda_o_skonceni", "dpp", "dpc"].includes(docType)) return "BILATERAL_CONTRACT";
  if (["platovy_vymer", "mzdovy_vymer", "vypoved_zamestnavatele"].includes(docType)) return "EMPLOYER_UNILATERAL";
  if (["vypoved_zamestnance", "osobni_dotaznik", "s21_oznameni_adresy", "s335_souhlas"].includes(docType)) return "EMPLOYEE_DECLARATION";
  if (["hi001_naplen_prace_delnice", "popis_pracovniho_mista"].includes(docType)) return "RECEIPT_ACKNOWLEDGEMENT";
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
