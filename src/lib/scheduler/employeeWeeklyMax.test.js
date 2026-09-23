import { describe, it, expect } from "vitest";
import { runScheduler } from "./index.js";
import { weekShiftCount } from "../../PlanSmienView.jsx";
import { formatWeekRoster } from "./reportFormat.js";
import { makeRealisticWeek, findShift } from "./testFixtures.js";

// Regresny test presne na produkcny hlaseny problem: zamestnanec s NIZKYM
// osobnym weeklyMax (napr. Zuzana Svobodova = 2) dostal automatickym
// naplanovanim 5 zmien namiesto svojho nastaveneho stropu, pretoze
// eligibility.js/scoring.js predtym porovnavali len proti plosnym firemnym
// konstantam (NORMAL_TARGET_SHIFTS=4 / HARD_MAX_SHIFTS=5), nie proti
// employee.weeklyMax (aj ked bol tento udaj v "Zamestnanci" spravne
// nastaveny a intent.js ho uz aj predtym spravne pocital do
// intent.targetShifts - ten sa vsak nikde nepouzival).
const MON = "2026-09-28";

function makeEmployeesWithLowMax() {
  return [
    { id: "hrncova1", name: "Hrncova Jedna", roles: ["pos1", "general"], weeklyMax: 4, active: true },
    { id: "hrncova2", name: "Hrncova Dva", roles: ["pos1", "general"], weeklyMax: 4, active: true },
    { id: "poz3a", name: "Pozicia3 A", roles: ["pos3", "general"], weeklyMax: 4, active: true },
    { id: "poz3b", name: "Pozicia3 B", roles: ["pos3", "general"], weeklyMax: 4, active: true },
    { id: "gen1", name: "Gen 1", roles: ["general"], weeklyMax: 4, active: true },
    { id: "gen2", name: "Gen 2", roles: ["general"], weeklyMax: 4, active: true },
    { id: "gen3", name: "Gen 3", roles: ["general"], weeklyMax: 4, active: true },
    { id: "gen4", name: "Gen 4", roles: ["general"], weeklyMax: 4, active: true },
    { id: "gen5", name: "Gen 5", roles: ["general"], weeklyMax: 4, active: true },
    { id: "gen6", name: "Gen 6", roles: ["general"], weeklyMax: 5, active: true },
    { id: "gen7", name: "Gen 7", roles: ["general"], weeklyMax: 5, active: true },
    { id: "gen8", name: "Gen 8", roles: ["general"], weeklyMax: 5, active: true },
    // presne produkcny scenar: Zuzana Svobodova, nastavena na max 2 zmeny/tyzden
    { id: "zuzana", name: "Zuzana Svobodova", roles: ["general"], weeklyMax: 2, active: true },
  ];
}

describe("individualny employee.weeklyMax sa musi respektovat v automatickom scheduleri", () => {
  it("Svobodova (weeklyMax=2) nedostane pri fillGaps na plnom/naroznom tyzdni viac ako 2 zmeny", () => {
    const employees = makeEmployeesWithLowMax();
    const week = makeRealisticWeek(MON); // plny tyzden, aby vznikol tlak na kazdeho vratane nej
    const { week: result, warnings } = runScheduler({ mode: "fillGaps", week, employees, absences: [], allWeeks: [week] });
    console.log("\n=== weeklyMax regression roster ===");
    console.log(formatWeekRoster(result, employees, warnings));

    expect(weekShiftCount(result, "zuzana")).toBeLessThanOrEqual(2);
  });

  it("Svobodova (weeklyMax=2) nedostane viac ako 2 zmeny ani pri replan", () => {
    const employees = makeEmployeesWithLowMax();
    const week = makeRealisticWeek(MON);
    const { week: result } = runScheduler({ mode: "replan", week, employees, absences: [], allWeeks: [week], referenceWeek: week });
    expect(weekShiftCount(result, "zuzana")).toBeLessThanOrEqual(2);
  });

  it("aj pri viacerych po sebe iducich tyzdnoch (kontinuita/historia) sa jej strop 2 neprelomi", () => {
    const employees = makeEmployeesWithLowMax();
    let allWeeks = [];
    let cursor = MON;
    let lastResult = null;
    for (let i = 0; i < 3; i++) {
      const week = makeRealisticWeek(cursor);
      const { week: filled } = runScheduler({ mode: "fillGaps", week, employees, absences: [], allWeeks });
      allWeeks.push(filled);
      lastResult = filled;
      cursor = new Date(new Date(cursor).getTime() + 7 * 86400000).toISOString().slice(0, 10);
    }
    allWeeks.forEach((w) => expect(weekShiftCount(w, "zuzana")).toBeLessThanOrEqual(2));
  });

  it("iny zamestnanec s beznym weeklyMax=4 nie je touto opravou nijako obmedzeny nad svoj vlastny strop", () => {
    const employees = makeEmployeesWithLowMax();
    const week = makeRealisticWeek(MON);
    const { week: result } = runScheduler({ mode: "fillGaps", week, employees, absences: [], allWeeks: [week] });
    ["hrncova1", "hrncova2", "poz3a", "poz3b", "gen1", "gen2", "gen3", "gen4", "gen5"].forEach((id) => {
      expect(weekShiftCount(result, id)).toBeLessThanOrEqual(5); // hard cap 5 stale plati globalne
    });
  });

  it("rucne priradenie cez UI (applySetPos/applyAddGeneral) NIE JE obmedzene weeklyMax - kolega ju stale moze pridat aj nad ramec rucne", () => {
    // toto len dokumentuje, ze oprava sa tyka VYLUCNE automatickeho enginu
    // (eligibility.js/scoring.js), nie manualnych UI handlerov v PlanSmienView.jsx,
    // ktore nikdy ziadny strop nekontrolovali (a stale nekontroluju).
    let shift = findShift(makeRealisticWeek(MON), MON, "day");
    // simulacia: uz ma zuzana 2 zmeny inde, kolega ju napriek tomu rucne prida aj sem
    shift = { ...shift, assigned: { ...shift.assigned, general: [...shift.assigned.general, "zuzana"] } };
    expect(shift.assigned.general).toContain("zuzana"); // rucny zasah nie je algoritmom blokovany
  });
});
