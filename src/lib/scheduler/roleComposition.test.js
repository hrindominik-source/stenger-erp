import { describe, it, expect } from "vitest";
import { runScheduler } from "./index.js";
import { generateWeek } from "../../PlanSmienView.jsx";

// Produkcne pravidlo (explicitne zadanie): kazda den/noc zmena ma presne 1
// pos1 + presne 1 pos3 + zvysok general = total, ziadny clovek sa nepocita
// dvakrat, pos1 != pos3, a general NIKDY tichoducho nenahradza chybajucu
// pos1/pos3 specializaciu (nedostatok = CRITICAL_ROLE_SHORTAGE, nie extra
// general clovek navyse).
function makeEmployees() {
  return [
    { id: "hrncova1", name: "H1", roles: ["pos1", "general"], weeklyMax: 4, active: true },
    { id: "hrncova2", name: "H2", roles: ["pos1", "general"], weeklyMax: 4, active: true },
    { id: "poz3a", name: "P3a", roles: ["pos3", "general"], weeklyMax: 4, active: true },
    { id: "poz3b", name: "P3b", roles: ["pos3", "general"], weeklyMax: 4, active: true },
    { id: "g1", name: "G1", roles: ["general"], weeklyMax: 5, active: true },
    { id: "g2", name: "G2", roles: ["general"], weeklyMax: 5, active: true },
    { id: "g3", name: "G3", roles: ["general"], weeklyMax: 5, active: true },
    { id: "g4", name: "G4", roles: ["general"], weeklyMax: 5, active: true },
    { id: "g5", name: "G5", roles: ["general"], weeklyMax: 5, active: true },
    { id: "g6", name: "G6", roles: ["general"], weeklyMax: 5, active: true },
  ];
}

function singleActiveShift(product) {
  const week = generateWeek("2026-09-28", false);
  const monday = week.shifts.find((s) => s.type === "day");
  monday.product = product;
  week.shifts.forEach((s) => {
    if (s.id !== monday.id) s.product = null; // ostatne zmeny neaktivne (total=0), izoluje test na 1 zmenu
  });
  return { week, shiftId: monday.id };
}

describe.each([
  ["sacky (SÁČKY)", "sacky", 4, 2],
  ["bulk (BULK)", "bulk", 5, 3],
  ["kybliky (KBELÍKY)", "kybliky", 6, 4],
])("produkcny rezim: %s", (_label, product, total, expectedGeneral) => {
  it(`unique=${total}, pos1=1, pos3=1, general=${expectedGeneral}`, () => {
    const employees = makeEmployees();
    const { week, shiftId } = singleActiveShift(product);
    const { week: result } = runScheduler({ mode: "fillGaps", week, employees, absences: [], allWeeks: [week] });
    const shift = result.shifts.find((s) => s.id === shiftId);

    expect(shift.assigned.pos1).toBeTruthy();
    expect(shift.assigned.pos3).toBeTruthy();
    expect(shift.assigned.pos1).not.toBe(shift.assigned.pos3);
    expect(shift.assigned.general.length).toBe(expectedGeneral);
    expect(shift.assigned.general).not.toContain(shift.assigned.pos1);
    expect(shift.assigned.general).not.toContain(shift.assigned.pos3);

    const allIds = [shift.assigned.pos1, shift.assigned.pos3, ...shift.assigned.general];
    expect(new Set(allIds).size).toBe(total); // ziadny duplikat, presne `total` unikatnych ludi
  });
});

describe("dual-qualified zamestnanec nikdy nezastava dve roly na tej istej zmene", () => {
  it("A (pos1+pos3) obsadi PRESNE jednu z tychto roli, nikdy obe, nikdy aj general navyse", () => {
    const employees = [
      { id: "A", name: "A", roles: ["pos1", "pos3", "general"], weeklyMax: 4, active: true },
      { id: "B", name: "B", roles: ["pos1", "general"], weeklyMax: 4, active: true },
      { id: "C", name: "C", roles: ["general"], weeklyMax: 5, active: true },
      { id: "D", name: "D", roles: ["general"], weeklyMax: 5, active: true },
      { id: "E", name: "E", roles: ["general"], weeklyMax: 5, active: true },
    ];
    const { week, shiftId } = singleActiveShift("sacky");
    const { week: result } = runScheduler({ mode: "fillGaps", week, employees, absences: [], allWeeks: [week] });
    const shift = result.shifts.find((s) => s.id === shiftId);

    const occurrences = [shift.assigned.pos1, shift.assigned.pos3, ...shift.assigned.general].filter((id) => id === "A").length;
    expect(occurrences).toBeLessThanOrEqual(1);
    expect(shift.assigned.pos1).toBeTruthy();
    expect(shift.assigned.pos3).toBeTruthy();
    expect(shift.assigned.pos1).not.toBe(shift.assigned.pos3);
  });
});

describe("pos3 nedostatok - general NESMIE tichoducho nahradit chybajuceho specialistu", () => {
  it("bez ziadneho pos3-kvalifikovaneho zamestnanca: pos3 zostane null + CRITICAL_ROLE_SHORTAGE, general NEDOSTANE navyse cloveka", () => {
    const employees = [
      { id: "hrncova1", name: "H1", roles: ["pos1", "general"], weeklyMax: 4, active: true },
      { id: "g1", name: "G1", roles: ["general"], weeklyMax: 5, active: true },
      { id: "g2", name: "G2", roles: ["general"], weeklyMax: 5, active: true },
      { id: "g3", name: "G3", roles: ["general"], weeklyMax: 5, active: true },
      { id: "g4", name: "G4", roles: ["general"], weeklyMax: 5, active: true },
    ]; // ZIADNY pos3-kvalifikovany zamestnanec v tejto fixture
    const { week, shiftId } = singleActiveShift("sacky"); // total=4 => general rezervovane na 2 (4-2), bez ohladu na pos3
    const { week: result, warnings } = runScheduler({ mode: "fillGaps", week, employees, absences: [], allWeeks: [week] });
    const shift = result.shifts.find((s) => s.id === shiftId);

    expect(shift.assigned.pos3).toBeNull();
    expect(shift.assigned.general.length).toBe(2); // NIE 3 - general sa nesmie "dofukovat" na miesto chybajuceho pos3
    expect(warnings.some((w) => w.code === "CRITICAL_ROLE_SHORTAGE" && w.shiftId === shiftId)).toBe(true);
  });

  it("bez ziadneho pos1-kvalifikovaneho ANI pos1-backup zamestnanca: rovnaka zaruka pre pos1", () => {
    const employees = [
      { id: "poz3a", name: "P3a", roles: ["pos3", "general"], weeklyMax: 4, active: true },
      { id: "g1", name: "G1", roles: ["general"], weeklyMax: 5, active: true },
      { id: "g2", name: "G2", roles: ["general"], weeklyMax: 5, active: true },
      { id: "g3", name: "G3", roles: ["general"], weeklyMax: 5, active: true },
      { id: "g4", name: "G4", roles: ["general"], weeklyMax: 5, active: true },
    ]; // ZIADNY pos1-kvalifikovany (ani backup) zamestnanec v tejto fixture
    const { week, shiftId } = singleActiveShift("sacky");
    const { week: result, warnings } = runScheduler({ mode: "fillGaps", week, employees, absences: [], allWeeks: [week] });
    const shift = result.shifts.find((s) => s.id === shiftId);

    expect(shift.assigned.pos1).toBeNull();
    expect(shift.assigned.general.length).toBe(2);
    expect(warnings.some((w) => w.code === "CRITICAL_ROLE_SHORTAGE" && w.shiftId === shiftId)).toBe(true);
  });
});
