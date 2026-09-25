import { describe, it, expect } from "vitest";
import { computeHrWarnings, HR_WARNING_THRESHOLDS } from "./hrWarnings.js";

const TODAY = "2026-06-01";
const employees = [{ id: "e1", first_name: "Jan", last_name: "Novák" }, { id: "e2", first_name: "Eva", last_name: "Malá" }];

describe("computeHrWarnings", () => {
  it("smlouva koncici za <=14 dni je red", () => {
    const warnings = computeHrWarnings({ employments: [{ id: "em1", employee_id: "e1", fixed_term_end_date: "2026-06-10" }], employees }, TODAY);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ level: "red", type: "CONTRACT_ENDING", employeeId: "e1", daysLeft: 9, employeeName: "Jan Novák" });
  });

  it("smlouva koncici za 15-45 dni je orange", () => {
    const warnings = computeHrWarnings({ employments: [{ id: "em1", employee_id: "e1", fixed_term_end_date: "2026-07-01" }], employees }, TODAY);
    expect(warnings[0].level).toBe("orange");
  });

  it("smlouva koncici za viac ako 45 dni negeneruje warning", () => {
    const warnings = computeHrWarnings({ employments: [{ id: "em1", employee_id: "e1", fixed_term_end_date: "2026-12-31" }], employees }, TODAY);
    expect(warnings).toHaveLength(0);
  });

  it("smlouva bez fixed_term_end_date (doba neurcita) negeneruje warning", () => {
    const warnings = computeHrWarnings({ employments: [{ id: "em1", employee_id: "e1", fixed_term_end_date: null }], employees }, TODAY);
    expect(warnings).toHaveLength(0);
  });

  it("uz prosla smlouva (zaporne dni) negeneruje 'koncí za' warning (to rieši stav ENDED)", () => {
    const warnings = computeHrWarnings({ employments: [{ id: "em1", employee_id: "e1", fixed_term_end_date: "2026-05-01" }], employees }, TODAY);
    expect(warnings).toHaveLength(0);
  });

  it("propadla lekarska prohlidka je red", () => {
    const warnings = computeHrWarnings({ medicalExams: [{ id: "m1", employee_id: "e2", valid_until: "2026-05-01" }], employees }, TODAY);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ level: "red", type: "MEDICAL_EXPIRED", employeeId: "e2", employeeName: "Eva Malá" });
  });

  it("lekarska prohlidka koncici do 30 dni je orange", () => {
    const warnings = computeHrWarnings({ medicalExams: [{ id: "m1", employee_id: "e2", valid_until: "2026-06-20" }], employees }, TODAY);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ level: "orange", type: "MEDICAL_EXPIRING" });
  });

  it("lekarska prohlidka koncici za viac ako 30 (ale menej ako 60) dni negeneruje warning (medicalOrangeDays < EXPIRING prah)", () => {
    const warnings = computeHrWarnings({ medicalExams: [{ id: "m1", employee_id: "e2", valid_until: "2026-07-20" }], employees }, TODAY);
    expect(warnings).toHaveLength(0);
  });

  it("chybajuci/nerozpoznatelny valid_until (UNKNOWN stav) negeneruje warning", () => {
    const warnings = computeHrWarnings({ medicalExams: [{ id: "m1", employee_id: "e2", valid_until: null }], employees }, TODAY);
    expect(warnings).toHaveLength(0);
  });

  it("kombinacia viacerych warningov naraz, zoradenie podla vstupu", () => {
    const warnings = computeHrWarnings({
      employments: [{ id: "em1", employee_id: "e1", fixed_term_end_date: "2026-06-05" }],
      medicalExams: [{ id: "m1", employee_id: "e2", valid_until: "2026-05-01" }],
      employees,
    }, TODAY);
    expect(warnings).toHaveLength(2);
    expect(warnings.map((w) => w.type).sort()).toEqual(["CONTRACT_ENDING", "MEDICAL_EXPIRED"]);
  });

  it("prahy su konfigurovatelny parameter, nie hardcoded", () => {
    const customThresholds = { ...HR_WARNING_THRESHOLDS, contractRedDays: 1 };
    const warnings = computeHrWarnings({ employments: [{ id: "em1", employee_id: "e1", fixed_term_end_date: "2026-06-10" }], employees }, TODAY, customThresholds);
    expect(warnings[0].level).toBe("orange"); // uz nie red pri thresholdRed=1, 9 dni > 1
  });
});
