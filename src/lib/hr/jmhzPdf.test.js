import { describe, it, expect, beforeAll } from "vitest";
import { PDFDocument } from "pdf-lib";
import { listAcroFormFieldNames, extractJmhzFields, detectJmhzVersionCandidates, FIELD_STATUS, JMHZ_FIELD_MAPS } from "./jmhzPdf.js";

// Synteticky testovaci PDF formular postaveny priamo cez pdf-lib (produkcne
// pouzitie je VYLUCNE citanie, ale pdf-lib vie aj zapisovat - vyuzite tu len
// na vytvorenie reprodukovatelnej testovacej fixture bez zavislosti na
// realnom JMHZ PDF, ktory nie je v repozitari).
async function buildTestJmhzPdf({ jmenoValue, checkedVedouci } = {}) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle("Test dotaznik verze-test-1");
  const page = pdfDoc.addPage([600, 400]);
  const form = pdfDoc.getForm();

  const jmenoField = form.createTextField("Jmeno");
  jmenoField.addToPage(page, { x: 50, y: 300, width: 200, height: 20 });
  if (jmenoValue !== undefined) jmenoField.setText(jmenoValue);

  const vedouciField = form.createCheckBox("VedouciPracovnik");
  vedouciField.addToPage(page, { x: 50, y: 260, width: 20, height: 20 });
  if (checkedVedouci) vedouciField.check();

  const bytes = await pdfDoc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

beforeAll(() => {
  // Registrace testovacej mapy verzie "verze-test-1" - nezasahuje do
  // realnych produkcnych verzii definovanych v module.
  JMHZ_FIELD_MAPS["verze-test-1"] = {
    versionLabel: "verze-test-1",
    fields: {
      Jmeno: { key: "jmeno", kind: "text" },
      VedouciPracovnik: { key: "vedouci_pracovnik", kind: "checkbox" },
    },
  };
});

describe("listAcroFormFieldNames", () => {
  it("vrati vsetky AcroForm polia s nazvom a typom", async () => {
    const ab = await buildTestJmhzPdf({});
    const fields = await listAcroFormFieldNames(ab);
    expect(fields).toEqual(
      expect.arrayContaining([
        { name: "Jmeno", type: "PDFTextField" },
        { name: "VedouciPracovnik", type: "PDFCheckBox" },
      ])
    );
  });
});

describe("detectJmhzVersionCandidates", () => {
  it("navrhne kandidata podla textu v metadatach PDF, ale nerozhoduje sam", async () => {
    const ab = await buildTestJmhzPdf({});
    const { candidates, knownVersions } = await detectJmhzVersionCandidates(ab);
    expect(candidates).toContain("verze-test-1");
    expect(knownVersions).toContain("verze-test-1");
  });
});

describe("extractJmhzFields", () => {
  it("neznama verzia vrati NEZNAMA_VERZIA namiesto tichej (nesprávnej) extrakcie", async () => {
    const ab = await buildTestJmhzPdf({});
    const result = await extractJmhzFields(ab, "neexistujuca-verzia-999");
    expect(result.status).toBe("NEZNAMA_VERZIA");
    expect(result.results).toEqual({});
  });

  it("vyplnene textove pole -> POTVRDENE_ANO so spravnou hodnotou", async () => {
    const ab = await buildTestJmhzPdf({ jmenoValue: "Žofie Nováková" });
    const result = await extractJmhzFields(ab, "verze-test-1");
    expect(result.status).toBe("OK");
    expect(result.results.jmeno.status).toBe(FIELD_STATUS.POTVRDENE_ANO);
    expect(result.results.jmeno.rawValue).toBe("Žofie Nováková");
  });

  it("prazdne textove pole -> NEZADANE, nie prazdny retazec ako 'hodnota'", async () => {
    const ab = await buildTestJmhzPdf({});
    const result = await extractJmhzFields(ab, "verze-test-1");
    expect(result.results.jmeno.status).toBe(FIELD_STATUS.NEZADANE);
  });

  it("KRITICKE: nezaskrtnuty checkbox je NEZADANE, NIKDY automaticky 'Nie'", async () => {
    const ab = await buildTestJmhzPdf({}); // checkbox zostava nezaskrtnuty
    const result = await extractJmhzFields(ab, "verze-test-1");
    expect(result.results.vedouci_pracovnik.status).toBe(FIELD_STATUS.NEZADANE);
    expect(result.results.vedouci_pracovnik.status).not.toBe(FIELD_STATUS.POTVRDENE_NIE);
  });

  it("zaskrtnuty checkbox -> POTVRDENE_ANO", async () => {
    const ab = await buildTestJmhzPdf({ checkedVedouci: true });
    const result = await extractJmhzFields(ab, "verze-test-1");
    expect(result.results.vedouci_pracovnik.status).toBe(FIELD_STATUS.POTVRDENE_ANO);
  });

  it("pole chybajuce v skutocnom PDF (ale ocakavane mapou) vyzaduje kontrolu, nespadne", async () => {
    JMHZ_FIELD_MAPS["verze-test-1"].fields.NeexistujucePole = { key: "fantom", kind: "text" };
    const ab = await buildTestJmhzPdf({});
    const result = await extractJmhzFields(ab, "verze-test-1");
    expect(result.results.fantom.status).toBe(FIELD_STATUS.VYZADUJE_KONTROLU);
    delete JMHZ_FIELD_MAPS["verze-test-1"].fields.NeexistujucePole;
  });
});
