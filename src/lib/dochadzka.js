import { parseSkDate } from "./utils.js";

export const NOCNE_OD_HOD = 18;
export const NOCNE_DO_HOD = 6;
export const MESACNA_NORMA_HOD = 160;
export const MAX_SKORY_PRICHOD_HOD = 4;

export function shiftInterval(datum, casZaciatku, casKonca) {
  const day = parseSkDate(datum);
  if (!day || !casZaciatku || !casKonca) return null;
  const [sh, sm] = casZaciatku.split(":").map(Number);
  const [eh, em] = casKonca.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
  const start = new Date(day);
  start.setHours(sh, sm, 0, 0);
  let end = new Date(day);
  end.setHours(eh, em, 0, 0);
  if (end.getTime() <= start.getTime()) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

// Ak niekto tukne prichod skor nez ma nastaveny zaciatok zmeny, hodiny sa pocitaju
// az od zaciatku zmeny. Orezanie sa neaplikuje, ak je rozdiel vacsi nez maxSkorSkorHod -
// vtedy ide skor o inu (napr. nocnu) zmenu nez o skory prichod na tu istu zmenu.
export function clampShiftStart(interval, zaciatokZmenyHHMM, maxSkorSkorHod = MAX_SKORY_PRICHOD_HOD) {
  if (!interval || !zaciatokZmenyHHMM) return interval;
  const [zh, zm] = String(zaciatokZmenyHHMM).split(":").map(Number);
  if ([zh, zm].some((n) => Number.isNaN(n))) return interval;
  const zaciatok = new Date(interval.start);
  zaciatok.setHours(zh, zm, 0, 0);
  if (interval.start.getTime() >= zaciatok.getTime()) return interval;
  const rozdielHod = (zaciatok.getTime() - interval.start.getTime()) / 3600000;
  if (rozdielHod > maxSkorSkorHod) return interval;
  return { start: zaciatok, end: interval.end };
}

function overlapMinutes(aStart, aEnd, bStart, bEnd) {
  const s = aStart.getTime() > bStart.getTime() ? aStart : bStart;
  const e = aEnd.getTime() < bEnd.getTime() ? aEnd : bEnd;
  return e.getTime() > s.getTime() ? (e.getTime() - s.getTime()) / 60000 : 0;
}

export function subtractBreaks(interval, breakIntervals) {
  if (!interval) return [];
  const clipped = (breakIntervals || [])
    .map((b) => {
      if (!b) return null;
      const s = b.start.getTime() < interval.start.getTime() ? interval.start : b.start;
      const e = b.end.getTime() > interval.end.getTime() ? interval.end : b.end;
      if (e.getTime() <= s.getTime()) return null;
      return { start: s, end: e };
    })
    .filter(Boolean)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged = [];
  for (const b of clipped) {
    const last = merged[merged.length - 1];
    if (last && b.start.getTime() <= last.end.getTime()) {
      if (b.end.getTime() > last.end.getTime()) last.end = b.end;
    } else {
      merged.push({ start: b.start, end: b.end });
    }
  }

  const result = [];
  let cursor = interval.start;
  for (const b of merged) {
    if (b.start.getTime() > cursor.getTime()) result.push({ start: cursor, end: b.start });
    if (b.end.getTime() > cursor.getTime()) cursor = b.end;
  }
  if (interval.end.getTime() > cursor.getTime()) result.push({ start: cursor, end: interval.end });
  return result;
}

// Gaussov algoritmus na vypocet Velkonocnej nedele, funguje pre lubovolny rok.
function easterMonday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monthDay = h + l - 7 * m + 114;
  const month = Math.floor(monthDay / 31);
  const day = (monthDay % 31) + 1;
  const easterSunday = new Date(year, month - 1, day);
  const monday = new Date(easterSunday);
  monday.setDate(monday.getDate() + 1);
  return monday;
}

const FIXNE_SVIATKY = [
  [1, 1], [5, 1], [5, 8], [7, 5], [7, 6], [9, 28], [10, 28], [11, 17], [12, 24], [12, 25], [12, 26],
];

function isSameDate(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function isPublicHoliday(date) {
  if (FIXNE_SVIATKY.some(([m, d]) => date.getMonth() + 1 === m && date.getDate() === d)) return true;
  return isSameDate(date, easterMonday(date.getFullYear()));
}

function splitByCalendarDay(interval) {
  const segments = [];
  let cursor = interval.start;
  while (cursor.getTime() < interval.end.getTime()) {
    const nextMidnight = new Date(cursor);
    nextMidnight.setHours(24, 0, 0, 0);
    const segEnd = nextMidnight.getTime() < interval.end.getTime() ? nextMidnight : interval.end;
    segments.push({ start: cursor, end: segEnd });
    cursor = segEnd;
  }
  return segments;
}

function nightMinutesInDaySegment(seg) {
  const dayStart = new Date(seg.start);
  dayStart.setHours(0, 0, 0, 0);
  const morningEnd = new Date(dayStart);
  morningEnd.setHours(NOCNE_DO_HOD, 0, 0, 0);
  const eveningStart = new Date(dayStart);
  eveningStart.setHours(NOCNE_OD_HOD, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(24, 0, 0, 0);
  return overlapMinutes(seg.start, seg.end, dayStart, morningEnd) + overlapMinutes(seg.start, seg.end, eveningStart, dayEnd);
}

// Den sa klasifikuje ako sviatok > vikend > bezny (ak sviatok padne na vikend, pocita sa
// ako sviatok, nie oboje naraz).
export function classifyInterval(interval) {
  const empty = { totalMin: 0, nightMin: 0, weekendMin: 0, holidayMin: 0 };
  if (!interval) return empty;
  const segments = splitByCalendarDay(interval);
  return segments.reduce((acc, seg) => {
    const minutes = (seg.end.getTime() - seg.start.getTime()) / 60000;
    const dow = seg.start.getDay();
    const holiday = isPublicHoliday(seg.start);
    return {
      totalMin: acc.totalMin + minutes,
      nightMin: acc.nightMin + nightMinutesInDaySegment(seg),
      weekendMin: acc.weekendMin + (!holiday && (dow === 0 || dow === 6) ? minutes : 0),
      holidayMin: acc.holidayMin + (holiday ? minutes : 0),
    };
  }, empty);
}

// Ak ma pracovnik v case zmeny otvorenu (neuzavretu) prestavku, den sa vobec nezapocita
// do mesacneho suctu - radsej chybajuci den nez ticho nespravne cislo.
export function computeDayHours(record, vsetkyPauzy, zaciatokZmenyHHMM) {
  const raw = shiftInterval(record.datum, record.casZaciatku, record.casKonca);
  if (!raw) return null;

  const sameMenoBreaks = (vsetkyPauzy || []).filter((b) => b.meno === record.meno);
  const otvorenaBlokuje = sameMenoBreaks.some((b) => {
    if (b.casKonca) return false;
    const bStart = shiftInterval(b.datum, b.casZaciatku, "23:59");
    return bStart && bStart.start.getTime() >= raw.start.getTime() && bStart.start.getTime() < raw.end.getTime();
  });
  if (otvorenaBlokuje) return null;

  const clamped = clampShiftStart(raw, zaciatokZmenyHHMM);
  const breakIntervals = sameMenoBreaks.map((b) => shiftInterval(b.datum, b.casZaciatku, b.casKonca)).filter(Boolean);
  const workedSegments = subtractBreaks(clamped, breakIntervals);

  return workedSegments.reduce(
    (acc, seg) => {
      const c = classifyInterval(seg);
      return {
        totalMin: acc.totalMin + c.totalMin,
        nightMin: acc.nightMin + c.nightMin,
        weekendMin: acc.weekendMin + c.weekendMin,
        holidayMin: acc.holidayMin + c.holidayMin,
      };
    },
    { totalMin: 0, nightMin: 0, weekendMin: 0, holidayMin: 0 }
  );
}

export function summarizeMonth(prestavkyZaMesiac, vsetkyPauzy, workersByMeno, nastavenia) {
  const byMeno = new Map();
  for (const rec of prestavkyZaMesiac || []) {
    if (!byMeno.has(rec.meno)) byMeno.set(rec.meno, []);
    byMeno.get(rec.meno).push(rec);
  }

  const result = {};
  for (const [meno, zaznamy] of byMeno.entries()) {
    const typ = workersByMeno?.[meno]?.typ;
    const zaciatokZmeny = typ === "sklad" ? nastavenia?.zaciatokSklad : typ === "vyroba" ? nastavenia?.zaciatokVyroba : null;

    const totals = zaznamy.reduce(
      (acc, rec) => {
        const h = computeDayHours(rec, vsetkyPauzy, zaciatokZmeny);
        if (!h) return acc;
        return {
          totalMin: acc.totalMin + h.totalMin,
          nightMin: acc.nightMin + h.nightMin,
          weekendMin: acc.weekendMin + h.weekendMin,
          holidayMin: acc.holidayMin + h.holidayMin,
        };
      },
      { totalMin: 0, nightMin: 0, weekendMin: 0, holidayMin: 0 }
    );

    const celkemHod = totals.totalMin / 60;
    result[meno] = {
      celkemHod,
      nocHod: totals.nightMin / 60,
      vikendHod: totals.weekendMin / 60,
      sviatokHod: totals.holidayMin / 60,
      prescasHod: Math.max(0, celkemHod - MESACNA_NORMA_HOD),
    };
  }
  return result;
}
