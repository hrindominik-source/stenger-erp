import { describe, it, expect } from "vitest";
import { computeMedicalStatus, MEDICAL_STATUS, DEFAULT_EXPIRING_THRESHOLD_DAYS } from "./hrMedicalStatus.js";

describe("computeMedicalStatus", () => {
  it("platnost daleko v buducnosti -> VALID", () => {
    expect(computeMedicalStatus("2026-12-31", "2026-01-01")).toBe(MEDICAL_STATUS.VALID);
  });
  it("platnost presne na hranici prahu (default 60 dni) -> EXPIRING", () => {
    expect(computeMedicalStatus("2026-03-02", "2026-01-01")).toBe(MEDICAL_STATUS.EXPIRING); // 60 dni
  });
  it("platnost tesne za prahom -> este VALID", () => {
    expect(computeMedicalStatus("2026-03-03", "2026-01-01")).toBe(MEDICAL_STATUS.VALID); // 61 dni
  });
  it("platnost v minulosti -> EXPIRED", () => {
    expect(computeMedicalStatus("2025-12-31", "2026-01-01")).toBe(MEDICAL_STATUS.EXPIRED);
  });
  it("dnesny den ako posledny platny -> EXPIRING (0 dni zostava)", () => {
    expect(computeMedicalStatus("2026-01-01", "2026-01-01")).toBe(MEDICAL_STATUS.EXPIRING);
  });
  it("chybajuci/nerozpoznatelny udaj -> UNKNOWN, NIKDY nie VALID", () => {
    expect(computeMedicalStatus(null, "2026-01-01")).toBe(MEDICAL_STATUS.UNKNOWN);
    expect(computeMedicalStatus(undefined, "2026-01-01")).toBe(MEDICAL_STATUS.UNKNOWN);
    expect(computeMedicalStatus("", "2026-01-01")).toBe(MEDICAL_STATUS.UNKNOWN);
    expect(computeMedicalStatus("neplatny-format", "2026-01-01")).toBe(MEDICAL_STATUS.UNKNOWN);
  });
  it("prah je konfigurovatelny parameter, nie hardcoded", () => {
    expect(computeMedicalStatus("2026-01-15", "2026-01-01", 7)).toBe(MEDICAL_STATUS.VALID); // 14 dni, prah 7 -> VALID
    expect(computeMedicalStatus("2026-01-05", "2026-01-01", 7)).toBe(MEDICAL_STATUS.EXPIRING); // 4 dni, prah 7 -> EXPIRING
  });
  it("DEFAULT_EXPIRING_THRESHOLD_DAYS je 60 podla zadania", () => {
    expect(DEFAULT_EXPIRING_THRESHOLD_DAYS).toBe(60);
  });
});
