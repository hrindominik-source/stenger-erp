import React, { useState, useEffect, useCallback, useRef } from "react";
import { LogOut, Loader2, AlertCircle, CheckCircle2, X, Calendar, LayoutDashboard, ClipboardList, Coffee } from "lucide-react";
import { supabase } from "./supabaseClient.js";
import { todayStr, nowTimeStr, uid, isoFromSkDateStr, skDateStrFromIso, parseSkDate, durationMinutes } from "./lib/utils.js";
import { computeProductionIssues, computeStockLevels, materialShortages } from "./lib/inventory.js";

const PRODUCTION_LINKY = [
  { value: "sacky", label: "Sáčky" },
  { value: "kyble", label: "Kbelíky" },
  { value: "bulk", label: "Bulk" },
];

const VYROBA_STATUS_OPTIONS = [
  { value: "caka", label: "Čeká" },
  { value: "prebieha", label: "Probíhá" },
  { value: "hotovo", label: "Ukončeno" },
];
const VYROBA_TAB_COLORS = {
  prehlad: { badge: "from-teal-400 to-teal-600", shadow: "shadow-teal-500/40" },
  vyroba: { badge: "from-blue-400 to-blue-600", shadow: "shadow-blue-500/40" },
  prestavky: { badge: "from-amber-400 to-amber-600", shadow: "shadow-amber-500/40" },
};

function VyrobaTabButton({ active, onClick, color, icon, label }) {
  const c = VYROBA_TAB_COLORS[color] || VYROBA_TAB_COLORS.prehlad;
  return (
    <button
      onClick={onClick}
      className={
        "group relative flex-1 flex flex-col items-center justify-center gap-1.5 py-3.5 px-2 rounded-xl text-base font-bold text-center leading-tight transition-all duration-200 " +
        (active
          ? "bg-gradient-to-b from-white to-slate-50 text-slate-900 shadow-lg " + c.shadow + " -translate-y-0.5"
          : "text-slate-300 hover:text-white hover:bg-white/5 hover:-translate-y-0.5")
      }
    >
      <span className={"flex items-center justify-center w-11 h-11 rounded-lg bg-gradient-to-br text-white shadow-md transition-transform duration-200 group-hover:scale-110 " + c.badge}>
        {icon}
      </span>
      {label}
    </button>
  );
}

function productLabel(p) {
  if (!p) return "";
  return [p.znacka, [p.gramaz, p.ksVKartone, p.kartonovNaPalete].filter(Boolean).join("/")].filter(Boolean).join(" ");
}

// Uložený formát zůstává text "DD.MM.RRRR" jako doteď - kalendář je jen
// doplňkový způsob zadání, psaní funguje stejně jako předtím.
function DateFieldBig({ value, onChange }) {
  const nativeRef = useRef(null);
  return (
    <div className="relative flex gap-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="DD.MM.RRRR"
        className="flex-1 border-2 border-slate-200 rounded-xl px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-teal-600"
      />
      <button
        type="button"
        onClick={() => { const el = nativeRef.current; if (el && el.showPicker) el.showPicker(); }}
        className="flex items-center justify-center w-14 border-2 border-slate-200 rounded-xl text-slate-500 hover:bg-slate-50"
        title="Vybrat z kalendáře"
      >
        <Calendar size={22} />
      </button>
      <input
        ref={nativeRef}
        type="date"
        value={isoFromSkDateStr(value)}
        onChange={(e) => onChange(skDateStrFromIso(e.target.value))}
        className="absolute right-0 top-0 w-0 h-0 opacity-0 pointer-events-none"
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
}

function VyrobaFormTab({ fullName }) {
  const [products, setProducts] = useState([]);
  const [outputs, setOutputs] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState("");

  const [editingId, setEditingId] = useState(null);
  const [zapisala, setZapisala] = useState("");
  const [datum, setDatum] = useState(todayStr());
  const [linka, setLinka] = useState("sacky");
  const [produktId, setProduktId] = useState("");
  const [paliet, setPaliet] = useState("");
  const [sarza, setSarza] = useState("");
  const [potvrdenyNedostatok, setPotvrdenyNedostatok] = useState(false);

  const fetchAll = useCallback(async () => {
    const [productsRes, outputsRes, workersRes, receiptsRes, issuesRes] = await Promise.all([
      supabase.from("products").select("*"),
      supabase.from("production_outputs").select("*").order("created_at", { ascending: false }),
      supabase.from("workers").select("*"),
      supabase.from("goods_receipts").select("*"),
      supabase.from("stock_issues").select("*"),
    ]);
    if (productsRes.error || outputsRes.error || workersRes.error) {
      setError("Nepodařilo se načíst data.");
      return;
    }
    setError("");
    setProducts((productsRes.data || []).map((row) => row.data));
    setOutputs((outputsRes.data || []).map((row) => row.data));
    setWorkers((workersRes.data || []).map((row) => row.data).filter((w) => w.typ === "vyroba"));
    if (!receiptsRes.error) setReceipts((receiptsRes.data || []).map((row) => row.data));
    if (!issuesRes.error) setIssues((issuesRes.data || []).map((row) => row.data));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchAll();
      if (!cancelled) setLoading(false);
    })();
    const poller = setInterval(fetchAll, 10000);
    return () => {
      cancelled = true;
      clearInterval(poller);
    };
  }, [fetchAll]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(""), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  const linkaProducts = products.filter((p) => p.linka === linka);
  const selectedProduct = products.find((p) => p.id === produktId);
  const editingOutput = editingId ? outputs.find((o) => o.id === editingId) : null;
  const issuesForStock = editingOutput ? issues.filter((i) => !(editingOutput.issueIds || []).includes(i.id)) : issues;
  const stock = computeStockLevels(receipts, issuesForStock);
  const mnozstvoNaEnter = parseFloat(String(paliet).replace(",", ".")) || 0;
  const requiredIssues = selectedProduct && mnozstvoNaEnter > 0 ? computeProductionIssues({ mnozstvo: mnozstvoNaEnter, mnozstvoJednotka: "paliet" }, selectedProduct) : [];
  const nedostatokSurovin = materialShortages(requiredIssues, stock);
  const maSurovinovyProblem = nedostatokSurovin.length > 0;

  function pickLinka(l) {
    setLinka(l);
    setProduktId("");
  }

  function resetEntryFields() {
    setProduktId("");
    setPaliet("");
    setSarza("");
    setEditingId(null);
    setPotvrdenyNedostatok(false);
  }

  function startEdit(o) {
    setEditingId(o.id);
    setDatum(o.datum || todayStr());
    setLinka(o.linka || "sacky");
    setProduktId(o.produktId || "");
    setPaliet(o.mnozstvo !== undefined && o.mnozstvo !== null ? String(o.mnozstvo) : "");
    setSarza(o.sarza || "");
    setZapisala(o.zapisala || "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSave() {
    if (!zapisala) {
      setError("Vyberte, kdo zapisuje.");
      return;
    }
    if (!selectedProduct) {
      setError("Vyberte produkt.");
      return;
    }
    if (!paliet.trim()) {
      setError("Zadejte počet palet.");
      return;
    }
    if (maSurovinovyProblem && !potvrdenyNedostatok) {
      setError("Potvrďte, že výroba i přes nedostatek surovin je záměr (zaškrtávací políčko níže).");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const vyrobeneDatum = datum.trim() || todayStr();
      const mnozstvoNum = parseFloat(String(paliet).replace(",", ".")) || 0;
      const productionIssues = computeProductionIssues({ mnozstvo: mnozstvoNum, mnozstvoJednotka: "paliet" }, selectedProduct);

      if (editingOutput && (editingOutput.issueIds || []).length) {
        const { error: delErr } = await supabase.from("stock_issues").delete().in("id", editingOutput.issueIds);
        if (delErr) throw delErr;
      }

      const issueIds = [];
      for (const issue of productionIssues) {
        const id = uid();
        const { error: insErr } = await supabase.from("stock_issues").insert({
          id,
          data: {
            id,
            datum: vyrobeneDatum,
            cas: nowTimeStr(),
            material: issue.material,
            mnozstvo: issue.mnozstvo,
            mnozstvoCislo: issue.mnozstvoCislo,
            mnozstvoJednotka: issue.mnozstvoJednotka,
            dovod: "Vyroba",
            poznamka: "Šarže " + sarza.trim() + " - " + productLabel(selectedProduct),
            zapisal: zapisala,
          },
        });
        if (insErr) throw insErr;
        issueIds.push(id);
      }

      const outputId = editingId || uid();
      const output = {
        id: outputId,
        datum: vyrobeneDatum,
        cas: editingOutput ? editingOutput.cas : nowTimeStr(),
        produktId: selectedProduct.id,
        produktNazov: productLabel(selectedProduct),
        linka,
        mnozstvo: mnozstvoNum,
        sarza: sarza.trim(),
        zapisala,
        issueIds,
        prekroceniePotvrdene: maSurovinovyProblem ? true : false,
      };

      if (editingOutput) {
        const { error: updErr } = await supabase.from("production_outputs").update({ data: output }).eq("id", outputId);
        if (updErr) throw updErr;
      } else {
        const { error: outErr } = await supabase.from("production_outputs").insert({ id: outputId, data: output });
        if (outErr) throw outErr;
      }

      setFlash(editingOutput ? "Záznam upraven" : "Uloženo");
      resetEntryFields();
      await fetchAll();
    } catch (e) {
      setError("Uložení se nezdařilo, zkuste to znovu.");
    }
    setSaving(false);
  }

  const bigBtn = "text-base font-semibold px-4 py-3.5 rounded-xl border-2 text-center active:scale-[0.98] transition-transform";
  const recentOutputs = outputs.slice(0, 20);

  if (loading) {
    return (
      <div className="text-center text-slate-400 py-10">
        <Loader2 className="animate-spin mx-auto mb-2" size={24} /> Načítám...
      </div>
    );
  }

  return (
    <>
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

        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5">
          {editingId ? (
            <div className="flex items-center justify-between mb-3">
              <div className="text-lg font-semibold text-amber-700">Upravujete záznam</div>
              <button onClick={resetEntryFields} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
                <X size={16} /> Zrušit úpravu
              </button>
            </div>
          ) : (
            <div className="text-lg font-semibold mb-3">Zapsat vyrobenou dávku</div>
          )}

          <div className="mb-1 text-sm font-medium text-slate-500">Kdo zapisuje</div>
          {workers.length === 0 ? (
            <div className="text-sm text-slate-400 mb-3">Zatím žádní pracovníci (doplní office v Pracovnících).</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
              {workers.map((w) => (
                <button key={w.id} onClick={() => setZapisala(w.meno)} className={bigBtn + " " + (zapisala === w.meno ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>
                  {w.meno}
                </button>
              ))}
            </div>
          )}

          <div className="mb-1 text-sm font-medium text-slate-500">Datum výroby</div>
          <div className="mb-3">
            <DateFieldBig value={datum} onChange={setDatum} />
          </div>
          <p className="text-xs text-slate-400 -mt-2 mb-3">Předvyplněno dnešním datem - pokud zapisujete dávku zpětně, změňte na správný den.</p>

          <div className="mb-1 text-sm font-medium text-slate-500">Linka</div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {PRODUCTION_LINKY.map((l) => (
              <button key={l.value} onClick={() => pickLinka(l.value)} className={bigBtn + " " + (linka === l.value ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>
                {l.label}
              </button>
            ))}
          </div>

          <div className="mb-1 text-sm font-medium text-slate-500">Produkt</div>
          {linkaProducts.length === 0 ? (
            <div className="text-sm text-slate-400 mb-3">Žádné produkty pro tuto linku (doplní office v Produktech).</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
              {linkaProducts.map((p) => (
                <button key={p.id} onClick={() => { setProduktId(p.id); setPotvrdenyNedostatok(false); }} className={bigBtn + " " + (produktId === p.id ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>
                  {productLabel(p)}
                </button>
              ))}
            </div>
          )}

          <div className="mb-1 mt-3 text-sm font-medium text-slate-500">Počet palet</div>
          <input
            value={paliet}
            onChange={(e) => { setPaliet(e.target.value); setPotvrdenyNedostatok(false); }}
            inputMode="decimal"
            placeholder="např. 12"
            className={"w-full border-2 rounded-xl px-3 py-3 text-base text-center mb-2 focus:outline-none focus:ring-2 " + (maSurovinovyProblem ? "border-red-400 focus:ring-red-500" : "border-slate-200 focus:ring-teal-600")}
          />
          {maSurovinovyProblem && (
            <>
              <div className="text-xs text-red-600 mb-2">
                Nedostatek surovin: {nedostatokSurovin.map((n) => `${n.material} (na skladě ${n.dostupne}, potřeba ${n.mnozstvoCislo} ${n.mnozstvoJednotka})`).join(", ")}
              </div>
              <label className="mb-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2 text-xs text-red-700 cursor-pointer">
                <input type="checkbox" checked={potvrdenyNedostatok} onChange={(e) => setPotvrdenyNedostatok(e.target.checked)} className="mt-0.5" />
                Potvrzuji, že výroba i přes nedostatek surovin je záměr a chci přesto uložit.
              </label>
            </>
          )}

          <div className="mb-1 text-sm font-medium text-slate-500">Šarže</div>
          <input
            value={sarza}
            onChange={(e) => setSarza(e.target.value)}
            placeholder="např. 2607A"
            className="w-full border-2 border-slate-200 rounded-xl px-3 py-3 text-base mb-2 focus:outline-none focus:ring-2 focus:ring-teal-600"
          />

          <button
            onClick={handleSave}
            disabled={saving || (maSurovinovyProblem && !potvrdenyNedostatok)}
            className="w-full mt-3 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-lg font-semibold px-4 py-4 rounded-xl flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={20} className="animate-spin" /> : <CheckCircle2 size={20} />}
            {editingId ? "Uložit změnu" : "Uložit výrobu"}
          </button>
        </div>

        <div className="text-sm font-semibold text-slate-500 mb-2">Poslední záznamy (kliknutím upravíte)</div>
        {recentOutputs.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm">Zatím žádné záznamy.</div>
        ) : (
          <div className="space-y-2">
            {recentOutputs.map((o) => (
              <button
                key={o.id}
                onClick={() => startEdit(o)}
                disabled={!!o.pociatocnyStav}
                className={"w-full text-left bg-white border rounded-lg p-3 " + (o.pociatocnyStav ? "border-slate-200 cursor-default opacity-80" : "hover:border-teal-300 " + (editingId === o.id ? "border-teal-500 ring-1 ring-teal-500" : "border-slate-200"))}
              >
                <div className="font-medium">
                  {o.produktNazov} <span className="text-slate-400 font-normal">- {o.mnozstvo} palet</span>
                  {o.prekroceniePotvrdene && <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">nedostatek surovin</span>}
                  {o.pociatocnyStav && <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">Počáteční stav (úprava v Office - Výrobní plán)</span>}
                </div>
                <div className="text-xs text-slate-500">Šarže {o.sarza || "-"} - {o.datum} {o.cas} - {o.zapisala}</div>
              </button>
            ))}
          </div>
        )}
    </>
  );
}

/* ---------------- Přehled (výrobní plán) ---------------- */

function PrehladTab() {
  const [plan, setPlan] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState(null);
  const pollRef = useRef(null);

  const fetchPlan = useCallback(async () => {
    const { data, error: fetchError } = await supabase.from("production_plan").select("*");
    if (fetchError) {
      setError("Nepodařilo se načíst výrobní plán.");
      return;
    }
    setError("");
    setPlan((data || []).map((row) => row.data));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchPlan();
      if (!cancelled) setLoading(false);
    })();
    pollRef.current = setInterval(fetchPlan, 10000);
    return () => {
      cancelled = true;
      clearInterval(pollRef.current);
    };
  }, [fetchPlan]);

  async function setStatus(row, stavVyroby) {
    setSavingId(row.id);
    const next = { ...row, stavVyroby };
    setPlan((prev) => prev.map((r) => (r.id === row.id ? next : r)));
    const { error: updateError } = await supabase.from("production_plan").update({ data: next }).eq("id", row.id);
    setSavingId(null);
    if (updateError) {
      setError("Změna stavu se nezdařila, zkuste to znovu.");
      await fetchPlan();
    }
  }

  if (loading) {
    return (
      <div className="text-center text-slate-400 py-10">
        <Loader2 className="animate-spin mx-auto mb-2" size={24} /> Načítám...
      </div>
    );
  }

  const sortedPlan = plan.slice().sort((a, b) => (parseSkDate(a.datum) || 0) - (parseSkDate(b.datum) || 0));

  return (
    <div>
      {error && (
        <div className="mb-3 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-md flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}
      {sortedPlan.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-slate-400 text-sm">Zatím žádné položky ve výrobním plánu.</div>
      ) : (
        <div className="space-y-3">
          {sortedPlan.map((r) => {
            const stav = r.stavVyroby || "caka";
            const zmenene = new Set(r.zmenenePolia || []);
            const jeZmenene = zmenene.size > 0 && r.zmeneneKedy && (Date.now() - new Date(r.zmeneneKedy).getTime()) < 24 * 60 * 60 * 1000;
            const zmCls = (pole) => (jeZmenene && zmenene.has(pole) ? "text-red-600 font-semibold" : "");
            return (
              <div key={r.id} className={"bg-white border rounded-xl p-4 " + (jeZmenene ? "border-red-400 border-2" : "border-slate-200")}>
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2">
                    <div className={"font-semibold text-base " + zmCls("produktNazov")}>{r.produktNazov}</div>
                    {jeZmenene && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 whitespace-nowrap">Změněno</span>}
                  </div>
                  <div className={"text-sm whitespace-nowrap " + (zmCls("datum") || "text-slate-500")}>{r.datum}</div>
                </div>
                <div className="text-sm text-slate-500 mb-3 flex flex-wrap gap-x-1">
                  <span className={zmCls("mnozstvo") || zmCls("mnozstvoJednotka")}>{r.mnozstvo} {r.mnozstvoJednotka === "kartonov" ? "kartonů" : "palet"}</span>
                  {r.terminDodania && <span className={zmCls("terminDodania")}>{" - termín: " + r.terminDodania}</span>}
                  {r.poznamka && <span className={zmCls("poznamka")}>{" - " + r.poznamka}</span>}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {VYROBA_STATUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setStatus(r, opt.value)}
                      disabled={savingId === r.id}
                      className={
                        "text-sm font-semibold px-3 py-2.5 rounded-lg border-2 disabled:opacity-60 " +
                        (stav === opt.value
                          ? opt.value === "hotovo"
                            ? "bg-emerald-600 text-white border-emerald-600"
                            : opt.value === "prebieha"
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-slate-600 text-white border-slate-600"
                          : "bg-white text-slate-600 border-slate-200")
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------- Přestávky ---------------- */

function PrestavkyTab() {
  const [workers, setWorkers] = useState([]);
  const [prestavky, setPrestavky] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyMeno, setBusyMeno] = useState("");
  const pollRef = useRef(null);

  const fetchAll = useCallback(async () => {
    const [workersRes, prestavkyRes] = await Promise.all([
      supabase.from("workers").select("*"),
      supabase.from("prestavky").select("*").order("created_at", { ascending: false }),
    ]);
    if (workersRes.error || prestavkyRes.error) {
      setError("Nepodařilo se načíst data.");
      return;
    }
    setError("");
    setWorkers((workersRes.data || []).map((row) => row.data).filter((w) => w.typ === "vyroba"));
    setPrestavky((prestavkyRes.data || []).map((row) => row.data));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchAll();
      if (!cancelled) setLoading(false);
    })();
    pollRef.current = setInterval(fetchAll, 10000);
    return () => {
      cancelled = true;
      clearInterval(pollRef.current);
    };
  }, [fetchAll]);

  function activeBreakFor(meno) {
    return prestavky.find((p) => p.meno === meno && !p.casKonca);
  }

  async function deleteBreak(id) {
    if (!window.confirm("Opravdu smazat tento záznam přestávky? (např. omylem ťuknuté jméno)")) return;
    setError("");
    try {
      const { error: delErr } = await supabase.from("prestavky").delete().eq("id", id);
      if (delErr) throw delErr;
      await fetchAll();
    } catch (e) {
      setError("Smazání se nezdařilo, zkuste to znovu.");
    }
  }

  async function toggleBreak(meno) {
    setBusyMeno(meno);
    setError("");
    const active = activeBreakFor(meno);
    try {
      if (active) {
        const next = { ...active, casKonca: nowTimeStr() };
        const { error: updErr } = await supabase.from("prestavky").update({ data: next }).eq("id", active.id);
        if (updErr) throw updErr;
      } else {
        const id = uid();
        const record = { id, meno, datum: todayStr(), casZaciatku: nowTimeStr(), casKonca: "" };
        const { error: insErr } = await supabase.from("prestavky").insert({ id, data: record });
        if (insErr) throw insErr;
      }
      await fetchAll();
    } catch (e) {
      setError("Nepodařilo se uložit, zkuste to znovu.");
    }
    setBusyMeno("");
  }

  if (loading) {
    return (
      <div className="text-center text-slate-400 py-10">
        <Loader2 className="animate-spin mx-auto mb-2" size={24} /> Načítám...
      </div>
    );
  }

  const today = todayStr();
  const todayPrestavky = prestavky.filter((p) => p.datum === today).sort((a, b) => (b.casZaciatku || "").localeCompare(a.casZaciatku || ""));
  const active = todayPrestavky.filter((p) => !p.casKonca);

  return (
    <div>
      {error && (
        <div className="mb-3 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-md flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <div className="mb-1 text-sm font-medium text-slate-500">Ťukněte na své jméno - začne nebo skončí vaše přestávka</div>
      {workers.length === 0 ? (
        <div className="text-sm text-slate-400 mb-5">Zatím žádní pracovníci (doplní office v Pracovnících).</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-5">
          {workers.map((w) => {
            const isActive = !!activeBreakFor(w.meno);
            return (
              <button
                key={w.id}
                onClick={() => toggleBreak(w.meno)}
                disabled={busyMeno === w.meno}
                className={
                  "text-base font-semibold px-4 py-3.5 rounded-xl border-2 text-center active:scale-[0.98] transition-transform disabled:opacity-60 " +
                  (isActive ? "bg-amber-500 text-white border-amber-500" : "bg-white text-slate-700 border-slate-200")
                }
              >
                {w.meno}
                {isActive && <div className="text-xs font-normal mt-0.5">na přestávce</div>}
              </button>
            );
          })}
        </div>
      )}

      {active.length > 0 && (
        <div className="mb-5">
          <h2 className="text-sm font-semibold text-slate-500 mb-2">Právě na přestávce</h2>
          <div className="bg-amber-50 border border-amber-200 rounded-lg overflow-hidden">
            {active.map((p) => (
              <div key={p.id} className="px-4 py-2.5 border-t border-amber-100 first:border-t-0 flex items-center justify-between gap-2">
                <div className="font-medium text-sm">{p.meno}</div>
                <div className="flex items-center gap-2">
                  <div className="text-sm text-amber-700">od {p.casZaciatku}</div>
                  <button onClick={() => deleteBreak(p.id)} title="Zrušit (omylem ťuknuté)" className="text-amber-700 hover:text-red-600 p-1">
                    <X size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-slate-500 mb-2">Dnešní přestávky</h2>
        {todayPrestavky.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm">Dnes zatím žádné přestávky.</div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            {todayPrestavky.map((p) => {
              const mins = durationMinutes(p.casZaciatku, p.casKonca);
              return (
                <div key={p.id} className="px-4 py-2.5 border-t border-slate-100 first:border-t-0 flex items-center justify-between gap-2">
                  <div className="font-medium text-sm">{p.meno}</div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm text-slate-500">
                      {p.casZaciatku} - {p.casKonca || <span className="text-amber-600 font-medium">probíhá</span>}
                      {mins !== null && <span className="text-slate-400"> ({mins} min)</span>}
                    </div>
                    <button onClick={() => deleteBreak(p.id)} title="Smazat záznam" className="text-slate-400 hover:text-red-600 p-1">
                      <X size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Hlavní obal (hlavička + taby) ---------------- */

export default function VyrobaView({ fullName, onSignOut }) {
  const [tab, setTab] = useState("prehlad");

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" style={{ fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}>
      <header className="bg-slate-900 text-white">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <img src="/stenger-logo.png" alt="Stenger" className="h-10 w-auto" />
            <div>
              <div className="text-xs tracking-wider text-slate-400">Stenger Czech s.r.o.</div>
              <div className="text-lg font-semibold">Výroba</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-300">{fullName}</span>
            <button
              onClick={onSignOut}
              className="flex items-center gap-1.5 text-slate-300 hover:bg-slate-800 px-3 py-1.5 rounded-md text-sm"
            >
              <LogOut size={16} /> Odhlásit
            </button>
          </div>
        </div>
        <div className="max-w-2xl mx-auto px-4 pb-4">
          <nav className="flex items-stretch gap-2 mt-1 bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-2 shadow-inner">
            <VyrobaTabButton active={tab === "prehlad"} onClick={() => setTab("prehlad")} color="prehlad" icon={<LayoutDashboard size={20} />} label="Výrobní plán" />
            <VyrobaTabButton active={tab === "vyroba"} onClick={() => setTab("vyroba")} color="vyroba" icon={<ClipboardList size={20} />} label="Zapsat dávku" />
            <VyrobaTabButton active={tab === "prestavky"} onClick={() => setTab("prestavky")} color="prestavky" icon={<Coffee size={20} />} label="Přestávky" />
          </nav>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {tab === "prehlad" ? <PrehladTab /> : tab === "vyroba" ? <VyrobaFormTab fullName={fullName} /> : <PrestavkyTab />}
      </main>
    </div>
  );
}
