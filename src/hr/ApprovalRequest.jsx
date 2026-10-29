// Princip styroch oci (migracia 71, balik E): krok, ktory schvaluje jednatel.
// Stav a vynutenie su v DB (hr_approval_state, triggery) - UI len ukaze, ci
// treba ziadost, a umozni poziadat alebo pouzit nudzovy postup.
import React, { useState, useEffect, useCallback } from "react";
import { ShieldCheck } from "lucide-react";
import { supabase } from "../supabaseClient.js";

export const APPROVAL_STATUS_LABELS = {
  PENDING: "čeká na jednatele",
  APPROVED: "schváleno jednatelem",
  REJECTED: "zamítnuto jednatelem",
  EMERGENCY: "nouzový postup – čeká na dodatečné potvrzení jednatele",
  CONFIRMED: "nouzový postup potvrzen jednatelem",
  REJECTED_AFTER: "nouzový postup jednatel dodatečně odmítl",
  CANCELLED: "žádost stažena",
};

export function useApprovalState(kind, entityId, refreshKey) {
  const [state, setState] = useState(null);
  const load = useCallback(async () => {
    if (!entityId) { setState(null); return; }
    const { data, error } = await supabase.rpc("hr_approval_state", { p_kind: kind, p_entity_id: entityId });
    setState(error ? null : data);
  }, [kind, entityId]);
  useEffect(() => { load(); }, [load, refreshKey]);
  return [state, load];
}

// state = vysledok hr_approval_state; payload = napr. { codes } pri vynimke
export function ApprovalBox({ kind, entityId, state, payload, title, onChanged }) {
  const [form, setForm] = useState(null); // { reason, emergency, info, busy, error }
  if (!state?.needed || state.usable) return null;
  const last = state.last;
  const waiting = last?.status === "PENDING";

  async function submit(e) {
    e.preventDefault();
    setForm((f) => ({ ...f, busy: true, error: "" }));
    const { error } = await supabase.rpc("hr_request_approval", {
      p_kind: kind, p_entity_id: entityId, p_reason: form.reason, p_payload: payload || {},
      p_emergency: form.emergency, p_emergency_info: form.emergency ? form.info : null,
    });
    if (error) { setForm((f) => ({ ...f, busy: false, error: error.message })); return; }
    setForm(null);
    onChanged?.();
  }
  async function cancel() {
    const { error } = await supabase.rpc("hr_cancel_approval", { p_id: last.id });
    if (!error) onChanged?.();
  }

  return (
    <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm space-y-2 max-w-xl" data-testid="approval-box">
      <div className="font-medium text-amber-900 flex items-center gap-1.5"><ShieldCheck size={15} /> {title}</div>
      {last && !last.consumed && (
        <div className="text-xs text-amber-900" data-testid="approval-status">
          Poslední žádost: {APPROVAL_STATUS_LABELS[last.status] || last.status}{last.decision_note ? ` – ${last.decision_note}` : ""}
          {waiting && last.mine && <button type="button" onClick={cancel} className="ml-2 underline text-slate-600">Stáhnout žádost</button>}
        </div>
      )}
      {!waiting && !form && (
        <button type="button" onClick={() => setForm({ reason: "", emergency: false, info: "", busy: false, error: "" })}
          className="bg-amber-700 hover:bg-amber-800 text-white text-xs font-medium px-3 py-1.5 rounded-md">Požádat jednatele o schválení</button>
      )}
      {form && (
        <form onSubmit={submit} className="space-y-2" data-testid="approval-request-form">
          <label className="block text-xs text-slate-600">Důvod
            <textarea aria-label="Důvod žádosti" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1 text-sm" rows={2} />
          </label>
          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input type="checkbox" checked={form.emergency} onChange={(e) => setForm((f) => ({ ...f, emergency: e.target.checked }))} className="mt-0.5" />
            <span>Nouzový postup – krok nesnese odklad; provede se hned a jednatel ho musí dodatečně potvrdit.</span>
          </label>
          {form.emergency && (
            <label className="block text-xs text-slate-600">Jak a kdy jste jednatele informovali
              <input aria-label="Jak byl jednatel informován" value={form.info} onChange={(e) => setForm((f) => ({ ...f, info: e.target.value }))}
                className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1 text-sm" />
            </label>
          )}
          {form.error && <div className="text-xs text-red-700">{form.error}</div>}
          <div className="flex gap-2">
            <button type="submit" disabled={form.busy} className="bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-md">
              {form.emergency ? "Použít nouzový postup" : "Odeslat žádost"}
            </button>
            <button type="button" onClick={() => setForm(null)} className="text-xs text-slate-500">Zpět</button>
          </div>
        </form>
      )}
    </div>
  );
}
