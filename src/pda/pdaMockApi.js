// Simulovana databaza pre testovaci rezim PDA (?pda=test) a automaticke testy.
// Napodobnuje pravidla zo supabase/2026-10-13_pda.sql (triggre + RLS) vratane
// tvaru chybovych hlasok, takze UI sa sprava rovnako ako proti Supabase.
// NIKDY nevola Supabase - data su len v pamati (volitelne v localStorage
// tohto prehliadaca).
//
// Rezimy siete (setNetMode):
//   "ok"            - vsetko funguje,
//   "offline"       - kazde volanie zlyha ako "Failed to fetch", nic sa nezapise,
//   "lostResponse"  - ZAPIS sa vykona, ale odpoved sa "strati" (chyba siete)
//                     -> testuje opakovane odoslanie bez duplicity,
//   "slow"          - kazde volanie trva ~2,5 s.

const NET_ERROR = { message: "TypeError: Failed to fetch" };
const STORAGE_KEY = "stenger_pda_demo_db";

// Testovacie produkty k testovacim GTIN (pdaTestCodes.js) - pre NVE list.
const DEMO_PRODUCTS = [
  { id: "demo-1", znacka: "TEST POPCORN", gramaz: "200", cisloArtikluSW: "62 99901", eanKarton: "14001234000012" },
  { id: "demo-2", znacka: "TEST OPLATKY", gramaz: "100", cisloArtikluSW: "62 99902", eanKarton: "4001234000015" },
];

const DEMO_WORKERS = [
  { meno: "Martin Dostál", typ: "sklad" },
  { meno: "Test Skladník", typ: "sklad" },
  { meno: "Zástup Test", typ: "vyroba", zaskok: true },
];

function pdaError(code, text) {
  return { code: "P0001", message: `${code}: ${text}` };
}

function clone(x) {
  return x == null ? x : JSON.parse(JSON.stringify(x));
}

export function createPdaMockStore({ persist = false } = {}) {
  let state = { vydajky: [], palety: [] };
  if (persist) {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved && Array.isArray(saved.vydajky) && Array.isArray(saved.palety)) state = saved;
    } catch (e) {}
  }
  const listeners = new Set();
  let netMode = "ok";
  let clock = 0;

  function save() {
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
    }
    listeners.forEach((fn) => { try { fn(); } catch (e) {} });
  }

  // Monotonny cas, aby poradie created_at bolo jednoznacne aj v testoch.
  function now() {
    const t = Math.max(Date.now(), clock + 1);
    clock = t;
    return new Date(t).toISOString();
  }

  return {
    get state() { return state; },
    get netMode() { return netMode; },
    setNetMode(m) { netMode = m; save(); },
    reset() { state = { vydajky: [], palety: [] }; save(); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    save,
    now,
  };
}

// role: "sklad" (PDA) alebo "office" (prehlad) - podla toho plati RLS.
export function createMockPdaApi(store, { role = "sklad", latencyMs = 250 } = {}) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // read: citanie, write(fn): zapis - fn vracia { data, error }.
  async function call(fn, { write = false } = {}) {
    const mode = store.netMode;
    await wait(mode === "slow" ? 2500 : latencyMs);
    if (mode === "offline") return { data: null, error: NET_ERROR };
    const res = fn();
    if (!res.error && write) store.save();
    if (write && !res.error && mode === "lostResponse") return { data: null, error: NET_ERROR };
    return res;
  }

  const S = () => store.state;
  const vydajka = (id) => S().vydajky.find((v) => v.id === id);
  const office = role === "office";

  function ssccVDokoncenej(sscc, okremVydajky) {
    for (const p of S().palety) {
      if (p.sscc !== sscc || p.vydajka_id === okremVydajky) continue;
      const v = vydajka(p.vydajka_id);
      if (v && v.stav === "dokoncena") return v;
    }
    return null;
  }

  return {
    isDemo: true,
    store,

    listWorkers: () => call(() => ({ data: DEMO_WORKERS.map((w) => ({ data: w })), error: null })),

    listProducts: () => call(() => ({ data: clone(DEMO_PRODUCTS), error: null })),

    listOrdersForSklad: () => call(() => ({ data: [], error: null })),

    listOpenVydajky: () =>
      call(() => ({
        data: S().vydajky
          .filter((v) => v.stav === "rozpracovana")
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
          .map((v) => ({ ...clone(v), pda_palety: [{ count: S().palety.filter((p) => p.vydajka_id === v.id).length }] })),
        error: null,
      })),

    findVydajkyByLs: (cislo) =>
      call(() => ({ data: S().vydajky.filter((v) => v.cislo_lieferschein === cislo).map((v) => ({ id: v.id, stav: v.stav, created_at: v.created_at })), error: null })),

    createVydajka: (row) =>
      call(() => {
        if (vydajka(row.id)) return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "pda_vydajky_pkey"' } };
        const cislo = String(row.cislo_lieferschein || "").trim();
        if (!cislo || cislo.length > 50) return { data: null, error: { code: "23514", message: 'new row for relation "pda_vydajky" violates check constraint' } };
        if (row.order_id && !office) return { data: null, error: pdaError("PDA_ORDER_ID", "Propojení s objednávkou smí nastavit jen kancelář.") };
        const t = store.now();
        const v = {
          id: row.id, cislo_lieferschein: row.cislo_lieferschein, stav: "rozpracovana", pracovnik: row.pracovnik || "",
          dokoncil: "", poznamka: "", order_id: row.order_id || null, data: {}, created_by: "demo-" + role,
          created_at: t, updated_at: t, dokoncena_at: null,
        };
        S().vydajky.push(v);
        return { data: clone(v), error: null };
      }, { write: true }),

    getVydajka: (id) => call(() => ({ data: clone(vydajka(id) || null), error: null })),

    loadPalety: (vydajkaId) =>
      call(() => ({ data: clone(S().palety.filter((p) => p.vydajka_id === vydajkaId).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))), error: null })),

    findSscc: (sscc) =>
      call(() => ({
        data: S().palety.filter((p) => p.sscc === sscc).map((p) => {
          const v = vydajka(p.vydajka_id);
          return { vydajka_id: p.vydajka_id, pda_vydajky: v ? { stav: v.stav, cislo_lieferschein: v.cislo_lieferschein } : null };
        }),
        error: null,
      })),

    insertPaleta: (payload) =>
      call(() => {
        if (S().palety.some((p) => p.id === payload.id)) return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "pda_palety_pkey"' } };
        if (!/^\d{18}$/.test(payload.sscc || "")) return { data: null, error: { code: "23514", message: 'new row for relation "pda_palety" violates check constraint "pda_palety_sscc_check"' } };
        const v = vydajka(payload.vydajka_id);
        if (!v || v.stav !== "rozpracovana") return { data: null, error: pdaError("PDA_VYDAJKA_DOKONCENA", "Výdejka není rozpracovaná, paletu nelze přidat.") };
        if (S().palety.some((p) => p.vydajka_id === payload.vydajka_id && p.sscc === payload.sscc)) {
          return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "pda_palety_vydajka_id_sscc_key"' } };
        }
        const dup = ssccVDokoncenej(payload.sscc, payload.vydajka_id);
        if (dup) return { data: null, error: pdaError("PDA_SSCC_DUPLICITA", `SSCC ${payload.sscc} je již v dokončené výdejce ${dup.cislo_lieferschein}.`) };
        const p = {
          id: payload.id, vydajka_id: payload.vydajka_id, sscc: payload.sscc, gtin: payload.gtin || null, bbd: payload.bbd || null,
          bbd_ai: payload.bbd_ai || null, sarza: payload.sarza == null ? null : payload.sarza, mnozstvo: payload.mnozstvo == null ? null : payload.mnozstvo,
          raw_sscc: payload.raw_sscc || "", raw_produkt: payload.raw_produkt || "", pracovnik: payload.pracovnik || "",
          data: payload.data || {}, created_by: "demo-" + role, created_at: store.now(),
        };
        S().palety.push(p);
        return { data: clone(p), error: null };
      }, { write: true }),

    getPaleta: (id) => call(() => ({ data: clone(S().palety.find((p) => p.id === id) || null), error: null })),

    deletePaleta: (id) =>
      call(() => {
        const p = S().palety.find((x) => x.id === id);
        if (!p) return { data: [], error: null };
        const v = vydajka(p.vydajka_id);
        if (v && v.stav === "dokoncena") return { data: null, error: pdaError("PDA_VYDAJKA_DOKONCENA", "Výdejka je dokončená, paletu nelze měnit ani smazat.") };
        S().palety = S().palety.filter((x) => x.id !== id);
        return { data: [clone(p)], error: null };
      }, { write: true }),

    deleteVydajka: (id) =>
      call(() => {
        const v = vydajka(id);
        if (!v) return { data: [], error: null };
        const pocet = S().palety.filter((p) => p.vydajka_id === id).length;
        // RLS: sklad zmaze len prazdnu rozpracovanu (inak 0 riadkov, bez chyby).
        if (!office && (v.stav !== "rozpracovana" || pocet > 0)) return { data: [], error: null };
        S().vydajky = S().vydajky.filter((x) => x.id !== id);
        S().palety = S().palety.filter((p) => p.vydajka_id !== id);
        return { data: [clone(v)], error: null };
      }, { write: true }),

    finishVydajka: (id, dokoncil) =>
      call(() => {
        const v = vydajka(id);
        if (!v || v.stav !== "rozpracovana") return { data: null, error: null };
        const moje = S().palety.filter((p) => p.vydajka_id === id);
        if (!moje.length) return { data: null, error: pdaError("PDA_PRAZDNA", "Výdejka nemá žádnou paletu.") };
        for (const p of moje) {
          const dup = ssccVDokoncenej(p.sscc, id);
          if (dup) return { data: null, error: pdaError("PDA_SSCC_DUPLICITA", `SSCC ${p.sscc} (výdejka ${dup.cislo_lieferschein}) je již v dokončené výdejce.`) };
        }
        const t = store.now();
        Object.assign(v, { stav: "dokoncena", dokoncil: dokoncil || "", dokoncena_at: t, updated_at: t });
        return { data: clone(v), error: null };
      }, { write: true }),

    reopenVydajka: (id) =>
      call(() => {
        const v = vydajka(id);
        if (!v || !office) return { data: null, error: null };
        Object.assign(v, { stav: "rozpracovana", dokoncil: "", dokoncena_at: null, updated_at: store.now() });
        return { data: clone(v), error: null };
      }, { write: true }),

    listVydajkyOd: (odIso) =>
      call(() => ({ data: clone(S().vydajky.filter((v) => !odIso || v.created_at >= odIso).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))), error: null })),

    listPaletyOd: (odIso) =>
      call(() => ({
        data: clone(S().palety.filter((p) => {
          const v = vydajka(p.vydajka_id);
          return v && (!odIso || v.created_at >= odIso);
        }).sort((a, b) => (a.created_at < b.created_at ? -1 : 1))),
        error: null,
      })),

    subscribe: (onChange) => store.subscribe(onChange),
  };
}
