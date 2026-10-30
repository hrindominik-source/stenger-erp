// PDF pokynov k lekarskej prehliadke (A4, jedna strana). Nacitava sa dynamicky.
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { POKYNY_TYPY, pokynyKroky } from "./pokynyProhlidka.js";

// Zalomi segmenty { t, b } do riadkov; riadok = zoznam slov { w, b }.
function wrapRich(segs, font, bold, size, maxWidth) {
  const words = segs.flatMap((s) => String(s.t).split(/(\s+)/).filter((w) => w !== "").map((w) => ({ w, b: !!s.b })));
  const width = (ws) => ws.reduce((sum, x) => sum + (x.b ? bold : font).widthOfTextAtSize(x.w, size), 0);
  const lines = []; let line = [];
  for (const word of words) {
    if (/^\s+$/.test(word.w)) { if (line.length) line.push({ w: " ", b: word.b }); continue; }
    if (line.length && width([...line, word]) > maxWidth) {
      while (line.length && line[line.length - 1].w === " ") line.pop();
      lines.push(line); line = [];
    }
    line.push(word);
  }
  while (line.length && line[line.length - 1].w === " ") line.pop();
  if (line.length) lines.push(line);
  return lines;
}

function drawLine(page, line, x, y, size, font, bold, color) {
  for (const { w, b } of line) {
    const f = b ? bold : font;
    page.drawText(w, { x, y, size, font: f, color });
    x += f.widthOfTextAtSize(w, size);
  }
}

// typ: "vstupni" | "periodicka"; kontakt: { volat, telefon, ordinace }; zamestnanec: meno (nepovinne).
export async function buildPokynyPdf({ fontBytes, boldBytes, logoBytes }, { typ, kontakt, zamestnanec }) {
  const T = POKYNY_TYPY[typ];
  const kroky = pokynyKroky(typ, kontakt);
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
  page.drawText("Stenger Czech s.r.o.", { x: textX, y, size: 10, font, color: black });
  page.drawText("IČO: 28501381", { x: textX, y: y - 12, size: 8, font, color: grey });
  y -= 24;
  page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 0.6, color: grey });

  y -= 42;
  page.drawText(T.nazev, { x: (595.28 - bold.widthOfTextAtSize(T.nazev, 16)) / 2, y, size: 16, font: bold, color: black });
  y -= 20;
  page.drawText(T.podtitul, { x: (595.28 - font.widthOfTextAtSize(T.podtitul, 11)) / 2, y, size: 11, font, color: grey });
  if (zamestnanec) {
    y -= 26;
    drawLine(page, [{ w: "Zaměstnanec: ", b: false }, { w: zamestnanec, b: true }], L, y, 10.5, font, bold, black);
  }

  y -= 32;
  const size = 10.5, lh = 15;
  page.drawText("Dobrý den,", { x: L, y, size, font, color: black });
  y -= lh;
  for (const line of wrapRich([{ t: T.uvod }], font, bold, size, R - L)) { drawLine(page, line, L, y, size, font, bold, black); y -= lh; }

  y -= 14;
  page.drawText("Pokyny", { x: L, y, size: 12.5, font: bold, color: black });
  y -= 12;

  // Tabulka krokov: Krok | Co je potreba udelat
  const cX = L + 50, textW = R - cX - 12, pad = 7;
  const headH = 22;
  const top = y;
  page.drawRectangle({ x: L, y: y - headH, width: R - L, height: headH, color: rgb(0.93, 0.93, 0.93) });
  page.drawText("Krok", { x: L + 8, y: y - 15, size: 10, font: bold, color: black });
  page.drawText("Co je potřeba udělat", { x: cX + 8, y: y - 15, size: 10, font: bold, color: black });
  y -= headH;
  const rowLines = [y];
  kroky.forEach((segs, i) => {
    let ty = y - pad - size;
    for (const line of wrapRich(segs, font, bold, size, textW)) { drawLine(page, line, cX + 8, ty, size, font, bold, black); ty -= lh; }
    for (const odr of segs.odrazky || []) {
      page.drawText("•", { x: cX + 14, y: ty, size, font, color: black });
      for (const line of wrapRich(odr, font, bold, size, textW - 18)) { drawLine(page, line, cX + 26, ty, size, font, bold, black); ty -= lh; }
    }
    page.drawText(String(i + 1), { x: L + 8 + (34 - bold.widthOfTextAtSize(String(i + 1), 11)) / 2, y: y - pad - size, size: 11, font: bold, color: black });
    y = ty + lh - size - pad + 2;
    rowLines.push(y);
  });
  for (const yy of [top, ...rowLines]) page.drawLine({ start: { x: L, y: yy }, end: { x: R, y: yy }, thickness: 0.5, color: grey });
  for (const x of [L, cX, R]) page.drawLine({ start: { x, y: top }, end: { x, y }, thickness: 0.5, color: grey });

  y -= 40;
  page.drawText("Děkujeme, tým Stenger Czech", { x: L, y, size, font, color: black });

  return pdf.save();
}
