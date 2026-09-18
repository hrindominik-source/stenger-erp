// Vseobecny prevod ExcelJS hárku na HTML tabulku, ktora vizualne verne
// kopiruje original (bunky, zlucenia, ramceky, velkost pisma) - cita sa
// PRIAMO zo skutocneho (uz vyplneneho) workbook objektu, ziadny text zo
// sablony sa nikde neprepisuje rucne. Pouziva sa na to, aby tlac/PDF
// zobrazovali presne tu istu formu, ako sa stahuje ako .xlsx (napr. CMR
// medzinarodny nakladny list - viz cmrXlsx.js/buildCmrWorkbook).
const BORDER_WIDTH = {
  thin: "1px",
  hair: "0.5px",
  medium: "2px",
  thick: "3px",
  double: "3px",
  dashed: "1px",
  dotted: "1px",
  dashDot: "1px",
  dashDotDot: "1px",
  slantDashDot: "1px",
  mediumDashed: "2px",
};
const BORDER_LINE_STYLE = { dotted: "dotted", dashed: "dashed", double: "double" };

function borderCss(b) {
  if (!b || !b.style) return "none";
  const width = BORDER_WIDTH[b.style] || "1px";
  const lineStyle = BORDER_LINE_STYLE[b.style] || "solid";
  return `${width} ${lineStyle} #000`;
}

function decodeAddress(addr) {
  const m = addr.match(/^([A-Z]+)(\d+)$/);
  let col = 0;
  for (let i = 0; i < m[1].length; i++) col = col * 26 + (m[1].charCodeAt(i) - 64);
  return { row: parseInt(m[2], 10), col };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}
function formatDateVal(d) {
  return `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

// ws (voliltelne) sa pouziva na PRECITANIE ZIVEJ hodnoty referencovanej
// bunky pre jednoduche vzorce ("=E41", "=E41*85") - ExcelJS pri zapise
// hodnoty do bunky NEPREPOCITAVA zavisle vzorce (to robi az Excel pri
// otvoreni suboru), takze bez tohto by nahlad/tlac/PDF ukazovali stare
// vysledky nacachovane este zo sablony (napr. povodny datum nakladky
// namiesto toho z aktualnej objednavky). Zlozitejsie vzorce (mimo tychto
// dvoch tvarov) sa stale vratia s povodnym (mozno neaktualnym) .result.
function cellText(cell, ws) {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return formatDateVal(v);
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
    if (v.formula !== undefined) {
      if (ws) {
        const ref = v.formula.match(/^([A-Z]+\d+)$/);
        if (ref) return cellText(ws.getCell(ref[1]), ws);
        const mult = v.formula.match(/^([A-Z]+\d+)\*(\d+(?:\.\d+)?)$/);
        if (mult) {
          const base = parseFloat(cellText(ws.getCell(mult[1]), ws)) || 0;
          const result = base * parseFloat(mult[2]);
          return String(Number.isInteger(result) ? result : result.toFixed(2));
        }
      }
      const r = v.result;
      if (r instanceof Date) return formatDateVal(r);
      if (r && typeof r === "object") return "";
      return r === null || r === undefined ? "" : String(r);
    }
    if (v.text !== undefined) return v.text; // hyperlink object
    return "";
  }
  return String(v);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// scale (0-1, default 1): HTML tabulkovy box model potrebuje o dost viac
// miesta na riadok textu, nez kolko excel naozaj pouziva (riadky sablony su
// navrhnute nahusto, presne na 1 stranu pri 100% v Exceli) - bez zmensenia by
// tak vysledna tlac/PDF pretiekla na 2. stranu. Font-size aj vyska riadku sa
// preto skaluju SPOLU (rovnakym pomerom), takze pretekanie ostava rovnake
// relativne k velkosti, len cely dokument vyjde mensi a znova sa zmesti na
// jednu stranu - pouziva sa len pre tlac/PDF, nahlad v okne ostava 1:1.
export function renderWorksheetToHtml(ws, opts = {}) {
  const scale = opts.scale || 1;
  const colCount = ws.columnCount;
  const rowCount = ws.rowCount;

  const mergeSpan = new Map(); // "r,c" (top-left) -> {rowSpan, colSpan}
  const covered = new Set();
  (ws.model.merges || []).forEach((range) => {
    const [startAddr, endAddr] = range.split(":");
    const s = decodeAddress(startAddr);
    const e = decodeAddress(endAddr);
    mergeSpan.set(`${s.row},${s.col}`, { rowSpan: e.row - s.row + 1, colSpan: e.col - s.col + 1 });
    for (let r = s.row; r <= e.row; r++) {
      for (let c = s.col; c <= e.col; c++) {
        if (r === s.row && c === s.col) continue;
        covered.add(`${r},${c}`);
      }
    }
  });

  const colWidths = [];
  for (let c = 1; c <= colCount; c++) colWidths.push(ws.getColumn(c).width || 8.43);
  const totalWidth = colWidths.reduce((a, b) => a + b, 0);

  let html = `<table style="border-collapse:collapse;table-layout:fixed;width:100%;font-family:Arial,sans-serif;color:#000;">`;
  html += `<colgroup>${colWidths.map((w) => `<col style="width:${((w / totalWidth) * 100).toFixed(3)}%;">`).join("")}</colgroup>`;

  for (let r = 1; r <= rowCount; r++) {
    const row = ws.getRow(r);
    const heightPt = (row.height || 15) * scale;
    html += `<tr style="height:${heightPt}pt;">`;
    let c = 1;
    while (c <= colCount) {
      if (covered.has(`${r},${c}`)) { c++; continue; }
      const cell = row.getCell(c);
      const mergeInfo = mergeSpan.get(`${r},${c}`);
      const rawText = cellText(cell, ws);
      let colSpan = mergeInfo ? mergeInfo.colSpan : 1;
      const rowSpan = mergeInfo ? mergeInfo.rowSpan : 1;
      // Sablona miesto zlucenia buniek casto len RUCNE zopakuje ten isty text
      // do niekolkych uzkych susednych stlpcov (starsi trik na "pretecenie"
      // textu cez viac buniek) - bez zbalenia do jednej bunky by sa tak
      // rovnaky text vykreslil viackrat vedla seba a zalomil sa na
      // nezmyselne fragmenty. Ak takyto beh rovnakeho textu najde, zbali ho
      // do jedneho colspan-u.
      if (!mergeInfo && rawText) {
        let span = 1;
        while (
          c + span <= colCount &&
          !covered.has(`${r},${c + span}`) &&
          !mergeSpan.has(`${r},${c + span}`) &&
          cellText(row.getCell(c + span), ws) === rawText
        ) {
          covered.add(`${r},${c + span}`);
          span++;
        }
        colSpan = span;
      }
      // Ten isty rucny "pretecenie" trik funguje aj zvisle (napr. postranna
      // poznamka opakovana po jednom slove/fragmente v kazdom riadku uzkeho
      // stlpca A/B) - zbal aj tieto do jednej bunky, inak by sa vykreslila
      // ako neciatelna stlpova stena useknutych fragmentov.
      let effRowSpan = rowSpan;
      if (!mergeInfo && rawText) {
        let r2 = r + 1;
        while (r2 <= rowCount) {
          let matches = true;
          for (let cc = c; cc < c + colSpan; cc++) {
            if (covered.has(`${r2},${cc}`) || mergeSpan.has(`${r2},${cc}`) || cellText(ws.getRow(r2).getCell(cc), ws) !== rawText) { matches = false; break; }
          }
          if (!matches) break;
          for (let cc = c; cc < c + colSpan; cc++) covered.add(`${r2},${cc}`);
          r2++;
        }
        effRowSpan = r2 - r;
      }
      const rotated = colSpan === 1 && effRowSpan >= 4;
      const text = escapeHtml(rawText);
      const fontSize = ((cell.font && cell.font.size) || 11) * scale;
      const bold = cell.font && cell.font.bold ? "bold" : "normal";
      const b = cell.border || {};
      const borders = `border-top:${borderCss(b.top)};border-bottom:${borderCss(b.bottom)};border-left:${borderCss(b.left)};border-right:${borderCss(b.right)};`;
      const align = cell.alignment || {};
      const textAlign = align.horizontal || "left";
      const vAlign = align.vertical === "top" ? "top" : align.vertical === "bottom" ? "bottom" : "middle";
      const writingMode = rotated ? "writing-mode:vertical-rl;text-orientation:mixed;" : "";
      html += `<td${colSpan > 1 || effRowSpan > 1 ? ` rowspan="${effRowSpan}" colspan="${colSpan}"` : ""} style="${borders}font-size:${fontSize}pt;font-weight:${bold};text-align:${textAlign};vertical-align:${vAlign};padding:0 2px;white-space:pre-wrap;line-height:1.05;${writingMode}">${text}</td>`;
      c += colSpan;
    }
    html += `</tr>`;
  }
  html += `</table>`;
  return html;
}
