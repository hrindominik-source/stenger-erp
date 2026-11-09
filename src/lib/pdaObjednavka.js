// Kontrola PDA vydajky voci objednavke Stenger ONE (bez Reactu/Supabase - kvoli testom).
// Vydajka si pri zalozeni ulozi kopiu objednavky do data.objednavka.

import { findProduktForGtin } from "./pdaExport.js";

const cislo = (v) => {
  const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const kod = (v) => String(v || "").replace(/\s/g, "").toUpperCase();

// Zakaznici, ktorych palety sa pri expedicii povinne skenuju.
const SKENOVANI_ZAKAZNICI = /edeka|picnic|globus/i;

export function jeSkenovanyZakaznik(zakaznik) {
  return SKENOVANI_ZAKAZNICI.test(String(zakaznik || ""));
}

// Moze sa expedicia potvrdit? vydajky = [{ stav, palet }] naviazane na objednavku.
// Vrati text prekazky, alebo prazdny retazec.
export function prekazkaSkenuExpedice({ vydajky, ocakavane }) {
  if (!vydajky.length) return "Sken expedice je povinný – naskenujte palety na PDA do výdejky s touto objednávkou.";
  if (vydajky.some((v) => v.stav !== "dokoncena")) return "Výdejka na PDA není dokončená – nejdřív ji dokončete.";
  const naskenovane = vydajky.reduce((s, v) => s + v.palet, 0);
  if (ocakavane && naskenovane < ocakavane) return `Chybí ${ocakavane - naskenovane} pal.: podle objednávky ${ocakavane}, naskenováno ${naskenovane}.`;
  if (ocakavane && naskenovane > ocakavane) return `Navíc ${naskenovane - ocakavane} pal.: podle objednávky ${ocakavane}, naskenováno ${naskenovane}.`;
  return "";
}

// Riadok z get_orders_for_sklad -> kopia do vydajky.
export function objednavkaProVydajku(o) {
  const polozky = (Array.isArray(o.polozky) ? o.polozky : [])
    .slice(0, 40)
    .map((p) => ({ popis: String(p.popis || "").slice(0, 80), artikel: String(p.artikel || "").slice(0, 30), palet: cislo(p.palet) }));
  const zPoloziek = polozky.reduce((s, p) => s + p.palet, 0);
  return {
    id: o.id,
    cislo: o.cislo_objednavky_dopravy || "",
    zakaznik: o.zakaznik || "",
    palet: zPoloziek || cislo(o.pocet_paliet),
    polozky,
  };
}

function produktPolozky(polozka, products) {
  const a = kod(polozka.artikel);
  if (!a) return null;
  return (products || []).find((p) => kod(p.cisloArtikluSW) === a || kod(p.cisloArtiklu) === a) || null;
}

// Porovna ulozene palety s objednavkou. Po polozkach len tam, kde sa polozka
// da sparovat s produktom; inak ostava porovnanie celkoveho poctu.
export function porovnajVydajku(objednavka, palety, products) {
  const riadky = objednavka.polozky.map((p) => ({ ...p, produkt: produktPolozky(p, products), naskenovane: 0 }));
  const sparovane = riadky.filter((r) => r.produkt);
  const mimo = new Set();
  for (const pal of palety) {
    const produkt = findProduktForGtin(pal.gtin, products);
    if (!produkt || !sparovane.length) continue;
    const riadok = sparovane.find((r) => r.produkt.id === produkt.id);
    if (riadok) riadok.naskenovane += 1;
    else mimo.add(pal.gtin);
  }
  return {
    ocakavane: objednavka.palet,
    naskenovane: palety.length,
    riadky: sparovane.map((r) => ({ popis: r.popis, ocakavane: r.palet, naskenovane: r.naskenovane })),
    mimo: Array.from(mimo),
  };
}

// Varovania k palete pri skene. dnesIso = "RRRR-MM-DD".
export function varovaniaPalety(paleta, { objednavka = null, products = [], dnesIso }) {
  const out = [];
  if (paleta.bbd && paleta.bbd < dnesIso) out.push("DMT palety už prošlo!");
  if (products.length) {
    const produkt = findProduktForGtin(paleta.gtin, products);
    if (!produkt) out.push("Výrobek není v Stenger ONE.");
    else if (objednavka && porovnajVydajku(objednavka, [paleta], products).mimo.length) out.push("Výrobek není na této objednávce!");
  }
  return out;
}

// Palety bez sarze aj BBD - nie su dohladatelne, vydajka sa s nimi nedokonci.
export function paletyBezStopy(palety) {
  return palety.filter((p) => !String(p.sarza || "").trim() && !p.bbd);
}

// Problemy pred dokoncenim vydajky.
export function problemyVydajky({ objednavka, palety, products, dnesIso }) {
  const out = [];
  if (objednavka) {
    const v = porovnajVydajku(objednavka, palety, products);
    if (v.ocakavane && v.naskenovane !== v.ocakavane) out.push(`Podle objednávky má jet ${v.ocakavane} palet, naskenováno ${v.naskenovane}.`);
    for (const r of v.riadky) if (r.naskenovane !== r.ocakavane) out.push(`${r.popis}: má jet ${r.ocakavane} palet, naskenováno ${r.naskenovane}.`);
    if (v.mimo.length) out.push(`Výrobky mimo objednávku: ${v.mimo.join(", ")}.`);
  }
  const poDmt = palety.filter((p) => p.bbd && p.bbd < dnesIso).length;
  if (poDmt) out.push(`Po DMT: ${poDmt} palet.`);
  const bezMnozstva = palety.filter((p) => p.mnozstvo === null || p.mnozstvo === undefined).length;
  if (bezMnozstva) out.push(`Bez množství: ${bezMnozstva} palet.`);
  if (products.length) {
    const nezname = palety.filter((p) => !findProduktForGtin(p.gtin, products)).length;
    if (nezname) out.push(`Výrobek není v Stenger ONE: ${nezname} palet.`);
  }
  return out;
}
