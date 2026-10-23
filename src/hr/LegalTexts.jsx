// Faza I: texty prohlaseni, pouceni a projevu vule (hr_legal_text_versions).
// Zmena textu = nova verze (DB: hr_legal_texts_guard - text verze je
// nemenny); podepsane dokumenty zustavaji vazane na verzi, kterou obsahuji.
// Aktualni = nejnovejsi nevyrazena verze (hr_current_legal_text).
// Upravy jen s HR_LEGAL_TEXTS_ADMIN (RLS).
import React, { useState, useEffect, useCallback } from "react";
import { ChevronDown, ChevronRight, FilePlus2 } from "lucide-react";
import { supabase } from "../supabaseClient.js";

export const LEGAL_TEXT_LABELS = {
  S21_ADDRESS_NOTICE: "Oznámení elektronické adresy (§ 21)",
  S335_NOTICE: "Poučení o elektronickém doručování (§ 335)",
  S335_CONSENT: "Souhlas s elektronickým doručováním (§ 335)",
  S335_REVOCATION: "Odvolání souhlasu (§ 335)",
  RECEIPT_CONFIRMATION: "Potvrzení o převzetí písemnosti",
  INTENT_BILATERAL_CONTRACT: "Projev vůle – smlouva",
  INTENT_EMPLOYEE_DECLARATION: "Projev vůle – prohlášení zaměstnance",
  INTENT_EMPLOYER_SIGNATURE: "Projev vůle – za zaměstnavatele",
  INTENT_RECEIPT_ACKNOWLEDGEMENT: "Projev vůle – převzetí",
  INTENT_TRAINING_RECORD: "Projev vůle – záznam o školení",
  INTENT_QUESTIONNAIRE: "Prohlášení k osobnímu dotazníku",
};
const STATUS = { KONCEPT: "koncept – ke schválení právničkou", SCHVALENO: "schváleno", VYRAZENO: "vyřazeno" };
const STATUS_CLS = { KONCEPT: "bg-amber-50 text-amber-800", SCHVALENO: "bg-emerald-50 text-emerald-800", VYRAZENO: "bg-slate-100 text-slate-500" };
const fmtTs = (iso) => (iso ? new Date(iso).toLocaleString("cs-CZ") : "");

export default function LegalTextsSection({ canEdit }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(null); // text_key
  const [editing, setEditing] = useState(null); // { key, title, body }
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const { data, error: err } = await supabase.from("hr_legal_text_versions").select("*").order("text_key").order("version_no", { ascending: false });
    if (err) setError("Nepodařilo se načíst texty.");
    setRows(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const keys = [...new Set(rows.map((r) => r.text_key))];
  async function saveVersion() {
    const versions = rows.filter((r) => r.text_key === editing.key);
    const next = Math.max(0, ...versions.map((r) => r.version_no)) + 1;
    setBusy(true);
    setError("");
    const { error: err } = await supabase.from("hr_legal_text_versions").insert({
      id: `lt-${editing.key.toLowerCase().replaceAll("_", "-")}-v${next}-${Date.now().toString(36)}`,
      text_key: editing.key, version_no: next, title: editing.title.trim(), body: editing.body.trim(), body_sha256: "x",
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setEditing(null);
    load();
  }
  async function setStatus(row, status) {
    setError("");
    const { error: err } = await supabase.from("hr_legal_text_versions").update({ status }).eq("id", row.id);
    if (err) setError(err.message);
    load();
  }

  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold mb-1">Texty prohlášení a poučení</h2>
      <div className="text-xs text-slate-500 mb-3">
        Změna textu vytvoří novou verzi; dokumenty se generují z aktuální (nejnovější nevyřazené) verze a podepsané dokumenty zůstávají vázané na svou verzi.
        Všechny texty jsou koncepty ke schválení právničkou.{!canEdit && " Upravovat smí jen oprávnění „Spravovat texty prohlášení a poučení“."}
      </div>
      {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md mb-2">{error}</div>}
      <div className="space-y-2">
        {keys.map((key) => {
          const versions = rows.filter((r) => r.text_key === key);
          const current = versions.find((r) => r.status !== "VYRAZENO");
          return (
            <div key={key} className="border border-slate-200 rounded-md p-3 bg-white">
              <button type="button" onClick={() => setOpen(open === key ? null : key)} className="w-full flex items-center justify-between text-left">
                <span className="flex items-center gap-1 text-sm font-medium">
                  {open === key ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {LEGAL_TEXT_LABELS[key] || key}
                </span>
                {current && <span className={"text-xs px-2 py-0.5 rounded " + STATUS_CLS[current.status]}>v{current.version_no} · {STATUS[current.status]}</span>}
              </button>
              {open === key && (
                <div className="mt-2 space-y-2">
                  {versions.map((v) => (
                    <div key={v.id} className={"border-l-2 pl-2 " + (v === current ? "border-teal-600" : "border-slate-200")}>
                      <div className="text-xs text-slate-500">
                        verze {v.version_no} · {STATUS[v.status]}{v === current ? " · aktuální" : ""} · vytvořeno {fmtTs(v.created_at)}
                        {v.approved_at ? ` · schváleno ${fmtTs(v.approved_at)}` : ""} · otisk <code className="font-mono">{String(v.body_sha256).slice(0, 12)}…</code>
                      </div>
                      <div className="text-sm font-medium">{v.title}</div>
                      <div className="text-sm whitespace-pre-wrap text-slate-700">{v.body}</div>
                      {canEdit && v.status !== "VYRAZENO" && (
                        <div className="flex gap-3 text-xs mt-1">
                          {v.status === "KONCEPT" && (
                            <button type="button" onClick={() => setStatus(v, "SCHVALENO")} className="text-emerald-700 hover:text-emerald-900"
                              title="Jen po písemném schválení textu právničkou">Označit jako schválené právničkou</button>
                          )}
                          <button type="button" onClick={() => setStatus(v, "VYRAZENO")} className="text-red-700 hover:text-red-900">Vyřadit verzi</button>
                        </div>
                      )}
                    </div>
                  ))}
                  {canEdit && !editing && (
                    <button type="button" onClick={() => setEditing({ key, title: current?.title || versions[0]?.title || "", body: current?.body || versions[0]?.body || "" })}
                      className="text-sm text-teal-700 hover:text-teal-900 flex items-center gap-1"><FilePlus2 size={14} /> Nová verze textu</button>
                  )}
                  {editing?.key === key && (
                    <div className="border border-slate-200 rounded-md p-3 bg-slate-50">
                      <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                        className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm mb-2" placeholder="Název" />
                      <textarea value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} rows={8}
                        className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm mb-2 font-mono" />
                      <div className="text-xs text-slate-500 mb-2">Nová verze se hned stane aktuální pro nově generované dokumenty. Dokud text neschválí právnička, ponechte v něm „KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU“.</div>
                      <div className="flex gap-2">
                        <button type="button" disabled={busy || !editing.title.trim() || !editing.body.trim()} onClick={saveVersion}
                          className="bg-teal-700 hover:bg-teal-800 text-white text-sm px-3 py-1.5 rounded-md disabled:opacity-50">{busy ? "Ukládám…" : "Uložit novou verzi"}</button>
                        <button type="button" onClick={() => setEditing(null)} className="text-sm px-3 py-1.5 text-slate-600">Zrušit</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
