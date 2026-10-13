// Excel export PDA vydajok - PRACOVNA verzia. Presny format MAXIM (poradie
// stlpcov, nazvy, hárky) sa doplni podla vzoroveho suboru; staci zmenit
// tuto funkciu, PdaOfficeView ju len vola.

import { formatDateTime } from "./utils.js";
import { summarizePallets } from "./pdaScan.js";

export const PDA_EXPORT_VERSION = "pracovni";

export function formatIsoDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

const stavText = (stav) => (stav === "dokoncena" ? "Dokončená" : "Rozpracovaná");

// vydajky: riadky pda_vydajky, palety: riadky pda_palety (lubovolne poradie).
// Vracia [{ name, rows, colWidth? }] pre exportSheetsToExcel.
export function buildPdaExportSheets(vydajky, palety) {
  const vMap = new Map(vydajky.map((v) => [v.id, v]));
  const podla = new Map();
  for (const p of palety) {
    if (!vMap.has(p.vydajka_id)) continue;
    if (!podla.has(p.vydajka_id)) podla.set(p.vydajka_id, []);
    podla.get(p.vydajka_id).push(p);
  }
  const zoradene = (arr) => arr.slice().sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));

  const paletyRows = [];
  for (const v of vydajky) {
    for (const p of zoradene(podla.get(v.id) || [])) {
      paletyRows.push({
        "Lieferschein": v.cislo_lieferschein,
        "Stav výdejky": stavText(v.stav),
        "Datum výdejky": formatDateTime(v.created_at).slice(0, 10),
        "SSCC": p.sscc,
        "GTIN": p.gtin || "",
        "BBD": formatIsoDate(p.bbd),
        "Typ data (AI)": p.bbd_ai || "",
        "Šarže": p.sarza || "",
        "Množství (AI 37)": p.mnozstvo != null ? p.mnozstvo : "",
        "Naskenoval": p.pracovnik || "",
        "Čas skenu": formatDateTime(p.created_at),
      });
    }
  }

  const souhrnRows = [];
  for (const v of vydajky) {
    for (const s of summarizePallets(podla.get(v.id) || [])) {
      souhrnRows.push({
        "Lieferschein": v.cislo_lieferschein,
        "GTIN": s.gtin,
        "BBD": formatIsoDate(s.bbd),
        "Šarže": s.sarza,
        "Palet": s.palet,
        "Množství celkem": s.mnozstvo,
        "Neúplné množství": s.mnozstvoNeuplne ? "ano" : "",
      });
    }
  }

  const vydajkyRows = vydajky.map((v) => ({
    "Lieferschein": v.cislo_lieferschein,
    "Stav": stavText(v.stav),
    "Založeno": formatDateTime(v.created_at),
    "Založil": v.pracovnik || "",
    "Dokončeno": formatDateTime(v.dokoncena_at),
    "Dokončil": v.dokoncil || "",
    "Palet": (podla.get(v.id) || []).length,
  }));

  return [
    { name: "Palety", rows: paletyRows.length ? paletyRows : [{ Info: "Žádné palety" }], colWidth: 20 },
    { name: "Souhrn", rows: souhrnRows.length ? souhrnRows : [{ Info: "Žádné palety" }] },
    { name: "Výdejky", rows: vydajkyRows.length ? vydajkyRows : [{ Info: "Žádné výdejky" }] },
  ];
}
