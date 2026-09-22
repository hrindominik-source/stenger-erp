import { describe, it, expect } from "vitest";
import { runScheduler } from "./index.js";
import { weekShiftCount } from "../../PlanSmienView.jsx";
import { formatWeekRoster } from "./reportFormat.js";
import { makeRealisticEmployees, makeRealisticWeek, findShift } from "./testFixtures.js";

const MON = "2026-09-28";
const PREV = "2026-09-21";

// Cielena kontrola "prilis dokonaleho" blokovania: ak je nocny dopyt vyssi,
// nez cista kapacita (pod cielom 4) dvoch "nocnych" ludi, scheduler NESMIE
// radsej tlacit tychto dvoch do 5./6. zmeny, kym existuje dostatok INYCH
// (aj ked "dennych") ludi s volnou kapacitou pod 4 - musi si radsej "poziciat"
// cloveka z dennej strany (mierna -6 penalizacia za zly zamer), nez niekomu
// dat zbytocnu 5. zmenu (-30 penalizacia). Kontinuita (nie tvrda absencia)
// sa tu pouziva na vytvorenie realistickeho zamerneho tlaku, presne ako v
// produkcii - ziadne umele "vypnutie" poolu.
describe("kontrola prilis agresivneho blokovania (nie na ukor zbytocnej 5. zmeny)", () => {
  it("vysoky nocny dopyt (16 general-noci) sa rozlozi na dostupnych ludi namiesto tlacenia gen1/gen2 do 5. zmeny", () => {
    const employees = makeRealisticEmployees();
    const dayLeaning = ["gen3", "gen4", "gen5", "gen6", "gen7", "gen8", "zuzana"];

    const prevWeek = makeRealisticWeek(PREV);
    dayLeaning.forEach((id) => {
      ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"].forEach((d) => {
        findShift(prevWeek, d, "day").assigned.general.push(id);
      });
    });
    ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"].forEach((d) => {
      findShift(prevWeek, d, "night").assigned.general.push("gen1", "gen2");
    });

    const week = makeRealisticWeek(MON);
    ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"].forEach((d) => {
      findShift(week, d, "night").product = "kybliky"; // total 6 => 4 general/noc x 4 noci = 16 general-noci dopytu
    });

    const { week: result, warnings } = runScheduler({ mode: "fillGaps", week, employees, absences: [], allWeeks: [prevWeek, week] });
    console.log("\n=== over-blocking sanity roster (16 general-noci dopyt, 9 dostupnych ludi) ===");
    console.log(formatWeekRoster(result, employees, warnings));
    console.log("warnings:", JSON.stringify(warnings, null, 2));

    // 16 general-noci dopytu, 9 dostupnych CISTO-general (nie pos1/pos3) ludi
    // s cistou kapacitou 4 kazdy (36 spolu) - musi sa dat pokryt bez toho, aby
    // NIEKTO z nich potreboval zbytocnu 5. zmenu. (pos1/pos3 drzitelia su tu
    // zamerne vynechani - ich piatkova sanitacia je uz vysvetlena/opravena
    // strukturalna vynimka, viz "5) pos1-backup..." testy a zaverecna sprava,
    // a pre pos3 chyba v datovom modeli akykolvek "backup" ekvivalent.)
    employees
      .filter((e) => !e.roles.includes("pos1") && !e.roles.includes("pos3") && !e.roles.includes("pos1-backup") && e.active)
      .forEach((e) => {
        expect(weekShiftCount(result, e.id)).toBeLessThanOrEqual(4);
      });
    expect(
      warnings.filter(
        (w) => w.code === "EXCEPTIONAL_FIFTH_SHIFT" && !["hrncova1", "hrncova2", "poz3a", "poz3b"].includes(w.employeeId)
      ).length
    ).toBe(0);
  });

  it("ked demand NAOZAJ presahuje kapacitu vsetkych dostupnych pod 4, 5. zmena je opravnena a hlasena - kontrolny protipripad", () => {
    const employees = makeRealisticEmployees();
    const week = makeRealisticWeek(MON);
    ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"].forEach((d) => {
      findShift(week, d, "night").product = "kybliky"; // total 6 => 4 general/noc
    });
    // len gen1+gen2 dostupni na cely tyzden (vsetci ostatni general su absentni) -
    // 16 general-noci + 8 general-dni demand z 2 ludi je genuinne nepokryte
    const absences = ["gen3", "gen4", "gen5", "gen6", "gen7", "gen8", "zuzana"].map((id) => ({ employeeId: id, from: MON, to: "2026-10-02" }));
    const { warnings } = runScheduler({ mode: "fillGaps", week, employees, absences, allWeeks: [week] });
    expect(warnings.some((w) => w.code === "STAFFING_SHORTAGE")).toBe(true);
  });
});
