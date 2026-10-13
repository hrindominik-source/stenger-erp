// PDA / Expedice - zjednodusene mobilne rozhranie pre Zebra TC25 (Chrome).
// Obrazovky pracuju len cez PdaApiContext: ostro PdaApp.jsx (?pda=1, Supabase,
// ucet Sklad), testovaci rezim PdaTestMode.jsx (?pda=test, simulacia).
// Konkretny pracovnik sa vybera z tabulky workers.
//
// Zasady:
//   * paleta je "Uložena" az ked ju databaza potvrdi (insert ... select),
//     dovtedy "Ukládám…", pri chybe "Neuloženo" s moznostou zopakovat,
//   * skenovaci input drzi fokus sam (DataWedge posiela kod ako klavesnicu),
//   * ziadne zasahy do Expedice v SkladView ani do zasob.

import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import { Loader2, AlertCircle, LogOut, ArrowLeft, Plus, ScanLine, CheckCircle2, XCircle, Trash2, RotateCcw, PackageCheck, User, Wifi, WifiOff, Keyboard } from "lucide-react";
import { parseGs1, visibleControlChars, GS } from "../lib/gs1.js";
import { mergeScan, EMPTY_PENDING, pdaErrorMessage, pdaId, summarizePallets } from "../lib/pdaScan.js";
import { savePalletFlow, deletePalletFlow, finishFlow, canFinish, createVydajkaFlow, mergeLoadedRows } from "../lib/pdaFlow.js";

// Datova vrstva (Supabase alebo simulacia v testovacom rezime ?pda=test).
export const PdaApiContext = createContext(null);
const usePdaApi = () => useContext(PdaApiContext);

const PRACOVNIK_KEY = "stenger_pda_pracovnik";
const FONT = { fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" };

function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* ---------------- Zvuk + vibracia ---------------- */

let audioCtx = null;
function feedback(kind) {
  try {
    if (navigator.vibrate) navigator.vibrate(kind === "error" ? [250, 100, 250] : kind === "ok" ? 80 : 40);
  } catch (e) {}
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    const tones = kind === "error" ? [[220, 0, 0.35]] : kind === "ok" ? [[880, 0, 0.08], [1320, 0.1, 0.1]] : [[660, 0, 0.06]];
    for (const [freq, start, dur] of tones) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      gain.gain.value = 0.15;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(audioCtx.currentTime + start);
      osc.stop(audioCtx.currentTime + start + dur);
    }
  } catch (e) {}
}

/* ---------------- Skenovaci input ---------------- */

function isOtherEditable(el, own) {
  if (!el || el === own) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

// Neviditelny input, ktory prijima kod zo skenera (DataWedge keystroke) a
// drzi si fokus: po blur, po tapnuti kamkolvek, po navrate na kartu a
// kontrolou kazdych 700 ms. Ak ma fokus ine textove pole (rucne zadanie),
// fokus nekradne. Klavesy mimo pola (fokus na tlacidle) zachyti na urovni
// dokumentu. inputMode="none" = nevyskakuje softverova klavesnica.
function ScanInput({ onScan, active = true }) {
  const ref = useRef(null);
  const idleTimer = useRef(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const commit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    clearTimeout(idleTimer.current);
    const value = el.value;
    el.value = "";
    if (value.replace(/[\s\x1D]/g, "")) onScanRef.current(value);
  }, []);

  const refocus = useCallback(() => {
    const el = ref.current;
    if (!el || !active) return;
    if (document.activeElement === el || isOtherEditable(document.activeElement, el)) return;
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
  }, [active]);

  useEffect(() => {
    if (!active) return undefined;
    refocus();
    const iv = setInterval(refocus, 700);
    const onVis = () => { if (!document.hidden) setTimeout(refocus, 50); };
    const onTap = () => setTimeout(refocus, 80);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    document.addEventListener("click", onTap, true);
    document.addEventListener("touchend", onTap, true);
    return () => {
      clearInterval(iv);
      clearTimeout(idleTimer.current);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      document.removeEventListener("click", onTap, true);
      document.removeEventListener("touchend", onTap, true);
    };
  }, [active, refocus]);

  // Zalozne ukoncenie, ak by DataWedge neposielal Enter na konci.
  function armIdleCommit() {
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      if (ref.current && ref.current.value.length >= 16) commit();
    }, 1000);
  }

  // Spolocne spracovanie klavesy - z pola samotneho aj zachytene na urovni
  // dokumentu. Vracia true, ak klavesu spracoval.
  function handleKey(e, fromDocument) {
    const el = ref.current;
    const k = e.key;
    const code = e.keyCode || e.which;
    if (k === "Enter" || code === 13 || k === "Tab" || code === 9) {
      // Enter mimo pola bez rozpisaneho kodu nechame tak (klavesnica na PC).
      if (fromDocument && !el.value) return false;
      e.preventDefault();
      commit();
      return true;
    }
    // FNC1/GS poslany ako klavesa (Ctrl+] alebo keyCode 29) - Chrome ho do
    // inputu sam nevlozi, doplnime ho rucne.
    if (code === 29 || (e.ctrlKey && (k === "]" || code === 221))) {
      e.preventDefault();
      el.value += GS;
      return true;
    }
    if (fromDocument && k && k.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      el.value += k;
      armIdleCommit();
      refocus();
      return true;
    }
    return false;
  }
  const handleKeyRef = useRef(handleKey);
  handleKeyRef.current = handleKey;

  // Ak fokus prave nie je v poli (napr. po tapnuti na tlacidlo), znaky zo
  // skenera sa nesmu stratit a Enter na konci nesmie "stlacit" tlacidlo.
  useEffect(() => {
    if (!active) return undefined;
    function onDocKeyDown(e) {
      const el = ref.current;
      if (!el || e.target === el || isOtherEditable(e.target, el)) return;
      handleKeyRef.current(e, true);
    }
    document.addEventListener("keydown", onDocKeyDown, true);
    return () => document.removeEventListener("keydown", onDocKeyDown, true);
  }, [active]);

  return (
    <input
      ref={ref}
      type="text"
      inputMode="none"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      aria-label="Skenovací pole"
      data-pda-scan-input="1"
      onKeyDown={(e) => handleKey(e, false)}
      onInput={armIdleCommit}
      onBlur={() => setTimeout(refocus, 60)}
      style={{ position: "fixed", top: 0, left: 0, width: 1, height: 1, opacity: 0, fontSize: 16, border: 0, padding: 0 }}
    />
  );
}

/* ---------------- Spolocne UI kusky ---------------- */

function PdaHeader({ title, pracovnik, online, onBack, onSignOut }) {
  return (
    <header className="bg-slate-900 text-white px-3 py-2 flex items-center gap-2 sticky top-0 z-10">
      {onBack ? (
        <button onClick={onBack} className="p-2 -ml-2 rounded-md hover:bg-slate-800" aria-label="Zpět"><ArrowLeft size={22} /></button>
      ) : (
        <img src={`${import.meta.env.BASE_URL}stenger-logo.png`} alt="Stenger" className="h-7 w-auto" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-base font-semibold leading-tight truncate">{title}</div>
        {pracovnik && <div className="text-xs text-slate-400 truncate">{pracovnik}</div>}
      </div>
      {online ? <Wifi size={16} className="text-emerald-400" /> : <WifiOff size={18} className="text-red-400" />}
      {onSignOut && (
        <button onClick={onSignOut} className="p-2 -mr-2 rounded-md text-slate-300 hover:bg-slate-800" aria-label="Odhlásit"><LogOut size={18} /></button>
      )}
    </header>
  );
}

const BANNER_TONES = {
  ok: "bg-emerald-600 text-white",
  wait: "bg-sky-600 text-white",
  info: "bg-amber-400 text-slate-900",
  warn: "bg-amber-400 text-slate-900",
  error: "bg-red-600 text-white",
  saving: "bg-slate-500 text-white",
  idle: "bg-slate-200 text-slate-700",
};

function Banner({ status, message }) {
  return (
    <div className={"rounded-xl px-4 py-4 text-lg font-bold leading-snug min-h-[72px] flex items-center gap-3 " + (BANNER_TONES[status] || BANNER_TONES.idle)}>
      {status === "ok" ? <CheckCircle2 size={28} className="shrink-0" /> : status === "error" ? <XCircle size={28} className="shrink-0" /> : status === "saving" ? <Loader2 size={28} className="shrink-0 animate-spin" /> : <ScanLine size={28} className="shrink-0" />}
      <span>{message}</span>
    </div>
  );
}

function useOnline() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/* ---------------- Hlavny stav PDA ---------------- */

export function PdaMain({ onSignOut }) {
  const api = usePdaApi();
  const pracovnikKey = PRACOVNIK_KEY + (api.isDemo ? "_test" : "");
  const online = useOnline();
  const [pracovnik, setPracovnik] = useState(() => {
    try { return localStorage.getItem(pracovnikKey) || ""; } catch (e) { return ""; }
  });
  const [screen, setScreen] = useState("domov"); // domov | pracovnik | nova | vydajka | test
  const [vydajka, setVydajka] = useState(null);

  function choosePracovnik(meno) {
    try { localStorage.setItem(pracovnikKey, meno); } catch (e) {}
    setPracovnik(meno);
    setScreen("domov");
  }

  const common = { pracovnik, online, onSignOut };
  if (!pracovnik || screen === "pracovnik") {
    return <PracovnikScreen {...common} onChoose={choosePracovnik} onBack={pracovnik ? () => setScreen("domov") : null} />;
  }
  if (screen === "nova") {
    return <NovaVydajkaScreen {...common} onBack={() => setScreen("domov")} onCreated={(v) => { setVydajka(v); setScreen("vydajka"); }} />;
  }
  if (screen === "vydajka" && vydajka) {
    return <VydajkaScreen {...common} vydajka={vydajka} onBack={() => { setVydajka(null); setScreen("domov"); }} />;
  }
  if (screen === "test") {
    return <TestSkeneruScreen {...common} onBack={() => setScreen("domov")} />;
  }
  return (
    <DomovScreen
      {...common}
      onNova={() => setScreen("nova")}
      onOpen={(v) => { setVydajka(v); setScreen("vydajka"); }}
      onZmenitPracovnika={() => setScreen("pracovnik")}
      onTest={() => setScreen("test")}
    />
  );
}

/* ---------------- Vyber pracovnika ---------------- */

function PracovnikScreen({ online, onSignOut, onChoose, onBack }) {
  const api = usePdaApi();
  const [workers, setWorkers] = useState(null);
  const [error, setError] = useState("");
  const [ukazatZaskok, setUkazatZaskok] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.listWorkers().then(({ data, error: err }) => {
      if (cancelled) return;
      if (err) setError(pdaErrorMessage(err));
      else setWorkers((data || []).map((r) => r.data).filter((w) => w && w.meno && (w.typ === "sklad" || w.zaskok)));
    });
    return () => { cancelled = true; };
  }, [api]);

  const bezni = (workers || []).filter((w) => !w.zaskok).sort((a, b) => a.meno.localeCompare(b.meno));
  const zaskok = (workers || []).filter((w) => w.zaskok).sort((a, b) => a.meno.localeCompare(b.meno));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" style={FONT}>
      <PdaHeader title="Kdo skenuje?" online={online} onBack={onBack} onSignOut={onSignOut} />
      <div className="p-3 space-y-2">
        {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md">{error}</div>}
        {!workers && !error && <div className="flex items-center gap-2 text-slate-500 py-6 justify-center"><Loader2 size={18} className="animate-spin" /> Načítám...</div>}
        {workers && bezni.length === 0 && zaskok.length === 0 && <div className="text-sm text-slate-500">Žádní pracovníci skladu. Doplňte je v Stenger ONE → Pracovníci.</div>}
        {bezni.map((w) => (
          <button key={w.meno} onClick={() => onChoose(w.meno)} className="w-full flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-4 text-lg font-semibold active:bg-teal-50">
            <User size={22} className="text-teal-700" /> {w.meno}
          </button>
        ))}
        {zaskok.length > 0 && (ukazatZaskok ? zaskok.map((w) => (
          <button key={w.meno} onClick={() => onChoose(w.meno)} className="w-full flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 text-base active:bg-teal-50">
            <User size={20} className="text-slate-400" /> {w.meno}
          </button>
        )) : (
          <button onClick={() => setUkazatZaskok(true)} className="w-full text-slate-500 text-sm py-3">+ zástup</button>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Domov: rozpracovane vydajky ---------------- */

function DomovScreen({ pracovnik, online, onSignOut, onNova, onOpen, onZmenitPracovnika, onTest }) {
  const api = usePdaApi();
  const [list, setList] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    const { data, error: err } = await api.listOpenVydajky();
    if (err) setError(pdaErrorMessage(err));
    else setList(data || []);
  }, [api]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" style={FONT}>
      <PdaHeader title="PDA / Expedice" pracovnik={pracovnik} online={online} onSignOut={onSignOut} />
      <div className="p-3 space-y-3">
        <button onClick={onNova} className="w-full flex items-center justify-center gap-2 bg-gradient-to-b from-teal-500 to-teal-700 text-white rounded-xl py-5 text-xl font-bold shadow-lg shadow-teal-500/30 active:translate-y-0.5">
          <Plus size={26} /> Nová výdejka
        </button>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <h2 className="text-sm font-semibold text-slate-500">Rozpracované výdejky</h2>
            <button onClick={load} className="text-xs text-teal-700 p-1">Obnovit</button>
          </div>
          {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md mb-2">{error}</div>}
          {!list && !error && <div className="flex items-center gap-2 text-slate-500 py-4 justify-center"><Loader2 size={18} className="animate-spin" /> Načítám...</div>}
          {list && list.length === 0 && <div className="text-sm text-slate-400 py-3 text-center">Žádná rozpracovaná výdejka.</div>}
          <div className="space-y-2">
            {(list || []).map((v) => {
              const pocet = v.pda_palety && v.pda_palety[0] ? v.pda_palety[0].count : 0;
              return (
                <button key={v.id} onClick={() => onOpen(v)} className="w-full text-left bg-white border border-slate-200 rounded-xl px-4 py-3 active:bg-teal-50">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-lg font-bold">LS {v.cislo_lieferschein}</span>
                    <span className="text-sm font-semibold text-teal-700">{pocet} pal.</span>
                  </div>
                  <div className="text-xs text-slate-500">{formatDate(v.created_at)} {formatTime(v.created_at)} · {v.pracovnik || "-"}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={onZmenitPracovnika} className="flex-1 flex items-center justify-center gap-1.5 bg-white border border-slate-200 rounded-lg py-3 text-sm text-slate-700"><User size={16} /> Změnit pracovníka</button>
          <button onClick={onTest} className="flex-1 flex items-center justify-center gap-1.5 bg-white border border-slate-200 rounded-lg py-3 text-sm text-slate-700"><ScanLine size={16} /> Test skeneru</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Nova vydajka ---------------- */

function NovaVydajkaScreen({ pracovnik, online, onBack, onCreated }) {
  const api = usePdaApi();
  const [ls, setLs] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [existujuce, setExistujuce] = useState(null); // varovanie: LS uz existuje
  const inputRef = useRef(null);
  const pendingId = useRef(null); // { id, cislo } - nepotvrdene zalozenie

  useEffect(() => { if (inputRef.current) inputRef.current.focus(); }, []);

  async function create(force) {
    const cislo = ls.replace(/[\x00-\x1F]/g, "").trim();
    if (!cislo) {
      setError("Zadejte číslo dodacího listu.");
      return;
    }
    setBusy(true);
    setError("");
    // ID drzime rovnake pri opakovani (pre to iste LS), aby stratena odpoved
    // nezalozila druhu vydajku.
    if (!pendingId.current || pendingId.current.cislo !== cislo) pendingId.current = { id: pdaId(), cislo };
    const id = pendingId.current.id;
    if (!force) {
      const { data: dup } = await api.findVydajkyByLs(cislo);
      const ine = (dup || []).filter((d) => d.id !== id);
      if (ine.length) {
        setBusy(false);
        setExistujuce(ine);
        return;
      }
    }
    const res = await createVydajkaFlow(api, { id, cislo_lieferschein: cislo, pracovnik });
    setBusy(false);
    if (!res.ok) {
      setError(res.message + (res.retry ? " Zkuste znovu." : ""));
      feedback("error");
      return;
    }
    pendingId.current = null;
    feedback("ok");
    onCreated(res.data);
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" style={FONT}>
      <PdaHeader title="Nová výdejka" pracovnik={pracovnik} online={online} onBack={onBack} />
      <form className="p-3 space-y-3" onSubmit={(e) => { e.preventDefault(); create(false); }}>
        <label className="block">
          <span className="block text-sm font-medium text-slate-600 mb-1">Číslo německého dodacího listu (Lieferschein)</span>
          <input
            ref={inputRef}
            value={ls}
            onChange={(e) => { setLs(e.target.value); setExistujuce(null); }}
            autoComplete="off"
            autoCapitalize="characters"
            className="w-full border-2 border-slate-300 rounded-xl px-3 py-3 text-2xl font-bold tracking-wide focus:outline-none focus:border-teal-600"
          />
          <span className="block text-xs text-slate-400 mt-1">Napište číslo, nebo naskenujte čárový kód z dodacího listu.</span>
        </label>
        {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={16} /> {error}</div>}
        {existujuce ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
            <div className="text-sm text-amber-900 font-medium">Výdejka s LS {ls.trim()} už existuje ({existujuce.map((d) => (d.stav === "dokoncena" ? "dokončená" : "rozpracovaná") + " " + formatDate(d.created_at)).join(", ")}).</div>
            <button type="button" disabled={busy} onClick={() => create(true)} className="w-full bg-amber-500 text-white rounded-lg py-3 font-semibold disabled:opacity-60">Přesto založit novou</button>
          </div>
        ) : (
          <button type="submit" disabled={busy || !online} className="w-full flex items-center justify-center gap-2 bg-teal-700 text-white rounded-xl py-4 text-lg font-bold disabled:opacity-60">
            {busy ? <Loader2 size={20} className="animate-spin" /> : <Plus size={20} />} Založit a skenovat
          </button>
        )}
        {!online && <div className="text-sm text-red-600 text-center">Bez připojení k síti nelze založit výdejku.</div>}
      </form>
    </div>
  );
}

/* ---------------- Vydajka: skenovanie palet ---------------- */

function PendingSlot({ label, done, children }) {
  return (
    <div className={"flex-1 rounded-lg border-2 px-2 py-1.5 min-w-0 " + (done ? "border-emerald-500 bg-emerald-50" : "border-dashed border-slate-300 bg-white")}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1">{done ? <CheckCircle2 size={12} className="text-emerald-600" /> : null}{label}</div>
      <div className="text-sm font-mono truncate">{children}</div>
    </div>
  );
}

function VydajkaScreen({ vydajka: initial, pracovnik, online, onBack }) {
  const api = usePdaApi();
  const [vydajka, setVydajka] = useState(initial);
  const [rows, setRows] = useState(null); // [{...paleta, _status: ok|saving|error|deleting, _error}]
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState(EMPTY_PENDING);
  const [banner, setBanner] = useState({ status: "idle", message: "Naskenujte SSCC nebo produktový kód palety." });
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [rucne, setRucne] = useState(false);
  const [rucnyKod, setRucnyKod] = useState("");
  const [souhrn, setSouhrn] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState("");
  const [hotovo, setHotovo] = useState(false);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const queuedScans = useRef([]);

  const load = useCallback(async () => {
    setLoadError("");
    const { data, error } = await api.loadPalety(initial.id);
    if (error) setLoadError(pdaErrorMessage(error));
    else setRows((prev) => mergeLoadedRows(prev, data));
  }, [api, initial.id]);

  useEffect(() => { load(); }, [load]);

  // Skeny zachytene pocas nacitania spracovat v poradi, ako prisli.
  useEffect(() => {
    if (rows === null || !queuedScans.current.length) return;
    const fronta = queuedScans.current;
    queuedScans.current = [];
    fronta.forEach((raw) => handleScan(raw));
  }, [rows]);

  // Varovanie pri zatvoreni karty, ak nieco este nie je ulozene.
  useEffect(() => {
    function onBeforeUnload(e) {
      const unsaved = (rowsRef.current || []).some((r) => r._status !== "ok") || pendingRef.current.sscc || pendingRef.current.produkt;
      if (unsaved) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  function patchRow(id, patch) {
    setRows((prev) => (prev || []).map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeRow(id) {
    setRows((prev) => (prev || []).filter((r) => r.id !== id));
  }

  async function savePallet(row) {
    patchRow(row.id, { _status: "saving", _error: "" });
    setBanner({ status: "saving", message: `Ukládám paletu …${row.sscc.slice(-6)}` });
    const res = await savePalletFlow(api, row);
    if (res.outcome === "ok") {
      patchRow(row.id, { ...res.data, _status: "ok", _error: "" });
      const varovanie = res.warning || ((row.data && row.data.warnings) || []).join(" ");
      setBanner({ status: varovanie ? "warn" : "ok", message: `Uloženo ✓ paleta …${row.sscc.slice(-6)}.${varovanie ? " " + varovanie : ""}` });
      feedback("ok");
      return;
    }
    // Pravidlo DB (duplicita, dokoncena vydajka) - riadok zmizne, opakovanie
    // nema zmysel. Chyba siete - riadok ostava "Neuloženo" na opakovanie.
    if (res.outcome === "rejected") removeRow(row.id);
    else patchRow(row.id, { _status: "error", _error: res.message });
    setBanner({ status: "error", message: "Paleta NEULOŽENA: " + res.message });
    feedback("error");
  }

  function handleScan(raw) {
    if (souhrn || hotovo) return;
    // Kym nevieme, ake palety uz vydajka ma, sken len odlozime do fronty
    // (kontrola duplicit potrebuje zoznam) - spracuje sa hned po nacitani.
    if (rowsRef.current === null) {
      queuedScans.current.push(raw);
      setBanner({ status: "saving", message: "Načítám palety výdejky… sken se zpracuje hned potom." });
      return;
    }
    const parsed = parseGs1(raw);
    const ssccSet = new Set((rowsRef.current || []).map((r) => r.sscc));
    const res = mergeScan(pendingRef.current, parsed, ssccSet);
    setPending(res.pending);
    pendingRef.current = res.pending;
    if (res.status !== "ready") {
      setBanner({ status: res.status, message: res.message });
      feedback(res.status === "error" ? "error" : "step");
      return;
    }
    const row = {
      id: pdaId(),
      vydajka_id: vydajka.id,
      ...res.pallet,
      pracovnik,
      data: { warnings: res.warnings || [], elements: parsed.elements.map((e) => ({ ai: e.ai, value: e.value })) },
      created_at: new Date().toISOString(),
      _status: "saving",
    };
    setRows((prev) => [row, ...(prev || [])]);
    savePallet(row);
  }

  function zrusitRozpracovanu() {
    setPending(EMPTY_PENDING);
    setBanner({ status: "idle", message: "Rozpracovaná paleta zrušena. Naskenujte další kód." });
  }

  async function smazat(row) {
    setConfirmDeleteId(null);
    if (row._status === "error") {
      removeRow(row.id);
      return;
    }
    patchRow(row.id, { _status: "deleting" });
    const res = await deletePalletFlow(api, row.id);
    if (!res.ok) {
      patchRow(row.id, { _status: "ok" });
      setBanner({ status: "error", message: "Paleta NESMAZÁNA: " + res.message });
      feedback("error");
      return;
    }
    removeRow(row.id);
    setBanner({ status: "info", message: `Paleta …${row.sscc.slice(-6)} smazána.` });
  }

  async function zrusitVydajku() {
    const { data, error } = await api.deleteVydajka(vydajka.id);
    if (error || !data || data.length !== 1) {
      setBanner({ status: "error", message: "Výdejku nelze zrušit: " + (pdaErrorMessage(error) || "nepotvrzeno.") });
      return;
    }
    onBack();
  }

  async function dokoncit() {
    setFinishing(true);
    setFinishError("");
    const res = await finishFlow(api, vydajka.id, pracovnik);
    setFinishing(false);
    if (!res.ok) {
      setFinishError(res.message);
      feedback("error");
      return;
    }
    setVydajka(res.data);
    setHotovo(true);
    feedback("ok");
  }

  const okRows = (rows || []).filter((r) => r._status === "ok" || r._status === "deleting");
  const unsaved = (rows || []).filter((r) => r._status === "saving" || r._status === "error");
  const maPending = !!(pending.sscc || pending.produkt);
  const finish = canFinish({ rows, pending, online });
  const mozeDokoncit = finish.ok;

  if (hotovo) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900" style={FONT}>
        <PdaHeader title={"LS " + vydajka.cislo_lieferschein} pracovnik={pracovnik} online={online} />
        <div className="p-4 text-center space-y-4">
          <PackageCheck size={64} className="mx-auto text-emerald-600" />
          <div className="text-2xl font-bold">Výdejka dokončena</div>
          <div className="text-slate-600">LS {vydajka.cislo_lieferschein} · {okRows.length} palet</div>
          <button onClick={onBack} className="w-full bg-teal-700 text-white rounded-xl py-4 text-lg font-bold">Hotovo</button>
        </div>
      </div>
    );
  }

  if (souhrn) {
    const sum = summarizePallets(okRows);
    const celkom = sum.reduce((s, r) => s + r.mnozstvo, 0);
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900" style={FONT}>
        <PdaHeader title={"Dokončit LS " + vydajka.cislo_lieferschein} pracovnik={pracovnik} online={online} onBack={() => setSouhrn(false)} />
        <div className="p-3 space-y-3">
          <div className="bg-white border border-slate-200 rounded-xl p-3">
            <div className="text-3xl font-bold">{okRows.length} <span className="text-base font-medium text-slate-500">palet</span></div>
            <div className="text-sm text-slate-500">Celkem {celkom} ks{sum.some((r) => r.mnozstvoNeuplne) ? " (u některých palet chybí množství)" : ""}</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {sum.map((r) => (
              <div key={r.gtin + r.bbd + r.sarza} className="px-3 py-2 text-sm">
                <div className="font-mono font-semibold">{r.gtin || "-"}</div>
                <div className="flex justify-between text-slate-600">
                  <span>BBD {formatDate(r.bbd) || "-"}{r.sarza ? " · " + r.sarza : ""}</span>
                  <span className="font-semibold text-slate-900">{r.palet} pal. · {r.mnozstvo}{r.mnozstvoNeuplne ? "+?" : ""} ks</span>
                </div>
              </div>
            ))}
          </div>
          {finishError && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={16} /> {finishError}</div>}
          <button onClick={dokoncit} disabled={finishing || !online} className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white rounded-xl py-4 text-lg font-bold disabled:opacity-60">
            {finishing ? <Loader2 size={20} className="animate-spin" /> : <PackageCheck size={22} />} Potvrdit dokončení
          </button>
          <button onClick={() => setSouhrn(false)} className="w-full text-slate-600 py-2">Zpět ke skenování</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-32" style={FONT}>
      <ScanInput onScan={handleScan} active={!rucne} />
      <PdaHeader title={"LS " + vydajka.cislo_lieferschein} pracovnik={pracovnik} online={online} onBack={onBack} />
      <div className="p-3 space-y-3">
        {!online && <div className="bg-red-600 text-white text-sm font-semibold px-3 py-2 rounded-md flex items-center gap-2"><WifiOff size={16} /> Bez připojení - palety se neuloží!</div>}
        <Banner status={banner.status} message={banner.message} />

        <div className="flex gap-2 items-stretch">
          <PendingSlot label="SSCC" done={!!pending.sscc}>{pending.sscc ? "…" + pending.sscc.slice(-8) : "—"}</PendingSlot>
          <PendingSlot label="Produkt" done={!!pending.produkt}>
            {pending.produkt ? `${pending.produkt.mnozstvo != null ? pending.produkt.mnozstvo + " ks" : "?"} · ${formatDate(pending.produkt.bbd) || "bez BBD"}` : "—"}
          </PendingSlot>
          {maPending && (
            <button onClick={zrusitRozpracovanu} className="px-2 rounded-lg border border-slate-300 text-slate-500 bg-white" aria-label="Zrušit rozpracovanou paletu"><XCircle size={20} /></button>
          )}
        </div>

        {rucne ? (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = rucnyKod; setRucnyKod(""); setRucne(false); handleScan(v); }}>
            <input autoFocus value={rucnyKod} onChange={(e) => setRucnyKod(e.target.value)} placeholder="(00)… nebo (02)…(15)…(37)…" className="flex-1 min-w-0 border-2 border-slate-300 rounded-lg px-2 py-2 font-mono text-sm" />
            <button type="submit" className="bg-teal-700 text-white rounded-lg px-3 text-sm font-semibold">OK</button>
            <button type="button" onClick={() => { setRucne(false); setRucnyKod(""); }} className="text-slate-500 px-1"><XCircle size={20} /></button>
          </form>
        ) : (
          <button onClick={() => setRucne(true)} className="text-xs text-slate-500 flex items-center gap-1"><Keyboard size={14} /> Ruční zadání kódu</button>
        )}

        <div>
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-slate-500">Palety ({okRows.length} uloženo{unsaved.length ? `, ${unsaved.length} neuloženo` : ""})</h2>
          </div>
          {loadError && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md mb-2">{loadError} <button onClick={load} className="underline ml-1">Znovu</button></div>}
          {!rows && !loadError && <div className="flex items-center gap-2 text-slate-500 py-4 justify-center"><Loader2 size={18} className="animate-spin" /> Načítám...</div>}
          <div className="space-y-1.5">
            {(rows || []).map((r) => (
              <div key={r.id} className={"bg-white border rounded-lg px-3 py-2 " + (r._status === "error" ? "border-red-300 bg-red-50" : r._status === "saving" ? "border-slate-300" : "border-slate-200")}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm truncate">{r.sscc.slice(0, -6)}<b className="text-base">{r.sscc.slice(-6)}</b></span>
                  {r._status === "ok" && <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700 shrink-0"><CheckCircle2 size={14} /> Uloženo</span>}
                  {r._status === "saving" && <span className="flex items-center gap-1 text-xs font-semibold text-slate-500 shrink-0"><Loader2 size={14} className="animate-spin" /> Ukládám…</span>}
                  {r._status === "deleting" && <span className="flex items-center gap-1 text-xs font-semibold text-slate-500 shrink-0"><Loader2 size={14} className="animate-spin" /> Mažu…</span>}
                  {r._status === "error" && <span className="flex items-center gap-1 text-xs font-semibold text-red-700 shrink-0"><XCircle size={14} /> Neuloženo</span>}
                </div>
                <div className="text-xs text-slate-600 flex flex-wrap gap-x-2">
                  <span className="font-mono">{r.gtin}</span>
                  <span>BBD {formatDate(r.bbd) || "-"}</span>
                  {r.sarza && <span>Š: {r.sarza}</span>}
                  <span className="font-semibold">{r.mnozstvo != null ? r.mnozstvo + " ks" : "? ks"}</span>
                </div>
                {r._status === "error" && (
                  <div className="mt-1.5">
                    <div className="text-xs text-red-700 mb-1">{r._error}</div>
                    <div className="flex gap-2">
                      <button onClick={() => savePallet(r)} className="flex-1 flex items-center justify-center gap-1 bg-red-600 text-white rounded-md py-2 text-sm font-semibold"><RotateCcw size={14} /> Zkusit znovu</button>
                      <button onClick={() => removeRow(r.id)} className="px-3 border border-red-300 text-red-700 rounded-md text-sm">Zahodit</button>
                    </div>
                  </div>
                )}
                {r._status === "ok" && (
                  confirmDeleteId === r.id ? (
                    <div className="flex gap-2 mt-1.5">
                      <button onClick={() => smazat(r)} className="flex-1 bg-red-600 text-white rounded-md py-2 text-sm font-semibold">Opravdu smazat</button>
                      <button onClick={() => setConfirmDeleteId(null)} className="px-3 border border-slate-300 rounded-md text-sm">Ne</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDeleteId(r.id)} className="mt-1 text-xs text-slate-400 flex items-center gap-1"><Trash2 size={12} /> Smazat</button>
                  )
                )}
              </div>
            ))}
          </div>
          {rows && rows.length === 0 && (
            <div className="text-center pt-4">
              <div className="text-sm text-slate-400 mb-3">Zatím žádná paleta.</div>
              <button onClick={zrusitVydajku} className="text-xs text-red-600">Zrušit tuto prázdnou výdejku</button>
            </div>
          )}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-3 bg-white/95 border-t border-slate-200">
        <button onClick={() => setSouhrn(true)} disabled={!mozeDokoncit} className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white rounded-xl py-3.5 text-lg font-bold disabled:bg-slate-300 disabled:text-slate-500">
          <PackageCheck size={22} /> Dokončit výdejku ({okRows.length})
        </button>
        {!mozeDokoncit && (rows || []).length > 0 && (
          <div className="text-[11px] text-slate-500 text-center mt-1">{finish.reason}</div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Test skeneru (diagnostika na PDA) ---------------- */

function TestSkeneruScreen({ pracovnik, online, onBack }) {
  const [scans, setScans] = useState([]);
  const chrome = (navigator.userAgent.match(/Chrome\/(\d+)/) || [])[1];

  function onScan(raw) {
    const parsed = parseGs1(raw);
    feedback(parsed.ok ? "ok" : "error");
    setScans((prev) => [{ key: Date.now() + Math.random(), raw, parsed }, ...prev].slice(0, 10));
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" style={FONT}>
      <ScanInput onScan={onScan} />
      <PdaHeader title="Test skeneru" pracovnik={pracovnik} online={online} onBack={onBack} />
      <div className="p-3 space-y-2">
        <div className="text-xs text-slate-500">Chrome {chrome || "?"} · nic se neukládá. Naskenujte oba kódy palety a zkontrolujte, že se oddělovač zobrazí jako ⟨GS⟩.</div>
        {scans.length === 0 && <Banner status="idle" message="Naskenujte kód…" />}
        {scans.map(({ key, raw, parsed }) => (
          <div key={key} className={"bg-white border rounded-lg p-2 text-xs " + (parsed.ok ? "border-emerald-300" : "border-red-300")}>
            <div className="font-mono break-all bg-slate-100 rounded px-1.5 py-1 mb-1">{visibleControlChars(raw)}</div>
            <div className="text-slate-500 mb-1">{raw.length} znaků · typ: {parsed.kind}</div>
            {parsed.elements.map((el, i) => (
              <div key={i} className="flex gap-2"><span className="font-mono font-semibold w-12 shrink-0">({el.ai})</span><span className="font-mono break-all">{el.value}</span><span className="text-slate-400 truncate">{el.label}{el.date ? " = " + formatDate(el.date) : ""}</span></div>
            ))}
            {parsed.errors.map((e, i) => <div key={"e" + i} className="text-red-700 font-semibold">✗ {e}</div>)}
            {parsed.warnings.map((w, i) => <div key={"w" + i} className="text-amber-700">! {w}</div>)}
          </div>
        ))}
      </div>
    </div>
  );
}
