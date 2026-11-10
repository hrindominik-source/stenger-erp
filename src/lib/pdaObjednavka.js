// Kontrola PDA vydajky voci objednavke Stenger ONE (bez Reactu/Supabase - kvoli testom).
// Vydajka si pri zalozeni ulozi kopiu objednavky do data.objednavka.

import { findProduktForGtin } from "./pdaExport.js";
import { extractCityFromAddress } from "./utils.js";

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

// Objednavky Edeka/Picnic/Globus idu cez Stenger Waffeln GmbH, ale expeduju
// sa priamo - rozhoduje aj miesto dodania.
export function jeSkenovanaObjednavka(o) {
  return [o.zakaznik, o.adresa_dodania_nazov, o.adresa_dodania].some(jeSkenovanyZakaznik);
}

// Kam tovar realne ide: miesto dodania, inak zakaznik.
export function prijemcaObjednavky(o) {
  return String(o.adresa_dodania_nazov || "").trim() || o.zakaznik || "";
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

// Mesto dodania a doklady objednavky pre skladnika: nemecke LS (Lieferschein DE
// od kolegov - pod nim ide vydajka aj NVE list) a nas cesky DL.
// Ulica a PSC z adresy dodania ("Industriestr. 5, 86899 Landsberg") - rozlisi dva
// sklady v tom istom meste. Riadky s nazvom firmy vynecha (berie len riadok pred PSC + PSC).
export function ulicaZAdresy(adresa) {
  const seg = String(adresa || "").split(/[\n,;]/).map((x) => x.trim()).filter(Boolean);
  const i = seg.findIndex((x) => /^(D-|DE-)?\d{4,5}\s+\S/i.test(x));
  if (i < 0) return "";
  const psc = seg[i].match(/^(?:D-|DE-)?(\d{4,5})/i)[1];
  const pred = i > 0 ? seg[i - 1] : "";
  const ulica = /\d|str\.|stra(ss|ß)e|allee|weg|platz|ring|gasse|damm|ufer|chaussee/i.test(pred) ? pred : "";
  return [ulica, psc].filter(Boolean).join(", ");
}

export function hlavickaObjednavky(o) {
  return {
    mesto: extractCityFromAddress(o.adresa_dodania || ""),
    ulica: ulicaZAdresy(o.adresa_dodania),
    lsDe: String(o.nemecky_dodak_cislo || "").trim(),
    dl: String(o.cislo_dodacieho_listu || "").trim(),
  };
}

// Kratky nazov pre skladnika: prve slovo prijemcu + mesto, napr. "EDEKA LANDSBERG".
// Funguje aj s ulozenou objednavkou vydajky ({ zakaznik, mesto }).
export function kratkyNazov(o) {
  if (!o) return "";
  const meno = o.adresa_dodania_nazov !== undefined || o.zakaznik_nazov !== undefined ? prijemcaObjednavky(o) : String(o.zakaznik || "");
  // "Landsberg am Lech" -> "Landsberg", "Bingen am Rhein" -> "Bingen"
  const mesto = String(o.mesto !== undefined ? o.mesto : extractCityFromAddress(o.adresa_dodania || ""))
    .replace(/\s+(am|an|im|in|bei|ob|unter|vor|a\.|i\.|\(|\/).*$/i, "").trim();
  const prve = meno.trim().split(/[\s,]+/)[0] || "";
  return [prve, mesto].filter(Boolean).join(" ").toUpperCase();
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
    zakaznik: prijemcaObjednavky(o),
    objednavatel: o.zakaznik || "",
    ...hlavickaObjednavky(o),
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
