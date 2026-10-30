// PDF predavacieho protokolu (pracovny odev a obuv). Nacitava sa dynamicky.
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { PROTOKOL_NAZEV, PROTOKOL_PROHLASENI } from "./pracovniOdev.js";

const czDate = (iso) => {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return `${d}.${m}.${y}`;
};

function wrap(text, font, size, maxWidth) {
  const lines = []; let line = "";
  for (const word of String(text).split(/\s+/)) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) { lines.push(line); line = word; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

// PDF protokolu (A4). zamestnanec: { jmeno, osobniCislo, datumNarozeni, pozice }.
export async function buildProtokolPdf({ fontBytes, boldBytes, logoBytes }, { zamestnanec, datum, polozky, predal }) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const bold = boldBytes ? await pdf.embedFont(boldBytes, { subset: true }) : font;
  const page = pdf.addPage([595.28, 841.89]);
  const L = 56.7, R = 538.6;
  const black = rgb(0, 0, 0), grey = rgb(0.35, 0.35, 0.35);
  let y = 790;

  // Hlavicka firmy
  let textX = L;
  if (logoBytes) {
    const logo = await pdf.embedPng(logoBytes);
    const h = 26, w = (logo.width / logo.height) * h;
    page.drawImage(logo, { x: L, y: y - 18, width: w, height: h });
    textX = L + w + 10;
  }
  page.drawText("Stenger Czech s.r.o.", { x: textX, y: y, size: 10, font, color: black });
  page.drawText("IČO: 28501381", { x: textX, y: y - 12, size: 8, font, color: grey });
  y -= 24;
  page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 0.6, color: grey });

  y -= 40;
  const title = PROTOKOL_NAZEV;
  page.drawText(title, { x: (595.28 - bold.widthOfTextAtSize(title, 15)) / 2, y, size: 15, font: bold, color: black });

  y -= 40;
  const rows = [
    ["Zaměstnanec", zamestnanec.jmeno],
    zamestnanec.datumNarozeni && ["Datum narození", czDate(zamestnanec.datumNarozeni)],
    zamestnanec.osobniCislo && ["Osobní číslo", zamestnanec.osobniCislo],
    zamestnanec.pozice && ["Pracovní pozice", zamestnanec.pozice],
    ["Datum předání", czDate(datum)],
  ].filter(Boolean);
  for (const [k, v] of rows) {
    page.drawText(`${k}:`, { x: L, y, size: 10.5, font, color: grey });
    page.drawText(String(v || ""), { x: L + 120, y, size: 10.5, font: bold, color: black });
    y -= 18;
  }

  // Tabulka poloziek
  y -= 16;
  const cols = [L, L + 250, L + 370, R];
  const rowH = 22;
  const head = ["Položka", "Velikost", "Počet kusů"];
  page.drawRectangle({ x: L, y: y - 6, width: R - L, height: rowH, color: rgb(0.93, 0.93, 0.93) });
  head.forEach((h, i) => page.drawText(h, { x: cols[i] + 6, y, size: 10, font: bold, color: black }));
  const top = y + rowH - 6;
  for (const p of polozky) {
    y -= rowH;
    page.drawText(p.label, { x: cols[0] + 6, y, size: 10.5, font, color: black });
    page.drawText(String(p.velikost), { x: cols[1] + 6, y, size: 10.5, font, color: black });
    page.drawText(String(p.pocet), { x: cols[2] + 6, y, size: 10.5, font, color: black });
  }
  const bottom = y - 6;
  for (const x of cols) page.drawLine({ start: { x, y: top }, end: { x, y: bottom }, thickness: 0.5, color: grey });
  for (let yy = top, i = 0; i <= polozky.length + 1; i++, yy -= rowH) page.drawLine({ start: { x: L, y: yy }, end: { x: R, y: yy }, thickness: 0.5, color: grey });

  // Prohlaseni
  y = bottom - 30;
  for (const line of wrap(PROTOKOL_PROHLASENI, font, 10.5, R - L)) {
    page.drawText(line, { x: L, y, size: 10.5, font, color: black });
    y -= 15;
  }

  // Podpisy
  y -= 70;
  const mid = (L + R) / 2;
  for (const [x, label, name] of [[L, "Předal (za zaměstnavatele)", predal], [mid + 20, "Převzal (zaměstnanec)", zamestnanec.jmeno]]) {
    page.drawLine({ start: { x, y }, end: { x: x + 200, y }, thickness: 0.6, color: black });
    page.drawText(label, { x, y: y - 14, size: 9.5, font, color: grey });
    if (name) page.drawText(name, { x, y: y - 27, size: 9.5, font, color: black });
  }
  page.drawText(`V Příbrami dne ${czDate(datum)}`, { x: L, y: y + 40, size: 10.5, font, color: black });

  return pdf.save();
}
