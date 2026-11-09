// PDA / Expedice - dohledatelnost podle produktu a sarze/lotu/BBD.

import React, { useState, useEffect, useMemo } from "react";
import { Loader2, AlertCircle, Search, Download, ChevronDown, ChevronRight } from "lucide-react";
import { formatDateTime } from "../lib/utils.js";
import { exportSheetsToExcel } from "../lib/exportExcel.js";
import { pdaErrorMessage } from "../lib/pdaScan.js";
import { formatIsoDate as formatDate } from "../lib/pdaExport.js";
import { buildDohladatelnost, filtrujDohladatelnost, dohladatelnostSheets, rucnaDavka } from "../lib/pdaDohladatelnost.js";

const den = (iso) => (iso ? formatDateTime(iso).slice(0, 10) : "");
const lokalnyDen = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function PdaDohladatelnost({ api }) {
  const [vydajky, setVydajky] = useState(null);
  const [palety, setPalety] = useState([]);
  const [products, setProducts] = useState([]);
  const [rucne, setRucne] = useState([]);
  const [error, setError] = useState("");
  const [hladat, setHladat] = useState("");
  const [produkt, setProdukt] = useState("");
  const [od, setOd] = useState("");
  const [do_, setDo] = useState("");
  const [openKey, setOpenKey] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listVydajkyOd(null), api.listPaletyOd(null), api.listProducts(), api.listRucneExpedicie()]).then(([v, p, pr, ru]) => {
      if (cancelled) return;
      if (v.error || p.error) {
        setError(pdaErrorMessage(v.error || p.error));
        return;
      }
      setVydajky(v.data || []);
      setPalety(p.data || []);
      setProducts(pr.data || []);
      if (ru.error) setError("Ruční expedice se nepodařilo načíst – zobrazuji jen skeny.");
      setRucne((ru.data || []).map(rucnaDavka).filter(Boolean));
    });
    return () => { cancelled = true; };
  }, [api]);

  const vsetky = useMemo(() => {
    const vObdobi = (vydajky || []).filter((v) => {
      const d = lokalnyDen(v.dokoncena_at || v.created_at);
      return (!od || d >= od) && (!do_ || d <= do_);
    });
    const rucneVObdobi = rucne.filter((r) => {
      const d = r.datum.slice(0, 10);
      return (!od || d >= od) && (!do_ || d <= do_);
    });
    return buildDohladatelnost(vObdobi, palety, products, rucneVObdobi);
  }, [vydajky, palety, products, rucne, od, do_]);

  const produkty = useMemo(() => {
    const m = new Map();
    for (const r of vsetky) m.set(r.produktKey, r.produkt || r.gtin);
    return Array.from(m, ([key, nazov]) => ({ key, nazov })).sort((a, b) => a.nazov.localeCompare(b.nazov));
  }, [vsetky]);

  const riadky = useMemo(
    () => filtrujDohladatelnost(vsetky.filter((r) => !produkt || r.produktKey === produkt), hladat),
    [vsetky, produkt, hladat],
  );

  async function exportExcel() {
    await exportSheetsToExcel(dohladatelnostSheets(riadky), api.isDemo ? "PDA_TEST_dohledatelnost" : "PDA_dohledatelnost");
  }

  const pole = "border border-slate-200 rounded-md px-2.5 py-1.5 text-sm";
  const popis = "block text-xs font-medium text-slate-500 mb-1";

  return (
    <div data-testid="pda-dohledatelnost">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h1 className="text-xl font-semibold">Dohledatelnost</h1>
        <button onClick={exportExcel} disabled={!vydajky} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-medium px-3 py-2 rounded-md">
          <Download size={16} /> Export (Excel)
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-3 mb-4 flex flex-wrap gap-2 items-end">
        <label className="flex-1 min-w-[200px]">
          <span className={popis}>Hledat (šarže, BBD, produkt, SSCC, LS, zákazník)</span>
          <span className="relative block">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={hladat} onChange={(e) => setHladat(e.target.value)} className="w-full border border-slate-200 rounded-md pl-8 pr-2.5 py-1.5 text-sm" />
          </span>
        </label>
        <label>
          <span className={popis}>Produkt</span>
          <select value={produkt} onChange={(e) => setProdukt(e.target.value)} className={pole + " max-w-[240px]"}>
            <option value="">Všechny</option>
            {produkty.map((p) => <option key={p.key} value={p.key}>{p.nazov}</option>)}
          </select>
        </label>
        <label>
          <span className={popis}>Od</span>
          <input type="date" value={od} onChange={(e) => setOd(e.target.value)} className={pole} />
        </label>
        <label>
          <span className={popis}>Do</span>
          <input type="date" value={do_} onChange={(e) => setDo(e.target.value)} className={pole} />
        </label>
      </div>

      {error && <div className="mb-4 bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={16} /> {error}</div>}
      {!vydajky && !error && <div className="flex items-center justify-center text-slate-500 py-10"><Loader2 className="animate-spin mr-2" size={20} /> Načítám...</div>}

      {vydajky && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <th className="px-3 py-2 w-6"></th>
                <th className="px-3 py-2 font-medium">Produkt</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">Šarže / lot</th>
                <th className="px-3 py-2 font-medium">BBD</th>
                <th className="px-3 py-2 font-medium text-right">Palet</th>
                <th className="px-3 py-2 font-medium text-right">Množství</th>
                <th className="px-3 py-2 font-medium">Zákazníci</th>
                <th className="px-3 py-2 font-medium">Expedováno</th>
              </tr>
            </thead>
            <tbody>
              {riadky.map((r) => (
                <React.Fragment key={r.key}>
                  <tr onClick={() => setOpenKey(openKey === r.key ? null : r.key)} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer">
                    <td className="px-3 py-2 text-slate-400">{openKey === r.key ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                    <td className="px-3 py-2"><div className="font-medium">{r.produkt || "Neznámý výrobek"}</div><div className="text-xs text-slate-400 font-mono">{r.gtin}</div></td>
                    <td className="px-3 py-2 font-semibold whitespace-nowrap">{r.stopa || <span className="text-red-600">chybí</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(r.bbd) || "-"}</td>
                    <td className="px-3 py-2 text-right">{r.paletCelkom}</td>
                    <td className="px-3 py-2 text-right">{r.mnozstvo}{r.mnozstvoNeuplne ? "+?" : ""}</td>
                    <td className="px-3 py-2">{r.zakaznici.join(", ") || "-"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{den(r.datumOd) === den(r.datumDo) ? den(r.datumOd) : `${den(r.datumOd)} – ${den(r.datumDo)}`}</td>
                  </tr>
                  {openKey === r.key && (
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <td></td>
                      <td colSpan={7} className="px-3 py-2">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-slate-500">
                              <th className="px-2 py-1 font-medium">Zdroj</th>
                              <th className="px-2 py-1 font-medium">Zákazník</th>
                              <th className="px-2 py-1 font-medium">Objednávka</th>
                              <th className="px-2 py-1 font-medium">LS</th>
                              <th className="px-2 py-1 font-medium">Datum</th>
                              <th className="px-2 py-1 font-medium">SSCC / palet</th>
                              <th className="px-2 py-1 font-medium text-right">Množství</th>
                              <th className="px-2 py-1 font-medium">Naskenoval</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.palety.map((p, i) => (
                              <tr key={i} className="border-t border-slate-200">
                                <td className="px-2 py-1">{p.zdroj}</td>
                                <td className="px-2 py-1">{p.zakaznik || "-"}</td>
                                <td className="px-2 py-1">{p.objednavka || "-"}</td>
                                <td className="px-2 py-1">{p.cisloLs}{p.stav !== "dokoncena" ? " (rozpracovaná)" : ""}</td>
                                <td className="px-2 py-1 whitespace-nowrap">{den(p.datum)}</td>
                                <td className="px-2 py-1 font-mono">{p.sscc || p.pocet + " pal."}</td>
                                <td className="px-2 py-1 text-right">{p.mnozstvo != null ? p.mnozstvo : "-"}</td>
                                <td className="px-2 py-1">{p.pracovnik}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {riadky.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">Nic nenalezeno.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
