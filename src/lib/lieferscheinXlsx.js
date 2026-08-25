// Generuje skutocny .xlsx subor pre Lieferschein/dodaci list, presne podla
// realnej sablony zakaznika (GERWISCH.xlsx - Stenger Waffeln GmbH) - rovnake
// bunky, popisky (vratane preklepu "AKRTIKEL LIEF.NUM."), zluceni aj poradie
// riadkov ako v origináli. Kazda polozka objednavky zabera 4 riadky (nazov,
// inhlt, EAN, RSPO), max MAX_ITEMS poloziek sa zmesti do sablony.

const MAX_ITEMS = 6;
const ITEMS_START_ROW = 16; // 1-indexovany Excel riadok prvej polozky

function addr(col, row) {
  return col + row;
}

function setCell(ws, a, value) {
  if (value === undefined || value === null || value === "") return;
  ws[a] = { t: typeof value === "number" ? "n" : "s", v: value };
}

function addressLines(text, max) {
  const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max - 1), lines.slice(max - 1).join(", ")];
}

export async function buildLieferscheinXlsx({ order, company, customer, carrierName, transportPrice, products }) {
  const XLSX = await import("xlsx");
  const ws = {};
  const merges = [];

  function merge(a1, a2) {
    merges.push({ s: XLSX.utils.decode_cell(a1), e: XLSX.utils.decode_cell(a2) });
  }

  // hlavicka
  setCell(ws, "G1", order.cisloObjednavkyDopravy);
  if (transportPrice && transportPrice.matched) setCell(ws, "I1", transportPrice.total);
  setCell(ws, "A2", company.nazov);
  setCell(ws, "D2", "LIEFERSCHEIN ");
  merge("D2", "F2");
  setCell(ws, "G2", "Nr:");
  setCell(ws, "H2", order.cisloDodaciehoListu);
  merge("H2", "I2");

  setCell(ws, "D3", "Lieferadresse/adresa dodání");
  merge("D3", "F3");
  setCell(ws, "D4", order.adresaDodaniaNazov);
  const dodaciaAdresa = addressLines(order.adresaDodania, 2);
  setCell(ws, "D5", dodaciaAdresa[0]);
  setCell(ws, "D6", dodaciaAdresa[1]);

  setCell(ws, "A6", "LIEFERANT:");
  setCell(ws, "G6", "ABNEHMER/ODBĚRATEL");
  setCell(ws, "A7", company.nazov);
  setCell(ws, "G7", customer ? customer.nazov : (order.zakaznik || ""));
  const dodavatelAdresa = addressLines(company.adresa, 2);
  setCell(ws, "A8", dodavatelAdresa[0]);
  setCell(ws, "A9", dodavatelAdresa[1]);
  const odberatelAdresa = addressLines(customer ? customer.adresa : "", 2);
  setCell(ws, "G8", odberatelAdresa[0]);
  setCell(ws, "G9", odberatelAdresa[1]);
  setCell(ws, "A10", "IČO:" + (company.ico || ""));
  merge("A10", "B10");
  setCell(ws, "G10", customer && customer.dic ? "Ust.-Id Nr." + customer.dic : "");
  setCell(ws, "A11", "DIČ:" + (company.dic || ""));
  merge("A11", "B11");

  setCell(ws, "A13", "Lieferungstag:");
  merge("A13", "B13");
  setCell(ws, "C13", order.datumDodania);
  setCell(ws, "F13", "Bestellung:");
  merge("F13", "G13");
  setCell(ws, "H13", order.cisloObjednavkyZakaznika);
  merge("H13", "I13");

  setCell(ws, "A15", "Palet");
  setCell(ws, "B15", "Karton");
  setCell(ws, "C15", "BEZEICHNUNG");
  merge("C15", "F15");
  setCell(ws, "G15", "STK");
  setCell(ws, "H15", "AKRTIKEL LIEF.NUM.");

  // polozky - 4 riadky na kazdu (nazov, inhlt, EAN, RSPO)
  const items = ((order.polozky && order.polozky.length > 0) ? order.polozky : [{ popis: order.popisTovaru || "", artikel: "", palet: order.pocetPaliet || "", karton: order.pocetKartonov || "" }])
    .slice(0, MAX_ITEMS)
    .map((it) => {
      const katalogItem = customer && customer.katalog ? customer.katalog.find((k) => k.artikel && k.artikel === it.artikel) : null;
      const produkt = katalogItem && katalogItem.produktId ? (products || []).find((p) => p.id === katalogItem.produktId) : null;
      return { ...it, produkt };
    });

  items.forEach((it, i) => {
    const r0 = ITEMS_START_ROW + i * 4;
    const r3 = r0 + 3;
    setCell(ws, addr("A", r0), it.palet);
    merge(addr("A", r0), addr("A", r3));
    setCell(ws, addr("B", r0), it.karton);
    merge(addr("B", r0), addr("B", r3));
    setCell(ws, addr("C", r0), it.popis);
    if (it.produkt && it.produkt.inhlt) setCell(ws, addr("C", r0 + 1), it.produkt.inhlt);
    const eanLine = it.produkt ? [it.produkt.eanKarton && `EAN karton: ${it.produkt.eanKarton}`, it.produkt.eanUnit && `EAN kus: ${it.produkt.eanUnit}`].filter(Boolean).join("   ") : "";
    if (eanLine) setCell(ws, addr("C", r0 + 2), eanLine);
    if (it.produkt && it.produkt.rspo) setCell(ws, addr("C", r0 + 3), "BVC-RSPO-CZ009581");
    merge(addr("G", r0), addr("G", r3));
    setCell(ws, addr("H", r0), it.artikel);
    merge(addr("H", r0), addr("I", r3));
  });

  const itemsUsed = items.length || 1;
  const lastRow = ITEMS_START_ROW + itemsUsed * 4 - 1;
  const summaryRow = lastRow + 2;
  const sumPaliet = items.reduce((s, it) => s + (parseFloat(it.palet) || 0), 0);
  const totalPaliet = sumPaliet > 0 ? sumPaliet : (order.pocetPaliet || 0);
  setCell(ws, addr("A", summaryRow), order.pocetPaletovychMiest || 0);
  setCell(ws, addr("B", summaryRow), "Doppelstockpal. =");
  setCell(ws, addr("D", summaryRow), totalPaliet);
  setCell(ws, addr("E", summaryRow), "europaletten =");
  setCell(ws, addr("G", summaryRow), order.pocetPaletovychMiest || 0);
  setCell(ws, addr("H", summaryRow), "stallplätze");

  const footerRow = summaryRow + 3;
  setCell(ws, addr("A", footerRow), "vystavil/ausgestellt von:");
  merge(addr("A", footerRow), addr("C", footerRow));
  setCell(ws, addr("D", footerRow), "TRANSPORT: " + (carrierName || ""));
  setCell(ws, addr("G", footerRow), "odběratel / abnehmer:");
  merge(addr("G", footerRow), addr("I", footerRow));
  setCell(ws, addr("A", footerRow + 1), company.email);
  merge(addr("A", footerRow + 1), addr("C", footerRow + 1));
  setCell(ws, addr("D", footerRow + 1), "NUMBER TRUCK:");
  setCell(ws, addr("D", footerRow + 2), "EUROPALETTEN");
  setCell(ws, addr("D", footerRow + 3), "ACCEPTED:");
  setCell(ws, addr("D", footerRow + 4), "RELEASSED:");
  setCell(ws, addr("D", footerRow + 5), "DEBT:");

  ws["!merges"] = merges;
  ws["!ref"] = `A1:I${footerRow + 5}`;
  ws["!cols"] = [{ wch: 8 }, { wch: 8 }, { wch: 24 }, { wch: 10 }, { wch: 10 }, { wch: 6 }, { wch: 14 }, { wch: 16 }, { wch: 8 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "List1");
  const fname = `Lieferschein_${String(order.cisloDodaciehoListu || order.id).replace(/\//g, "-")}.xlsx`;
  XLSX.writeFile(wb, fname);
}
