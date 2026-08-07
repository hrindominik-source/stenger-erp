import React, { useState, useEffect, useCallback, useRef } from "react";
import { LogOut, Loader2, AlertCircle, CheckCircle2, X, Calendar } from "lucide-react";
import { supabase } from "./supabaseClient.js";
import { todayStr, nowTimeStr, uid, isoFromSkDateStr, skDateStrFromIso } from "./lib/utils.js";
import { computeProductionIssues, computeStockLevels, materialShortages } from "./lib/inventory.js";

const PRODUCTION_LINKY = [
  { value: "sacky", label: "Sacky" },
  { value: "kyble", label: "Kyble" },
  { value: "bulk", label: "Bulk" },
];

function productLabel(p) {
  if (!p) return "";
  return [p.znacka, [p.gramaz, p.ksVKartone, p.kartonovNaPalete].filter(Boolean).join("/")].filter(Boolean).join(" ");
}

// Ulozeny format ostava text "DD.MM.RRRR" ako doteraz - kalendar je len
// doplnkovy sposob zadania, pisanie funguje rovnako ako predtym.
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
        title="Vybrat z kalendara"
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

export default function VyrobaView({ fullName, onSignOut }) {
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
      setError("Nepodarilo sa nacitat data.");
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
      setError("Vyberte, kto zapisuje.");
      return;
    }
    if (!selectedProduct) {
      setError("Vyberte produkt.");
      return;
    }
    if (!paliet.trim()) {
      setError("Zadajte pocet paliet.");
      return;
    }
    if (maSurovinovyProblem && !potvrdenyNedostatok) {
      setError("Potvrdte, ze vyroba napriek nedostatku surovin je zamer (zaskrtavacie policko nizsie).");
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
            poznamka: "Sarza " + sarza.trim() + " - " + productLabel(selectedProduct),
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

      setFlash(editingOutput ? "Zaznam upraveny" : "Ulozene");
      resetEntryFields();
      await fetchAll();
    } catch (e) {
      setError("Ulozenie zlyhalo, skuste znova.");
    }
    setSaving(false);
  }

  const bigBtn = "text-base font-semibold px-4 py-3.5 rounded-xl border-2 text-center active:scale-[0.98] transition-transform";
  const recentOutputs = outputs.slice(0, 20);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        <Loader2 className="animate-spin mr-2" size={20} /> Nacitavam...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" style={{ fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}>
      <header className="bg-slate-900 text-white">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <img src="/stenger-logo.png" alt="Stenger" className="h-10 w-auto" />
            <div>
              <div className="text-xs tracking-wider text-slate-400">Stenger Czech s.r.o.</div>
              <div className="text-lg font-semibold">Vyroba</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-300">{fullName}</span>
            <button
              onClick={onSignOut}
              className="flex items-center gap-1.5 text-slate-300 hover:bg-slate-800 px-3 py-1.5 rounded-md text-sm"
            >
              <LogOut size={16} /> Odhlasit
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
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
              <div className="text-lg font-semibold text-amber-700">Upravujete zaznam</div>
              <button onClick={resetEntryFields} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
                <X size={16} /> Zrusit upravu
              </button>
            </div>
          ) : (
            <div className="text-lg font-semibold mb-3">Zapisat vyrobenu davku</div>
          )}

          <div className="mb-1 text-sm font-medium text-slate-500">Kto zapisuje</div>
          {workers.length === 0 ? (
            <div className="text-sm text-slate-400 mb-3">Zatial ziadni pracovnici (doplni office v Pracovnikoch).</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
              {workers.map((w) => (
                <button key={w.id} onClick={() => setZapisala(w.meno)} className={bigBtn + " " + (zapisala === w.meno ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>
                  {w.meno}
                </button>
              ))}
            </div>
          )}

          <div className="mb-1 text-sm font-medium text-slate-500">Datum vyroby</div>
          <div className="mb-3">
            <DateFieldBig value={datum} onChange={setDatum} />
          </div>
          <p className="text-xs text-slate-400 -mt-2 mb-3">Predvyplnene dnesnym datumom - ak zapisujete davku z minula, zmente na spravny den.</p>

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
            <div className="text-sm text-slate-400 mb-3">Ziadne produkty pre tuto linku (doplni office v Produktoch).</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
              {linkaProducts.map((p) => (
                <button key={p.id} onClick={() => { setProduktId(p.id); setPotvrdenyNedostatok(false); }} className={bigBtn + " " + (produktId === p.id ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>
                  {productLabel(p)}
                </button>
              ))}
            </div>
          )}

          <div className="mb-1 mt-3 text-sm font-medium text-slate-500">Pocet paliet</div>
          <input
            value={paliet}
            onChange={(e) => { setPaliet(e.target.value); setPotvrdenyNedostatok(false); }}
            inputMode="decimal"
            placeholder="napr. 12"
            className={"w-full border-2 rounded-xl px-3 py-3 text-base text-center mb-2 focus:outline-none focus:ring-2 " + (maSurovinovyProblem ? "border-red-400 focus:ring-red-500" : "border-slate-200 focus:ring-teal-600")}
          />
          {maSurovinovyProblem && (
            <>
              <div className="text-xs text-red-600 mb-2">
                Nedostatok surovin: {nedostatokSurovin.map((n) => `${n.material} (na sklade ${n.dostupne}, treba ${n.mnozstvoCislo} ${n.mnozstvoJednotka})`).join(", ")}
              </div>
              <label className="mb-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2 text-xs text-red-700 cursor-pointer">
                <input type="checkbox" checked={potvrdenyNedostatok} onChange={(e) => setPotvrdenyNedostatok(e.target.checked)} className="mt-0.5" />
                Potvrdzujem, ze vyroba napriek nedostatku surovin je zamer a chcem napriek tomu ulozit.
              </label>
            </>
          )}

          <div className="mb-1 text-sm font-medium text-slate-500">Sarza</div>
          <input
            value={sarza}
            onChange={(e) => setSarza(e.target.value)}
            placeholder="napr. 2607A"
            className="w-full border-2 border-slate-200 rounded-xl px-3 py-3 text-base mb-2 focus:outline-none focus:ring-2 focus:ring-teal-600"
          />

          <button
            onClick={handleSave}
            disabled={saving || (maSurovinovyProblem && !potvrdenyNedostatok)}
            className="w-full mt-3 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-lg font-semibold px-4 py-4 rounded-xl flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={20} className="animate-spin" /> : <CheckCircle2 size={20} />}
            {editingId ? "Ulozit zmenu" : "Ulozit vyrobu"}
          </button>
        </div>

        <div className="text-sm font-semibold text-slate-500 mb-2">Posledne zaznamy (kliknutim upravite)</div>
        {recentOutputs.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm">Zatial ziadne zaznamy.</div>
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
                  {o.produktNazov} <span className="text-slate-400 font-normal">- {o.mnozstvo} paliet</span>
                  {o.prekroceniePotvrdene && <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">nedostatok surovin</span>}
                  {o.pociatocnyStav && <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">Pociatocny stav (uprava v Office - Vyrobny plan)</span>}
                </div>
                <div className="text-xs text-slate-500">Sarza {o.sarza || "-"} - {o.datum} {o.cas} - {o.zapisala}</div>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
