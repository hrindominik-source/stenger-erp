import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { emptyEmployeeValues } from "./employeeFields.js";
import { childMonthsForYear, employedMonths, taxYearStatus, settlementWarning, rzWarnings } from "./taxYear.js";
import { fill5558Pdf, fill5457bPdf } from "./taxForms.js";

const root = path.resolve(__dirname, "../../..");
const font = () => fs.readFileSync(path.join(root, "public/hr/DejaVuSans.ttf"));
const base = { ...emptyEmployeeValues(), first_name: "Dominik", last_name: "Hriň", birth_number: "8906247174",
  perm_ulice: "Dedinka", perm_cp: "133", perm_obec: "Dedinka", perm_psc: "94150" };

describe("měsíce nároku na děti (5558)", () => {
  it("pracovní poměr od dubna, dítě narozené v červnu, druhé dovrší 26 v březnu", () => {
    expect(employedMonths(2026, { start_date: "2026-04-15" })).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const v = { ...base, deti_pocet: 2,
      dite1_jmeno: "Petr Hriň", dite1_datum_rc: "260610/1234", dite1_narok: true,
      dite2_jmeno: "Eva Hriňová", dite2_datum_rc: "005310/1234", dite2_narok: true };
    expect(childMonthsForYear(v, 2026, { start_date: "2025-01-01" }).map((c) => [c.jmeno, c.poradi, c.mesice])).toEqual([["Petr", 1, 7], ["Eva", 2, 3]]);
    expect(childMonthsForYear(v, 2026, { start_date: "2026-04-15" }).map((c) => c.mesice)).toEqual([7]);
  });
});

describe("stav roku a upozornění", () => {
  const payroll = { data: { prohlaseni_poplatnika: [{ rok: 2026 }], dane: { 2026: { vyuctovani: "rz", doklady: [] } } } };
  it("stav a připomínka 15.2.", () => {
    expect(taxYearStatus(payroll, 2026).vyuctovani).toBe("rz_rozpracovano");
    expect(settlementWarning(payroll, false, new Date(2027, 0, 20)).level).toBe("amber");
    expect(settlementWarning(payroll, false, new Date(2027, 1, 16)).level).toBe("red");
    expect(settlementWarning(payroll, false, new Date(2027, 4, 1))).toBeNull();
    expect(settlementWarning({ data: {} }, false, new Date(2027, 0, 20))).toBeNull();
  });
  it("limity RZ", () => {
    expect(rzWarnings({ polozky: { dps: 30000, zivotni: 24000 } })[0]).toContain("limit je");
  });
});

describe("vyplnění tiskopisů", () => {
  it("5558 a 5457/B", async () => {
    const v = { ...base, deti_pocet: 1, dite1_jmeno: "Petr Hriň", dite1_datum_rc: "150610/1234", dite1_narok: true };
    const a = await fill5558Pdf(fs.readFileSync(path.join(root, "public/hr/MFin5558_vzor3.pdf")), font(), v, 2026, { start_date: "2020-01-01" },
      { vyhotovil: "Markéta Novotná", kontakt: "775 085 226, mn@stenger.eu", dne: "2026-10-13" });
    expect(a.data.uplatnil).toBe(true);
    const b = await fill5457bPdf(fs.readFileSync(path.join(root, "public/hr/MFin5457B_vzor4.pdf")), font(), v, 2026,
      { polozky: { uroky: 45210, dps: 12000 }, uver_od2021: true, adresa_bytu: "Dedinka 133, 941 50 Dedinka",
        predchozi: [{ obdobi: "1–3", platce: "ABC s.r.o., Praha" }], exekuce: 450,
        manzel: { jmeno: "Jana", prijmeni: "Hriňová", rc: "905512/1234", mesice: "1–12" }, manzel_deti: [{ jmeno: "Petr", prijmeni: "Hriň", rc: "250610/1234" }] },
      [{ name: "potvrzeni_uroky.pdf" }, { name: "LV.pdf" }]);
    if (process.env.TAX_OUT) { fs.writeFileSync(path.join(process.env.TAX_OUT, "t5558.pdf"), a.bytes); fs.writeFileSync(path.join(process.env.TAX_OUT, "t5457b.pdf"), b.bytes);
      const c = await fill5558Pdf(fs.readFileSync(path.join(root, "public/hr/MFin5558_vzor3.pdf")), font(), base, 2026, null, { vyhotovil: "X", dne: "2026-10-13" });
      fs.writeFileSync(path.join(process.env.TAX_OUT, "t5558_ne.pdf"), c.bytes); }
    expect(b.bytes.length).toBeGreaterThan(50000);
  });
});
