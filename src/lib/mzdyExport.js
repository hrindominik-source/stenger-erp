// Riadky pre Excel pre uctovnicku (MZDA) - cisto datova cast, bez UI.
import { MZDY_SKUPINY, MZDY_POLOZKY_SKUPINY, MZDY_POLOZKY_SPOLOCNE } from "./mzdy.js";

const nazovSkupiny = (v) => (MZDY_SKUPINY.find((s) => s.value === v) || {}).label || v;

// vysledky: [{ meno, r (vysledok vypocitajMzdu), poznamka }]
export function mzdyRiadkyExportu(vysledky) {
  const riadky = vysledky.map(({ meno, r, poznamka }) => ({
    "Jméno": meno,
    "Skupina": nazovSkupiny(r.skupina),
    "Hodiny celkem": r.hodinyCelkem,
    "Denní hod.": r.hodinyDenne,
    "Noční hod.": r.hodinyNocne,
    "Směny": r.zmeny,
    "Dovolená (dny)": r.dovolenkaDni,
    "Fond (hod.)": r.fond,
    "Přesčas (hod.)": r.nadcasHod,
    "Přesčas Kč": r.nadcasKc,
    "Příplatek hod. Kč": r.priplatokHodKc + r.priplatokVikendKc,
    "Za směny Kč": r.smenyKc,
    "Úklidy": r.uklidy,
    "Úklid Kč": r.uklidKc,
    "Prémie": r.premia,
    "Měsíční příplatek": r.mesacnyPriplatok,
    "Pohyblivá prémie": r.pohyblivaPremia,
    "Mimořádná prémie": r.mimoriadnaPremia,
    "CELKEM Kč": r.celkem,
    "Poznámka": poznamka || "",
  }));
  const sucet = (k) => Math.round(riadky.reduce((s, x) => s + (Number(x[k]) || 0), 0) * 100) / 100;
  if (riadky.length) {
    riadky.push({
      ...Object.fromEntries(Object.keys(riadky[0]).map((k) => [k, ""])),
      "Jméno": "CELKEM",
      "Hodiny celkem": sucet("Hodiny celkem"),
      "Přesčas Kč": sucet("Přesčas Kč"),
      "Příplatek hod. Kč": sucet("Příplatek hod. Kč"),
      "Za směny Kč": sucet("Za směny Kč"),
      "Úklid Kč": sucet("Úklid Kč"),
      "Prémie": sucet("Prémie"),
      "Měsíční příplatek": sucet("Měsíční příplatek"),
      "Pohyblivá prémie": sucet("Pohyblivá prémie"),
      "Mimořádná prémie": sucet("Mimořádná prémie"),
      "CELKEM Kč": sucet("CELKEM Kč"),
    });
  }
  return riadky;
}

export function mzdyRiadkyLegendy(legenda) {
  const riadky = MZDY_POLOZKY_SKUPINY.map((p) => ({
    "Položka": `${p.label} (${p.jednotka})`,
    ...Object.fromEntries(MZDY_SKUPINY.map((s) => [s.label, legenda.skupiny[s.value][p.key]])),
  }));
  for (const p of MZDY_POLOZKY_SPOLOCNE) {
    riadky.push({ "Položka": `${p.label} (${p.jednotka})`, ...Object.fromEntries(MZDY_SKUPINY.map((s, i) => [s.label, i === 0 ? legenda.spolocne[p.key] : ""])) });
  }
  return riadky;
}
