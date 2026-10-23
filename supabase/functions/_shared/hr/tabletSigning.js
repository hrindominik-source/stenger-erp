// Faza F - pravidla podpisu na tablete a uznavaneho el. podpisu (PAdES).
// Ciste funkcie bez I/O: pouziva Edge Function hr-signing, testuje vitest.
// Pravidla su KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.

// Prejav vule zamestnanca podla typu pravneho ukonu (hr_legal_text_versions.text_key).
export const EMPLOYEE_INTENT_KEY = {
  BILATERAL_CONTRACT: "INTENT_BILATERAL_CONTRACT",
  RECEIPT_ACKNOWLEDGEMENT: "INTENT_RECEIPT_ACKNOWLEDGEMENT",
  TRAINING_RECORD: "INTENT_TRAINING_RECORD",
  EMPLOYEE_DECLARATION: "INTENT_EMPLOYEE_DECLARATION",
};
export const EMPLOYER_INTENT_KEY = "INTENT_EMPLOYER_SIGNATURE";

export const IDENTITY_DOCUMENTS = {
  OP: "občanský průkaz",
  PAS: "cestovní pas",
  POBYT: "průkaz o povolení k pobytu",
  JINY: "jiný doklad totožnosti",
};

// Podpis len pri osobnej pritomnosti: QR na obrazovke HR + kratky kod.
export const TOKEN_MINUTES = 10;
export const MAX_CODE_ATTEMPTS = 3;
export const PAIRING_CODE_LENGTH = 6;
export const validDeviceId = (id) => typeof id === "string" && /^[A-Za-z0-9-]{16,64}$/.test(id);
export const validPairingCode = (c) => typeof c === "string" && c.length === PAIRING_CODE_LENGTH && /^[0-9]+$/.test(c);

// Konkretne udaje skolenia pripojene k prejavu vule (TRAINING_RECORD).
export function trainingIntentDetail(t) {
  if (!t) return "";
  const cz = (iso) => String(iso || "").slice(0, 10).split("-").reverse().join(".");
  return `Školení: ${t.scope}, ${cz(t.trained_at)}, školitel ${t.trainer_name}. Ověření znalostí: ${cz(t.knowledge_checked_at)}, ${t.knowledge_check_result === "PASSED" ? "úspěšné" : "neúspěšné"}.`;
}

export function allPagesViewed(pages, viewed) {
  const set = new Set((viewed || []).map(Number));
  return pages > 0 && Array.from({ length: pages }, (_, i) => i + 1).every((p) => set.has(p));
}

export const MAX_PNG = 400_000;
export function validSignatureImage(png, strokes) {
  const isPng = png?.length > 8 && png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47;
  const points = (Array.isArray(strokes) ? strokes : []).reduce((n, s) => n + (Array.isArray(s) ? s.length : 0), 0);
  return !!isPng && png.length >= 100 && png.length <= MAX_PNG && points >= 10;
}

// Porovnanie mien bez titulov v zatvorke, diakritiky a velkosti pismen.
export const normalizeName = (n) => String(n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

// Platna osoba s plnou mocou k danemu dnu (zaznam hr_signatories).
export function signatoryValidOn(sig, isoDate) {
  return !!sig && sig.valid_from <= isoDate && (!sig.valid_to || sig.valid_to >= isoDate);
}

// Kto smie podpisat za zamestnavatela: prihlaseny pouzivatel naviazany na
// platnu osobu s plnou mocou (DB); ak dokument uvadza podepisujiceho
// (variables_snapshot.zastupce), musi to byt ona.
export function employerSignatory(signatory, snapshot = {}, isoDate = new Date().toISOString().slice(0, 10)) {
  if (!signatoryValidOn(signatory, isoDate)) {
    return { ok: false, reason: "Přihlášený uživatel nemá platnou plnou moc k podpisu za zaměstnavatele." };
  }
  const named = String(snapshot?.zastupce || "").trim();
  if (named && normalizeName(named) !== normalizeName(signatory.full_name)) {
    return { ok: false, reason: `Dokument má podepsat ${named} – přihlaste se účtem této osoby.` };
  }
  return { ok: true, name: signatory.full_name, signatoryId: signatory.id };
}

// Stav certifikatu uznavaneho podpisu (hr_signature_certificate_status).
export const CERTIFICATE_STATUS_LABELS = {
  NOT_VERIFIED: "podpis přítomen, certifikát neověřen",
  VALID: "podpis přítomen, certifikát ověřen – platný",
  INVALID: "podpis přítomen, certifikát NEPLATNÝ",
  INDETERMINATE: "podpis přítomen, ověření certifikátu neprůkazné",
};

const latin1 = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return s; };

// Uznavany el. podpis (PAdES) pripojeny k finalnemu PDF: externe podpisane
// PDF musi byt prirastkovou aktualizaciou PRESNE finalneho PDF (zacina jeho
// bajtmi) a obsahovat podpisovy slovnik, ktoreho /ByteRange pokryva cely
// subor okrem /Contents. Platnost certifikatu sa tu NEOVERUJE (otvorena uloha).
export function inspectPades(signed, finalBytes) {
  if (!(signed instanceof Uint8Array) || signed.length <= finalBytes.length) return { ok: false, reason: "Soubor není podepsanou verzí finálního PDF." };
  for (let i = 0; i < finalBytes.length; i++) {
    if (signed[i] !== finalBytes[i]) return { ok: false, reason: "Podepsané PDF nevychází z finálního PDF této verze (obsah se liší)." };
  }
  const tail = latin1(signed.subarray(finalBytes.length));
  if (!/\/Type\s*\/Sig\b/.test(tail)) return { ok: false, reason: "V PDF chybí elektronický podpis." };
  const sub = tail.match(/\/SubFilter\s*\/(ETSI\.CAdES\.detached|adbe\.pkcs7\.detached)/);
  if (!sub) return { ok: false, reason: "Podpis není typu PAdES / PKCS#7 (SubFilter)." };
  const brs = [...tail.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)];
  if (!brs.length) return { ok: false, reason: "V podpisu chybí /ByteRange." };
  const [a, b, c, d] = brs[brs.length - 1].slice(1).map(Number);
  if (a !== 0 || c <= b || c + d !== signed.length) return { ok: false, reason: "Podpis nepokrývá celý soubor (/ByteRange)." };
  const gap = latin1(signed.subarray(b, c));
  if (!/^<[0-9A-Fa-f]+>$/.test(gap) || /^<0+>$/.test(gap)) return { ok: false, reason: "Podpis je prázdný." };
  return { ok: true, subFilter: sub[1], byteRange: [a, b, c, d], certificateValidation: "NOT_PERFORMED" };
}
