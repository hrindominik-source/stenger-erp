// Zdielane fixtures pre testy noveho schedulera. Realisticky pocet ludi
// (14) tak, aby sa dal zmysluplne posudit vysledok bloku DDDD/NNNN aj
// benchmark OLD vs NEW - nie mikroskopicka fixture na 3-4 ludi.
import { generateWeek } from "../../PlanSmienView.jsx";

export function makeRealisticEmployees() {
  return [
    { id: "hrncova1", name: "Hrncova Jedna", roles: ["pos1", "general"], weeklyMax: 4, active: true },
    { id: "hrncova2", name: "Hrncova Dva", roles: ["pos1", "general"], weeklyMax: 4, active: true },
    { id: "hrncovaBackup", name: "Hrncova Zaskok", roles: ["pos1-backup", "general"], weeklyMax: 4, active: true },
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
    // weeklyMax=2 zodpoveda jej realnemu nastaveniu v produkcii ("Zamestnanci"
    // sekcia) - povodne tu bola omylom 4, cim testy nezachytili regresiu, ked
    // automaticky engine tento osobny strop ignoroval (viz eligibility.js/scoring.js).
    { id: "zuzana", name: "Zuzana Svobodova", roles: ["general"], weeklyMax: 2, active: true },
  ];
}

// den = sacky (total 4), noc = bulk (total 5) - drzi tyzden staffovatelny
// pri 14 ludoch bez umelo naduteho poctu.
export function makeRealisticWeek(mondayIso, extraSundayNight = false) {
  const week = generateWeek(mondayIso, extraSundayNight);
  week.shifts.forEach((s) => {
    if (s.type === "day") s.product = "sacky";
    if (s.type === "night") s.product = "bulk";
  });
  return week;
}

export function findShift(week, date, type) {
  return week.shifts.find((s) => s.date === date && s.type === type);
}
