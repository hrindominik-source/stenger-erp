// Excel exporty PDA vydajok:
//   * buildNveListData / buildNveListWorkbook - NVE LIST presne podla
//     originalneho exportu MJ Soft MAXIM (1 vydajka = 1 subor, harok
//     "NVE List"). Rozlozenie a formatovanie (pisma, oramovanie, sirky,
//     zlucene bunky, ciselne formaty) sa berie z __fixtures__/nveListMaxim.layout.json,
//     ktory je vytiahnuty z originalu (scripts/maxim-nve-spec.py).
//   * buildPdaExportSheets - prehlad viacerych vydajok (pracovny, 3 harky).

import { formatDateTime } from "./utils.js";
import { summarizePallets } from "./pdaScan.js";
import NVE_LAYOUT from "./__fixtures__/nveListMaxim.layout.json";

export function formatIsoDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

const stavText = (stav) => (stav === "dokoncena" ? "Dokončená" : "Rozpracovaná");

// PREHLAD viacerych vydajok (pracovny format, 3 harky).
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

/* ---------------- NVE LIST (format MAXIM) ---------------- */

// Prijemca v hlavicke NVE listu - v MAXIM exporte pre Nemecko Stenger
// Waffeln GmbH. Po prepojeni vydajky s objednavkou (order_id) sa moze brat
// z objednavky.
export const NVE_PRIJEMCA_DEFAULT = ["Stenger Waffeln GmbH", "Nikolaus - otto - str.12", "D – 56727  Mayen"];

const digits = (s) => String(s || "").replace(/\D/g, "");

// Produkt Stenger ONE pre GTIN z paletovej etikety: najprv presna zhoda s
// "EAN karton" / "EAN unit" (bez uvodnych nul), potom GTIN-14 s indikatorom
// baliacej urovne (1-8 + rovnake telo ako EAN-13 kartonu/jednotky).
export function findProduktForGtin(gtin, products) {
  const g = digits(gtin).replace(/^0+/, "");
  if (!g) return null;
  const list = products || [];
  const eans = (p) => [p.eanKarton, p.eanUnit].map((e) => digits(e).replace(/^0+/, "")).filter(Boolean);
  const exact = list.find((p) => eans(p).includes(g));
  if (exact) return exact;
  const telo = digits(gtin).length === 14 ? digits(gtin).slice(1, 13) : null;
  if (!telo) return null;
  return list.find((p) => [p.eanKarton, p.eanUnit].some((e) => digits(e) && digits(e).padStart(13, "0").slice(0, 12) === telo)) || null;
}

// Nazov produktu v NVE liste (MAXIM: napr. "GUT&GÜNSTIG POPCORN 200g").
export function nveProduktNazov(p) {
  if (!p) return "";
  const znacka = String(p.znacka || "").trim();
  let gramaz = String(p.gramaz || "").trim();
  if (/^\d+([.,]\d+)?$/.test(gramaz)) gramaz += "g";
  if (!gramaz || znacka.toLowerCase().includes(gramaz.toLowerCase())) return znacka;
  return `${znacka} ${gramaz}`.trim();
}

function localDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

// Data NVE listu (bez Excelu) - testovatelne. Palety v poradi skenovania.
export function buildNveListData(vydajka, palety, { products = [], prijemce = NVE_PRIJEMCA_DEFAULT, datum } = {}) {
  const zoradene = palety
    .filter((p) => p.vydajka_id === vydajka.id)
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  const bezProduktu = new Set();
  const rows = zoradene.map((p, i) => {
    const produkt = findProduktForGtin(p.gtin, products);
    if (!produkt && p.gtin) bezProduktu.add(p.gtin);
    const mhd = formatIsoDate(p.bbd);
    return {
      poradie: String(i + 1),
      number: produkt ? String(produkt.cisloArtikluSW || produkt.cisloArtiklu || "") : "",
      product: produkt ? nveProduktNazov(produkt) : p.gtin ? "GTIN " + p.gtin : "",
      sscc: String(p.sscc),
      amount: p.mnozstvo == null ? null : Number(p.mnozstvo),
      unit: NVE_LAYOUT.constants.unit,
      // MAXIM uvadza v LOT datum (rovnaky ako MHD); ak etiketa nesie sarzu (AI 10), pouzije sa ta.
      lot: p.sarza ? String(p.sarza) : mhd,
      mhd,
    };
  });
  return {
    cislo: String(vydajka.cislo_lieferschein),
    datum: datum || localDate(vydajka.dokoncena_at || vydajka.created_at),
    prijemce: prijemce.slice(0, 3),
    rows,
    sumAmount: rows.reduce((s, r) => s + (r.amount || 0), 0),
    palet: rows.length,
    upozornenia: {
      bezProduktu: Array.from(bezProduktu),
      bezMnozstva: rows.filter((r) => r.amount == null).length,
    },
  };
}

export function nveListFileName(cislo) {
  return String(cislo || "NVE").replace(/[\\/:*?"<>|]+/g, "_").trim() + ".xlsx";
}

function applyStyle(cell, st) {
  const font = { name: st.font.name, size: st.font.size };
  if (st.font.bold) font.bold = true;
  if (st.font.italic) font.italic = true;
  cell.font = font;
  cell.numFmt = st.numFmt;
  const alignment = { vertical: st.vAlign };
  if (st.hAlign !== "general") alignment.horizontal = st.hAlign;
  cell.alignment = alignment;
  const border = {};
  for (const side of ["top", "bottom", "left", "right"]) if (st.border[side]) border[side] = { style: st.border[side] };
  cell.border = border;
}

const COLS = ["A", "B", "C", "D", "E", "F", "G", "H"];

// Jeden datovy riadok moze byt naraz prvy aj posledny - oramovanie sa zlucuje.
function roleStyle(roles, col) {
  const base = NVE_LAYOUT.roles[roles[0]][col];
  if (roles.length === 1) return base;
  const border = { ...base.border };
  for (const r of roles.slice(1)) {
    const b = NVE_LAYOUT.roles[r][col].border;
    for (const side of Object.keys(b)) if (b[side]) border[side] = b[side];
  }
  return { ...base, border };
}

function styleRow(ws, rowNum, roles, values = {}, cols = COLS) {
  const h = NVE_LAYOUT.rowHeights[roles[0]];
  if (h) ws.getRow(rowNum).height = h;
  for (const col of cols) {
    const cell = ws.getCell(col + rowNum);
    // Skryte bunky zlucenej oblasti nestylovat - ExcelJS by styl zapisal do
    // hlavnej bunky (prepisal by napr. textovy format A2).
    if (cell.isMerged && cell.master !== cell) continue;
    if (values[col] !== undefined && values[col] !== null) cell.value = values[col];
    applyStyle(cell, roleStyle(roles, col));
  }
}

// ExcelJS workbook v rozlozeni MAXIM NVE listu (harok "NVE List").
export async function buildNveListWorkbook(nve) {
  const ExcelJS = (await import("exceljs")).default;
  const L = NVE_LAYOUT;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(L.sheetName);
  ws.columns = COLS.map((c) => ({ key: c, width: L.columnWidths[c] }));

  // 1: nadpis + datum, 2-4: prijemca (zlucene A:E). Zlucit PRED formatovanim -
  // ExcelJS pri zluceni kopiruje styl prvej bunky do ostatnych, MAXIM ich ma inak.
  // MAXIM ma v riadkoch 1-4 bunky len v A:E (+ datum v H1), F-H neexistuju.
  // Najprv naformatovat A1-A4, potom zlucit: ExcelJS pri zluceni skopiruje
  // styl prvej bunky do skrytych B:E (pismo/zarovnanie ako MAXIM). Skryte
  // bunky potom uz nestylovat - zapis by sa preniesol do prvej bunky.
  styleRow(ws, 1, ["title"], { A: L.constants.titlePrefix + nve.cislo }, ["A"]);
  applyStyle(ws.getCell("A1"), L.titleCells.A1);
  ["address1", "address2", "address3"].forEach((role, i) => styleRow(ws, 2 + i, [role], { A: nve.prijemce[i] || "" }, ["A"]));
  for (const m of L.merges) {
    ws.mergeCells(m);
    // Skryte bunky zdielaju objekt stylu s prvou bunkou; MAXIM ich ma
    // s formatom "General" - priradit im NOVY objekt (nie menit zdielany).
    const [from, to] = m.split(":");
    const row = from.replace(/\D/g, "");
    const master = ws.getCell(from);
    for (let c = COLS.indexOf(from[0]) + 1; c <= COLS.indexOf(to[0]); c++) {
      ws.getCell(COLS[c] + row).style = { ...JSON.parse(JSON.stringify(master.style)), numFmt: "General" };
    }
  }
  ws.getCell("H1").value = L.constants.datePrefix + nve.datum;
  applyStyle(ws.getCell("H1"), L.titleCells.H1);

  // hlavicka stlpcov (po prazdnom riadku)
  const headerRow = 5 + L.emptyRowBeforeHeader;
  const labels = {};
  COLS.forEach((c, i) => (labels[c] = L.headerLabels[i]));
  styleRow(ws, headerRow, ["header"], labels);

  // palety - SSCC, cisla a datumy ako TEXT (bez straty uvodnych nul)
  const n = nve.rows.length;
  nve.rows.forEach((r, i) => {
    const roles = n === 1 ? ["dataFirst", "dataLast"] : i === 0 ? ["dataFirst"] : i === n - 1 ? ["dataLast"] : ["dataMiddle"];
    styleRow(ws, headerRow + 1 + i, roles, { A: r.poradie, B: r.number, C: r.product, D: r.sscc, E: r.amount, F: r.unit, G: r.lot, H: r.mhd });
  });

  // sucet mnozstva (v MAXIM vzorec SUM nad datovymi riadkami), oddelovaci
  // riadok, TOTAL palet (konstanta)
  const sumRow = headerRow + 1 + n;
  const sum = n ? { formula: `SUM(E${headerRow + 1}:E${headerRow + n})`, result: nve.sumAmount } : 0;
  styleRow(ws, sumRow, ["sum"], { E: sum });
  styleRow(ws, sumRow + 1, ["spacer"]);
  styleRow(ws, sumRow + 2, ["total"], { D: L.constants.totalLabel, E: nve.palet, F: L.constants.totalUnit });
  return wb;
}

// Stiahnutie NVE listu v prehliadaci.
export async function downloadNveList(nve) {
  const wb = await buildNveListWorkbook(nve);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nveListFileName(nve.cislo);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
