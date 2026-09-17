// Word verzia exportu historie checklistu - na rozdiel od PDF (odfotene
// staticke stranky) ide o skutocny .docx, ktory sa da dalej upravovat, a
// hlavicka/pata presne kopiruje polia firemnej sablony GF-001 ("Sablona pro
// tvorbu interni dokumentace"): Cislo dokumentu / Strana X z Y / Revize c. /
// V platnosti od / Datum posledni revize / NAZEV DOKUMENTU, pata "Po
// vytisteni se jedna o nerizeny vytisk. Pouze pro interni pouziti." Font
// Calibri v celom dokumente podla GD-001 (Rizeni dokumentace a zaznamu).
//
// "docx" je pomerne velka kniznica pouzivana len tu - importuje sa preto
// dynamicky az vo vnutri exportChecklistHistoryAsDocx (rovnaky vzor ako
// exceljs v cmrXlsx.js), aby sa nezvacsoval hlavny lazy chunk Kvality pre
// vsetkych, ktori tento export nikdy nepouziju.
const FONT = "Calibri";
const NAVY = "0f172a";
const GRAY = "475569";
const RED = "b91c1c";

function noBorders(docx) {
  const none = { style: docx.BorderStyle.NONE, size: 0, color: "ffffff" };
  return { top: none, bottom: none, left: none, right: none };
}

function headerTable(docx, template) {
  const { Table, TableRow, TableCell, Paragraph, TextRun, PageNumber, WidthType, AlignmentType, VerticalAlign } = docx;
  const metaRun = (label, value) =>
    new TextRun({ text: `${label}: ${value || "—"}`, font: FONT, size: 16, color: GRAY });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorders(docx),
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: noBorders(docx),
            width: { size: 55, type: WidthType.PERCENTAGE },
            verticalAlign: VerticalAlign.CENTER,
            children: [
              new Paragraph({ children: [new TextRun({ text: "Stenger Czech s.r.o.", bold: true, font: FONT, size: 22, color: NAVY })] }),
            ],
          }),
          new TableCell({
            borders: noBorders(docx),
            width: { size: 45, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [metaRun("Číslo dokumentu", template.cisloDokumentu)],
              }),
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: "Strana ", font: FONT, size: 16, color: GRAY }),
                  new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: GRAY }),
                  new TextRun({ text: " z ", font: FONT, size: 16, color: GRAY }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: GRAY }),
                ],
              }),
              new Paragraph({ alignment: AlignmentType.RIGHT, children: [metaRun("Revize č.", template.revizeCislo)] }),
              new Paragraph({ alignment: AlignmentType.RIGHT, children: [metaRun("V platnosti od", template.vytvorene)] }),
            ],
          }),
        ],
      }),
    ],
  });
}

function headerTitleParagraph(docx, template) {
  const { Paragraph, TextRun, BorderStyle } = docx;
  return new Paragraph({
    spacing: { before: 100, after: 150 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: NAVY, space: 4 } },
    children: [
      new TextRun({ text: (template.nazov || "").toUpperCase(), bold: true, allCaps: true, font: FONT, size: 26, color: NAVY }),
    ],
  });
}

function buildFooter(docx) {
  const { Footer, Paragraph, TextRun, AlignmentType } = docx;
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: "Po vytištění se jedná o neřízený výtisk. Pouze pro interní použití.",
            italics: true,
            font: FONT,
            size: 15,
            color: GRAY,
          }),
        ],
      }),
    ],
  });
}

function odpovedText(o) {
  if (!o) return "";
  return o.type === "legenda" ? o.hodnota || "" : o.ok === true ? "OK" : o.ok === false ? "Nevyhovuje" : "";
}

function cell(docx, text, opts = {}) {
  const { TableCell, Paragraph, TextRun, VerticalAlign, ShadingType } = docx;
  const { header = false, red = false } = opts;
  return new TableCell({
    shading: header ? { type: ShadingType.CLEAR, color: "auto", fill: "f1f5f9" } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: [
      new Paragraph({
        children: [
          new TextRun({ text: text || "", bold: header, color: red ? RED : "111111", font: FONT, size: 18 }),
        ],
      }),
    ],
  });
}

export async function exportChecklistHistoryAsDocx(template, submissions) {
  const history = submissions
    .filter((s) => s.templateId === template.id)
    .slice()
    .sort((a, b) => (a.datum > b.datum ? 1 : a.datum < b.datum ? -1 : 0));
  if (history.length === 0) return;

  const itemTexts = [];
  const seen = new Set();
  for (const s of history) {
    for (const o of s.odpovede || []) {
      if (!seen.has(o.text)) { seen.add(o.text); itemTexts.push(o.text); }
    }
  }

  const docx = await import("docx");
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, WidthType, Header } = docx;

  const headRow = new TableRow({
    tableHeader: true,
    children: [
      cell(docx, "Datum", { header: true }),
      cell(docx, "Vyplnil", { header: true }),
      ...itemTexts.map((t) => cell(docx, t, { header: true })),
      cell(docx, "Poznámka", { header: true }),
    ],
  });

  const dataRows = history.map((s) => {
    const itemCells = itemTexts.map((text) => {
      const o = (s.odpovede || []).find((x) => x.text === text);
      const val = odpovedText(o);
      const note = o && o.poznamka ? ` (${o.poznamka})` : "";
      return cell(docx, val + note, { red: val === "Nevyhovuje" });
    });
    return new TableRow({
      children: [cell(docx, s.datum), cell(docx, s.vyplnil), ...itemCells, cell(docx, s.poznamka || "")],
    });
  });

  const doc = new Document({
    sections: [
      {
        properties: {},
        headers: {
          default: new Header({ children: [headerTable(docx, template), headerTitleParagraph(docx, template)] }),
        },
        footers: { default: buildFooter(docx) },
        children: [
          new Paragraph({
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: `Historie vyplnění checklistu - frekvence: každých ${template.frekvenciaHodnota} ${(template.frekvenciaTyp || "").toLowerCase()}`,
                italics: true,
                font: FONT,
                size: 18,
                color: GRAY,
              }),
            ],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [headRow, ...dataRows],
          }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(template.nazov || "checklist").replace(/[^a-z0-9]+/gi, "_")}_historie.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
