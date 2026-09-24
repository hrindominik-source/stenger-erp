// Vyplnanie DOCX sablon s {{kluc}} placeholdermi - docxtemplater (MIT,
// zakladna free verzia postacuje pre text tagy, ziadny plateny modul
// netreba, viz MASTER_PROMPT bod 4/F). Placeholdery su LEN format dat,
// ziadny vykonatelny kod (docxtemplater ma vypnute {evalu}/funkcie zvycajne
// pouzivane cez samostatny modul - tu ich vobec neregistrujeme).
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

// Chybajuca hodnota sa NESMIE objavit ako "undefined"/"null"/nevyrieseny
// placeholder (MASTER_PROMPT bod "Chýbajúca hodnota sa nesmie objaviť...").
// nullGetter vracia prazdny retazec pre kazdy nevyplneny tag - VOLAJUCI je
// zodpovedny predtym skontrolovat povinne polia (viz validateRequiredKeys
// nizsie) a zablokovat generovanie, nie spoliehat sa na tento fallback ako
// na "riesenie".
function nullGetter() {
  return "";
}

// Nase sablony pouzivaju {{kluc}} (dve zlozene zatvorky), nie docxtemplater
// predvoleny jednoduchy {kluc} - BEZ tejto explicitnej konfiguracie by
// vnutorna "{" bola vyhodnotena ako "duplicate open tag" (overene na
// realnych vzoroch - chyba nesuvisela s obsahom sablon, len s chybajucou
// konfiguraciou delimiterov).
const DELIMITERS = { start: "{{", end: "}}" };

// Zisti, ktore {{kluc}} tagy sablona pouziva - na kontrolu proti allowlistu
// znamych klucov (MASTER_PROMPT F: "mapovanie cez allowlist dátových kľúčov")
// a na detekciu neznamych/nemapovanych placeholderov PRED generovanim.
export function extractTemplateKeys(templateArrayBuffer) {
  const zip = new PizZip(templateArrayBuffer);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter, delimiters: DELIMITERS });
  // getTags() vracia tagy oddelene podla document/headers/footers (overene
  // API tejto verzie docxtemplater - getTemplateVariables() v tejto verzii
  // neexistuje). Zberame kluce zo VSETKYCH casti (hlavicka/päta mozu tiez
  // obsahovat placeholdery, hoci nase 3 vzory ich zatial nemaju).
  const raw = doc.getTags();
  const keys = new Set();
  const collect = (section) => Object.keys(section?.tags || {}).forEach((k) => keys.add(k));
  collect(raw.document);
  (raw.headers || []).forEach(collect);
  (raw.footers || []).forEach(collect);
  return [...keys];
}

// Over, ze VSETKY tagy pouzite v sablone su na povolenom zozname klucov
// (allowlist) - cudzi/nemapovany tag = sablona sa NESMIE aktivovat (bod F).
export function validateTemplateKeysAgainstAllowlist(templateArrayBuffer, allowlist) {
  const used = extractTemplateKeys(templateArrayBuffer);
  const allowedSet = new Set(allowlist);
  const unknown = used.filter((k) => !allowedSet.has(k));
  return { used, unknown, ok: unknown.length === 0 };
}

// Over, ze VSETKY povinne kluce pre danu sablonu maju hodnotu v datach -
// vola sa PRED generovanim (nikdy nespoliehat na nullGetter ako "riesenie"
// chybajucich hodnot, len ako ochranu proti crashu ak by sem validacia
// nedoteka).
export function validateRequiredKeys(data, requiredKeys) {
  const missing = requiredKeys.filter((k) => {
    const v = data[k];
    return v === undefined || v === null || v === "";
  });
  return { missing, ok: missing.length === 0 };
}

// Samotne vyplnenie - vrati Blob hotoveho DOCX. `data` su UZ formatovane
// retazce (formatovanie robi docxMapping.js, nie tento modul - separacia
// "co je format hodnoty" od "ako sa vklada do dokumentu").
export function fillDocxTemplate(templateArrayBuffer, data) {
  const zip = new PizZip(templateArrayBuffer);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter, delimiters: DELIMITERS });
  doc.render(data);
  return doc.getZip().generate({
    type: "arraybuffer",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}
