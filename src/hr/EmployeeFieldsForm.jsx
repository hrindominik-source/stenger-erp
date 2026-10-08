import React, { useState } from "react";
import { Lock, ShieldAlert, Plus, Trash2, Paperclip, X, Info } from "lucide-react";
import {
  EMPLOYEE_SECTIONS, fieldVisibleInMode, isFieldShown, optionLabel, derivePostaveni,
  addChild, removeChild, MAX_CHILDREN, JMHZ_PDF_CHILDREN,
  POSITION_CATEGORIES, positionNameOptions, positionNameForGender,
} from "../lib/hr/employeeFields.js";

/* Spolocny renderer udajov zamestnanca (definicia v lib/hr/employeeFields.js).
   Pouziva ho formular "Nový zaměstnanec", uprava v karte (Osobní údaje) aj
   tabletovy dotaznik - kazde pole je definovane len raz. */

// Odvodene predvolby pri zmene pola (postavenie podla typu zmluvy, vznik
// zamestnania = datum nastupu), kym ich HR rucne neprepise na nieco ine.
export function applyFieldChange(values, key, value) {
  // Specialne akcie (deti) - aby rodicia nemuseli poznat nic okrem onChange.
  if (key === "__add_child") return addChild(values);
  if (key === "__remove_child") return removeChild(values, value);
  const next = { ...values, [key]: value };
  if (key === "employment_type" && values.postaveni === derivePostaveni(values.employment_type)) {
    next.postaveni = derivePostaveni(value);
  }
  if (key === "start_date" && (!values.vznik_zamestnani || values.vznik_zamestnani === values.start_date)) {
    next.vznik_zamestnani = value;
  }
  if (key === "start_date" && (!values.mzda_platnost_od || values.mzda_platnost_od === values.start_date)) {
    next.mzda_platnost_od = value;
  }
  if (key === "pozice_kategorie") {
    // Nazov z inej kategorie neplati - predvyplni prvy podla pohlavia.
    const names = positionNameOptions(value, values.gender).map((o) => o.value);
    if (!names.includes(values.nazev_pozice)) next.nazev_pozice = values.gender ? (names[0] || "") : "";
    // CZ-ISCO profese podla kategorie, kym ju HR nezmenil rucne.
    const prevCat = POSITION_CATEGORIES.find((c) => c.code === values.pozice_kategorie);
    const cat = POSITION_CATEGORIES.find((c) => c.code === value);
    if (cat && (!values.profese || values.profese === prevCat?.profese || values.profese === "81830")) next.profese = cat.profese;
    // THP (HI-003) maju smluvnu zakladnu mzdu, ostatni hodinovu.
    if (!values.mzda_castka) next.mzda_typ = value === "HI-003" ? "smluvni" : "hodinova";
  }
  if (key === "gender" && values.nazev_pozice) {
    next.nazev_pozice = positionNameForGender(values.nazev_pozice, value);
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
    .filter((x) => x.fields.length > 0 || (x.section.control && sectionTierAllowed(x.section, { mode, canSensitive, canPayroll })));
}

function sectionTierAllowed(section, { canSensitive, canPayroll }) {
  if (section.tier === "sensitive") return !!canSensitive;
  if (section.tier === "payroll") return !!canPayroll;
  return true;
}

export default function EmployeeFieldsForm({ values, onChange, mode, canSensitive, canPayroll, positions = [], variant = "office", sectionIds, hints = {}, onOpenFile, renderCustom }) {
  const big = variant === "kiosk";
  const sections = visibleSections({ mode, canSensitive, canPayroll, values, sectionIds });
  // Kategoria HI-00x -> zodpovedajuca pozicia zo zoznamu pozicii (podla kodu).
  const normCode = (c) => String(c || "").toUpperCase().replace(/L/g, "I").replace(/\s/g, "");
  function handleChange(key, value) {
    onChange(key, value);
    if (key === "pozice_kategorie" && mode === "create") {
      const pos = positions.find((p) => normCode(p.code) === normCode(value));
      if (pos) onChange("position_id", pos.id);
    }
  }
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
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className={(big ? "text-base font-semibold text-slate-700" : "font-semibold text-sm") + " flex items-center gap-1.5"}>
                {sensitiveSection && !big && <ShieldAlert size={15} className="text-amber-600" />}
                {section.title}
              </h2>
              {section.childIndex && (
                <button type="button" onClick={() => onChange("__remove_child", section.childIndex)} className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700">
                  <Trash2 size={13} /> Odebrat dítě
                </button>
              )}
            </div>
            {section.control === "children" && <ChildrenControl count={Number(values.deti_pocet || 0)} big={big} onAdd={() => onChange("__add_child", true)} />}
            {fields.length > 0 && (
              <div className={"grid grid-cols-1 sm:grid-cols-2 " + (big ? "gap-x-5" : "lg:grid-cols-3 gap-x-4")}>
                {fields.map((f) => (
                  f.type === "custom" ? (
                    <div key={f.key} className="sm:col-span-2 lg:col-span-3">{renderCustom ? renderCustom(f, values, handleChange) : null}</div>
                  ) : f.type === "file" ? (
                    <FileField key={f.key} field={f} prilohy={values.prilohy || []} onChange={(list) => handleChange("prilohy", list)} onOpenFile={onOpenFile} />
                  ) : (
                    <FieldInput key={f.key} field={f} value={values[f.key]} values={values} big={big} positions={positions} hint={hints[f.key]} onChange={(v) => handleChange(f.key, v)} />
                  )
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ChildrenControl({ count, big, onAdd }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className={big ? "text-base text-slate-600" : "text-sm text-slate-600"}>Počet dětí: <strong>{count}</strong></span>
      {count < MAX_CHILDREN && (
        <button type="button" onClick={onAdd} className={(big ? "px-4 py-2.5 text-base" : "px-3 py-1.5 text-sm") + " flex items-center gap-1.5 rounded-md border border-teal-600 text-teal-700 hover:bg-teal-50 font-medium"}>
          <Plus size={big ? 18 : 15} /> Přidat dítě
        </button>
      )}
      {count > JMHZ_PDF_CHILDREN && (
        <span className="text-xs text-amber-700">JMHZ dotazník má místo jen pro {JMHZ_PDF_CHILDREN} děti - další je třeba uvést zvlášť.</span>
      )}
    </div>
  );
}

// Prilohy (PDF/sken) - drzane vo values.prilohy ako [{id, kind, name, path?,
// file?}]. Bez `path` = este nenahrate (nahra ich rodic pri ulozeni).
function FileField({ field, prilohy, onChange, onOpenFile }) {
  const mine = prilohy.filter((p) => p.kind === field.kind);
  function addFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    const added = files.map((file) => ({ id: crypto.randomUUID(), kind: field.kind, name: file.name, size: file.size, file }));
    onChange([...prilohy, ...added]);
  }
  return (
    <div className="mb-3 sm:col-span-2 lg:col-span-3">
      <span className="block text-xs font-medium text-slate-500 mb-1">{field.label}</span>
      <div className="flex flex-wrap items-center gap-2">
        {mine.map((p) => (
          <span key={p.id} className="flex items-center gap-1.5 text-xs bg-slate-100 border border-slate-200 rounded-md pl-2 pr-1 py-1">
            <Paperclip size={12} className="text-slate-400" />
            {p.path && onOpenFile ? (
              <button type="button" onClick={() => onOpenFile(p.path)} className="text-teal-700 hover:underline max-w-[220px] truncate">{p.name}</button>
            ) : (
              <span className="max-w-[220px] truncate">{p.name}</span>
            )}
            {!p.path && <span className="text-amber-600">(nahraje se při uložení)</span>}
            <button type="button" onClick={() => onChange(prilohy.filter((x) => x.id !== p.id))} className="text-slate-400 hover:text-red-600 p-0.5" title="Odebrat"><X size={12} /></button>
          </span>
        ))}
        <label className="flex items-center gap-1 text-xs text-teal-700 hover:text-teal-900 cursor-pointer border border-dashed border-teal-300 rounded-md px-2 py-1">
          <Plus size={12} /> Přiložit soubor
          <input type="file" accept=".pdf,image/*" multiple onChange={addFiles} className="hidden" />
        </label>
      </div>
    </div>
  );
}

function FieldInput({ field, value, values = {}, onChange, big, positions, hint }) {
  const options = field.optionsFn ? field.optionsFn(values) : field.options;
  const [otherMode, setOtherMode] = useState(false);
  const labelCls = big ? "block text-sm font-medium text-slate-500 mb-1.5" : "block text-xs font-medium text-slate-500 mb-1";
  const inputCls = big ? "w-full border border-slate-300 rounded-lg px-3 py-2.5 text-base" : "w-full border border-slate-300 rounded-md px-3 py-2 text-sm";
  const wrap = big ? "block mb-4" : "block mb-3";
  const wide = field.type === "textarea" || (field.type === "select" && options?.some((o) => o.label.length > 60));

  if (field.type === "hidden") return null;

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
    const inList = options.some((o) => o.value === value);
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
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          {field.allowOther && <option value="__other__">Jiný (vypsat)…</option>}
        </select>
      );
    }
  } else {
    control = <input value={value || ""} onChange={(e) => onChange(e.target.value)} className={inputCls} />;
  }

  return (
    <label className={wrap + (wide ? " sm:col-span-2 lg:col-span-3" : "") + (field.rowStart ? " sm:col-start-1" : "")}>
      <span className={labelCls + " flex items-center gap-1"}>
        {field.labelFn ? field.labelFn(values) : field.label}
        {field.info && (
          <span title={field.info} className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-slate-400 text-slate-500 cursor-help">
            <Info size={10} />
          </span>
        )}
      </span>
      {control}
      {field.helpFn && field.helpFn(value) && <span className="block text-xs text-slate-400 mt-1">{field.helpFn(value)}</span>}
      {field.info && <span className="block text-xs text-slate-400 mt-1">{field.info}</span>}
      {hint && !value && (
        <button type="button" onClick={(e) => { e.preventDefault(); onChange(hint.value); }} className="text-xs text-teal-700 hover:underline mt-1">
          {hint.text}
        </button>
      )}
    </label>
  );
}

// Zobrazenie (len citanie) - vypise len vyplnene polia, po sekciach.
export function formatFieldValue(field, value, positions = [], values = {}) {
  if (field.type === "fixed") return field.fixedValue;
  if (field.type === "file") {
    const names = (values.prilohy || []).filter((p) => p.kind === field.kind && p.path).map((p) => p.name);
    return names.length ? names.join(", ") : null;
  }
  if (value === "" || value === null || value === undefined) return null;
  if (field.type === "yesno") return value === true ? "Ano" : value === false ? "Ne" : null;
  if (field.type === "check") return value ? "Ano" : null;
  if (field.type === "date") {
    const [y, m, d] = String(value).split("-");
    return d ? `${Number(d)}.${Number(m)}.${y}` : value;
  }
  if (field.type === "hidden" || field.type === "custom") return null;
  if (field.type === "select") {
    const opts = field.optionsFn ? field.optionsFn(values) : field.options;
    return opts ? optionLabel(opts, value) : String(value);
  }
  if (field.type === "position") {
    const p = positions.find((x) => x.id === value);
    return p ? (p.code ? `${p.code} – ${p.name}` : p.name) : null;
  }
  return String(value);
}

export function EmployeeFieldsView({ values, mode = "edit", canSensitive, canPayroll, positions = [] }) {
  const sections = visibleSections({ mode, canSensitive, canPayroll, values })
    .map(({ section, fields }) => ({ section, rows: fields.map((f) => ({ f, text: formatFieldValue(f, values[f.key], positions, values) })).filter((r) => r.text) }))
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
                    {(f.labelFn ? f.labelFn(values) : f.label).replace(/ \*$/, "")}
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
