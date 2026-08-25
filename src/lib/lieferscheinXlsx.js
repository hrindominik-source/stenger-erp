// Generuje skutocny .xlsx subor pre Lieferschein/dodaci list, presne podla
// realnej sablony zakaznika (GERWISCH.xlsx - Stenger Waffeln GmbH) - rovnake
// bunky, zluceni, orámování aj popisky (vratane preklepu "AKRTIKEL LIEF.NUM.")
// ako v origináli. Kazda polozka objednavky zabera 4 riadky (nazov, inhlt,
// EAN, RSPO), max MAX_ITEMS poloziek sa zmesti do sablony.
// Pouziva exceljs (nie xlsx/SheetJS) - SheetJS free verzia nevie zapisovat
// styly bunky (oramovanie, tucne pismo) do .xlsx suboru, exceljs ano.

const MAX_ITEMS = 6;
const ITEMS_START_ROW = 16;
const THIN = { style: "thin" };

function col(letter) {
  return letter.charCodeAt(0) - 64;
}

function addressLines(text, max) {
  const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max - 1), lines.slice(max - 1).join(", ")];
}

// Najde Produkt pre polozku objednavky - najprv skusi prepojenie cez katalog
// zakaznika, a ak sa nenajde, priamo porovna polozka.artikel s cislom
// artiklu na Produkte (nase SNC aj nemecke/Sage SW cislo).
function findProduktForItem(it, customer, products) {
  if (!it.artikel) return null;
  const katalogItem = customer && customer.katalog ? customer.katalog.find((k) => k.artikel && k.artikel === it.artikel) : null;
  if (katalogItem && katalogItem.produktId) {
    const p = (products || []).find((p) => p.id === katalogItem.produktId);
    if (p) return p;
  }
  return (products || []).find((p) => p.cisloArtiklu === it.artikel || p.cisloArtikluSW === it.artikel) || null;
}

// Automaticky navrhne pocet paliet z poctu kartonov + "Kartonů na paletě" u
// prepojeneho Produktu (zaokruhlene nahor).
function computePaletFromKarton(karton, artikel, customer, products) {
  const k = parseFloat(String(karton || "").replace(",", "."));
  if (!k || k <= 0) return "";
  const produkt = findProduktForItem({ artikel }, customer, products);
  const perPallet = produkt && parseFloat(produkt.kartonovNaPalete);
  if (!perPallet) return "";
  return String(Math.ceil(k / perPallet));
}

// Pocet kusov (STK) = pocet kartonov * "Ks v kartonu" u prepojeneho Produktu.
function computeKusyFromKarton(karton, produkt) {
  const k = parseFloat(String(karton || "").replace(",", "."));
  const perKarton = produkt && parseFloat(produkt.ksVKartone);
  if (!k || !perKarton) return null;
  return Math.round(k * perKarton);
}

export async function buildLieferscheinXlsx({ order, company, customer, carrierName, transportPrice, products, mesto }) {
  const ExcelJSModule = await import("exceljs");
  const ExcelJS = ExcelJSModule.default || ExcelJSModule;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("List1");

  ws.getColumn(1).width = 9.4;
  ws.getColumn(2).width = 7.4;
  ws.getColumn(3).width = 10.1;
  ws.getColumn(5).width = 8;
  ws.getColumn(6).width = 10.6;
  ws.getColumn(7).width = 12.6;

  function set(a, value, opts = {}) {
    const cell = ws.getCell(a);
    if (value !== undefined && value !== null && value !== "") cell.value = value;
    if (opts.bold || opts.size) cell.font = { bold: !!opts.bold, size: opts.size || 11 };
    if (opts.align) cell.alignment = opts.align;
    return cell;
  }
  function merge(a1, a2) {
    ws.mergeCells(`${a1}:${a2}`);
  }
  // pridá thin border na dany okraj vsetkych buniek v obdlzniku a1:a2 (top/bottom/left/right)
  function borderRect(colFrom, rowFrom, colTo, rowTo, sides) {
    for (let r = rowFrom; r <= rowTo; r++) {
      for (let c = colFrom; c <= colTo; c++) {
        const cell = ws.getCell(r, c);
        const b = { ...(cell.border || {}) };
        if (sides.top && r === rowFrom) b.top = THIN;
        if (sides.bottom && r === rowTo) b.bottom = THIN;
        if (sides.left && c === colFrom) b.left = THIN;
        if (sides.right && c === colTo) b.right = THIN;
        cell.border = b;
      }
    }
  }

  // hlavicka
  set("G1", order.cisloObjednavkyDopravy, { size: 10 });
  if (transportPrice && transportPrice.matched) set("I1", transportPrice.total);
  set("A2", company.nazov, { bold: true, size: 14 });
  set("D2", "LIEFERSCHEIN ", { bold: true, size: 18 });
  merge("D2", "F2");
  set("G2", "Nr:", { bold: true });
  set("H2", order.cisloDodaciehoListu, { bold: true });
  merge("H2", "I2");

  set("D3", "Lieferadresse/adresa dodání", { size: 10 });
  merge("D3", "F3");
  set("D4", order.adresaDodaniaNazov, { bold: true, size: 10 });
  const dodaciaAdresa = addressLines(order.adresaDodania, 2);
  set("D5", dodaciaAdresa[0], { bold: true, size: 10 });
  set("D6", dodaciaAdresa[1], { bold: true, size: 10 });

  set("A6", "LIEFERANT:", { size: 12 });
  set("G6", "ABNEHMER/ODBĚRATEL");
  set("A7", company.nazov, { bold: true, size: 12 });
  set("G7", customer ? customer.nazov : (order.zakaznik || ""), { bold: true });
  const dodavatelAdresa = addressLines(company.adresa, 2);
  set("A8", dodavatelAdresa[0], { size: 12 });
  set("A9", dodavatelAdresa[1], { size: 12 });
  const odberatelAdresa = addressLines(customer ? customer.adresa : "", 2);
  set("G8", odberatelAdresa[0]);
  set("G9", odberatelAdresa[1]);
  set("A10", "IČO:" + (company.ico || ""), { size: 12 });
  merge("A10", "B10");
  set("G10", customer && customer.dic ? "Ust.-Id Nr." + customer.dic : "");
  set("A11", "DIČ:" + (company.dic || ""), { size: 12 });
  merge("A11", "B11");
  borderRect(col("A"), 6, col("I"), 11, { bottom: true }); // zavrie LIEFERANT/ABNEHMER blok

  set("A13", "Lieferungstag:", { bold: true });
  merge("A13", "B13");
  set("C13", order.datumDodania, { bold: true });
  set("F13", "Bestellung:", { bold: true });
  merge("F13", "G13");
  set("H13", order.cisloObjednavkyZakaznika, { bold: true });
  merge("H13", "I13");
  borderRect(col("A"), 13, col("I"), 14, { top: true, bottom: true });

  set("A15", "Palet", { bold: true });
  set("B15", "Karton", { bold: true });
  set("C15", "BEZEICHNUNG", { bold: true });
  merge("C15", "F15");
  set("G15", "STK", { bold: true });
  set("H15", "AKRTIKEL LIEF.NUM.", { bold: true });
  borderRect(col("A"), 15, col("I"), 15, { top: true, bottom: true });
  [col("A"), col("B"), col("F"), col("G"), col("H")].forEach((c) => {
    ws.getCell(15, c).border = { ...ws.getCell(15, c).border, right: THIN };
  });

  // polozky - 4 riadky na kazdu (nazov, inhlt, EAN, RSPO)
  const items = ((order.polozky && order.polozky.length > 0) ? order.polozky : [{ popis: order.popisTovaru || "", artikel: "", palet: order.pocetPaliet || "", karton: order.pocetKartonov || "" }])
    .slice(0, MAX_ITEMS)
    .map((it) => {
      const produkt = findProduktForItem(it, customer, products);
      const paletEffective = it.palet || computePaletFromKarton(it.karton, it.artikel, customer, products) || "";
      return { ...it, produkt, paletEffective };
    });

  items.forEach((it, i) => {
    const r0 = ITEMS_START_ROW + i * 4;
    const r3 = r0 + 3;
    set(`A${r0}`, it.paletEffective, { bold: true });
    merge(`A${r0}`, `A${r3}`);
    set(`B${r0}`, it.karton, { bold: true });
    merge(`B${r0}`, `B${r3}`);
    set(`C${r0}`, it.popis, { bold: true });
    if (it.produkt && it.produkt.inhlt) set(`C${r0 + 1}`, it.produkt.inhlt);
    const eanLine = it.produkt ? [it.produkt.eanKarton && `EAN karton: ${it.produkt.eanKarton}`, it.produkt.eanUnit && `EAN kus: ${it.produkt.eanUnit}`].filter(Boolean).join("   ") : "";
    if (eanLine) set(`C${r0 + 2}`, eanLine, { size: 9 });
    if (it.produkt && it.produkt.rspo) set(`C${r0 + 3}`, "BVC-RSPO-CZ009581");
    set(`G${r0}`, computeKusyFromKarton(it.karton, it.produkt), { bold: true });
    merge(`G${r0}`, `G${r3}`);
    set(`H${r0}`, it.artikel, { bold: true });
    merge(`H${r0}`, `I${r3}`);
    borderRect(col("A"), r0, col("I"), r3, { top: true, bottom: true, left: true, right: true });
    [col("A"), col("B"), col("F"), col("G"), col("H")].forEach((c) => {
      for (let r = r0; r <= r3; r++) ws.getCell(r, c).border = { ...ws.getCell(r, c).border, right: THIN };
    });
  });

  const itemsUsed = items.length || 1;
  const lastRow = ITEMS_START_ROW + itemsUsed * 4 - 1;
  // vonkajsi ramik dokumentu (od hlavicky po posledny riadok pred suctom) - lavy/pravy okraj
  borderRect(col("A"), 2, col("I"), lastRow, { left: true, right: true });

  const summaryRow = lastRow + 2;
  const sumPaliet = items.reduce((s, it) => s + (parseFloat(it.paletEffective) || 0), 0);
  const totalPaliet = sumPaliet > 0 ? sumPaliet : (order.pocetPaliet || 0);
  set(`A${summaryRow}`, order.pocetPaletovychMiest || 0, { bold: true, size: 12 });
  set(`B${summaryRow}`, "Doppelstockpal. =", { bold: true, size: 12 });
  set(`D${summaryRow}`, totalPaliet, { bold: true, size: 12 });
  set(`E${summaryRow}`, "europaletten =", { bold: true, size: 12 });
  set(`G${summaryRow}`, order.pocetPaletovychMiest || 0, { bold: true, size: 12 });
  set(`H${summaryRow}`, "stallplätze", { bold: true, size: 12 });

  const footerRow = summaryRow + 3;
  borderRect(col("A"), summaryRow, col("I"), footerRow - 1, { left: true, right: true, bottom: true });

  set(`A${footerRow}`, "vystavil/ausgestellt von:", { bold: true });
  merge(`A${footerRow}`, `C${footerRow}`);
  set(`D${footerRow}`, "TRANSPORT: " + (carrierName || ""));
  set(`G${footerRow}`, "odběratel / abnehmer:", { bold: true });
  merge(`G${footerRow}`, `I${footerRow}`);
  set(`A${footerRow + 1}`, company.email);
  merge(`A${footerRow + 1}`, `C${footerRow + 1}`);
  set(`D${footerRow + 1}`, "NUMBER TRUCK:");
  set(`D${footerRow + 2}`, "EUROPALETTEN");
  set(`D${footerRow + 3}`, "ACCEPTED:");
  set(`D${footerRow + 4}`, "RELEASSED:");
  set(`D${footerRow + 5}`, "DEBT:");
  borderRect(col("A"), footerRow, col("C"), footerRow + 5, { top: true, bottom: true, left: true, right: true });
  borderRect(col("G"), footerRow, col("I"), footerRow + 5, { top: true, bottom: true, left: true, right: true });

  const mestoSuffix = mesto ? `_${mesto.replace(/[^\p{L}\p{N}]+/gu, "_")}` : "";
  const fname = `Lieferschein_${String(order.cisloDodaciehoListu || order.id).replace(/\//g, "-")}${mestoSuffix}.xlsx`;
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
