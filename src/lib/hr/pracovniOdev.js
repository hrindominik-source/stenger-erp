// Pracovni odev a obuv - vydej zamestnancum vo vyrobe (predavaci protokol)
// a evidencia rukavic (bez protokolu). Uklada sa do employees.data
// (odev_vydeje, rukavice, odev_nevydava) - bez zmeny databazy. PDF protokolu
// je v pracovniOdevPdf.js (pdf-lib sa nacita az na klik).

const VELIKOSTI_ODEV = ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL"];
const VELIKOSTI_OBUV = Array.from({ length: 14 }, (_, i) => String(35 + i));

export const ODEV_POLOZKY = [
  { key: "tricko", label: "Tričko", velikosti: VELIKOSTI_ODEV },
  { key: "leginy", label: "Legíny", velikosti: VELIKOSTI_ODEV },
  { key: "mikina", label: "Mikina", velikosti: VELIKOSTI_ODEV },
  { key: "obuv", label: "Obuv", velikosti: VELIKOSTI_OBUV },
];

export const PROTOKOL_NAZEV = "Předávací protokol – pracovní oděv a obuv";
export const PROTOKOL_PROHLASENI =
  "Zaměstnanec svým podpisem potvrzuje, že výše uvedené položky převzal. Zavazuje se je používat pouze při výkonu práce, " +
  "řádně o ně pečovat a při skončení pracovního poměru je vrátit zaměstnavateli.";

export const odevVydeje = (employee) => (Array.isArray(employee?.data?.odev_vydeje) ? employee.data.odev_vydeje : [])
  .slice().sort((a, b) => String(b.datum || "").localeCompare(String(a.datum || "")));
export const rukaviceZaznamy = (employee) => (Array.isArray(employee?.data?.rukavice) ? employee.data.rukavice : [])
  .slice().sort((a, b) => String(b.datum || "").localeCompare(String(a.datum || "")));
export const rukaviceCelkem = (zaznamy) => zaznamy.reduce((s, z) => s + (Number(z.pocet) || 0), 0);

// Z formulara {tricko: {pocet, velikost}, ...} -> vyplnene riadky protokolu.
export function protokolPolozky(form) {
  return ODEV_POLOZKY
    .map((p) => ({ key: p.key, label: p.label, pocet: Number(form?.[p.key]?.pocet) || 0, velikost: form?.[p.key]?.velikost || "" }))
    .filter((p) => p.pocet > 0);
}

// Co chyba, aby sa dal protokol vytvorit.
export function protokolChyby(datum, polozky) {
  const e = [];
  if (!datum) e.push("datum předání");
  if (!polozky.length) e.push("alespoň jedna položka (počet kusů)");
  for (const p of polozky) if (!p.velikost) e.push(`velikost – ${p.label.toLowerCase()}`);
  return e;
}

// Riadok nastupneho balicka.
export function odevChecklistItem(employee) {
  if (employee?.data?.odev_nevydava === true) return { state: "done", detail: "nevydává se" };
  const vydeje = odevVydeje(employee);
  if (vydeje.some((v) => v.sken?.path)) return { state: "done", detail: "podepsáno" };
  if (vydeje.length) return { state: "created", detail: "vytvořeno – nahrajte podepsaný sken" };
  return { state: "missing", detail: "chybí" };
}
