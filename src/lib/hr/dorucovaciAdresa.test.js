import { describe, it, expect } from "vitest";
import { valuesFromRecords, buildRecordPatches, emptyEmployeeValues } from "./employeeFields.js";

const perm = { ulice: "Krížna", cislo_popisne: "12", mesto: "Příbram", psc: "26201" };

describe("doručovací adresa", () => {
  it("nový zaměstnanec: stejná jako trvalá (zaškrtnuto)", () => {
    expect(emptyEmployeeValues().dorucovaci_stejna).toBe(true);
  });
  it("starší záznam bez příznaku: podle toho, zda je vyplněná", () => {
    expect(valuesFromRecords({ employee: { data: {}, permanent_address: perm, correspondence_address: {} } }).dorucovaci_stejna).toBe(true);
    const v = valuesFromRecords({ employee: { data: {}, permanent_address: perm, correspondence_address: { ulice: "Jiná", mesto: "Praha" } } });
    expect(v.dorucovaci_stejna).toBe(false);
    expect(v.kontakt_obec).toBe("Praha");
  });
  it("zaškrtnuto → doručovací adresa se neukládá zvlášť", () => {
    const existing = { employee: { data: {}, permanent_address: perm, correspondence_address: { ulice: "Jiná", mesto: "Praha" } } };
    const v = { ...valuesFromRecords(existing), dorucovaci_stejna: true };
    const patches = buildRecordPatches(v, existing, { mode: "edit" });
    expect(patches.employees.correspondence_address).toEqual({});
    expect(patches.employees.data.dorucovaci_stejna).toBe(true);
  });
});
