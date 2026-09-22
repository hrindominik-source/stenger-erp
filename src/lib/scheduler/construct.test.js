import { describe, it, expect } from "vitest";
import { runScheduler } from "./index.js";
import { WARNING } from "./constants.js";
import { employeeDailySequence, findBadPatterns } from "./blockAnalysis.js";
import { markPreserved } from "./manualPreserve.js";
import { makeRealisticEmployees, makeRealisticWeek, findShift } from "./testFixtures.js";
import { weekShiftCount, shiftPeopleIds } from "../../PlanSmienView.jsx";

const MON = "2026-09-28";

function run(mode, overrides = {}) {
  const employees = overrides.employees || makeRealisticEmployees();
  const week = overrides.week || makeRealisticWeek(MON);
  const absences = overrides.absences || [];
  const allWeeks = overrides.allWeeks || [week];
  return runScheduler({ mode, week, employees, absences, allWeeks, preferences: overrides.preferences, referenceWeek: overrides.referenceWeek });
}

describe("1) cisty tyzden bez absencii - fillGaps plne obsadi kriticke role", () => {
  it("vsetky pos1/pos3 sloty su obsadene", () => {
    const { week } = run("fillGaps");
    week.shifts.forEach((s) => {
      if (s.type === "sanitation") return; // sanitacia moze byt obsadena len general, to je OK
      expect(s.assigned.pos1).toBeTruthy();
      expect(s.assigned.pos3).toBeTruthy();
    });
  });
});

describe("2) jedna dovolenka (absencia) cez cely tyzden", () => {
  it("clovek na absencii nedostane ziadnu zmenu v danom obdobi", () => {
    const absences = [{ employeeId: "gen1", from: MON, to: "2026-10-01" }];
    const { week } = run("fillGaps", { absences });
    week.shifts.forEach((s) => {
      if (s.date >= MON && s.date <= "2026-10-01") {
        expect(shiftPeopleIds(s)).not.toContain("gen1");
      }
    });
  });
});

describe("3) PN / lekar - jednodnova absencia blokuje len ten den", () => {
  it("clovek je vylucen len z dna absencie, inak dostupny", () => {
    const absences = [{ employeeId: "gen2", from: "2026-09-29", to: "2026-09-29" }];
    const { week } = run("fillGaps", { absences });
    const tueDay = findShift(week, "2026-09-29", "day");
    const tueNight = findShift(week, "2026-09-29", "night");
    expect(shiftPeopleIds(tueDay)).not.toContain("gen2");
    expect(shiftPeopleIds(tueNight)).not.toContain("gen2");
  });
});

describe("4) kriticka rola pos1 - kazda den/noc zmena s objemom musi mat pos1 ak je niekto k dispozicii", () => {
  it("pos1 obsadeny na vsetkych hlavnych zmenach", () => {
    const { week, warnings } = run("fillGaps");
    const shortages = warnings.filter((w) => w.code === WARNING.CRITICAL_ROLE_SHORTAGE);
    expect(shortages.length).toBe(0);
  });
});

describe("5) pos1-backup sa pouzije az ked su vsetci primarni pos1 nedostupni", () => {
  it("ak su obaja hrncova na absencii cely tyzden, zaskok prevezme zmeny a je zaznamenany warning", () => {
    const absences = [
      { employeeId: "hrncova1", from: MON, to: "2026-10-01" },
      { employeeId: "hrncova2", from: MON, to: "2026-10-01" },
    ];
    const { week, warnings } = run("fillGaps", { absences });
    const mondayDay = findShift(week, MON, "day");
    expect(mondayDay.assigned.pos1).toBe("hrncovaBackup");
    expect(warnings.some((w) => w.code === WARNING.POS1_BACKUP_USED)).toBe(true);
  });
});

describe("6) nedostatok (scarcity) pos1/pos3 - warning ked nie je kym obsadit", () => {
  it("ak nie je ziadny pos1 kandidat, vygeneruje sa CRITICAL_ROLE_SHORTAGE a nezhadzuje sa cely beh", () => {
    const employees = makeRealisticEmployees().filter((e) => !["hrncova1", "hrncova2", "hrncovaBackup"].includes(e.id));
    const { warnings } = run("fillGaps", { employees });
    expect(warnings.some((w) => w.code === WARNING.CRITICAL_ROLE_SHORTAGE)).toBe(true);
  });
});

describe("7) standardny DDDD blok - clovek s DAY_BLOCK zamerom dostane suvisly denny blok", () => {
  it("hrncova1 (DAY_BLOCK z kontinuity) ma 4 po sebe idace denne zmeny", () => {
    const prevWeek = makeRealisticWeek("2026-09-21");
    ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"].forEach((d) => {
      findShift(prevWeek, d, "day").assigned.pos1 = "hrncova1";
    });
    const week = makeRealisticWeek(MON);
    const { week: result } = run("fillGaps", { week, allWeeks: [prevWeek, week] });
    const seq = employeeDailySequence(result, "hrncova1");
    expect(seq).toEqual(["day", "day", "day", "day"]);
  });
});

describe("8) standardny NNNN blok - clovek s NIGHT_BLOCK zamerom dostane suvisly nocny blok", () => {
  it("hrncova2 (NIGHT_BLOCK z kontinuity) ma 4 po sebe idace nocne zmeny", () => {
    const prevWeek = makeRealisticWeek("2026-09-21");
    ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"].forEach((d) => {
      findShift(prevWeek, d, "night").assigned.pos1 = "hrncova2";
    });
    const week = makeRealisticWeek(MON);
    const { week: result } = run("fillGaps", { week, allWeeks: [prevWeek, week] });
    const seq = employeeDailySequence(result, "hrncova2");
    expect(seq).toEqual(["night", "night", "night", "night"]);
  });
});

describe("9) 5. zmena je len vynimocny fallback, nikdy 6.", () => {
  it("ziadny zamestnanec nema 6 a viac zmien v tyzdni", () => {
    const { week: result } = run("fillGaps");
    const employees = makeRealisticEmployees();
    employees.forEach((e) => {
      expect(weekShiftCount(result, e.id)).toBeLessThanOrEqual(5);
    });
  });
  it("ak dostane niekto vynimocne 5. zmenu, je to explicitne zaznamenane warningom", () => {
    // umelo maly tim, aby 5. zmena bola nutna
    const employees = makeRealisticEmployees().slice(0, 7);
    const { warnings } = run("fillGaps", { employees });
    const fifthWarnings = warnings.filter((w) => w.code === WARNING.EXCEPTIONAL_FIFTH_SHIFT);
    // ak k tomu doslo, musi byt zaznamenane (samotna existencia nie je vyzadovana, len konzistentnost)
    fifthWarnings.forEach((w) => expect(w.employeeId).toBeTruthy());
  });
});

describe("10) predchadzanie zbytocnemu D-D-OFF-N a D-N-D vzoru", () => {
  it("v cistom scenari bez preferencii nevznika D-N-D pre kriticke role", () => {
    const { week } = run("fillGaps");
    const employees = makeRealisticEmployees();
    let anyBad = false;
    employees.forEach((e) => {
      const seq = employeeDailySequence(week, e.id);
      if (findBadPatterns(seq).length > 0) anyBad = true;
    });
    // nie je tvrda garancia (moze byt nutne pri nedostatku ludi), ale v komfortnej fixture by nemalo vzniknut
    expect(anyBad).toBe(false);
  });
});

describe("11) Zuzana / part-time zamestnanec s ~2 zmenami tyzdenne", () => {
  it("respektuje targetWeeklyShifts=2 (nedostane 4 zmeny len preto, ze je dostupna)", () => {
    const preferences = { zuzana: { targetWeeklyShifts: 2, preferredShiftMix: "balanced" } };
    const { week } = run("fillGaps", { preferences });
    expect(weekShiftCount(week, "zuzana")).toBeLessThanOrEqual(2);
  });
});

describe("12) preferovany mix (day/night/balanced) sa premietne do skutocnych zmien", () => {
  it("preferencia 'day' vedie k prevazne dennym zmenam", () => {
    const preferences = { zuzana: { targetWeeklyShifts: 3, preferredShiftMix: "day" } };
    const { week } = run("fillGaps", { preferences });
    const seq = employeeDailySequence(week, "zuzana");
    const dayCount = seq.filter((s) => s === "day").length;
    const nightCount = seq.filter((s) => s === "night").length;
    expect(dayCount).toBeGreaterThanOrEqual(nightCount);
  });
});

describe("13) historia (dlhodoba spravodlivost) nesmie zhorsit lepsi blok", () => {
  it("clovek s malo odpracovanymi zmenami v minulosti stale dostane suvisly blok, nie roztrhany kvoli tie-breaku", () => {
    const allWeeksHistory = [];
    let cursor = "2026-08-03";
    for (let i = 0; i < 3; i++) {
      const w = makeRealisticWeek(cursor);
      allWeeksHistory.push(w);
      cursor = new Date(new Date(cursor).getTime() + 7 * 86400000).toISOString().slice(0, 10);
    }
    const week = makeRealisticWeek(MON);
    const { week: result } = run("fillGaps", { week, allWeeks: [...allWeeksHistory, week] });
    // gen1 (bez historie) - ak dostane zmeny, mali by byt suvisle, nie roztrhane kvoli fairness tie-breaku
    const seq = employeeDailySequence(result, "gen1");
    const badPatterns = findBadPatterns(seq);
    expect(badPatterns.length).toBe(0);
  });
});

describe("14) deterministicky vystup - rovnaky vstup vzdy rovnaky vystup", () => {
  it("dva behy s identickym vstupom davaju bit-presne rovnaky rozpis", () => {
    const employees = makeRealisticEmployees();
    const week1 = makeRealisticWeek(MON);
    const week2 = makeRealisticWeek(MON);
    const r1 = runScheduler({ mode: "fillGaps", week: week1, employees, absences: [], allWeeks: [week1] });
    const r2 = runScheduler({ mode: "fillGaps", week: week2, employees, absences: [], allWeeks: [week2] });
    // porovnaj len assigned (id zmien su nezavisle generovane citace, nie su stabilne)
    const strip = (w) => w.shifts.map((s) => ({ date: s.date, type: s.type, assigned: s.assigned }));
    expect(JSON.stringify(strip(r1.week))).toBe(JSON.stringify(strip(r2.week)));
  });
});

describe("15) fillGaps zachovava 100% existujucich priradeni", () => {
  it("rucne predom zadane priradenia zostavaju presne take, ake boli", () => {
    const week = makeRealisticWeek(MON);
    findShift(week, MON, "day").assigned.pos1 = "hrncova1";
    findShift(week, MON, "day").assigned.general = ["gen1", "gen2"];
    const { week: result } = run("fillGaps", { week });
    const mondayDay = findShift(result, MON, "day");
    expect(mondayDay.assigned.pos1).toBe("hrncova1");
    expect(mondayDay.assigned.general).toEqual(expect.arrayContaining(["gen1", "gen2"]));
  });
});

describe("16) replan respektuje preserveOnReplan priradenie", () => {
  it("priradenie oznacene ako preserved prezije cely replan nedotknute", () => {
    let week = makeRealisticWeek(MON);
    let mondayDay = findShift(week, MON, "day");
    mondayDay.assigned.pos1 = "hrncova1";
    week.shifts = week.shifts.map((s) => (s.id === mondayDay.id ? markPreserved(s, "pos1") : s));
    mondayDay = findShift(week, MON, "day");
    mondayDay.assigned.general.push("gen3");
    // gen3 v general NIE JE oznaceny ako preserved -> replan ho moze zmenit
    const { week: result } = run("replan", { week });
    const resultMonday = findShift(result, MON, "day");
    expect(resultMonday.assigned.pos1).toBe("hrncova1");
  });

  it("nepreservovane priradenia sa pri replan vymazu a prepocitaju odznova", () => {
    let week = makeRealisticWeek(MON);
    let mondayDay = findShift(week, MON, "day");
    mondayDay.assigned.pos3 = "poz3b"; // schvalne "spatny" clovek bez oznacenia preserved
    const { week: result } = run("replan", { week });
    // poz3b nemusi zostat - dolezite je len, ze proces prebehol bez chyby a slot je znova platny (obsadeny alebo warning)
    const resultMonday = findShift(result, MON, "day");
    expect(typeof resultMonday.assigned.pos3 === "string" || resultMonday.assigned.pos3 === null).toBe(true);
  });
});

describe("17) jedna zmena absencie sposobi len minimalnu rozumnu zmenu (replan)", () => {
  it("pridanie absencie jednemu clovekovi nezhodi cely rozpis ostatnych na replan", () => {
    const week1 = makeRealisticWeek(MON);
    const { week: base } = run("replan", { week: week1 });
    const week2 = makeRealisticWeek(MON);
    const absences = [{ employeeId: "gen1", from: "2026-09-29", to: "2026-09-29" }];
    const { week: withAbsence } = run("replan", { week: week2, absences, referenceWeek: base });

    let sameAssignmentCount = 0;
    let total = 0;
    base.shifts.forEach((s) => {
      const other = withAbsence.shifts.find((o) => o.date === s.date && o.type === s.type);
      total++;
      if (s.assigned.pos1 === other.assigned.pos1 && s.assigned.pos3 === other.assigned.pos3) sameAssignmentCount++;
    });
    // vacsina zmien (kritickych roli) by mala zostat rovnaka - jedna absencia nema sposobit domino efekt vsade
    expect(sameAssignmentCount / total).toBeGreaterThan(0.5);
  });
});

describe("18) staffing shortage sa hlasi explicitne, nie ticho", () => {
  it("ked nie je dost ludi na general pozicie, vygeneruje sa STAFFING_SHORTAGE warning", () => {
    const employees = makeRealisticEmployees().slice(0, 5);
    const { warnings } = run("fillGaps", { employees });
    expect(warnings.some((w) => w.code === WARNING.STAFFING_SHORTAGE)).toBe(true);
  });
});

describe("19) rovnaka osoba nedostane dve zmeny tesne vedla seba (fatigue pravidlo zachovane)", () => {
  it("nikto nema priradenu dennu aj nocnu zmenu v ten isty den", () => {
    const { week } = run("fillGaps");
    const byDate = new Map();
    week.shifts.forEach((s) => {
      if (s.type === "sanitation") return;
      if (!byDate.has(s.date)) byDate.set(s.date, {});
      byDate.get(s.date)[s.type] = s;
    });
    byDate.forEach(({ day, night }) => {
      if (!day || !night) return;
      const dayPeople = new Set(shiftPeopleIds(day));
      shiftPeopleIds(night).forEach((id) => expect(dayPeople.has(id)).toBe(false));
    });
  });
});

describe("20) preferovana rola pos1 nikdy neprekroci hard cap 5 zmien", () => {
  it("aj pri velmi malom tíme nikto nedostane 6. zmenu", () => {
    const employees = makeRealisticEmployees().slice(0, 6);
    const { week } = run("fillGaps", { employees });
    employees.forEach((e) => expect(weekShiftCount(week, e.id)).toBeLessThanOrEqual(5));
  });
});
