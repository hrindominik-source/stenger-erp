// Dohladatelnost expedovanych paliet (bez Reactu/Supabase - kvoli testom).
// Sarza, lot a BBD su pre firmu jedna stopa: ked sarza chyba, plati BBD.
// Zdroje: skenovane palety z PDA a rucne zapisane davky expedicie.

import { findProduktForGtin, nveProduktNazov, formatIsoDate } from "./pdaExport.js";
import { formatDateTime } from "./utils.js";

export function stopaPalety(p) {
  return String(p.sarza || "").trim() || formatIsoDate(p.bbd) || "";
}

// Porovnavaci tvar stopy: "28.5.2027" = "28.05.2027", velke/male pismena jedno.
export function normStopa(s) {
  const t = String(s || "").trim().toLowerCase();
  const m = t.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/);
  return m ? `${m[1].padStart(2, "0")}.${m[2].padStart(2, "0")}.${m[3]}` : t;
}

// "dd.mm.rrrr" z rucneho zapisu -> ISO (poludnie, nech sa neposunie den).
export function datumZRucneho(datum, fallbackIso) {
  const m = String(datum || "").match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return fallbackIso || "";
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T12:00:00`;
}

// Riadok expedicia_zaznamy (+ orders) -> rucna davka; ine typy a davky
// vytvorene zo skenu (zdroj "pda" - tie su uz v paletach) vynecha.
export function rucnaDavka(row) {
  const d = row.data || {};
  if (d.typ || d.zdroj === "pda" || !d.produktId) return null;
  const o = row.orders || {};
  return {
    produktId: d.produktId,
    produktNazov: d.produktNazov || "",
    sarza: String(d.sarza || "").trim(),
    pocetPaliet: parseFloat(d.pocetPaliet) || 0,
    datum: datumZRucneho(d.datum, row.created_at),
    zapisal: d.zapisal || "",
    zakaznik: o.zakaznik || "",
    objednavka: o.cislo_objednavky_dopravy || "",
    cisloLs: o.cislo_dodacieho_listu || "",
  };
}

function novyRiadok(key, extra) {
  return { key, gtin: "", produkt: "", artikel: "", stopa: "", sarza: "", bbd: "", mnozstvo: 0, mnozstvoNeuplne: false, paletCelkom: 0, palety: [], ...extra };
}

// Riadok = produkt + stopa (sarza, inak BBD).
export function buildDohladatelnost(vydajky, palety, products = [], rucne = []) {
  const vMap = new Map(vydajky.map((v) => [v.id, v]));
  const map = new Map();
  for (const p of palety) {
    const v = vMap.get(p.vydajka_id);
    if (!v) continue;
    const produkt = findProduktForGtin(p.gtin, products);
    const produktKey = produkt ? "p:" + produkt.id : "g:" + (p.gtin || "");
    const stopa = stopaPalety(p);
    const key = produktKey + "|" + normStopa(stopa);
    let r = map.get(key);
    if (!r) {
      r = novyRiadok(key, {
        produktKey,
        gtin: p.gtin || "",
        produkt: produkt ? nveProduktNazov(produkt) : "",
        artikel: produkt ? produkt.cisloArtikluSW || produkt.cisloArtiklu || "" : "",
        stopa,
        sarza: String(p.sarza || "").trim(),
        bbd: p.bbd || "",
      });
      map.set(key, r);
    }
    if (!r.gtin) r.gtin = p.gtin || "";
    if (!r.bbd && p.bbd) r.bbd = p.bbd;
    if (p.mnozstvo === null || p.mnozstvo === undefined) r.mnozstvoNeuplne = true;
    else r.mnozstvo += Number(p.mnozstvo);
    r.paletCelkom += 1;
    const o = (v.data && v.data.objednavka) || null;
    r.palety.push({
      zdroj: "Sken",
      sscc: p.sscc,
      pocet: 1,
      mnozstvo: p.mnozstvo,
      pracovnik: p.pracovnik || "",
      cisloLs: v.cislo_lieferschein,
      stav: v.stav,
      datum: v.dokoncena_at || v.created_at || "",
      zakaznik: o ? o.zakaznik : "",
      objednavka: o ? o.cislo : "",
    });
  }
  for (const d of rucne) {
    const produkt = (products || []).find((x) => x.id === d.produktId);
    const produktKey = "p:" + d.produktId;
    const key = produktKey + "|" + normStopa(d.sarza);
    let r = map.get(key);
    if (!r) {
      r = novyRiadok(key, {
        produktKey,
        produkt: produkt ? nveProduktNazov(produkt) : d.produktNazov,
        artikel: produkt ? produkt.cisloArtikluSW || produkt.cisloArtiklu || "" : "",
        stopa: d.sarza,
        sarza: d.sarza,
      });
      map.set(key, r);
    }
    r.mnozstvoNeuplne = true; // rucne davky su v paletach, nie v kusoch
    r.paletCelkom += d.pocetPaliet;
    r.palety.push({ zdroj: "Ručně", sscc: "", pocet: d.pocetPaliet, mnozstvo: null, pracovnik: d.zapisal, cisloLs: d.cisloLs, stav: "dokoncena", datum: d.datum, zakaznik: d.zakaznik, objednavka: d.objednavka });
  }
  return Array.from(map.values())
    .map((r) => {
      const datumy = r.palety.map((p) => p.datum).filter(Boolean).sort();
      return {
        ...r,
        paletCelkom: Math.round(r.paletCelkom * 1000) / 1000,
        zakaznici: Array.from(new Set(r.palety.map((p) => p.zakaznik).filter(Boolean))),
        datumOd: datumy[0] || "",
        datumDo: datumy[datumy.length - 1] || "",
      };
    })
    .sort((a, b) => (b.datumDo > a.datumDo ? 1 : b.datumDo < a.datumDo ? -1 : a.key.localeCompare(b.key)));
}

export function filtrujDohladatelnost(riadky, hladat) {
  const q = String(hladat || "").trim().toLowerCase();
  if (!q) return riadky;
  const qn = normStopa(q);
  return riadky.filter((r) =>
    [r.produkt, r.artikel, r.gtin, r.sarza, r.stopa, formatIsoDate(r.bbd), ...r.zakaznici].some((t) => {
      const s = String(t || "").toLowerCase();
      return s.includes(q) || normStopa(s).includes(qn);
    }) ||
    r.palety.some((p) => (p.sscc && p.sscc.includes(q)) || String(p.cisloLs).toLowerCase().includes(q) || String(p.objednavka).toLowerCase().includes(q)),
  );
}

const den = (iso) => (iso ? formatDateTime(iso).slice(0, 10) : "");

// Harky pre exportSheetsToExcel.
export function dohladatelnostSheets(riadky) {
  const souhrn = riadky.map((r) => ({
    "Produkt": r.produkt,
    "Číslo artiklu": r.artikel,
    "GTIN": r.gtin,
    "Šarže / lot": r.stopa,
    "BBD": formatIsoDate(r.bbd),
    "Palet": r.paletCelkom,
    "Množství (ks ze skenu)": r.mnozstvo,
    "Neúplné množství": r.mnozstvoNeuplne ? "ano" : "",
    "Zákazníci": r.zakaznici.join(", "),
    "Expedováno od": den(r.datumOd),
    "Expedováno do": den(r.datumDo),
  }));
  const palety = riadky.flatMap((r) =>
    r.palety.map((p) => ({
      "Zdroj": p.zdroj,
      "Produkt": r.produkt,
      "GTIN": r.gtin,
      "Šarže / lot": r.stopa,
      "BBD": formatIsoDate(r.bbd),
      "SSCC": p.sscc,
      "Palet": p.pocet,
      "Množství": p.mnozstvo != null ? p.mnozstvo : "",
      "Zákazník": p.zakaznik,
      "Objednávka": p.objednavka,
      "Lieferschein": p.cisloLs,
      "Datum": den(p.datum),
      "Stav výdejky": p.stav === "dokoncena" ? "dokončená" : "rozpracovaná",
      "Zapsal / naskenoval": p.pracovnik,
    })),
  );
  const prazdne = [{ Info: "Žádné palety" }];
  return [
    { name: "Souhrn", rows: souhrn.length ? souhrn : prazdne, colWidth: 20 },
    { name: "Palety", rows: palety.length ? palety : prazdne, colWidth: 20 },
  ];
}

// Davky expedicie (expedicia_zaznamy) zo skenu objednavky - po produkte a stope.
// labelFn: nazov produktu tak, ako ho pise sklad. Vrati { zaznamy, bezProduktu }.
export function davkyZoSkenu(palety, products, labelFn) {
  const map = new Map();
  const bezProduktu = new Set();
  for (const p of palety) {
    const produkt = findProduktForGtin(p.gtin, products);
    if (!produkt) {
      bezProduktu.add(p.gtin || "?");
      continue;
    }
    const stopa = stopaPalety(p);
    const key = produkt.id + "|" + normStopa(stopa);
    const r = map.get(key) || { produktId: produkt.id, produktNazov: labelFn ? labelFn(produkt) : nveProduktNazov(produkt), sarza: stopa, pocetPaliet: 0, pocetKartonov: null, zdroj: "pda" };
    r.pocetPaliet += 1;
    map.set(key, r);
  }
  return { zaznamy: Array.from(map.values()), bezProduktu: Array.from(bezProduktu) };
}
