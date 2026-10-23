import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import PizZip from "pizzip";
import { fillDocxTemplate, extractTemplateKeys } from "./docxTemplate.js";
import { buildPsData, psMissing, psVariant, hoursInWords, probationText, defaultPovinnosti } from "./pracovniSmlouva.js";

// Vymyslene osoby s plnou mocou (realne su v DB hr_signatories).
const SIG_A = { full_name: "Mgr. Jana Zkušební", full_name_instrumental: "Mgr. Janou Zkušební" };
const SIG_B = { full_name: "Ing. Petr Vzorový", full_name_instrumental: "Ing. Petrem Vzorovým" };

const tpl = (name) => {
  const b = readFileSync(new URL(`../../../public/hr/sablony/${name}.docx`, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const docText = (ab) => new PizZip(ab).file("word/document.xml").asText().replace(/<[^>]+>/g, "");

const cz = {
  title: "Ing.", first_name: "Jana", last_name: "Nováková", maiden_name: "Svobodová", gender: "zena",
  date_of_birth: "1990-03-05", place_of_birth: "Příbram", nationality: "Česká republika", birth_number: "905305/1234",
  rodinny_stav: "vdana", id_document_number: "123456789", perm_ulice: "Dlouhá", perm_cp: "12", perm_obec: "Příbram", perm_psc: "26101",
  phone: "+420 777 111 222", private_email: "jana@example.cz", health_insurance_company: "111", bank_account: "123456789/0100",
  pozice_kategorie: "HI-001", nazev_pozice: "dělnice", start_date: "2026-11-01", zkusebni_doba_mesice: "4",
  employment_type: "doba_urcita", fixed_term_end_date: "2027-10-31", weekly_hours: "40",
};

describe("pracovní smlouva", () => {
  it("hodiny slovy", () => {
    expect(hoursInWords("40")).toBe("čtyřicet");
    expect(hoursInWords("38,75")).toBe("třicet osm celých sedmdesát pět setin");
    expect(hoursInWords("37.5")).toBe("třicet sedm celých pět desetin");
    expect(hoursInWords("20")).toBe("dvacet");
    expect(hoursInWords("abc")).toBe("");
  });
  it("zkušební doba a povinnosti", () => {
    expect(probationText("4")).toBe("4 měsíce");
    expect(probationText("1")).toBe("1 měsíc");
    expect(probationText("6")).toBe("6 měsíců");
    expect(probationText("0")).toBe("");
    expect(defaultPovinnosti({ gender: "zena", pozice_kategorie: "HI-001" })).toMatch(/^Mezi základní povinnosti dělnice patří výroba popcornu/);
    expect(defaultPovinnosti({ gender: "zena", pozice_kategorie: "HI-002", nazev_pozice: "skladnice" })).toMatch(/^Mezi základní povinnosti zaměstnance na pozici skladnice patří příjem, skladování/);
    expect(defaultPovinnosti({ pozice_kategorie: "HI-003" })).toMatch(/^Mezi základní povinnosti zaměstnance patří administrativní/);
    expect(defaultPovinnosti({ pozice_kategorie: "XX" })).toBe("");
  });
  it("varianta podle občanství", () => {
    expect(psVariant(cz)).toBe("pracovni_smlouva");
    expect(psVariant({ ...cz, nationality: "Ukrajina" })).toBe("pracovni_smlouva_cizinec");
  });
  it("chybějící údaje", () => {
    const d = buildPsData(cz, {});
    expect(psMissing(d, "pracovni_smlouva")).toEqual(["Za zaměstnavatele podepisuje", "Datum podpisu"]);
    const d2 = buildPsData({ ...cz, fixed_term_end_date: "" }, { podepisujici: SIG_A, datumPodpisu: "2026-10-20" });
    expect(psMissing(d2, "pracovni_smlouva")).toEqual(["Doba trvání"]);
  });
  it("vyplní vzor ČR bez zbytků", () => {
    const keys = extractTemplateKeys(tpl("pracovni_smlouva"));
    const d = buildPsData(cz, { podepisujici: SIG_A, datumPodpisu: "2026-10-20" });
    keys.forEach((k) => expect(d).toHaveProperty(k));
    const t = docText(fillDocxTemplate(tpl("pracovni_smlouva"), d));
    expect(t).not.toMatch(/\{\{|…{3}/);
    expect(t).toContain("zastoupená Mgr. Janou Zkušební, na základě plné moci");
    expect(t).toContain("Jméno:Ing. Jana Nováková roz.: Svobodová");
    expect(t).toContain("vykonávat práci jako dělnice.");
    expect(t).toContain("Mezi základní povinnosti dělnice patří výroba popcornu");
    expect(t).toContain("sjednán den 1.11.2026.");
    expect(t).toContain("na dobu určitou, a to do 31.10.2027.");
    expect(t).toContain("rozsahu 40 (slovy „čtyřicet“) hodin");
    expect(t).toContain("V Příbrami dne 20.10.2026");
    expect(t).toContain("Dlouhá 12, 26101 Příbram");
  });
  it("vyplní vzor pro cizince", () => {
    const v = { ...cz, nationality: "Ukrajina", cz_doklad_cislo: "FX123456", cislo_pojistence: "9003051234", weekly_hours: "38,75", employment_type: "doba_neurcita" };
    const d = buildPsData(v, { podepisujici: SIG_B, datumPodpisu: "2026-10-20" });
    expect(psMissing(d, "pracovni_smlouva_cizinec")).toEqual([]);
    const keys = extractTemplateKeys(tpl("pracovni_smlouva_cizinec"));
    keys.forEach((k) => expect(d).toHaveProperty(k));
    const t = docText(fillDocxTemplate(tpl("pracovni_smlouva_cizinec"), d));
    expect(t).not.toMatch(/\{\{|…{3}/);
    expect(t).toContain("zastoupená Ing. Petrem Vzorovým");
    expect(t).toContain("Příslušnost:Ukrajina");
    expect(t).toContain("Číslo pasu:FX123456");
    expect(t).toContain("(rod. číslo OSSZ: 9003051234)");
    expect(t).toContain("na dobu neurčitou.");
    expect(t).toContain("třicet osm celých sedmdesát pět setin");
    expect(t).toContain("platné vízum");
  });
});
