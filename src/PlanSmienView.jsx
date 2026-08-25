import React, { useState, useEffect, useRef } from 'react';
import { Sun, Moon, Droplets, Plus, X, AlertTriangle, Trash2, Copy, ChevronLeft, ChevronRight, Printer, KeyRound, CalendarDays, Users2, CalendarOff, History as HistoryIcon, Upload, BarChart3, LogOut, ArrowLeftRight, LayoutDashboard } from 'lucide-react';
import { supabase } from './supabaseClient.js';

/* =========================================================================
   DATA
   ========================================================================= */
/* Zoznam mien (kto vsetko existuje) uz nie je hardcodovany ani editovatelny tu -
   preberá sa z ERP (Pracovnici, typ "Vyroba") cez syncEmployeesWithOffice
   nizsie. Tu sa uklada len co k danej osobe patri specificky pre planovanie zmien
   (roly, max. zmien/tyzden, PIN, docasne vyradenie z rozpisu). */
function syncEmployeesWithOffice(existing, officeWorkers) {
  const officeIds = new Set(officeWorkers.map(w => w.id));
  const byId = new Map(existing.map(e => [e.id, e]));
  officeWorkers.forEach(w => {
    const cur = byId.get(w.id);
    if (cur) {
      byId.set(w.id, { ...cur, name: w.meno });
    } else {
      byId.set(w.id, { id: w.id, name: w.meno, roles: ['general'], weeklyMax: 4, active: true });
    }
  });
  existing.forEach(e => {
    if (!officeIds.has(e.id)) {
      byId.set(e.id, { ...byId.get(e.id), active: false });
    }
  });
  return [...byId.values()];
}

const PRODUCTS = {
  sacky:   { label: 'Sáčky (fólie)',  total: 4 },
  kybliky: { label: 'Kbelíky',        total: 6 },
  bulk:    { label: 'Bulk popcorn',   total: 5 },
};
const SANITATION_TOTAL = 5;
const ROLE_LABEL = { pos1: 'Hrncová', 'pos1-backup': 'Hrncová (záskok)', pos3: 'Pozice 3', general: 'Ostatní' };

const TABS = [
  { key: 'prehlad',   label: 'Přehled',        icon: <LayoutDashboard className="w-[18px] h-[18px]" />, color: 'indigo' },
  { key: 'planner',   label: 'Plán týdne',     icon: <CalendarDays className="w-[18px] h-[18px]" />, color: 'amber' },
  { key: 'employees', label: 'Zaměstnanci',    icon: <Users2 className="w-[18px] h-[18px]" />,        color: 'blue' },
  { key: 'absences',  label: 'Nepřítomnosti',  icon: <CalendarOff className="w-[18px] h-[18px]" />,   color: 'rose' },
  { key: 'history',   label: 'Historie',       icon: <HistoryIcon className="w-[18px] h-[18px]" />,   color: 'violet' },
  { key: 'import',    label: 'Import historie', icon: <Upload className="w-[18px] h-[18px]" />,       color: 'emerald' },
  { key: 'balance',   label: 'Rovnováha',      icon: <BarChart3 className="w-[18px] h-[18px]" />,     color: 'teal' },
];

/* Rovnaky "gradientovy odznak" styl navigacie ako v hlavnej ERP appke (NavButton/NAV_COLORS v App.jsx). */
const TAB_COLORS = {
  indigo:  { badge: 'from-indigo-400 to-indigo-600', shadow: 'shadow-indigo-500/40' },
  amber:   { badge: 'from-amber-400 to-amber-600',   shadow: 'shadow-amber-500/40' },
  blue:    { badge: 'from-blue-400 to-blue-600',     shadow: 'shadow-blue-500/40' },
  rose:    { badge: 'from-rose-400 to-rose-600',     shadow: 'shadow-rose-500/40' },
  violet:  { badge: 'from-violet-400 to-violet-600', shadow: 'shadow-violet-500/40' },
  emerald: { badge: 'from-emerald-400 to-emerald-600', shadow: 'shadow-emerald-500/40' },
  teal:    { badge: 'from-teal-400 to-teal-600',     shadow: 'shadow-teal-500/40' },
};

function PlanNavButton({ icon, label, active, onClick, color }) {
  const c = TAB_COLORS[color] || TAB_COLORS.amber;
  return (
    <button
      onClick={onClick}
      className={
        'group relative flex-1 flex flex-col items-center justify-center gap-1.5 py-3 px-2 rounded-xl text-sm font-bold text-center leading-tight transition-all duration-200 whitespace-nowrap ' +
        (active
          ? 'bg-gradient-to-b from-white to-slate-50 text-slate-900 shadow-lg ' + c.shadow + ' -translate-y-0.5'
          : 'text-slate-300 hover:text-white hover:bg-white/5 hover:-translate-y-0.5')
      }
    >
      <span className={'flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br text-white shadow-md transition-transform duration-200 group-hover:scale-110 ' + c.badge}>
        {icon}
      </span>
      {label}
    </button>
  );
}

/* =========================================================================
   DATUMY
   ========================================================================= */
const pad = n => String(n).padStart(2, '0');
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
const mondayOf = iso => { const d = parseISO(iso); const day = d.getDay(); const diff = day === 0 ? -6 : 1 - day; d.setDate(d.getDate() + diff); return toISO(d); };
const DAY_NAMES = ['Neděle', 'Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota'];
const DAY_SHORT = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];
const dayShort = iso => DAY_SHORT[parseISO(iso).getDay()];
const dayLong = iso => DAY_NAMES[parseISO(iso).getDay()];
const formatSk = iso => { const d = parseISO(iso); return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`; };

/* =========================================================================
   TYZDNE A ZMENY
   ========================================================================= */
let shiftCounter = 0;
function makeShift(weekId, date, type, product = null) {
  shiftCounter += 1;
  return { id: `${weekId}_${type}_${date}_${shiftCounter}`, weekId, date, type, product, assigned: { pos1: null, pos3: null, general: [] }, extra: [] };
}
function generateWeek(weekStartMonday, extraSundayNight) {
  const shifts = [];
  if (extraSundayNight) shifts.push(makeShift(weekStartMonday, addDays(weekStartMonday, -1), 'night'));
  for (let i = 0; i < 4; i++) {
    const date = addDays(weekStartMonday, i);
    shifts.push(makeShift(weekStartMonday, date, 'day'));
    shifts.push(makeShift(weekStartMonday, date, 'night'));
  }
  shifts.push(makeShift(weekStartMonday, addDays(weekStartMonday, 4), 'sanitation', 'sanitacia'));
  return { id: weekStartMonday, startDate: weekStartMonday, extraSundayNight, shifts };
}
function cloneWeek(week) { return JSON.parse(JSON.stringify(week)); }

function shiftTotal(shift) {
  if (shift.type === 'sanitation') return SANITATION_TOTAL;
  if (shift.product && PRODUCTS[shift.product]) return PRODUCTS[shift.product].total;
  return 0;
}
function shiftPeopleIds(shift) {
  const ids = [];
  if (shift.assigned.pos1) ids.push(shift.assigned.pos1);
  if (shift.assigned.pos3) ids.push(shift.assigned.pos3);
  ids.push(...shift.assigned.general, ...shift.extra);
  return ids;
}
function clearShiftAssignments(shift) {
  shift.assigned = { pos1: null, pos3: null, general: [] };
  shift.extra = [];
}
/* shiftType je volitelny - ak sa neda a je to nocna zmena na prvom/poslednom dni
   neprítomnosti, zohladnia sa priznaky nightOnFromOk/nightOnToOk (zamestnankyna
   pri ziadosti oznacila, ze tuto konkretnu nocnu smenu na hranici obdobia este/uz zvladne). */
function isOnAbsence(empId, date, absences, shiftType) {
  return absences.some(a => {
    if (a.employeeId !== empId || date < a.from || date > a.to) return false;
    if (shiftType === 'night') {
      if (date === a.from && a.nightOnFromOk) return false;
      if (date === a.to && a.nightOnToOk) return false;
    }
    return true;
  });
}
function weekShiftCount(week, empId) {
  return week.shifts.reduce((c, s) => c + (shiftPeopleIds(s).includes(empId) ? 1 : 0), 0);
}
function globalStats(weeks, empId) {
  let total = 0, day = 0, night = 0, sanitation = 0;
  weeks.forEach(w => w.shifts.forEach(s => {
    if (shiftPeopleIds(s).includes(empId)) {
      total++;
      if (s.type === 'day') day++; else if (s.type === 'night') night++; else sanitation++;
    }
  }));
  return { total, day, night, sanitation };
}
function getEmpNameFrom(employees, id) { const e = employees.find(x => x.id === id); return e ? e.name : '(neznámá)'; }

/* Pomocne funkcie pre planovanie so snahou o suvisle bloky (rovnaka osoba viac zmien rovnakeho typu za sebou) */
function neighborIdsFor(w, shiftId) {
  const idx = w.shifts.findIndex(s => s.id === shiftId);
  const ids = new Set();
  if (idx > 0) shiftPeopleIds(w.shifts[idx - 1]).forEach(id => ids.add(id));
  if (idx < w.shifts.length - 1) shiftPeopleIds(w.shifts[idx + 1]).forEach(id => ids.add(id));
  return ids;
}
function pickBalanced(cands, weeksSnapshot, shiftType) {
  if (cands.length === 0) return null;
  const scored = cands.map(e => {
    const gs = globalStats(weeksSnapshot, e.id);
    const typeCount = shiftType === 'day' ? gs.day : shiftType === 'night' ? gs.night : gs.sanitation;
    return { e, total: gs.total, typeCount };
  });
  scored.sort((a, b) => a.total - b.total || a.typeCount - b.typeCount || a.e.name.localeCompare(b.e.name));
  return scored[0].e;
}

/* Vyplni jednu poziciu (hrncova alebo pozicia 3) pre vsetky zmeny rovnakeho typu (den/noc/sanitacia) v tyzdni,
   pricom sa snazi co najdlhsie drzat tu istu osobu (blok zmien za sebou), kym je to mozne. */
function fillSingleRoleBlock(w, shiftsBlock, roleKey, employees, absences, allWeeks) {
  let current = null;
  shiftsBlock.forEach(shift => {
    const total = shiftTotal(shift);
    if (total === 0) return;
    if (shift.assigned[roleKey]) { current = shift.assigned[roleKey]; return; }

    const neighborIds = neighborIdsFor(w, shift.id);
    const usedInShift = new Set(shiftPeopleIds(shift));
    const weeksSnapshot = allWeeks.map(x => (x.id === w.id ? w : x));

    const eligible = (roleFlag, maxOverride) => employees.filter(e =>
      e.active && e.roles.includes(roleFlag) &&
      !isOnAbsence(e.id, shift.date, absences, shift.type) &&
      !neighborIds.has(e.id) &&
      !usedInShift.has(e.id) &&
      weekShiftCount(w, e.id) < (maxOverride ?? e.weeklyMax)
    );

    if (roleKey === 'pos1') {
      if (current) {
        const curEmp = employees.find(e => e.id === current);
        const stillOk = curEmp && curEmp.active && curEmp.roles.includes('pos1') &&
          !isOnAbsence(current, shift.date, absences, shift.type) && !neighborIds.has(current) && !usedInShift.has(current) &&
          weekShiftCount(w, current) < curEmp.weeklyMax + 1;
        if (stillOk) { shift.assigned.pos1 = current; return; }
      }
      let cands = eligible('pos1');
      if (cands.length === 0) cands = eligible('pos1', Infinity).filter(e => weekShiftCount(w, e.id) < e.weeklyMax + 1);
      if (cands.length === 0) cands = eligible('pos1-backup');
      const pick = pickBalanced(cands, weeksSnapshot, shift.type);
      if (pick) { shift.assigned.pos1 = pick.id; current = pick.id; } else current = null;
    } else {
      if (current) {
        const curEmp = employees.find(e => e.id === current);
        const stillOk = curEmp && curEmp.active && curEmp.roles.includes('pos3') &&
          !isOnAbsence(current, shift.date, absences, shift.type) && !neighborIds.has(current) && !usedInShift.has(current) &&
          weekShiftCount(w, current) < curEmp.weeklyMax;
        if (stillOk) { shift.assigned.pos3 = current; return; }
      }
      const pick = pickBalanced(eligible('pos3'), weeksSnapshot, shift.type);
      if (pick) { shift.assigned.pos3 = pick.id; current = pick.id; } else current = null;
    }
  });
}

/* Vyplni ostatne pozicie pre vsetky zmeny rovnakeho typu, so snahou udrzat rovnaky "tim" v bloku za sebou. */
function fillGeneralBlock(w, shiftsBlock, employees, absences, allWeeks) {
  let team = [];
  shiftsBlock.forEach(shift => {
    const total = shiftTotal(shift);
    if (total === 0) return;
    const needed = Math.max(0, total - (shift.assigned.pos1 ? 1 : 0) - (shift.assigned.pos3 ? 1 : 0));
    const already = shift.assigned.general.slice();
    if (already.length >= needed) { team = already.slice(0, needed); return; }

    const neighborIds = neighborIdsFor(w, shift.id);
    const weeksSnapshot = allWeeks.map(x => (x.id === w.id ? w : x));

    const isEligible = (id, extraExcluded) => {
      const e = employees.find(x => x.id === id);
      if (!e) return false;
      const usedInShift = new Set([...shiftPeopleIds(shift), ...extraExcluded]);
      return e.active && e.roles.includes('general') && !isOnAbsence(id, shift.date, absences, shift.type) &&
        !neighborIds.has(id) && !usedInShift.has(id) && weekShiftCount(w, id) < e.weeklyMax;
    };

    const chosen = [...already];
    team.forEach(id => { if (chosen.length < needed && !chosen.includes(id) && isEligible(id, chosen)) chosen.push(id); });

    let guard = 0;
    while (chosen.length < needed && guard < 30) {
      guard++;
      const usedInShift = new Set([...shiftPeopleIds(shift), ...chosen]);
      const pool = employees.filter(e => e.active && e.roles.includes('general') &&
        !isOnAbsence(e.id, shift.date, absences, shift.type) && !neighborIds.has(e.id) && !usedInShift.has(e.id) &&
        weekShiftCount(w, e.id) < e.weeklyMax);
      const pick = pickBalanced(pool, weeksSnapshot, shift.type);
      if (!pick) break;
      chosen.push(pick.id);
    }
    shift.assigned.general = chosen;
    team = chosen.slice();
  });
}

/* Import historie zo zjednodusenho textoveho formatu:
   DATUM;TYP;PRODUKT;HRNCOVA;POZICIA3;OSTATNI,OSTATNI,...
   TYP = den/noc/sanitacia, PRODUKT a mena su volitelne, mena sa paruju podla existujucich zamestnancov. */
function mapProductToken(p) {
  const s = (p || '').toLowerCase();
  if (s.includes('sac')) return 'sacky';
  if (s.includes('kyb')) return 'kybliky';
  if (s.includes('bulk')) return 'bulk';
  if (s.includes('sanit')) return 'sanitacia';
  return null;
}
function parseImportText(text, employees) {
  const nameToId = new Map();
  employees.forEach(e => nameToId.set(e.name.trim().toLowerCase(), e.id));
  const unmatched = new Set();
  const errors = [];
  const resolve = (n) => {
    if (!n) return null;
    const id = nameToId.get(n.trim().toLowerCase());
    if (!id) { unmatched.add(n.trim()); return null; }
    return id;
  };

  const weeksByStart = new Map();
  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

  lines.forEach((line, idx) => {
    const parts = line.split(/[;,]/).map(p => p.trim());
    if (parts.length < 2) { errors.push(`Řádek ${idx + 1}: příliš málo údajů`); return; }
    const [dateStr, typRaw, prodRaw, hrncova, pozicia3, ...rest] = parts;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) { errors.push(`Řádek ${idx + 1}: neplatné datum "${dateStr}" (očekává se RRRR-MM-DD)`); return; }
    const typ = (typRaw || '').toLowerCase();
    const type = typ.includes('noc') ? 'night' : typ.includes('san') ? 'sanitation' : 'day';
    const weekStart = mondayOf(dateStr);
    if (!weeksByStart.has(weekStart)) weeksByStart.set(weekStart, new Map());
    const shiftsMap = weeksByStart.get(weekStart);
    const key = dateStr + '_' + type;
    let shift = shiftsMap.get(key);
    if (!shift) {
      shift = makeShift(weekStart, dateStr, type, prodRaw ? mapProductToken(prodRaw) : (type === 'sanitation' ? 'sanitacia' : null));
      shiftsMap.set(key, shift);
    }
    const hId = resolve(hrncova);
    if (hId) shift.assigned.pos1 = hId;
    const pId = resolve(pozicia3);
    if (pId) shift.assigned.pos3 = pId;
    rest.forEach(n => {
      const id = resolve(n);
      if (id && !shift.assigned.general.includes(id)) shift.assigned.general.push(id);
    });
  });

  const weeks = [...weeksByStart.entries()].map(([startDate, shiftsMap]) => ({
    id: startDate,
    startDate,
    extraSundayNight: false,
    shifts: [...shiftsMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
  }));

  return { weeks, unmatched: [...unmatched], errors, lineCount: lines.length };
}

/* Automaticke doplnenie volnych miest v tyzdni. Uprednostnuje suvisle bloky zmien rovnakeho typu
   (den/noc/sanitacia) pre tu istu osobu, pokial je to mozne — respektuje neprítomnosti, tyzdenne limity
   a zakaz dvoch zmien tesne za sebou. */
function autoFillWeek(week, employees, absences, allWeeks) {
  const w = cloneWeek(week);
  const byType = { day: [], night: [], sanitation: [] };
  w.shifts.forEach(s => byType[s.type].push(s));

  ['day', 'night', 'sanitation'].forEach(type => {
    if (byType[type].length) fillSingleRoleBlock(w, byType[type], 'pos1', employees, absences, allWeeks);
  });
  ['day', 'night', 'sanitation'].forEach(type => {
    if (byType[type].length) fillSingleRoleBlock(w, byType[type], 'pos3', employees, absences, allWeeks);
  });
  ['day', 'night', 'sanitation'].forEach(type => {
    if (byType[type].length) fillGeneralBlock(w, byType[type], employees, absences, allWeeks);
  });

  return w;
}


/* =========================================================================
   MALE KOMPONENTY
   ========================================================================= */
function PersonChip({ name, warning, onRemove }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${warning ? 'bg-rose-50 text-rose-700 border-rose-300' : 'bg-slate-100 text-slate-700 border-slate-200'}`} title={warning || ''}>
      {warning && <AlertTriangle className="w-3 h-3" />}
      {name}
      <button onClick={onRemove} className="hover:text-rose-600"><X className="w-3 h-3" /></button>
    </span>
  );
}

function TimelineStrip({ week }) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-slate-200 text-[11px] font-mono">
      {week.shifts.map(s => {
        const color = s.type === 'day' ? 'bg-amber-400' : s.type === 'night' ? 'bg-indigo-500' : 'bg-teal-500';
        const textColor = s.type === 'night' ? 'text-white' : 'text-slate-900';
        const filled = shiftPeopleIds(s).length;
        const total = shiftTotal(s);
        return (
          <div key={s.id} className={`flex-1 ${color} ${textColor} px-2 py-2 border-r border-white/30 last:border-r-0`}>
            <div className="font-semibold">{dayShort(s.date)} {s.type === 'day' ? 'D' : s.type === 'night' ? 'N' : 'S'}</div>
            <div className="opacity-80">{filled}/{total || '–'}</div>
          </div>
        );
      })}
    </div>
  );
}

function ShiftRow({ week, shift, employees, absences, onSetProduct, onSetPos, onAddGeneral, onRemoveGeneral, onAddExtra, onRemoveExtra, onClear }) {
  const total = shiftTotal(shift);
  const filledCount = shiftPeopleIds(shift).length;
  const usedIds = new Set(shiftPeopleIds(shift));
  const activeEmp = employees.filter(e => e.active);
  const pos1Options = activeEmp.filter(e => (e.roles.includes('pos1') || e.roles.includes('pos1-backup')) && !usedIds.has(e.id));
  const pos3Options = activeEmp.filter(e => e.roles.includes('pos3') && !usedIds.has(e.id));
  const generalOptions = activeEmp.filter(e => e.roles.includes('general') && !usedIds.has(e.id));
  const anyOptions = activeEmp.filter(e => !usedIds.has(e.id));

  const typeMeta = shift.type === 'day'
    ? { icon: Sun, label: 'Denní', time: '6:00–18:00', badge: 'bg-amber-100 text-amber-800 border-amber-300' }
    : shift.type === 'night'
    ? { icon: Moon, label: 'Noční', time: '18:00–6:00', badge: 'bg-indigo-100 text-indigo-800 border-indigo-300' }
    : { icon: Droplets, label: 'Sanitace', time: '6:00–18:00', badge: 'bg-teal-100 text-teal-800 border-teal-300' };
  const Icon = typeMeta.icon;

  function warn(empId) {
    const emp = employees.find(e => e.id === empId);
    if (!emp) return null;
    if (isOnAbsence(empId, shift.date, absences, shift.type)) return 'Nepřítomná (dovolená/PN/jiné) v tento den';
    if (weekShiftCount(week, empId) > emp.weeklyMax) return `Nad rámec limitu (${emp.weeklyMax} směn/týden)`;
    return null;
  }

  const neededGeneral = Math.max(0, total - (shift.assigned.pos1 ? 1 : 0) - (shift.assigned.pos3 ? 1 : 0));

  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-white">
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-xs font-semibold ${typeMeta.badge}`}>
          <Icon className="w-3.5 h-3.5" /> {typeMeta.label}
        </span>
        <span className="text-sm font-medium text-slate-700">{dayLong(shift.date)} {formatSk(shift.date)}</span>
        <span className="text-xs text-slate-400">{typeMeta.time}</span>

        {shift.type !== 'sanitation' ? (
          <select value={shift.product || ''} onChange={e => onSetProduct(week.id, shift.id, e.target.value || null)}
            className="ml-auto text-sm border border-slate-300 rounded px-2 py-1">
            <option value="">— zvolit produkt —</option>
            {Object.entries(PRODUCTS).map(([k, v]) => <option key={k} value={k}>{v.label} ({v.total} lidí)</option>)}
          </select>
        ) : (
          <span className="ml-auto text-sm text-slate-500">Sanitace linky ({SANITATION_TOTAL} lidí)</span>
        )}

        <span className={`text-xs font-mono px-2 py-1 rounded ${filledCount === total && total > 0 ? 'bg-emerald-100 text-emerald-700' : filledCount < total ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
          {filledCount}/{total || '–'}
        </span>
        <button onClick={() => onClear(week.id, shift.id)} className="text-slate-400 hover:text-rose-600" title="Vyčistit přiřazení">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {total > 0 && (
        <div className="grid sm:grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Hrncová</div>
            {shift.assigned.pos1 ? (
              <PersonChip name={getEmpNameFrom(employees, shift.assigned.pos1)} warning={warn(shift.assigned.pos1)} onRemove={() => onSetPos(week.id, shift.id, 'pos1', null)} />
            ) : (
              <select onChange={e => onSetPos(week.id, shift.id, 'pos1', e.target.value || null)} value="" className="text-sm border border-dashed border-slate-300 rounded px-2 py-1 w-full text-slate-400">
                <option value="">+ přiřadit</option>
                {pos1Options.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            )}
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Pozice 3</div>
            {shift.assigned.pos3 ? (
              <PersonChip name={getEmpNameFrom(employees, shift.assigned.pos3)} warning={warn(shift.assigned.pos3)} onRemove={() => onSetPos(week.id, shift.id, 'pos3', null)} />
            ) : (
              <select onChange={e => onSetPos(week.id, shift.id, 'pos3', e.target.value || null)} value="" className="text-sm border border-dashed border-slate-300 rounded px-2 py-1 w-full text-slate-400">
                <option value="">+ přiřadit</option>
                {pos3Options.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            )}
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Ostatní pozice</div>
            <div className="flex flex-wrap gap-1 mb-1">
              {shift.assigned.general.map(id => (
                <PersonChip key={id} name={getEmpNameFrom(employees, id)} warning={warn(id)} onRemove={() => onRemoveGeneral(week.id, shift.id, id)} />
              ))}
            </div>
            {shift.assigned.general.length < neededGeneral && (
              <select onChange={e => { if (e.target.value) onAddGeneral(week.id, shift.id, e.target.value); }} value="" className="text-sm border border-dashed border-slate-300 rounded px-2 py-1 w-full text-slate-400">
                <option value="">+ přiřadit</option>
                {generalOptions.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            )}
          </div>
        </div>
      )}

      {total > 0 && (
        <div className="mt-2 pt-2 border-t border-dashed border-slate-200 flex flex-wrap items-center gap-1">
          <span className="text-xs uppercase tracking-wide text-slate-400 mr-1">Navíc (např. na zaučení):</span>
          {shift.extra.map(id => <PersonChip key={id} name={getEmpNameFrom(employees, id)} warning={warn(id)} onRemove={() => onRemoveExtra(week.id, shift.id, id)} />)}
          <select onChange={e => { if (e.target.value) onAddExtra(week.id, shift.id, e.target.value); }} value="" className="text-xs border border-dashed border-slate-300 rounded px-1.5 py-1 text-slate-400">
            <option value="">+ přidat navíc</option>
            {anyOptions.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

function shiftPeopleDetailed(shift, employees) {
  const list = [];
  if (shift.assigned.pos1) list.push({ name: getEmpNameFrom(employees, shift.assigned.pos1), tag: 'Hrncová' });
  if (shift.assigned.pos3) list.push({ name: getEmpNameFrom(employees, shift.assigned.pos3), tag: 'Poz. 3' });
  shift.assigned.general.forEach(id => list.push({ name: getEmpNameFrom(employees, id), tag: null }));
  shift.extra.forEach(id => list.push({ name: getEmpNameFrom(employees, id), tag: 'navíc' }));
  return list;
}

function PrintPreviewModal({ week, employees, onClose }) {
  const [viewMode, setViewMode] = useState('cards');

  const shiftTypeMeta = {
    day: { icon: Sun, label: 'Denní', time: '6:00–18:00', bar: 'bg-amber-400', bg: 'bg-amber-50' },
    night: { icon: Moon, label: 'Noční', time: '18:00–6:00', bar: 'bg-indigo-500', bg: 'bg-indigo-50' },
    sanitation: { icon: Droplets, label: 'Sanitace', time: '6:00–18:00', bar: 'bg-teal-500', bg: 'bg-teal-50' },
  };
  const order = { day: 0, night: 1, sanitation: 2 };
  const dateMap = new Map();
  week.shifts.forEach(s => {
    if (!dateMap.has(s.date)) dateMap.set(s.date, []);
    dateMap.get(s.date).push(s);
  });
  const dayGroups = [...dateMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, shifts]) => ({ date, shifts: [...shifts].sort((a, b) => order[a.type] - order[b.type]) }));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center overflow-auto p-4 z-50 print:p-0 print:bg-white">
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          body * { visibility: hidden; }
          #print-sheet, #print-sheet * { visibility: visible; }
          #print-sheet { position: fixed; inset: 0; width: 297mm; height: 210mm; margin: 0; box-shadow: none !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print sticky top-2 flex gap-2 mb-2 z-10 flex-wrap">
        <div className="flex rounded border border-slate-300 overflow-hidden shadow bg-white">
          <button onClick={() => setViewMode('cards')} className={`px-3 py-2 text-sm font-medium ${viewMode === 'cards' ? 'bg-slate-900 text-white' : 'hover:bg-slate-100'}`}>Karty podle dnů</button>
          <button onClick={() => setViewMode('matrix')} className={`px-3 py-2 text-sm font-medium ${viewMode === 'matrix' ? 'bg-slate-900 text-white' : 'hover:bg-slate-100'}`}>Matice podle jmen</button>
        </div>
        <button onClick={() => window.print()} className="px-3 py-2 text-sm rounded bg-slate-900 text-white hover:bg-slate-800 flex items-center gap-1 shadow">
          <Printer className="w-4 h-4" />Tisknout / Uložit jako PDF
        </button>
        <button onClick={onClose} className="px-3 py-2 text-sm rounded bg-white border border-slate-300 hover:bg-slate-100 shadow flex items-center gap-1">
          <X className="w-4 h-4" />Zavřít
        </button>
      </div>

      <div id="print-sheet" className="bg-white shadow-2xl" style={{ width: '297mm', minHeight: '210mm', padding: '10mm', boxSizing: 'border-box' }}>
        <div className="flex items-start justify-between border-b-4 border-slate-900 pb-3 mb-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Rozpis směn — výroba</h1>
            <p className="text-sm text-slate-500 mt-0.5">Týden od {formatSk(week.startDate)}</p>
          </div>
          <div className="text-right text-xs text-slate-400 pt-1">Vygenerováno {formatSk(toISO(new Date()))}</div>
        </div>

        {viewMode === 'cards' ? (
          <>
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${dayGroups.length}, 1fr)` }}>
              {dayGroups.map(day => (
                <div key={day.date} className="border border-slate-300 rounded-lg overflow-hidden flex flex-col">
                  <div className="bg-slate-900 text-white text-center py-2">
                    <div className="font-semibold text-sm">{dayLong(day.date)}</div>
                    <div className="text-[11px] opacity-70">{formatSk(day.date)}</div>
                  </div>
                  <div className="flex-1 flex flex-col">
                    {day.shifts.map(s => {
                      const meta = shiftTypeMeta[s.type];
                      const Icon = meta.icon;
                      const prodLabel = s.type === 'sanitation' ? 'Sanitace linky' : (s.product ? PRODUCTS[s.product].label : '—');
                      const people = shiftPeopleDetailed(s, employees);
                      return (
                        <div key={s.id} className={`p-2 border-t border-slate-200 ${meta.bg} flex-1`}>
                          <div className="flex items-center gap-1 text-xs font-bold text-slate-800 mb-0.5">
                            <span className={`w-2 h-2 rounded-full ${meta.bar} inline-block`} />
                            <Icon className="w-3 h-3" /> {meta.label}
                            <span className="font-normal text-slate-400 ml-auto">{meta.time}</span>
                          </div>
                          <div className="text-[10px] text-slate-500 mb-1 italic">{prodLabel}</div>
                          <div className="space-y-0.5">
                            {people.length === 0 && <div className="text-[11px] text-slate-300">—</div>}
                            {people.map((p, i) => (
                              <div key={i} className="text-[11px] text-slate-700 leading-tight">
                                {p.name}{p.tag ? <span className="text-slate-400"> ({p.tag})</span> : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-200 flex gap-5 text-xs text-slate-500">
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-amber-400 rounded-sm inline-block" />Denní</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-indigo-500 rounded-sm inline-block" />Noční</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-teal-500 rounded-sm inline-block" />Sanitace</span>
            </div>
          </>
        ) : (
          <WeekMatrixTable week={week} employees={employees} />
        )}
      </div>
    </div>
  );
}


function LoginGate({ employees, onAdminLogin, onEmployeeLogin, onBack }) {
  const [mode, setMode] = useState(null);
  const [pin, setPin] = useState('');
  const [empId, setEmpId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submitAdmin() {
    setBusy(true);
    const ok = await onAdminLogin(pin);
    setBusy(false);
    if (!ok) { setError('Nesprávný PIN.'); setPin(''); }
  }
  async function submitEmployee() {
    if (!empId) { setError('Vyberte své jméno.'); return; }
    setBusy(true);
    const res = await onEmployeeLogin(empId, pin);
    setBusy(false);
    if (!res.success) { setError(res.message || 'Nesprávný PIN.'); setPin(''); }
  }

  if (!mode) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4" style={{ fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}>
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8 max-w-sm w-full text-center space-y-4">
          <div>
            <img src="/stenger-logo.png" alt="Stenger" className="h-14 w-auto mx-auto mb-3" />
            <div className="text-xs tracking-wider text-slate-400 mb-1">Stenger Czech s.r.o.</div>
            <h1 className="text-lg font-bold text-slate-900">Plán směn — výroba</h1>
          </div>
          <p className="text-sm text-slate-500">Kdo se přihlašuje?</p>
          <button onClick={() => setMode('admin')} className="w-full px-4 py-3 rounded-md bg-amber-600 text-white font-medium hover:bg-amber-700">Vedoucí výroby</button>
          <button onClick={() => setMode('employee')} className="w-full px-4 py-3 rounded-md border border-slate-200 text-slate-700 font-medium hover:bg-slate-50">Zaměstnanec</button>
          {onBack && <button onClick={onBack} className="text-xs text-slate-400 hover:text-slate-600 mt-2">&larr; Jiná aplikace</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4" style={{ fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}>
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8 max-w-sm w-full space-y-4">
        <button onClick={() => { setMode(null); setError(''); setPin(''); }} className="text-xs text-slate-400 hover:text-slate-600">&larr; Zpět</button>
        <img src="/stenger-logo.png" alt="Stenger" className="h-10 w-auto mx-auto" />
        {mode === 'admin' ? (
          <>
            <h2 className="font-semibold text-slate-900 text-center">Přihlášení vedoucího</h2>
            <input type="password" inputMode="numeric" placeholder="PIN" value={pin} onChange={e => setPin(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submitAdmin()}
              className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-amber-600" />
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <button onClick={submitAdmin} disabled={busy} className="w-full px-4 py-2 rounded-md bg-amber-600 text-white font-medium hover:bg-amber-700 disabled:opacity-60">{busy ? 'Ověřuji...' : 'Přihlásit se'}</button>
          </>
        ) : (
          <>
            <h2 className="font-semibold text-slate-900 text-center">Přihlášení zaměstnance</h2>
            <select value={empId} onChange={e => { setEmpId(e.target.value); setError(''); }} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
              <option value="">— vyberte své jméno —</option>
              {employees.filter(e => e.active).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <input type="password" inputMode="numeric" placeholder="PIN (min. 4 číslice)" value={pin} onChange={e => setPin(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submitEmployee()}
              className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-amber-600" />
            <p className="text-xs text-slate-400">Pokud se přihlašujete poprvé, zadaný PIN se vám nastaví natrvalo — zapamatujte si ho. Pokud jste ho zapomněli, požádejte vedoucího o reset.</p>
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <button onClick={submitEmployee} disabled={busy} className="w-full px-4 py-2 rounded-md bg-amber-600 text-white font-medium hover:bg-amber-700 disabled:opacity-60">{busy ? 'Ověřuji...' : 'Přihlásit se'}</button>
          </>
        )}
      </div>
    </div>
  );
}

function EmployeePortal({ employee, weeks, requests, onSubmitRequest, onLogout }) {
  const [form, setForm] = useState({ from: '', to: '', reason: '', nightOnFromOk: false, nightOnToOk: false });
  const today = toISO(new Date());
  const myShifts = [];
  [...weeks].sort((a, b) => a.startDate.localeCompare(b.startDate)).forEach(w => {
    w.shifts.forEach(s => {
      if (shiftPeopleIds(s).includes(employee.id) && s.date >= today) {
        const label = s.type === 'day' ? 'Denní (6:00–18:00)' : s.type === 'night' ? 'Noční (18:00–6:00)' : 'Sanitace (6:00–18:00)';
        myShifts.push({ id: s.id, date: s.date, label });
      }
    });
  });
  myShifts.sort((a, b) => a.date.localeCompare(b.date));

  function submit() {
    if (!form.from || !form.to) return;
    onSubmitRequest(employee.id, form.from, form.to, form.reason, form.nightOnFromOk, form.nightOnToOk);
    setForm({ from: '', to: '', reason: '', nightOnFromOk: false, nightOnToOk: false });
  }

  const myRequests = requests.filter(r => r.employeeId === employee.id).sort((a, b) => b.from.localeCompare(a.from));
  const statusLabel = { pending: 'Čeká na schválení', approved: 'Schváleno', rejected: 'Zamítnuto' };
  const statusColor = { pending: 'bg-amber-100 text-amber-700', approved: 'bg-emerald-100 text-emerald-700', rejected: 'bg-rose-100 text-rose-700' };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-900 text-white px-4 md:px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/stenger-logo.png" alt="Stenger" className="h-9 w-auto" />
          <div>
            <h1 className="text-lg font-bold">Ahoj, {employee.name}</h1>
            <p className="text-xs text-slate-400">Vaše směny a žádosti o volno</p>
          </div>
        </div>
        <button onClick={onLogout} className="flex items-center gap-1.5 px-3 h-9 rounded-md text-sm text-slate-300 hover:bg-slate-800"><LogOut size={16} /> Odhlásit se</button>
      </header>
      <main className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h3 className="font-semibold mb-3">Moje nejbližší směny</h3>
          {myShifts.length === 0 && <p className="text-sm text-slate-400">Zatím nemáte naplánované žádné nadcházející směny.</p>}
          <div className="space-y-1.5">
            {myShifts.slice(0, 20).map(s => (
              <div key={s.id} className="flex justify-between text-sm border-b border-slate-100 pb-1.5 last:border-0">
                <span className="text-slate-600">{dayLong(s.date)} {formatSk(s.date)}</span>
                <span className="font-medium text-slate-800">{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h3 className="font-semibold mb-3">Nahlásit nepřítomnost (dovolená, lékař, jiné)</h3>
          <div className="grid sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Od</label>
              <input type="date" value={form.from} onChange={e => setForm(f => ({ ...f, from: e.target.value }))} className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Do</label>
              <input type="date" value={form.to} onChange={e => setForm(f => ({ ...f, to: e.target.value }))} className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
            </div>
          </div>
          <label className="block text-xs text-slate-500 mb-1">Poznámka</label>
          <input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="např. dovolená / lékař" className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm mb-3" />
          <div className="space-y-1.5 mb-3">
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={form.nightOnFromOk} onChange={e => setForm(f => ({ ...f, nightOnFromOk: e.target.checked }))} />
              Noční směnu z předchozího dne (přechází do {form.from ? formatSk(form.from) : 'prvního dne'}) ještě zvládnu
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={form.nightOnToOk} onChange={e => setForm(f => ({ ...f, nightOnToOk: e.target.checked }))} />
              Noční směnu v poslední den ({form.to ? formatSk(form.to) : 'poslední den'}) ještě zvládnu
            </label>
          </div>
          <button onClick={submit} className="px-4 py-2 rounded-md bg-amber-600 text-white text-sm font-medium hover:bg-amber-700">Odeslat žádost nadřízenému</button>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h3 className="font-semibold mb-3">Moje žádosti</h3>
          {myRequests.length === 0 && <p className="text-sm text-slate-400">Zatím jste nepodali žádnou žádost.</p>}
          <div className="space-y-2">
            {myRequests.map(r => (
              <div key={r.id} className="flex items-center justify-between text-sm border-b border-slate-100 pb-2 last:border-0">
                <div>
                  <div className="text-slate-700">
                    {formatSk(r.from)} – {formatSk(r.to)}
                    {(r.nightOnFromOk || r.nightOnToOk) && <span className="ml-1.5 text-indigo-600 text-xs">(noční OK)</span>}
                  </div>
                  {r.reason && <div className="text-xs text-slate-400">{r.reason}</div>}
                </div>
                <span className={`text-xs font-medium px-2 py-1 rounded ${statusColor[r.status]}`}>{statusLabel[r.status]}</span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}


function WeekCalendarPicker({ weeks, activeWeekId, onSelectDate }) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => {
    const d = activeWeekId ? parseISO(activeWeekId) : new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const weekIds = new Set(weeks.map(w => w.id));
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7; // 0 = pondelok
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const cells = [];
  for (let i = 0; i < totalCells; i++) cells.push(new Date(year, month, i - startOffset + 1));
  const monthLabel = viewMonth.toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' });
  const todayIso = toISO(new Date());

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} title="Kalendář" className={'p-2 rounded border ' + (open ? 'bg-amber-50 border-amber-300 text-amber-700' : 'border-slate-300 hover:bg-slate-100')}>
        <CalendarDays className="w-4 h-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-2 bg-white border border-slate-200 rounded-lg shadow-lg p-3 z-50 w-72">
            <div className="flex items-center justify-between mb-2">
              <button type="button" onClick={() => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))} className="p-1 rounded hover:bg-slate-100"><ChevronLeft className="w-4 h-4" /></button>
              <span className="text-sm font-semibold text-slate-800 capitalize">{monthLabel}</span>
              <button type="button" onClick={() => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))} className="p-1 rounded hover:bg-slate-100"><ChevronRight className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center text-[11px]">
              {['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'].map(d => <div key={d} className="text-slate-400 font-medium py-1">{d}</div>)}
              {cells.map((date) => {
                const iso = toISO(date);
                const mondayIso = mondayOf(iso);
                const inMonth = date.getMonth() === month;
                const isActiveWeek = mondayIso === activeWeekId;
                const hasWeek = weekIds.has(mondayIso);
                const isToday = iso === todayIso;
                return (
                  <button
                    type="button"
                    key={iso}
                    onClick={() => { onSelectDate(mondayIso); setOpen(false); }}
                    title={'Týden od ' + formatSk(mondayIso)}
                    className={
                      'py-1.5 rounded-md relative ' +
                      (isActiveWeek ? 'bg-amber-600 text-white font-semibold' : inMonth ? 'text-slate-700 hover:bg-amber-50' : 'text-slate-300 hover:bg-slate-50') +
                      (isToday && !isActiveWeek ? ' ring-1 ring-amber-400' : '')
                    }
                  >
                    {date.getDate()}
                    {hasWeek && <span className={'absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ' + (isActiveWeek ? 'bg-white' : 'bg-amber-500')} />}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-400 mt-2">Tečka = již existující naplánovaný týden. Kliknutím na kterýkoli den přejdete na jeho týden (pokud neexistuje, vytvoří se).</p>
          </div>
        </>
      )}
    </div>
  );
}

function WeekMatrixTable({ week, employees }) {
  const activeEmployees = employees.filter((e) => e.active);
  const order = { day: 0, night: 1, sanitation: 2 };
  const shiftsSorted = [...week.shifts].sort((a, b) => (a.date === b.date ? order[a.type] - order[b.type] : a.date.localeCompare(b.date)));
  const dateFirstIndex = {};
  const dateCount = {};
  shiftsSorted.forEach((s, i) => {
    dateCount[s.date] = (dateCount[s.date] || 0) + 1;
    if (dateFirstIndex[s.date] === undefined) dateFirstIndex[s.date] = i;
  });
  function roleOf(shift, empId) {
    if (shift.assigned.pos1 === empId) return 'pos1';
    if (shift.assigned.pos3 === empId) return 'pos3';
    if (shift.assigned.general.includes(empId) || shift.extra.includes(empId)) return 'gen';
    return null;
  }
  const shiftTypeIcon = { day: Sun, night: Moon, sanitation: Droplets };
  const dotClass = { pos1: 'bg-amber-600', pos3: 'bg-purple-600', gen: 'bg-teal-600' };
  const colWidth = Math.max(24, Math.floor((297 - 20 - 60) / Math.max(1, activeEmployees.length)));

  if (activeEmployees.length === 0) {
    return <div className="text-sm text-slate-400 text-center py-10">Zatím žádný aktivní zaměstnanec.</div>;
  }

  return (
    <>
      <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '34px' }} />
          <col style={{ width: '26px' }} />
          {activeEmployees.map((e) => <col key={e.id} style={{ width: `${colWidth}px` }} />)}
        </colgroup>
        <thead>
          <tr>
            <td colSpan={2}></td>
            {activeEmployees.map((e) => (
              <td key={e.id} style={{ height: '125px', position: 'relative' }}>
                <div style={{ transform: 'rotate(-55deg)', transformOrigin: 'left bottom', whiteSpace: 'nowrap', position: 'absolute', bottom: '4px', left: '24px' }}>
                  <span className="bg-amber-100 text-amber-900 px-2 py-0.5 font-medium text-[11px]">{e.name}</span>
                </div>
              </td>
            ))}
          </tr>
        </thead>
        <tbody>
          {shiftsSorted.map((s, i) => {
            const Icon = shiftTypeIcon[s.type];
            const nightBg = s.type === 'night' ? 'bg-slate-50' : '';
            const isFirstOfDate = dateFirstIndex[s.date] === i;
            const rowSpan = dateCount[s.date];
            return (
              <tr key={s.id}>
                {isFirstOfDate && (
                  <td rowSpan={rowSpan} className="bg-amber-100 text-amber-900 text-center font-medium border border-slate-200 text-xs">
                    {dayShort(s.date).toUpperCase()}
                  </td>
                )}
                <td className={`text-center border border-slate-200 ${nightBg}`}>
                  <Icon className="w-3.5 h-3.5 text-slate-400 inline-block" />
                </td>
                {activeEmployees.map((e) => {
                  const role = roleOf(s, e.id);
                  return (
                    <td key={e.id} className={`text-center border border-slate-200 ${nightBg}`}>
                      {role && (
                        role === 'gen' ? (
                          <span className={`inline-block w-3 h-3 rounded-full ${dotClass.gen}`} title="Ostatní" />
                        ) : (
                          <span
                            className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-[10px] font-bold leading-none ${dotClass[role]}`}
                            title={role === 'pos1' ? 'Hrncová' : 'Pozice 3'}
                          >
                            {role === 'pos1' ? 'H' : '3'}
                          </span>
                        )
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-3 pt-2 border-t border-slate-200 flex gap-5 text-xs text-slate-500 flex-wrap">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-600 inline-block" />Hrncová</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-purple-600 inline-block" />Pozice 3</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-teal-600 inline-block" />Ostatní</span>
        <span className="flex items-center gap-1"><Sun className="w-3.5 h-3.5" />Denní</span>
        <span className="flex items-center gap-1"><Moon className="w-3.5 h-3.5" />Noční</span>
        <span className="flex items-center gap-1"><Droplets className="w-3.5 h-3.5" />Sanitace</span>
      </div>
    </>
  );
}

function WeekMatrixSheet({ week }) {
  return (
    <div className="flex items-start justify-between border-b-4 border-slate-900 pb-3 mb-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Rozpis směn — výroba</h1>
        <p className="text-sm text-slate-500 mt-0.5">Týden od {formatSk(week.startDate)}</p>
      </div>
      <div className="text-right text-xs text-slate-400 pt-1">Vygenerováno {formatSk(toISO(new Date()))}</div>
    </div>
  );
}

function PrehladTab({ weeks, employees, onGotoWeek }) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(toISO(new Date())));
  const week = weeks.find((w) => w.id === weekStart) || null;
  const isCurrentWeek = weekStart === mondayOf(toISO(new Date()));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="p-2 rounded border border-slate-300 hover:bg-slate-100"><ChevronLeft className="w-4 h-4" /></button>
        <span className="text-sm font-semibold text-slate-700">Týden od {formatSk(weekStart)}</span>
        <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="p-2 rounded border border-slate-300 hover:bg-slate-100"><ChevronRight className="w-4 h-4" /></button>
        {!isCurrentWeek && (
          <button onClick={() => setWeekStart(mondayOf(toISO(new Date())))} className="text-xs px-2.5 py-1.5 rounded-md border border-slate-300 hover:bg-slate-100 text-slate-600">Aktuální týden</button>
        )}
      </div>

      {!week ? (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-slate-500">
          Pro tento týden zatím není vytvořen plán.
          <div className="mt-3"><button onClick={() => onGotoWeek(weekStart)} className="px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700">Vytvořit tento týden</button></div>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-x-auto p-4">
          <div style={{ minWidth: '900px' }}>
            <WeekMatrixSheet week={week} />
            <WeekMatrixTable week={week} employees={employees} />
          </div>
        </div>
      )}
    </div>
  );
}

function PlannerTab({ weeks, activeWeek, employees, absences, setActiveWeekId, onNav, onCreateWeek, onGotoWeek, onToggleSunday, onAutoFill, onClearRefill, onClearOnly, onSetProduct, onSetPos, onAddGeneral, onRemoveGeneral, onAddExtra, onRemoveExtra, onClearShift, onExport, onShowPreview }) {
  const [planTwoWeeks, setPlanTwoWeeks] = useState(false);

  if (!activeWeek) {
    return (
      <div className="text-center py-10 text-slate-500">
        Zatím žádný týden.
        <div className="mt-3"><button onClick={onCreateWeek} className="px-3 py-2 text-sm rounded-md bg-amber-600 text-white hover:bg-amber-700">Vytvořit první týden</button></div>
      </div>
    );
  }
  const sortedWeeks = [...weeks].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const secondWeekStart = addDays(activeWeek.startDate, 7);
  const secondWeek = weeks.find(w => w.id === secondWeekStart) || null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => onNav(-1)} className="p-2 rounded border border-slate-300 hover:bg-slate-100"><ChevronLeft className="w-4 h-4" /></button>
        <select value={activeWeek.id} onChange={e => setActiveWeekId(e.target.value)} className="border border-slate-300 rounded px-2 py-2 text-sm font-medium">
          {sortedWeeks.map(w => <option key={w.id} value={w.id}>Týden od {formatSk(w.startDate)}</option>)}
        </select>
        <button onClick={() => onNav(1)} className="p-2 rounded border border-slate-300 hover:bg-slate-100"><ChevronRight className="w-4 h-4" /></button>
        <WeekCalendarPicker weeks={weeks} activeWeekId={activeWeek.id} onSelectDate={onGotoWeek} />
        <button onClick={onCreateWeek} className="px-3 py-2 text-sm rounded border border-slate-300 hover:bg-slate-100 flex items-center gap-1"><Plus className="w-4 h-4" />Nový týden</button>

        <label className="ml-2 flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={activeWeek.extraSundayNight} onChange={onToggleSunday} />
          Mimořádný start: noční už v neděli 18:00
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-600" title="Výjimečně, např. párkrát do roka - zobrazí i následující týden pod tímto najednou">
          <input type="checkbox" checked={planTwoWeeks} onChange={e => setPlanTwoWeeks(e.target.checked)} />
          Plánovat i následující týden najednou
        </label>

        <div className="ml-auto flex gap-2">
          <button onClick={() => onAutoFill(activeWeek.id)} className="px-3 py-2 text-sm rounded-md bg-amber-600 text-white hover:bg-amber-700">Doplnit prázdná místa</button>
          <button onClick={onShowPreview} className="px-3 py-2 text-sm rounded border border-slate-300 hover:bg-slate-100 flex items-center gap-1"><Printer className="w-4 h-4" />Ukázat/exportovat náhled</button>
          <button onClick={() => onClearOnly(activeWeek.id)} className="px-3 py-2 text-sm rounded border border-red-200 text-red-700 hover:bg-red-50">Vyčistit</button>
          <button onClick={() => onClearRefill(activeWeek.id)} className="px-3 py-2 text-sm rounded border border-slate-300 hover:bg-slate-100">Vyčistit a přeplánovat</button>
          <button onClick={onExport} className="px-3 py-2 text-sm rounded border border-slate-300 hover:bg-slate-100 flex items-center gap-1"><Copy className="w-4 h-4" />Export (text)</button>
        </div>
      </div>

      <TimelineStrip week={activeWeek} />
      <p className="text-xs text-slate-400 -mt-2">Předpoklad rozdělení počtu lidí: 1× hrncová + 1× pozice 3 + zbytek ostatní pozice, podle zvoleného produktu. Pokud to má být jinak, dej vědět.</p>

      <div className="space-y-2">
        {activeWeek.shifts.map(s => (
          <ShiftRow key={s.id} week={activeWeek} shift={s} employees={employees} absences={absences}
            onSetProduct={onSetProduct} onSetPos={onSetPos} onAddGeneral={onAddGeneral} onRemoveGeneral={onRemoveGeneral}
            onAddExtra={onAddExtra} onRemoveExtra={onRemoveExtra} onClear={onClearShift} />
        ))}
      </div>

      {planTwoWeeks && (
        <div className="pt-4 mt-2 border-t-2 border-dashed border-amber-200">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <h3 className="text-sm font-semibold text-slate-700">Následující týden — od {formatSk(secondWeekStart)}</h3>
            {secondWeek ? (
              <div className="ml-auto flex gap-2">
                <button onClick={() => onAutoFill(secondWeek.id)} className="px-3 py-1.5 text-xs rounded-md bg-amber-600 text-white hover:bg-amber-700">Doplnit prázdná místa</button>
                <button onClick={() => onClearOnly(secondWeek.id)} className="px-3 py-1.5 text-xs rounded border border-red-200 text-red-700 hover:bg-red-50">Vyčistit</button>
                <button onClick={() => onClearRefill(secondWeek.id)} className="px-3 py-1.5 text-xs rounded border border-slate-300 hover:bg-slate-100">Vyčistit a přeplánovat</button>
              </div>
            ) : (
              <button onClick={() => onGotoWeek(secondWeekStart)} className="ml-auto px-3 py-1.5 text-xs rounded-md bg-amber-600 text-white hover:bg-amber-700 flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> Vytvořit tento týden
              </button>
            )}
          </div>
          {secondWeek && (
            <>
              <TimelineStrip week={secondWeek} />
              <div className="space-y-2 mt-3">
                {secondWeek.shifts.map(s => (
                  <ShiftRow key={s.id} week={secondWeek} shift={s} employees={employees} absences={absences}
                    onSetProduct={onSetProduct} onSetPos={onSetPos} onAddGeneral={onAddGeneral} onRemoveGeneral={onRemoveGeneral}
                    onAddExtra={onAddExtra} onRemoveExtra={onRemoveExtra} onClear={onClearShift} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function EmployeesTab({ employees, onToggleActive, onUpdateMax, onUpdateRoles, onChangeAdminPin, onResetPin }) {
  const [pinMsg, setPinMsg] = useState('');
  async function handleResetPin(id) {
    const adminPin = window.prompt('Pro reset PINu zaměstnance zadejte svůj admin PIN:');
    if (adminPin === null) return;
    const res = await onResetPin(id, adminPin);
    setPinMsg(res.success ? 'PIN byl zresetován.' : res.message);
  }
  const ROLE_OPTIONS = [
    { key: 'pos1', label: 'Hrncová' },
    { key: 'pos1-backup', label: 'Hrncová – záskok' },
    { key: 'pos3', label: 'Pozice 3' },
    { key: 'general', label: 'Ostatní pozice' },
  ];
  function toggleRole(emp, k) {
    const roles = (emp.roles || []).includes(k) ? emp.roles.filter(r => r !== k) : [...(emp.roles || []), k];
    if (roles.length === 0) return;
    onUpdateRoles(emp.id, roles);
  }
  const [adminPinInput, setAdminPinInput] = useState('');
  const [currentAdminPinInput, setCurrentAdminPinInput] = useState('');
  return (
    <div className="space-y-6">
      <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2 rounded-md">
        Seznam jmen (kdo všechno existuje) se přebírá z ERP → Pracovníci (typ „Výroba“) — přidávání, přejmenování i mazání dělejte tam, automaticky se projeví i ve Výrobě, Přestávkách i tu. Tady nastavíte jen jejich roli, maximální počet směn za týden a PIN.
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr><th className="text-left px-3 py-2">Jméno</th><th className="text-left px-3 py-2">Pozice</th><th className="text-left px-3 py-2">Max/týden</th><th className="text-left px-3 py-2">Stav</th><th></th></tr>
          </thead>
          <tbody>
            {employees.map(e => (
              <tr key={e.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium whitespace-nowrap">{e.name}</td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  <div className="flex flex-col gap-1">
                    {ROLE_OPTIONS.map(r => (
                      <label key={r.key} className="flex items-center gap-1.5 text-xs text-slate-600 whitespace-nowrap">
                        <input type="checkbox" checked={(e.roles || []).includes(r.key)} onChange={() => toggleRole(e, r.key)} /> {r.label}
                      </label>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2"><input type="number" min="1" max="10" value={e.weeklyMax} onChange={ev => onUpdateMax(e.id, ev.target.value)} className="w-16 border border-slate-300 rounded px-1.5 py-1" /></td>
                <td className="px-3 py-2">
                  <button onClick={() => onToggleActive(e.id)} className={`px-2 py-1 rounded text-xs font-medium ${e.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                    {e.active ? 'Aktivní' : 'Neaktivní'}
                  </button>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button onClick={() => handleResetPin(e.id)} title="Resetovat PIN (zapomenutý) — nastaví si nový při dalším přihlášení" className="p-1 rounded text-slate-400 hover:text-amber-600">
                    <KeyRound className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
            {employees.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">Zatím žádný zaměstnanec. Přidejte ho v ERP → Pracovníci (typ „Výroba“).</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="font-semibold mb-2">PIN pro přihlášení vedoucího</h3>
        <div className="flex gap-2 items-end flex-wrap">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Současný PIN</label>
            <input value={currentAdminPinInput} onChange={e => setCurrentAdminPinInput(e.target.value)} type="password" className="border border-slate-300 rounded px-2 py-1.5 text-sm w-32" placeholder="ověření" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Nový PIN (min. 4 znaky)</label>
            <input value={adminPinInput} onChange={e => setAdminPinInput(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm w-32" placeholder="např. 4521" />
          </div>
          <button
            onClick={async () => {
              const res = await onChangeAdminPin(currentAdminPinInput, adminPinInput);
              setPinMsg(res.success ? 'PIN byl změněn.' : res.message);
              if (res.success) { setAdminPinInput(''); setCurrentAdminPinInput(''); }
            }}
            className="px-3 py-1.5 text-sm rounded-md bg-amber-600 text-white hover:bg-amber-700"
          >
            Uložit
          </button>
        </div>
        {pinMsg && <p className="text-xs text-slate-600 mt-2">{pinMsg}</p>}
        <p className="text-xs text-slate-400 mt-1">Pro změnu PINu je potřeba zadat ten současný. Pokud ho zapomenete, kontaktujte administrátora databáze.</p>
      </div>
    </div>
  );
}

function AbsencesTab({ employees, absences, absForm, setAbsForm, onAdd, onRemove, requests, onApprove, onReject }) {
  const pending = requests.filter(r => r.status === 'pending').sort((a, b) => a.from.localeCompare(b.from));
  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="font-semibold mb-3">Žádosti od zaměstnankyň ke schválení</h3>
        {pending.length === 0 && <p className="text-sm text-slate-400">Žádné čekající žádosti.</p>}
        <div className="space-y-2">
          {pending.map(r => (
            <div key={r.id} className="flex items-center justify-between text-sm border-b border-slate-100 pb-2 last:border-0">
              <div>
                <div className="font-medium text-slate-700">{getEmpNameFrom(employees, r.employeeId)}</div>
                <div className="text-xs text-slate-500">
                  {formatSk(r.from)} – {formatSk(r.to)}{r.reason ? ` · ${r.reason}` : ''}
                  {r.nightOnFromOk && <span className="ml-1.5 text-indigo-600">(noční {formatSk(r.from)} OK)</span>}
                  {r.nightOnToOk && <span className="ml-1.5 text-indigo-600">(noční {formatSk(r.to)} OK)</span>}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => onApprove(r.id)} className="px-2 py-1 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700">Schválit</button>
                <button onClick={() => onReject(r.id)} className="px-2 py-1 text-xs rounded bg-rose-100 text-rose-700 hover:bg-rose-200">Zamítnout</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="font-semibold mb-3">Nahlásit nepřítomnost ručně (dovolená, lékař, jiné)</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Zaměstnanec</label>
            <select value={absForm.employeeId} onChange={e => setAbsForm(f => ({ ...f, employeeId: e.target.value }))} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
              <option value="">— vybrat —</option>
              {employees.filter(e => e.active).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Od</label>
            <input type="date" value={absForm.from} onChange={e => setAbsForm(f => ({ ...f, from: e.target.value }))} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Do</label>
            <input type="date" value={absForm.to} onChange={e => setAbsForm(f => ({ ...f, to: e.target.value }))} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Poznámka</label>
            <input value={absForm.reason} onChange={e => setAbsForm(f => ({ ...f, reason: e.target.value }))} placeholder="dovolená / lékař / ..." className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
          </div>
          <button onClick={onAdd} className="px-3 py-1.5 text-sm rounded-md bg-amber-600 text-white hover:bg-amber-700">Přidat</button>
        </div>
        <div className="mt-2 space-y-1.5">
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={absForm.nightOnFromOk} onChange={e => setAbsForm(f => ({ ...f, nightOnFromOk: e.target.checked }))} />
            Noční směnu z předchozího dne ještě zvládne
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={absForm.nightOnToOk} onChange={e => setAbsForm(f => ({ ...f, nightOnToOk: e.target.checked }))} />
            Noční směnu v poslední den ještě zvládne
          </label>
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr><th className="text-left px-3 py-2">Zaměstnanec</th><th className="text-left px-3 py-2">Od</th><th className="text-left px-3 py-2">Do</th><th className="text-left px-3 py-2">Poznámka</th><th></th></tr>
          </thead>
          <tbody>
            {absences.slice().sort((a, b) => a.from.localeCompare(b.from)).map(a => (
              <tr key={a.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium">{getEmpNameFrom(employees, a.employeeId)}</td>
                <td className="px-3 py-2">{formatSk(a.from)}{a.nightOnFromOk && <span className="ml-1 text-indigo-600 text-xs">(noční OK)</span>}</td>
                <td className="px-3 py-2">{formatSk(a.to)}{a.nightOnToOk && <span className="ml-1 text-indigo-600 text-xs">(noční OK)</span>}</td>
                <td className="px-3 py-2 text-slate-500">{a.reason}</td>
                <td className="px-3 py-2 text-right"><button onClick={() => onRemove(a.id)} className="text-slate-400 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button></td>
              </tr>
            ))}
            {absences.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">Žádné nahlášené nepřítomnosti.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ImportTab({ employees, onImport }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);

  const example = `# jeden řádek = jedna směna
# formát: DATUM;TYP;PRODUKT;HRNCOVA;POZICE3;OSTATNI,OSTATNI,...
# TYP: den / noc / sanitacia   PRODUKT: sacky / kybliky / bulk (volitelné)
2026-06-01;den;sacky;Jana Dragounová;Milena Jechová;Bohdana Matejková,Kvetoslava Buchová
2026-06-01;noc;sacky;Martina Vávrová;Petra Achačová;Lucie Fišerová,Lucie Melicharová
2026-06-05;sanitacia;;Mašková Lenka;Yvetta Cafourková;Monika Mandíková,Vendula Svobodová`;

  function runImport() {
    const r = parseImportText(text, employees);
    onImport(r.weeks);
    setResult(r);
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="font-semibold mb-2">Import starších týdnů (2-3 měsíce historie)</h3>
        <p className="text-sm text-slate-500 mb-3">
          Vložte údaje v jednoduchém textovém formátu níže — jeden řádek na jednu směnu. Jména se musí shodovat se jmény v záložce „Zaměstnanci“ (jinak se zobrazí jako nespárovaná). Importované týdny se započítají do historie i do rovnováhy směn.
        </p>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={example}
          className="w-full h-64 text-xs font-mono border border-slate-300 rounded p-2"
        />
        <button onClick={runImport} disabled={!text.trim()} className={`mt-3 px-4 py-2 text-sm rounded-md font-medium ${text.trim() ? 'bg-amber-600 text-white hover:bg-amber-700' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>
          Importovat
        </button>
      </div>

      {result && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-2 text-sm">
          <p className="text-emerald-700 font-medium">Naimportováno {result.weeks.length} týdnů ({result.lineCount} řádků zpracováno).</p>
          {result.errors.length > 0 && (
            <div>
              <p className="text-rose-600 font-medium mb-1">Chyby v {result.errors.length} řádcích:</p>
              <ul className="list-disc list-inside text-rose-600 text-xs space-y-0.5">
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
          {result.unmatched.length > 0 && (
            <div>
              <p className="text-amber-600 font-medium mb-1">Nespárovaná jména (nebyla přiřazena, zkontrolujte pravopis nebo přidejte zaměstnance v ERP → Pracovníci):</p>
              <p className="text-amber-600 text-xs">{result.unmatched.join(', ')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryTab({ weeks, onOpen }) {
  const sorted = [...weeks].sort((a, b) => b.startDate.localeCompare(a.startDate));
  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
          <tr><th className="text-left px-3 py-2">Týden od</th><th className="text-left px-3 py-2">Směny</th><th className="text-left px-3 py-2">Obsazenost</th><th></th></tr>
        </thead>
        <tbody>
          {sorted.map(w => {
            const totalNeeded = w.shifts.reduce((s, sh) => s + shiftTotal(sh), 0);
            const totalFilled = w.shifts.reduce((s, sh) => s + shiftPeopleIds(sh).length, 0);
            return (
              <tr key={w.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium">{formatSk(w.startDate)}</td>
                <td className="px-3 py-2 text-slate-500">{w.shifts.length} směn{w.extraSundayNight ? ' (+ nedělní)' : ''}</td>
                <td className="px-3 py-2">
                  <span className={`text-xs font-mono px-2 py-1 rounded ${totalFilled >= totalNeeded && totalNeeded > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{totalFilled}/{totalNeeded}</span>
                </td>
                <td className="px-3 py-2 text-right"><button onClick={() => onOpen(w.id)} className="text-sm text-slate-600 hover:text-slate-900 underline">Otevřít</button></td>
              </tr>
            );
          })}
          {sorted.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">Zatím žádné týdny.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function BalanceTab({ employees, weeks }) {
  const rows = employees.filter(e => e.active).map(e => ({ e, stats: globalStats(weeks, e.id) }));
  const maxTotal = Math.max(1, ...rows.map(r => r.stats.total));
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
      <h3 className="font-semibold mb-1">Rovnováha směn (od začátku plánování v této appce)</h3>
      {rows.map(({ e, stats }) => (
        <div key={e.id} className="flex items-center gap-3 flex-wrap">
          <div className="w-40 text-sm font-medium truncate">{e.name}</div>
          <div className="flex-1 min-w-[120px] h-4 bg-slate-100 rounded overflow-hidden flex">
            <div className="bg-amber-400 h-full" style={{ width: `${(stats.day / maxTotal) * 100}%` }} title={`Denní: ${stats.day}`} />
            <div className="bg-indigo-500 h-full" style={{ width: `${(stats.night / maxTotal) * 100}%` }} title={`Noční: ${stats.night}`} />
            <div className="bg-teal-500 h-full" style={{ width: `${(stats.sanitation / maxTotal) * 100}%` }} title={`Sanitace: ${stats.sanitation}`} />
          </div>
          <div className="w-48 text-xs text-slate-500 font-mono">Σ{stats.total} · D{stats.day} N{stats.night} S{stats.sanitation}</div>
        </div>
      ))}
      <div className="flex gap-4 text-xs text-slate-500 pt-2 border-t border-slate-100">
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-amber-400 rounded-sm inline-block" />Denní</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-indigo-500 rounded-sm inline-block" />Noční</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-teal-500 rounded-sm inline-block" />Sanitace</span>
      </div>
    </div>
  );
}

function ExportModal({ text, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-lg max-w-lg w-full p-4 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Export rozpisu</h3>
          <button onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <textarea readOnly value={text} className="w-full h-72 text-xs font-mono border border-slate-200 rounded p-2" onFocus={e => e.target.select()} />
        <p className="text-xs text-slate-400">Text byl zkopírován do schránky (pokud to prohlížeč povolil). Případně ho označte v poli výše a zkopírujte ručně.</p>
      </div>
    </div>
  );
}

/* =========================================================================
   HLAVNA APLIKACIA
   Perzistencia beziala povodne cez window.storage (Claude Artifacts API),
   ktore v tomto projekte neexistuje - nahradene jednym zdielanym riadkom
   v Supabase (tabulka plan_smien, id=1), aby vsetci na vsetkych zariadeniach
   videli ten isty rozpis naraz.
   ========================================================================= */
export default function PlanSmienView({ onBack }) {
  const [employees, setEmployees] = useState([]);
  const [absences, setAbsences] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loginRole, setLoginRole] = useState(null);
  const [loginEmployeeId, setLoginEmployeeId] = useState(null);
  const [weeks, setWeeks] = useState([]);
  const [activeWeekId, setActiveWeekId] = useState(null);
  const [tab, setTab] = useState('prehlad');
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [exportText, setExportText] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [absForm, setAbsForm] = useState({ employeeId: '', from: '', to: '', reason: '', nightOnFromOk: false, nightOnToOk: false });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let savedEmployees = [];
      try {
        const { data: row, error } = await supabase.from('plan_smien').select('data').eq('id', 1).single();
        const d = !error && row ? row.data : null;
        if (d && Object.keys(d).length > 0) {
          savedEmployees = d.employees || [];
          if (!cancelled) {
            setAbsences(d.absences || []);
            setRequests(d.requests || []);
            const ws = d.weeks && d.weeks.length ? d.weeks : [generateWeek(mondayOf(toISO(new Date())), false)];
            setWeeks(ws);
            setActiveWeekId(d.activeWeekId || ws[ws.length - 1].id);
          }
        } else if (!cancelled) {
          const w = generateWeek(mondayOf(toISO(new Date())), false);
          setWeeks([w]);
          setActiveWeekId(w.id);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          const w = generateWeek(mondayOf(toISO(new Date())), false);
          setWeeks([w]);
          setActiveWeekId(w.id);
        }
      }
      try {
        const { data: workerRows, error: workersError } = await supabase.from('workers').select('data');
        const officeWorkers = (!workersError ? (workerRows || []) : [])
          .map(r => r.data)
          .filter(w => w.typ === 'vyroba');
        if (!cancelled) setEmployees(syncEmployeesWithOffice(savedEmployees, officeWorkers));
      } catch (e) {
        console.error(e);
        if (!cancelled) setEmployees(savedEmployees);
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const saveReqIdRef = useRef(0);
  useEffect(() => {
    if (!loaded) return;
    const payload = { employees, absences, requests, weeks, activeWeekId };
    const reqId = ++saveReqIdRef.current;
    supabase.from('plan_smien').update({ data: payload, updated_at: new Date().toISOString() }).eq('id', 1).then(({ error }) => {
      if (reqId !== saveReqIdRef.current) return;
      setSaveError(!!error);
    });
  }, [employees, absences, requests, weeks, activeWeekId, loaded]);

  const activeWeek = weeks.find(w => w.id === activeWeekId) || null;

  function updateWeek(weekId, updater) {
    setWeeks(ws => ws.map(w => (w.id === weekId ? updater(cloneWeek(w)) : w)));
  }
  function updateShift(weekId, shiftId, updater) {
    updateWeek(weekId, w => { w.shifts = w.shifts.map(s => (s.id === shiftId ? updater(s) : s)); return w; });
  }

  function setProduct(weekId, shiftId, product) { updateShift(weekId, shiftId, s => { s.product = product; return s; }); }
  function setPos(weekId, shiftId, role, empId) { updateShift(weekId, shiftId, s => { s.assigned[role] = empId || null; return s; }); }
  function addGeneral(weekId, shiftId, empId) { updateShift(weekId, shiftId, s => { if (!s.assigned.general.includes(empId)) s.assigned.general.push(empId); return s; }); }
  function removeGeneral(weekId, shiftId, empId) { updateShift(weekId, shiftId, s => { s.assigned.general = s.assigned.general.filter(id => id !== empId); return s; }); }
  function addExtra(weekId, shiftId, empId) { updateShift(weekId, shiftId, s => { if (!s.extra.includes(empId)) s.extra.push(empId); return s; }); }
  function removeExtra(weekId, shiftId, empId) { updateShift(weekId, shiftId, s => { s.extra = s.extra.filter(id => id !== empId); return s; }); }
  function clearShiftAssignment(weekId, shiftId) { updateShift(weekId, shiftId, s => { clearShiftAssignments(s); return s; }); }

  function autoFillCurrentWeek(weekId) {
    const week = weeks.find(w => w.id === (weekId || (activeWeek && activeWeek.id)));
    if (!week) return;
    const filled = autoFillWeek(week, employees, absences, weeks);
    setWeeks(ws => ws.map(w => (w.id === filled.id ? filled : w)));
  }
  function clearAndRefillWeek(weekId) {
    const week = weeks.find(w => w.id === (weekId || (activeWeek && activeWeek.id)));
    if (!week) return;
    const cleared = cloneWeek(week);
    cleared.shifts.forEach(clearShiftAssignments);
    const filled = autoFillWeek(cleared, employees, absences, weeks.map(w => (w.id === cleared.id ? cleared : w)));
    setWeeks(ws => ws.map(w => (w.id === filled.id ? filled : w)));
  }
  function clearWeekOnly(weekId) {
    const week = weeks.find(w => w.id === (weekId || (activeWeek && activeWeek.id)));
    if (!week) return;
    if (!window.confirm('Opravdu vyčistit celý týden? Všechna přiřazení budou smazána.')) return;
    const cleared = cloneWeek(week);
    cleared.shifts.forEach(clearShiftAssignments);
    setWeeks(ws => ws.map(w => (w.id === cleared.id ? cleared : w)));
  }
  function toggleExtraSunday() {
    if (!activeWeek) return;
    updateWeek(activeWeek.id, w => {
      if (w.extraSundayNight) {
        w.shifts = w.shifts.filter(s => !(s.type === 'night' && s.date === addDays(w.startDate, -1)));
        w.extraSundayNight = false;
      } else {
        w.shifts = [makeShift(w.id, addDays(w.startDate, -1), 'night'), ...w.shifts];
        w.extraSundayNight = true;
      }
      return w;
    });
  }
  function createNewWeek() {
    const last = weeks.length ? weeks.reduce((a, b) => (a.startDate > b.startDate ? a : b)) : null;
    const startDate = last ? addDays(last.startDate, 7) : mondayOf(toISO(new Date()));
    const w = generateWeek(startDate, false);
    setWeeks(ws => [...ws, w]);
    setActiveWeekId(w.id);
  }
  function gotoAdjacentWeek(dir) {
    const sorted = [...weeks].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const idx = sorted.findIndex(w => w.id === activeWeekId);
    const newIdx = idx + dir;
    if (newIdx >= 0 && newIdx < sorted.length) setActiveWeekId(sorted[newIdx].id);
  }
  function gotoWeekContaining(mondayIso) {
    const existing = weeks.find(w => w.id === mondayIso);
    if (existing) {
      setActiveWeekId(mondayIso);
    } else {
      const w = generateWeek(mondayIso, false);
      setWeeks(ws => [...ws, w]);
      setActiveWeekId(w.id);
    }
  }

  function toggleActive(id) { setEmployees(es => es.map(e => (e.id === id ? { ...e, active: !e.active } : e))); }
  function updateWeeklyMax(id, val) { setEmployees(es => es.map(e => (e.id === id ? { ...e, weeklyMax: Number(val) || 1 } : e))); }
  function updateEmployeeRoles(id, roles) { if (roles.length === 0) return; setEmployees(es => es.map(e => (e.id === id ? { ...e, roles } : e))); }

  function addAbsence() {
    if (!absForm.employeeId || !absForm.from || !absForm.to) return;
    setAbsences(as => [...as, { id: 'a' + Date.now(), ...absForm }]);
    setAbsForm({ employeeId: '', from: '', to: '', reason: '', nightOnFromOk: false, nightOnToOk: false });
  }
  function removeAbsence(id) { setAbsences(as => as.filter(a => a.id !== id)); }
  function importHistoryWeeks(newWeeks) {
    if (!newWeeks.length) return;
    setWeeks(ws => {
      const map = new Map(ws.map(w => [w.id, w]));
      newWeeks.forEach(nw => map.set(nw.id, nw));
      return [...map.values()];
    });
  }

  async function attemptAdminLogin(pin) {
    const { data: ok, error } = await supabase.rpc('plan_smien_verify_admin_pin', { p_pin: pin });
    if (error) return false;
    if (ok) { setLoginRole('admin'); return true; }
    return false;
  }
  async function attemptEmployeeLogin(employeeId, pin) {
    const emp = employees.find(e => e.id === employeeId);
    if (!emp) return { success: false, message: 'Neznámý zaměstnanec.' };
    const { data: hasPin, error: hasErr } = await supabase.rpc('plan_smien_has_employee_pin', { p_employee_id: employeeId });
    if (hasErr) return { success: false, message: 'Chyba připojení, zkuste to znovu.' };
    if (!hasPin) {
      if (!pin || pin.length < 4) return { success: false, message: 'Zvolte si PIN, alespoň 4 znaky.' };
      const { data: set, error } = await supabase.rpc('plan_smien_set_employee_pin', { p_employee_id: employeeId, p_pin: pin });
      if (error || !set) return { success: false, message: 'Nepodařilo se uložit PIN, zkuste to znovu.' };
      setLoginRole('employee');
      setLoginEmployeeId(employeeId);
      return { success: true };
    }
    const { data: ok, error: verErr } = await supabase.rpc('plan_smien_verify_employee_pin', { p_employee_id: employeeId, p_pin: pin });
    if (verErr) return { success: false, message: 'Chyba připojení, zkuste to znovu.' };
    if (ok) { setLoginRole('employee'); setLoginEmployeeId(employeeId); return { success: true }; }
    return { success: false, message: 'Nesprávný PIN.' };
  }
  function logout() { setLoginRole(null); setLoginEmployeeId(null); }
  async function resetEmployeePin(id, adminPin) {
    if (!adminPin) return { success: false, message: 'Zadejte admin PIN.' };
    const { data: ok, error } = await supabase.rpc('plan_smien_reset_employee_pin', { p_admin_pin: adminPin, p_employee_id: id });
    if (error) return { success: false, message: 'Chyba připojení, zkuste to znovu.' };
    if (!ok) return { success: false, message: 'Nesprávný admin PIN.' };
    return { success: true };
  }
  async function changeAdminPin(currentPin, newPin) {
    if (!newPin || newPin.length < 4) return { success: false, message: 'Nový PIN musí mít alespoň 4 znaky.' };
    const { data: ok, error } = await supabase.rpc('plan_smien_set_admin_pin', { p_current_pin: currentPin, p_new_pin: newPin });
    if (error) return { success: false, message: 'Chyba připojení, zkuste to znovu.' };
    if (!ok) return { success: false, message: 'Nesprávný současný PIN.' };
    return { success: true };
  }
  function submitAbsenceRequest(employeeId, from, to, reason, nightOnFromOk, nightOnToOk) {
    setRequests(rs => [...rs, { id: 'r' + Date.now(), employeeId, from, to, reason, nightOnFromOk, nightOnToOk, status: 'pending' }]);
  }
  function approveRequest(id) {
    const req = requests.find(r => r.id === id);
    if (!req) return;
    setAbsences(as => [...as, { id: 'a' + Date.now(), employeeId: req.employeeId, from: req.from, to: req.to, reason: req.reason, nightOnFromOk: req.nightOnFromOk, nightOnToOk: req.nightOnToOk }]);
    setRequests(rs => rs.map(r => (r.id === id ? { ...r, status: 'approved' } : r)));
  }
  function rejectRequest(id) { setRequests(rs => rs.map(r => (r.id === id ? { ...r, status: 'rejected' } : r))); }

  function generateExportText(week) {
    if (!week) return '';
    const lines = [];
    lines.push(`ROZPIS SMĚN — týden od ${formatSk(week.startDate)}`);
    lines.push('');
    week.shifts.forEach(s => {
      const label = s.type === 'day' ? 'Denní (6:00–18:00)' : s.type === 'night' ? 'Noční (18:00–6:00)' : 'Sanitace (6:00–18:00)';
      const prodLabel = s.type === 'sanitation' ? 'Sanitace linky' : (s.product ? PRODUCTS[s.product].label : '— produkt nezvolen —');
      const names = [];
      if (s.assigned.pos1) names.push(`${getEmpNameFrom(employees, s.assigned.pos1)} (Hrncová)`);
      if (s.assigned.pos3) names.push(`${getEmpNameFrom(employees, s.assigned.pos3)} (Poz. 3)`);
      s.assigned.general.forEach(id => names.push(getEmpNameFrom(employees, id)));
      s.extra.forEach(id => names.push(`${getEmpNameFrom(employees, id)} (navíc)`));
      lines.push(`${dayLong(s.date)} ${formatSk(s.date)} — ${label} — ${prodLabel}`);
      lines.push(names.length ? names.map(n => `  • ${n}`).join('\n') : '  (nikdo přiřazen)');
      lines.push('');
    });
    lines.push('--- Podle zaměstnankyň ---');
    employees.filter(e => e.active).forEach(e => {
      const mine = [];
      week.shifts.forEach(s => {
        if (shiftPeopleIds(s).includes(e.id)) {
          const label = s.type === 'day' ? 'Denní' : s.type === 'night' ? 'Noční' : 'Sanitace';
          mine.push(`${dayShort(s.date)} ${label}`);
        }
      });
      if (mine.length) lines.push(`${e.name}: ${mine.join(', ')}`);
    });
    return lines.join('\n');
  }
  async function copyExport() {
    const text = generateExportText(activeWeek);
    setExportText(text);
    try { await navigator.clipboard.writeText(text); } catch (e) {}
  }

  if (!loaded) return <div className="p-8 text-center text-slate-500">Načítám…</div>;

  if (!loginRole) {
    return <LoginGate employees={employees} onAdminLogin={attemptAdminLogin} onEmployeeLogin={attemptEmployeeLogin} onBack={onBack} />;
  }

  if (loginRole === 'employee') {
    const emp = employees.find(e => e.id === loginEmployeeId);
    if (!emp) { logout(); return null; }
    return <EmployeePortal employee={emp} weeks={weeks} requests={requests} onSubmitRequest={submitAbsenceRequest} onLogout={logout} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans">
      <header className="bg-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-4 pt-4 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <img src="/stenger-logo.png" alt="Stenger" className="h-10 w-auto" />
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-400">Stenger Czech s.r.o.</div>
              <div className="text-lg font-semibold">Plán směn — výroba</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onBack && (
              <button onClick={onBack} title="Jiná aplikace" className="flex items-center gap-1.5 px-3 h-9 rounded-md text-sm text-slate-300 hover:bg-slate-800">
                <ArrowLeftRight size={16} /> Jiná aplikace
              </button>
            )}
            <button onClick={logout} title="Odhlásit" className="flex items-center gap-1.5 px-3 h-9 rounded-md text-sm text-slate-300 hover:bg-slate-800">
              <LogOut size={16} /> Odhlásit se
            </button>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-4 pb-4">
          <nav className="flex items-stretch gap-2 mt-3 bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-2 shadow-inner overflow-x-auto">
            {TABS.map(t => (
              <PlanNavButton key={t.key} icon={t.icon} label={t.label} color={t.color} active={tab === t.key} onClick={() => setTab(t.key)} />
            ))}
          </nav>
        </div>
      </header>
      {saveError && (
        <div className="bg-red-600 text-white text-sm text-center py-2 px-4">
          Poslední změna se nepodařilo uložit. Zkuste akci zopakovat; pokud to nepomůže, zkontrolujte připojení k internetu.
        </div>
      )}
      <main className="p-4 md:p-6 max-w-6xl mx-auto">
        {tab === 'prehlad' && (
          <PrehladTab weeks={weeks} employees={employees} onGotoWeek={gotoWeekContaining} />
        )}
        {tab === 'planner' && (
          <PlannerTab
            weeks={weeks} activeWeek={activeWeek} employees={employees} absences={absences}
            setActiveWeekId={setActiveWeekId} onNav={gotoAdjacentWeek} onCreateWeek={createNewWeek} onGotoWeek={gotoWeekContaining}
            onToggleSunday={toggleExtraSunday} onAutoFill={autoFillCurrentWeek} onClearRefill={clearAndRefillWeek} onClearOnly={clearWeekOnly}
            onSetProduct={setProduct} onSetPos={setPos} onAddGeneral={addGeneral} onRemoveGeneral={removeGeneral}
            onAddExtra={addExtra} onRemoveExtra={removeExtra} onClearShift={clearShiftAssignment} onExport={copyExport}
            onShowPreview={() => setShowPreview(true)}
          />
        )}
        {tab === 'employees' && (
          <EmployeesTab employees={employees} onToggleActive={toggleActive} onUpdateMax={updateWeeklyMax}
            onUpdateRoles={updateEmployeeRoles}
            onChangeAdminPin={changeAdminPin} onResetPin={resetEmployeePin} />
        )}
        {tab === 'absences' && (
          <AbsencesTab employees={employees} absences={absences} absForm={absForm} setAbsForm={setAbsForm} onAdd={addAbsence} onRemove={removeAbsence}
            requests={requests} onApprove={approveRequest} onReject={rejectRequest} />
        )}
        {tab === 'history' && (
          <HistoryTab weeks={weeks} onOpen={id => { setActiveWeekId(id); setTab('planner'); }} />
        )}
        {tab === 'import' && <ImportTab employees={employees} onImport={importHistoryWeeks} />}
        {tab === 'balance' && <BalanceTab employees={employees} weeks={weeks} />}
      </main>
      {exportText !== null && <ExportModal text={exportText} onClose={() => setExportText(null)} />}
      {showPreview && activeWeek && <PrintPreviewModal week={activeWeek} employees={employees} onClose={() => setShowPreview(false)} />}
    </div>
  );
}
