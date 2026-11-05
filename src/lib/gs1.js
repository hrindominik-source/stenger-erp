// Citanie paletovych etikiet GS1-128 (GS1 logisticka etiketa) zo skenera.
// Skener posiela obsah kodu ako text; polia premennej dlzky oddeluje znak GS
// (ASCII 29, FNC1). Podporovany je aj zapis so zatvorkami z popisu pod kodom,
// napr. "(00)123...(10)ABC", a viac naskenovanych kodov jednej etikety naraz.

const GS = "\u001d";

// AI -> [pevna dlzka udaju alebo null = premenna, max dlzka]
const AI_DEF = {
  "00": [18, 18],
  "01": [14, 14],
  "02": [14, 14],
  10: [null, 20],
  11: [6, 6],
  13: [6, 6],
  15: [6, 6],
  16: [6, 6],
  17: [6, 6],
  21: [null, 20],
  37: [null, 8],
  400: [null, 30],
  401: [null, 30],
};

function aiDef(ai) {
  if (AI_DEF[ai]) return AI_DEF[ai];
  if (/^31\d\d$/.test(ai) || /^33\d\d$/.test(ai)) return [6, 6];
  if (/^9\d$/.test(ai)) return [null, 90];
  return null;
}

// Pozna AI na zaciatku retazca (2, 3 alebo 4 cislice).
function matchAi(s) {
  for (const len of [2, 3, 4]) {
    const ai = s.slice(0, len);
    if (ai.length === len && /^\d+$/.test(ai) && aiDef(ai)) {
      if (len === 2 && (ai === "31" || ai === "33" || ai === "40")) continue;
      return ai;
    }
  }
  return null;
}

// GS1 datum RRMMDD -> "DD.MM.RRRR". DD = 00 znamena posledny den mesiaca.
export function gs1Datum(yymmdd) {
  const m = String(yymmdd || "").match(/^(\d{2})(\d{2})(\d{2})$/);
  if (!m) return "";
  const yy = Number(m[1]);
  // GS1: rok v rozsahu -49..+50 rokov od aktualneho; pre nase datumy staci 20xx
  const year = 2000 + yy;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return "";
  let day = Number(m[3]);
  if (day === 0) day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${year}`;
}

function parseParenthesized(text) {
  const out = {};
  const re = /\((\d{2,4})\)\s*([^(]*)/g;
  let m;
  let found = false;
  while ((m = re.exec(text))) {
    found = true;
    out[m[1]] = m[2].replace(/\s+/g, "").trim();
  }
  return found ? out : null;
}

function parseRaw(text) {
  const out = {};
  let s = text.replace(/^\][A-Za-z]\d/, "");
  while (s.length > 0) {
    if (s[0] === GS) {
      s = s.slice(1);
      continue;
    }
    const ai = matchAi(s);
    if (!ai) throw new Error("Neznámý kód v etiketě: " + s.slice(0, 8));
    const [fixed, max] = aiDef(ai);
    s = s.slice(ai.length);
    let value;
    if (fixed) {
      value = s.slice(0, fixed);
      s = s.slice(fixed);
      if (s[0] === GS) s = s.slice(1);
    } else {
      const end = s.indexOf(GS);
      value = end === -1 ? s : s.slice(0, end);
      if (value.length > max) value = value.slice(0, max);
      s = end === -1 ? s.slice(value.length) : s.slice(end + 1);
    }
    out[ai] = value;
  }
  return out;
}

// Kontrolna cislica GS1 (mod 10) pre SSCC a GTIN - odhali preklep aj kod,
// ktory GS1 nie je (napr. vlastny kod dodavatela zacinajuci sa na 00).
export function gs1CheckOk(digits) {
  if (!/^\d+$/.test(digits || "")) return false;
  const d = digits.split("").map(Number);
  const check = d.pop();
  let sum = 0;
  d.reverse().forEach((n, i) => (sum += n * (i % 2 === 0 ? 3 : 1)));
  return (10 - (sum % 10)) % 10 === check;
}

// Jeden alebo viac naskenovanych kodov (oddelenych novym riadkom) -> udaje palety.
export function parseGs1(input) {
  const ai = {};
  const casti = String(input || "")
    .split(/[\r\n]+/)
    .map((c) => c.trim())
    .filter(Boolean);
  if (casti.length === 0) throw new Error("Prázdný sken.");
  for (const c of casti) {
    Object.assign(ai, parseParenthesized(c) || parseRaw(c));
  }
  const netto = Object.keys(ai).find((k) => /^310\d$/.test(k));
  const result = {
    sscc: ai["00"] || "",
    gtin: ai["01"] || ai["02"] || "",
    pocet: ai["37"] ? Number(ai["37"]) : null,
    sarza: ai["10"] || "",
    dmt: gs1Datum(ai["15"] || ai["17"] || ai["16"]),
    datumVyroby: gs1Datum(ai["11"] || ai["13"]),
    nettoKg: netto ? Number(ai[netto]) / 10 ** Number(netto[3]) : null,
    objednavka: ai["400"] || "",
    ai,
  };
  if (!result.sscc && !result.gtin && !result.sarza) throw new Error("Kód neobsahuje údaje palety (SSCC, GTIN ani šarži).");
  if (result.sscc && !gs1CheckOk(result.sscc)) throw new Error("Kód není platná GS1 etiketa (nesedí kontrolní číslice SSCC).");
  if (result.gtin && !gs1CheckOk(result.gtin)) throw new Error("Kód není platná GS1 etiketa (nesedí kontrolní číslice GTIN).");
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
