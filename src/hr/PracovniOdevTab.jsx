// Pracovni odev a obuv: vydej s predavacim protokolom (PDF na stiahnutie,
// podpisany sken sa nahra spat) + evidencia rukavic (len zaznam, bez protokolu).
import React, { useState } from "react";
import { Loader2, Download, Upload, Paperclip, Plus, Shirt, Hand } from "lucide-react";
import { supabase } from "../supabaseClient.js";
import { uid } from "../lib/utils.js";
import { ODEV_POLOZKY, PROTOKOL_NAZEV, odevVydeje, rukaviceZaznamy, rukaviceCelkem, protokolPolozky, protokolChyby } from "../lib/hr/pracovniOdev.js";
import { JMHZ_FONT_URL, FONT_BOLD_URL, STENGER_LOGO_URL } from "../lib/hr/jmhzFill.js";

const today = () => new Date().toISOString().slice(0, 10);
const czDate = (iso) => (iso ? String(iso).slice(0, 10).split("-").map(Number).reverse().join(".") : "");
const inputCls = "w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-sm";

// Zapis do employees.data - vzdy nad cerstvym stavom, nic ine sa neprepise.
async function updateEmployeeData(employeeId, fn) {
  const { data: row, error } = await supabase.from("employees").select("data").eq("id", employeeId).single();
  if (error) throw error;
  const data = row?.data || {};
  const { error: upErr } = await supabase.from("employees").update({ data: { ...data, ...fn(data) } }).eq("id", employeeId);
  if (upErr) throw upErr;
}

export default function PracovniOdevTab({ employee, pozice, canEdit, predal, onSaved, uploadFile, openFile, fileName, saveFile }) {
  const vydeje = odevVydeje(employee);
  const rukavice = rukaviceZaznamy(employee);
  const [form, setForm] = useState({});
  const [datum, setDatum] = useState(today());
  const [ruk, setRuk] = useState({ datum: today(), pocet: "", poznamka: "" });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const polozky = protokolPolozky(form);
  const chyby = protokolChyby(datum, polozky);

  async function run(key, fn) {
    setBusy(key); setError("");
    try { await fn(); } catch (e) { console.error(e); setError(e.message || String(e)); }
    setBusy("");
  }

  async function pdfFor(v) {
    const { buildProtokolPdf } = await import("../lib/hr/pracovniOdevPdf.js");
    const [fontBytes, boldBytes, logoBytes] = await Promise.all([JMHZ_FONT_URL, FONT_BOLD_URL, STENGER_LOGO_URL].map(async (u) => {
      const r = await fetch(u);
      if (!r.ok) throw new Error(`Nepodařilo se načíst ${u}`);
      return r.arrayBuffer();
    }));
    return buildProtokolPdf({ fontBytes, boldBytes, logoBytes }, {
      zamestnanec: { jmeno: `${employee.first_name} ${employee.last_name}`, osobniCislo: employee.data?.osobni_cislo, datumNarozeni: employee.date_of_birth, pozice },
      datum: v.datum, polozky: v.polozky, predal: v.predal,
    });
  }
  const download = (v) => run(`pdf-${v.id}`, async () => saveFile(await pdfFor(v), `${fileName(PROTOKOL_NAZEV, v.datum)}.pdf`));

  const vytvorit = () => run("novy", async () => {
    if (chyby.length) throw new Error("Doplňte: " + chyby.join(", "));
    const { data: u } = await supabase.auth.getUser();
    const v = { id: uid(), datum, polozky, predal, vytvoril: u?.user?.id || null, vytvoreno: new Date().toISOString() };
    const bytes = await pdfFor(v);
    await updateEmployeeData(employee.id, (d) => ({ odev_vydeje: [...(d.odev_vydeje || []), v], odev_nevydava: false }));
    await supabase.from("employee_timeline_events").insert({
      id: uid(), employee_id: employee.id, event_date: datum, event_type: "DOCUMENT_GENERATED",
      title: "Předávací protokol – pracovní oděv a obuv", description: polozky.map((p) => `${p.label} ${p.velikost} × ${p.pocet}`).join(", "), source: "MANUAL",
    });
    saveFile(bytes, `${fileName(PROTOKOL_NAZEV, datum)}.pdf`);
    setForm({});
    onSaved();
  });

  const nahratSken = (v, file) => run(`sken-${v.id}`, async () => {
    const sken = await uploadFile("odev_protokol", file);
    await updateEmployeeData(employee.id, (d) => ({ odev_vydeje: (d.odev_vydeje || []).map((x) => (x.id === v.id ? { ...x, sken } : x)) }));
    onSaved();
  });

  const nevydava = (val) => run("nevydava", async () => {
    await updateEmployeeData(employee.id, () => ({ odev_nevydava: val }));
    onSaved();
  });

  const pridatRukavice = () => run("rukavice", async () => {
    const pocet = Number(ruk.pocet);
    if (!ruk.datum || !(pocet > 0)) throw new Error("Vyplňte datum a počet rukavic.");
    const { data: u } = await supabase.auth.getUser();
    const z = { id: uid(), datum: ruk.datum, pocet, poznamka: ruk.poznamka.trim(), zapsal: predal, zapsal_id: u?.user?.id || null };
    await updateEmployeeData(employee.id, (d) => ({ rukavice: [...(d.rukavice || []), z] }));
    setRuk({ datum: today(), pocet: "", poznamka: "" });
    onSaved();
  });

  return (
    <div className="space-y-4">
      {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md">{error}</div>}

      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h2 className="font-semibold text-sm mb-3 flex items-center gap-1.5"><Shirt size={15} /> Výdej pracovního oděvu a obuvi</h2>
        {canEdit && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-2 mb-3" data-testid="odev-form">
              {ODEV_POLOZKY.map((p) => (
                <React.Fragment key={p.key}>
                  <div className="text-sm font-medium text-slate-700 self-center">{p.label}</div>
                  <label className="text-xs text-slate-500">Počet kusů
                    <input type="number" min="0" value={form[p.key]?.pocet || ""} aria-label={`${p.label} – počet kusů`}
                      onChange={(e) => setForm({ ...form, [p.key]: { ...form[p.key], pocet: e.target.value } })} className={inputCls} />
                  </label>
                  <label className="text-xs text-slate-500">Velikost
                    <select value={form[p.key]?.velikost || ""} aria-label={`${p.label} – velikost`}
                      onChange={(e) => setForm({ ...form, [p.key]: { ...form[p.key], velikost: e.target.value } })} className={inputCls}>
                      <option value="">—</option>
                      {p.velikosti.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </label>
                </React.Fragment>
              ))}
            </div>
            <div className="flex items-end gap-3 flex-wrap">
              <label className="text-xs text-slate-500">Datum předání
                <input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} className={inputCls} />
              </label>
              <button onClick={vytvorit} disabled={!!busy || chyby.length > 0}
                className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md">
                {busy === "novy" ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Vytvořit předávací protokol (PDF)
              </button>
            </div>
            {polozky.length > 0 && chyby.length > 0 && <div className="text-xs text-amber-700 mt-2">Doplňte: {chyby.join(", ")}</div>}
          </>
        )}

        <div className="mt-4">
          <div className="text-xs font-medium text-slate-500 mb-1">Vydáno</div>
          {vydeje.length === 0 && (
            <div className="text-sm text-slate-400">
              Zatím nic. {canEdit && (
                <label className="inline-flex items-center gap-1.5 ml-2 text-slate-600">
                  <input type="checkbox" checked={employee.data?.odev_nevydava === true} onChange={(e) => nevydava(e.target.checked)} />
                  Pracovní oděv se tomuto zaměstnanci nevydává
                </label>
              )}
            </div>
          )}
          <div className="divide-y divide-slate-100">
            {vydeje.map((v) => (
              <div key={v.id} className="py-2 flex items-center justify-between gap-3 flex-wrap text-sm" data-testid="odev-vydej">
                <div>
                  <span className="font-medium">{czDate(v.datum)}</span>
                  <span className="text-slate-600"> · {v.polozky.map((p) => `${p.label} ${p.velikost} × ${p.pocet}`).join(", ")}</span>
                  {v.predal && <span className="text-xs text-slate-400"> · předal(a) {v.predal}</span>}
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => download(v)} disabled={!!busy} className="text-xs text-teal-700 hover:text-teal-900 flex items-center gap-1"><Download size={13} /> Protokol</button>
                  {v.sken?.path ? (
                    <button onClick={() => openFile(v.sken.path)} className="text-xs text-emerald-700 hover:underline flex items-center gap-1"><Paperclip size={13} /> Podepsaný sken</button>
                  ) : canEdit && (
                    <label className="text-xs text-amber-700 hover:text-amber-900 flex items-center gap-1 cursor-pointer">
                      {busy === `sken-${v.id}` ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Nahrát podepsaný sken
                      <input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) nahratSken(v, f); }} />
                    </label>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h2 className="font-semibold text-sm mb-1 flex items-center gap-1.5"><Hand size={15} /> Rukavice – evidence výdeje</h2>
        <div className="text-xs text-slate-400 mb-3">Jen evidence, bez předávacího protokolu.</div>
        {canEdit && (
          <div className="flex items-end gap-3 flex-wrap mb-3" data-testid="rukavice-form">
            <label className="text-xs text-slate-500">Datum
              <input type="date" value={ruk.datum} onChange={(e) => setRuk({ ...ruk, datum: e.target.value })} className={inputCls} />
            </label>
            <label className="text-xs text-slate-500 w-28">Počet (párů / ks)
              <input type="number" min="1" value={ruk.pocet} aria-label="Počet rukavic" onChange={(e) => setRuk({ ...ruk, pocet: e.target.value })} className={inputCls} />
            </label>
            <label className="text-xs text-slate-500 flex-1 min-w-[160px]">Poznámka (nepovinné)
              <input type="text" value={ruk.poznamka} onChange={(e) => setRuk({ ...ruk, poznamka: e.target.value })} className={inputCls} />
            </label>
            <button onClick={pridatRukavice} disabled={!!busy} className="flex items-center gap-1 text-sm bg-slate-700 hover:bg-slate-800 disabled:opacity-50 text-white px-3 py-2 rounded-md">
              <Plus size={14} /> Zapsat
            </button>
          </div>
        )}
        {rukavice.length === 0 ? <div className="text-sm text-slate-400">Zatím žádný záznam.</div> : (
          <>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Datum</th><th>Počet</th><th>Poznámka</th><th>Zapsal(a)</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rukavice.map((z) => (
                  <tr key={z.id} data-testid="rukavice-row"><td className="py-1.5">{czDate(z.datum)}</td><td>{z.pocet}</td><td className="text-slate-600">{z.poznamka || "—"}</td><td className="text-slate-500 text-xs">{z.zapsal || ""}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="text-xs text-slate-500 mt-2">Celkem vydáno: <strong>{rukaviceCelkem(rukavice)}</strong></div>
          </>
        )}
      </div>
    </div>
  );
}
