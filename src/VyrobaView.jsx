import React, { useState, useEffect, useCallback, useRef } from "react";
import { LogOut, LogIn, Loader2, AlertCircle, CheckCircle2, X, Calendar, LayoutDashboard, ClipboardList, Coffee, Construction, ClipboardCheck } from "lucide-react";
import { supabase } from "./supabaseClient.js";
import { todayStr, nowTimeStr, uid, isoFromSkDateStr, skDateStrFromIso, parseSkDate, durationMinutes, formatMinutes } from "./lib/utils.js";
import { computeProductionIssues, computeStockLevels, materialShortages } from "./lib/inventory.js";
import { isPlanZmenaActive, formatZmenaText } from "./lib/planZmena.js";

const PRODUCTION_LINKY = [
  { value: "sacky", label: "Sáčky (fólie)" },
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
  kvalita: { badge: "from-rose-400 to-rose-600", shadow: "shadow-rose-500/40" },
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
  const [produktSearch, setProduktSearch] = useState("");

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
  const linkaProductsFiltered = produktSearch.trim()
    ? linkaProducts.filter((p) => productLabel(p).toLowerCase().includes(produktSearch.trim().toLowerCase()))
    : linkaProducts;
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
    setProduktSearch("");
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
      console.error(e);
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
            <>
              {linkaProducts.length > 8 && (
                <input
                  value={produktSearch}
                  onChange={(e) => setProduktSearch(e.target.value)}
                  placeholder="Hledat produkt..."
                  className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              )}
              {linkaProductsFiltered.length === 0 ? (
                <div className="text-sm text-slate-400 mb-3">Nic nenalezeno.</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3 max-h-72 overflow-y-auto">
                  {linkaProductsFiltered.map((p) => (
                    <button key={p.id} onClick={() => { setProduktId(p.id); setPotvrdenyNedostatok(false); }} className={bigBtn + " " + (produktId === p.id ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>
                      {productLabel(p)}
                    </button>
                  ))}
                </div>
              )}
            </>
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

function emptyCcpForm() {
  return { zkontrolovala: "", zkontrolovalaId: "", fe: "", nonFe: "", ss: "", naprava: "" };
}

function emptySmenaForm() {
  return { linka: "", zkontrolovala: "", zkontrolovalaId: "", fe: "", nonFe: "", ss: "", naprava: "" };
}

// Hranica zmeny sa posúva o 5 minút skôr (05:55/17:55), aby upozornenie na
// kontrolu naskočilo ešte pred oficiálnym začiatkom zmeny, nie až po ňom.
function dnesnaSmena() {
  const mins = new Date().getHours() * 60 + new Date().getMinutes();
  const denOd = 6 * 60 - 5;
  const nocOd = 18 * 60 - 5;
  return mins >= denOd && mins < nocOd ? "den" : "noc";
}

function PrehladTab() {
  const [plan, setPlan] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [ccpKontroly, setCcpKontroly] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState(null);
  const pollRef = useRef(null);

  const [ccpOpenId, setCcpOpenId] = useState(null);
  const [ccpForm, setCcpForm] = useState(emptyCcpForm());
  const [ccpError, setCcpError] = useState("");
  const [ccpSaving, setCcpSaving] = useState(false);

  const [ccpSmenaOpen, setCcpSmenaOpen] = useState(false);
  const [ccpSmenaForm, setCcpSmenaForm] = useState(emptySmenaForm());
  const [ccpSmenaError, setCcpSmenaError] = useState("");
  const [ccpSmenaSaving, setCcpSmenaSaving] = useState(false);

  const [zdrzaneHotovo, setZdrzaneHotovo] = useState(() => new Set());
  const zdrzaneTimeoutsRef = useRef(new Map());

  useEffect(() => {
    const timeouts = zdrzaneTimeoutsRef.current;
    return () => {
      timeouts.forEach((t) => clearTimeout(t));
      timeouts.clear();
    };
  }, []);

  const fetchPlan = useCallback(async () => {
    const [planRes, workersRes, ccpRes] = await Promise.all([
      supabase.from("production_plan").select("*"),
      supabase.from("workers").select("*"),
      supabase.from("ccp_kontroly").select("*").order("created_at", { ascending: false }),
    ]);
    if (planRes.error) {
      setError("Nepodařilo se načíst výrobní plán.");
      return;
    }
    setError("");
    setPlan((planRes.data || []).map((row) => row.data));
    if (!workersRes.error) setWorkers((workersRes.data || []).map((row) => row.data).filter((w) => w.typ === "vyroba"));
    if (!ccpRes.error) setCcpKontroly((ccpRes.data || []).map((row) => row.data));
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
    if (stavVyroby === "hotovo" && row.stavVyroby !== "hotovo") {
      setZdrzaneHotovo((prev) => new Set(prev).add(row.id));
      const t = setTimeout(() => {
        setZdrzaneHotovo((prev) => {
          const next2 = new Set(prev);
          next2.delete(row.id);
          return next2;
        });
        zdrzaneTimeoutsRef.current.delete(row.id);
      }, 5000);
      zdrzaneTimeoutsRef.current.set(row.id, t);
    }
    const { error: updateError } = await supabase.from("production_plan").update({ data: next }).eq("id", row.id);
    setSavingId(null);
    if (updateError) {
      setError("Změna stavu se nezdařila, zkuste to znovu.");
      await fetchPlan();
      return;
    }
    if (stavVyroby === "prebieha" && !ccpKontroly.some((k) => k.planId === row.id)) {
      setCcpOpenId(row.id);
      setCcpForm(emptyCcpForm());
      setCcpError("");
    }
  }

  async function saveCcp(row) {
    if (!ccpForm.zkontrolovala) { setCcpError("Vyberte, kdo kontrolu provedl."); return; }
    if (!ccpForm.fe || !ccpForm.nonFe || !ccpForm.ss) { setCcpError("Vyplňte výsledek u všech tří parametrů (Fe, NonFe, S/S)."); return; }
    const maNeshodu = ccpForm.fe === "ne" || ccpForm.nonFe === "ne" || ccpForm.ss === "ne";
    if (maNeshodu && !ccpForm.naprava.trim()) { setCcpError("Popište nápravné opatření."); return; }
    setCcpError("");
    setCcpSaving(true);
    const id = uid();
    const record = {
      id,
      typ: "zmena_produktu",
      planId: row.id,
      produktNazov: row.produktNazov,
      linka: row.linka,
      datum: todayStr(),
      cas: nowTimeStr(),
      zkontrolovala: ccpForm.zkontrolovala,
      zkontrolovalaId: ccpForm.zkontrolovalaId || null,
      fe: ccpForm.fe,
      nonFe: ccpForm.nonFe,
      ss: ccpForm.ss,
      vysledek: maNeshodu ? "neshoda" : "ok",
      naprava: maNeshodu ? ccpForm.naprava.trim() : "",
    };
    try {
      const { error: insErr } = await supabase.from("ccp_kontroly").insert({ id, data: record });
      if (insErr) throw insErr;
      setCcpKontroly((prev) => [record, ...prev]);
      setCcpOpenId(null);
      setCcpForm(emptyCcpForm());
    } catch (e) {
      console.error(e);
      setCcpError("Uložení se nezdařilo, zkuste to znovu.");
    }
    setCcpSaving(false);
  }

  function openCcpSmena() {
    setCcpSmenaOpen(true);
    setCcpSmenaForm(emptySmenaForm());
    setCcpSmenaError("");
  }

  async function saveCcpSmena() {
    if (!ccpSmenaForm.linka) { setCcpSmenaError("Vyberte linku."); return; }
    if (!ccpSmenaForm.zkontrolovala) { setCcpSmenaError("Vyberte, kdo kontrolu provedl."); return; }
    if (!ccpSmenaForm.fe || !ccpSmenaForm.nonFe || !ccpSmenaForm.ss) { setCcpSmenaError("Vyplňte výsledek u všech tří parametrů (Fe, NonFe, S/S)."); return; }
    const maNeshodu = ccpSmenaForm.fe === "ne" || ccpSmenaForm.nonFe === "ne" || ccpSmenaForm.ss === "ne";
    if (maNeshodu && !ccpSmenaForm.naprava.trim()) { setCcpSmenaError("Popište nápravné opatření."); return; }
    setCcpSmenaError("");
    setCcpSmenaSaving(true);
    const id = uid();
    const activePlan = plan.find((p) => p.linka === ccpSmenaForm.linka && p.stavVyroby === "prebieha")
      || plan.find((p) => p.linka === ccpSmenaForm.linka && p.datum === todayStr() && p.stavVyroby !== "hotovo");
    const record = {
      id,
      typ: "zaciatok_zmeny",
      planId: activePlan ? activePlan.id : null,
      produktNazov: activePlan ? activePlan.produktNazov : "",
      produktId: activePlan ? activePlan.produktId : "",
      linka: ccpSmenaForm.linka,
      smena: dnesnaSmena(),
      datum: todayStr(),
      cas: nowTimeStr(),
      zkontrolovala: ccpSmenaForm.zkontrolovala,
      zkontrolovalaId: ccpSmenaForm.zkontrolovalaId || null,
      fe: ccpSmenaForm.fe,
      nonFe: ccpSmenaForm.nonFe,
      ss: ccpSmenaForm.ss,
      vysledek: maNeshodu ? "neshoda" : "ok",
      naprava: maNeshodu ? ccpSmenaForm.naprava.trim() : "",
    };
    try {
      const { error: insErr } = await supabase.from("ccp_kontroly").insert({ id, data: record });
      if (insErr) throw insErr;
      setCcpKontroly((prev) => [record, ...prev]);
      setCcpSmenaOpen(false);
      setCcpSmenaForm(emptySmenaForm());
    } catch (e) {
      console.error(e);
      setCcpSmenaError("Uložení se nezdařilo, zkuste to znovu.");
    }
    setCcpSmenaSaving(false);
  }

  if (loading) {
    return (
      <div className="text-center text-slate-400 py-10">
        <Loader2 className="animate-spin mx-auto mb-2" size={24} /> Načítám...
      </div>
    );
  }

  const sortedPlan = plan.slice().sort((a, b) => {
    const aHotovo = (a.stavVyroby || "caka") === "hotovo" && !zdrzaneHotovo.has(a.id) ? 1 : 0;
    const bHotovo = (b.stavVyroby || "caka") === "hotovo" && !zdrzaneHotovo.has(b.id) ? 1 : 0;
    if (aHotovo !== bHotovo) return aHotovo - bHotovo;
    return (parseSkDate(a.datum) || 0) - (parseSkDate(b.datum) || 0);
  });
  const smena = dnesnaSmena();
  const today = todayStr();
  const smenoveKontroly = ccpKontroly.filter((k) => k.typ === "zaciatok_zmeny" && k.datum === today && k.smena === smena);
  const chybaKontrola = smenoveKontroly.length === 0;

  return (
    <div>
      {error && (
        <div className="mb-3 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-md flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <div className={"rounded-xl p-3 mb-4 border-2 " + (chybaKontrola ? "bg-red-50 border-red-400 animate-pulse" : "bg-white border-slate-200")}>
        {chybaKontrola ? (
          <>
            <div className="text-sm font-semibold mb-1 text-red-700">Kontrola detektoru kovu - začátek směny ({smena === "den" ? "denní" : "noční"})</div>
            <div className="text-xs mb-3 text-red-600">Kontrolu udělá kdokoliv, kdo na dané lince začíná směnu - nezáleží na tom, kdo je naplánovaný.</div>
          </>
        ) : (
          <div className="flex items-center gap-1.5 flex-wrap text-xs mb-2">
            <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
            <span className="font-medium text-slate-500">Detektor kovu ({smena === "den" ? "denní" : "noční"}):</span>
            {smenoveKontroly.map((k) => (
              <span key={k.id} className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                {(PRODUCTION_LINKY.find((l) => l.value === k.linka) || {}).label || k.linka} {k.zkontrolovala} {k.cas}
              </span>
            ))}
          </div>
        )}

        {!ccpSmenaOpen ? (
          <button
            onClick={openCcpSmena}
            className={
              chybaKontrola
                ? "text-xs font-semibold px-3 py-2 rounded-lg border-2 border-red-500 text-white bg-red-600 hover:bg-red-700 animate-pulse"
                : "text-xs font-medium text-teal-700 hover:text-teal-900"
            }
          >
            {chybaKontrola ? "Zkontrolovat" : "+ Přidat kontrolu (např. změna linky)"}
          </button>
        ) : (
          <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-3">
            <div className="text-xs text-slate-500 mb-1">Linka</div>
            <div className="flex flex-wrap gap-2 mb-3">
              {PRODUCTION_LINKY.map((l) => (
                <button key={l.value} onClick={() => setCcpSmenaForm((p) => ({ ...p, linka: l.value }))} className={"text-xs font-semibold px-2.5 py-1.5 rounded-lg border-2 " + (ccpSmenaForm.linka === l.value ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>
                  {l.label}
                </button>
              ))}
            </div>
            <div className="text-xs text-slate-500 mb-1">Kdo kontrolu provedl</div>
            <div className="flex flex-wrap gap-2 mb-3">
              {workers.map((w) => (
                <button key={w.id} onClick={() => setCcpSmenaForm((p) => ({ ...p, zkontrolovala: w.meno, zkontrolovalaId: w.id }))} className={"text-xs font-semibold px-2.5 py-1.5 rounded-lg border-2 " + (ccpSmenaForm.zkontrolovala === w.meno ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>
                  {w.meno}
                </button>
              ))}
            </div>
            {[{ key: "fe", label: "Fe (železo)" }, { key: "nonFe", label: "NonFe (neželezné kovy)" }, { key: "ss", label: "S/S (nerez)" }].map((p) => (
              <div key={p.key} className="flex items-center justify-between mb-2">
                <div className="text-sm text-slate-700">{p.label}</div>
                <div className="flex gap-1.5">
                  <button onClick={() => setCcpSmenaForm((f) => ({ ...f, [p.key]: "ano" }))} className={"text-xs font-semibold px-3 py-1.5 rounded-lg border-2 " + (ccpSmenaForm[p.key] === "ano" ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-600 border-slate-200")}>ANO</button>
                  <button onClick={() => setCcpSmenaForm((f) => ({ ...f, [p.key]: "ne" }))} className={"text-xs font-semibold px-3 py-1.5 rounded-lg border-2 " + (ccpSmenaForm[p.key] === "ne" ? "bg-red-600 text-white border-red-600" : "bg-white text-slate-600 border-slate-200")}>NE</button>
                </div>
              </div>
            ))}
            {(ccpSmenaForm.fe === "ne" || ccpSmenaForm.nonFe === "ne" || ccpSmenaForm.ss === "ne") && (
              <div className="mb-2">
                <div className="text-xs text-slate-500 mb-1">Nápravné opatření</div>
                <textarea
                  value={ccpSmenaForm.naprava}
                  onChange={(e) => setCcpSmenaForm((f) => ({ ...f, naprava: e.target.value }))}
                  rows={2}
                  className="w-full border-2 border-slate-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                />
              </div>
            )}
            {ccpSmenaError && <div className="mb-2 text-xs text-red-700 flex items-center gap-1.5"><AlertCircle size={12} /> {ccpSmenaError}</div>}
            <div className="flex gap-2">
              <button onClick={() => setCcpSmenaOpen(false)} className="text-xs text-slate-500 px-3 py-2">Zrušit</button>
              <button
                onClick={saveCcpSmena}
                disabled={ccpSmenaSaving}
                className="flex-1 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2.5 rounded-lg flex items-center justify-center gap-1.5"
              >
                {ccpSmenaSaving ? <Loader2 size={16} className="animate-spin" /> : null} Uložit kontrolu
              </button>
            </div>
          </div>
        )}
      </div>

      <h2 className="text-sm font-semibold text-slate-500 mb-2">Výrobní plán</h2>
      {sortedPlan.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-slate-400 text-sm">Zatím žádné položky ve výrobním plánu.</div>
      ) : (
        <div className="space-y-3">
          {sortedPlan.map((r) => {
            const stav = r.stavVyroby || "caka";
            const zmenene = new Set(r.zmenenePolia || []);
            const jeZmenene = isPlanZmenaActive(r);
            const zmCls = (pole) => (jeZmenene && zmenene.has(pole) ? "text-red-600 font-semibold" : "");
            const zmenaText = formatZmenaText(r);
            const jeHotovo = stav === "hotovo" && !zdrzaneHotovo.has(r.id);
            const jePrebieha = stav === "prebieha";
            return (
              <div key={r.id} className={"border rounded-xl p-4 " + (jeZmenene ? "bg-white border-red-400 border-2" : jeHotovo ? "bg-emerald-50 border-emerald-100" : jePrebieha ? "bg-blue-50 border-blue-200" : "bg-white border-slate-200")}>
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
                {jeZmenene && zmenaText && (
                  <div className="text-xs text-red-600 mb-3 -mt-2">{zmenaText}</div>
                )}
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
                {(() => {
                  const ccp = ccpKontroly.find((k) => k.planId === r.id);
                  if (ccp) {
                    return (
                      <div className={"mt-3 rounded-lg px-3 py-2.5 text-sm " + (ccp.vysledek === "neshoda" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700")}>
                        <div className="font-semibold">
                          CCP detektor kovu: {ccp.vysledek === "neshoda" ? "NESHODA" : "OK"} - Fe {ccp.fe.toUpperCase()}, NonFe {ccp.nonFe.toUpperCase()}, S/S {ccp.ss.toUpperCase()}
                        </div>
                        <div className="text-xs opacity-80">{ccp.datum} {ccp.cas} - {ccp.zkontrolovala}</div>
                        {ccp.vysledek === "neshoda" && <div className="text-xs mt-1">Náprava: {ccp.naprava}</div>}
                      </div>
                    );
                  }
                  if (ccpOpenId === r.id) {
                    return (
                      <div className="mt-3 rounded-lg border-2 border-amber-300 bg-amber-50 p-3">
                        <div className="text-sm font-semibold text-amber-800 mb-2">CCP kontrola detektoru kovu (zahájení výroby)</div>
                        <div className="text-xs text-slate-500 mb-1">Kdo kontrolu provedl</div>
                        <div className="flex flex-wrap gap-2 mb-3">
                          {workers.map((w) => (
                            <button key={w.id} onClick={() => setCcpForm((p) => ({ ...p, zkontrolovala: w.meno, zkontrolovalaId: w.id }))} className={"text-xs font-semibold px-2.5 py-1.5 rounded-lg border-2 " + (ccpForm.zkontrolovala === w.meno ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>
                              {w.meno}
                            </button>
                          ))}
                        </div>
                        {[{ key: "fe", label: "Fe (železo)" }, { key: "nonFe", label: "NonFe (neželezné kovy)" }, { key: "ss", label: "S/S (nerez)" }].map((p) => (
                          <div key={p.key} className="flex items-center justify-between mb-2">
                            <div className="text-sm text-slate-700">{p.label}</div>
                            <div className="flex gap-1.5">
                              <button onClick={() => setCcpForm((f) => ({ ...f, [p.key]: "ano" }))} className={"text-xs font-semibold px-3 py-1.5 rounded-lg border-2 " + (ccpForm[p.key] === "ano" ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-600 border-slate-200")}>ANO</button>
                              <button onClick={() => setCcpForm((f) => ({ ...f, [p.key]: "ne" }))} className={"text-xs font-semibold px-3 py-1.5 rounded-lg border-2 " + (ccpForm[p.key] === "ne" ? "bg-red-600 text-white border-red-600" : "bg-white text-slate-600 border-slate-200")}>NE</button>
                            </div>
                          </div>
                        ))}
                        {(ccpForm.fe === "ne" || ccpForm.nonFe === "ne" || ccpForm.ss === "ne") && (
                          <div className="mb-2">
                            <div className="text-xs text-slate-500 mb-1">Nápravné opatření</div>
                            <textarea
                              value={ccpForm.naprava}
                              onChange={(e) => setCcpForm((f) => ({ ...f, naprava: e.target.value }))}
                              rows={2}
                              className="w-full border-2 border-slate-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                            />
                          </div>
                        )}
                        {ccpError && <div className="mb-2 text-xs text-red-700 flex items-center gap-1.5"><AlertCircle size={12} /> {ccpError}</div>}
                        <button
                          onClick={() => saveCcp(r)}
                          disabled={ccpSaving}
                          className="w-full bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2.5 rounded-lg flex items-center justify-center gap-1.5"
                        >
                          {ccpSaving ? <Loader2 size={16} className="animate-spin" /> : null} Uložit kontrolu
                        </button>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------- Docházka ---------------- */

const DOCHAZKA_MODES = {
  prichod: {
    table: "prestavky",
    uvod: "Ťukněte na své jméno - zaznamená se váš příchod nebo odchod",
    aktivniLabel: "v práci",
    praveNadpis: "Právě v práci",
    dnesniNadpis: "Dnešní docházka",
    prazdnyText: "Dnes zatím žádný záznam docházky.",
    potvrdText: "záznam docházky",
    btnActive: "bg-amber-500 text-white border-amber-500",
    listBg: "bg-amber-50 border-amber-200",
    listBorder: "border-amber-100",
    textColor: "text-amber-700",
    probihaColor: "text-amber-600",
    hlidatStare: true,
  },
  pauza: {
    table: "pauzy",
    uvod: "Ťukněte na své jméno - začne nebo skončí vaše přestávka",
    aktivniLabel: "na přestávce",
    praveNadpis: "Právě na přestávce",
    dnesniNadpis: "Dnešní přestávky",
    prazdnyText: "Dnes zatím žádné přestávky.",
    potvrdText: "záznam přestávky",
    btnActive: "bg-orange-500 text-white border-orange-500",
    listBg: "bg-orange-50 border-orange-200",
    listBorder: "border-orange-100",
    textColor: "text-orange-700",
    probihaColor: "text-orange-600",
    hlidatStare: false,
  },
};

function DochazkaTab() {
  const [mode, setMode] = useState("prichod");
  const [workers, setWorkers] = useState([]);
  const [prestavky, setPrestavky] = useState([]);
  const [pauzy, setPauzy] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyMeno, setBusyMeno] = useState("");
  const [pinTarget, setPinTarget] = useState(null);
  const [pinHasExisting, setPinHasExisting] = useState(false);
  const [pinValue, setPinValue] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const pollRef = useRef(null);

  const fetchAll = useCallback(async () => {
    const [workersRes, prestavkyRes, pauzyRes] = await Promise.all([
      supabase.from("workers").select("*"),
      supabase.from("prestavky").select("*").order("created_at", { ascending: false }),
      supabase.from("pauzy").select("*").order("created_at", { ascending: false }),
    ]);
    if (workersRes.error || prestavkyRes.error || pauzyRes.error) {
      setError("Nepodařilo se načíst data.");
      return;
    }
    setError("");
    setWorkers((workersRes.data || []).map((row) => row.data).filter((w) => w.typ === "vyroba"));
    setPrestavky((prestavkyRes.data || []).map((row) => row.data));
    setPauzy((pauzyRes.data || []).map((row) => row.data));
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

  const cfg = DOCHAZKA_MODES[mode];
  const records = mode === "prichod" ? prestavky : pauzy;

  // Ak zaznam ma workerId, paruje sa prednostne cez neho (nie cez meno) - dvaja
  // pracovnici s rovnakym menom by sa inak vzajomne "krizili" v aktivnom stave.
  // Stare zaznamy bez workerId (zapisane pred zavedenim tohto pola) sa stale
  // paruju cez meno, aby sa nezobrazovali ako navzdy "otvorene".
  function activeFor(meno, workerId) {
    return records.find((p) => !p.casKonca && (workerId && p.workerId ? p.workerId === workerId : p.meno === meno));
  }

  async function deleteRecord(id) {
    if (!window.confirm(`Opravdu smazat tento ${cfg.potvrdText}? (např. omylem ťuknuté jméno)`)) return;
    setError("");
    try {
      const { error: delErr } = await supabase.from(cfg.table).delete().eq("id", id);
      if (delErr) throw delErr;
      await fetchAll();
    } catch (e) {
      console.error(e);
      setError("Smazání se nezdařilo, zkuste to znovu.");
    }
  }

  async function toggle(meno, workerId) {
    setBusyMeno(meno);
    setError("");
    const activeRec = activeFor(meno, workerId);
    try {
      if (activeRec) {
        const next = { ...activeRec, casKonca: nowTimeStr() };
        const { error: updErr } = await supabase.from(cfg.table).update({ data: next }).eq("id", activeRec.id);
        if (updErr) throw updErr;
      } else {
        const id = uid();
        const record = { id, meno, workerId: workerId || null, datum: todayStr(), casZaciatku: nowTimeStr(), casKonca: "" };
        const { error: insErr } = await supabase.from(cfg.table).insert({ id, data: record });
        if (insErr) throw insErr;
      }
      await fetchAll();
    } catch (e) {
      console.error(e);
      setError("Nepodařilo se uložit, zkuste to znovu.");
    }
    setBusyMeno("");
  }

  async function requestToggle(w) {
    setError("");
    const { data: hasPin, error: hasErr } = await supabase.rpc("dochadzka_has_worker_pin", { p_worker_id: w.id });
    if (hasErr) { setError("Chyba připojení, zkuste to znovu."); return; }
    setPinTarget(w);
    setPinHasExisting(!!hasPin);
    setPinValue("");
    setPinError("");
  }

  async function confirmPin() {
    if (!pinTarget) return;
    if (!pinHasExisting) {
      if (!pinValue || pinValue.length < 4) { setPinError("PIN musí mít alespoň 4 znaky."); return; }
      setPinBusy(true);
      const { data: set, error } = await supabase.rpc("dochadzka_set_worker_pin", { p_worker_id: pinTarget.id, p_pin: pinValue });
      setPinBusy(false);
      if (error || !set) { setPinError("Nepodařilo se uložit PIN, zkuste to znovu."); return; }
      const w = pinTarget;
      setPinTarget(null);
      await toggle(w.meno, w.id);
      return;
    }
    setPinBusy(true);
    const { data: ok, error } = await supabase.rpc("dochadzka_verify_worker_pin", { p_worker_id: pinTarget.id, p_pin: pinValue });
    setPinBusy(false);
    if (error) { setPinError("Chyba připojení, zkuste to znovu."); return; }
    if (!ok) { setPinError("Nesprávný PIN."); setPinValue(""); return; }
    const w = pinTarget;
    setPinTarget(null);
    await toggle(w.meno, w.id);
  }

  if (loading) {
    return (
      <div className="text-center text-slate-400 py-10">
        <Loader2 className="animate-spin mx-auto mb-2" size={24} /> Načítám...
      </div>
    );
  }

  const today = todayStr();
  const todayRecords = records.filter((p) => p.datum === today).sort((a, b) => (b.casZaciatku || "").localeCompare(a.casZaciatku || ""));
  const active = cfg.hlidatStare
    ? records.filter((p) => !p.casKonca).sort((a, b) => ((parseSkDate(b.datum)?.getTime() || 0) - (parseSkDate(a.datum)?.getTime() || 0)) || (b.casZaciatku || "").localeCompare(a.casZaciatku || ""))
    : todayRecords.filter((p) => !p.casKonca);

  return (
    <div>
      <div className="flex gap-1.5 mb-4">
        <button
          onClick={() => setMode("prichod")}
          className={
            "flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold px-3 py-2.5 rounded-lg border-2 transition-colors " +
            (mode === "prichod" ? "bg-amber-500 text-white border-amber-500 shadow-sm" : "bg-white text-slate-500 border-slate-200")
          }
        >
          <LogIn size={16} /> Příchod / odchod
        </button>
        <button
          onClick={() => setMode("pauza")}
          className={
            "flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold px-3 py-2.5 rounded-lg border-2 transition-colors " +
            (mode === "pauza" ? "bg-orange-500 text-white border-orange-500 shadow-sm" : "bg-white text-slate-500 border-slate-200")
          }
        >
          <Coffee size={16} /> Přestávky
        </button>
      </div>

      {error && (
        <div className="mb-3 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-md flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <div className={"mb-4 text-sm font-medium px-3 py-2.5 rounded-lg border flex items-center gap-2 " + (mode === "prichod" ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-orange-50 border-orange-200 text-orange-800")}>
        {mode === "prichod" ? <LogIn size={16} className="shrink-0" /> : <Coffee size={16} className="shrink-0" />}
        {cfg.uvod}
      </div>
      {workers.length === 0 ? (
        <div className="text-sm text-slate-400 mb-5">Zatím žádní pracovníci (doplní office v Pracovnících).</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-5">
          {workers.map((w) => {
            const isActive = !!activeFor(w.meno, w.id);
            return (
              <button
                key={w.id}
                onClick={() => requestToggle(w)}
                disabled={busyMeno === w.meno}
                className={
                  "text-base font-semibold px-4 py-3.5 rounded-xl border-2 text-center active:scale-[0.98] transition-transform disabled:opacity-60 " +
                  (isActive ? cfg.btnActive : "bg-white text-slate-700 border-slate-200")
                }
              >
                {w.meno}
                {isActive && <div className="text-xs font-normal mt-0.5">{cfg.aktivniLabel}</div>}
              </button>
            );
          })}
        </div>
      )}

      {active.length > 0 && (
        <div className="mb-5">
          <h2 className="text-sm font-semibold text-slate-500 mb-2">{cfg.praveNadpis}</h2>
          <div className="border rounded-lg overflow-hidden">
            {active.map((p) => {
              const jeStare = cfg.hlidatStare && p.datum !== today;
              return (
                <div key={p.id} className={"px-4 py-2.5 border-t first:border-t-0 flex items-center justify-between gap-2 " + (jeStare ? "bg-red-50 border-red-100" : cfg.listBg + " " + cfg.listBorder)}>
                  <div className="font-medium text-sm">{p.meno}</div>
                  <div className="flex items-center gap-2">
                    <div className={"text-sm " + (jeStare ? "text-red-700" : cfg.textColor)}>
                      od {jeStare ? p.datum + " " : ""}{p.casZaciatku}{jeStare ? " - nezapomenutý odchod?" : ""}
                    </div>
                    <button onClick={() => deleteRecord(p.id)} title="Zrušit (omylem ťuknuté)" className={(jeStare ? "text-red-700" : cfg.textColor) + " hover:text-red-600 p-1"}>
                      <X size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-slate-500 mb-2">{cfg.dnesniNadpis}</h2>
        {todayRecords.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm">{cfg.prazdnyText}</div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            {todayRecords.map((p) => {
              const mins = durationMinutes(p.casZaciatku, p.casKonca);
              return (
                <div key={p.id} className="px-4 py-2.5 border-t border-slate-100 first:border-t-0 flex items-center justify-between gap-2">
                  <div className="font-medium text-sm">{p.meno}</div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm text-slate-500">
                      {p.casZaciatku} - {p.casKonca || <span className={cfg.probihaColor + " font-medium"}>probíhá</span>}
                      {mins !== null && <span className="text-slate-400"> ({formatMinutes(mins)})</span>}
                    </div>
                    <button onClick={() => deleteRecord(p.id)} title="Smazat záznam" className="text-slate-400 hover:text-red-600 p-1">
                      <X size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {pinTarget && (
        <PinPrompt
          worker={pinTarget}
          hasExisting={pinHasExisting}
          value={pinValue}
          onChange={setPinValue}
          error={pinError}
          busy={pinBusy}
          onSubmit={confirmPin}
          onCancel={() => setPinTarget(null)}
        />
      )}
    </div>
  );
}

function PinPrompt({ worker, hasExisting, value, onChange, error, busy, onSubmit, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl p-5 w-full max-w-xs">
        <div className="text-base font-semibold mb-1">{worker.meno}</div>
        <div className="text-xs text-slate-500 mb-3">
          {hasExisting ? "Zadejte svůj PIN pro potvrzení." : "Poprvé - zvolte si PIN (alespoň 4 znaky), příště se jím ověříte."}
        </div>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 8))}
          onKeyDown={(e) => { if (e.key === "Enter") onSubmit(); }}
          className="w-full border-2 border-slate-200 rounded-lg px-3 py-3 text-center text-2xl tracking-widest mb-2"
          placeholder="••••"
        />
        {error && <div className="text-red-600 text-xs mb-2">{error}</div>}
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 text-sm text-slate-500 px-3 py-2 rounded-md border border-slate-200">Zrušit</button>
          <button onClick={onSubmit} disabled={busy} className="flex-1 bg-slate-800 hover:bg-slate-900 disabled:opacity-60 text-white text-sm font-semibold px-3 py-2 rounded-md">
            {busy ? "..." : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}

function KontrolaKvalityTab() {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-slate-500">
      <Construction size={28} className="mx-auto mb-3 text-slate-300" />
      Tato sekce se připravuje - obsah doplníme později.
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
            <VyrobaTabButton active={tab === "prestavky"} onClick={() => setTab("prestavky")} color="prestavky" icon={<Coffee size={20} />} label="Docházka" />
            <VyrobaTabButton active={tab === "kvalita"} onClick={() => setTab("kvalita")} color="kvalita" icon={<ClipboardCheck size={20} />} label="Kontrola kvality" />
          </nav>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {tab === "prehlad" ? <PrehladTab /> : tab === "vyroba" ? <VyrobaFormTab fullName={fullName} /> : tab === "prestavky" ? <DochazkaTab /> : <KontrolaKvalityTab />}
      </main>
    </div>
  );
}
