import { describe, it, expect } from "vitest";
import {
  generateWeek,
  applySetPos,
  applyAddGeneral,
  applyRemoveGeneral,
  applyClearShiftAssignments,
} from "../../PlanSmienView.jsx";
import { markPreserved, unmarkPreserved, isPreserved } from "./manualPreserve.js";
import { canAutoFill, canReplan, weekTemporalStatus } from "../planSmienGuard.js";
import { runScheduler } from "./index.js";
import { makeRealisticEmployees, makeRealisticWeek, findShift } from "./testFixtures.js";

// Testuje presne ten workflow, ktory implementuju handlery v PlanSmienView.jsx
// (setPos/addGeneral/removeGeneral/confirmPreserve/unpreserveAssignment/
// clearShiftAssignment) - cez ich REALNE exportovane cisto-funkcie
// (applySetPos/applyAddGeneral/applyRemoveGeneral/applyClearShiftAssignments)
// + manualPreserve.js (uz existujuca infrastruktura enginu, nemenena).
// Ziadne produkcne data - vsetko na fixtures/generateWeek.

const MON = "2026-09-28";

describe("1) rucny presun POS1 + Ano, zachovat -> vysledne priradenie zachovane", () => {
  it("markPreserved po applySetPos oznaci presne pos1 na danej zmene", () => {
    let week = generateWeek(MON, false);
    let shift = week.shifts.find((s) => s.type === "day");
    shift = applySetPos(shift, "pos1", "hrncova1"); // rucne priradenie (simuluje UI select)
    // "Ano, zachovat" v dialogu:
    shift = markPreserved(shift, "pos1");
    expect(shift.assigned.pos1).toBe("hrncova1");
    expect(isPreserved(shift, "pos1")).toBe(true);
    expect(isPreserved(shift, "pos3")).toBe(false);
  });
});

describe("2) rucny presun POS3 + preserve", () => {
  it("markPreserved po applySetPos oznaci presne pos3", () => {
    let shift = generateWeek(MON, false).shifts.find((s) => s.type === "day");
    shift = applySetPos(shift, "pos3", "poz3a");
    shift = markPreserved(shift, "pos3");
    expect(shift.assigned.pos3).toBe("poz3a");
    expect(isPreserved(shift, "pos3")).toBe(true);
    expect(isPreserved(shift, "pos1")).toBe(false);
  });
});

describe("3) rucny presun GENERAL + preserve -> len tento zamestnanec je zachovany", () => {
  it("Eva je preserved, Anna/Jana/Marie v tom istom general poli NIE su ovplyvnene", () => {
    let shift = generateWeek(MON, false).shifts.find((s) => s.type === "day");
    shift = applyAddGeneral(shift, "anna");
    shift = applyAddGeneral(shift, "eva");
    shift = applyAddGeneral(shift, "jana");
    shift = applyAddGeneral(shift, "marie");
    shift = markPreserved(shift, "eva"); // len Eva dostane "Ano, zachovat"
    expect(shift.assigned.general).toEqual(["anna", "eva", "jana", "marie"]);
    expect(isPreserved(shift, "eva")).toBe(true);
    expect(isPreserved(shift, "anna")).toBe(false);
    expect(isPreserved(shift, "jana")).toBe(false);
    expect(isPreserved(shift, "marie")).toBe(false);
  });
});

describe("4) rucna zmena + Ne -> priradenie zostava zmenene, ale NENI zachovane", () => {
  it("applySetPos bez nasledneho markPreserved necha priradenie, preserve flag ostava false", () => {
    let shift = generateWeek(MON, false).shifts.find((s) => s.type === "day");
    shift = applySetPos(shift, "pos1", "hrncova1");
    // uzivatel klikol "Ne" - ziadny markPreserved sa nevola
    expect(shift.assigned.pos1).toBe("hrncova1"); // zmena zostava
    expect(isPreserved(shift, "pos1")).toBe(false); // ale nie je chranena
  });
});

describe("5)+6)+7) plny replan - zachovane POS1/POS3/GENERAL zostavaju nezmenene, ostatne sa mozu prepocitat", () => {
  it("preserved pos1, pos3 a general zamestnanec prezijú replan bez zmeny", () => {
    const employees = makeRealisticEmployees();
    let week = makeRealisticWeek(MON);
    let monday = findShift(week, MON, "day");
    monday = applySetPos(monday, "pos1", "hrncova2"); // rucne "nezvycajny" vyber (nie continuity-preferovany)
    monday = markPreserved(monday, "pos1");
    monday = applySetPos(monday, "pos3", "poz3b");
    monday = markPreserved(monday, "pos3");
    monday = applyAddGeneral(monday, "gen5");
    monday = markPreserved(monday, "gen5");
    week = { ...week, shifts: week.shifts.map((s) => (s.id === monday.id ? monday : s)) };

    const { week: result } = runScheduler({ mode: "replan", week, employees, absences: [], allWeeks: [week], referenceWeek: week });
    const resultMonday = result.shifts.find((s) => s.id === monday.id);

    expect(resultMonday.assigned.pos1).toBe("hrncova2");
    expect(resultMonday.assigned.pos3).toBe("poz3b");
    expect(resultMonday.assigned.general).toContain("gen5");
  });
});

describe("8) zruseni zachovani (unpreserve) - priradenie zostava, preserve metadata zmizne", () => {
  it("unmarkPreserved odstrani flag, priradena osoba zostava na zmene", () => {
    let shift = generateWeek(MON, false).shifts.find((s) => s.type === "day");
    shift = applySetPos(shift, "pos1", "hrncova1");
    shift = markPreserved(shift, "pos1");
    expect(isPreserved(shift, "pos1")).toBe(true);

    shift = unmarkPreserved(shift, "pos1"); // "Zrušit zachování"
    expect(shift.assigned.pos1).toBe("hrncova1"); // stale priradeny
    expect(isPreserved(shift, "pos1")).toBe(false); // uz nie je zachovany
  });
});

describe("9) presun uz zachovaneho priradenia inam - ziadna osirela znacka na povodnom mieste", () => {
  it("applySetPos(null) na povodnom mieste zmaze preserve tam, nova zmena zacina bez preserve", () => {
    let shiftA = generateWeek(MON, false).shifts.find((s) => s.type === "day");
    shiftA = applySetPos(shiftA, "pos1", "hrncova1");
    shiftA = markPreserved(shiftA, "pos1"); // zachovane na povodnom mieste

    // rucny presun = odobratie (X) + nove priradenie inde (presne ako v UI)
    shiftA = applySetPos(shiftA, "pos1", null); // odobratie
    expect(isPreserved(shiftA, "pos1")).toBe(false); // ziadna osirela znacka

    let shiftB = generateWeek(MON, false).shifts.find((s) => s.type === "night");
    shiftB = applySetPos(shiftB, "pos1", "hrncova1"); // nove miesto
    expect(isPreserved(shiftB, "pos1")).toBe(false); // zachovanie NEsleduje automaticky - musi sa znova potvrdit
  });

  it("presun v ramci general (odobrat Eva, pridat Eva inde) tiez nenecha osirelu znacku", () => {
    let shiftA = generateWeek(MON, false).shifts.find((s) => s.type === "day");
    shiftA = applyAddGeneral(shiftA, "eva");
    shiftA = markPreserved(shiftA, "eva");
    shiftA = applyRemoveGeneral(shiftA, "eva");
    expect(isPreserved(shiftA, "eva")).toBe(false);
    expect(shiftA.assigned.general).not.toContain("eva");
  });
});

describe("10) zmazanie zachovaneho priradenia - preserve metadata zmizne spolu s nim", () => {
  it("applyClearShiftAssignments (Vyčistit přiřazení) vynuluje aj preserveOnReplan", () => {
    let shift = generateWeek(MON, false).shifts.find((s) => s.type === "day");
    shift = applySetPos(shift, "pos1", "hrncova1");
    shift = markPreserved(shift, "pos1");
    shift = applyAddGeneral(shift, "eva");
    shift = markPreserved(shift, "eva");

    shift = applyClearShiftAssignments(shift);
    expect(shift.assigned.pos1).toBeNull();
    expect(shift.assigned.general).toEqual([]);
    expect(isPreserved(shift, "pos1")).toBe(false);
    expect(isPreserved(shift, "eva")).toBe(false);
  });

  it("applyRemoveGeneral pre konkretnu preserved osobu zmaze len jej flag, nie cely general", () => {
    let shift = generateWeek(MON, false).shifts.find((s) => s.type === "day");
    shift = applyAddGeneral(shift, "anna");
    shift = applyAddGeneral(shift, "eva");
    shift = markPreserved(shift, "eva");
    shift = applyRemoveGeneral(shift, "eva"); // "zmazanie" konkretneho priradenia
    expect(shift.assigned.general).toEqual(["anna"]);
    expect(isPreserved(shift, "eva")).toBe(false);
  });
});

describe("11) stare zmeny bez preserveOnReplan - plne spatne kompatibilne", () => {
  it("zmena bez preserveOnReplan pola sa sprava, akoby nic nebolo zachovane (isPreserved=false vsade)", () => {
    const legacyShift = generateWeek(MON, false).shifts.find((s) => s.type === "day");
    delete legacyShift.preserveOnReplan; // simuluje stare produkcne data bez tohto pola
    expect(isPreserved(legacyShift, "pos1")).toBe(false);
    expect(isPreserved(legacyShift, "pos3")).toBe(false);
    expect(isPreserved(legacyShift, "hociktokolvek")).toBe(false);
  });

  it("applySetPos/applyAddGeneral funguju normalne aj bez existujuceho preserveOnReplan pola", () => {
    let legacyShift = generateWeek(MON, false).shifts.find((s) => s.type === "day");
    delete legacyShift.preserveOnReplan;
    legacyShift = applySetPos(legacyShift, "pos1", "hrncova1");
    legacyShift = applyAddGeneral(legacyShift, "gen1");
    expect(legacyShift.assigned.pos1).toBe("hrncova1");
    expect(legacyShift.assigned.general).toEqual(["gen1"]);
  });
});

describe("12) Doplnit prázdná místa (fillGaps) - 0 existujucich priradeni zmenenych, bez ohladu na preserve flagy", () => {
  it("existujuce priradenia (zachovane aj nezachovane) zostavaju presne take, ake boli", () => {
    const employees = makeRealisticEmployees();
    let week = makeRealisticWeek(MON);
    let monday = findShift(week, MON, "day");
    monday = applySetPos(monday, "pos1", "hrncova1");
    monday = markPreserved(monday, "pos1"); // zachovane
    monday = applySetPos(monday, "pos3", "poz3a"); // NEzachovane (uzivatel klikol "Ne")
    week = { ...week, shifts: week.shifts.map((s) => (s.id === monday.id ? monday : s)) };

    const { week: result } = runScheduler({ mode: "fillGaps", week, employees, absences: [], allWeeks: [week] });
    const resultMonday = result.shifts.find((s) => s.id === monday.id);
    expect(resultMonday.assigned.pos1).toBe("hrncova1");
    expect(resultMonday.assigned.pos3).toBe("poz3a"); // NEzachovane, ale fillGaps aj tak nikdy neprepisuje existujuce
  });
});

describe("13) chranene tyzdne (minuly/aktualny) - guard sprava nezmenena touto zmenou", () => {
  it("canAutoFill/canReplan stale blokuju minuly a aktualny tyzden rovnako ako predtym", () => {
    const today = "2026-09-21";
    const pastWeek = generateWeek("2026-09-14", false);
    const currentWeek = generateWeek("2026-09-21", false);
    expect(weekTemporalStatus(pastWeek.id, today)).toBe("past");
    expect(weekTemporalStatus(currentWeek.id, today)).toBe("current");
    expect(canAutoFill(pastWeek, today).allowed).toBe(false);
    expect(canAutoFill(currentWeek, today).allowed).toBe(false);
    expect(canReplan(pastWeek, today).allowed).toBe(false);
    expect(canReplan(currentWeek, today).allowed).toBe(false);
  });

  it("preserve flagy na chranenom tyzdni nemenia guard rozhodnutie (stale blocked)", () => {
    const today = "2026-09-21";
    let pastWeek = generateWeek("2026-09-14", false);
    let shift = pastWeek.shifts.find((s) => s.type === "day");
    shift = applySetPos(shift, "pos1", "hrncova1");
    shift = markPreserved(shift, "pos1");
    pastWeek = { ...pastWeek, shifts: pastWeek.shifts.map((s) => (s.id === shift.id ? shift : s)) };
    expect(canAutoFill(pastWeek, today).allowed).toBe(false);
    expect(canReplan(pastWeek, today).allowed).toBe(false);
  });
});
