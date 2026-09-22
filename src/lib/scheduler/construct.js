// Hlavny konstruktivny builder noveho schedulera. DVA rezimy so ROZNYMI
// zarukami (podla zadania):
//   - fillGaps: VSETKY existujuce priradenia su FIXED INPUT, nikdy sa
//     neprepisuju - dopllnaju sa len prazdne miesta.
//   - replan: cisty prepocet cely tyzden, ale priradenia oznacene
//     shift.preserveOnReplan sa zachovaju (viz manualPreserve.js).
// Obe rezimy zdielaju rovnaku konstrukciu (nizsie) - lisi sa len to, co sa
// povazuje za uz "fixne dane" predtym, nez sa zacnu plnit prazdne sloty.
import { cloneWeek, shiftTotal, weekShiftCount } from "../../PlanSmienView.jsx";
import { eligibleForRole } from "./eligibility.js";
import { ensurePreserveShape } from "./manualPreserve.js";
import { computeWeeklyIntents } from "./intent.js";
import { scoreCandidate } from "./scoring.js";
import { WARNING, HARD_MAX_SHIFTS, NORMAL_TARGET_SHIFTS } from "./constants.js";

function pickBest(candidates, shift, scoreCtx, traceCtx) {
  if (candidates.length === 0) return null;
  const scored = candidates.map((c) => ({ c, score: scoreCandidate(c, shift, scoreCtx) }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0; // deterministicky tie-break, ziadny Math.random
  });
  if (traceCtx && traceCtx.trace) {
    traceCtx.trace.push({
      shiftId: shift.id,
      date: shift.date,
      type: shift.type,
      role: traceCtx.role,
      pickedId: scored[0].c.id,
      candidates: scored.map((s) => ({ id: s.c.id, score: s.score })),
    });
  }
  return scored[0].c;
}

// `trace` (volitelne, len na diagnostiku/reporting - NEmenene default spravanie):
// ked sa oda pole, kazde volanie pickBest do neho zapise {shiftId, date, type,
// role, pickedId, candidates: [{id, score}]} - presne dost na spatne
// zrekonstruovanie "preco dostal X 5. zmenu a kto boli ostatni kandidati".
export function constructSchedule({ mode, week, employees, absences, allWeeks, preferences, referenceWeek, trace }) {
  const w = cloneWeek(week);
  const warnings = [];

  if (mode === "replan") {
    w.shifts.forEach((s) => {
      const preserve = ensurePreserveShape(s);
      const keepPos1 = preserve.pos1 ? s.assigned.pos1 : null;
      const keepPos3 = preserve.pos3 ? s.assigned.pos3 : null;
      const keepGeneral = (s.assigned.general || []).filter((id) => preserve.general.includes(id));
      if (keepPos1 || keepPos3 || keepGeneral.length) {
        warnings.push({
          code: WARNING.MANUAL_ASSIGNMENT_PRESERVED,
          shiftId: s.id,
          message: `Rucne potvrdene priradenie na zmene ${s.date} (${s.type}) bolo pri prepocitani zachovane.`,
        });
      }
      s.assigned = { pos1: keepPos1, pos3: keepPos3, general: keepGeneral };
      s.extra = [];
      s.preserveOnReplan = preserve;
    });
  }

  const activeEmployees = employees.filter((e) => e.active);
  const intents = computeWeeklyIntents(activeEmployees, { week: w, absences, allWeeks, preferences });
  const scoreCtx = { week: w, allWeeks, intents, referenceWeek };

  // --- KRITICKE ROLE (pos1, pos3) ---
  // Poradie spracovania: rola s MENSIM poctom kvalifikovanych ludi ide prva,
  // aby "vzacnejsi" zdroj mal prednostny vyber pred tym, co je hojnejsie
  // dostupne (jednoduchy, ale explicitny odhad "opportunity cost" scarcity).
  const pos1Pool = activeEmployees.filter((e) => e.roles.includes("pos1")).length;
  const pos3Pool = activeEmployees.filter((e) => e.roles.includes("pos3")).length;
  const roleOrder = pos1Pool <= pos3Pool ? ["pos1", "pos3"] : ["pos3", "pos1"];

  roleOrder.forEach((role) => {
    w.shifts.forEach((shift) => {
      const total = shiftTotal(shift);
      if (total === 0) return;
      if (shift.assigned[role]) return; // uz fixne dane (fillGaps existujuce, alebo replan preserved)

      const primaryCands = eligibleForRole(shift, role, activeEmployees, absences, w);
      let cands = primaryCands;
      if (role === "pos1") {
        // Zaskok (pos1-backup) sa pouzije nielen ked je primarny pool prazdny,
        // ale UZ AJ VTEDY, ked by jediny zostavajuci primarny kandidat musel
        // dostat vynimocnu 5. zmenu - kym zaskok je stale k dispozicii pod
        // normalnym cielom (4). Zaskok sa prida do SPOLOCNEHO poolu a rozhodne
        // skore (scoring.js uz penalizuje 5. zmenu vysoko), nie hardcodovana
        // priorita - takze ak by aj zaskok potreboval 5. zmenu, moze byt aj
        // tak vybrany primarny clovek (rovnaky "najmensie zlo" princip).
        const primaryHasCleanOption = primaryCands.some((e) => weekShiftCount(w, e.id) < NORMAL_TARGET_SHIFTS);
        if (!primaryHasCleanOption) {
          const backupCands = eligibleForRole(shift, "pos1-backup", activeEmployees, absences, w);
          cands = [...primaryCands, ...backupCands];
        }
      }
      const pick = pickBest(cands, shift, scoreCtx, { trace, role });
      const usedBackup = Boolean(pick) && !primaryCands.some((e) => e.id === pick.id);
      if (pick) {
        shift.assigned[role] = pick.id;
        if (usedBackup) {
          warnings.push({ code: WARNING.POS1_BACKUP_USED, shiftId: shift.id, employeeId: pick.id, message: `Pozicia hrncovej na zmene ${shift.date} obsadena zaskokom (pos1-backup).` });
        }
        if (weekShiftCount(w, pick.id) >= HARD_MAX_SHIFTS) {
          warnings.push({ code: WARNING.EXCEPTIONAL_FIFTH_SHIFT, shiftId: shift.id, employeeId: pick.id, message: `${pick.name} ma tento tyzden vynimocne 5. zmenu.` });
        }
      } else {
        warnings.push({ code: WARNING.CRITICAL_ROLE_SHORTAGE, shiftId: shift.id, message: `Nepodarilo sa obsadit poziciu ${role} pre zmenu ${shift.date} (${shift.type}).` });
      }
    });
  });

  // --- OSTATNI (general) ---
  w.shifts.forEach((shift) => {
    const total = shiftTotal(shift);
    if (total === 0) return;
    const needed = total - (shift.assigned.pos1 ? 1 : 0) - (shift.assigned.pos3 ? 1 : 0);
    let already = shift.assigned.general.slice();

    const guardLimit = Math.max(0, needed) + 10;
    let guard = 0;
    while (already.length < needed && guard < guardLimit) {
      guard++;
      shift.assigned.general = already; // synchronizuj pre eligibleForRole (usedInShift vylucenie)
      const cands = eligibleForRole(shift, "general", activeEmployees, absences, w).filter((e) => !already.includes(e.id));
      const pick = pickBest(cands, shift, scoreCtx, { trace, role: "general" });
      if (!pick) break;
      already.push(pick.id);
    }
    shift.assigned.general = already;

    if (already.length < needed) {
      warnings.push({
        code: WARNING.STAFFING_SHORTAGE,
        shiftId: shift.id,
        message: `Zmena ${shift.date} (${shift.type}) ma nedostatok ludi: ${shift.assigned.general.length + (shift.assigned.pos1 ? 1 : 0) + (shift.assigned.pos3 ? 1 : 0)}/${total}.`,
      });
    }
  });

  return { week: w, warnings };
}
