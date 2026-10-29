import { describe, it, expect } from "vitest";
import { valuesFromRecords, buildRecordPatches, emptyEmployeeValues, childBirthText, EMPLOYEE_SECTIONS, countChildren } from "./employeeFields.js";
import { childrenForDeclaration } from "./taxChildren.js";

const fields = (id) => EMPLOYEE_SECTIONS.find((s) => s.id === id).fields;

describe("dítě: datum narození a rodné číslo zvlášť", () => {
  it("starší záznam s jedním polem se rozdělí", () => {
    const v = valuesFromRecords({ payroll: { dependents: [{ slot: "dite1", jmeno: "Petr Novák", datum_narozeni_rc: "1.2.2010, 100201/1234" }] } });
    expect(v.dite1_datum_narozeni).toBe("2010-02-01");
    expect(v.dite1_rc).toBe("100201/1234");
    expect(v.deti_pocet).toBe(1);
  });
  it("starší záznam jen s RČ / s nerozpoznaným textem se neztratí", () => {
    const v = valuesFromRecords({ payroll: { dependents: [
      { slot: "dite1", jmeno: "A", datum_narozeni_rc: "100201/1234" },
      { slot: "dite2", jmeno: "B", datum_narozeni_rc: "nevím" },
    ] } });
    expect([v.dite1_datum_narozeni, v.dite1_rc]).toEqual(["", "100201/1234"]);
    expect(v.dite2_rc).toBe("nevím");
  });
  it("uložení: obě pole zvlášť + společný text pro JMHZ a prohlášení", () => {
    const v = { ...emptyEmployeeValues(), deti_pocet: 1, dite1_jmeno: "Eva Nová", dite1_datum_narozeni: "2012-05-03", dite1_rc: "125503/1234" };
    const d = buildRecordPatches(v, {}, { mode: "edit" }).payroll.dependents.find((x) => x.slot === "dite1");
    expect(d).toMatchObject({ datum_narozeni: "2012-05-03", rodne_cislo: "125503/1234", datum_narozeni_rc: "3.5.2012, 125503/1234" });
    expect(childBirthText(v, "dite1")).toBe("3.5.2012, 125503/1234");
  });
  it("výpočty (věk, RČ do prohlášení) berou nová pole", () => {
    const v = { deti_pocet: 1, dite1_jmeno: "Eva Nová", dite1_datum_narozeni: "2012-05-03", dite1_rc: "125503/1234", dite1_narok: true };
    const [c] = childrenForDeclaration(v, "2026-10-29");
    expect(c.rc).toBe("125503/1234");
    expect(c.age).toBe(14);
  });
  it("vyplněné jen datum narození = dítě se počítá", () => {
    expect(countChildren({ dite1_datum_narozeni: "2012-05-03" })).toBe(1);
  });
});

describe("sekce D a J", () => {
  it("D: kontaktní adresa", () => {
    const s = EMPLOYEE_SECTIONS.find((x) => x.id === "adresa_kontaktni");
    expect(s.title).toBe("Kontaktní adresa");
    expect(s.fields[0].label).toBe("Kontaktní adresa je stejná jako adresa trvalého pobytu");
  });
  it("D: dvojice vedle sebe (telefon/e-mail, doklad/číslo, účet)", () => {
    const starts = fields("kontakt").filter((f) => f.rowStart).map((f) => f.key);
    expect(starts).toEqual(["phone", "id_document_type", "bank_account", "heslo_pasky"]);
  });
  it("J: místo průběhu práce 1–4, pevné místo / kód obce / obec, zvláštní odstavec do smlouvy", () => {
    const keys = fields("pozice").map((f) => f.key);
    const i = keys.indexOf("misto_cssz_nadpis");
    expect(keys.slice(i)).toEqual(["misto_cssz_nadpis", "misto_prubehu", "workplace", "kod_obce", "obec_vykonu", "misto_smlouva_nadpis", "misto_vykonu_smlouva"]);
    const f = Object.fromEntries(fields("pozice").map((x) => [x.key, x]));
    expect(f.misto_prubehu.options.map((o) => o.value)).toEqual(["1", "2", "3", "4"]);
    expect([f.workplace.fixedValue, f.kod_obce.fixedValue, f.obec_vykonu.fixedValue]).toEqual(["Plynárenská 366, 261 01 Příbram", "539911", "Příbram"]);
    const p = buildRecordPatches({ ...emptyEmployeeValues(), misto_prubehu: "2" }, {}, { mode: "create" }).employment;
    expect(p.data.misto_prubehu_prace).toBe("2");
    expect(p.workplace).toBe("Plynárenská 366, 261 01 Příbram");
  });
});
