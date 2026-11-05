// Palety pri prijme tovaru a krizove kontroly. Udaje palety mozu prist zo skenu
// GS1 etikety (najlepsie), alebo rucne / z dodacieho listu, ked etiketa GS1 nema.
// Kontroly bezia vzdy rovnako, nech su udaje odkialkolvek.

import { parseSkDate } from "./utils.js";
import { mergeScans, mnozstvoPalety, dmtZTrvanlivosti } from "./gs1.js";

export const ZDROJ_PALETY = { SKEN: "sken", RUCNE: "rucne", DODAK: "dodak" };

// Dva skeny patria k tej istej palete, ak si neodporuju (rovnaky udaj s inou hodnotou).
export function patriKPalete(paleta, scan) {
  if (!paleta) return false;
  for (const k of ["sscc", "gtin", "sarza", "dmt", "datumVyroby"]) {
    if (paleta[k] && scan[k] && paleta[k] !== scan[k]) return false;
  }
  return true;
}

// Prida sken: doplni rozpracovanu paletu, alebo zacne novu. Vrati { palety, rozpracovana }.
// Rozpracovana paleta (bez SSCC) caka na dalsie kody tej istej etikety.
export function pridajSken(palety, rozpracovana, scan) {
  if (rozpracovana && patriKPalete(rozpracovana, scan)) {
    const spojena = mergeScans(rozpracovana, scan);
    return spojena.sscc ? { palety: [...palety, spojena], rozpracovana: null } : { palety, rozpracovana: spojena };
  }
  const hotove = rozpracovana ? [...palety, rozpracovana] : palety;
  return scan.sscc ? { palety: [...hotove, scan], rozpracovana: null } : { palety: hotove, rozpracovana: scan };
}

// Doplni mnozstvo a DMT palety podla karty produktu (GTIN -> material).
export function doplnPaletu(scan, karta) {
  // ulozena paleta (uprava prijmu) bez poctu z etikety si necha ulozene mnozstvo
  const ulozene = scan.mnozstvo !== undefined && scan.mnozstvo !== null && (scan.pocet === null || scan.pocet === undefined) && !scan.nettoKg;
  const mnozstvo = ulozene ? scan.mnozstvo : mnozstvoPalety({ pocet: scan.pocet ?? null, nettoKg: scan.nettoKg ?? null }, karta);
  const dmt = scan.dmt || (karta && karta.trvanlivostMesiace ? dmtZTrvanlivosti(scan.datumVyroby, karta.trvanlivostMesiace) : "");
  return {
    sscc: scan.sscc || "",
    gtin: scan.gtin || "",
    sarza: scan.sarza || "",
    dmt,
    dmtVypocitane: !scan.dmt && !!dmt,
    datumVyroby: scan.datumVyroby || "",
    objednavka: scan.objednavka || "",
    pocet: scan.pocet,
    nettoKg: scan.nettoKg ?? null,
    mnozstvo,
    zdroj: scan.zdroj || ZDROJ_PALETY.SKEN,
  };
}

export function sumaPaliet(palety) {
  const s = palety.reduce((acc, p) => acc + (Number(p.mnozstvo) || 0), 0);
  return Math.round(s * 1000) / 1000;
}

// Sarze a DMT do zaznamu prijmu: unikatne sarze, najskorsie DMT.
export function suhrnPaliet(palety) {
  const sarze = Array.from(new Set(palety.map((p) => p.sarza).filter(Boolean)));
  const dmts = palety.map((p) => p.dmt).filter(Boolean).sort((a, b) => (parseSkDate(a) || 0) - (parseSkDate(b) || 0));
  return { sarza: sarze.join(", "), dmt: dmts[0] || "" };
}

function cislo(s) {
  const n = parseFloat(String(s || "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// Krizove kontroly prijmu. Vrati [{ uroven: "chyba" | "upozornenie", text }].
// chyba = nepustit ulozit bez opravy; upozornenie = skladnik vidi a rozhodne.
export function kontrolaPrijmu({ material, mnozstvo, jednotka, sarza, dmt, palety = [], karty = [], prijateSscc = new Set(), objednavka = null, jeSurovina = false, dnes = new Date() }) {
  const out = [];
  const chyba = (text) => out.push({ uroven: "chyba", text });
  const pozor = (text) => out.push({ uroven: "upozornenie", text });

  const videne = new Set();
  for (const p of palety) {
    if (!p.sscc) continue;
    if (videne.has(p.sscc)) chyba(`Paleta ${p.sscc} je naskenovaná dvakrát.`);
    videne.add(p.sscc);
    if (prijateSscc.has(p.sscc)) chyba(`Paleta ${p.sscc} už byla přijata dříve.`);
  }

  const kartyPodlaGtin = new Map(karty.map((k) => [k.gtin, k]));
  const ineMaterialy = new Set();
  for (const p of palety) {
    const k = p.gtin && kartyPodlaGtin.get(p.gtin);
    if (k && material && k.material.trim().toLowerCase() !== material.trim().toLowerCase()) ineMaterialy.add(k.material);
  }
  if (ineMaterialy.size) chyba(`Naskenovaná paleta je podle etikety jiný materiál (${Array.from(ineMaterialy).join(", ")}) než „${material}“.`);

  const gtiny = new Set(palety.map((p) => p.gtin).filter(Boolean));
  if (gtiny.size > 1) pozor("Na příjmu jsou palety s různými kódy produktu (GTIN) – zkontrolujte, že jde o stejný materiál.");

  if (objednavka) {
    const cisla = new Set(palety.map((p) => p.objednavka).filter(Boolean));
    for (const c of cisla) {
      if (objednavka.cislo && c.replace(/\s/g, "") !== String(objednavka.cislo).replace(/\s/g, "")) pozor(`Etiketa uvádí objednávku ${c}, příjem je vázán na ${objednavka.cislo}.`);
    }
    const obj = String(objednavka.mnozstvo || "").match(/^([\d\s.,]+)\s*(.*)$/);
    const objMn = obj ? cislo(obj[1]) : null;
    const objJed = obj ? obj[2].trim() : "";
    const mn = cislo(mnozstvo);
    if (objMn !== null && mn !== null && (!objJed || objJed === jednotka) && objMn !== mn) {
      pozor(`Přijímáte ${mn} ${jednotka}, objednáno bylo ${objMn} ${objJed || jednotka}.`);
    }
  }

  if (palety.length) {
    const suma = sumaPaliet(palety);
    const mn = cislo(mnozstvo);
    if (palety.every((p) => p.mnozstvo !== null && p.mnozstvo !== undefined) && mn !== null && suma !== mn) {
      pozor(`Součet naskenovaných palet je ${suma} ${jednotka}, zapsané množství ${mn} ${jednotka}.`);
    }
    const bezMnozstva = palety.filter((p) => p.mnozstvo === null || p.mnozstvo === undefined).length;
    if (bezMnozstva) pozor(`U ${bezMnozstva} palet(y) etiketa neuvádí množství – zadejte ho ručně.`);
  }

  const dmtDate = dmt ? parseSkDate(dmt) : null;
  if (dmt && !dmtDate) chyba("DMT zadejte ve tvaru DD.MM.RRRR.");
  if (dmtDate) {
    const dnesBezCasu = new Date(dnes.getFullYear(), dnes.getMonth(), dnes.getDate());
    if (dmtDate < dnesBezCasu) chyba(`DMT ${dmt} už prošlo.`);
  }
  for (const p of palety) {
    const v = p.datumVyroby && parseSkDate(p.datumVyroby);
    const d = p.dmt && parseSkDate(p.dmt);
    if (v && d && d <= v) pozor(`Paleta ${p.sscc || ""}: DMT ${p.dmt} není po datu výroby ${p.datumVyroby} – zkontrolujte etiketu.`);
  }

  if (jeSurovina) {
    if (!String(sarza || "").trim()) pozor("Chybí šarže suroviny (z etikety nebo dodacího listu).");
    if (!dmt) pozor("Chybí DMT suroviny (z etikety nebo dodacího listu).");
  }
  return out;
}
