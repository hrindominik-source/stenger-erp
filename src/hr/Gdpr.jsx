// GDPR (migracia 72, balik F): lehoty uchovavania, spracovatelia, pripomienky,
// export udajov zamestnanca (ZIP) a anonymizacia so schvalenim jednatela.
// Hodnoty lehot sa nevymyslaju - vyplni ich jednatel podla pravnicky.
import React, { useState, useEffect, useCallback } from "react";
import PizZip from "pizzip";
import { Download, EyeOff, Loader2 } from "lucide-react";
import { supabase } from "../supabaseClient.js";
import { useApprovalState, ApprovalBox } from "./ApprovalRequest.jsx";
import { exportFilePaths } from "../lib/hr/gdprExport.js";

const BUCKET = "hr-dokumenty";
const PERIOD_FROM_LABELS = { KONEC_POMERU: "od skončení pracovního poměru", VZNIK_ZAZNAMU: "od vzniku záznamu" };
const ACTION_LABELS = { ARCHIVOVAT: "archivovat", ANONYMIZOVAT: "anonymizovat", SKARTOVAT: "skartovat" };
const DPA_LABELS = { NEOVERENO: "neověřeno", UZAVRENA: "smlouva uzavřena", NEPOTREBNA: "smlouva není potřeba" };
const fmtDate = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join(".") : "");

export function RetentionRules({ canEdit }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const load = useCallback(async () => {
    const { data, error: e } = await supabase.from("hr_retention_rules").select("*").order("key");
    if (e) { setError("Lhůty se nepodařilo načíst."); return; }
    setRows(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(e) {
    e.preventDefault();
    const years = Number(String(editing.period_years).replace(",", "."));
    if (!Number.isFinite(years) || years <= 0) { setError("Zadejte počet let."); return; }
    if (!editing.period_from || !editing.action) { setError("Vyberte, od kdy se lhůta počítá a co se po ní stane."); return; }
    if (!editing.source.trim()) { setError("Uveďte zdroj (předpis, stanovisko právničky…)."); return; }
    const { error: e2 } = await supabase.from("hr_retention_rules").update({
      period_years: years, period_from: editing.period_from, action: editing.action, source: editing.source.trim(), note: editing.note.trim() || null,
    }).eq("id", editing.id);
    if (e2) { setError("Uložení se nezdařilo."); return; }
    setEditing(null); setError(""); load();
  }

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-x-auto" data-testid="retention-rules">
      <div className="px-4 py-2.5 border-b border-slate-100 font-semibold text-sm">Lhůty uchovávání (GDPR)</div>
      {error && <div className="mx-4 mt-2 bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md">{error}</div>}
      <table className="w-full text-sm">
        <thead className="text-xs text-slate-500 text-left">
          <tr><th className="px-4 py-1.5">Kategorie</th><th className="px-4 py-1.5">Lhůta</th><th className="px-4 py-1.5">Potom</th><th className="px-4 py-1.5">Zdroj</th><th className="px-4 py-1.5" /></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <React.Fragment key={r.id}>
              <tr data-testid="retention-row" className={r.period_years == null ? "bg-amber-50" : ""}>
                <td className="px-4 py-1.5">{r.label}<div className="text-xs text-slate-400">{r.scope}</div></td>
                <td className="px-4 py-1.5">{r.period_years == null ? <span className="text-amber-800">nevyplněno</span> : `${String(r.period_years).replace(".", ",")} let ${PERIOD_FROM_LABELS[r.period_from] || ""}`}</td>
                <td className="px-4 py-1.5">{ACTION_LABELS[r.action] || ""}</td>
                <td className="px-4 py-1.5 text-xs">{r.source || ""}</td>
                <td className="px-4 py-1.5 text-right">
                  {canEdit && (
                    <button type="button" className="text-xs text-teal-700 underline" onClick={() => setEditing({
                      id: r.id, period_years: r.period_years ?? "", period_from: r.period_from || "", action: r.action || "", source: r.source || "", note: r.note || "",
                    })}>{r.period_years == null ? "Doplnit" : "Změnit"}</button>
                  )}
                </td>
              </tr>
              {editing?.id === r.id && (
                <tr><td colSpan={5} className="px-4 py-2 bg-slate-50">
                  <form onSubmit={save} className="flex flex-wrap items-end gap-2 text-sm" data-testid="retention-form">
                    <label className="flex flex-col text-xs text-slate-500">Počet let
                      <input aria-label="Počet let" value={editing.period_years} onChange={(e) => setEditing((x) => ({ ...x, period_years: e.target.value }))} className="border border-slate-300 rounded-md px-2 py-1 text-sm w-20" />
                    </label>
                    <label className="flex flex-col text-xs text-slate-500">Počítá se
                      <select aria-label="Počítá se" value={editing.period_from} onChange={(e) => setEditing((x) => ({ ...x, period_from: e.target.value }))} className="border border-slate-300 rounded-md px-2 py-1 text-sm">
                        <option value="">—</option>
                        {Object.entries(PERIOD_FROM_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col text-xs text-slate-500">Potom
                      <select aria-label="Co potom" value={editing.action} onChange={(e) => setEditing((x) => ({ ...x, action: e.target.value }))} className="border border-slate-300 rounded-md px-2 py-1 text-sm">
                        <option value="">—</option>
                        {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col text-xs text-slate-500 flex-1 min-w-48">Zdroj (povinný)
                      <input aria-label="Zdroj lhůty" value={editing.source} onChange={(e) => setEditing((x) => ({ ...x, source: e.target.value }))} className="border border-slate-300 rounded-md px-2 py-1 text-sm" />
                    </label>
                    <button type="submit" className="bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium px-3 py-1.5 rounded-md">Uložit</button>
                    <button type="button" onClick={() => { setEditing(null); setError(""); }} className="text-xs text-slate-500">Zpět</button>
                  </form>
                </td></tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      <div className="px-4 py-2 text-xs text-slate-400">Lhůty se nevymýšlejí – doplní je jednatel podle právničky a mzdové účetní. Anonymizace je možná až po uplynutí všech lhůt.</div>
    </section>
  );
}

export function RetentionDue() {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    supabase.rpc("hr_retention_due").then(({ data }) => setRows(data || []));
  }, []);
  if (!rows || rows.length === 0) return null;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section className="bg-white border border-amber-300 rounded-lg overflow-hidden" data-testid="retention-due">
      <div className="px-4 py-2.5 border-b border-slate-100 font-semibold text-sm">Končí lhůta uchovávání</div>
      <div className="divide-y divide-slate-100">
        {rows.map((r) => (
          <div key={`${r.employee_id}-${r.rule_key}`} className="px-4 py-1.5 text-sm flex flex-wrap gap-x-3">
            <span className="font-medium">{r.employee_name}</span>
            <span className="text-slate-600">{r.rule_label}: {ACTION_LABELS[r.action]}</span>
            <span className={r.due_date <= today ? "text-red-700" : "text-slate-500"}>{r.due_date <= today ? "lhůta uplynula " : "do "}{fmtDate(r.due_date)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Processors() {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const { data, error: e } = await supabase.from("hr_processors").select("*").order("id");
    if (e) { setError("Seznam se nepodařilo načíst."); return; }
    setRows(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  async function save(e) {
    e.preventDefault();
    const { error: e2 } = await supabase.from("hr_processors").update({ dpa_status: editing.dpa_status, region: editing.region.trim() || null, note: editing.note.trim() || null }).eq("id", editing.id);
    if (e2) { setError("Uložení se nezdařilo."); return; }
    setEditing(null); setError(""); load();
  }
  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-x-auto" data-testid="processors">
      <div className="px-4 py-2.5 border-b border-slate-100 font-semibold text-sm">Zpracovatelé osobních údajů (podklad pro záznam o činnostech)</div>
      {error && <div className="mx-4 mt-2 bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md">{error}</div>}
      <table className="w-full text-sm">
        <thead className="text-xs text-slate-500 text-left">
          <tr><th className="px-4 py-1.5">Zpracovatel</th><th className="px-4 py-1.5">Údaje</th><th className="px-4 py-1.5">Smlouva (DPA)</th><th className="px-4 py-1.5">Region / poznámka</th><th className="px-4 py-1.5" /></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <React.Fragment key={r.id}>
              <tr data-testid="processor-row">
                <td className="px-4 py-1.5">{r.name}</td>
                <td className="px-4 py-1.5 text-xs text-slate-600">{r.data_categories}</td>
                <td className={"px-4 py-1.5 text-xs " + (r.dpa_status === "NEOVERENO" ? "text-amber-800" : "")}>{DPA_LABELS[r.dpa_status]}</td>
                <td className="px-4 py-1.5 text-xs text-slate-600">{[r.region, r.note].filter(Boolean).join(" · ")}</td>
                <td className="px-4 py-1.5 text-right">
                  <button type="button" className="text-xs text-teal-700 underline" onClick={() => setEditing({ id: r.id, dpa_status: r.dpa_status, region: r.region || "", note: r.note || "" })}>Upravit</button>
                </td>
              </tr>
              {editing?.id === r.id && (
                <tr><td colSpan={5} className="px-4 py-2 bg-slate-50">
                  <form onSubmit={save} className="flex flex-wrap items-end gap-2 text-sm">
                    <select aria-label="Smlouva (DPA)" value={editing.dpa_status} onChange={(e) => setEditing((x) => ({ ...x, dpa_status: e.target.value }))} className="border border-slate-300 rounded-md px-2 py-1 text-sm">
                      {Object.entries(DPA_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <input aria-label="Region" placeholder="Region" value={editing.region} onChange={(e) => setEditing((x) => ({ ...x, region: e.target.value }))} className="border border-slate-300 rounded-md px-2 py-1 text-sm w-32" />
                    <input aria-label="Poznámka" placeholder="Poznámka" value={editing.note} onChange={(e) => setEditing((x) => ({ ...x, note: e.target.value }))} className="border border-slate-300 rounded-md px-2 py-1 text-sm flex-1 min-w-48" />
                    <button type="submit" className="bg-teal-700 text-white text-xs font-medium px-3 py-1.5 rounded-md">Uložit</button>
                    <button type="button" onClick={() => setEditing(null)} className="text-xs text-slate-500">Zpět</button>
                  </form>
                </td></tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function saveBlobAs(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Export (cl. 15/20 GDPR): udaje + dokumenty do ZIP. Server zapise, kto a kedy.
export function EmployeeExportButton({ employee }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run() {
    setBusy(true); setError("");
    const { data, error: e } = await supabase.rpc("hr_export_employee", { p_employee_id: employee.id });
    if (e) { setError(e.message); setBusy(false); return; }
    const zip = new PizZip();
    zip.file("udaje.json", JSON.stringify(data, null, 2));
    const missing = [];
    for (const p of exportFilePaths(data)) {
      const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(p);
      if (dlErr || !blob) { missing.push(p); continue; }
      zip.file(`soubory/${p.replace(/^zamestnanci\/[^/]+\//, "")}`, await blob.arrayBuffer());
    }
    if (missing.length) zip.file("nenactene-soubory.txt", missing.join("\n"));
    const name = `export-${employee.last_name}-${employee.first_name}-${new Date().toISOString().slice(0, 10)}.zip`;
    saveBlobAs(zip.generate({ type: "blob" }), name);
    setBusy(false);
  }
  return (
    <span className="inline-flex flex-col">
      <button type="button" onClick={run} disabled={busy} data-testid="employee-export"
        className="text-xs border border-slate-300 hover:bg-slate-50 px-2.5 py-1.5 rounded-md flex items-center gap-1 disabled:opacity-50">
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Export údajů (ZIP)
      </button>
      {error && <span className="text-xs text-red-700 mt-1">{error}</span>}
    </span>
  );
}

// Anonymizacia: az po uplynuti vsetkych lehot, so schvalenim jednatela.
export function AnonymizePanel({ employee, isAdmin, onDone }) {
  const [ready, setReady] = useState(null);
  const [key, setKey] = useState(0);
  const [approval, reloadApproval] = useApprovalState("ANONYMIZE", employee.id, key);
  const [form, setForm] = useState(null);
  useEffect(() => {
    supabase.rpc("hr_anonymization_ready", { p_employee_id: employee.id }).then(({ data }) => setReady(data));
  }, [employee.id, key]);
  if (!ready) return null;
  const canRun = ready.ready && (isAdmin || approval?.usable);

  async function run(e) {
    e.preventDefault();
    setForm((f) => ({ ...f, busy: true, error: "" }));
    const { error } = await supabase.rpc("hr_anonymize_employee", { p_employee_id: employee.id, p_reason: form.reason });
    if (error) { setForm((f) => ({ ...f, busy: false, error: error.message })); return; }
    setForm(null); setKey((k) => k + 1); onDone?.();
  }
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 text-sm space-y-2" data-testid="anonymize-panel">
      <div className="font-medium flex items-center gap-1.5"><EyeOff size={15} /> Anonymizace</div>
      {!ready.ready && <div className="text-xs text-slate-500" data-testid="anonymize-not-ready">{ready.reason}</div>}
      {ready.ready && !isAdmin && (
        <ApprovalBox kind="ANONYMIZE" entityId={employee.id} state={approval} title="Anonymizaci schvaluje jednatel."
          onChanged={() => { reloadApproval(); setKey((k) => k + 1); }} />
      )}
      {canRun && !form && (
        <button type="button" onClick={() => setForm({ reason: "", busy: false, error: "" })} className="text-xs bg-red-700 hover:bg-red-800 text-white px-3 py-1.5 rounded-md">Anonymizovat</button>
      )}
      {form && (
        <form onSubmit={run} className="space-y-2">
          <div className="text-xs text-red-800">Smaže osobní, citlivé, mzdové a lékařské údaje v kartě. Nelze vrátit. Dokumenty, soubory a historie změn zůstávají (rozhodne právnička).</div>
          <input aria-label="Důvod anonymizace" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="Důvod" className="border border-slate-300 rounded-md px-2 py-1 text-sm w-full" />
          {form.error && <div className="text-xs text-red-700">{form.error}</div>}
          <div className="flex gap-2">
            <button type="submit" disabled={form.busy} className="text-xs bg-red-700 text-white px-3 py-1.5 rounded-md disabled:opacity-50">Potvrdit anonymizaci</button>
            <button type="button" onClick={() => setForm(null)} className="text-xs text-slate-500">Zpět</button>
          </div>
        </form>
      )}
    </div>
  );
}
