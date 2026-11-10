// PDA / Expedice - prehlad v Stenger ONE (Office). Vydajky naskenovane na
// PDA (?pda=1), palety (SSCC, GTIN, BBD, sarza, mnozstvo), suhrn a export.
// Data si nacitava sam cez PDA API (nie cez OfficeApp), zmeny prichadzaju
// cez realtime. V testovacom rezime (?pda=test) dostane simulovane API.
//
// Excel export je zatial PRACOVNA verzia (lib/pdaExport.js) - presny format
// MAXIM sa doplni, ked bude k dispozicii vzorovy subor.

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Loader2, AlertCircle, Search, Download, ChevronDown, ChevronRight, RotateCcw, Trash2, PackageCheck, Clock, Smartphone, FileSpreadsheet } from "lucide-react";
import { supabase } from "../supabaseClient.js";
import { formatDateTime } from "../lib/utils.js";
import { exportSheetsToExcel } from "../lib/exportExcel.js";
import { pdaErrorMessage, summarizePallets } from "../lib/pdaScan.js";
import { buildPdaExportSheets, formatIsoDate as formatDate, buildNveListData, downloadNveList } from "../lib/pdaExport.js";
import { createSupabasePdaApi } from "./pdaApi.js";
import PdaDohladatelnost from "./PdaDohladatelnost.jsx";
import { kratkyNazov } from "../lib/pdaObjednavka.js";

function localIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localIso(d);
}

function StavBadge({ stav }) {
  return stav === "dokoncena" ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200"><PackageCheck size={12} /> Dokončená</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200"><Clock size={12} /> Rozpracovaná</span>
  );
}

export default function PdaOfficeView({ api: apiProp }) {
  const api = useMemo(() => apiProp || createSupabasePdaApi(supabase), [apiProp]);
  const [zalozka, setZalozka] = useState("vydajky");
  const tlacidlo = (id, text) => (
    <button onClick={() => setZalozka(id)} className={"px-3 py-2 text-sm font-medium border-b-2 " + (zalozka === id ? "border-teal-700 text-teal-800" : "border-transparent text-slate-500 hover:text-slate-800")}>{text}</button>
  );
  return (
    <div>
      <div className="flex gap-1 border-b border-slate-200 mb-4">
        {tlacidlo("vydajky", "Výdejky")}
        {tlacidlo("dohledatelnost", "Dohledatelnost")}
      </div>
      {zalozka === "vydajky" ? <PrehledVydajek api={api} /> : <PdaDohladatelnost api={api} />}
    </div>
  );
}

function PrehledVydajek({ api }) {
  const [vydajky, setVydajky] = useState(null);
  const [palety, setPalety] = useState([]);
  const [error, setError] = useState("");
  const [hladat, setHladat] = useState("");
  const [stav, setStav] = useState("");
  // "Od" obmedzuje aj nacitanie z DB (nie len filter), aby sa s rastucou
  // historiou nenacitavalo vsetko.
  const [od, setOd] = useState(() => isoDaysAgo(90));
  const [do_, setDo] = useState("");
  const [openId, setOpenId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [products, setProducts] = useState([]);
  const [nveInfo, setNveInfo] = useState(null); // { vydajkaId, text, tone }
  const reloadTimer = useRef(null);

  // Produkty (cislo artikla SW, nazov, EAN karton) pre NVE list.
  useEffect(() => {
    let cancelled = false;
    api.listProducts().then(({ data }) => { if (!cancelled && data) setProducts(data); });
    return () => { cancelled = true; };
  }, [api]);

  const load = useCallback(async () => {
    const odTs = od ? new Date(od + "T00:00:00").toISOString() : null;
    const [vRes, pRes] = await Promise.all([api.listVydajkyOd(odTs), api.listPaletyOd(odTs)]);
    if (vRes.error || pRes.error) {
      setError(pdaErrorMessage(vRes.error || pRes.error));
      return;
    }
    setError("");
    setVydajky(vRes.data || []);
    setPalety(pRes.data || []);
  }, [api, od]);

  useEffect(() => {
    load();
    const unsubscribe = api.subscribe(() => {
      clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(load, 400);
    });
    return () => {
      clearTimeout(reloadTimer.current);
      unsubscribe();
    };
  }, [api, load]);

  const paletyPodla = useMemo(() => {
    const m = new Map();
    for (const p of palety) {
      if (!m.has(p.vydajka_id)) m.set(p.vydajka_id, []);
      m.get(p.vydajka_id).push(p);
    }
    return m;
  }, [palety]);

  const filtered = useMemo(() => {
    const q = hladat.trim().toLowerCase();
    return (vydajky || []).filter((v) => {
      if (stav && v.stav !== stav) return false;
      const den = localIso(new Date(v.created_at));
      if (od && den < od) return false;
      if (do_ && den > do_) return false;
      if (!q) return true;
      if (String(v.cislo_lieferschein).toLowerCase().includes(q) || String(v.pracovnik).toLowerCase().includes(q)) return true;
      return (paletyPodla.get(v.id) || []).some((p) => p.sscc.includes(q) || (p.gtin || "").includes(q) || String(p.sarza || "").toLowerCase().includes(q));
    });
  }, [vydajky, paletyPodla, hladat, stav, od, do_]);

  async function znovuOtvorit(v) {
    setBusyId(v.id);
    const { data, error: err } = await api.reopenVydajka(v.id);
    setBusyId(null);
    if (err || !data) setError(pdaErrorMessage(err) || "Změna nebyla potvrzena.");
    else load();
  }

  async function smazat(v) {
    setConfirmDeleteId(null);
    setBusyId(v.id);
    const { data, error: err } = await api.deleteVydajka(v.id);
    setBusyId(null);
    if (err || !data || data.length !== 1) setError(pdaErrorMessage(err) || "Smazání nebylo potvrzeno.");
    else load();
  }

  async function exportExcel() {
    await exportSheetsToExcel(buildPdaExportSheets(filtered, palety), api.isDemo ? "PDA_TEST_vydejky_prehled" : "PDA_vydejky_prehled");
  }

  // NVE LIST vo formate MAXIM pre jednu vydajku (subor <LS>.xlsx).
  async function nveList(v) {
    const nve = buildNveListData(v, palety, { products });
    const { bezProduktu, bezMnozstva } = nve.upozornenia;
    const varovania = [];
    if (bezProduktu.length) varovania.push(`GTIN bez produktu v Stenger ONE (chybí číslo artiklu a název): ${bezProduktu.join(", ")} – doplňte „EAN karton“ u produktu.`);
    if (bezMnozstva) varovania.push(`${bezMnozstva} palet bez množství (AI 37).`);
    if (v.stav !== "dokoncena") varovania.push("Výdejka ještě není dokončená.");
    await downloadNveList(nve);
    setNveInfo({ vydajkaId: v.id, tone: varovania.length ? "warn" : "ok", text: varovania.length ? varovania.join(" ") : `NVE list ${nve.cislo} stažen (${nve.palet} palet).` });
  }

  const pdaUrl = `${window.location.origin}${import.meta.env.BASE_URL}?pda=1`;

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h1 className="text-xl font-semibold">PDA / Expedice</h1>
        <button onClick={exportExcel} disabled={!vydajky} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-medium px-3 py-2 rounded-md">
          <Download size={16} /> Přehled výdejek (Excel)
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-3 mb-4 flex flex-wrap gap-2 items-end">
        <label className="flex-1 min-w-[200px]">
          <span className="block text-xs font-medium text-slate-500 mb-1">Hledat (LS, SSCC, GTIN, šarže, pracovník)</span>
          <span className="relative block">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={hladat} onChange={(e) => setHladat(e.target.value)} className="w-full border border-slate-200 rounded-md pl-8 pr-2.5 py-1.5 text-sm" />
          </span>
        </label>
        <label>
          <span className="block text-xs font-medium text-slate-500 mb-1">Stav</span>
          <select value={stav} onChange={(e) => setStav(e.target.value)} className="border border-slate-200 rounded-md px-2.5 py-1.5 text-sm">
            <option value="">Vše</option>
            <option value="rozpracovana">Rozpracované</option>
            <option value="dokoncena">Dokončené</option>
          </select>
        </label>
        <label>
          <span className="block text-xs font-medium text-slate-500 mb-1">Od</span>
          <input type="date" value={od} onChange={(e) => setOd(e.target.value)} className="border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
        </label>
        <label>
          <span className="block text-xs font-medium text-slate-500 mb-1">Do</span>
          <input type="date" value={do_} onChange={(e) => setDo(e.target.value)} className="border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
        </label>
      </div>

      {error && <div className="mb-4 bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={16} /> {error}</div>}

      {!vydajky && !error && <div className="flex items-center justify-center text-slate-500 py-10"><Loader2 className="animate-spin mr-2" size={20} /> Načítám...</div>}

      {vydajky && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-left">
                <th className="px-3 py-2 w-6"></th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">Lieferschein</th>
                <th className="px-3 py-2 font-medium">Založeno</th>
                <th className="px-3 py-2 font-medium">Pracovník</th>
                <th className="px-3 py-2 font-medium text-right">Palet</th>
                <th className="px-3 py-2 font-medium text-right">Množství</th>
                <th className="px-3 py-2 font-medium">Stav</th>
                <th className="px-3 py-2 font-medium">Dokončeno</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">Žádné výdejky. Skenuje se na PDA přes <span className="font-mono">{pdaUrl}</span></td></tr>
              )}
              {filtered.map((v) => {
                const pal = paletyPodla.get(v.id) || [];
                const mnozstvo = pal.reduce((s, p) => s + (p.mnozstvo || 0), 0);
                const open = openId === v.id;
                return (
                  <React.Fragment key={v.id}>
                    <tr className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setOpenId(open ? null : v.id)}>
                      <td className="px-3 py-2 text-slate-400">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                      <td className="px-3 py-2 font-medium whitespace-nowrap">
                        {v.cislo_lieferschein}
                        {v.data && v.data.objednavka && <div className="text-xs font-normal text-slate-500">{kratkyNazov(v.data.objednavka)}</div>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(v.created_at)}</td>
                      <td className="px-3 py-2">{v.pracovnik || <span className="text-slate-400">-</span>}</td>
                      <td className="px-3 py-2 text-right">{pal.length}</td>
                      <td className="px-3 py-2 text-right">{mnozstvo || <span className="text-slate-300">-</span>}</td>
                      <td className="px-3 py-2"><StavBadge stav={v.stav} /></td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-500">{v.dokoncena_at ? formatDateTime(v.dokoncena_at) + (v.dokoncil ? " · " + v.dokoncil : "") : "-"}</td>
                    </tr>
                    {open && (
                      <tr className="bg-slate-50/60">
                        <td colSpan={8} className="px-4 py-3">
                          <VydajkaDetail
                            vydajka={v}
                            palety={pal}
                            hladat={hladat.trim()}
                            busy={busyId === v.id}
                            confirmDelete={confirmDeleteId === v.id}
                            onReopen={() => znovuOtvorit(v)}
                            onAskDelete={() => setConfirmDeleteId(v.id)}
                            onCancelDelete={() => setConfirmDeleteId(null)}
                            onDelete={() => smazat(v)}
                            onNveList={() => nveList(v)}
                            nveInfo={nveInfo && nveInfo.vydajkaId === v.id ? nveInfo : null}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-400 mt-3 flex items-center gap-1.5">
        <Smartphone size={14} /> Skenovací rozhraní pro PDA: <span className="font-mono select-all">{pdaUrl}</span>
      </p>
    </div>
  );
}

function VydajkaDetail({ vydajka, palety, hladat, busy, confirmDelete, onReopen, onAskDelete, onCancelDelete, onDelete, onNveList, nveInfo }) {
  const souhrn = summarizePallets(palety);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center justify-end">
        {busy && <Loader2 size={16} className="animate-spin text-slate-400" />}
        <button onClick={onNveList} disabled={!palety.length} className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-50">
          <FileSpreadsheet size={14} /> NVE list (MAXIM)
        </button>
        {vydajka.stav === "dokoncena" && (
          <button onClick={onReopen} disabled={busy} className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-60">
            <RotateCcw size={14} /> Znovu otevřít
          </button>
        )}
        {confirmDelete ? (
          <>
            <span className="text-xs text-red-700">Smazat výdejku i všechny palety?</span>
            <button onClick={onDelete} disabled={busy} className="text-xs font-medium px-3 py-1.5 rounded-md bg-red-600 text-white hover:bg-red-700">Smazat</button>
            <button onClick={onCancelDelete} className="text-xs px-3 py-1.5 rounded-md border border-slate-200 bg-white">Zrušit</button>
          </>
        ) : (
          <button onClick={onAskDelete} disabled={busy} className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-red-200 text-red-700 bg-white hover:bg-red-50 disabled:opacity-60">
            <Trash2 size={14} /> Smazat
          </button>
        )}
      </div>
      {nveInfo && (
        <div className={"text-xs px-3 py-2 rounded-md flex items-start gap-2 " + (nveInfo.tone === "warn" ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800")}>
          {nveInfo.tone === "warn" ? <AlertCircle size={14} className="shrink-0 mt-0.5" /> : <FileSpreadsheet size={14} className="shrink-0 mt-0.5" />} {nveInfo.text}
        </div>
      )}

      <div>
        <div className="text-xs font-semibold text-slate-500 mb-1">Souhrn</div>
        <table className="w-full text-xs bg-white border border-slate-200 rounded-md">
          <thead>
            <tr className="bg-slate-100 text-slate-600 text-left">
              <th className="px-2 py-1.5 font-medium">GTIN</th>
              <th className="px-2 py-1.5 font-medium">BBD</th>
              <th className="px-2 py-1.5 font-medium">Šarže</th>
              <th className="px-2 py-1.5 font-medium text-right">Palet</th>
              <th className="px-2 py-1.5 font-medium text-right">Množství</th>
            </tr>
          </thead>
          <tbody>
            {souhrn.map((s) => (
              <tr key={s.gtin + s.bbd + s.sarza} className="border-t border-slate-100">
                <td className="px-2 py-1.5 font-mono">{s.gtin || "-"}</td>
                <td className="px-2 py-1.5">{formatDate(s.bbd) || "-"}</td>
                <td className="px-2 py-1.5">{s.sarza || "-"}</td>
                <td className="px-2 py-1.5 text-right">{s.palet}</td>
                <td className="px-2 py-1.5 text-right">{s.mnozstvo}{s.mnozstvoNeuplne ? " + ?" : ""}</td>
              </tr>
            ))}
            {souhrn.length === 0 && <tr><td colSpan={5} className="px-2 py-3 text-center text-slate-400">Žádné palety</td></tr>}
          </tbody>
        </table>
      </div>

      <div>
        <div className="text-xs font-semibold text-slate-500 mb-1">Palety ({palety.length})</div>
        <table className="w-full text-xs bg-white border border-slate-200 rounded-md">
          <thead>
            <tr className="bg-slate-100 text-slate-600 text-left">
              <th className="px-2 py-1.5 font-medium">#</th>
              <th className="px-2 py-1.5 font-medium">SSCC</th>
              <th className="px-2 py-1.5 font-medium">GTIN</th>
              <th className="px-2 py-1.5 font-medium">BBD</th>
              <th className="px-2 py-1.5 font-medium">Šarže</th>
              <th className="px-2 py-1.5 font-medium text-right">Množství</th>
              <th className="px-2 py-1.5 font-medium">Naskenoval</th>
              <th className="px-2 py-1.5 font-medium">Čas</th>
            </tr>
          </thead>
          <tbody>
            {palety.map((p, i) => {
              const hit = hladat && (p.sscc.includes(hladat) || (p.gtin || "").includes(hladat));
              return (
                <tr key={p.id} className={"border-t border-slate-100 " + (hit ? "bg-amber-50" : "")}>
                  <td className="px-2 py-1.5 text-slate-400">{i + 1}</td>
                  <td className="px-2 py-1.5 font-mono">{p.sscc}</td>
                  <td className="px-2 py-1.5 font-mono">{p.gtin || "-"}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(p.bbd) || "-"}{p.bbd_ai === "17" ? " (spotř.)" : ""}</td>
                  <td className="px-2 py-1.5">{p.sarza || "-"}</td>
                  <td className="px-2 py-1.5 text-right">{p.mnozstvo != null ? p.mnozstvo : "-"}</td>
                  <td className="px-2 py-1.5">{p.pracovnik || "-"}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-slate-500">{formatDateTime(p.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
