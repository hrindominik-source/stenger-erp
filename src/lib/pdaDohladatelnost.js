// Dohladatelnost expedovanych paliet (bez Reactu/Supabase - kvoli testom).
// Sarza, lot a BBD su pre firmu jedna stopa: ked sarza chyba, plati BBD.

import { findProduktForGtin, nveProduktNazov, formatIsoDate } from "./pdaExport.js";
import { formatDateTime } from "./utils.js";

export function stopaPalety(p) {
  return String(p.sarza || "").trim() || formatIsoDate(p.bbd) || "";
}

// Datum expedicie vydajky: dokoncenie, u rozpracovanej zalozenie.
function datumVydajky(v) {
  return v.dokoncena_at || v.created_at || "";
}

// Riadok = produkt + sarza + BBD; v riadku palety s udajmi o vydajke.
export function buildDohladatelnost(vydajky, palety, products = []) {
  const vMap = new Map(vydajky.map((v) => [v.id, v]));
  const map = new Map();
  for (const p of palety) {
    const v = vMap.get(p.vydajka_id);
    if (!v) continue;
    const key = [p.gtin || "", String(p.sarza || "").trim(), p.bbd || ""].join("|");
    let r = map.get(key);
    if (!r) {
      const produkt = findProduktForGtin(p.gtin, products);
      r = {
        key,
        gtin: p.gtin || "",
        produkt: produkt ? nveProduktNazov(produkt) : "",
        artikel: produkt ? produkt.cisloArtikluSW || produkt.cisloArtiklu || "" : "",
        stopa: stopaPalety(p),
        sarza: String(p.sarza || "").trim(),
        bbd: p.bbd || "",
        mnozstvo: 0,
        mnozstvoNeuplne: false,
        palety: [],
      };
      map.set(key, r);
    }
    if (p.mnozstvo === null || p.mnozstvo === undefined) r.mnozstvoNeuplne = true;
    else r.mnozstvo += Number(p.mnozstvo);
    const o = (v.data && v.data.objednavka) || null;
    r.palety.push({
      sscc: p.sscc,
      mnozstvo: p.mnozstvo,
      pracovnik: p.pracovnik || "",
      cisloLs: v.cislo_lieferschein,
      stav: v.stav,
      datum: datumVydajky(v),
      zakaznik: o ? o.zakaznik : "",
      objednavka: o ? o.cislo : "",
    });
  }
  return Array.from(map.values())
    .map((r) => {
      const datumy = r.palety.map((p) => p.datum).filter(Boolean).sort();
      return {
        ...r,
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
  return riadky.filter((r) =>
    [r.produkt, r.artikel, r.gtin, r.sarza, r.stopa, formatIsoDate(r.bbd), ...r.zakaznici].some((t) => String(t || "").toLowerCase().includes(q)) ||
    r.palety.some((p) => p.sscc.includes(q) || String(p.cisloLs).toLowerCase().includes(q) || String(p.objednavka).toLowerCase().includes(q)),
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
    "Palet": r.palety.length,
    "Množství": r.mnozstvo,
    "Neúplné množství": r.mnozstvoNeuplne ? "ano" : "",
    "Zákazníci": r.zakaznici.join(", "),
    "Expedováno od": den(r.datumOd),
    "Expedováno do": den(r.datumDo),
  }));
  const palety = riadky.flatMap((r) =>
    r.palety.map((p) => ({
      "Produkt": r.produkt,
      "GTIN": r.gtin,
      "Šarže / lot": r.stopa,
      "BBD": formatIsoDate(r.bbd),
      "SSCC": p.sscc,
      "Množství": p.mnozstvo != null ? p.mnozstvo : "",
      "Zákazník": p.zakaznik,
      "Objednávka": p.objednavka,
      "Lieferschein": p.cisloLs,
      "Datum": den(p.datum),
      "Stav výdejky": p.stav === "dokoncena" ? "dokončená" : "rozpracovaná",
      "Naskenoval": p.pracovnik,
    })),
  );
  const prazdne = [{ Info: "Žádné palety" }];
  return [
    { name: "Souhrn", rows: souhrn.length ? souhrn : prazdne, colWidth: 20 },
    { name: "Palety", rows: palety.length ? palety : prazdne, colWidth: 20 },
  ];
}
