// Zdielane konstanty pre novy scheduling engine. Ziadne magicke cisla
// roztrusene po moduloch - vsetko tu, aby sa dalo jednoducho overit proti
// zadaniu (4 zmeny normal, 5. len ako vynimka, 6+ nikdy).

export const NORMAL_TARGET_SHIFTS = 4;
export const HARD_MAX_SHIFTS = 5; // 6. zmena je vzdy zakazana, bez ohladu na employee.weeklyMax

export const INTENT = {
  DAY_BLOCK: "DAY_BLOCK",
  NIGHT_BLOCK: "NIGHT_BLOCK",
  FLEXIBLE: "FLEXIBLE",
  OFF_PARTIAL: "OFF_PARTIAL",
};

export const WARNING = {
  EXCEPTIONAL_FIFTH_SHIFT: "EXCEPTIONAL_FIFTH_SHIFT",
  POS1_BACKUP_USED: "POS1_BACKUP_USED",
  POS3_BACKUP_USED: "POS3_BACKUP_USED",
  CRITICAL_ROLE_SHORTAGE: "CRITICAL_ROLE_SHORTAGE",
  STAFFING_SHORTAGE: "STAFFING_SHORTAGE",
  FRAGMENTED_SHIFT_PATTERN: "FRAGMENTED_SHIFT_PATTERN",
  MANUAL_ASSIGNMENT_PRESERVED: "MANUAL_ASSIGNMENT_PRESERVED",
};

// Explicitne pomenovane "zle" vzory (podla zadania) - retazec typov zmien
// zoradenych podla dna v tyzdni pre danu osobu, 'OFF' = ten den nema zmenu.
// Pouzivaju sa v blockPatterns.js na penalizaciu (nie zakaz).
export const BAD_PATTERNS = [
  ["day", "day", "OFF", "night"], // D-D-OFF-N
  ["night", "night", "OFF", "day"], // N-N-OFF-D
  ["day", "OFF", "night"], // D-OFF-N
  ["night", "OFF", "day"], // N-OFF-D
  ["day", "night", "day"], // D-N-D
  ["night", "day", "night"], // N-D-N
];
