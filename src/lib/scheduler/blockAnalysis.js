// Analyza "bloku" zmien pre jedneho zamestnanca cez hlavne dni tyzdna
// (den+noc, po-st..ct - sanitacia je mimo tejto osi, viz komentar nizsie).
// Toto je INA os ako neighborIdsFor (ktore pracuje nad surovym poradim
// w.shifts kvoli pravidlu o odpocinku) - tu ide o to, ci ma clovek DDDD/NNNN
// blok cez dni v tyzdni (den a noc zmena na rovnaky den su v w.shifts susedne,
// preto blok "vsetky dni ako denna" NIE JE suvisly v surovom poli).
import { shiftPeopleIds } from "../../PlanSmienView.jsx";
import { BAD_PATTERNS } from "./constants.js";

export function buildDailyTrack(week) {
  const byDate = new Map();
  week.shifts.forEach((s) => {
    if (s.type === "sanitation") return;
    if (!byDate.has(s.date)) byDate.set(s.date, {});
    byDate.get(s.date)[s.type] = s;
  });
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, shifts]) => ({ date, day: shifts.day || null, night: shifts.night || null }));
}

export function employeeDailySequence(week, empId) {
  return buildDailyTrack(week).map(({ day, night }) => {
    if (day && shiftPeopleIds(day).includes(empId)) return "day";
    if (night && shiftPeopleIds(night).includes(empId)) return "night";
    return "OFF";
  });
}

// Rovnake ako employeeDailySequence, ale simuluje PRIDANIE overrideShift
// tomuto zamestnancovi (este predtym, nez sa naozaj priradi) - pouziva sa
// v scoring.js na porovnanie kvality bloku "pred vs. po" bez mutacie tyzdna.
export function employeeDailySequenceWithOverride(week, empId, overrideShift) {
  return buildDailyTrack(week).map(({ date, day, night }) => {
    const dayHas = day && (day.id === overrideShift.id || shiftPeopleIds(day).includes(empId));
    const nightHas = night && (night.id === overrideShift.id || shiftPeopleIds(night).includes(empId));
    if (dayHas) return "day";
    if (nightHas) return "night";
    return "OFF";
  });
}

export function countRuns(sequence) {
  const runs = [];
  let i = 0;
  while (i < sequence.length) {
    if (sequence[i] === "OFF") {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < sequence.length && sequence[j + 1] === sequence[i]) j++;
    runs.push({ type: sequence[i], length: j - i + 1, start: i });
    i = j + 1;
  }
  return runs;
}

export function findBadPatterns(sequence) {
  const found = [];
  BAD_PATTERNS.forEach((pattern) => {
    for (let start = 0; start + pattern.length <= sequence.length; start++) {
      let match = true;
      for (let k = 0; k < pattern.length; k++) {
        if (sequence[start + k] !== pattern[k]) {
          match = false;
          break;
        }
      }
      if (match) found.push({ pattern: pattern.join("-"), start });
    }
  });
  return found;
}

// DDDD/NNNN = idealny blok (najvyssie skore), kratsie bloky su horsie ale
// pripustne (nie zakazane) - presne krivka preferencie zo zadania. Pomenovane
// zle vzory (D-D-OFF-N a pod.) su explicitne penalizovane, nie zakazane.
export function blockQualityScore(sequence) {
  const runs = countRuns(sequence);
  let score = 0;
  runs.forEach((r) => {
    if (r.length >= 4) score += 12;
    else if (r.length === 3) score += 7;
    else if (r.length === 2) score += 3;
    else score += 0;
  });
  score -= findBadPatterns(sequence).length * 6;
  return score;
}
