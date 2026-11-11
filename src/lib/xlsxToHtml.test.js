import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { rangeBorder, renderWorksheetToHtml } from "./xlsxToHtml.js";

describe("ramik zlucenych buniek (sablona CMR)", () => {
  it("pravy okraj zluceneho policka sa berie z posledneho stlpca", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(readFileSync("public/templates/CMR_template.xlsx"));
    const ws = wb.worksheets[0];
    // J5:T5 - ramik vpravo ma v sablone len bunka T5, nie master J5
    expect(rangeBorder(ws, 5, 10, 1, 11).right.style).toBe("thin");
    // O12:T13
    expect(rangeBorder(ws, 12, 15, 2, 6).right.style).toBe("medium");
    const html = renderWorksheetToHtml(ws);
    const riadok5 = html.split("<tr")[5];
    expect(riadok5).toContain('colspan="11" style="border-top');
    expect(riadok5.split('colspan="11"')[1]).toMatch(/^[^>]*border-right:1px solid #000/);
  });
});
