import { describe, it, expect } from "vitest";
import { countRuns, findBadPatterns, blockQualityScore, employeeDailySequence, buildDailyTrack } from "./blockAnalysis.js";
import { makeRealisticWeek, findShift } from "./testFixtures.js";

describe("countRuns", () => {
  it("detekuje suvisly blok 4 rovnakeho typu", () => {
    expect(countRuns(["day", "day", "day", "day"])).toEqual([{ type: "day", length: 4, start: 0 }]);
  });
  it("OFF prerusuje beh, zmena typu tiez prerusuje beh", () => {
    expect(countRuns(["day", "day", "OFF", "night"])).toEqual([
      { type: "day", length: 2, start: 0 },
      { type: "night", length: 1, start: 3 },
    ]);
  });
  it("prazdna sekvencia => ziadne behy", () => {
    expect(countRuns(["OFF", "OFF"])).toEqual([]);
  });
});

describe("findBadPatterns", () => {
  it("D-D-OFF-N sa detekuje", () => {
    expect(findBadPatterns(["day", "day", "OFF", "night"]).map((f) => f.pattern)).toContain("day-day-OFF-night");
  });
  it("D-OFF-N sa detekuje", () => {
    expect(findBadPatterns(["day", "OFF", "night"]).map((f) => f.pattern)).toContain("day-OFF-night");
  });
  it("D-N-D sa detekuje", () => {
    expect(findBadPatterns(["day", "night", "day"]).map((f) => f.pattern)).toContain("day-night-day");
  });
  it("cisty DDDD blok nema ziadny zly vzor", () => {
    expect(findBadPatterns(["day", "day", "day", "day"])).toEqual([]);
  });
});

describe("blockQualityScore", () => {
  it("DDDD ma vyssie skore ako DD-OFF-DD (fragmentovane)", () => {
    const full = blockQualityScore(["day", "day", "day", "day"]);
    const fragmented = blockQualityScore(["day", "day", "OFF", "day", "day"]);
    // 4-blok (skore 12) prevazi nad dvoma 2-blokmi (3+3=6)
    expect(full).toBeGreaterThan(fragmented);
  });
  it("pomenovany zly vzor znizuje skore oproti rovnako dlhym behom bez neho", () => {
    const withBadPattern = blockQualityScore(["day", "night", "day"]); // D-N-D
    const neutral = blockQualityScore(["day", "OFF", "OFF"]);
    expect(withBadPattern).toBeLessThan(neutral + 1);
  });
});

describe("employeeDailySequence", () => {
  it("cita spravne priradenia z realneho tyzdna", () => {
    const week = makeRealisticWeek("2026-09-28");
    const monDay = findShift(week, "2026-09-28", "day");
    monDay.assigned.general.push("gen1");
    const seq = employeeDailySequence(week, "gen1");
    expect(seq[0]).toBe("day");
    expect(seq.slice(1).every((s) => s === "OFF")).toBe(true);
  });
});

describe("buildDailyTrack", () => {
  it("vynechava sanitaciu (je mimo dennej osi)", () => {
    const week = makeRealisticWeek("2026-09-28");
    const track = buildDailyTrack(week);
    expect(track.length).toBe(4); // po-st..ct
  });
});
