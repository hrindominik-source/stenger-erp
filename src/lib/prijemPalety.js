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

// Prinasa sken udaj, ktory paleta este nema?
function doplniaPaletu(paleta, scan) {
  if (["gtin", "sarza", "dmt", "datumVyroby", "objednavka"].some((k) => scan[k] && !paleta[k])) return true;
  return ["pocet", "nettoKg"].some((k) => (scan[k] ?? null) !== null && (paleta[k] ?? null) === null);
}

// Prida sken: doplni rozpracovanu paletu, alebo zacne novu. Vrati { palety, rozpracovana }.
// Rozpracovana paleta (bez SSCC) caka na dalsie kody tej istej etikety. Na poradi kodov
// nezalezi: opakovany SSCC novu paletu nezacne a kod bez SSCC doplni poslednu paletu,
// ak jej chyba to, co nesie.
export function pridajSken(palety, rozpracovana, scan) {
  const ista = scan.sscc ? palety.findIndex((p) => p.sscc === scan.sscc) : -1;
  if (ista !== -1) {
    let spojena = mergeScans(palety[ista], scan);
    const pripojit = rozpracovana && patriKPalete(spojena, rozpracovana);
    if (pripojit) spojena = mergeScans(spojena, rozpracovana);
    return { palety: palety.map((p, i) => (i === ista ? spojena : p)), rozpracovana: pripojit ? null : rozpracovana };
  }
  const posledna = palety[palety.length - 1];
  if (!rozpracovana && !scan.sscc && posledna && patriKPalete(posledna, scan) && doplniaPaletu(posledna, scan)) {
    return { palety: [...palety.slice(0, -1), mergeScans(posledna, scan)], rozpracovana: null };
  }
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

// Co palete zo skenu este chyba (SSCC, mnozstvo, sarza).
export function chybajuceNaPalete(p) {
  const out = [];
  if (!p.sscc) out.push("SSCC");
  if (p.mnozstvo === null || p.mnozstvo === undefined) out.push("množství");
  if (!p.sarza) out.push("šarže");
  return out;
}

// Bez tychto udajov sa prijem neulozi (zadat sa daju aj rucne).
export function chybajucePovinne({ mnozstvo, sarza, dmt, jeSurovina }) {
  const out = [];
  if (!String(mnozstvo || "").trim()) out.push("množství");
  if (jeSurovina && !String(sarza || "").trim()) out.push("šarže");
  if (jeSurovina && !String(dmt || "").trim()) out.push("DMT");
  return out;
}

// Polozka dodacieho listu pre material prijmu (podla nasho nazvu, potom nazvu z dokladu).
export function polozkaPreMaterial(dodak, material) {
  const polozky = (dodak && dodak.polozky) || [];
  const t = String(material || "").trim().toLowerCase();
  if (!t) return polozky.length === 1 ? polozky[0] : null;
  return polozky.find((p) => p.materialNas && p.materialNas.toLowerCase() === t) || polozky.find((p) => p.nazov.toLowerCase() === t) || null;
}

const sarzeSet = (s) => new Set(String(s || "").split(/[,;]/).map((x) => x.trim().toLowerCase()).filter(Boolean));
const bezMedzier = (s) => String(s || "").replace(/\s/g, "");

// Je paleta (SSCC zo skenu) na dodacom liste? Dodak moze uvadzat cele SSCC (18 cislic)
// alebo len kratke NVE cislo - to je seriova cast SSCC pred kontrolnou cislicou.
export function paletaNaDodaku(sscc, paletyDodaku) {
  const s = String(sscc || "");
  return paletyDodaku.some((p) => p.sscc === s || (p.sscc.length >= 6 && p.sscc.length < 18 && s.length === 18 && s.slice(0, 17).endsWith(p.sscc)));
}

// Krizove kontroly prijmu. Vrati [{ uroven: "chyba" | "upozornenie", text }].
// chyba = nepustit ulozit bez opravy; upozornenie = skladnik vidi a rozhodne.
// dodak = { polozka (vybrana polozka dodacieho listu alebo null), cisloObjednavky, maPolozky }
export function kontrolaPrijmu({ material, mnozstvo, jednotka, sarza, dmt, palety = [], karty = [], prijateSscc = new Set(), objednavka = null, jeSurovina = false, dodak = null, rozpracovana = false, dnes = new Date() }) {
  const out = [];
  const chyba = (text) => out.push({ uroven: "chyba", text });
  const pozor = (text) => out.push({ uroven: "upozornenie", text });

  if (rozpracovana) chyba("Poslední paleta není celá – naskenujte ostatní kódy z její etikety.");

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

  if (dodak) {
    const p = dodak.polozka;
    if (!p && dodak.maPolozky && material) pozor(`Materiál „${material}“ na dodacím listu nenalezen – zkontrolujte, že jde o správný doklad.`);
    if (p) {
      const mn = cislo(mnozstvo);
      if (p.mnozstvo !== null && mn !== null && (!p.jednotka || p.jednotka === jednotka) && p.mnozstvo !== mn) {
        pozor(`Dodací list uvádí ${p.mnozstvo} ${p.jednotka || jednotka}, přijímáte ${mn} ${jednotka}.`);
      }
      const dlSarze = sarzeSet(p.sarza);
      if (dlSarze.size) {
        const mimo = Array.from(new Set(palety.map((x) => x.sarza).filter((x) => x && !dlSarze.has(x.toLowerCase()))));
        if (mimo.length) pozor(`Šarže na etiketě (${mimo.join(", ")}) není na dodacím listu (${p.sarza}).`);
      }
      // DMT palety porovnat s DMT jej sarze na dodaku (ak ju dodak ma), inak so vsetkymi DMT dodaku
      const sarzeDodaku = p.sarze && p.sarze.length ? p.sarze : p.dmt ? [{ sarza: p.sarza, dmt: p.dmt }] : [];
      const dmtDodaku = new Set(sarzeDodaku.map((x) => x.dmt).filter(Boolean));
      if (dmtDodaku.size) {
        const ine = new Set();
        for (const x of palety) {
          if (!x.dmt) continue;
          const jejSarza = x.sarza && sarzeDodaku.find((y) => y.sarza && y.sarza.toLowerCase() === x.sarza.toLowerCase() && y.dmt);
          if (jejSarza ? jejSarza.dmt !== x.dmt : !dmtDodaku.has(x.dmt)) ine.add(x.dmt);
        }
        if (ine.size) pozor(`DMT na etiketě (${Array.from(ine).join(", ")}) se liší od dodacího listu (${Array.from(dmtDodaku).join(", ")}).`);
      }
      const paletyDodaku = p.palety || [];
      if (paletyDodaku.length) {
        const mimo = palety.filter((x) => x.sscc && !paletaNaDodaku(x.sscc, paletyDodaku)).map((x) => x.sscc);
        if (mimo.length) pozor(`Paleta ${mimo.join(", ")} není na dodacím listu.`);
      }
      if (p.pocetPaliet && palety.length && p.pocetPaliet !== palety.length) pozor(`Dodací list uvádí ${p.pocetPaliet} palet, naskenováno ${palety.length}.`);
    }
    const cisloDl = (p && p.cisloObjednavky) || dodak.cisloObjednavky;
    if (cisloDl && objednavka && objednavka.cislo && bezMedzier(cisloDl) !== bezMedzier(objednavka.cislo)) {
      pozor(`Dodací list uvádí objednávku ${cisloDl}, příjem je vázán na ${objednavka.cislo}.`);
    }
  }

  if (jeSurovina) {
    if (!String(sarza || "").trim()) pozor("Chybí šarže suroviny (z etikety nebo dodacího listu).");
    if (!dmt) pozor("Chybí DMT suroviny (z etikety nebo dodacího listu).");
  }
  return out;
}

// ---- Dodaci list s viacerymi polozkami: jeden riadok prijmu na polozku ----

// Riadky formulara z polozok dodacieho listu. jednotky = povolene jednotky formulara.
export function riadkyZDodaku(dodak, jednotky = []) {
  return ((dodak && dodak.polozky) || []).map((p, i) => ({
    key: i,
    zahrnut: true,
    material: p.materialNas || "",
    mnozstvoNum: p.mnozstvo !== null && p.mnozstvo !== undefined ? String(p.mnozstvo).replace(".", ",") : "",
    mnozstvoUnit: p.jednotka && jednotky.includes(p.jednotka) ? p.jednotka : "ks",
    sarza: p.sarza || "",
    dmt: p.dmt || "",
    stavPrevzatia: "V poriadku",
    polozka: p,
  }));
}

const rovnake = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

// Rozdeli naskenovane palety k riadkom: podla karty produktu (GTIN -> material), cisla
// palety na dodaku, sarze; pri jednom zahrnutom riadku vsetky k nemu.
// Vrati { podlaRiadku: Map(key -> [sken]), nepriradene: [sken] }.
export function priradPalety(skeny, riadky, karty = []) {
  const zahrnute = riadky.filter((r) => r.zahrnut);
  const podlaRiadku = new Map(zahrnute.map((r) => [r.key, []]));
  const nepriradene = [];
  for (const s of skeny) {
    const karta = s.gtin && karty.find((k) => k.gtin === s.gtin);
    let r = karta && zahrnute.find((x) => x.material && rovnake(x.material, karta.material));
    if (!r && s.sscc) r = zahrnute.find((x) => paletaNaDodaku(s.sscc, (x.polozka && x.polozka.palety) || []));
    if (!r && s.sarza) r = zahrnute.find((x) => sarzeSet(x.sarza).has(s.sarza.toLowerCase()));
    if (!r && zahrnute.length === 1) r = zahrnute[0];
    if (r) podlaRiadku.get(r.key).push(s);
    else nepriradene.push(s);
  }
  return { podlaRiadku, nepriradene };
}
