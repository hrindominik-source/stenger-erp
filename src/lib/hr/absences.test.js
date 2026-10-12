import { describe, it, expect } from "vitest";
import { activeAbsence, absenceStatusText, probationOverlapDays, addDaysIso, absenceList, absenceInProbation } from "./absences.js";

const emp = (nepritomnosti, odstranene = []) => ({ data: { nepritomnosti, nepritomnosti_odstranene: odstranene } });

describe("nepřítomnosti", () => {
  it("aktivní PN a text stavu", () => {
    const e = emp([{ id: "1", druh: "pn_nemoc", od: "2026-10-03" }, { id: "2", druh: "ocr", od: "2026-05-01", do: "2026-05-05" }]);
    const a = activeAbsence(e, "2026-10-12");
    expect(a.id).toBe("1");
    expect(absenceStatusText(a)).toBe("V pracovní neschopnosti od 3.10.2026");
    expect(activeAbsence(e, "2026-10-01")).toBeNull();
  });

  it("ukončená nepřítomnost už není aktivní, odstraněná se nepočítá", () => {
    const e = emp([{ id: "1", druh: "pn_nemoc", od: "2026-10-03", do: "2026-10-10" }]);
    expect(activeAbsence(e, "2026-10-12")).toBeNull();
    expect(activeAbsence(e, "2026-10-10").id).toBe("1");
    expect(absenceList(emp([{ id: "1", od: "2026-01-01" }], [{ id: "1" }]))).toEqual([]);
  });

  it("dny PN ve zkušební době pro prodloužení", () => {
    const em = { start_date: "2026-10-01", probation_end_date: "2027-01-31" };
    expect(probationOverlapDays({ od: "2026-11-02", do: "2026-11-11" }, em)).toBe(10);
    expect(probationOverlapDays({ od: "2027-01-25", do: "2027-02-10" }, em)).toBe(7);
    expect(probationOverlapDays({ od: "2027-03-01", do: "2027-03-05" }, em)).toBe(0);
    expect(probationOverlapDays({ od: "2026-11-02" }, em)).toBe(0); // jeste trva
    expect(absenceInProbation({ od: "2026-11-02" }, em)).toBe(true);
    expect(addDaysIso("2027-01-31", 10)).toBe("2027-02-10");
  });
});
