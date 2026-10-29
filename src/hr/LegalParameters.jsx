// Zakonne parametre (migracia 70, balik D): hodnota, platnost od, zdroj.
// Meni len jednatel - kazda zmena = audit + upozornenie. Nova hodnota k inemu
// datu = nova platnost (stara ostava pre dokumenty z minulosti).
import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabaseClient.js";

const fmtDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("cs-CZ") : "");
const fmtValue = (p) => (p.value !== null && p.value !== undefined ? `${String(p.value).replace(".", ",")} ${p.unit || ""}`.trim() : p.value_text || "");

export default function LegalParameters({ canEdit }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // { key, label, unit, value, valid_from, source, note, replaceId }

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.from("hr_legal_parameters").select("*").order("key").order("valid_from", { ascending: false, nullsFirst: false });
    if (e) { setError("Parametry se nepodařilo načíst."); return; }
    setRows(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const keys = [...new Set(rows.map((r) => r.key))];
  const byKey = (k) => rows.filter((r) => r.key === k);

  async function save(e) {
    e.preventDefault();
    const f = editing;
    const isText = f.textOnly;
    const value = isText ? null : Number(String(f.value).replace(",", "."));
    if (!isText && (f.value === "" || !Number.isFinite(value))) { setError("Zadejte číselnou hodnotu."); return; }
    if (isText && !String(f.value).trim()) { setError("Zadejte znění pravidla."); return; }
    if (!f.source.trim()) { setError("Uveďte zdroj (předpis, paragraf, MPSV…)."); return; }
    const payload = {
      key: f.key, label: f.label, unit: f.unit, value, value_text: isText ? String(f.value).trim() : null,
      valid_from: f.valid_from || null, source: f.source.trim(), note: f.note.trim() || null,
    };
    // prazdny riadok bez platnosti sa doplni, inak vznikne nova platnost
    const { error: e2 } = f.replaceId
      ? await supabase.from("hr_legal_parameters").update(payload).eq("id", f.replaceId)
      : await supabase.from("hr_legal_parameters").insert(payload);
    if (e2) { setError(e2.code === "23505" ? "Pro toto datum platnosti už hodnota existuje." : "Uložení se nezdařilo."); return; }
    setEditing(null);
    setError("");
    load();
  }

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-x-auto" data-testid="legal-parameters">
      <div className="px-4 py-2.5 border-b border-slate-100 font-semibold text-sm">Zákonné parametry (kontroly smluv)</div>
      {error && <div className="mx-4 mt-2 bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md">{error}</div>}
      <table className="w-full text-sm">
        <thead className="text-xs text-slate-500 text-left">
          <tr><th className="px-4 py-1.5">Parametr</th><th className="px-4 py-1.5">Hodnota</th><th className="px-4 py-1.5">Platí od</th><th className="px-4 py-1.5">Zdroj</th><th className="px-4 py-1.5" /></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {keys.map((k) => {
            const versions = byKey(k);
            const current = versions[0];
            const empty = versions.every((v) => v.value === null && !v.value_text);
            return (
              <React.Fragment key={k}>
                {versions.map((p, i) => (
                  <tr key={p.id} data-testid="legal-param-row" className={i > 0 ? "text-slate-400" : empty ? "bg-amber-50" : ""}>
                    <td className="px-4 py-1.5">{i === 0 ? p.label : ""}</td>
                    <td className="px-4 py-1.5">{empty ? <span className="text-amber-800">nevyplněno</span> : fmtValue(p)}</td>
                    <td className="px-4 py-1.5">{p.valid_from ? fmtDate(p.valid_from) : (empty ? "" : "neuvedeno")}</td>
                    <td className="px-4 py-1.5 text-xs">{p.source || ""}</td>
                    <td className="px-4 py-1.5 text-right">
                      {canEdit && i === 0 && (
                        <button type="button" className="text-xs text-teal-700 hover:text-teal-900 underline"
                          onClick={() => setEditing({
                            key: k, label: current.label, unit: current.unit, textOnly: current.unit === "pravidlo",
                            value: "", valid_from: "", source: current.source || "", note: "",
                            replaceId: empty && !current.valid_from ? current.id : null,
                          })}>
                          {empty ? "Doplnit" : "Nová hodnota"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {editing?.key === k && (
                  <tr><td colSpan={5} className="px-4 py-2 bg-slate-50">
                    <form onSubmit={save} className="flex flex-wrap items-end gap-2 text-sm" data-testid="legal-param-form">
                      <label className="flex flex-col text-xs text-slate-500">{editing.textOnly ? "Znění" : `Hodnota (${editing.unit || ""})`}
                        <input aria-label="Hodnota parametru" value={editing.value} onChange={(e) => setEditing((x) => ({ ...x, value: e.target.value }))} className="border border-slate-300 rounded-md px-2 py-1 text-sm w-40" />
                      </label>
                      <label className="flex flex-col text-xs text-slate-500">Platí od
                        <input type="date" aria-label="Platí od" value={editing.valid_from} onChange={(e) => setEditing((x) => ({ ...x, valid_from: e.target.value }))} className="border border-slate-300 rounded-md px-2 py-1 text-sm" />
                      </label>
                      <label className="flex flex-col text-xs text-slate-500 flex-1 min-w-48">Zdroj (povinný)
                        <input aria-label="Zdroj parametru" value={editing.source} onChange={(e) => setEditing((x) => ({ ...x, source: e.target.value }))} className="border border-slate-300 rounded-md px-2 py-1 text-sm" />
                      </label>
                      <button type="submit" className="bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium px-3 py-1.5 rounded-md">Uložit</button>
                      <button type="button" onClick={() => { setEditing(null); setError(""); }} className="text-xs text-slate-500">Zpět</button>
                    </form>
                  </td></tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      <div className="px-4 py-2 text-xs text-slate-400">Hodnoty se nevymýšlejí – nevyplněné parametry doplní jednatel podle právničky a mzdové účetní. Každá změna se zapíše do historie a upozornění.</div>
    </section>
  );
}
