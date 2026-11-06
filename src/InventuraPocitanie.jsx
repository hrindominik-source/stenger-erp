import React, { useState, useEffect, useCallback } from "react";
import { Loader2, AlertCircle, CheckCircle2, Trash2 } from "lucide-react";
import { supabase } from "./supabaseClient.js";
import { todayStr, uid, parseSkDate } from "./lib/utils.js";
import { UNIT_QUICK_PICKS } from "./lib/inventory.js";
import { polozkyNaPocitanie, polozkaKey, parseQtyInput } from "./lib/inventura.js";

// Inventura naslepo: pocitajuci vidi len co pocitat (material + jednotka), nie
// evidovany stav. Pouziva ju sklad (Kontrola skladu) aj kancelaria, ked skladnik
// nie je. Porovnanie, ocenenie a uzavretie je v kancelarii (Stav zasob).
export default function InventuraPocitanie({ fullName, extraMaterialy = [], onChanged }) {
  const [inventury, setInventury] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(null);
  const [datum, setDatum] = useState(() => todayStr());
  const [novy, setNovy] = useState({ material: "", unit: "kg" });

  const fetchAll = useCallback(async () => {
    const [invRes, recRes, issRes] = await Promise.all([
      supabase.from("inventury").select("*").order("created_at", { ascending: false }),
      supabase.from("goods_receipts").select("*"),
      supabase.from("stock_issues").select("*"),
    ]);
    if (invRes.error || recRes.error || issRes.error) {
      setError("Nepodařilo se načíst data.");
      return;
    }
    setError("");
    setInventury((invRes.data || []).map((row) => row.data));
    setReceipts((recRes.data || []).map((row) => row.data));
    setIssues((issRes.data || []).map((row) => row.data));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchAll();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchAll]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(""), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  const otevrena = inventury.find((i) => i.stav === "ROZPRACOVANA" || i.stav === "SPOCITANA");
  const rozpracovana = otevrena && otevrena.stav === "ROZPRACOVANA" ? otevrena : null;
  // rozpracovany zoznam sa drzi lokalne, kym ho skladnik neulozi
  const polozky = draft && rozpracovana && draft.id === rozpracovana.id ? draft.polozky : rozpracovana ? rozpracovana.polozky || [] : [];

  const znameMaterialy = Array.from(new Set([...receipts.map((r) => (r.material || "").trim()), ...extraMaterialy].filter(Boolean))).sort((a, b) => a.localeCompare(b));

  async function ulozit(data, msg) {
    setSaving(true);
    setError("");
    try {
      const { error: upErr } = await supabase.from("inventury").upsert({ id: data.id, data });
      if (upErr) throw upErr;
      setFlash(msg);
      setDraft(null);
      await fetchAll();
      if (onChanged) onChanged();
    } catch (e) {
      console.error(e);
      setError("Uložení se nezdařilo, zkuste to znovu.");
    }
    setSaving(false);
  }

  function zahajit() {
    if (!fullName) {
      setError("Vyberte, kdo inventuru dělá.");
      return;
    }
    if (!parseSkDate(datum)) {
      setError("Zadejte datum inventury ve tvaru DD.MM.RRRR.");
      return;
    }
    const id = uid();
    ulozit({ id, datum: datum.trim(), stav: "ROZPRACOVANA", zahajil: fullName, zahajenoAt: new Date().toISOString(), polozky: polozkyNaPocitanie(receipts, issues, datum.trim()) }, "Inventura zahájena");
  }

  function setPolozky(fn) {
    setDraft({ id: rozpracovana.id, polozky: fn(polozky) });
  }

  function zmenPolozku(idx, patch) {
    setPolozky((list) => list.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }

  function pridat() {
    const material = novy.material.trim();
    if (!material) return;
    if (polozky.some((p) => polozkaKey(p.material, p.unit) === polozkaKey(material, novy.unit))) {
      setError("Tato položka už v seznamu je.");
      return;
    }
    setError("");
    setPolozky((list) => [...list, { material, unit: novy.unit, napocitane: "", poznamka: "", pridano: true }]);
    setNovy({ material: "", unit: novy.unit });
  }

  function odeslat() {
    const chybi = polozky.filter((p) => parseQtyInput(p.napocitane) === null);
    if (chybi.length > 0) {
      setError(`Doplňte množství u všech položek (i 0). Chybí: ${chybi.map((p) => p.material).join(", ")}.`);
      return;
    }
    ulozit({ ...rozpracovana, polozky, stav: "SPOCITANA", spocital: fullName || rozpracovana.zahajil, spocitanoAt: new Date().toISOString() }, "Odesláno do kanceláře");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-slate-500">
        <Loader2 className="animate-spin mr-2" size={20} /> Načítám...
      </div>
    );
  }

  const bigBtn = "text-base font-semibold px-4 py-3.5 rounded-xl border-2 text-center active:scale-[0.98] transition-transform";
  const historie = inventury.filter((i) => i.stav === "UZAVRENA").slice(0, 10);

  return (
    <div>
      {error && (
        <div className="mb-3 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-md flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}
      {flash && (
        <div className="mb-3 bg-emerald-600 text-white text-sm font-medium px-3 py-2.5 rounded-md flex items-center gap-2">
          <CheckCircle2 size={16} /> {flash}
        </div>
      )}

      {!otevrena && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5">
          <div className="text-lg font-semibold mb-1">Inventura skladu</div>
          <div className="text-sm text-slate-500 mb-3">Spočítejte skutečný stav surovin a obalů. Kancelář ho porovná s evidencí (Stav zásob → Inventury) a ocení.</div>
          <div className="mb-1 text-sm font-medium text-slate-500">Datum inventury (stav ke konci dne)</div>
          <input value={datum} onChange={(e) => setDatum(e.target.value)} placeholder="DD.MM.RRRR" className="w-full border-2 border-slate-200 rounded-xl px-3 py-3 text-base mb-3" />
          <button onClick={zahajit} disabled={saving} className={bigBtn + " w-full bg-teal-700 text-white border-teal-700 disabled:opacity-50"}>
            {saving ? "Ukládám..." : "Zahájit inventuru"}
          </button>
        </div>
      )}

      {otevrena && otevrena.stav === "SPOCITANA" && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 mb-5">
          <div className="text-lg font-semibold mb-1">Inventura k {otevrena.datum} je spočítaná</div>
          <div className="text-sm text-slate-600 mb-3">Čeká na kontrolu a uzavření v kanceláři. Spočítal(a): {otevrena.spocital}.</div>
          <button onClick={() => ulozit({ ...otevrena, stav: "ROZPRACOVANA" }, "Inventura vrácena k úpravě")} disabled={saving} className={bigBtn + " bg-white text-slate-700 border-slate-200 disabled:opacity-50"}>
            Vrátit k úpravě
          </button>
        </div>
      )}

      {rozpracovana && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5" data-testid="inventura-sklad">
          <div className="text-lg font-semibold mb-1">Inventura k {rozpracovana.datum}</div>
          <div className="text-sm text-slate-500 mb-3">Zapište, co skutečně je na skladě. Když položka není, zadejte 0.</div>
          <div className="space-y-2 mb-4">
            {polozky.map((p, idx) => (
              <div key={p.material + "|" + p.unit} className="border-2 border-slate-200 rounded-xl p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="font-medium">{p.material}</div>
                  {p.pridano && (
                    <button onClick={() => setPolozky((list) => list.filter((_, i) => i !== idx))} title="Odebrat" className="text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input value={p.napocitane} onChange={(e) => zmenPolozku(idx, { napocitane: e.target.value })} inputMode="decimal" placeholder="Množství" className="flex-1 min-w-0 border-2 border-slate-200 rounded-lg px-3 py-2.5 text-base" />
                  <span className="text-sm text-slate-500 w-16">{p.unit}</span>
                </div>
                <input value={p.poznamka} onChange={(e) => zmenPolozku(idx, { poznamka: e.target.value })} placeholder="Poznámka (nepovinné)" className="w-full mt-2 border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            ))}
          </div>

          <div className="border-2 border-dashed border-slate-200 rounded-xl p-3 mb-4">
            <div className="text-sm font-medium text-slate-500 mb-2">Položka, která v seznamu chybí</div>
            <input value={novy.material} onChange={(e) => setNovy({ ...novy, material: e.target.value })} list="inventura-materialy" placeholder="Materiál" className="w-full border-2 border-slate-200 rounded-lg px-3 py-2.5 text-base mb-2" />
            <datalist id="inventura-materialy">
              {znameMaterialy.map((m) => <option key={m} value={m} />)}
            </datalist>
            <div className="flex flex-wrap gap-2 mb-2">
              {UNIT_QUICK_PICKS.map((u) => (
                <button key={u} onClick={() => setNovy({ ...novy, unit: u })} className={"text-sm px-3 py-1.5 rounded-lg border-2 " + (novy.unit === u ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>{u}</button>
              ))}
            </div>
            <button onClick={pridat} className="text-sm font-medium text-teal-700 underline">Přidat do seznamu</button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => ulozit({ ...rozpracovana, polozky }, "Uloženo")} disabled={saving} className={bigBtn + " bg-white text-slate-700 border-slate-200 disabled:opacity-50"}>Uložit rozpracované</button>
            <button onClick={odeslat} disabled={saving} className={bigBtn + " bg-teal-700 text-white border-teal-700 disabled:opacity-50"}>Hotovo – odeslat</button>
          </div>
        </div>
      )}

      {historie.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-sm font-semibold text-slate-500 mb-2">Uzavřené inventury</div>
          {historie.map((i) => (
            <div key={i.id} className="text-sm py-1.5 border-t border-slate-100 first:border-t-0">Inventura k {i.datum} – spočítal(a) {i.spocital || "-"}</div>
          ))}
        </div>
      )}
    </div>
  );
}
