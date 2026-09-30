import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { emptyEmployeeValues, buildRecordPatches, valuesFromRecords } from "./employeeFields.js";
import { fillJmhzPdf, isoToCz } from "./jmhzFill.js";
import { extractJmhzFields } from "./jmhzPdf.js";

const root = path.resolve(__dirname, "../../..");
const template = fs.readFileSync(path.join(root, "public/hr/JMHZ_dotaznik_2026-03-20C.pdf"));
const font = fs.readFileSync(path.join(root, "public/hr/DejaVuSans.ttf"));

// Udaje z testovacej ČSSZ registracie (Duchková Marta, vznik PPV 24.9.2026).
const duchkova = {
  ...emptyEmployeeValues(),
  first_name: "Marta", last_name: "Duchková", maiden_name: "Nováková", date_of_birth: "1972-06-16",
  birth_number: "7256160494", gender: "zena", place_of_birth: "Praha",
  perm_ulice: "Lnáře", perm_cp: "214", perm_obec: "Lnáře", perm_psc: "38742",
  kontakt_ulice: "Čelakovské-Rajské", kontakt_cp: "208", kontakt_obec: "Rožmitál pod Třemšínem", kontakt_psc: "26242", kontakt_stat: "Česká republika",
  highest_education: "H", health_insurance_company: "205",
  start_date: "2026-09-24", vznik_zamestnani: "2026-09-24", employment_type: "doba_urcita", postaveni: "1112",
  bank_account: "123456789/0800",
  tax_uplatneni: true, tax_zakladni: true,
  dite1_jmeno: "Petr Duchek", dite1_datum_rc: "1.2.2010", dite1_narok: true, dite1_studium: true, dite1_neuplatneni: false,
};

describe("jmhzFill", () => {
  it("isoToCz formátuje d.m.rrrr bez nul", () => {
    expect(isoToCz("1972-06-16")).toBe("16.6.1972");
    expect(isoToCz("")).toBe("");
  });

  it("vyplněný dotazník se zpětně přečte importem na správná pole", async () => {
    const { bytes, skipped } = await fillJmhzPdf(template, font, duchkova);
    expect(skipped).toEqual([]);
    const { status, results } = await extractJmhzFields(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "20.3.2026 C");
    expect(status).toBe("OK");
    const r = (k) => results[k].rawValue;
    expect(r("jmeno")).toBe("Marta");
    expect(r("prijmeni")).toBe("Duchková");
    expect(r("rodne_prijmeni")).toBe("Nováková");
    expect(r("datum_narozeni")).toBe("16.6.1972");
    expect(r("pohlavi")).toBe("Žena");
    expect(r("statni_obcanstvi")).toBe("Česká republika");
    expect(r("trvale_ulice")).toBe("Lnáře 214");
    expect(r("trvale_obec")).toBe("Lnáře, 38742, Česká republika");
    expect(r("koresp_ulice")).toBe("Čelakovské-Rajské 208");
    expect(r("nejvyssi_vzdelani")).toMatch(/^H - Střední odborné vzdělání s výučním listem/);
    expect(r("zdravotni_pojistovna")).toMatch(/^205 - Česká průmyslová/);
    expect(r("tax_uplatneni_prohlaseni")).toBe("ANO");
    expect(r("tax_zakladni_sleva")).toBe(true);
    expect(r("dite1_jmeno")).toBe("Petr Duchek");
    expect(r("dite1_neuplatneni")).toBe("NE");
    expect(r("datum_nastupu")).toBe("24.9.2026");
    expect(r("adresa_vykonu_prace")).toBe("Plynárenská 366, 261 01 Příbram");
    expect(r("pracovni_pozice_nazev")).toBe("dělnice");
    expect(r("ztpp_drzitel")).toBe("NE");
    // Cesky obcan -> strana 7 (cudzinec) prazdna, podpis/datum prazdne.
    expect(results.cizinec_doklad_cislo_typ.status).toBe("NEZADANE");
    expect(results.prohlaseni_podpis.status).toBe("NEZADANE");
  });
});

describe("employeeFields - zápis a čtení", () => {
  it("round-trip hodnot přes DB záznamy", () => {
    const p = buildRecordPatches(duchkova, {}, { mode: "create" });
    expect(p.employees.permanent_address).toMatchObject({ ulice: "Lnáře", cislo_popisne: "214", mesto: "Lnáře", psc: "38742", stat: "Česká republika" });
    expect(p.employment.workplace).toBe("Plynárenská 366, 261 01 Příbram");
    expect(p.employment.data).toMatchObject({ postaveni: "1112", kod_obce: "539911", profese: "81830" });
    expect(p.payroll.dependents).toEqual([{ slot: "dite1", jmeno: "Petr Duchek", datum_narozeni_rc: "1.2.2010", narok_danove_zvyhodneni: true, potvrzeni_studia: true, potvrzeni_neuplatneni_druhym: false }]);
    const back = valuesFromRecords({
      employee: p.employees, sensitive: p.sensitive, payroll: p.payroll,
      employment: { ...p.employment, start_date: "2026-09-24", employment_type: "doba_urcita" },
    });
    for (const k of ["first_name", "perm_cp", "kontakt_obec", "highest_education", "health_insurance_company", "dite1_neuplatneni", "tax_zakladni", "postaveni"]) {
      expect(back[k]).toEqual(duchkova[k]);
    }
  });

  it("zachová jsonb podpole, která formulář nezná", () => {
    const existing = { employee: { data: { cizi_klic: 1 }, permanent_address: { poznamka: "x" } } };
    const p = buildRecordPatches(duchkova, existing, { mode: "edit" });
    expect(p.employees.data.cizi_klic).toBe(1);
    expect(p.employees.permanent_address.poznamka).toBe("x");
  });

  it("bez oprávnění nesahá na citlivé a mzdové údaje", () => {
    const p = buildRecordPatches(duchkova, {}, { mode: "edit", canSensitive: false, canPayroll: false });
    expect(p.sensitive).toBeNull();
    expect(p.payroll).toBeNull();
  });

  it("převede starší import (Muž, 'H - ...', '205 - ...') na kódy", () => {
    const v = valuesFromRecords({ employee: { gender: "Muž", highest_education: "H - Střední odborné vzdělání s výučním listem", health_insurance_company: "205 - Česká průmyslová zdravotní pojišťovna\t" } });
    expect(v.gender).toBe("muz");
    expect(v.highest_education).toBe("H");
    expect(v.health_insurance_company).toBe("205");
  });
});
