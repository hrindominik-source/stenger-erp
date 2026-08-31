// Generuje skutocny .xlsx subor pre Lieferschein/dodaci list, presne podla
// realnej sablony zakaznika (GERWISCH.xlsx - Stenger Waffeln GmbH) - rovnake
// bunky, zluceni, orámování aj popisky (vratane preklepu "AKRTIKEL LIEF.NUM.")
// ako v origináli. Kazda polozka objednavky zabera 4 riadky (nazov, inhlt,
// EAN, RSPO), max MAX_ITEMS poloziek sa zmesti do sablony.
// Pouziva exceljs (nie xlsx/SheetJS) - SheetJS free verzia nevie zapisovat
// styly bunky (oramovanie, tucne pismo) do .xlsx suboru, exceljs ano.

import { formatPriceNumber } from "./pricelist.js";

const MAX_ITEMS = 6;
const ITEMS_START_ROW = 16;
const THIN = { style: "thin" };
const MEDIUM = { style: "medium", color: { argb: "FF000000" } };

function col(letter) {
  return letter.charCodeAt(0) - 64;
}

// Excelove "shrinkToFit" a "wrapText" su vzajomne nezlucitelne vlastnosti
// jednej bunky (nemozno mat oboje naraz). Pre skutocne viacriadkove polia
// (adresy, popis polozky) preto namiesto shrinkToFit zmensujeme font podla
// dlzky textu, aby sa vosiel do pevnej vysky riadkov sablony bez orezania.
function fitFontSize(text, baseSize, minSize, threshold) {
  const len = String(text || "").length;
  if (len <= threshold) return baseSize;
  return Math.max(minSize, Math.round(baseSize * (threshold / len)));
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

  // presne rovnake sirky stlpcov a nastavenie tlace ako v realnej sablone
  // zakaznika (GERWISCH.xlsx), aby sa tlac/format A4 zhodovali
  ws.getColumn(1).width = 9.453125;
  ws.getColumn(2).width = 7.453125;
  ws.getColumn(3).width = 10.1796875;
  ws.getColumn(5).width = 8;
  ws.getColumn(6).width = 10.54296875;
  ws.getColumn(7).width = 12.54296875;
  ws.pageSetup = { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 1, scale: 100, margins: { left: 0.7, right: 0.7, top: 0.787401575, bottom: 0.787401575, header: 0.3, footer: 0.3 } };
  ws.getRow(1).height = 15;
  ws.getRow(2).height = 24;
  ws.getRow(4).height = 26;
  ws.getRow(5).height = 16;
  ws.getRow(6).height = 16;
  ws.getRow(7).height = 16;
  ws.getRow(8).height = 32;
  ws.getRow(9).height = 10;
  ws.getRow(10).height = 16;
  ws.getRow(11).height = 16;
  ws.getRow(13).height = 17;

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
  // pridá border (default thin, volitelne medium) na dany okraj vsetkych buniek v obdlzniku a1:a2
  function borderRect(colFrom, rowFrom, colTo, rowTo, sides, style = THIN) {
    for (let r = rowFrom; r <= rowTo; r++) {
      for (let c = colFrom; c <= colTo; c++) {
        const cell = ws.getCell(r, c);
        const b = { ...(cell.border || {}) };
        if (sides.top && r === rowFrom) b.top = style;
        if (sides.bottom && r === rowTo) b.bottom = style;
        if (sides.left && c === colFrom) b.left = style;
        if (sides.right && c === colTo) b.right = style;
        cell.border = b;
      }
    }
  }

  // hlavicka
  set("G1", order.cisloObjednavkyDopravy, { size: 10 });
  if (transportPrice && transportPrice.matched) set("I1", formatPriceNumber(transportPrice.total));
  set("A2", company.nazov, { bold: true, size: 14 });
  set("D2", "LIEFERSCHEIN ", { bold: true, size: 18 });
  merge("D2", "F2");
  set("G2", "Nr:", { bold: true });
  set("H2", order.cisloDodaciehoListu, { bold: true });
  merge("H2", "I2");

  set("D3", "Lieferadresse/adresa dodání", { size: 10 });
  ws.getCell("D3").font = { name: "Arial", size: 10, color: { argb: "FF222222" } };
  merge("D3", "F3");
  set("D4", order.adresaDodaniaNazov, { bold: true, size: 10, align: { vertical: "middle", horizontal: "left", shrinkToFit: true } });
  merge("D4", "F4");
  const dodaciaAdresa = addressLines(order.adresaDodania, 2);
  set("D5", dodaciaAdresa[0], { bold: true, size: 10 });
  set("D6", dodaciaAdresa[1], { bold: true, size: 10 });

  set("A6", "LIEFERANT:", { size: 12 });
  set("G6", "ABNEHMER/ODBĚRATEL");
  set("A7", company.nazov, { bold: true, size: 12, align: { shrinkToFit: true } });
  set("G7", customer ? customer.nazov : (order.zakaznik || ""), { bold: true, align: { shrinkToFit: true } });
  // Zlucene AZ CEZ oba riadky (8 aj 9) do JEDNEJ bunky - predtym boli A8:C8 a
  // A9:C9 dva samostatne (aj ked susedne) zlucenia, takze zalomeny text mal v
  // Exceli reálne k dispozicii len vysku riadku 8 (32) a orezaval sa, hoci pod
  // nim bolo dalsich 10 bodov v riadku 9, ktore sa ako samostatna bunka nedali
  // vyuzit. Jeden zlucenim cez oba riadky text spravne vyuzije celu vysku.
  const dodavatelAdresa = addressLines(company.adresa, 2);
  const dodavatelAdresaText = dodavatelAdresa.join("\n");
  set("A8", dodavatelAdresaText, { size: fitFontSize(dodavatelAdresaText, 11, 8, 70), align: { vertical: "top", wrapText: true } });
  merge("A8", "C9");
  const odberatelAdresa = addressLines(customer ? customer.adresa : "", 2);
  const odberatelAdresaText = odberatelAdresa.join("\n");
  set("G8", odberatelAdresaText, { size: fitFontSize(odberatelAdresaText, 9, 7, 70), align: { vertical: "middle", wrapText: true } });
  merge("G8", "I9");
  set("A10", "IČO:" + (company.ico || ""), { size: 12 });
  merge("A10", "B10");
  set("G10", customer && customer.dic ? "Ust.-Id Nr." + customer.dic : "");
  set("A11", "DIČ:" + (company.dic || ""), { size: 12 });
  merge("A11", "B11");

  // medium ramik okolo celej hlavicky (adresa dodania + LIEFERANT/ABNEHMER blok), presne
  // podla realneho, rucne opraveneho vzoru - volanie je nizsie, AZ PO celodokumentovom
  // tenkom ramiku, inak by ho ten tenky prepisal
  function applyHeaderFrame() {
    borderRect(col("A"), 2, col("I"), 2, { top: true }, MEDIUM);
    borderRect(col("A"), 11, col("I"), 11, { bottom: true }, MEDIUM);
    borderRect(col("A"), 2, col("A"), 2, { left: true }, MEDIUM);
    borderRect(col("I"), 2, col("I"), 2, { right: true }, MEDIUM);
    borderRect(col("A"), 6, col("A"), 11, { left: true }, MEDIUM);
    borderRect(col("I"), 6, col("I"), 11, { right: true }, MEDIUM);
    borderRect(col("C"), 2, col("C"), 2, { right: true }, MEDIUM);
    borderRect(col("D"), 3, col("D"), 11, { left: true }, MEDIUM);
    borderRect(col("F"), 3, col("F"), 11, { right: true }, MEDIUM);
    borderRect(col("G"), 2, col("I"), 2, { top: true, bottom: true, left: true, right: true }, MEDIUM);
  }

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
  ws.getRow(15).height = 15;
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
    ws.getRow(r0).height = 30;
    ws.getRow(r0 + 1).height = 12;
    ws.getRow(r0 + 2).height = 12;
    ws.getRow(r0 + 3).height = 15;
    set(`A${r0}`, it.paletEffective, { bold: true });
    merge(`A${r0}`, `A${r3}`);
    set(`B${r0}`, it.karton, { bold: true });
    merge(`B${r0}`, `B${r3}`);
    // Nazov produktu (r0) a obsah baleni (r0+1) su zlucene do JEDNEJ bunky cez
    // oba riadky (rovnaky dovod ako pri adresach vyssie - inak by mal zalomeny
    // text k dispozicii len vysku jedneho riadku a orezaval sa). Tucne meno a
    // normalny obsah v tej istej bunke rieši rich text (dva rôzne fonty v
    // jednej hodnote bunky).
    merge(`C${r0}`, `F${r0 + 1}`);
    const popisCell = ws.getCell(`C${r0}`);
    const popisSize = fitFontSize(it.popis, 9, 7, 45);
    const inhltText = it.produkt && it.produkt.inhlt ? it.produkt.inhlt : "";
    if (inhltText) {
      const inhltSize = fitFontSize(inhltText, 9, 7, 45);
      popisCell.value = {
        richText: [
          { font: { bold: true, size: popisSize }, text: it.popis || "" },
          { font: { size: inhltSize }, text: "\n" + inhltText },
        ],
      };
    } else if (it.popis) {
      popisCell.value = it.popis;
      popisCell.font = { bold: true, size: popisSize };
    }
    popisCell.alignment = { vertical: "middle", wrapText: true };
    const eanLine = it.produkt ? [it.produkt.eanKarton && `EAN UK: ${it.produkt.eanKarton}`, it.produkt.eanUnit && `EAN VE: ${it.produkt.eanUnit}`].filter(Boolean).join("   ") : "";
    if (eanLine) set(`C${r0 + 2}`, eanLine, { size: 9 });
    if (it.produkt && it.produkt.rspo) set(`C${r0 + 3}`, "BVC-RSPO-CZ009581, PALMÖL MB");
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
  // az teraz medium ramik hlavicky - musi prepisat vyssi tenky ramik na svojich riadkoch
  applyHeaderFrame();

  const summaryRow = lastRow + 2;
  ws.getRow(summaryRow).height = 16;
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
