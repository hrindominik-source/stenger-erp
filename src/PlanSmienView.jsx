import React, { useState, useEffect } from 'react';
import { Sun, Moon, Droplets, Plus, X, AlertTriangle, Users, Trash2, UserPlus, Copy, ChevronLeft, ChevronRight, Pencil, Check, Printer, KeyRound } from 'lucide-react';
import { supabase } from './supabaseClient.js';

/* =========================================================================
   DATA
   ========================================================================= */
const DEFAULT_EMPLOYEES = [
  { id: 'e1',  name: 'Mašková Lenka',      roles: ['pos1'],                     weeklyMax: 4, active: true },
  { id: 'e2',  name: 'Jana Dragounová',    roles: ['pos1','pos3','general'],    weeklyMax: 4, active: true },
  { id: 'e3',  name: 'Martina Vávrová',    roles: ['pos1','pos3','general'],    weeklyMax: 4, active: true },
  { id: 'e4',  name: 'Yvetta Cafourková',  roles: ['pos1','pos3','general'],    weeklyMax: 4, active: true },
  { id: 'e5',  name: 'Petra Achačová',     roles: ['pos1-backup','pos3','general'], weeklyMax: 4, active: true },
  { id: 'e6',  name: 'Milena Jechová',     roles: ['pos3','general'],           weeklyMax: 4, active: true },
  { id: 'e7',  name: 'Zuzana Svobodová',   roles: ['pos3','general'],           weeklyMax: 2, active: true },
  { id: 'e8',  name: 'Lucie Fišerová',     roles: ['general'],                  weeklyMax: 4, active: true },
  { id: 'e9',  name: 'Lucie Melicharová',  roles: ['general'],                  weeklyMax: 4, active: true },
  { id: 'e10', name: 'Monika Mandíková',   roles: ['general'],                  weeklyMax: 4, active: true },
  { id: 'e11', name: 'Bohdana Matejková',  roles: ['general'],                  weeklyMax: 4, active: true },
  { id: 'e12', name: 'Vendula Svobodová',  roles: ['general'],                  weeklyMax: 4, active: true },
  { id: 'e13', name: 'Kvetoslava Buchová', roles: ['general'],                  weeklyMax: 4, active: true },
];

const PRODUCTS = {
  sacky:   { label: 'Vrecká (sáčky)', total: 4 },
  kybliky: { label: 'Kýbliky',        total: 6 },
  bulk:    { label: 'Bulk popcorn',   total: 5 },
};
const SANITATION_TOTAL = 5;
const ROLE_LABEL = { pos1: 'Hrncová', 'pos1-backup': 'Hrncová (záskok)', pos3: 'Pozícia 3', general: 'Ostatné' };

const TABS = [
  { key: 'planner',   label: 'Plán týždňa' },
  { key: 'employees', label: 'Zamestnankyne' },
  { key: 'absences',  label: 'Neprítomnosti' },
  { key: 'history',   label: 'História' },
  { key: 'import',    label: 'Import histórie' },
  { key: 'balance',   label: 'Rovnováha' },
];

/* =========================================================================
   DATUMY
   ========================================================================= */
const pad = n => String(n).padStart(2, '0');
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
const mondayOf = iso => { const d = parseISO(iso); const day = d.getDay(); const diff = day === 0 ? -6 : 1 - day; d.setDate(d.getDate() + diff); return toISO(d); };
const DAY_NAMES = ['Nedeľa', 'Pondelok', 'Utorok', 'Streda', 'Štvrtok', 'Piatok', 'Sobota'];
const DAY_SHORT = ['Ne', 'Po', 'Ut', 'St', 'Št', 'Pi', 'So'];
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
function isOnAbsence(empId, date, absences) {
  return absences.some(a => a.employeeId === empId && date >= a.from && date <= a.to);
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
function getEmpNameFrom(employees, id) { const e = employees.find(x => x.id === id); return e ? e.name : '(neznáma)'; }

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
      !isOnAbsence(e.id, shift.date, absences) &&
      !neighborIds.has(e.id) &&
      !usedInShift.has(e.id) &&
      weekShiftCount(w, e.id) < (maxOverride ?? e.weeklyMax)
    );

    if (roleKey === 'pos1') {
      if (current) {
        const curEmp = employees.find(e => e.id === current);
        const stillOk = curEmp && curEmp.active && curEmp.roles.includes('pos1') &&
          !isOnAbsence(current, shift.date, absences) && !neighborIds.has(current) && !usedInShift.has(current) &&
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
          !isOnAbsence(current, shift.date, absences) && !neighborIds.has(current) && !usedInShift.has(current) &&
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
      return e.active && e.roles.includes('general') && !isOnAbsence(id, shift.date, absences) &&
        !neighborIds.has(id) && !usedInShift.has(id) && weekShiftCount(w, id) < e.weeklyMax;
    };

    const chosen = [...already];
    team.forEach(id => { if (chosen.length < needed && !chosen.includes(id) && isEligible(id, chosen)) chosen.push(id); });

    let guard = 0;
    while (chosen.length < needed && guard < 30) {
      guard++;
      const usedInShift = new Set([...shiftPeopleIds(shift), ...chosen]);
      const pool = employees.filter(e => e.active && e.roles.includes('general') &&
        !isOnAbsence(e.id, shift.date, absences) && !neighborIds.has(e.id) && !usedInShift.has(e.id) &&
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
   TYP = den/noc/sanitacia, PRODUKT a mena su volitelne, mena sa paruju podla existujucich zamestnankyn. */
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
    if (parts.length < 2) { errors.push(`Riadok ${idx + 1}: príliš málo údajov`); return; }
    const [dateStr, typRaw, prodRaw, hrncova, pozicia3, ...rest] = parts;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) { errors.push(`Riadok ${idx + 1}: neplatný dátum "${dateStr}" (očakáva sa RRRR-MM-DD)`); return; }
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
    ? { icon: Sun, label: 'Denná', time: '6:00–18:00', badge: 'bg-amber-100 text-amber-800 border-amber-300' }
    : shift.type === 'night'
    ? { icon: Moon, label: 'Nočná', time: '18:00–6:00', badge: 'bg-indigo-100 text-indigo-800 border-indigo-300' }
    : { icon: Droplets, label: 'Sanitácia', time: '6:00–18:00', badge: 'bg-teal-100 text-teal-800 border-teal-300' };
  const Icon = typeMeta.icon;

  function warn(empId) {
    const emp = employees.find(e => e.id === empId);
    if (!emp) return null;
    if (isOnAbsence(empId, shift.date, absences)) return 'Neprítomná (dovolenka/PN/iné) v tento deň';
    if (weekShiftCount(week, empId) > emp.weeklyMax) return `Nad rámec limitu (${emp.weeklyMax} zmien/týždeň)`;
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
          <select value={shift.product || ''} onChange={e => onSetProduct(shift.id, e.target.value || null)}
            className="ml-auto text-sm border border-slate-300 rounded px-2 py-1">
            <option value="">— zvoliť produkt —</option>
            {Object.entries(PRODUCTS).map(([k, v]) => <option key={k} value={k}>{v.label} ({v.total} ľudí)</option>)}
          </select>
        ) : (
          <span className="ml-auto text-sm text-slate-500">Sanitácia linky ({SANITATION_TOTAL} ľudí)</span>
        )}

        <span className={`text-xs font-mono px-2 py-1 rounded ${filledCount === total && total > 0 ? 'bg-emerald-100 text-emerald-700' : filledCount < total ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
          {filledCount}/{total || '–'}
        </span>
        <button onClick={() => onClear(shift.id)} className="text-slate-400 hover:text-rose-600" title="Vyčistiť priradenia">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {total > 0 && (
        <div className="grid sm:grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Hrncová</div>
            {shift.assigned.pos1 ? (
              <PersonChip name={getEmpNameFrom(employees, shift.assigned.pos1)} warning={warn(shift.assigned.pos1)} onRemove={() => onSetPos(shift.id, 'pos1', null)} />
            ) : (
              <select onChange={e => onSetPos(shift.id, 'pos1', e.target.value || null)} value="" className="text-sm border border-dashed border-slate-300 rounded px-2 py-1 w-full text-slate-400">
                <option value="">+ priradiť</option>
                {pos1Options.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            )}
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Pozícia 3</div>
            {shift.assigned.pos3 ? (
              <PersonChip name={getEmpNameFrom(employees, shift.assigned.pos3)} warning={warn(shift.assigned.pos3)} onRemove={() => onSetPos(shift.id, 'pos3', null)} />
            ) : (
              <select onChange={e => onSetPos(shift.id, 'pos3', e.target.value || null)} value="" className="text-sm border border-dashed border-slate-300 rounded px-2 py-1 w-full text-slate-400">
                <option value="">+ priradiť</option>
                {pos3Options.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            )}
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Ostatné pozície</div>
            <div className="flex flex-wrap gap-1 mb-1">
              {shift.assigned.general.map(id => (
                <PersonChip key={id} name={getEmpNameFrom(employees, id)} warning={warn(id)} onRemove={() => onRemoveGeneral(shift.id, id)} />
              ))}
            </div>
            {shift.assigned.general.length < neededGeneral && (
              <select onChange={e => { if (e.target.value) onAddGeneral(shift.id, e.target.value); }} value="" className="text-sm border border-dashed border-slate-300 rounded px-2 py-1 w-full text-slate-400">
                <option value="">+ priradiť</option>
                {generalOptions.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            )}
          </div>
        </div>
      )}

      {total > 0 && (
        <div className="mt-2 pt-2 border-t border-dashed border-slate-200 flex flex-wrap items-center gap-1">
          <span className="text-xs uppercase tracking-wide text-slate-400 mr-1">Navyše (napr. na zaučenie):</span>
          {shift.extra.map(id => <PersonChip key={id} name={getEmpNameFrom(employees, id)} warning={warn(id)} onRemove={() => onRemoveExtra(shift.id, id)} />)}
          <select onChange={e => { if (e.target.value) onAddExtra(shift.id, e.target.value); }} value="" className="text-xs border border-dashed border-slate-300 rounded px-1.5 py-1 text-slate-400">
            <option value="">+ pridať navyše</option>
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
  shift.extra.forEach(id => list.push({ name: getEmpNameFrom(employees, id), tag: 'navyše' }));
  return list;
}

function PrintPreviewModal({ week, employees, onClose }) {
  const [viewMode, setViewMode] = useState('cards');

  const shiftTypeMeta = {
    day: { icon: Sun, label: 'Denná', time: '6:00–18:00', bar: 'bg-amber-400', bg: 'bg-amber-50' },
    night: { icon: Moon, label: 'Nočná', time: '18:00–6:00', bar: 'bg-indigo-500', bg: 'bg-indigo-50' },
    sanitation: { icon: Droplets, label: 'Sanitácia', time: '6:00–18:00', bar: 'bg-teal-500', bg: 'bg-teal-50' },
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

  const activeEmployees = employees.filter(e => e.active);
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
  const dotClass = { pos1: 'bg-amber-600', pos3: 'bg-purple-600', gen: 'bg-teal-600' };
  const colWidth = Math.max(24, Math.floor((297 - 20 - 60) / Math.max(1, activeEmployees.length)));

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
          <button onClick={() => setViewMode('cards')} className={`px-3 py-2 text-sm font-medium ${viewMode === 'cards' ? 'bg-slate-900 text-white' : 'hover:bg-slate-100'}`}>Karty podľa dní</button>
          <button onClick={() => setViewMode('matrix')} className={`px-3 py-2 text-sm font-medium ${viewMode === 'matrix' ? 'bg-slate-900 text-white' : 'hover:bg-slate-100'}`}>Matica podľa mien</button>
        </div>
        <button onClick={() => window.print()} className="px-3 py-2 text-sm rounded bg-slate-900 text-white hover:bg-slate-800 flex items-center gap-1 shadow">
          <Printer className="w-4 h-4" />Tlačiť / Uložiť ako PDF
        </button>
        <button onClick={onClose} className="px-3 py-2 text-sm rounded bg-white border border-slate-300 hover:bg-slate-100 shadow flex items-center gap-1">
          <X className="w-4 h-4" />Zavrieť
        </button>
      </div>

      <div id="print-sheet" className="bg-white shadow-2xl" style={{ width: '297mm', minHeight: '210mm', padding: '10mm', boxSizing: 'border-box' }}>
        <div className="flex items-start justify-between border-b-4 border-slate-900 pb-3 mb-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Rozpis zmien — výroba</h1>
            <p className="text-sm text-slate-500 mt-0.5">Týždeň od {formatSk(week.startDate)}</p>
          </div>
          <div className="text-right text-xs text-slate-400 pt-1">Vygenerované {formatSk(toISO(new Date()))}</div>
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
                      const prodLabel = s.type === 'sanitation' ? 'Sanitácia linky' : (s.product ? PRODUCTS[s.product].label : '—');
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
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-amber-400 rounded-sm inline-block" />Denná</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-indigo-500 rounded-sm inline-block" />Nočná</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-teal-500 rounded-sm inline-block" />Sanitácia</span>
            </div>
          </>
        ) : (
          <>
            <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '34px' }} />
                <col style={{ width: '26px' }} />
                {activeEmployees.map(e => <col key={e.id} style={{ width: `${colWidth}px` }} />)}
              </colgroup>
              <thead>
                <tr>
                  <td colSpan={2}></td>
                  {activeEmployees.map(e => (
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
                  const Icon = shiftTypeMeta[s.type].icon;
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
                      {activeEmployees.map(e => {
                        const role = roleOf(s, e.id);
                        return (
                          <td key={e.id} className={`text-center border border-slate-200 ${nightBg}`}>
                            {role && (
                              <span className="relative inline-block">
                                <span className={`inline-block w-3 h-3 rounded-full ${dotClass[role]}`} />
                                {role === 'pos3' && <sup className="text-[9px] text-purple-600 ml-0.5">3</sup>}
                              </span>
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
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-purple-600 inline-block" />Pozícia 3</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-teal-600 inline-block" />Ostatné</span>
              <span className="flex items-center gap-1"><Sun className="w-3.5 h-3.5" />Denná</span>
              <span className="flex items-center gap-1"><Moon className="w-3.5 h-3.5" />Nočná</span>
              <span className="flex items-center gap-1"><Droplets className="w-3.5 h-3.5" />Sanitácia</span>
            </div>
          </>
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

  function submitAdmin() {
    if (!onAdminLogin(pin)) { setError('Nesprávny PIN.'); setPin(''); }
  }
  function submitEmployee() {
    if (!empId) { setError('Vyberte svoje meno.'); return; }
    const res = onEmployeeLogin(empId, pin);
    if (!res.success) { setError(res.message || 'Nesprávny PIN.'); setPin(''); }
  }

  if (!mode) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-sm w-full text-center space-y-4">
          <h1 className="text-lg font-bold text-slate-900">Plán zmien — výroba</h1>
          <p className="text-sm text-slate-500">Kto sa prihlasuje?</p>
          <button onClick={() => setMode('admin')} className="w-full px-4 py-3 rounded bg-slate-900 text-white font-medium hover:bg-slate-800">Vedúci / vedúca výroby</button>
          <button onClick={() => setMode('employee')} className="w-full px-4 py-3 rounded border border-slate-300 font-medium hover:bg-slate-50">Zamestnankyňa</button>
          {onBack && <button onClick={onBack} className="text-xs text-slate-400 hover:text-slate-600 mt-2">&larr; Iná aplikácia</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-sm w-full space-y-4">
        <button onClick={() => { setMode(null); setError(''); setPin(''); }} className="text-xs text-slate-400 hover:text-slate-600">&larr; Späť</button>
        {mode === 'admin' ? (
          <>
            <h2 className="font-semibold text-slate-900">Prihlásenie vedúceho</h2>
            <input type="password" inputMode="numeric" placeholder="PIN" value={pin} onChange={e => setPin(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submitAdmin()}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm text-center tracking-widest" />
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <button onClick={submitAdmin} className="w-full px-4 py-2 rounded bg-slate-900 text-white font-medium hover:bg-slate-800">Prihlásiť sa</button>
          </>
        ) : (
          <>
            <h2 className="font-semibold text-slate-900">Prihlásenie zamestnankyne</h2>
            <select value={empId} onChange={e => { setEmpId(e.target.value); setError(''); }} className="w-full border border-slate-300 rounded px-3 py-2 text-sm">
              <option value="">— vyberte svoje meno —</option>
              {employees.filter(e => e.active).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <input type="password" inputMode="numeric" placeholder="PIN (min. 4 čísla)" value={pin} onChange={e => setPin(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submitEmployee()}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm text-center tracking-widest" />
            <p className="text-xs text-slate-400">Ak sa prihlasujete prvýkrát, zadaný PIN sa vám nastaví natrvalo — zapamätajte si ho. Ak ste ho zabudli, požiadajte vedúceho o reset.</p>
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <button onClick={submitEmployee} className="w-full px-4 py-2 rounded bg-slate-900 text-white font-medium hover:bg-slate-800">Prihlásiť sa</button>
          </>
        )}
      </div>
    </div>
  );
}

function EmployeePortal({ employee, weeks, requests, onSubmitRequest, onLogout }) {
  const [form, setForm] = useState({ from: '', to: '', reason: '' });
  const today = toISO(new Date());
  const myShifts = [];
  [...weeks].sort((a, b) => a.startDate.localeCompare(b.startDate)).forEach(w => {
    w.shifts.forEach(s => {
      if (shiftPeopleIds(s).includes(employee.id) && s.date >= today) {
        const label = s.type === 'day' ? 'Denná (6:00–18:00)' : s.type === 'night' ? 'Nočná (18:00–6:00)' : 'Sanitácia (6:00–18:00)';
        myShifts.push({ id: s.id, date: s.date, label });
      }
    });
  });
  myShifts.sort((a, b) => a.date.localeCompare(b.date));

  function submit() {
    if (!form.from || !form.to) return;
    onSubmitRequest(employee.id, form.from, form.to, form.reason);
    setForm({ from: '', to: '', reason: '' });
  }

  const myRequests = requests.filter(r => r.employeeId === employee.id).sort((a, b) => b.from.localeCompare(a.from));
  const statusLabel = { pending: 'Čaká na schválenie', approved: 'Schválené', rejected: 'Zamietnuté' };
  const statusColor = { pending: 'bg-amber-100 text-amber-700', approved: 'bg-emerald-100 text-emerald-700', rejected: 'bg-rose-100 text-rose-700' };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-900 text-white px-4 md:px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Ahoj, {employee.name}</h1>
          <p className="text-xs text-slate-400">Vaše zmeny a žiadosti o voľno</p>
        </div>
        <button onClick={onLogout} className="text-sm text-slate-300 hover:text-white underline">Odhlásiť sa</button>
      </header>
      <main className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h3 className="font-semibold mb-3">Moje najbližšie zmeny</h3>
          {myShifts.length === 0 && <p className="text-sm text-slate-400">Zatiaľ nemáte naplánované žiadne nadchádzajúce zmeny.</p>}
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
          <h3 className="font-semibold mb-3">Nahlásiť neprítomnosť (dovolenka, lekár, iné)</h3>
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
          <input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="napr. dovolenka / lekár" className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm mb-3" />
          <button onClick={submit} className="px-4 py-2 rounded bg-slate-900 text-white text-sm font-medium hover:bg-slate-800">Odoslať žiadosť nadriadenému</button>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h3 className="font-semibold mb-3">Moje žiadosti</h3>
          {myRequests.length === 0 && <p className="text-sm text-slate-400">Zatiaľ ste nepodali žiadnu žiadosť.</p>}
          <div className="space-y-2">
            {myRequests.map(r => (
              <div key={r.id} className="flex items-center justify-between text-sm border-b border-slate-100 pb-2 last:border-0">
                <div>
                  <div className="text-slate-700">{formatSk(r.from)} – {formatSk(r.to)}</div>
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


function PlannerTab({ weeks, activeWeek, employees, absences, setActiveWeekId, onNav, onCreateWeek, onToggleSunday, onAutoFill, onClearRefill, onSetProduct, onSetPos, onAddGeneral, onRemoveGeneral, onAddExtra, onRemoveExtra, onClearShift, onExport, onShowPreview }) {
  if (!activeWeek) {
    return (
      <div className="text-center py-10 text-slate-500">
        Zatiaľ žiadny týždeň.
        <div className="mt-3"><button onClick={onCreateWeek} className="px-3 py-2 text-sm rounded bg-slate-900 text-white">Vytvoriť prvý týždeň</button></div>
      </div>
    );
  }
  const sortedWeeks = [...weeks].sort((a, b) => a.startDate.localeCompare(b.startDate));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => onNav(-1)} className="p-2 rounded border border-slate-300 hover:bg-slate-100"><ChevronLeft className="w-4 h-4" /></button>
        <select value={activeWeek.id} onChange={e => setActiveWeekId(e.target.value)} className="border border-slate-300 rounded px-2 py-2 text-sm font-medium">
          {sortedWeeks.map(w => <option key={w.id} value={w.id}>Týždeň od {formatSk(w.startDate)}</option>)}
        </select>
        <button onClick={() => onNav(1)} className="p-2 rounded border border-slate-300 hover:bg-slate-100"><ChevronRight className="w-4 h-4" /></button>
        <button onClick={onCreateWeek} className="px-3 py-2 text-sm rounded border border-slate-300 hover:bg-slate-100 flex items-center gap-1"><Plus className="w-4 h-4" />Nový týždeň</button>

        <label className="ml-2 flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={activeWeek.extraSundayNight} onChange={onToggleSunday} />
          Mimoriadny štart: nočná už v nedeľu 18:00
        </label>

        <div className="ml-auto flex gap-2">
          <button onClick={onAutoFill} className="px-3 py-2 text-sm rounded bg-slate-900 text-white hover:bg-slate-800">Doplniť prázdne miesta</button>
          <button onClick={onShowPreview} className="px-3 py-2 text-sm rounded border border-slate-300 hover:bg-slate-100 flex items-center gap-1"><Printer className="w-4 h-4" />Ukázať/exportovať náhľad</button>
          <button onClick={onClearRefill} className="px-3 py-2 text-sm rounded border border-slate-300 hover:bg-slate-100">Vyčistiť a preplánovať</button>
          <button onClick={onExport} className="px-3 py-2 text-sm rounded border border-slate-300 hover:bg-slate-100 flex items-center gap-1"><Copy className="w-4 h-4" />Export (text)</button>
        </div>
      </div>

      <TimelineStrip week={activeWeek} />
      <p className="text-xs text-slate-400 -mt-2">Predpoklad rozdelenia počtu ľudí: 1× hrncová + 1× pozícia 3 + zvyšok ostatné pozície, podľa zvoleného produktu. Ak to má byť inak, daj vedieť.</p>

      <div className="space-y-2">
        {activeWeek.shifts.map(s => (
          <ShiftRow key={s.id} week={activeWeek} shift={s} employees={employees} absences={absences}
            onSetProduct={onSetProduct} onSetPos={onSetPos} onAddGeneral={onAddGeneral} onRemoveGeneral={onRemoveGeneral}
            onAddExtra={onAddExtra} onRemoveExtra={onRemoveExtra} onClear={onClearShift} />
        ))}
      </div>
    </div>
  );
}

function EmployeesTab({ employees, weeks, newEmpForm, setNewEmpForm, onAdd, onToggleActive, onUpdateMax, onRemoveHard, onRename, onUpdateRoles, onResetDefaults, adminPin, onChangeAdminPin, onResetPin }) {
  const ROLE_OPTIONS = [
    { key: 'pos1', label: 'Hrncová' },
    { key: 'pos1-backup', label: 'Hrncová – záskok' },
    { key: 'pos3', label: 'Pozícia 3' },
    { key: 'general', label: 'Ostatné pozície' },
  ];
  function toggleRole(k) {
    setNewEmpForm(f => ({ ...f, roles: f.roles.includes(k) ? f.roles.filter(r => r !== k) : [...f.roles, k] }));
  }
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editRoles, setEditRoles] = useState([]);
  function startEdit(e) { setEditingId(e.id); setEditName(e.name); setEditRoles(e.roles); }
  function toggleEditRole(k) { setEditRoles(rs => (rs.includes(k) ? rs.filter(r => r !== k) : [...rs, k])); }
  function saveEdit() {
    if (editName.trim()) onRename(editingId, editName.trim());
    if (editRoles.length > 0) onUpdateRoles(editingId, editRoles);
    setEditingId(null);
    setEditName('');
    setEditRoles([]);
  }
  function cancelEdit() { setEditingId(null); setEditName(''); setEditRoles([]); }
  const [adminPinInput, setAdminPinInput] = useState('');
  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="font-semibold mb-3 flex items-center gap-2"><UserPlus className="w-4 h-4" />Pridať zamestnankyňu</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Meno</label>
            <input value={newEmpForm.name} onChange={e => setNewEmpForm(f => ({ ...f, name: e.target.value }))} className="border border-slate-300 rounded px-2 py-1.5 text-sm" placeholder="Meno a priezvisko" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Max. zmien / týždeň</label>
            <input type="number" min="1" max="10" value={newEmpForm.weeklyMax} onChange={e => setNewEmpForm(f => ({ ...f, weeklyMax: e.target.value }))} className="border border-slate-300 rounded px-2 py-1.5 text-sm w-20" />
          </div>
          <div className="flex gap-3 flex-wrap">
            {ROLE_OPTIONS.map(r => (
              <label key={r.key} className="flex items-center gap-1 text-xs text-slate-600">
                <input type="checkbox" checked={newEmpForm.roles.includes(r.key)} onChange={() => toggleRole(r.key)} /> {r.label}
              </label>
            ))}
          </div>
          <button onClick={onAdd} className="px-3 py-1.5 text-sm rounded bg-slate-900 text-white hover:bg-slate-800">Pridať</button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr><th className="text-left px-3 py-2">Meno</th><th className="text-left px-3 py-2">Pozície</th><th className="text-left px-3 py-2">Max/týždeň</th><th className="text-left px-3 py-2">Stav</th><th></th></tr>
          </thead>
          <tbody>
            {employees.map(e => {
              const used = weeks.some(w => w.shifts.some(s => shiftPeopleIds(s).includes(e.id)));
              return (
                <tr key={e.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium whitespace-nowrap">
                    {editingId === e.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          autoFocus
                          value={editName}
                          onChange={ev => setEditName(ev.target.value)}
                          onKeyDown={ev => { if (ev.key === 'Enter') saveEdit(); if (ev.key === 'Escape') cancelEdit(); }}
                          className="border border-slate-300 rounded px-1.5 py-1 text-sm w-40"
                        />
                        <button onClick={saveEdit} disabled={editRoles.length === 0} className={`p-1 ${editRoles.length === 0 ? 'text-slate-300 cursor-not-allowed' : 'text-emerald-600 hover:text-emerald-800'}`} title="Uložiť"><Check className="w-4 h-4" /></button>
                        <button onClick={cancelEdit} className="p-1 text-slate-400 hover:text-rose-600" title="Zrušiť"><X className="w-4 h-4" /></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        {e.name}
                        <button onClick={() => startEdit(e)} className="p-0.5 text-slate-300 hover:text-slate-600" title="Upraviť meno"><Pencil className="w-3.5 h-3.5" /></button>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {editingId === e.id ? (
                      <div className="flex flex-col gap-1">
                        {ROLE_OPTIONS.map(r => (
                          <label key={r.key} className="flex items-center gap-1.5 text-xs text-slate-600 whitespace-nowrap">
                            <input type="checkbox" checked={editRoles.includes(r.key)} onChange={() => toggleEditRole(r.key)} /> {r.label}
                          </label>
                        ))}
                        {editRoles.length === 0 && <span className="text-rose-500 text-[11px]">Vyberte aspoň jednu pozíciu</span>}
                      </div>
                    ) : (
                      e.roles.map(r => ROLE_LABEL[r]).join(', ')
                    )}
                  </td>
                  <td className="px-3 py-2"><input type="number" min="1" max="10" value={e.weeklyMax} onChange={ev => onUpdateMax(e.id, ev.target.value)} className="w-16 border border-slate-300 rounded px-1.5 py-1" /></td>
                  <td className="px-3 py-2">
                    <button onClick={() => onToggleActive(e.id)} className={`px-2 py-1 rounded text-xs font-medium ${e.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                      {e.active ? 'Aktívna' : 'Neaktívna'}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {e.pin && (
                      <button onClick={() => onResetPin(e.id)} title="Resetovať PIN (zabudnutý) — nastaví si nový pri ďalšom prihlásení" className="p-1 rounded text-slate-400 hover:text-amber-600 mr-1">
                        <KeyRound className="w-4 h-4" />
                      </button>
                    )}
                    <button disabled={used} onClick={() => onRemoveHard(e.id)} title={used ? 'Nemožno odstrániť — má priradené smeny v histórii' : 'Odstrániť natrvalo'} className={`p-1 rounded ${used ? 'text-slate-300 cursor-not-allowed' : 'text-slate-400 hover:text-rose-600'}`}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-slate-400 max-w-2xl">Zneaktívnenie (namiesto odstránenia) zachová históriu smien, len sa zamestnankyňa už neponúkne pri plánovaní. Odstrániť natrvalo ide len vtedy, ak nemá žiadne priradené smeny v žiadnom týždni.</p>
        <button onClick={onResetDefaults} className="px-3 py-1.5 text-xs rounded border border-slate-300 hover:bg-slate-100 whitespace-nowrap">Nastaviť predvolené limity (4, Svobodová 2)</button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="font-semibold mb-2">PIN pre prihlásenie vedúceho</h3>
        <div className="flex gap-2 items-end flex-wrap">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Nový PIN (min. 4 znaky)</label>
            <input value={adminPinInput} onChange={e => setAdminPinInput(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm w-32" placeholder="napr. 4521" />
          </div>
          <button onClick={() => { onChangeAdminPin(adminPinInput); setAdminPinInput(''); }} className="px-3 py-1.5 text-sm rounded bg-slate-900 text-white hover:bg-slate-800">Uložiť</button>
        </div>
        <p className="text-xs text-slate-400 mt-1">Tento PIN slúži na vstup do celej appky (mimo zamestnaneckej sekcie). Aktuálny PIN: <span className="font-mono">{adminPin}</span></p>
      </div>
    </div>
  );
}

function AbsencesTab({ employees, absences, absForm, setAbsForm, onAdd, onRemove, requests, onApprove, onReject }) {
  const pending = requests.filter(r => r.status === 'pending').sort((a, b) => a.from.localeCompare(b.from));
  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="font-semibold mb-3">Žiadosti od zamestnankýň na schválenie</h3>
        {pending.length === 0 && <p className="text-sm text-slate-400">Žiadne čakajúce žiadosti.</p>}
        <div className="space-y-2">
          {pending.map(r => (
            <div key={r.id} className="flex items-center justify-between text-sm border-b border-slate-100 pb-2 last:border-0">
              <div>
                <div className="font-medium text-slate-700">{getEmpNameFrom(employees, r.employeeId)}</div>
                <div className="text-xs text-slate-500">{formatSk(r.from)} – {formatSk(r.to)}{r.reason ? ` · ${r.reason}` : ''}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => onApprove(r.id)} className="px-2 py-1 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700">Schváliť</button>
                <button onClick={() => onReject(r.id)} className="px-2 py-1 text-xs rounded bg-rose-100 text-rose-700 hover:bg-rose-200">Zamietnuť</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="font-semibold mb-3">Nahlásiť neprítomnosť ručne (dovolenka, lekár, iné)</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Zamestnankyňa</label>
            <select value={absForm.employeeId} onChange={e => setAbsForm(f => ({ ...f, employeeId: e.target.value }))} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
              <option value="">— vybrať —</option>
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
            <input value={absForm.reason} onChange={e => setAbsForm(f => ({ ...f, reason: e.target.value }))} placeholder="dovolenka / lekár / ..." className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
          </div>
          <button onClick={onAdd} className="px-3 py-1.5 text-sm rounded bg-slate-900 text-white hover:bg-slate-800">Pridať</button>
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr><th className="text-left px-3 py-2">Zamestnankyňa</th><th className="text-left px-3 py-2">Od</th><th className="text-left px-3 py-2">Do</th><th className="text-left px-3 py-2">Poznámka</th><th></th></tr>
          </thead>
          <tbody>
            {absences.slice().sort((a, b) => a.from.localeCompare(b.from)).map(a => (
              <tr key={a.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium">{getEmpNameFrom(employees, a.employeeId)}</td>
                <td className="px-3 py-2">{formatSk(a.from)}</td>
                <td className="px-3 py-2">{formatSk(a.to)}</td>
                <td className="px-3 py-2 text-slate-500">{a.reason}</td>
                <td className="px-3 py-2 text-right"><button onClick={() => onRemove(a.id)} className="text-slate-400 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button></td>
              </tr>
            ))}
            {absences.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">Žiadne nahlásené neprítomnosti.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ImportTab({ employees, onImport }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);

  const example = `# jeden riadok = jedna zmena
# formát: DATUM;TYP;PRODUKT;HRNCOVA;POZICIA3;OSTATNI,OSTATNI,...
# TYP: den / noc / sanitacia   PRODUKT: sacky / kybliky / bulk (voliteľné)
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
        <h3 className="font-semibold mb-2">Import starších týždňov (2-3 mesiace histórie)</h3>
        <p className="text-sm text-slate-500 mb-3">
          Vložte údaje v jednoduchom textovom formáte nižšie — jeden riadok na jednu zmenu. Mená sa musia zhodovať s menami v záložke „Zamestnankyne“ (inak sa zobrazia ako nespárované). Importované týždne sa započítajú do histórie aj do rovnováhy zmien.
        </p>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={example}
          className="w-full h-64 text-xs font-mono border border-slate-300 rounded p-2"
        />
        <button onClick={runImport} disabled={!text.trim()} className={`mt-3 px-4 py-2 text-sm rounded font-medium ${text.trim() ? 'bg-slate-900 text-white hover:bg-slate-800' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>
          Importovať
        </button>
      </div>

      {result && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-2 text-sm">
          <p className="text-emerald-700 font-medium">Naimportovaných {result.weeks.length} týždňov ({result.lineCount} riadkov spracovaných).</p>
          {result.errors.length > 0 && (
            <div>
              <p className="text-rose-600 font-medium mb-1">Chyby v {result.errors.length} riadkoch:</p>
              <ul className="list-disc list-inside text-rose-600 text-xs space-y-0.5">
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
          {result.unmatched.length > 0 && (
            <div>
              <p className="text-amber-600 font-medium mb-1">Nespárované mená (neboli priradené, skontrolujte pravopis alebo pridajte zamestnankyňu):</p>
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
          <tr><th className="text-left px-3 py-2">Týždeň od</th><th className="text-left px-3 py-2">Zmeny</th><th className="text-left px-3 py-2">Obsadenosť</th><th></th></tr>
        </thead>
        <tbody>
          {sorted.map(w => {
            const totalNeeded = w.shifts.reduce((s, sh) => s + shiftTotal(sh), 0);
            const totalFilled = w.shifts.reduce((s, sh) => s + shiftPeopleIds(sh).length, 0);
            return (
              <tr key={w.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium">{formatSk(w.startDate)}</td>
                <td className="px-3 py-2 text-slate-500">{w.shifts.length} zmien{w.extraSundayNight ? ' (+ nedeľná)' : ''}</td>
                <td className="px-3 py-2">
                  <span className={`text-xs font-mono px-2 py-1 rounded ${totalFilled >= totalNeeded && totalNeeded > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{totalFilled}/{totalNeeded}</span>
                </td>
                <td className="px-3 py-2 text-right"><button onClick={() => onOpen(w.id)} className="text-sm text-slate-600 hover:text-slate-900 underline">Otvoriť</button></td>
              </tr>
            );
          })}
          {sorted.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">Zatiaľ žiadne týždne.</td></tr>}
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
      <h3 className="font-semibold mb-1">Rovnováha zmien (od začiatku plánovania v tejto appke)</h3>
      {rows.map(({ e, stats }) => (
        <div key={e.id} className="flex items-center gap-3 flex-wrap">
          <div className="w-40 text-sm font-medium truncate">{e.name}</div>
          <div className="flex-1 min-w-[120px] h-4 bg-slate-100 rounded overflow-hidden flex">
            <div className="bg-amber-400 h-full" style={{ width: `${(stats.day / maxTotal) * 100}%` }} title={`Denné: ${stats.day}`} />
            <div className="bg-indigo-500 h-full" style={{ width: `${(stats.night / maxTotal) * 100}%` }} title={`Nočné: ${stats.night}`} />
            <div className="bg-teal-500 h-full" style={{ width: `${(stats.sanitation / maxTotal) * 100}%` }} title={`Sanitácia: ${stats.sanitation}`} />
          </div>
          <div className="w-48 text-xs text-slate-500 font-mono">Σ{stats.total} · D{stats.day} N{stats.night} S{stats.sanitation}</div>
        </div>
      ))}
      <div className="flex gap-4 text-xs text-slate-500 pt-2 border-t border-slate-100">
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-amber-400 rounded-sm inline-block" />Denná</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-indigo-500 rounded-sm inline-block" />Nočná</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-teal-500 rounded-sm inline-block" />Sanitácia</span>
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
        <p className="text-xs text-slate-400">Text bol skopírovaný do schránky (ak to prehliadač povolil). Prípadne ho označte v poli vyššie a skopírujte manuálne.</p>
      </div>
    </div>
  );
}

/* =========================================================================
   HLAVNA APLIKACIA
   Perzistencia beziala povodne cez window.storage (Claude Artifacts API),
   ktore v tomto projekte neexistuje - nahradene jednym zdielanym riadkom
   v Supabase (tabulka plan_smien, id=1), aby vsetky zariadenia/zamestnankyne
   videli ten isty rozpis naraz.
   ========================================================================= */
export default function PlanSmienView({ onBack }) {
  const [employees, setEmployees] = useState(DEFAULT_EMPLOYEES);
  const [absences, setAbsences] = useState([]);
  const [requests, setRequests] = useState([]);
  const [adminPin, setAdminPin] = useState('1234');
  const [loginRole, setLoginRole] = useState(null);
  const [loginEmployeeId, setLoginEmployeeId] = useState(null);
  const [weeks, setWeeks] = useState([]);
  const [activeWeekId, setActiveWeekId] = useState(null);
  const [tab, setTab] = useState('planner');
  const [loaded, setLoaded] = useState(false);
  const [exportText, setExportText] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [newEmpForm, setNewEmpForm] = useState({ name: '', roles: [], weeklyMax: 4 });
  const [absForm, setAbsForm] = useState({ employeeId: '', from: '', to: '', reason: '' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: row, error } = await supabase.from('plan_smien').select('data').eq('id', 1).single();
        const d = !error && row ? row.data : null;
        if (d && Object.keys(d).length > 0) {
          if (!cancelled) {
            setEmployees(d.employees && d.employees.length ? d.employees : DEFAULT_EMPLOYEES);
            setAbsences(d.absences || []);
            setRequests(d.requests || []);
            setAdminPin(d.adminPin || '1234');
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
        if (!cancelled) {
          const w = generateWeek(mondayOf(toISO(new Date())), false);
          setWeeks([w]);
          setActiveWeekId(w.id);
        }
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const payload = { employees, absences, requests, adminPin, weeks, activeWeekId };
    supabase.from('plan_smien').update({ data: payload, updated_at: new Date().toISOString() }).eq('id', 1).then(() => {});
  }, [employees, absences, requests, adminPin, weeks, activeWeekId, loaded]);

  const activeWeek = weeks.find(w => w.id === activeWeekId) || null;

  function updateWeek(weekId, updater) {
    setWeeks(ws => ws.map(w => (w.id === weekId ? updater(cloneWeek(w)) : w)));
  }
  function updateShift(weekId, shiftId, updater) {
    updateWeek(weekId, w => { w.shifts = w.shifts.map(s => (s.id === shiftId ? updater(s) : s)); return w; });
  }

  function setProduct(shiftId, product) { updateShift(activeWeek.id, shiftId, s => { s.product = product; return s; }); }
  function setPos(shiftId, role, empId) { updateShift(activeWeek.id, shiftId, s => { s.assigned[role] = empId || null; return s; }); }
  function addGeneral(shiftId, empId) { updateShift(activeWeek.id, shiftId, s => { if (!s.assigned.general.includes(empId)) s.assigned.general.push(empId); return s; }); }
  function removeGeneral(shiftId, empId) { updateShift(activeWeek.id, shiftId, s => { s.assigned.general = s.assigned.general.filter(id => id !== empId); return s; }); }
  function addExtra(shiftId, empId) { updateShift(activeWeek.id, shiftId, s => { if (!s.extra.includes(empId)) s.extra.push(empId); return s; }); }
  function removeExtra(shiftId, empId) { updateShift(activeWeek.id, shiftId, s => { s.extra = s.extra.filter(id => id !== empId); return s; }); }
  function clearShiftAssignment(shiftId) { updateShift(activeWeek.id, shiftId, s => { s.assigned = { pos1: null, pos3: null, general: [] }; s.extra = []; return s; }); }

  function autoFillCurrentWeek() {
    if (!activeWeek) return;
    const filled = autoFillWeek(activeWeek, employees, absences, weeks);
    setWeeks(ws => ws.map(w => (w.id === filled.id ? filled : w)));
  }
  function clearAndRefillWeek() {
    if (!activeWeek) return;
    const cleared = cloneWeek(activeWeek);
    cleared.shifts.forEach(s => { s.assigned = { pos1: null, pos3: null, general: [] }; s.extra = []; });
    const filled = autoFillWeek(cleared, employees, absences, weeks.map(w => (w.id === cleared.id ? cleared : w)));
    setWeeks(ws => ws.map(w => (w.id === filled.id ? filled : w)));
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

  function addEmployee() {
    if (!newEmpForm.name.trim() || newEmpForm.roles.length === 0) return;
    const id = 'e' + Date.now();
    setEmployees(es => [...es, { id, name: newEmpForm.name.trim(), roles: newEmpForm.roles, weeklyMax: Number(newEmpForm.weeklyMax) || 4, active: true }]);
    setNewEmpForm({ name: '', roles: [], weeklyMax: 4 });
  }
  function toggleActive(id) { setEmployees(es => es.map(e => (e.id === id ? { ...e, active: !e.active } : e))); }
  function renameEmployee(id, name) { setEmployees(es => es.map(e => (e.id === id ? { ...e, name } : e))); }
  function updateWeeklyMax(id, val) { setEmployees(es => es.map(e => (e.id === id ? { ...e, weeklyMax: Number(val) || 1 } : e))); }
  function updateEmployeeRoles(id, roles) { if (roles.length === 0) return; setEmployees(es => es.map(e => (e.id === id ? { ...e, roles } : e))); }
  function resetToDefaultLimits() {
    setEmployees(es => es.map(e => ({ ...e, weeklyMax: e.name === 'Zuzana Svobodová' ? 2 : 4 })));
  }
  function removeEmployeeHard(id) {
    const usedAnywhere = weeks.some(w => w.shifts.some(s => shiftPeopleIds(s).includes(id)));
    if (usedAnywhere) return;
    setEmployees(es => es.filter(e => e.id !== id));
  }

  function addAbsence() {
    if (!absForm.employeeId || !absForm.from || !absForm.to) return;
    setAbsences(as => [...as, { id: 'a' + Date.now(), ...absForm }]);
    setAbsForm({ employeeId: '', from: '', to: '', reason: '' });
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

  function attemptAdminLogin(pin) {
    if (pin === adminPin) { setLoginRole('admin'); return true; }
    return false;
  }
  function attemptEmployeeLogin(employeeId, pin) {
    const emp = employees.find(e => e.id === employeeId);
    if (!emp) return { success: false, message: 'Neznáma zamestnankyňa.' };
    if (!emp.pin) {
      if (!pin || pin.length < 4) return { success: false, message: 'Zvoľte si PIN, aspoň 4 znaky.' };
      setEmployees(es => es.map(x => (x.id === employeeId ? { ...x, pin } : x)));
      setLoginRole('employee');
      setLoginEmployeeId(employeeId);
      return { success: true };
    }
    if (emp.pin === pin) { setLoginRole('employee'); setLoginEmployeeId(employeeId); return { success: true }; }
    return { success: false, message: 'Nesprávny PIN.' };
  }
  function logout() { setLoginRole(null); setLoginEmployeeId(null); }
  function resetEmployeePin(id) { setEmployees(es => es.map(e => (e.id === id ? { ...e, pin: null } : e))); }
  function changeAdminPin(newPin) { if (newPin && newPin.length >= 4) setAdminPin(newPin); }
  function submitAbsenceRequest(employeeId, from, to, reason) {
    setRequests(rs => [...rs, { id: 'r' + Date.now(), employeeId, from, to, reason, status: 'pending' }]);
  }
  function approveRequest(id) {
    const req = requests.find(r => r.id === id);
    if (!req) return;
    setAbsences(as => [...as, { id: 'a' + Date.now(), employeeId: req.employeeId, from: req.from, to: req.to, reason: req.reason }]);
    setRequests(rs => rs.map(r => (r.id === id ? { ...r, status: 'approved' } : r)));
  }
  function rejectRequest(id) { setRequests(rs => rs.map(r => (r.id === id ? { ...r, status: 'rejected' } : r))); }

  function generateExportText(week) {
    if (!week) return '';
    const lines = [];
    lines.push(`ROZPIS SMIEN — týždeň od ${formatSk(week.startDate)}`);
    lines.push('');
    week.shifts.forEach(s => {
      const label = s.type === 'day' ? 'Denná (6:00–18:00)' : s.type === 'night' ? 'Nočná (18:00–6:00)' : 'Sanitácia (6:00–18:00)';
      const prodLabel = s.type === 'sanitation' ? 'Sanitácia linky' : (s.product ? PRODUCTS[s.product].label : '— produkt nezvolený —');
      const names = [];
      if (s.assigned.pos1) names.push(`${getEmpNameFrom(employees, s.assigned.pos1)} (Hrncová)`);
      if (s.assigned.pos3) names.push(`${getEmpNameFrom(employees, s.assigned.pos3)} (Poz. 3)`);
      s.assigned.general.forEach(id => names.push(getEmpNameFrom(employees, id)));
      s.extra.forEach(id => names.push(`${getEmpNameFrom(employees, id)} (navyše)`));
      lines.push(`${dayLong(s.date)} ${formatSk(s.date)} — ${label} — ${prodLabel}`);
      lines.push(names.length ? names.map(n => `  • ${n}`).join('\n') : '  (nikto priradený)');
      lines.push('');
    });
    lines.push('--- Podľa zamestnankýň ---');
    employees.filter(e => e.active).forEach(e => {
      const mine = [];
      week.shifts.forEach(s => {
        if (shiftPeopleIds(s).includes(e.id)) {
          const label = s.type === 'day' ? 'Denná' : s.type === 'night' ? 'Nočná' : 'Sanitácia';
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

  if (!loaded) return <div className="p-8 text-center text-slate-500">Načítavam…</div>;

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
      <header className="bg-slate-900 text-white px-4 md:px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Plán zmien — výroba</h1>
          <p className="text-xs text-slate-400">Dvojzmenná prevádzka · denná / nočná / sanitácia</p>
        </div>
        <div className="flex items-center gap-3">
          {onBack && <button onClick={onBack} className="text-xs text-slate-300 hover:text-white underline">&larr; Iná aplikácia</button>}
          <button onClick={logout} className="text-xs text-slate-300 hover:text-white underline">Odhlásiť sa</button>
          <Users className="w-6 h-6 text-slate-400" />
        </div>
      </header>
      <nav className="flex gap-1 bg-white border-b border-slate-200 px-2 md:px-4 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap ${tab === t.key ? 'border-amber-500 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {t.label}
          </button>
        ))}
      </nav>
      <main className="p-4 md:p-6 max-w-6xl mx-auto">
        {tab === 'planner' && (
          <PlannerTab
            weeks={weeks} activeWeek={activeWeek} employees={employees} absences={absences}
            setActiveWeekId={setActiveWeekId} onNav={gotoAdjacentWeek} onCreateWeek={createNewWeek}
            onToggleSunday={toggleExtraSunday} onAutoFill={autoFillCurrentWeek} onClearRefill={clearAndRefillWeek}
            onSetProduct={setProduct} onSetPos={setPos} onAddGeneral={addGeneral} onRemoveGeneral={removeGeneral}
            onAddExtra={addExtra} onRemoveExtra={removeExtra} onClearShift={clearShiftAssignment} onExport={copyExport}
            onShowPreview={() => setShowPreview(true)}
          />
        )}
        {tab === 'employees' && (
          <EmployeesTab employees={employees} weeks={weeks} newEmpForm={newEmpForm} setNewEmpForm={setNewEmpForm}
            onAdd={addEmployee} onToggleActive={toggleActive} onUpdateMax={updateWeeklyMax} onRemoveHard={removeEmployeeHard} onRename={renameEmployee}
            onUpdateRoles={updateEmployeeRoles} onResetDefaults={resetToDefaultLimits}
            adminPin={adminPin} onChangeAdminPin={changeAdminPin} onResetPin={resetEmployeePin} />
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
