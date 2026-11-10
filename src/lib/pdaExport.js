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
  const bezMedzier = (s) => s.toLowerCase().replace(/\s+/g, "");
  if (!gramaz || bezMedzier(znacka).includes(bezMedzier(gramaz))) return znacka;
  return `${znacka} ${gramaz}`.trim();
}

function localDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

// "Landsberg am Lech" -> "LANDSBERG", "Bingen am Rhein" -> "BINGEN"
export function kratkeMesto(mesto) {
  return String(mesto || "").replace(/\s+(am|an|im|in|bei|ob|unter|vor|a\.|i\.|\(|\/).*$/i, "").trim().toUpperCase();
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
      // nase cislo artikla (SNC) a cislo Stenger Waffeln (Sage 100) - pre NVE list so stlpcom Sage
      snc: produkt ? String(produkt.cisloArtiklu || "") : "",
      sage: produkt ? String(produkt.cisloArtikluSW || "") : "",
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
    // mesto dodania z objednavky vydajky - za cislo v nadpise aj v nazve suboru
    mesto: kratkeMesto(vydajka.data && vydajka.data.objednavka && vydajka.data.objednavka.mesto),
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

export function nveListFileName(cislo, mesto = "") {
  return [String(cislo || "NVE"), mesto].filter(Boolean).join(" ").replace(/[\\/:*?"<>|]+/g, "_").trim() + ".xlsx";
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
const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];

// Logicke stlpce = stlpce MAXIM (A-H); "S" = navyse stlpec Sage za B
// (styl ako B). Do Excelu ide pismeno podla poradia v lay.cols.
function layoutStlpcov(sage) {
  const cols = sage ? ["A", "B", "S", "C", "D", "E", "F", "G", "H"] : COLS;
  return { cols, out: (c) => LETTERS[cols.indexOf(c)] };
}

// Jeden datovy riadok moze byt naraz prvy aj posledny - oramovanie sa zlucuje.
function roleStyle(roles, col) {
  if (col === "S") col = "B";
  const base = NVE_LAYOUT.roles[roles[0]][col];
  if (roles.length === 1) return base;
  const border = { ...base.border };
  for (const r of roles.slice(1)) {
    const b = NVE_LAYOUT.roles[r][col].border;
    for (const side of Object.keys(b)) if (b[side]) border[side] = b[side];
  }
  return { ...base, border };
}

function styleRow(ws, rowNum, roles, values = {}, cols = COLS, lay = layoutStlpcov(false)) {
  const h = NVE_LAYOUT.rowHeights[roles[0]];
  if (h) ws.getRow(rowNum).height = h;
  for (const col of cols) {
    const cell = ws.getCell(lay.out(col) + rowNum);
    // Skryte bunky zlucenej oblasti nestylovat - ExcelJS by styl zapisal do
    // hlavnej bunky (prepisal by napr. textovy format A2).
    if (cell.isMerged && cell.master !== cell) continue;
    if (values[col] !== undefined && values[col] !== null) cell.value = values[col];
    applyStyle(cell, roleStyle(roles, col));
  }
}

// ExcelJS workbook v rozlozeni MAXIM NVE listu (harok "NVE List").
// sage: true = navyse stlpec "Sage" (cislo Stenger Waffeln) za nasim cislom artikla.
export async function buildNveListWorkbook(nve, { sage = false } = {}) {
  const ExcelJS = (await import("exceljs")).default;
  const L = NVE_LAYOUT;
  const lay = layoutStlpcov(sage);
  const o = lay.out;
  const row = (r, roles, values = {}, cols = lay.cols) => styleRow(ws, r, roles, values, cols, lay);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(L.sheetName);
  ws.columns = lay.cols.map((c) => ({ key: o(c), width: L.columnWidths[c === "S" ? "B" : c] }));

  // 1: nadpis + datum, 2-4: prijemca (zlucene A:E). Zlucit PRED formatovanim -
  // ExcelJS pri zluceni kopiruje styl prvej bunky do ostatnych, MAXIM ich ma inak.
  // MAXIM ma v riadkoch 1-4 bunky len v A:E (+ datum v H1), F-H neexistuju.
  // Najprv naformatovat A1-A4, potom zlucit: ExcelJS pri zluceni skopiruje
  // styl prvej bunky do skrytych B:E (pismo/zarovnanie ako MAXIM). Skryte
  // bunky potom uz nestylovat - zapis by sa preniesol do prvej bunky.
  row(1, ["title"], { A: L.constants.titlePrefix + nve.cislo + (nve.mesto ? " " + nve.mesto : "") }, ["A"]);
  applyStyle(ws.getCell("A1"), L.titleCells.A1);
  ["address1", "address2", "address3"].forEach((role, i) => row(2 + i, [role], { A: nve.prijemce[i] || "" }, ["A"]));
  for (const m0 of L.merges) {
    // zlucenie A:E (MAXIM) sa pri stlpci Sage posunie na A:F
    const m = m0.replace(/([A-H])(\d+)$/, (_, c, r) => o(c) + r);
    ws.mergeCells(m);
    // Skryte bunky zdielaju objekt stylu s prvou bunkou; MAXIM ich ma
    // s formatom "General" - priradit im NOVY objekt (nie menit zdielany).
    const [from, to] = m.split(":");
    const rowNum = from.replace(/\D/g, "");
    const master = ws.getCell(from);
    for (let c = LETTERS.indexOf(from[0]) + 1; c <= LETTERS.indexOf(to[0]); c++) {
      ws.getCell(LETTERS[c] + rowNum).style = { ...JSON.parse(JSON.stringify(master.style)), numFmt: "General" };
    }
  }
  ws.getCell(o("H") + "1").value = L.constants.datePrefix + nve.datum;
  applyStyle(ws.getCell(o("H") + "1"), L.titleCells.H1);

  // hlavicka stlpcov (po prazdnom riadku)
  const headerRow = 5 + L.emptyRowBeforeHeader;
  const labels = {};
  COLS.forEach((c, i) => (labels[c] = L.headerLabels[i]));
  if (sage) labels.S = "Sage";
  row(headerRow, ["header"], labels);

  // palety - SSCC, cisla a datumy ako TEXT (bez straty uvodnych nul)
  const n = nve.rows.length;
  nve.rows.forEach((r, i) => {
    const roles = n === 1 ? ["dataFirst", "dataLast"] : i === 0 ? ["dataFirst"] : i === n - 1 ? ["dataLast"] : ["dataMiddle"];
    const cisla = sage ? { B: r.snc, S: r.sage } : { B: r.number };
    row(headerRow + 1 + i, roles, { A: r.poradie, ...cisla, C: r.product, D: r.sscc, E: r.amount, F: r.unit, G: r.lot, H: r.mhd });
  });

  // sucet mnozstva (v MAXIM vzorec SUM nad datovymi riadkami), oddelovaci
  // riadok, TOTAL palet (konstanta)
  const sumRow = headerRow + 1 + n;
  const sum = n ? { formula: `SUM(${o("E")}${headerRow + 1}:${o("E")}${headerRow + n})`, result: nve.sumAmount } : 0;
  row(sumRow, ["sum"], { E: sum });
  row(sumRow + 1, ["spacer"]);
  row(sumRow + 2, ["total"], { D: L.constants.totalLabel, E: nve.palet, F: L.constants.totalUnit });

  // Sirky stlpcov podla obsahu (hlavicka + palety), aby text nebol orezany
  // oramovanim susednej bunky. MAXIM sirky ostavaju ako minimum.
  if (sage) {
    lay.cols.forEach((c, i) => {
      let max = 0;
      for (let r = headerRow; r <= sumRow + 2; r++) {
        const v = ws.getCell(LETTERS[i] + r).value;
        const t = v && typeof v === "object" ? String(v.result ?? "") : v == null ? "" : String(v);
        max = Math.max(max, t.length);
      }
      const col = ws.getColumn(i + 1);
      col.width = Math.max(col.width || 0, Math.ceil(max * 1.15 + 2));
    });
  }
  return wb;
}

// Stiahnutie NVE listu v prehliadaci.
export async function downloadNveList(nve) {
  const wb = await buildNveListWorkbook(nve, { sage: true });
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nveListFileName(nve.cislo, nve.mesto);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
