import { describe, it, expect } from "vitest";
import { runScheduler } from "./index.js";
import { generateWeek } from "../../PlanSmienView.jsx";

// Cielena kontrola scarcity/opportunity-cost heuristiky (construct.js -
// roleOrder podla velkosti poolu): A vie pos1 AJ pos3, B vie LEN pos1, nikto
// iny nevie pos3. Jedina cesta k plnemu critical-role pokrytiu je B->pos1,
// A->pos3 (A je jediny, kto moze zachranit pos3; B nema kam inam ist nez
// pos1). Ak by sa pos1 spracoval prvy naivne a vzal A skor, pos3 by zostal
// bez kandidata (shortage) - presne znamy kompromis, ktory tu overujeme.
describe("scarcity heuristika pre kriticke role (dual-qualified pos1+pos3)", () => {
  it("B (len pos1) dostane pos1, A (pos1+pos3) dostane pos3 - jediny sposob plneho pokrytia", () => {
    const employees = [
      { id: "A", name: "A dual", roles: ["pos1", "pos3", "general"], weeklyMax: 4, active: true },
      { id: "B", name: "B pos1-only", roles: ["pos1", "general"], weeklyMax: 4, active: true },
      { id: "C", name: "C general", roles: ["general"], weeklyMax: 4, active: true },
      { id: "D", name: "D general", roles: ["general"], weeklyMax: 4, active: true },
      { id: "E", name: "E general", roles: ["general"], weeklyMax: 4, active: true },
      { id: "F", name: "F general", roles: ["general"], weeklyMax: 4, active: true },
    ];
    // Zamerne LEN 2 aktivne zmeny (pondelok den + utorok den, produkt=null
    // na vsetkych ostatnych aby mali total=0 a boli enginom preskocene) - s
    // presne 2 critical-role-schopnymi ludmi (A, B) by CELY tyzden (8 zmien x
    // pos1+pos3) bol strukturalne nepokryvatelny nezavisle od poradia
    // (nedostatok kapacity, nie chyba heuristiky), takze test izoluje CISTO
    // otazku poradia/scarcity. DOLEZITE: ponechavame CELE pole w.shifts (aj
    // neaktivne zmeny) nedotknute, aby neighborIdsFor (susednost v poli, nie
    // kalendarovo) pocitala rovnako ako v realnom tyzdni - odstranenim
    // "medzizmien" by sa pondelok a utorok umelo stali susednymi.
    const week = generateWeek("2026-09-28", false);
    const dayShifts = week.shifts.filter((s) => s.type === "day");
    dayShifts[0].product = "sacky";
    dayShifts[1].product = "sacky";

    const { week: result, warnings } = runScheduler({ mode: "fillGaps", week, employees, absences: [], allWeeks: [week] });

    const mainShifts = result.shifts.filter((s) => s.date === dayShifts[0].date || s.date === dayShifts[1].date).filter((s) => s.type === "day");
    mainShifts.forEach((s) => {
      expect(s.assigned.pos1).toBeTruthy();
      expect(s.assigned.pos3).toBeTruthy();
    });
    expect(warnings.filter((w) => w.code === "CRITICAL_ROLE_SHORTAGE").length).toBe(0);

    // B (jediny "cisty" pos1) musi byt pouzity na pos1 aspon niekde, A na pos3
    // aspon niekde - inak by cast tyzdna zostala bez pokrytia.
    const pos1Holders = new Set(mainShifts.map((s) => s.assigned.pos1));
    const pos3Holders = new Set(mainShifts.map((s) => s.assigned.pos3));
    expect(pos3Holders.has("A")).toBe(true); // A je JEDINY mozny drzitel pos3
    expect(pos3Holders.has("B")).toBe(false); // B nema rolu pos3 vobec
    expect(pos1Holders.has("B") || pos1Holders.has("A")).toBe(true);
  });
});
