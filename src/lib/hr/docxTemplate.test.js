import { describe, it, expect, beforeAll } from "vitest";
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell } from "docx";
import {
  fillDocxTemplate,
  extractTemplateKeys,
  validateTemplateKeysAgainstAllowlist,
  validateRequiredKeys,
} from "./docxTemplate.js";

// Synteticke DOCX fixtures postavene cez uz existujucu zavislost "docx"
// (nie staticke subory z hr-podklady, ktore su zamerne mimo gitu) - test
// je tak plne samostatny a reprodukovatelny kdekolvek.
async function buildTestDocx(paragraphsText) {
  const doc = new Document({
    sections: [{ children: paragraphsText.map((t) => new Paragraph({ children: [new TextRun(t)] })) }],
  });
  const buf = await Packer.toBuffer(doc);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function buildTestDocxWithTable(cellsText) {
  const doc = new Document({
    sections: [
      {
        children: [
          new Table({
            rows: [
              new TableRow({
                children: cellsText.map((t) => new TableCell({ children: [new Paragraph({ children: [new TextRun(t)] })] })),
              }),
            ],
          }),
        ],
      },
    ],
  });
  const buf = await Packer.toBuffer(doc);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("fillDocxTemplate - vyplnanie {{kluc}} placeholderov", () => {
  it("nahradi jednoduchy placeholder skutocnou hodnotou (vratane diakritiky)", async () => {
    const ab = await buildTestDocx(["Zamestnanec: {{cele_jmeno}}, mesto: {{misto_narozeni}}"]);
    const out = fillDocxTemplate(ab, { cele_jmeno: "Žofie Nováková", misto_narozeni: "Příbram" });
    const zip = (await import("pizzip")).default;
    const outZip = new zip(out);
    const xml = outZip.file("word/document.xml").asText();
    expect(xml).toContain("Žofie Nováková");
    expect(xml).toContain("Příbram");
    expect(xml).not.toContain("{{");
  });

  it("chybajuca hodnota sa vyplni ako prazdny retazec, NIE 'undefined'/'null'", async () => {
    const ab = await buildTestDocx(["Hodnota: {{nevyplnene_pole}}."]);
    const out = fillDocxTemplate(ab, {});
    const zip = (await import("pizzip")).default;
    const xml = new zip(out).file("word/document.xml").asText();
    expect(xml).not.toContain("undefined");
    expect(xml).not.toContain("null");
    expect(xml).toContain("Hodnota: .");
  });

  it("rovnaky kluc pouzity viackrat dostane VZDY rovnaku hodnotu (napr. {{ucet}} na dvoch miestach)", async () => {
    const ab = await buildTestDocx(["Ucet A: {{ucet}}", "Ucet B: {{ucet}}"]);
    const out = fillDocxTemplate(ab, { ucet: "123456789/0800" });
    const zip = (await import("pizzip")).default;
    const xml = new zip(out).file("word/document.xml").asText();
    const matches = xml.match(/123456789\/0800/g);
    expect(matches?.length).toBe(2);
  });

  it("funguje aj pre placeholder v bunke tabulky", async () => {
    const ab = await buildTestDocxWithTable(["{{cele_jmeno}}", "{{zarazeni}}"]);
    const out = fillDocxTemplate(ab, { cele_jmeno: "Petr Svoboda", zarazeni: "Dělník" });
    const zip = (await import("pizzip")).default;
    const xml = new zip(out).file("word/document.xml").asText();
    expect(xml).toContain("Petr Svoboda");
    expect(xml).toContain("Dělník");
  });
});

describe("extractTemplateKeys / validateTemplateKeysAgainstAllowlist", () => {
  it("zisti presne kluce pouzite v sablone", async () => {
    const ab = await buildTestDocx(["{{cele_jmeno}} a {{datum}}"]);
    const keys = extractTemplateKeys(ab);
    expect(keys.sort()).toEqual(["cele_jmeno", "datum"]);
  });

  it("detekuje neznamy (nemapovany) tag - sablona sa nesmie aktivovat", async () => {
    const ab = await buildTestDocx(["{{cele_jmeno}} a {{neexistujuci_kluc}}"]);
    const { ok, unknown } = validateTemplateKeysAgainstAllowlist(ab, ["cele_jmeno", "datum"]);
    expect(ok).toBe(false);
    expect(unknown).toEqual(["neexistujuci_kluc"]);
  });

  it("prejde validaciou, ked su vsetky pouzite kluce na allowliste", async () => {
    const ab = await buildTestDocx(["{{cele_jmeno}}"]);
    const { ok } = validateTemplateKeysAgainstAllowlist(ab, ["cele_jmeno", "datum"]);
    expect(ok).toBe(true);
  });
});

describe("validateRequiredKeys", () => {
  it("najde chybajuce povinne kluce (undefined/null/prazdny retazec)", () => {
    const { ok, missing } = validateRequiredKeys({ a: "x", b: "", c: null }, ["a", "b", "c", "d"]);
    expect(ok).toBe(false);
    expect(missing.sort()).toEqual(["b", "c", "d"]);
  });

  it("ok=true ked su vsetky povinne kluce vyplnene", () => {
    const { ok, missing } = validateRequiredKeys({ a: "x", b: "y" }, ["a", "b"]);
    expect(ok).toBe(true);
    expect(missing).toEqual([]);
  });
});
