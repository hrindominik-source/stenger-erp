import { describe, it, expect } from "vitest";
import { canAutoFill, canReplan } from "../planSmienGuard.js";
import { runScheduler } from "./index.js";
import { makeRealisticEmployees, makeRealisticWeek } from "./testFixtures.js";

// Rovnaky dokaz ako v planSmienGuard.test.js (snapshot pred/po), ale s NOVYM
// schedulerom namiesto povodneho autoFillWeek - potvrdzuje, ze bezpecnostna
// vrstva zo STEP A plati rovnako aj po integracii noveho enginu do
// PlanSmienView.jsx (standing constraint zo zadania - vrstva sa nesmie
// oslabit ani obist).
const TODAY = "2026-09-21"; // pondelok
const PAST_WEEK = "2026-09-14";
const CURRENT_WEEK = "2026-09-21";
const NEXT_WEEK = "2026-09-28";

describe("novy scheduler respektuje ochranu minuleho/aktualneho tyzdna", () => {
  const employees = makeRealisticEmployees();

  it("canAutoFill blokuje minuly aj aktualny tyzden aj pre novy engine (runScheduler sa vobec nevola)", () => {
    const past = makeRealisticWeek(PAST_WEEK);
    const current = makeRealisticWeek(CURRENT_WEEK);
    expect(canAutoFill(past, TODAY).allowed).toBe(false);
    expect(canAutoFill(current, TODAY).allowed).toBe(false);
  });

  it("canReplan blokuje minuly aj aktualny tyzden aj pre novy engine", () => {
    const past = makeRealisticWeek(PAST_WEEK);
    const current = makeRealisticWeek(CURRENT_WEEK);
    expect(canReplan(past, TODAY).allowed).toBe(false);
    expect(canReplan(current, TODAY).allowed).toBe(false);
  });

  it("snapshot: povolena operacia na buducom tyzdni sa nedotkne minuleho/aktualneho tyzdna (rovnaky dokaz ako STEP A, s NOVYM enginom)", () => {
    const pastWeek = makeRealisticWeek(PAST_WEEK);
    pastWeek.shifts[0].assigned.pos1 = "hrncova1";
    const currentWeek = makeRealisticWeek(CURRENT_WEEK);
    currentWeek.shifts[1].assigned.pos3 = "poz3a";
    const futureWeek = makeRealisticWeek(NEXT_WEEK);

    let weeks = [pastWeek, currentWeek, futureWeek];
    const snapshotBefore = JSON.stringify([weeks[0], weeks[1]]);

    weeks = weeks.map((w) => {
      const guard = canAutoFill(w, TODAY);
      if (!guard.allowed) return w; // presne ako v PlanSmienView.jsx - chraneny tyzden sa ani nepokusi zavolat runScheduler
      const { week: filled } = runScheduler({ mode: "fillGaps", week: w, employees, absences: [], allWeeks: weeks });
      return filled;
    });

    expect(JSON.stringify([weeks[0], weeks[1]])).toBe(snapshotBefore);

    const futureFilled = weeks[2];
    const anyFilled = futureFilled.shifts.some((s) => s.assigned.pos1 || s.assigned.pos3 || s.assigned.general.length > 0);
    expect(anyFilled).toBe(true);
  });
});
