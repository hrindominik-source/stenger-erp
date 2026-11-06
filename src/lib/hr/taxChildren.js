// Deti a dane - vek z rodneho cisla, poradie narokov, upozornenia (26 let).
// Ciste funkcie bez pdf-lib, aby sa dali pouzit v karte a prehlade bez
// nacitania kniznice na PDF.
import { MAX_CHILDREN, childSlot, childBirthText } from "./employeeFields.js";

// ---------------------------------------------------------------------------
// Rodne cislo / vek
// ---------------------------------------------------------------------------

export function extractBirthNumber(text) {
  const m = String(text || "").match(/(\d{6})\s*\/?\s*(\d{3,4})/);
  return m ? `${m[1]}/${m[2]}` : "";
}

export function formatBirthNumber(rc) {
  const digits = String(rc || "").replace(/\D/g, "");
  if (digits.length < 9) return String(rc || "");
  return `${digits.slice(0, 6)}/${digits.slice(6)}`;
}

// Datum narodenia z textu "1.2.2010, 100201/1234" - prednost ma explicitny
// datum, inak sa odvodi z rodneho cisla (zeny +50 k mesiacu, od 2004 aj +20).
export function birthDateFrom(text) {
  const s = String(text || "");
  const d = s.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
  if (d) return `${d[3]}-${String(d[2]).padStart(2, "0")}-${String(d[1]).padStart(2, "0")}`;
  const rc = s.match(/(\d{2})(\d{2})(\d{2})\s*\/?\s*(\d{3,4})/);
  if (!rc) return null;
  let yy = Number(rc[1]); let mm = Number(rc[2]); const dd = Number(rc[3]);
  if (mm > 70) mm -= 70; else if (mm > 50) mm -= 50; else if (mm > 20) mm -= 20;
  const year = rc[4].length === 4 ? (yy < 54 ? 2000 + yy : 1900 + yy) : 1900 + yy;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

export function ageOn(birthIso, onIso) {
  if (!birthIso || !onIso) return null;
  const [by, bm, bd] = birthIso.split("-").map(Number);
  const [y, m, d] = onIso.split("-").map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age;
}

export function addYearsIso(iso, years) {
  const [y, m, d] = iso.split("-").map(Number);
  const out = new Date(Date.UTC(y + years, m - 1, d));
  return out.toISOString().slice(0, 10);
}

export function splitName(full) {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { jmeno: parts[0] || "", prijmeni: "" };
  return { jmeno: parts.slice(0, -1).join(" "), prijmeni: parts[parts.length - 1] };
}

// Deti z plochych hodnot karty - poradie narokov 1./2./3. (3. = kazde dalsie),
// N = neuplatnuje. Zletile dite (18-26) sa oznaci, ak sa na neho uplatnuje.
export function childrenForDeclaration(v, onIso) {
  const out = [];
  let order = 0;
  for (let i = 1; i <= MAX_CHILDREN; i++) {
    const s = childSlot(i);
    if (!v[`${s}_jmeno`]) continue;
    const birth = birthDateFrom(childBirthText(v, s));
    const age = ageOn(birth, onIso);
    const narok = v[`${s}_narok`] === true;
    if (narok) order += 1;
    out.push({
      ...splitName(v[`${s}_jmeno`]),
      rc: extractBirthNumber(childBirthText(v, s)),
      narok: narok ? `${Math.min(order, 3)}.` : "N",
      ztpp: narok && v[`${s}_ztpp`] === true ? "X" : "",
      zletile: narok && age !== null && age >= 18 && age < 26 ? "X" : "",
      age, birth,
    });
  }
  return out;
}

// Upozornenia k detom (karta + prehlad): 26 rokov = konec narokov (cervene),
// blizi sa (do 60 dni, oranzove), zletile bez potvrdenia o studiu (oranzove).
export function childTaxWarnings(v, today = new Date().toISOString().slice(0, 10)) {
  const w = [];
  for (let i = 1; i <= MAX_CHILDREN; i++) {
    const s = childSlot(i);
    if (!v[`${s}_jmeno`] || v[`${s}_narok`] !== true) continue;
    const birth = birthDateFrom(childBirthText(v, s));
    if (!birth) continue;
    const name = v[`${s}_jmeno`];
    const d26 = addYearsIso(birth, 26);
    const days26 = Math.round((new Date(d26) - new Date(today)) / 86400000);
    if (days26 <= 0) w.push({ level: "red", message: `Dítě ${name} dovršilo 26 let (${fmtCz(d26)}) – ukončit daňové zvýhodnění` });
    else if (days26 <= 60) w.push({ level: "amber", message: `Dítě ${name} dovrší 26 let ${fmtCz(d26)} – připravit ukončení daňového zvýhodnění` });
    else if ((ageOn(birth, today) ?? 0) >= 18 && v[`${s}_studium`] !== true) {
      w.push({ level: "amber", message: `Dítě ${name} je zletilé – doložit potvrzení o studiu (§ 35c odst. 6 písm. b)` });
    }
  }
  return w;
}

export function fmtCz(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d}.${m}.${y}`;
}

