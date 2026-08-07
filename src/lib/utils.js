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

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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

export function extractCityFromAddress(adresa) {
  if (!adresa) return "";
  const text = String(adresa);
  const postalMatch = text.match(/(\d[\d\s]{2,6}\d)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s\-.']*)/);
  if (postalMatch) {
    const city = postalMatch[2].split(/[,\n]/)[0].trim();
    if (city) return city.toUpperCase();
  }
  const segments = text.split(/[\n,]/).map((l) => l.trim()).filter(Boolean);
  if (segments.length === 0) return "";
  const last = segments[segments.length - 1];
  const cleaned = last.replace(/^[A-Z]{0,3}-?\s*\d{3,6}\s*/i, "").trim();
  return (cleaned || last).toUpperCase();
}
