import { describe, it, expect } from "vitest";
import {
  nextPlanningWeekStart,
  currentPlanningWeekStart,
  weekTemporalStatus,
  weekHasAnyAssignments,
  canAutoFill,
  canClearOnly,
  canReplan,
} from "./planSmienGuard.js";
// Realny algoritmus (nie atrapa) - overuje sa, ci je genuinne nedestruktivny,
// nie len ze guard funkcie vratia spravne priznaky. makeShift/generateWeek/
// cloneWeek/clearShiftAssignments/autoFillWeek su v PlanSmienView.jsx
// exportovane specialne kvoli tomuto testu (bez zmeny spravania).
import { generateWeek, autoFillWeek, cloneWeek, clearShiftAssignments } from "../PlanSmienView.jsx";

// Pevny "dnesok" pre deterministicke testy - pondelok 21.9.2026 (streda by
// fungovala rovnako, staci ze je to niekde v tomto tyzdni - viz test na
// nehardcodovanu hranicu nizsie).
const TODAY = "2026-09-21"; // pondelok
const PAST_WEEK = "2026-09-14";
const CURRENT_WEEK = "2026-09-21";
const NEXT_WEEK = "2026-09-28";

function makeWeekWithAssignment(id, hasAssignment) {
  const w = generateWeek(id, false);
  if (hasAssignment) w.shifts[0].assigned.pos1 = "emp-1";
  return w;
}

describe("nextPlanningWeekStart / currentPlanningWeekStart - dynamicka hranica", () => {
  it("hranica je vzdy pondelok NASLEDUJUCEHO tyzdna, nie natvrdo datum", () => {
    expect(currentPlanningWeekStart("2026-09-21")).toBe("2026-09-21");
    expect(nextPlanningWeekStart("2026-09-21")).toBe("2026-09-28");
  });
  it("funguje rovnako pre lubovolny den v tyzdni (nie len pondelok)", () => {
    // streda v tom istom tyzdni musi vypocitat tu istu hranicu ako pondelok
    expect(currentPlanningWeekStart("2026-09-24")).toBe("2026-09-21");
    expect(nextPlanningWeekStart("2026-09-24")).toBe("2026-09-28");
  });
  it("posun o mesiac neskor dokazuje, ze sa naozaj pocita dynamicky", () => {
    expect(nextPlanningWeekStart("2026-10-19")).toBe("2026-10-26");
  });
});

describe("weekTemporalStatus", () => {
  it("klasifikuje minuly/aktualny/buduci tyzden", () => {
    expect(weekTemporalStatus(PAST_WEEK, TODAY)).toBe("past");
    expect(weekTemporalStatus(CURRENT_WEEK, TODAY)).toBe("current");
    expect(weekTemporalStatus(NEXT_WEEK, TODAY)).toBe("future");
  });
});

describe("canAutoFill (Doplnit prázdná místa)", () => {
  it("minuly tyzden + autofill => blocked", () => {
    const week = generateWeek(PAST_WEEK, false);
    expect(canAutoFill(week, TODAY).allowed).toBe(false);
  });
  it("aktualny tyzden + autofill => blocked", () => {
    const week = generateWeek(CURRENT_WEEK, false);
    expect(canAutoFill(week, TODAY).allowed).toBe(false);
  });
  it("buduci tyzden + autofill => allowed", () => {
    const week = generateWeek(NEXT_WEEK, false);
    expect(canAutoFill(week, TODAY).allowed).toBe(true);
  });
  it("buduci tyzden s existujucimi priradeniami + autofill => allowed BEZ potvrdenia (nikdy neprepisuje)", () => {
    const week = makeWeekWithAssignment(NEXT_WEEK, true);
    const result = canAutoFill(week, TODAY);
    expect(result.allowed).toBe(true);
    expect(result.requiresConfirmation).toBe(false);
  });
});

describe("canClearOnly (Vyčistit)", () => {
  it("minuly tyzden + clear => blocked", () => {
    expect(canClearOnly(generateWeek(PAST_WEEK, false), TODAY).allowed).toBe(false);
  });
  it("aktualny tyzden + clear => blocked", () => {
    expect(canClearOnly(generateWeek(CURRENT_WEEK, false), TODAY).allowed).toBe(false);
  });
  it("buduci tyzden + clear => allowed, ale vyzaduje potvrdenie", () => {
    const result = canClearOnly(generateWeek(NEXT_WEEK, false), TODAY);
    expect(result.allowed).toBe(true);
    expect(result.requiresConfirmation).toBe(true);
  });
});

describe("canReplan (Vyčistit a přeplánovat)", () => {
  it("minuly tyzden + replan => blocked", () => {
    expect(canReplan(generateWeek(PAST_WEEK, false), TODAY).allowed).toBe(false);
  });
  it("aktualny tyzden + replan => blocked", () => {
    expect(canReplan(generateWeek(CURRENT_WEEK, false), TODAY).allowed).toBe(false);
  });
  it("prazdny buduci tyzden + replan => allowed BEZ potvrdenia (nie je co stratit)", () => {
    const result = canReplan(generateWeek(NEXT_WEEK, false), TODAY);
    expect(result.allowed).toBe(true);
    expect(result.requiresConfirmation).toBe(false);
  });
  it("buduci tyzden s existujucimi priradeniami + replan => vyzaduje explicitne potvrdenie", () => {
    const week = makeWeekWithAssignment(NEXT_WEEK, true);
    const result = canReplan(week, TODAY);
    expect(result.allowed).toBe(true);
    expect(result.requiresConfirmation).toBe(true);
  });
});

describe("weekHasAnyAssignments", () => {
  it("prazdny tyzden nema ziadne priradenia", () => {
    expect(weekHasAnyAssignments(generateWeek(NEXT_WEEK, false))).toBe(false);
  });
  it("detekuje priradenie v pos1/pos3/general/extra", () => {
    const w1 = generateWeek(NEXT_WEEK, false); w1.shifts[0].assigned.pos1 = "e1";
    expect(weekHasAnyAssignments(w1)).toBe(true);
    const w2 = generateWeek(NEXT_WEEK, false); w2.shifts[0].assigned.pos3 = "e1";
    expect(weekHasAnyAssignments(w2)).toBe(true);
    const w3 = generateWeek(NEXT_WEEK, false); w3.shifts[0].assigned.general.push("e1");
    expect(weekHasAnyAssignments(w3)).toBe(true);
    const w4 = generateWeek(NEXT_WEEK, false); w4.shifts[0].extra.push("e1");
    expect(weekHasAnyAssignments(w4)).toBe(true);
  });
});

/* =========================================================================
   Regresne testy proti REALNEMU autoFillWeek algoritmu (nie atrapa) - presne
   podla poziadavky: "over, ze existujuce priradenia zostanu nezmenene".
   ========================================================================= */
describe("autoFillWeek - realny algoritmus nikdy neprepisuje existujuce priradenia", () => {
  const employees = [
    { id: "e1", name: "Emp1", roles: ["pos1", "general"], weeklyMax: 4, active: true },
    { id: "e2", name: "Emp2", roles: ["pos3", "general"], weeklyMax: 4, active: true },
    { id: "e3", name: "Emp3", roles: ["general"], weeklyMax: 5, active: true },
    { id: "e4", name: "Emp4", roles: ["general"], weeklyMax: 5, active: true },
    { id: "e5", name: "Emp5", roles: ["general"], weeklyMax: 5, active: true },
    { id: "e6", name: "Emp6", roles: ["general"], weeklyMax: 5, active: true },
  ];

  it("buduci tyzden s rucne zadanym pos1 na pondelkovej dennej zmene ho po autoFillWeek nezmeni", () => {
    const week = generateWeek(NEXT_WEEK, false);
    week.shifts[0].product = "sacky"; // pondelok den, aby total > 0
    week.shifts[0].assigned.pos1 = "e1";
    const filled = autoFillWeek(week, employees, [], [week]);
    const mondayDay = filled.shifts.find((s) => s.id === week.shifts[0].id);
    expect(mondayDay.assigned.pos1).toBe("e1");
  });

  it("buduci tyzden s rucne zadanym general timom ho po autoFillWeek nezmeni (len dopln zvysok)", () => {
    const week = generateWeek(NEXT_WEEK, false);
    week.shifts[0].product = "sacky"; // total 4 vo fixture PRODUCTS.sacky
    week.shifts[0].assigned.general = ["e3", "e4"];
    const filled = autoFillWeek(week, employees, [], [week]);
    const mondayDay = filled.shifts.find((s) => s.id === week.shifts[0].id);
    expect(mondayDay.assigned.general).toEqual(expect.arrayContaining(["e3", "e4"]));
  });
});

/* =========================================================================
   REGRESNY SNAPSHOT TEST - hlavna poziadavka: povolene operacie na novom
   buducom tyzdni sa nesmiu nijako dotknut zaznamov PRED hranicou.
   ========================================================================= */
describe("regrese: ochranene tyzdne (minule aj aktualny) zostavaju bit-presne nezmenene", () => {
  const employees = [
    { id: "e1", name: "Emp1", roles: ["pos1", "general"], weeklyMax: 4, active: true },
    { id: "e2", name: "Emp2", roles: ["pos3", "general"], weeklyMax: 4, active: true },
    { id: "e3", name: "Emp3", roles: ["general"], weeklyMax: 5, active: true },
  ];

  it("snapshot pred/po - past a current tyzden su identicke, zmeny idu len do future tyzdna", () => {
    const pastWeek = generateWeek(PAST_WEEK, false);
    pastWeek.shifts[0].assigned.pos1 = "e1"; // realne "uz odpracovane" data
    pastWeek.shifts[2].assigned.general = ["e2", "e3"];

    const currentWeek = generateWeek(CURRENT_WEEK, false);
    currentWeek.shifts[1].assigned.pos3 = "e2";

    const futureWeek = generateWeek(NEXT_WEEK, false);

    let weeks = [cloneWeek(pastWeek), cloneWeek(currentWeek), cloneWeek(futureWeek)];
    const snapshotBefore = JSON.stringify([weeks[0], weeks[1]]); // past + current

    // Simulacia realneho UI flow cez guard - presne ako by to volal PlanSmienView:
    // pre kazdy tyzden v poli sa najprv opyta guardu, a mutuje sa LEN ak dovoli.
    weeks = weeks.map((w) => {
      const guard = canAutoFill(w, TODAY);
      if (!guard.allowed) return w; // chraneny tyzden ostava netknuty
      return autoFillWeek(w, employees, [], weeks);
    });

    const snapshotAfter = JSON.stringify([weeks[0], weeks[1]]);
    expect(snapshotAfter).toBe(snapshotBefore);

    // Buduci tyzden VIDITELNE zmeneny (dostal automaticke priradenia) - dokazuje,
    // ze test naozaj nieco robil, nie je to len no-op na vsetkom.
    const futureFilled = weeks[2];
    const anyFilled = futureFilled.shifts.some((s) => s.assigned.pos1 || s.assigned.pos3 || s.assigned.general.length > 0);
    expect(anyFilled).toBe(true);
  });
});
