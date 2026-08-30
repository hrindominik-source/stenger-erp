export function todayStr() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

export function nowTimeStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// crypto.randomUUID() namiesto Date.now()+Math.random() - povodny format bol
// uhadnutelny na sekundy (pouziva sa aj ako cesta k suborom v Supabase Storage).
export function uid() {
  return crypto.randomUUID();
}

export function parseSkDate(str) {
  if (!str) return null;
  const m = String(str).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return null;
  const d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
  return isNaN(d.getTime()) ? null : d;
}

// Konverzie pre <input type="date"> (kalendarovy vyber) - ulozeny format ostava
// vzdy text "DD.MM.RRRR" (pouziva sa v tlaciach/CMR/emailoch), toto je len pomocka
// pre volitelny kalendar popri rucnom pisani.
export function isoFromSkDateStr(str) {
  const d = parseSkDate(str);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "";
}
export function skDateStrFromIso(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
}

export function formatMinutes(mins) {
  if (mins === null || mins === undefined || Number.isNaN(mins)) return "";
  const total = Math.max(0, Math.round(mins));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

export function durationMinutes(start, end) {
  if (!start || !end) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => isNaN(n))) return null;
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60; // cez polnoc - okrajovy pripad
  return mins;
}

// Vypocita dalsi termin (format DD.MM.RRRR) z posledneho datumu a frekvencie -
// pouziva sa pri checklistoch (dalsie vyplnenie) aj registri terminov/BOZP (dalsia revizia).
export function computeNextDue(startDateStr, frekvenciaTyp, frekvenciaHodnota) {
  const start = parseSkDate(startDateStr);
  const n = Number(frekvenciaHodnota) || 0;
  if (!start || !n) return "";
  const next = new Date(start);
  if (frekvenciaTyp === "dni") next.setDate(next.getDate() + n);
  else if (frekvenciaTyp === "tyzdne") next.setDate(next.getDate() + n * 7);
  else if (frekvenciaTyp === "mesiace") next.setMonth(next.getMonth() + n);
  else if (frekvenciaTyp === "roky") next.setFullYear(next.getFullYear() + n);
  else return "";
  return `${String(next.getDate()).padStart(2, "0")}.${String(next.getMonth() + 1).padStart(2, "0")}.${next.getFullYear()}`;
}

// Pocet dni od dnes po zadany datum (zaporne cislo = uz po terminu).
export function daysUntil(dateStr) {
  const d = parseSkDate(dateStr);
  const today = parseSkDate(todayStr());
  if (!d || !today) return null;
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

// Riadok, ktory je len samostatny nazov krajiny (bez cisiel) - ak je posledny
// v adrese, treba ho preskocit, lebo hladame mesto, nie krajinu.
const COUNTRY_ONLY_LINE = /^(niederlande|deutschland|frankreich|österreich|polska|schweiz|belgie|belgium|nederland|france|germany|austria|poland|switzerland|italia|italien|tschechische republik|slowakei|nemecko|francuzsko|rakusko|polsko|svajciarsko|belgicko)$/i;

export function extractCityFromAddress(adresa) {
  if (!adresa) return "";
  let segments = String(adresa).split(/[\n,]/).map((l) => l.trim()).filter(Boolean);
  while (segments.length > 1 && COUNTRY_ONLY_LINE.test(segments[segments.length - 1])) {
    segments = segments.slice(0, -1);
  }
  const text = segments.join("\n");
  const postalMatch = text.match(/(\d[\d\s]{2,6}\d)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s\-.']*)/);
  if (postalMatch) {
    const city = postalMatch[2].split(/[,\n]/)[0].trim();
    if (city) return city.toUpperCase();
  }
  if (segments.length === 0) return "";
  const last = segments[segments.length - 1];
  const cleaned = last.replace(/^[A-Z]{0,3}-?\s*\d{3,6}\s*[A-Za-z]{0,3}\s*/i, "").trim();
  return (cleaned || last).toUpperCase();
}
