// Testovaci rezim PDA (?pda=test) - simulacia na PC bez Zebry.
//
//   * vlavo "telefon" s PDA rozhranim (ta ista PdaMain ako ostro),
//   * vpravo simulator skenera: generuje platne GS1 kody palet a "pise" ich
//     do skryteho skenovacieho pola ako DataWedge (znak po znaku, GS, Enter),
//     prepinac vypadku siete, chybne vzorove kody,
//   * dole kancelarsky prehlad nad tymi istymi testovacimi datami + Excel.
//
// Data su LEN v tomto prehliadaci (localStorage, simulovana DB v pdaMockApi.js).
// Ziadne volanie Supabase, ziadne skladove pohyby, ziadne prihlasenie.

import React, { useState, useMemo, useRef, useEffect } from "react";
import { FlaskConical, ScanLine, Trash2, Wifi, WifiOff, Timer, Unplug, Keyboard, Shuffle, ArrowLeft } from "lucide-react";
import { PdaApiContext, PdaMain } from "./PdaMobileView.jsx";
import PdaOfficeView from "./PdaOfficeView.jsx";
import { createPdaMockStore, createMockPdaApi } from "./pdaMockApi.js";
import { GS, visibleControlChars } from "../lib/gs1.js";
import { DEMO_GTINS, randomSscc, ssccCode, produktCode } from "../lib/pdaTestCodes.js";

const FONT = { fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" };

function plusMonths(m) {
  const d = new Date();
  d.setMonth(d.getMonth() + m);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const NET_MODES = [
  { v: "ok", label: "Normální síť", icon: Wifi, tone: "emerald" },
  { v: "offline", label: "Bez sítě", icon: WifiOff, tone: "red" },
  { v: "lostResponse", label: "Ztracená odpověď", icon: Unplug, tone: "amber" },
  { v: "slow", label: "Pomalá síť (2,5 s)", icon: Timer, tone: "sky" },
];

const VZOROVE_CHYBY = [
  { label: "Chybná kontrolní číslice SSCC", raw: "00106141411234567898" },
  { label: "Běžný EAN-13", raw: "8594008000015" },
  { label: "Chybí GS za AI 37 (→ 10)", raw: "0214001234000012" + "3748" + "10L1" },
  { label: "Neplatný datum (13. měsíc)", raw: "0214001234000012" + "15271315" + "3748" },
  { label: "Den 00 (konec měsíce) + AI 17", raw: "0214001234000012" + "17270200" + "3748" },
];

// Zadany text -> surovy kod. "<GS>", "{GS}" a "|" = oddelovac FNC1.
export function parseSimText(text) {
  return String(text || "").replace(/<GS>|\{GS\}/gi, GS).replace(/\r?\n/g, "");
}

// "Napise" kod do skenovacieho pola ako DataWedge keystroke: znaky cez
// input udalosti, GS ako klavesa (Ctrl+], keyCode 29), na konci Enter.
function typeIntoScanInput(root, raw) {
  const el = root && root.querySelector("[data-pda-scan-input]");
  if (!el) return false;
  el.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  const key = (k, code, ctrl) => {
    const ev = new KeyboardEvent("keydown", { key: k, ctrlKey: !!ctrl, bubbles: true, cancelable: true });
    Object.defineProperty(ev, "keyCode", { get: () => code });
    Object.defineProperty(ev, "which", { get: () => code });
    el.dispatchEvent(ev);
  };
  for (const ch of raw) {
    if (ch === GS) {
      key("]", 29, true);
      continue;
    }
    setter.call(el, el.value + ch);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  key("Enter", 13, false);
  return true;
}

export default function PdaTestMode() {
  const store = useMemo(() => createPdaMockStore({ persist: true }), []);
  const skladApi = useMemo(() => createMockPdaApi(store, { role: "sklad" }), [store]);
  const officeApi = useMemo(() => createMockPdaApi(store, { role: "office", latencyMs: 50 }), [store]);
  const [netMode, setNetMode] = useState(store.netMode);
  const [resetKey, setResetKey] = useState(0);
  const phoneRef = useRef(null);

  function changeNet(m) {
    store.setNetMode(m);
    setNetMode(m);
  }

  function resetData() {
    store.reset();
    try { localStorage.removeItem("stenger_pda_pracovnik_test"); } catch (e) {}
    setResetKey((k) => k + 1);
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900" style={FONT}>
      <div className="bg-amber-400 text-slate-900 px-4 py-2 text-sm font-semibold flex items-center gap-2 flex-wrap" style={{ backgroundImage: "repeating-linear-gradient(45deg, rgba(0,0,0,0.06) 0 10px, transparent 10px 20px)" }}>
        <FlaskConical size={18} />
        TESTOVACÍ REŽIM PDA – simulovaná databáze jen v tomto prohlížeči. Nic se neukládá do Stenger ONE / Supabase, žádné skladové pohyby.
        <a href="?" className="ml-auto flex items-center gap-1 underline font-medium"><ArrowLeft size={14} /> Odejít</a>
      </div>

      <div className="max-w-6xl mx-auto p-4 grid gap-4 lg:grid-cols-[380px_1fr] items-start">
        <div>
          <div className="text-xs font-semibold text-slate-500 mb-1.5">PDA (Zebra TC25 – simulace, 360 × 640)</div>
          {/* transform = "fixed" prvky PDA (spodna lista, skenovacie pole) zostanu v ramceku */}
          <div ref={phoneRef} className="bg-white border-[10px] border-slate-800 rounded-[28px] shadow-xl overflow-y-auto overflow-x-hidden" style={{ width: 380, height: 660, transform: "translateZ(0)" }}>
            <PdaApiContext.Provider value={skladApi}>
              <PdaMain key={resetKey} onSignOut={null} />
            </PdaApiContext.Provider>
          </div>
          <p className="text-xs text-slate-500 mt-2 flex items-start gap-1.5">
            <Keyboard size={14} className="shrink-0 mt-0.5" />
            Kód lze zadat i z klávesnice PC: klikněte do PDA, napište kód a Enter (oddělovač GS = Ctrl+] nebo znak |).
          </p>
        </div>

        <div className="space-y-4">
          <Simulator phoneRef={phoneRef} netMode={netMode} onNetMode={changeNet} onReset={resetData} />
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 pb-10">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-semibold text-amber-700 mb-3">Kancelář (Stenger ONE → PDA / Expedice) – stejná testovací data</div>
          <PdaOfficeView key={resetKey} api={officeApi} />
        </div>
      </div>
    </div>
  );
}

function CodeChip({ label, raw, onScan }) {
  return (
    <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-md px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold text-slate-500">{label}</div>
        <div className="font-mono text-xs break-all">{visibleControlChars(raw)}</div>
      </div>
      <button onClick={onScan} className="shrink-0 flex items-center gap-1 bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold px-2.5 py-1.5 rounded-md">
        <ScanLine size={14} /> Skenovat
      </button>
    </div>
  );
}

function Simulator({ phoneRef, netMode, onNetMode, onReset }) {
  const [gtinIdx, setGtinIdx] = useState(0);
  const [bbd, setBbd] = useState(() => plusMonths(6));
  const [qty, setQty] = useState("48");
  const [sarza, setSarza] = useState("L" + new Date().toISOString().slice(2, 10).replace(/-/g, ""));
  const [palety, setPalety] = useState([]); // vygenerovane: [{ sscc, rawSscc, rawProdukt }]
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!msg) return undefined;
    const t = setTimeout(() => setMsg(""), 4000);
    return () => clearTimeout(t);
  }, [msg]);

  // Ak PDA prave prepina obrazovku, chvilu pocka na skenovacie pole (max 3 s).
  async function scan(raw) {
    for (let i = 0; i < 15; i++) {
      if (typeIntoScanInput(phoneRef.current, raw)) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    setMsg("Na této obrazovce PDA se neskenuje – otevřete výdejku nebo „Test skeneru“.");
    return false;
  }

  function novaPaleta() {
    const sscc = randomSscc();
    const p = { sscc, rawSscc: ssccCode(sscc), rawProdukt: produktCode({ gtin: DEMO_GTINS[gtinIdx].gtin, bbd, mnozstvo: qty, sarza }) };
    setPalety((prev) => [p, ...prev].slice(0, 8));
    return p;
  }

  async function obePoradie(prvy) {
    const p = novaPaleta();
    if (!(await scan(prvy === "sscc" ? p.rawSscc : p.rawProdukt))) return;
    await new Promise((r) => setTimeout(r, 400));
    await scan(prvy === "sscc" ? p.rawProdukt : p.rawSscc);
  }

  return (
    <>
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="text-sm font-semibold flex items-center gap-2"><ScanLine size={16} className="text-teal-700" /> Simulátor skeneru</div>
        <div className="grid sm:grid-cols-4 gap-2">
          <label className="sm:col-span-2">
            <span className="block text-xs text-slate-500 mb-1">GTIN (AI 02)</span>
            <select value={gtinIdx} onChange={(e) => setGtinIdx(Number(e.target.value))} className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-sm">
              {DEMO_GTINS.map((g, i) => <option key={g.gtin} value={i}>{g.gtin} – {g.nazov}</option>)}
            </select>
          </label>
          <label>
            <span className="block text-xs text-slate-500 mb-1">BBD (AI 15)</span>
            <input type="date" value={bbd} onChange={(e) => setBbd(e.target.value)} className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-sm" />
          </label>
          <label>
            <span className="block text-xs text-slate-500 mb-1">Množství (AI 37)</span>
            <input value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, "").slice(0, 8))} className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-sm" placeholder="prázdné = bez AI 37" />
          </label>
          <label className="sm:col-span-2">
            <span className="block text-xs text-slate-500 mb-1">Šarže (AI 10)</span>
            <input value={sarza} onChange={(e) => setSarza(e.target.value.slice(0, 20))} className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-sm" placeholder="prázdné = bez AI 10" />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => obePoradie("sscc")} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md">
            <Shuffle size={15} /> Nová paleta: SSCC → produkt
          </button>
          <button onClick={() => obePoradie("produkt")} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md">
            <Shuffle size={15} /> Nová paleta: produkt → SSCC
          </button>
          <button onClick={novaPaleta} className="text-sm font-medium px-3 py-2 rounded-md border border-slate-200 hover:bg-slate-50">Jen vygenerovat kódy</button>
        </div>
        {msg && <div className="text-xs bg-amber-50 text-amber-800 px-3 py-2 rounded-md">{msg}</div>}

        {palety.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-500">Vygenerované palety (lze skenovat znovu = test duplicity / neúplné palety)</div>
            {palety.map((p) => (
              <div key={p.sscc} className="space-y-1 border-l-4 border-teal-200 pl-2">
                <CodeChip label={"SSCC …" + p.sscc.slice(-6)} raw={p.rawSscc} onScan={() => scan(p.rawSscc)} />
                <CodeChip label="Produktový kód" raw={p.rawProdukt} onScan={() => scan(p.rawProdukt)} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
        <div className="text-sm font-semibold">Vlastní kód / vložení textu</div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="např. 00106141411234567897  nebo  0214001234000012152703153748<GS>10L1" className="w-full border border-slate-200 rounded-md px-2 py-1.5 font-mono text-xs" />
        <div className="flex flex-wrap gap-2 items-center">
          <button onClick={() => scan(parseSimText(text))} disabled={!text.trim()} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium px-3 py-1.5 rounded-md"><ScanLine size={14} /> Skenovat text</button>
          <span className="text-xs text-slate-400">Oddělovač FNC1: &lt;GS&gt; nebo |</span>
        </div>
        <div className="text-xs font-semibold text-slate-500 pt-1">Chybné / hraniční kódy</div>
        <div className="flex flex-wrap gap-1.5">
          {VZOROVE_CHYBY.map((c) => (
            <button key={c.label} onClick={() => scan(c.raw)} className="text-xs px-2.5 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50">{c.label}</button>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
        <div className="text-sm font-semibold">Síť (simulace)</div>
        <div className="flex flex-wrap gap-1.5">
          {NET_MODES.map(({ v, label, icon: Icon }) => (
            <button
              key={v}
              onClick={() => onNetMode(v)}
              className={"flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border " + (netMode === v ? "bg-slate-900 text-white border-slate-900" : "border-slate-200 hover:bg-slate-50")}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500">„Ztracená odpověď“ = zápis do DB proběhne, ale PDA dostane chybu sítě. Po „Zkusit znovu“ nesmí vzniknout duplicita.</p>
        <div className="pt-2 border-t border-slate-100">
          {confirmReset ? (
            <span className="flex items-center gap-2 text-xs">
              Smazat všechna testovací data?
              <button onClick={() => { onReset(); setConfirmReset(false); }} className="bg-red-600 text-white px-2.5 py-1 rounded-md font-medium">Smazat</button>
              <button onClick={() => setConfirmReset(false)} className="border border-slate-200 px-2.5 py-1 rounded-md">Ne</button>
            </span>
          ) : (
            <button onClick={() => setConfirmReset(true)} className="flex items-center gap-1.5 text-xs text-red-700"><Trash2 size={14} /> Smazat testovací data</button>
          )}
        </div>
      </div>
    </>
  );
}
