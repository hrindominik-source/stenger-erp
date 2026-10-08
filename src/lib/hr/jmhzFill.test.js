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
  start_date: "2026-09-24", vznik_zamestnani: "2026-09-24", employment_type: "doba_urcita", postaveni: "1112", pozice_kategorie: "HI-001", nazev_pozice: "dělnice",
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

describe("děti, rodinný stav, přílohy", () => {
  it("přidání a odebrání dítěte posune další děti i jejich přílohy", async () => {
    const { addChild, removeChild, countChildren, maritalStatusText, patchHasContent } = await import("./employeeFields.js");
    let v = { ...emptyEmployeeValues() };
    v = addChild(addChild(addChild(v)));
    expect(v.deti_pocet).toBe(3);
    v = { ...v, dite1_jmeno: "A", dite2_jmeno: "B", dite3_jmeno: "C",
      prilohy: [{ id: "1", kind: "rodny_list:dite2", name: "b.pdf", path: "x/b" }, { id: "2", kind: "rodny_list:dite3", name: "c.pdf", path: "x/c" }] };
    const r = removeChild(v, 2);
    expect(r.deti_pocet).toBe(2);
    expect([r.dite1_jmeno, r.dite2_jmeno, r.dite3_jmeno]).toEqual(["A", "C", ""]);
    expect(r.prilohy).toEqual([{ id: "2", kind: "rodny_list:dite2", name: "c.pdf", path: "x/c" }]);
    expect(countChildren(r)).toBe(2);
    const p = buildRecordPatches(r, {}, { mode: "create" });
    expect(p.payroll.dependents.map((d) => d.slot)).toEqual(["dite1", "dite2"]);
    expect(p.payroll.data.prilohy).toHaveLength(1);
    expect(maritalStatusText("zenaty_vdana", "zena")).toBe("vdaná");
    expect(maritalStatusText("zenaty_vdana", "muz")).toBe("ženatý");
    expect(patchHasContent({ dependents: [], data: { prilohy: [] } })).toBe(false);
  });

  it("6 dětí: JMHZ vyplní první 4 a upozorní na zbytek", async () => {
    const { addChild } = await import("./employeeFields.js");
    let v = { ...duchkova };
    for (let i = 0; i < 6; i++) v = addChild(v);
    for (let i = 1; i <= 6; i++) v[`dite${i}_jmeno`] = `Dítě ${i}`;
    const { skipped } = await fillJmhzPdf(template, font, v);
    expect(skipped.map((s) => s.label)).toEqual(["Děti 5–6"]);
  });
});

describe("K. Mzdové podmínky a příplatky", () => {
  it("mzda se uloží do payroll.data spolu s přílohami a načte zpět", () => {
    const v = { ...duchkova, mzda_typ: "smluvni", mzda_castka: "32000", priplatek_noc: "15", priplatek_vikend: "20", stravenkovy_pausal: true, dovolena_hod: "160",
      prilohy: [{ id: "a", kind: "exekuce", name: "x.pdf", path: "p/x.pdf" }] };
    const p = buildRecordPatches(v, { payroll: { data: { cizi: 1 } } }, { mode: "edit" });
    expect(p.payroll.data.cizi).toBe(1);
    expect(p.payroll.data.mzda_historie).toHaveLength(1);
    expect(p.payroll.data.mzda_historie[0]).toMatchObject({ platnost_od: "2026-09-24", mzda_typ: "smluvni", mzda_castka: "32000", priplatek_prescas_pct: "25", priplatek_noc_kc: "15", stravenkovy_pausal: true, dovolena_hod: "160" });
    expect(p.payroll.data.prilohy).toHaveLength(1);
    const back = valuesFromRecords({ payroll: p.payroll });
    expect([back.mzda_typ, back.mzda_castka, back.priplatek_vikend, back.stravenkovy_pausal]).toEqual(["smluvni", "32000", "20", true]);
  });
});

describe("historie mzdy", () => {
  it("změna mzdy s novým datem přidá záznam, stará zůstane; platná je poslední k dnešku", async () => {
    const m = await import("./employeeFields.js");
    let data = m.addWageEntry({}, { platnost_od: "2025-01-01", mzda_typ: "hodinova", mzda_castka: "155" });
    // Osobni udaje: stejne datum + jina castka = oprava, nove datum = novy zaznam
    const v = { ...m.valuesFromRecords({ payroll: { data } }) };
    expect(v.mzda_castka).toBe("155");
    const p = m.buildRecordPatches({ ...v, mzda_castka: "165", mzda_platnost_od: "2026-01-01" }, { payroll: { data } }, { mode: "edit" });
    const h = p.payroll.data.mzda_historie;
    expect(h.map((e) => [e.platnost_od, e.mzda_castka])).toEqual([["2025-01-01", "155"], ["2026-01-01", "165"]]);
    expect(m.currentWage({ mzda_historie: h }, "2025-06-01").mzda_castka).toBe("155");
    expect(m.currentWage({ mzda_historie: h }, "2026-02-01").mzda_castka).toBe("165");
    // beze zmeny -> historie zustava stejna
    const p2 = m.buildRecordPatches(m.valuesFromRecords({ payroll: { data: { mzda_historie: h } } }), { payroll: { data: { mzda_historie: h } } }, { mode: "edit" });
    expect(p2.payroll.data.mzda_historie).toHaveLength(2);
  });

  it("starší ploché údaje se převezmou jako první záznam", async () => {
    const m = await import("./employeeFields.js");
    const legacy = { mzda_typ: "hodinova", mzda_castka: "155" };
    expect(m.currentWage(legacy).mzda_castka).toBe("155");
    const next = m.addWageEntry(legacy, { platnost_od: "2026-05-01", mzda_typ: "hodinova", mzda_castka: "165" });
    expect(next.mzda_historie.map((e) => e.mzda_castka)).toEqual(["155", "165"]);
  });

  it("upozornění 155 -> 165 po roce od nástupu", async () => {
    const m = await import("./employeeFields.js");
    const data = m.addWageEntry({}, { platnost_od: "2025-10-15", mzda_typ: "hodinova", mzda_castka: "155" });
    expect(m.wageStepHint(data, "2025-10-15", "2026-10-08")).toMatchObject({ date: "2026-10-15", to: "165", overdue: false });
    expect(m.wageStepHint(data, "2025-10-15", "2026-05-01")).toBeNull();
    const done = m.addWageEntry(data, { platnost_od: "2026-10-15", mzda_typ: "hodinova", mzda_castka: "165" });
    expect(m.wageStepHint(done, "2025-10-15", "2026-10-08")).toBeNull();
  });
});

describe("exekuce", () => {
  it("Ano/Ne se ukládá do základních údajů (vidí všichni), i bez mzdového oprávnění", async () => {
    const m = await import("./employeeFields.js");
    const p = m.buildRecordPatches({ ...duchkova, exekuce: true }, {}, { mode: "edit", canSensitive: false, canPayroll: false });
    expect(p.employees.data.exekuce).toBe(true);
    expect(p.payroll).toBeNull();
    const f = m.ALL_FIELDS.find((x) => x.key === "exekuce");
    expect(m.fieldVisibleInMode(f, { mode: "edit", canSensitive: false, canPayroll: false })).toBe(true);
    // starsi zaznam z importu (payroll.garnishments) sa prevezme
    expect(m.valuesFromRecords({ employee: { data: {} }, payroll: { garnishments: { exekuce_insolvence_prohlaseni: true } } }).exekuce).toBe(true);
  });
});

describe("zkušební doba", () => {
  it("výpočet konce a upozornění", async () => {
    const m = await import("./employeeFields.js");
    expect(m.addMonthsIsoLib("2026-10-01", 4)).toBe("2027-01-31");
    expect(m.addMonthsIsoLib("2026-01-31", 1)).toBe("2026-02-28");
    expect(m.probationWarning({ zkusebni_doba_mesice: "6", vedouci: false })).toMatch(/vedoucího/);
    expect(m.probationWarning({ zkusebni_doba_mesice: "6", vedouci: true })).toBeNull();
    expect(m.probationWarning({ employment_type: "doba_urcita", start_date: "2026-01-01", fixed_term_end_date: "2026-06-30", probation_end_date: "2026-04-30" })).toMatch(/polovinu/);
  });
});
