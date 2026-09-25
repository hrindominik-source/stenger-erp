import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { extractJmhzFields, detectJmhzVersionCandidates, FIELD_STATUS, JMHZ_FIELD_MAPS, listAcroFormFieldNames, buildDecodedFieldIndex } from "./jmhzPdf.js";

// Test proti SKUTOCNEMU verejne dostupnemu prazdnemu vzoru (nie synteticky
// postavenemu fixture ako jmhzPdf.test.js) - stiahnutemu priamo z odkazu
// zadaneho uzivatelom (https://faq.mrp.cz/faqcz/obrazky/mrpks/dotaznik_mrp_jmhz4.pdf,
// "Verze dokumentu ze dne 25.3.2026"). Ulozeny v __fixtures__/, kedze ide o
// verejne publikovany prazdny formular MRP (nie sukromny/realny dokument s
// osobnymi udajmi) - na rozdiel od hr-podklady/, ktore su explicitne
// vylucene z gitu (viz .gitignore + MASTER_PROMPT bod A.5).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "__fixtures__", "jmhz_25_3_2026_prazdny.pdf");

let originalBytes;
beforeAll(() => {
  originalBytes = fs.readFileSync(FIXTURE_PATH);
});

describe("realny vzor 25.3.2026 - AcroForm inventar", () => {
  it("ma presne 99 poli, vsetky mapovane kluce z JMHZ_FIELD_MAPS['25.3.2026'] v PDF skutocne existuju", async () => {
    const ab = originalBytes.buffer.slice(originalBytes.byteOffset, originalBytes.byteOffset + originalBytes.byteLength);
    const fields = await listAcroFormFieldNames(ab);
    expect(fields.length).toBe(99);
    const pdfFieldNames = new Set(fields.map((f) => f.name));
    const mappedNames = Object.keys(JMHZ_FIELD_MAPS["25.3.2026"].fields);
    expect(mappedNames.length).toBe(99);
    const missing = mappedNames.filter((n) => !pdfFieldNames.has(n));
    expect(missing).toEqual([]);
  });

  it("detekuje verziu z title metadat PDF ('Dotazník zaměstnavatele' - title neobsahuje datum, takze kandidati su prazdni bez rucneho potvrdenia)", async () => {
    const ab = originalBytes.buffer.slice(originalBytes.byteOffset, originalBytes.byteOffset + originalBytes.byteLength);
    const { candidates, knownVersions } = await detectJmhzVersionCandidates(ab);
    // Realny PDF nema verziu v title/subject metadate (je vytlacena len v texte
    // stranok) - candidates preto zostava prazdny; appka MUSI cakat na rucne
    // potvrdenie clovekom (JmhzImportScreen), nie autodetekciu.
    expect(candidates).toEqual([]);
    expect(knownVersions).toContain("25.3.2026");
  });
});

describe("realny vzor 25.3.2026 - extrakcia po syntetickom vyplneni", () => {
  // Polia s diakritikou v nazve maju v tomto PDF (LibreOffice export) surovy
  // nazov dvojito escapovany (viz jmhzPdf.js decodeLibreOfficeFieldName) -
  // pdf-lib.form.getTextField(citatelnyNazov) by preto zlyhalo. Testovy
  // helper preto pri vypĺňaní pouziva rovnaky dekodovany index ako
  // extractJmhzFields, cim zaroven overuje, ze produkcny aj testovy kod
  // vidia ten isty (citatelny) nazov pola.
  async function fillAndExtract(fillFn) {
    const pdfDoc = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const byName = buildDecodedFieldIndex(form);
    fillFn(byName);
    const filledBytes = await pdfDoc.save();
    const ab = filledBytes.buffer.slice(filledBytes.byteOffset, filledBytes.byteOffset + filledBytes.byteLength);
    return extractJmhzFields(ab, "25.3.2026");
  }

  it("vyplnene textove pole (Jmeno) -> POTVRDENE_ANO so spravnou hodnotou vratane diakritiky", async () => {
    const result = await fillAndExtract((byName) => {
      byName.get("Textové pole 1_2").setText("Žofie");
      byName.get("Textové pole 1_3").setText("Nováková");
    });
    expect(result.status).toBe("OK");
    expect(result.results.jmeno.status).toBe(FIELD_STATUS.POTVRDENE_ANO);
    expect(result.results.jmeno.rawValue).toBe("Žofie");
    expect(result.results.prijmeni.rawValue).toBe("Nováková");
  });

  it("prazdne textove pole -> NEZADANE", async () => {
    const result = await fillAndExtract(() => {});
    expect(result.results.jmeno.status).toBe(FIELD_STATUS.NEZADANE);
    expect(result.results.rodne_cislo.status).toBe(FIELD_STATUS.NEZADANE);
  });

  it("dropdown Pohlaví -> POTVRDENE_ANO s vybranou hodnotou", async () => {
    const result = await fillAndExtract((byName) => {
      byName.get("Textové pole 1_6").select("Žena");
    });
    expect(result.results.pohlavi.status).toBe(FIELD_STATUS.POTVRDENE_ANO);
    expect(result.results.pohlavi.rawValue).toBe("Žena");
  });

  it("KRITICKE: nezaskrtnuty checkbox (sleva na poplatníka) je NEZADANE, NIKDY automaticky POTVRDENE_NIE", async () => {
    const result = await fillAndExtract(() => {});
    expect(result.results.tax_zakladni_sleva.status).toBe(FIELD_STATUS.NEZADANE);
    expect(result.results.tax_zakladni_sleva.status).not.toBe(FIELD_STATUS.POTVRDENE_NIE);
  });

  it("zaskrtnuty checkbox -> POTVRDENE_ANO", async () => {
    const result = await fillAndExtract((byName) => {
      byName.get("Základní slevy na poplatníka").check();
    });
    expect(result.results.tax_zakladni_sleva.status).toBe(FIELD_STATUS.POTVRDENE_ANO);
  });

  it("radio ANO/NE nevybrane -> NEZADANE (odlisitelne od explicitneho NE)", async () => {
    const result = await fillAndExtract(() => {});
    expect(result.results.vedouci_pracovnik.status).toBe(FIELD_STATUS.NEZADANE);
  });

  it("radio ANO/NE vybrane 'NE' -> POTVRDENE_NIE (na rozdiel od checkboxu TU je 'Nie' explicitna odpoved, nie chybajuci udaj)", async () => {
    const result = await fillAndExtract((byName) => {
      byName.get("VedouciPracovnik1").select("NE");
    });
    expect(result.results.vedouci_pracovnik.status).toBe(FIELD_STATUS.POTVRDENE_NIE);
    expect(result.results.vedouci_pracovnik.rawValue).toBe("NE");
  });

  it("radio ANO/NE vybrane 'ANO' -> POTVRDENE_ANO", async () => {
    const result = await fillAndExtract((byName) => {
      byName.get("VedouciPracovnik1").select("ANO");
    });
    expect(result.results.vedouci_pracovnik.status).toBe(FIELD_STATUS.POTVRDENE_ANO);
  });

  it("kazdy vysledok nesie svoj cielovy zapis (target) alebo null pre cisto informativne pole", async () => {
    const result = await fillAndExtract(() => {});
    expect(result.results.jmeno.target).toEqual({ table: "employees", column: "first_name" });
    expect(result.results.rodne_cislo.target).toEqual({ table: "employee_sensitive_data", column: "birth_number" });
    expect(result.results.dite1_narok.target).toEqual({ table: "employee_payroll_data", bucket: "dependents", slot: "dite1", field: "narok_danove_zvyhodneni" });
    expect(result.results.heslo_elektronicka_komunikace.target).toBeNull();
    expect(result.results.prohlaseni_podpis.target).toBeNull();
  });

  it("plne end-to-end vyplnenie viacerych sekcii naraz (identifikacia + dieta + cudzinec) dava spravne hodnoty a targety", async () => {
    const result = await fillAndExtract((byName) => {
      byName.get("Textové pole 1_2").setText("Jan");
      byName.get("Textové pole 1_3").setText("Testovací");
      byName.get("Pole pro datum 1").setText("5.3.1990");
      byName.get("Textové pole 1_23").setText("Malý Testovací");
      byName.get("NarokOsoba1").select("ANO");
      byName.get("Textové pole 1_40").setText("123456789");
      byName.get("Podleha1").select("NE");
    });
    expect(result.results.jmeno.rawValue).toBe("Jan");
    expect(result.results.prijmeni.rawValue).toBe("Testovací");
    expect(result.results.datum_narozeni.rawValue).toBe("5.3.1990");
    expect(result.results.dite1_jmeno.rawValue).toBe("Malý Testovací");
    expect(result.results.dite1_narok.status).toBe(FIELD_STATUS.POTVRDENE_ANO);
    expect(result.results.cizinec_doklad_cislo_typ.rawValue).toBe("123456789");
    expect(result.results.cizinec_podleha_socialnimu_zabezpeceni.status).toBe(FIELD_STATUS.POTVRDENE_NIE);
  });
});

describe("neznama verzia (verzia bez vyplnenej mapy poli, alebo uplne cudzi retazec)", () => {
  // "20.3.2026 C" uz NIE JE priklad neznamej verzie - realny original bol
  // medzitym dodany (hr-podklady/JMHZ_dotaznik_vyplneny_original.pdf) a jeho
  // mapa bola nezavisle overena (viz jmhzPdf.crossVersionParity.test.js).
  // Tento test preto simuluje "neznamu verziu" cez docasny prazdny zaznam v
  // mape (rovnaky mechanizmus, aky predtym chranil "20.3.2026 C" kym subor
  // chybal), aby zostalo overene, ze mechanizmus "prazdna mapa = zastav sa"
  // stale funguje pre AKUKOLVEK buducu nemapovanu verziu.
  it("verzia bez vyplnenej mapy poli sa VZDY zastavi na NEZNAMA_VERZIA, aj ked existuje ako zaznam v JMHZ_FIELD_MAPS", async () => {
    JMHZ_FIELD_MAPS["buduca-neznama-verzia-test"] = { versionLabel: "buduca-neznama-verzia-test", fields: {} };
    const ab = originalBytes.buffer.slice(originalBytes.byteOffset, originalBytes.byteOffset + originalBytes.byteLength);
    const result = await extractJmhzFields(ab, "buduca-neznama-verzia-test");
    expect(result.status).toBe("NEZNAMA_VERZIA");
    expect(result.results).toEqual({});
    delete JMHZ_FIELD_MAPS["buduca-neznama-verzia-test"];
  });

  it("uplne neznamy retazec verzie sa tiez zastavi na NEZNAMA_VERZIA", async () => {
    const ab = originalBytes.buffer.slice(originalBytes.byteOffset, originalBytes.byteOffset + originalBytes.byteLength);
    const result = await extractJmhzFields(ab, "nieco-uplne-ine");
    expect(result.status).toBe("NEZNAMA_VERZIA");
  });
});
