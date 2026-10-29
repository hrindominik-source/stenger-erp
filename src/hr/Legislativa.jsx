// Revize a sledovani legislativy (migracia 74, balik H) - len jednatel.
// Polrocna revizia k 1. 1. a 1. 7., revizia sablon/textov k ich datumu,
// strazca zmien zakonnika prace (zdroj e-Sbirka, predvolene vypnuty).
// Nic sa nemeni automaticky - len upozornenie.
import React, { useState, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "../supabaseClient.js";

const fmtDate = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join(".") : "—");
const fmtTs = (t) => (t ? new Date(t).toLocaleString("cs-CZ") : "—");

export default function Legislativa() {
  const [items, setItems] = useState([]);
  const [watch, setWatch] = useState(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(null); // { period, note }
  const [editing, setEditing] = useState(null); // { source_url, enabled }
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    await supabase.rpc("hr_revision_notify"); // idempotentne: upozornenia na revizie
    const [itRes, wRes] = await Promise.all([
      supabase.rpc("hr_revision_due_list"),
      supabase.from("hr_legislation_watch").select("*").eq("id", "ZP_262_2006").maybeSingle(),
    ]);
    if (itRes.error || wRes.error) { setError("Revize se nepodařilo načíst."); return; }
    setItems(itRes.data || []);
    setWatch(wRes.data);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function confirm(e) {
    e.preventDefault();
    const { error: err } = await supabase.rpc("hr_revision_confirm", { p_period: confirming.period, p_note: confirming.note });
    if (err) { setError(err.message); return; }
    setConfirming(null); setError(""); load();
  }
  async function saveWatch(e) {
    e.preventDefault();
    const url = editing.source_url.trim() || null;
    const { error: err } = await supabase.from("hr_legislation_watch").update({ source_url: url, enabled: !!url && editing.enabled }).eq("id", "ZP_262_2006");
    if (err) { setError(err.code === "23514" ? "Zdroj musí být adresa https na e-Sbírce (e-sbirka.gov.cz)." : "Uložení se nezdařilo."); return; }
    setEditing(null); setError(""); load();
  }
  async function checkNow() {
    setChecking(true); setError("");
    const { error: fnErr } = await supabase.functions.invoke("hr-legislativa", { body: { action: "check" } });
    if (fnErr) {
      let message = "Kontrola se nezdařila.";
      try { message = (await fnErr.context.json()).error || message; } catch { /* bez JSON */ }
      setError(message);
    }
    setChecking(false); load();
  }

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden" data-testid="revisions">
      <div className="px-4 py-2.5 border-b border-slate-100 font-semibold text-sm">Revize a změny zákoníku práce</div>
      {error && <div className="mx-4 mt-2 bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md">{error}</div>}
      {items.length === 0
        ? <div className="px-4 py-2.5 text-sm text-slate-400">Žádná revize nečeká.</div>
        : <div className="divide-y divide-slate-100">{items.map((i) => (
            <div key={`${i.kind}-${i.entity_id}`} className="px-4 py-2 text-sm flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="revision-item">
              <span className="flex-1 min-w-60">{i.label}</span>
              <span className={i.due_date < new Date().toISOString().slice(0, 10) ? "text-red-700" : "text-slate-500"}>do {fmtDate(i.due_date)}</span>
              {i.kind === "SEMIANNUAL" && (
                <button type="button" className="text-xs text-teal-700 underline" onClick={() => setConfirming({ period: i.entity_id, note: "" })}>Potvrdit revizi</button>
              )}
              {i.kind !== "SEMIANNUAL" && <span className="text-xs text-slate-400">nový termín revize se zadá při schválení šablony / textu</span>}
              {confirming?.period === i.entity_id && i.kind === "SEMIANNUAL" && (
                <form onSubmit={confirm} className="w-full flex flex-wrap gap-2" data-testid="revision-confirm-form">
                  <input aria-label="Co bylo zkontrolováno" value={confirming.note} onChange={(e) => setConfirming((c) => ({ ...c, note: e.target.value }))}
                    placeholder="Co bylo zkontrolováno (šablony, texty, zákonné parametry…)" className="border border-slate-300 rounded-md px-2 py-1 text-sm flex-1 min-w-60" />
                  <button type="submit" className="text-xs bg-teal-700 text-white px-3 py-1.5 rounded-md">Potvrdit</button>
                  <button type="button" onClick={() => setConfirming(null)} className="text-xs text-slate-500">Zpět</button>
                </form>
              )}
            </div>
          ))}</div>}
      {watch && (
        <div className="px-4 py-2.5 border-t border-slate-100 text-sm space-y-1" data-testid="legislation-watch">
          <div className="font-medium">{watch.act_label} – sledování změn v e-Sbírce</div>
          <div className="text-xs text-slate-600">
            {!watch.enabled ? "Vypnuto – zdroj zatím nebyl ověřen (viz návrh v dokumentaci)." : `Zdroj: ${watch.source_url}`}
            {watch.last_checked_at && <> · poslední kontrola {fmtTs(watch.last_checked_at)}</>}
            {watch.last_changed_at && <> · poslední změna {fmtTs(watch.last_changed_at)}</>}
            {watch.last_error && <span className="text-red-700"> · chyba: {watch.last_error}</span>}
          </div>
          <div className="text-xs text-slate-400">Při změně přijde upozornění; šablony, texty ani parametry se nemění automaticky. Odtisk zdroje nerozliší, co se změnilo – posoudí právnička.</div>
          {!editing ? (
            <div className="flex gap-3">
              <button type="button" className="text-xs text-teal-700 underline" onClick={() => setEditing({ source_url: watch.source_url || "", enabled: watch.enabled })}>Nastavit zdroj</button>
              <button type="button" disabled={checking} className="text-xs text-teal-700 underline disabled:opacity-50 flex items-center gap-1" onClick={checkNow}>
                {checking && <Loader2 size={12} className="animate-spin" />} Zkontrolovat nyní
              </button>
            </div>
          ) : (
            <form onSubmit={saveWatch} className="flex flex-wrap items-center gap-2" data-testid="legislation-watch-form">
              <input aria-label="Zdroj (e-Sbírka)" value={editing.source_url} onChange={(e) => setEditing((x) => ({ ...x, source_url: e.target.value }))}
                placeholder="https://e-sbirka.gov.cz/…" className="border border-slate-300 rounded-md px-2 py-1 text-sm flex-1 min-w-60" />
              <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={editing.enabled} onChange={(e) => setEditing((x) => ({ ...x, enabled: e.target.checked }))} /> Zapnuto</label>
              <button type="submit" className="text-xs bg-teal-700 text-white px-3 py-1.5 rounded-md">Uložit</button>
              <button type="button" onClick={() => setEditing(null)} className="text-xs text-slate-500">Zpět</button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
