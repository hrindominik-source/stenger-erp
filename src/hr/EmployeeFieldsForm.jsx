import React, { useState } from "react";
import { Lock, ShieldAlert } from "lucide-react";
import {
  EMPLOYEE_SECTIONS, fieldVisibleInMode, isFieldShown, optionLabel, derivePostaveni,
} from "../lib/hr/employeeFields.js";

/* Spolocny renderer udajov zamestnanca (definicia v lib/hr/employeeFields.js).
   Pouziva ho formular "Nový zaměstnanec", uprava v karte (Osobní údaje) aj
   tabletovy dotaznik - kazde pole je definovane len raz. */

// Odvodene predvolby pri zmene pola (postavenie podla typu zmluvy, vznik
// zamestnania = datum nastupu), kym ich HR rucne neprepise na nieco ine.
export function applyFieldChange(values, key, value) {
  const next = { ...values, [key]: value };
  if (key === "employment_type" && values.postaveni === derivePostaveni(values.employment_type)) {
    next.postaveni = derivePostaveni(value);
  }
  if (key === "start_date" && (!values.vznik_zamestnani || values.vznik_zamestnani === values.start_date)) {
    next.vznik_zamestnani = value;
  }
  return next;
}

export function visibleSections({ mode, canSensitive, canPayroll, values, sectionIds }) {
  return EMPLOYEE_SECTIONS
    .filter((s) => !sectionIds || sectionIds.includes(s.id))
    .map((s) => ({
      section: s,
      fields: s.fields
        .map((f) => ({ ...f, tier: f.tier || s.tier || "basic", section: s }))
        .filter((f) => fieldVisibleInMode(f, { mode, canSensitive, canPayroll }) && isFieldShown(f, values)),
    }))
    .filter((x) => x.fields.length > 0);
}

export default function EmployeeFieldsForm({ values, onChange, mode, canSensitive, canPayroll, positions = [], variant = "office", sectionIds }) {
  const big = variant === "kiosk";
  const sections = visibleSections({ mode, canSensitive, canPayroll, values, sectionIds });
  return (
    <div>
      {sections.map(({ section, fields }) => {
        const sensitiveSection = fields.every((f) => f.tier === "sensitive");
        const payrollSection = fields.every((f) => f.tier === "payroll");
        return (
          <div
            key={section.id}
            className={
              (big ? "mb-6" : "rounded-lg p-4 mb-4 border ") +
              (big ? "" : sensitiveSection ? "bg-amber-50 border-amber-200" : payrollSection ? "bg-sky-50/40 border-sky-100" : "bg-white border-slate-200")
            }
          >
            <h2 className={(big ? "text-base font-semibold text-slate-700 mb-3" : "font-semibold text-sm mb-3") + " flex items-center gap-1.5"}>
              {sensitiveSection && !big && <ShieldAlert size={15} className="text-amber-600" />}
              {section.title}
            </h2>
            <div className={"grid grid-cols-1 sm:grid-cols-2 " + (big ? "gap-x-5" : "lg:grid-cols-3 gap-x-4")}>
              {fields.map((f) => (
                <FieldInput key={f.key} field={f} value={values[f.key]} big={big} positions={positions} onChange={(v) => onChange(f.key, v)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FieldInput({ field, value, onChange, big, positions }) {
  const [otherMode, setOtherMode] = useState(false);
  const labelCls = big ? "block text-sm font-medium text-slate-500 mb-1.5" : "block text-xs font-medium text-slate-500 mb-1";
  const inputCls = big ? "w-full border border-slate-300 rounded-lg px-3 py-2.5 text-base" : "w-full border border-slate-300 rounded-md px-3 py-2 text-sm";
  const wrap = big ? "block mb-4" : "block mb-3";
  const wide = field.type === "textarea" || (field.type === "select" && field.options?.some((o) => o.label.length > 60));

  if (field.type === "check") {
    return (
      <label className={(big ? "mb-4 text-base" : "mb-3 text-sm") + " flex items-center gap-2 text-slate-600 sm:col-span-2 lg:col-span-3"}>
        <input type="checkbox" className={big ? "w-5 h-5" : ""} checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {field.label}
      </label>
    );
  }

  if (field.type === "yesno") {
    const btn = (label, v) => (
      <button
        type="button"
        onClick={() => onChange(value === v ? "" : v)}
        className={(big ? "px-5 py-2.5 text-base" : "px-3 py-1.5 text-sm") + " rounded-md border font-medium " + (value === v ? "bg-teal-700 border-teal-700 text-white" : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50")}
      >
        {label}
      </button>
    );
    return (
      <div className={wrap}>
        <span className={labelCls}>{field.label}</span>
        <div className="flex gap-2">{btn("Ano", true)}{btn("Ne", false)}</div>
      </div>
    );
  }

  let control;
  if (field.type === "fixed") {
    control = (
      <div className={inputCls + " bg-slate-100 text-slate-600 flex items-center gap-1.5"}>
        <Lock size={13} className="text-slate-400 shrink-0" /> {field.fixedValue}
      </div>
    );
  } else if (field.type === "textarea") {
    control = <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} rows={3} className={inputCls} />;
  } else if (field.type === "date") {
    control = <input type="date" value={value || ""} onChange={(e) => onChange(e.target.value)} className={inputCls} />;
  } else if (field.type === "position") {
    control = (
      <select value={value || ""} onChange={(e) => onChange(e.target.value)} className={inputCls + " bg-white"}>
        <option value="">— nevybráno —</option>
        {positions.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} – ${p.name}` : p.name}</option>)}
      </select>
    );
  } else if (field.type === "select") {
    const inList = field.options.some((o) => o.value === value);
    if (field.allowOther && (otherMode || (value && !inList))) {
      control = (
        <div className="flex gap-2 items-center">
          <input value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder="Vypište" className={inputCls} autoFocus={otherMode} />
          <button type="button" onClick={() => { setOtherMode(false); onChange(""); }} className="text-xs text-slate-500 underline whitespace-nowrap">ze seznamu</button>
        </div>
      );
    } else {
      control = (
        <select
          value={value || ""}
          onChange={(e) => {
            if (e.target.value === "__other__") { setOtherMode(true); onChange(""); } else onChange(e.target.value);
          }}
          className={inputCls + " bg-white"}
        >
          {!field.noEmpty && <option value="">— vyberte —</option>}
          {field.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          {field.allowOther && <option value="__other__">Jiný (vypsat)…</option>}
        </select>
      );
    }
  } else {
    control = <input value={value || ""} onChange={(e) => onChange(e.target.value)} className={inputCls} />;
  }

  return (
    <label className={wrap + (wide ? " sm:col-span-2 lg:col-span-3" : "")}>
      <span className={labelCls}>{field.label}</span>
      {control}
    </label>
  );
}

// Zobrazenie (len citanie) - vypise len vyplnene polia, po sekciach.
export function formatFieldValue(field, value, positions = []) {
  if (field.type === "fixed") return field.fixedValue;
  if (value === "" || value === null || value === undefined) return null;
  if (field.type === "yesno") return value === true ? "Ano" : value === false ? "Ne" : null;
  if (field.type === "check") return value ? "Ano" : null;
  if (field.type === "date") {
    const [y, m, d] = String(value).split("-");
    return d ? `${Number(d)}.${Number(m)}.${y}` : value;
  }
  if (field.type === "select") return optionLabel(field.options, value);
  if (field.type === "position") {
    const p = positions.find((x) => x.id === value);
    return p ? (p.code ? `${p.code} – ${p.name}` : p.name) : null;
  }
  return String(value);
}

export function EmployeeFieldsView({ values, mode = "edit", canSensitive, canPayroll, positions = [] }) {
  const sections = visibleSections({ mode, canSensitive, canPayroll, values })
    .map(({ section, fields }) => ({ section, rows: fields.map((f) => ({ f, text: formatFieldValue(f, values[f.key], positions) })).filter((r) => r.text) }))
    .filter((s) => s.rows.length > 0);
  return (
    <div className="space-y-3">
      {sections.map(({ section, rows }) => {
        const sensitiveSection = rows.every((r) => r.f.tier === "sensitive");
        return (
          <div key={section.id} className={"rounded-lg p-4 border " + (sensitiveSection ? "bg-amber-50 border-amber-200" : "bg-white border-slate-200")}>
            <h3 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
              {sensitiveSection && <ShieldAlert size={14} className="text-amber-600" />}
              {section.title}
            </h3>
            <dl className="text-sm grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">
              {rows.map(({ f, text }) => (
                <div key={f.key} className="flex justify-between gap-3">
                  <dt className={"text-slate-500 " + (f.tier === "sensitive" && !sensitiveSection ? "flex items-center gap-1" : "")}>
                    {f.tier === "sensitive" && !sensitiveSection && <ShieldAlert size={12} className="text-amber-600" />}
                    {f.label.replace(/ \*$/, "")}
                  </dt>
                  <dd className="text-slate-900 font-medium text-right whitespace-pre-wrap">{text}</dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </div>
  );
}
