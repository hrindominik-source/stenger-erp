// Zalozka Mzdy v Dochadzke - podklad pre uctovnicku. Data si nacitava sama
// (len s pristupom v mzdy_pristup, strazi RLS) - nic z toho nejde do
// hlavneho nacitania appky.
import React, { useState, useEffect, useMemo } from "react";
import { Download, ChevronDown, ChevronRight, AlertCircle } from "lucide-react";
import { supabase } from "./supabaseClient.js";
import {
  MZDY_SKUPINY, MZDY_POLOZKY_SKUPINY, MZDY_POLOZKY_SPOLOCNE, MZDY_LEGENDA_VYCHODZIA,
  legendaPreMesiac, vypocitajMzdu, dochadzkaMesiacaPreMzdy, skupinaPracovnika,
} from "./lib/mzdy.js";
import { mzdyRiadkyExportu, mzdyRiadkyLegendy } from "./lib/mzdyExport.js";
import { exportSheetsToExcel } from "./lib/exportExcel.js";

const kc = (n) => (Number(n) || 0).toLocaleString("cs-CZ", { maximumFractionDigits: 2 });
const prazdne = (v) => v === undefined || v === null || v === "";

// Cislo s potvrdenim pri opusteni pola (nie pri kazdom stlaceni).
function CisloPole({ value, placeholder, onSave, className = "w-16" }) {
  const [text, setText] = useState(prazdne(value) ? "" : String(value));
  useEffect(() => { setText(prazdne(value) ? "" : String(value)); }, [value]);
  function potvrd() {
    const t = text.trim().replace(",", ".");
    if (t === (prazdne(value) ? "" : String(value))) return;
    if (t !== "" && !Number.isFinite(Number(t))) { setText(prazdne(value) ? "" : String(value)); return; }
    onSave(t === "" ? null : Number(t));
  }
  return (
    <input
      inputMode="decimal"
      value={text}
      placeholder={prazdne(placeholder) ? "" : String(placeholder)}
      onChange={(e) => setText(e.target.value)}
      onBlur={potvrd}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      className={className + " border border-slate-200 rounded px-1.5 py-1 text-xs text-right placeholder:text-slate-400"}
    />
  );
}

export default function MzdyPanel({ mesiac, prestavky, pauzy, workers, nastavenia }) {
  const [stav, setStav] = useState("nacitavam"); // nacitavam | ok | chyba
  const [chyba, setChyba] = useState("");
  const [legendaVerzie, setLegendaVerzie] = useState([]);
  const [pracovnici, setPracovnici] = useState({});
  const [mesacne, setMesacne] = useState({});
  const [pohlad, setPohlad] = useState("vypocet");
  const [rozbaleny, setRozbaleny] = useState(null);
  const [ukladaChyba, setUkladaChyba] = useState("");

  useEffect(() => {
    let zrusene = false;
    (async () => {
      setStav("nacitavam");
      const [l, p, m] = await Promise.all([
        supabase.from("mzdy_legenda").select("*"),
        supabase.from("mzdy_pracovnici").select("*"),
        supabase.from("mzdy_mesiac").select("*").eq("mesiac", mesiac),
      ]);
      if (zrusene) return;
      const err = l.error || p.error || m.error;
      if (err) { setChyba(err.message || String(err)); setStav("chyba"); return; }
      setLegendaVerzie((l.data || []).map((r) => ({ id: r.id, platnostOd: r.platnost_od, data: r.data })));
      setPracovnici(Object.fromEntries((p.data || []).map((r) => [r.id, r.data])));
      setMesacne(Object.fromEntries((m.data || []).map((r) => [r.meno, r.data])));
      setStav("ok");
    })();
    return () => { zrusene = true; };
  }, [mesiac]);

  const workersByMeno = useMemo(() => Object.fromEntries((workers || []).map((w) => [w.meno, w])), [workers]);
  const legenda = useMemo(() => legendaPreMesiac(legendaVerzie, mesiac), [legendaVerzie, mesiac]);
  const dochadzka = useMemo(() => dochadzkaMesiacaPreMzdy(prestavky, pauzy, workersByMeno, nastavenia), [prestavky, pauzy, workersByMeno, nastavenia]);

  const mena = useMemo(() => Array.from(new Set([...Object.keys(dochadzka), ...Object.keys(mesacne)])).sort((a, b) => a.localeCompare(b)), [dochadzka, mesacne]);
  const vsetciPracovnici = useMemo(() => Array.from(new Set([
    ...(workers || []).filter((w) => w.typ === "vyroba" || w.typ === "sklad").map((w) => w.meno),
    ...mena,
  ])).sort((a, b) => a.localeCompare(b)), [workers, mena]);

  const vysledky = mena.map((meno) => {
    const md = mesacne[meno] || {};
    const skupina = skupinaPracovnika(meno, pracovnici, workersByMeno, md);
    const d = dochadzka[meno] || { denneMin: 0, nocneMin: 0, vikendMin: 0, zmeny: 0, nedokoncene: 0 };
    const r = vypocitajMzdu({ skupina, mesiac, legenda, dochadzka: d, vstup: md.vstup || {} });
    return { meno, skupina, md, d, r, poznamka: md.poznamka || "" };
  });
  const spolu = vysledky.reduce((s, x) => s + x.r.celkem, 0);

  async function ulozMesacne(meno, zmena) {
    const stare = mesacne[meno] || {};
    const nove = { ...stare, ...zmena, vstup: { ...(stare.vstup || {}), ...(zmena.vstup || {}) } };
    setMesacne((m) => ({ ...m, [meno]: nove }));
    const { error } = await supabase.from("mzdy_mesiac").upsert({ id: `${mesiac}|${meno}`, mesiac, meno, data: nove, updated_at: new Date().toISOString() });
    if (error) { setMesacne((m) => ({ ...m, [meno]: stare })); setUkladaChyba("Uložení se nezdařilo: " + error.message); }
    else setUkladaChyba("");
  }
  const ulozVstup = (meno, kluc) => (v) => ulozMesacne(meno, { vstup: { [kluc]: v } });

  async function ulozSkupinuPracovnika(meno, skupina) {
    const stare = pracovnici[meno];
    const nove = { ...(stare || {}), skupina };
    setPracovnici((p) => ({ ...p, [meno]: nove }));
    const { error } = await supabase.from("mzdy_pracovnici").upsert({ id: meno, data: nove, updated_at: new Date().toISOString() });
    if (error) { setPracovnici((p) => ({ ...p, [meno]: stare })); setUkladaChyba("Uložení se nezdařilo: " + error.message); }
    else setUkladaChyba("");
  }

  async function exportuj() {
    await exportSheetsToExcel([
      { name: "Mzdy " + mesiac, rows: mzdyRiadkyExportu(vysledky), colWidth: 13 },
      { name: "Legenda", rows: mzdyRiadkyLegendy(legenda), colWidth: 18 },
    ], "Mzdy_" + mesiac);
  }

  if (stav === "nacitavam") return <div className="text-xs text-slate-400 py-6 text-center">Načítám mzdy…</div>;
  if (stav === "chyba") {
    return (
      <div className="bg-red-50 text-red-700 text-xs px-3 py-2 rounded-md flex items-center gap-2">
        <AlertCircle size={14} /> Mzdy se nepodařilo načíst ({chyba}). Přístup mají jen určení uživatelé.
      </div>
    );
  }

  const tlacidlo = (v, text) => (
    <button onClick={() => setPohlad(v)} className={"text-xs px-2.5 py-1.5 rounded-md border " + (pohlad === v ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-700 border-slate-200")}>{text}</button>
  );

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="flex gap-1.5">
          {tlacidlo("vypocet", "Výpočet " + mesiac)}
          {tlacidlo("legenda", "Legenda")}
          {tlacidlo("skupiny", "Skupiny pracovníků")}
        </div>
        {pohlad === "vypocet" && (
          <button onClick={exportuj} disabled={!vysledky.length} className="text-xs text-teal-700 hover:text-teal-900 disabled:opacity-50 font-medium flex items-center gap-1"><Download size={14} /> Excel pro účetní</button>
        )}
      </div>
      {ukladaChyba && <div className="mb-2 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-md">{ukladaChyba}</div>}

      {pohlad === "vypocet" && (
        <>
          <p className="text-xs text-slate-500 mb-2">
            Hodiny a směny jsou z docházky (minuty: do 29 dolů, od 30 nahoru). Šedá čísla v polích jsou návrh aplikace - přepsáním platí ruční hodnota, smazáním se vrátí návrh.
            Fond = (pracovní dny − dovolená) × {legenda.spolocne.hodinNaDen} h, prémie se krátí fondem.
          </p>
          <div className="overflow-x-auto border border-slate-200 rounded-md bg-white">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-2 py-2 text-left">Jméno</th>
                  <th className="px-2 py-2 text-left">Skupina</th>
                  <th className="px-2 py-2 text-right" title="denní / noční">Hod. D / N</th>
                  <th className="px-2 py-2 text-right">Celkem</th>
                  <th className="px-2 py-2 text-right">Směny</th>
                  <th className="px-2 py-2 text-right">Dovolená</th>
                  <th className="px-2 py-2 text-right">Fond</th>
                  <th className="px-2 py-2 text-right">Úklidy</th>
                  <th className="px-2 py-2 text-right">Přesčas</th>
                  <th className="px-2 py-2 text-right">Příplatky</th>
                  <th className="px-2 py-2 text-right">Prémie</th>
                  <th className="px-2 py-2 text-right">Pohyblivá</th>
                  <th className="px-2 py-2 text-right">Mimořádná</th>
                  <th className="px-2 py-2 text-right">Celkem Kč</th>
                </tr>
              </thead>
              <tbody>
                {vysledky.map(({ meno, skupina, md, d, r }) => {
                  const v = md.vstup || {};
                  const otvoreny = rozbaleny === meno;
                  return (
                    <React.Fragment key={meno}>
                      <tr className="border-t border-slate-100 align-middle">
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <button onClick={() => setRozbaleny(otvoreny ? null : meno)} className="flex items-center gap-1 font-medium text-slate-800">
                            {otvoreny ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{meno}
                          </button>
                          {d.nedokoncene > 0 && <div className="text-[10px] text-red-600">{d.nedokoncene}× chybí odchod</div>}
                        </td>
                        <td className="px-2 py-1.5">
                          <select value={skupina} onChange={(e) => ulozMesacne(meno, { skupina: e.target.value })} className="border border-slate-200 rounded px-1 py-1 text-xs">
                            {MZDY_SKUPINY.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1.5 text-right whitespace-nowrap">{r.hodinyDenne} / {r.hodinyNocne}</td>
                        <td className="px-2 py-1.5 text-right font-medium">{r.hodinyCelkem}{r.korekciaHod ? <span className="text-amber-600"> ({r.korekciaHod > 0 ? "+" : ""}{r.korekciaHod})</span> : null}</td>
                        <td className="px-2 py-1.5 text-right">{r.zmeny}</td>
                        <td className="px-2 py-1.5 text-right"><CisloPole value={v.dovolenkaDni} placeholder="0" onSave={ulozVstup(meno, "dovolenkaDni")} className="w-12" /></td>
                        <td className="px-2 py-1.5 text-right"><CisloPole value={v.fond} placeholder={r.navrhFond} onSave={ulozVstup(meno, "fond")} className="w-14" /></td>
                        <td className="px-2 py-1.5 text-right"><CisloPole value={v.uklidy} placeholder="0" onSave={ulozVstup(meno, "uklidy")} className="w-12" /></td>
                        <td className="px-2 py-1.5 text-right whitespace-nowrap">{r.nadcasHod} h<div className="text-[10px] text-slate-500">{kc(r.nadcasKc)}</div></td>
                        <td className="px-2 py-1.5 text-right whitespace-nowrap" title="příplatek za hodiny + za směny + úklid + měsíční příplatek">{kc(r.priplatokHodKc + r.priplatokVikendKc + r.smenyKc + r.uklidKc + r.mesacnyPriplatok)}</td>
                        <td className="px-2 py-1.5 text-right"><CisloPole value={v.premia} placeholder={r.navrhPremia} onSave={ulozVstup(meno, "premia")} className="w-16" /></td>
                        <td className="px-2 py-1.5 text-right"><CisloPole value={v.pohyblivaPremia} placeholder="0" onSave={ulozVstup(meno, "pohyblivaPremia")} className="w-16" /></td>
                        <td className="px-2 py-1.5 text-right"><CisloPole value={v.mimoriadnaPremia} placeholder="0" onSave={ulozVstup(meno, "mimoriadnaPremia")} className="w-16" /></td>
                        <td className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">{kc(r.celkem)}</td>
                      </tr>
                      {otvoreny && (
                        <tr className="bg-slate-50 border-t border-slate-100">
                          <td colSpan={14} className="px-3 py-2">
                            <div className="flex flex-wrap gap-x-5 gap-y-2 items-end">
                              {[
                                ["Korekce hodin (+/−)", "korekciaHod", 0],
                                ["Hodiny celkem (přepis)", "hodinyCelkem", Math.round(((d.denneMin || 0) + (d.nocneMin || 0)) / 60 * 100) / 100],
                                ["Denní hod. (přepis)", "hodinyDenne", null],
                                ["Noční hod. (přepis)", "hodinyNocne", null],
                                ["Směny (přepis)", "zmeny", d.zmeny],
                                ["Sazba úklidu (zástup)", "sadzbaUklid", legenda.skupiny[skupina].uklid],
                                ["Základ prémie (zástup)", "premiaZaklad", legenda.skupiny[skupina].premia],
                                ["Měsíční příplatek", "mesacnyPriplatok", r.navrhMesacny],
                              ].map(([label, kluc, navrh]) => (
                                <label key={kluc} className="text-[11px] text-slate-500">
                                  <div className="mb-0.5">{label}</div>
                                  <CisloPole value={v[kluc]} placeholder={navrh} onSave={ulozVstup(meno, kluc)} className="w-20" />
                                </label>
                              ))}
                              <label className="text-[11px] text-slate-500 flex-1 min-w-[200px]">
                                <div className="mb-0.5">Poznámka</div>
                                <input defaultValue={md.poznamka || ""} onBlur={(e) => { if (e.target.value !== (md.poznamka || "")) ulozMesacne(meno, { poznamka: e.target.value }); }} className="w-full border border-slate-200 rounded px-1.5 py-1 text-xs" />
                              </label>
                            </div>
                            <div className="text-[11px] text-slate-500 mt-2">
                              Pracovní dny {r.pracovneDni}, plný fond {r.plnyFond} h · hodinovka {r.hodinovka} Kč · přesčas {r.nadcasHod} h × {r.hodinovka} × {legenda.spolocne.koefNadcas} = {kc(r.nadcasKc)} Kč ·
                              příplatek hod. {kc(r.priplatokHodKc)} · směny {kc(r.smenyKc)} · úklid {r.uklidy} × {r.sadzbaUklid} = {kc(r.uklidKc)} · prémie {kc(r.premia)} (návrh {kc(r.navrhPremia)} ze {kc(r.premiaZaklad)}) · měs. příplatek {kc(r.mesacnyPriplatok)}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {vysledky.length === 0 && (
                  <tr><td colSpan={14} className="px-3 py-4 text-center text-slate-400">V tomto měsíci není žádná docházka.</td></tr>
                )}
              </tbody>
              {vysledky.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50">
                    <td colSpan={13} className="px-2 py-2 text-right font-semibold">Celkem k nadiktování účetní</td>
                    <td className="px-2 py-2 text-right font-bold whitespace-nowrap">{kc(spolu)} Kč</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}

      {pohlad === "legenda" && <LegendaEditor verzie={legendaVerzie} mesiac={mesiac} onUlozene={(v) => setLegendaVerzie((x) => [...x.filter((y) => y.id !== v.id), v])} />}

      {pohlad === "skupiny" && (
        <div className="border border-slate-200 rounded-md bg-white">
          <p className="text-xs text-slate-500 px-3 pt-2">Výchozí skupina pracovníka. Pro jeden měsíc ji lze změnit přímo ve výpočtu (např. zástup).</p>
          <table className="w-full text-xs mt-1">
            <tbody>
              {vsetciPracovnici.map((meno) => (
                <tr key={meno} className="border-t border-slate-100">
                  <td className="px-3 py-1.5">{meno}</td>
                  <td className="px-3 py-1.5">
                    <select value={skupinaPracovnika(meno, pracovnici, workersByMeno, null)} onChange={(e) => ulozSkupinuPracovnika(meno, e.target.value)} className="border border-slate-200 rounded px-1 py-1 text-xs">
                      {MZDY_SKUPINY.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LegendaEditor({ verzie, mesiac, onUlozene }) {
  const platna = legendaPreMesiac(verzie, mesiac);
  const [platnostOd, setPlatnostOd] = useState(mesiac);
  const [data, setData] = useState(platna);
  const [stav, setStav] = useState("");
  useEffect(() => { setData(legendaPreMesiac(verzie, mesiac)); }, [verzie, mesiac]);

  const nastavSkupinu = (sk, kluc, hodnota) => setData((d) => ({ ...d, skupiny: { ...d.skupiny, [sk]: { ...d.skupiny[sk], [kluc]: hodnota } } }));
  const nastavSpolocne = (kluc, hodnota) => setData((d) => ({ ...d, spolocne: { ...d.spolocne, [kluc]: hodnota } }));

  async function uloz() {
    if (!/^\d{4}-\d{2}$/.test(platnostOd)) { setStav("Zadejte měsíc platnosti."); return; }
    const zaznam = { id: platnostOd, platnost_od: platnostOd, data, updated_at: new Date().toISOString() };
    const { error } = await supabase.from("mzdy_legenda").upsert(zaznam);
    if (error) { setStav("Uložení se nezdařilo: " + error.message); return; }
    onUlozene({ id: platnostOd, platnostOd, data });
    setStav("Legenda uložena, platí od " + platnostOd + ".");
  }

  const pole = (value, onChange) => (
    <input inputMode="decimal" value={value ?? ""} onChange={(e) => { const t = e.target.value.replace(",", "."); onChange(t === "" ? 0 : Number.isFinite(Number(t)) ? Number(t) : value); }} className="w-20 border border-slate-200 rounded px-1.5 py-1 text-xs text-right" />
  );

  const zoznam = verzie.slice().sort((a, b) => b.platnostOd.localeCompare(a.platnostOd));
  return (
    <div className="border border-slate-200 rounded-md bg-white p-3">
      <p className="text-xs text-slate-500 mb-2">
        Sazby pro výpočet. Změna se uloží jako nová verze s platností od zvoleného měsíce - starší měsíce se nepřepočítají.
        {zoznam.length === 0 && " Zatím není uložená žádná verze, platí výchozí sazby podle zadání (10/2026)."}
      </p>
      <div className="overflow-x-auto">
        <table className="text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="px-2 py-1 text-left">Položka</th>
              {MZDY_SKUPINY.map((s) => <th key={s.value} className="px-2 py-1 text-right">{s.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {MZDY_POLOZKY_SKUPINY.map((p) => (
              <tr key={p.key} className="border-t border-slate-100">
                <td className="px-2 py-1">{p.label} <span className="text-slate-400">({p.jednotka})</span></td>
                {MZDY_SKUPINY.map((s) => <td key={s.value} className="px-2 py-1 text-right">{pole(data.skupiny[s.value][p.key], (v) => nastavSkupinu(s.value, p.key, v))}</td>)}
              </tr>
            ))}
            {MZDY_POLOZKY_SPOLOCNE.map((p) => (
              <tr key={p.key} className="border-t border-slate-100">
                <td className="px-2 py-1">{p.label} <span className="text-slate-400">({p.jednotka}, pro všechny)</span></td>
                <td className="px-2 py-1 text-right">{pole(data.spolocne[p.key], (v) => nastavSpolocne(p.key, v))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <span className="text-xs text-slate-500">Platí od</span>
        <input type="month" value={platnostOd} onChange={(e) => setPlatnostOd(e.target.value)} className="text-xs border border-slate-200 rounded-md px-2 py-1.5" />
        <button onClick={uloz} className="bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium px-3 py-1.5 rounded-md">Uložit legendu</button>
        <button onClick={() => setData(MZDY_LEGENDA_VYCHODZIA)} className="text-xs text-slate-500 hover:text-slate-800">Výchozí sazby</button>
        {stav && <span className="text-xs text-slate-600">{stav}</span>}
      </div>
      {zoznam.length > 0 && <div className="text-[11px] text-slate-500 mt-2">Uložené verze: {zoznam.map((v) => "od " + v.platnostOd).join(", ")}</div>}
    </div>
  );
}
