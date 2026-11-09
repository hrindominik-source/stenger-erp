// Citanie paletovych etikiet GS1-128 / GS1 DataMatrix zo skenera - jeden
// parser pre PDA / Expedice (parseGs1Detail) aj prijem tovaru (parseGs1).
//
// Vstup je text tak, ako ho posle skener do Chrome (DataWedge keystroke):
//   * FNC1 oddelovac = ASCII GS (0x1D). Ak by Chrome na PDA control znak
//     zahodil, DataWedge sa da nastavit, aby GS nahradil znakom "|" - ten
//     nie je v GS1 znakovej sade, takze je bezpecny ako nahradny oddelovac.
//   * volitelny symbology identifier na zaciatku (]C1, ]d2, ]Q3, ]e0 ...),
//   * pri rucnom zadani aj "ludsky" format so zatvorkami: (00)...(02)...
//
// Pravidla podla GS1 General Specifications:
//   * AI s preddefinovanou dlzkou (prve 2 cislice 00-04, 11-20, 31-36, 41)
//     nepotrebuju za sebou FNC1; ostatne (10, 21, 37, ...) su ukoncene
//     FNC1/GS alebo koncom kodu. Nadbytocny GS za pevnym AI tolerujeme.
//   * SSCC (00) a GTIN (01/02) maju kontrolnu cislicu mod 10 (vaha 3/1).
//   * Datumy YYMMDD: storocie podla pravidla GS1 (7.12) - rozdiel YY od
//     aktualneho roka 51..99 = minule storocie, -99..-50 = buduce, inak
//     aktualne. Den 00 = posledny den mesiaca (AI 15/16/17, ale aj 11/13).

export const GS = "\x1D";
const ALT_SEPARATORS = ["|"];

// Prve 2 cislice AI, pri ktorych je dlzka pevne dana (FNC1 netreba).
const PREDEFINED_PREFIXES = new Set(["00", "01", "02", "03", "04", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "31", "32", "33", "34", "35", "36", "41"]);

const AI_TABLE = {
  "00": { fixed: 18, numeric: true, label: "SSCC" },
  "01": { fixed: 14, numeric: true, label: "GTIN" },
  "02": { fixed: 14, numeric: true, label: "GTIN obsahu" },
  "10": { max: 20, label: "Šarže" },
  "11": { fixed: 6, numeric: true, date: true, label: "Datum výroby" },
  "12": { fixed: 6, numeric: true, date: true, label: "Datum splatnosti" },
  "13": { fixed: 6, numeric: true, date: true, label: "Datum balení" },
  "15": { fixed: 6, numeric: true, date: true, label: "Minimální trvanlivost (BBD)" },
  "16": { fixed: 6, numeric: true, date: true, label: "Prodat do" },
  "17": { fixed: 6, numeric: true, date: true, label: "Datum spotřeby" },
  "20": { fixed: 2, numeric: true, label: "Varianta" },
  "21": { max: 20, label: "Sériové číslo" },
  "22": { max: 20, label: "CPV" },
  "30": { max: 8, numeric: true, label: "Proměnné množství" },
  "37": { max: 8, numeric: true, label: "Počet obchodních jednotek" },
  "90": { max: 30, label: "Interní (90)" },
  "240": { max: 30, label: "Doplňkové ID" },
  "241": { max: 30, label: "Číslo dílu zákazníka" },
  "250": { max: 30, label: "Sekundární sériové číslo" },
  "251": { max: 30, label: "Reference na zdroj" },
  "400": { max: 30, label: "Číslo objednávky zákazníka" },
  "401": { max: 30, label: "GINC" },
  "402": { fixed: 17, numeric: true, label: "GSIN" },
  "403": { max: 30, label: "Směrovací kód" },
  "420": { max: 20, label: "PSČ doručení" },
};
for (let i = 410; i <= 417; i++) AI_TABLE[String(i)] = { fixed: 13, numeric: true, label: "GLN (" + i + ")" };
for (let i = 91; i <= 99; i++) AI_TABLE[String(i)] = { max: 90, label: "Interní (" + i + ")" };

// 31nn-36nn: miery (hmotnost, dlzka...), 4. cislica = pocet desatinnych miest.
function measureSpec(ai) {
  const p = ai.slice(0, 2);
  if (!/^3[1-6]\d\d$/.test(ai)) return null;
  const label = p === "31" && ai[2] === "0" ? "Čistá hmotnost (kg)" : p === "33" && ai[2] === "0" ? "Hrubá hmotnost (kg)" : "Míra (" + ai + ")";
  return { fixed: 6, numeric: true, decimals: Number(ai[3]), label };
}

function specFor(ai) {
  return AI_TABLE[ai] || measureSpec(ai) || null;
}

// Najde AI na zaciatku zvysneho retazca (2, 3 alebo 4 cislice).
function matchAi(s) {
  if (/^3[1-6]\d\d/.test(s)) return s.slice(0, 4);
  for (const len of [2, 3]) {
    const ai = s.slice(0, len);
    if (AI_TABLE[ai]) return ai;
  }
  return null;
}

// Kontrolna cislica GS1 (mod 10, vahy 3/1 sprava) pre telo bez nej.
export function gs1CheckDigit(body) {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const d = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (sum % 10)) % 10;
}

export function gs1CheckDigitOk(digits) {
  if (!/^\d+$/.test(digits) || digits.length < 2) return false;
  return gs1CheckDigit(digits.slice(0, -1)) === Number(digits[digits.length - 1]);
}

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// GS1 GenSpecs 7.12 - urcenie storocia z dvojcifernho roka.
export function gs1Year(yy, today = new Date()) {
  const cur = today.getFullYear();
  const curYY = cur % 100;
  const century = cur - curYY;
  const diff = yy - curYY;
  if (diff >= 51) return century - 100 + yy;
  if (diff <= -50) return century + 100 + yy;
  return century + yy;
}

// "YYMMDD" -> { iso: "YYYY-MM-DD", dayMissing } alebo { error }.
export function parseGs1Date(yymmdd, today = new Date()) {
  if (!/^\d{6}$/.test(yymmdd)) return { error: "Datum musí mít 6 číslic (YYMMDD)." };
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  let dd = Number(yymmdd.slice(4, 6));
  if (mm < 1 || mm > 12) return { error: "Neplatný měsíc v datu " + yymmdd + "." };
  const year = gs1Year(yy, today);
  const maxDay = lastDayOfMonth(year, mm);
  const dayMissing = dd === 0;
  if (dayMissing) dd = maxDay;
  if (dd > maxDay) return { error: "Neplatný den v datu " + yymmdd + "." };
  const iso = `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  return { iso, dayMissing };
}

function normalizeRaw(raw) {
  let s = String(raw == null ? "" : raw);
  s = s.replace(/[\r\n]+$/g, "").replace(/^\s+|\s+$/g, "");
  // Symbology identifier (]C1 GS1-128, ]d2 DataMatrix, ]Q3 QR, ]e0 DataBar...).
  if (/^\][A-Za-z][0-9A-Za-z]/.test(s)) s = s.slice(3);
  for (const sep of ALT_SEPARATORS) s = s.split(sep).join(GS);
  // Uvodny FNC1 (niektore skenery ho prenesu ako GS).
  while (s[0] === GS) s = s.slice(1);
  return s;
}

function parseBracketed(s) {
  const elements = [];
  const errors = [];
  const re = /\((\d{2,4})\)([^(]*)/g;
  let m;
  let consumed = 0;
  while ((m = re.exec(s))) {
    if (m.index !== consumed) errors.push("Neočekávaný text v kódu: " + s.slice(consumed, m.index));
    consumed = re.lastIndex;
    elements.push({ ai: m[1], value: m[2].replace(/\s+$/g, "") });
  }
  if (consumed !== s.length) errors.push("Neočekávaný text v kódu: " + s.slice(consumed));
  return { elements, errors };
}

function parseConcatenated(s) {
  const elements = [];
  const errors = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === GS) { i++; continue; }
    const rest = s.slice(i);
    const ai = matchAi(rest);
    if (!ai) {
      errors.push("Neznámý nebo nepodporovaný AI na pozici " + (i + 1) + " (" + rest.slice(0, 4) + "...).");
      break;
    }
    const spec = specFor(ai);
    i += ai.length;
    if (spec.fixed) {
      const value = s.slice(i, i + spec.fixed);
      if (value.length < spec.fixed || value.indexOf(GS) !== -1) {
        errors.push(`AI (${ai}) má mít ${spec.fixed} znaků.`);
        break;
      }
      elements.push({ ai, value });
      i += spec.fixed;
      // AI mimo preddefinovanej tabulky musi byt ukonceny FNC1 alebo koncom.
      if (!PREDEFINED_PREFIXES.has(ai.slice(0, 2)) && i < s.length && s[i] !== GS) {
        errors.push(`Za AI (${ai}) chybí oddělovač FNC1/GS.`);
        break;
      }
    } else {
      let end = s.indexOf(GS, i);
      if (end === -1) end = s.length;
      // Etikety, kde za nasim cislom objednavky (napr. 451/0511) chyba FNC1: dalsi AI sa pozna podla tvaru.
      if (ai === "400") {
        const m = s.slice(i, end).match(/^\d+\/\d{4}(?=1[1357]\d{6}|10.)/);
        if (m) end = i + m[0].length;
      }
      // Ak FNC1 z PDA nepride: pocet na konci za AI 91 (37 + 8 cislic), za poctom AI s datumom.
      if (ai === "91") {
        const m = s.slice(i, end).match(/^(.+)37\d{8}$/);
        if (m) end = i + m[1].length;
      }
      if (ai === "37") {
        const m = s.slice(i, end).match(/^\d{1,8}?(?=1[1357]\d{6}(?:10.+)?$|00\d{18}(?:10.+)?$)/);
        if (m) end = i + m[0].length;
      }
      elements.push({ ai, value: s.slice(i, end) });
      i = end;
    }
  }
  return { elements, errors };
}

function validateElement(el, today, errors, warnings) {
  const spec = specFor(el.ai);
  if (!spec) {
    errors.push(`Nepodporovaný AI (${el.ai}).`);
    return;
  }
  el.label = spec.label;
  const v = el.value;
  if (spec.fixed && v.length !== spec.fixed) errors.push(`AI (${el.ai}) má mít ${spec.fixed} znaků, má ${v.length}.`);
  if (spec.max && (v.length < 1 || v.length > spec.max)) errors.push(`AI (${el.ai}) má mít 1–${spec.max} znaků, má ${v.length}${v.length > spec.max ? " - nechybí oddělovač FNC1/GS?" : ""}.`);
  if (spec.numeric && !/^\d*$/.test(v)) {
    // Typicky: chyba FNC1/GS za AI 37 a nasledujuci AI 10 sa prilepil k mnozstvu.
    errors.push(`AI (${el.ai}) smí obsahovat jen číslice${spec.max ? " - nechybí oddělovač FNC1/GS?" : "."}`);
  }
  if ((el.ai === "00" || el.ai === "01" || el.ai === "02") && /^\d+$/.test(v) && v.length === spec.fixed && !gs1CheckDigitOk(v)) {
    errors.push(`${spec.label} ${v} má chybnou kontrolní číslici.`);
  }
  if (spec.date && /^\d{6}$/.test(v)) {
    const d = parseGs1Date(v, today);
    if (d.error) errors.push(`${spec.label}: ${d.error}`);
    else {
      el.date = d.iso;
      if (d.dayMissing) warnings.push(`${spec.label}: den 00 = poslední den měsíce (${d.iso}).`);
    }
  }
  if (spec.decimals != null && /^\d{6}$/.test(v)) el.number = Number(v) / Math.pow(10, spec.decimals);
}

// Rozbor jedneho kodu. Vracia:
// { ok, raw, normalized, elements:[{ai,value,label,date?}], ai:{}, errors, warnings,
//   sscc, gtin, gtinAi, bbd, bbdAi, batch, count, kind: "sscc"|"produkt"|"oboje"|"neznamy" }
function rozoberGs1(raw, today) {
  const normalized = normalizeRaw(raw);
  const result = { ok: false, raw: String(raw == null ? "" : raw), normalized, elements: [], ai: {}, errors: [], warnings: [], kind: "neznamy" };
  if (!normalized) {
    result.errors.push("Prázdný kód.");
    return result;
  }
  if (/^(\d{8}|\d{12,14})$/.test(normalized)) {
    result.errors.push("Toto je běžný EAN/UPC/ITF-14 kód, ne GS1-128 kód z paletové etikety.");
    return result;
  }
  const parsed = normalized[0] === "(" ? parseBracketed(normalized) : parseConcatenated(normalized);
  result.elements = parsed.elements;
  result.errors.push(...parsed.errors);
  for (const el of result.elements) {
    validateElement(el, today, result.errors, result.warnings);
    if (result.ai[el.ai] != null && result.ai[el.ai] !== el.value) result.errors.push(`AI (${el.ai}) je v kódu dvakrát s různou hodnotou.`);
    result.ai[el.ai] = el.value;
  }

  const a = result.ai;
  if (a["00"]) result.sscc = a["00"];
  if (a["01"] || a["02"]) {
    result.gtinAi = a["02"] ? "02" : "01";
    result.gtin = a["02"] || a["01"];
  }
  const bbdEl = result.elements.find((e) => e.ai === "15") || result.elements.find((e) => e.ai === "17");
  if (bbdEl && bbdEl.date) {
    result.bbd = bbdEl.date;
    result.bbdAi = bbdEl.ai;
  }
  if (a["10"] != null) result.batch = a["10"];
  if (a["37"] != null && /^\d+$/.test(a["37"])) result.count = Number(a["37"]);

  result.kind = result.sscc && result.gtin ? "oboje" : result.sscc ? "sscc" : result.gtin ? "produkt" : "neznamy";
  result.ok = result.errors.length === 0;
  return result;
}

// PDA / Expedice: kod palety musi mat SSCC alebo GTIN. Vracia vysledok
// rozboru (ok, errors, sscc, gtin, bbd, batch, count, kind ...), nehadze chybu.
export function parseGs1Detail(raw, today = new Date()) {
  const result = rozoberGs1(raw, today);
  if (!result.errors.length && result.kind === "neznamy") {
    result.errors.push("Kód neobsahuje SSCC (00) ani GTIN (01/02).");
    result.ok = false;
  }
  return result;
}

// Pre zobrazenie surovych dat na PDA (test skeneru) - GS a ine control znaky viditelne.
export function visibleControlChars(s) {
  // eslint-disable-next-line no-control-regex -- GS/riadiace znaky zo skenera su zamerne
  return String(s == null ? "" : s).replace(/[\x00-\x1F]/g, (c) => (c === GS ? "⟨GS⟩" : "⟨" + c.charCodeAt(0).toString(16).padStart(2, "0") + "⟩"));
}

/* ---------------- Prijem tovaru ---------------- */

// ISO "YYYY-MM-DD" -> "DD.MM.RRRR"
function isoNaDatum(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
}

// GS1 datum RRMMDD -> "DD.MM.RRRR" (storocie podla GS1, DD = 00 = posledny den mesiaca).
export function gs1Datum(yymmdd, today = new Date()) {
  const d = parseGs1Date(String(yymmdd || ""), today);
  return d.error ? "" : isoNaDatum(d.iso);
}

// Kontrolna cislica GS1 (mod 10) pre SSCC a GTIN - odhali preklep aj kod,
// ktory GS1 nie je (napr. vlastny kod dodavatela zacinajuci sa na 00).
export function gs1CheckOk(digits) {
  return gs1CheckDigitOk(String(digits || ""));
}

// Prijem: jeden alebo viac naskenovanych kodov jednej etikety (oddelenych
// novym riadkom) -> udaje palety. Pri chybe hadze Error s popisom.
export function parseGs1(input, today = new Date()) {
  const casti = String(input || "")
    .split(/[\r\n]+/)
    .map((c) => c.trim())
    .filter(Boolean);
  if (casti.length === 0) throw new Error("Prázdný sken.");
  const ai = {};
  for (const c of casti) {
    const r = rozoberGs1(c, today);
    if (r.errors.length) throw new Error(r.errors[0]);
    Object.assign(ai, r.ai);
  }
  const netto = Object.keys(ai).find((k) => /^310\d$/.test(k));
  const result = {
    sscc: ai["00"] || "",
    gtin: ai["01"] || ai["02"] || "",
    pocet: ai["37"] ? Number(ai["37"]) : null,
    sarza: ai["10"] || "",
    dmt: gs1Datum(ai["15"] || ai["17"] || ai["16"], today),
    datumVyroby: gs1Datum(ai["11"] || ai["13"], today),
    nettoKg: netto ? Number(ai[netto]) / 10 ** Number(netto[3]) : null,
    objednavka: ai["400"] || "",
    ai,
  };
  if (!result.sscc && !result.gtin && !result.sarza) throw new Error("Kód neobsahuje údaje palety (SSCC, GTIN ani šarži).");
  return result;
}

// Spoji dva skeny tej istej etikety (napr. horny a dolny kod) - neskorsi doplni chybajuce.
export function mergeScans(a, b) {
  if (!a) return b;
  const out = { ...a, ai: { ...a.ai, ...b.ai } };
  for (const k of ["sscc", "gtin", "sarza", "dmt", "datumVyroby", "objednavka"]) if (!out[k] && b[k]) out[k] = b[k];
  for (const k of ["pocet", "nettoKg"]) if (out[k] === null && b[k] !== null) out[k] = b[k];
  return out;
}

// DMT z datumu vyroby a trvanlivosti v mesiacoch (ked ho etiketa nema).
export function dmtZTrvanlivosti(datumVyroby, mesiace) {
  const m = String(datumVyroby || "").match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  const n = Number(mesiace);
  if (!m || !n) return "";
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1 + n, Number(m[1])));
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
}

// Mnozstvo palety v jednotke materialu podla karty produktu
// ({ jednotka, mnozstvoNaKs }): netto kg z etikety ma prednost pri kg.
export function mnozstvoPalety(scan, karta) {
  if (karta && karta.jednotka === "kg" && scan.nettoKg) return scan.nettoKg;
  if (scan.pocet === null) return null;
  const naKs = karta && Number(karta.mnozstvoNaKs) > 0 ? Number(karta.mnozstvoNaKs) : 1;
  return Math.round(scan.pocet * naKs * 1000) / 1000;
}
