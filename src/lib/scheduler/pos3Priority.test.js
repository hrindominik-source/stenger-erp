import { describe, it, expect } from "vitest";
import { runScheduler } from "./index.js";
import { WARNING } from "./constants.js";
import { generateWeek } from "../../PlanSmienView.jsx";

// Poziadavka: konkretny zamestnanec ("Achacova") ma mat na pozicii 3 prednost
// pred inym ("Jechova"), kedykolvek su OBAJA dostupni - presne ten isty
// mechanizmus, aky uz existuje pre pos1/pos1-backup (primarna rola vs
// zaskok), tu zovseobecneny aj na pos3/pos3-backup. Nastavuje sa v UI
// (Zamestnanci) prepnutim role na 'pos3-backup' pre osobu s nizsou prioritou.
const MON = "2026-09-28";

function makeEmployees({ jechovaRole = "pos3-backup" } = {}) {
  return [
    { id: "hrncova1", name: "Hrncova Jedna", roles: ["pos1", "general"], weeklyMax: 4, active: true },
    { id: "hrncova2", name: "Hrncova Dva", roles: ["pos1", "general"], weeklyMax: 4, active: true },
    { id: "achacova", name: "Achacova", roles: ["pos3", "general"], weeklyMax: 4, active: true },
    { id: "jechova", name: "Jechova", roles: [jechovaRole, "general"], weeklyMax: 4, active: true },
    { id: "gen1", name: "Gen 1", roles: ["general"], weeklyMax: 4, active: true },
    { id: "gen2", name: "Gen 2", roles: ["general"], weeklyMax: 4, active: true },
    { id: "gen3", name: "Gen 3", roles: ["general"], weeklyMax: 4, active: true },
    { id: "gen4", name: "Gen 4", roles: ["general"], weeklyMax: 4, active: true },
    { id: "gen5", name: "Gen 5", roles: ["general"], weeklyMax: 5, active: true },
    { id: "gen6", name: "Gen 6", roles: ["general"], weeklyMax: 5, active: true },
  ];
}

function makeWeek() {
  const week = generateWeek(MON, false);
  week.shifts.forEach((s) => {
    if (s.type === "day") s.product = "sacky";
    if (s.type === "night") s.product = "sacky";
  });
  return week;
}

describe("pos3-backup: prioritny clovek na pozicii 3 pred zaskokom", () => {
  it("Achacova (pos3) pokryje vsetky zmeny, na ktore ma kapacitu (weeklyMax), Jechova (backup) az potom, ked uz nie je kam Achacovu dat", () => {
    // Achacova ma weeklyMax=4 - na 8 hlavnych pos3 slotov (4 den + 4 noc) sama
    // nestaci, takze cast MUSI ist na zaskoka (realna kapacitna matematika, nie
    // chyba prioritneho mechanizmu). Dolezite je, ze Achacova dostane VSETKY
    // zmeny, na ktore este ma miesto (< 4), skor nez sa vobec siahne po zaskokovi.
    const employees = makeEmployees({ jechovaRole: "pos3-backup" });
    const week = makeWeek();
    const { week: result, warnings } = runScheduler({ mode: "fillGaps", week, employees, absences: [], allWeeks: [week] });

    const mainShifts = result.shifts.filter((s) => s.type === "day" || s.type === "night");
    const achacovaCount = mainShifts.filter((s) => s.assigned.pos3 === "achacova").length;
    expect(achacovaCount).toBe(4); // presne jej weeklyMax, ziadna zmena "na dosah" jej neusla v prospech zaskoka
    mainShifts.forEach((s) => {
      expect(["achacova", "jechova"]).toContain(s.assigned.pos3); // zvysok legitimne pokryje zaskok
    });
    expect(warnings.some((w) => w.code === WARNING.POS3_BACKUP_USED && w.employeeId === "jechova")).toBe(true);
  });

  it("ked je Achacova na absencii, Jechova (pos3-backup) ju zaskoci a je to zaznamenane warningom", () => {
    const employees = makeEmployees({ jechovaRole: "pos3-backup" });
    const week = makeWeek();
    const absences = [{ employeeId: "achacova", from: MON, to: "2026-10-01" }];
    const { week: result, warnings } = runScheduler({ mode: "fillGaps", week, employees, absences, allWeeks: [week] });

    const monday = result.shifts.find((s) => s.type === "day" && s.date === MON);
    expect(monday.assigned.pos3).toBe("jechova");
    expect(warnings.some((w) => w.code === WARNING.POS3_BACKUP_USED && w.employeeId === "jechova")).toBe(true);
  });

  it("bez pos3-backup (obe primarne pos3) sa vyber riadi len kontinuitou/skore, nie explicitnou prioritou", () => {
    // kontrolny protipripad: ked su OBE primarne 'pos3' (stary stav pred
    // touto poziadavkou), ziadna z nich nema systematicku prednost.
    const employees = makeEmployees({ jechovaRole: "pos3" });
    const week = makeWeek();
    const { week: result } = runScheduler({ mode: "fillGaps", week, employees, absences: [], allWeeks: [week] });
    const mainShifts = result.shifts.filter((s) => s.type === "day" || s.type === "night");
    const pos3Holders = new Set(mainShifts.map((s) => s.assigned.pos3));
    // oba su platni kandidati (rola 'pos3'), takze test len potvrdzuje ze
    // rozhodovanie prebehlo bez chyby - explicitna priorita vyzaduje
    // pos3-backup rolu (test vyssie), nie je to defaultne spravanie.
    expect([...pos3Holders].every((id) => id === "achacova" || id === "jechova")).toBe(true);
  });
});
