import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { emptyEmployeeValues } from "./employeeFields.js";
import { birthDateFrom, ageOn, childrenForDeclaration, childTaxWarnings, extractBirthNumber, formatBirthNumber } from "./taxChildren.js";
import { buildDeclarationData, fillDeclarationPdf } from "./prohlaseniFill.js";

describe("rodné číslo a věk", () => {
  it("datum narození z RČ (muž, žena, +20 po roce 2004) i z textu", () => {
    expect(birthDateFrom("8906247174")).toBe("1989-06-24");
    expect(birthDateFrom("055305/1234")).toBe("2005-03-05"); // zena (+50)
    expect(birthDateFrom("102215/1234")).toBe("2010-02-15"); // +20
    expect(birthDateFrom("5.3.2005, 055305/1234")).toBe("2005-03-05");
    expect(ageOn("2000-10-12", "2026-10-11")).toBe(25);
    expect(ageOn("2000-10-12", "2026-10-12")).toBe(26);
    expect(extractBirthNumber("1.2.2010, 100201/1234")).toBe("100201/1234");
    expect(formatBirthNumber("8906247174")).toBe("890624/7174");
  });
});

describe("děti v prohlášení", () => {
  const v = {
    ...emptyEmployeeValues(), deti_pocet: 4,
    dite1_jmeno: "Petr Novák", dite1_datum_rc: "100201/1234", dite1_narok: true, dite1_ztpp: true,
    dite2_jmeno: "Eva Nováková", dite2_datum_rc: "055305/1234", dite2_narok: true, dite2_studium: true,
    dite3_jmeno: "Jan Novák", dite3_datum_rc: "150101/1111", dite3_narok: false,
    dite4_jmeno: "Ema Nováková", dite4_datum_rc: "185101/1111", dite4_narok: true,
  };
  it("pořadí nároku 1./2./3./N, ZTP/P a zletilé dítě", () => {
    const d = childrenForDeclaration(v, "2027-01-01");
    expect(d.map((c) => [c.jmeno, c.prijmeni, c.narok, c.ztpp, c.zletile])).toEqual([
      ["Petr", "Novák", "1.", "X", ""],
      ["Eva", "Nováková", "2.", "", "X"],
      ["Jan", "Novák", "N", "", ""],
      ["Ema", "Nováková", "3.", "", ""],
    ]);
  });
  it("upozornění: 26 let = červeně, zletilé bez studia = oranžově", () => {
    const w = childTaxWarnings({ ...emptyEmployeeValues(), deti_pocet: 2,
      dite1_jmeno: "Starší", dite1_datum_rc: "000101/1234", dite1_narok: true,
      dite2_jmeno: "Student", dite2_datum_rc: "060101/1234", dite2_narok: true }, "2026-10-12");
    expect(w).toEqual([
      { level: "red", message: "Dítě Starší dovršilo 26 let (1.1.2026) – ukončit daňové zvýhodnění" },
      { level: "amber", message: "Dítě Student je zletilé – doložit potvrzení o studiu (§ 35c odst. 6 písm. b)" },
    ]);
  });
});

describe("vyplnění tiskopisu MFin 5457", () => {
  it("data a PDF se vytvoří", async () => {
    const v = { ...emptyEmployeeValues(), first_name: "Marta", last_name: "Duchková", birth_number: "7256160494",
      perm_ulice: "Lnáře", perm_cp: "214", perm_obec: "Lnáře", perm_psc: "38742", tax_uplatneni: true, tax_zakladni: true };
    const d = buildDeclarationData(v, 2027);
    expect(d).toMatchObject({ rok: "2027", prijmeni: "Duchková", rc: "725616/0494", adresa: "Lnáře 214, Lnáře, 38742", nerezident: null });
    expect(d.slevy).toEqual({ a: true, c: false, d: false, e: false });
    const root = path.resolve(__dirname, "../../..");
    const { bytes } = await fillDeclarationPdf(fs.readFileSync(path.join(root, "public/hr/MFin5457_vzor27.pdf")), fs.readFileSync(path.join(root, "public/hr/DejaVuSans.ttf")), v, 2027);
    expect(bytes.length).toBeGreaterThan(50000);
  });
});
