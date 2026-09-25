import { describe, it, expect } from "vitest";
import { parseCzechDateToIso, resolveExistingValue, buildComparisonRows } from "./jmhzImport.js";

describe("parseCzechDateToIso", () => {
  it("parsuje platny d.m.rrrr format", () => {
    expect(parseCzechDateToIso("5.3.1990")).toBe("1990-03-05");
    expect(parseCzechDateToIso("25.12.2026")).toBe("2026-12-25");
  });
  it("prazdny/chybajuci vstup vrati null (nie hadanie)", () => {
    expect(parseCzechDateToIso("")).toBeNull();
    expect(parseCzechDateToIso(null)).toBeNull();
  });
  it("nerozpoznatelny format vrati null namiesto nespravneho hadania", () => {
    expect(parseCzechDateToIso("1990-03-05")).toBeNull();
    expect(parseCzechDateToIso("bla bla")).toBeNull();
    expect(parseCzechDateToIso("32.1.2020")).toBeNull();
  });
});

describe("resolveExistingValue", () => {
  const baseCtx = {
    employee: { first_name: "Jan", permanent_address: { ulice: "Hlavní 1" } },
    sensitive: { birth_number: "9003051234" },
    payroll: { tax_declaration: { uplatneni_prohlaseni: true }, dependents: [{ slot: "dite1", jmeno: "Malý Jan" }] },
    currentEmployment: { id: "em1", start_date: "2026-01-01", workplace: "Sklad" },
    canSensitive: true, canPayroll: true, canEditEmployment: true,
  };

  it("target=null je nezapisatelny (informativne pole)", () => {
    expect(resolveExistingValue(null, baseCtx)).toEqual({ value: null, writable: false, reason: expect.any(String) });
  });

  it("employees stlpec bez path", () => {
    expect(resolveExistingValue({ table: "employees", column: "first_name" }, baseCtx)).toEqual({ value: "Jan", writable: true });
  });

  it("employees jsonb s path", () => {
    expect(resolveExistingValue({ table: "employees", column: "permanent_address", path: "ulice" }, baseCtx)).toEqual({ value: "Hlavní 1", writable: true });
  });

  it("employee_sensitive_data bez opravnenia je zablokovane", () => {
    const r = resolveExistingValue({ table: "employee_sensitive_data", column: "birth_number" }, { ...baseCtx, canSensitive: false });
    expect(r.writable).toBe(false);
    expect(r.value).toBeNull();
  });

  it("employee_sensitive_data s opravnenim cita hodnotu", () => {
    expect(resolveExistingValue({ table: "employee_sensitive_data", column: "birth_number" }, baseCtx)).toEqual({ value: "9003051234", writable: true });
  });

  it("employment_relationships bez aktivneho pomeru je zablokovane s dovodom", () => {
    const r = resolveExistingValue({ table: "employment_relationships", column: "start_date" }, { ...baseCtx, currentEmployment: null });
    expect(r.writable).toBe(false);
  });

  it("employment_relationships s pomerom cita hodnotu", () => {
    expect(resolveExistingValue({ table: "employment_relationships", column: "workplace" }, baseCtx)).toEqual({ value: "Sklad", writable: true });
  });

  it("employee_payroll_data bucket cita hodnotu", () => {
    expect(resolveExistingValue({ table: "employee_payroll_data", bucket: "tax_declaration", field: "uplatneni_prohlaseni" }, baseCtx)).toEqual({ value: true, writable: true });
  });

  it("employee_payroll_data dependents slot cita hodnotu podla slot mena", () => {
    expect(resolveExistingValue({ table: "employee_payroll_data", bucket: "dependents", slot: "dite1", field: "jmeno" }, baseCtx)).toEqual({ value: "Malý Jan", writable: true });
  });

  it("employee_payroll_data dependents chybajuci slot vrati prazdnu hodnotu, nie chybu", () => {
    expect(resolveExistingValue({ table: "employee_payroll_data", bucket: "dependents", slot: "dite2", field: "jmeno" }, baseCtx)).toEqual({ value: "", writable: true });
  });
});

describe("buildComparisonRows", () => {
  const ctx = {
    employee: { first_name: "Existující", date_of_birth: "1990-03-05" },
    sensitive: {},
    payroll: {},
    currentEmployment: { id: "em1" },
    canSensitive: true, canPayroll: true, canEditEmployment: true,
  };

  it("NEZADANE riadky sa vynechaju uplne", () => {
    const rows = buildComparisonRows({ jmeno: { status: "NEZADANE", kind: "text", target: { table: "employees", column: "first_name" }, label: "Jméno" } }, ctx);
    expect(rows).toEqual([]);
  });

  it("nova hodnota (existujuca prazdna) - bez konfliktu, predvolene zaskrtnute", () => {
    const rows = buildComparisonRows({ prijmeni: { status: "POTVRDENE_ANO", kind: "text", rawValue: "Nový", target: { table: "employees", column: "last_name" }, label: "Příjmení" } }, ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ existingValue: "", proposedValue: "Nový", hasConflict: false, writable: true, defaultChecked: true });
  });

  it("zhodna hodnota - bez konfliktu (rovnaka), predvolene zaskrtnute", () => {
    const rows = buildComparisonRows({ jmeno: { status: "POTVRDENE_ANO", kind: "text", rawValue: "Existující", target: { table: "employees", column: "first_name" }, label: "Jméno" } }, ctx);
    expect(rows[0].hasConflict).toBe(false);
    expect(rows[0].defaultChecked).toBe(true);
  });

  it("KONFLIKT (existujuca aj navrhovana hodnota su rozdielne a nie prazdne) - predvolene NEzaskrtnute", () => {
    const rows = buildComparisonRows({ jmeno: { status: "POTVRDENE_ANO", kind: "text", rawValue: "Iné Jméno", target: { table: "employees", column: "first_name" }, label: "Jméno" } }, ctx);
    expect(rows[0].hasConflict).toBe(true);
    expect(rows[0].defaultChecked).toBe(false);
    expect(rows[0].writable).toBe(true); // stale sa DA zapisat, len vyzaduje explicitne potvrdenie
  });

  it("datum sa spravne prevedie na ISO pre zapis, ale zobrazuje sa povodny cesky format", () => {
    const rows = buildComparisonRows({ datum_narozeni: { status: "POTVRDENE_ANO", kind: "date", rawValue: "6.4.1985", target: { table: "employees", column: "date_of_birth" }, label: "Datum narození" } }, ctx);
    expect(rows[0].proposedValue).toBe("1985-04-06");
    expect(rows[0].proposedDisplay).toBe("6.4.1985");
  });

  it("nerozpoznatelny datum je nezapisatelny s dovodom, aj ked existujuca hodnota je prazdna", () => {
    const rows = buildComparisonRows({ datum_narozeni: { status: "POTVRDENE_ANO", kind: "date", rawValue: "neplatny-format", target: { table: "employees", column: "date_of_birth" }, label: "Datum narození" } }, ctx);
    expect(rows[0].writable).toBe(false);
    expect(rows[0].defaultChecked).toBe(false);
    expect(rows[0].blockedReason).toMatch(/formát/);
  });

  it("VYZADUJE_KONTROLU riadok (pole sa v PDF nenaslo) je vzdy nezapisatelny a nezaskrtnuty", () => {
    const rows = buildComparisonRows({ x: { status: "VYZADUJE_KONTROLU", kind: "text", rawValue: null, target: { table: "employees", column: "first_name" }, label: "X", note: "Pole nenalezeno" } }, ctx);
    expect(rows[0].writable).toBe(false);
    expect(rows[0].defaultChecked).toBe(false);
    expect(rows[0].blockedReason).toBe("Pole nenalezeno");
  });

  it("chybajuce opravnenie (napr. HR_VIEW_SENSITIVE) blokuje riadok aj ked v PDF hodnota je", () => {
    const rows = buildComparisonRows(
      { rodne_cislo: { status: "POTVRDENE_ANO", kind: "text", rawValue: "9003051234", target: { table: "employee_sensitive_data", column: "birth_number" }, label: "Rodné číslo" } },
      { ...ctx, canSensitive: false }
    );
    expect(rows[0].writable).toBe(false);
    expect(rows[0].defaultChecked).toBe(false);
  });

  it("checkbox typ (ANO/zaskrtnuto) navrhuje boolean true", () => {
    const rows = buildComparisonRows(
      { tax_zakladni_sleva: { status: "POTVRDENE_ANO", kind: "checkbox", rawValue: true, target: { table: "employee_payroll_data", bucket: "tax_declaration", field: "zakladni_sleva" }, label: "Sleva" } },
      ctx
    );
    expect(rows[0].proposedValue).toBe(true);
  });

  it("radio_ano_ne s POTVRDENE_NIE navrhuje boolean false (nie je to 'NEZADANE')", () => {
    const rows = buildComparisonRows(
      { vedouci_pracovnik: { status: "POTVRDENE_NIE", kind: "radio_ano_ne", rawValue: "NE", target: { table: "employee_payroll_data", bucket: "concurrent_employment", field: "vedouci_pracovnik" }, label: "Vedoucí" } },
      ctx
    );
    expect(rows[0].proposedValue).toBe(false);
    expect(rows[0].proposedDisplay).toBe("Ne");
  });
});
