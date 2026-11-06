import { describe, it, expect, beforeAll } from "vitest";
import { parseGs1 } from "../lib/gs1Pda.js";
import { mergeScan, EMPTY_PENDING, pdaId } from "../lib/pdaScan.js";
import { savePalletFlow, deletePalletFlow, finishFlow, canFinish, createVydajkaFlow, mergeLoadedRows } from "../lib/pdaFlow.js";
import { buildPdaExportSheets } from "../lib/pdaExport.js";
import { randomSscc, ssccCode, produktCode, DEMO_GTINS } from "../lib/pdaTestCodes.js";
import { createPdaMockStore, createMockPdaApi } from "./pdaMockApi.js";
import { createSupabaseLikeDb } from "./__testutils__/pgliteSupabase.js";
import { createPglitePdaApi, withNetworkFaults } from "./__testutils__/pglitePdaApi.js";

// Kompletny postup PDA vydajky (bez Reactu) - rovnake kroky ako PdaMobileView.
// Kazdy scenar bezi DVAKRAT:
//   * "simulacia" = pdaMockApi.js (testovaci rezim ?pda=test),
//   * "Postgres"  = skutocna DB (PGlite) so supabase/2026-10-13_pda.sql,
// cim sa zaroven overuje, ze simulacia sa sprava ako produkcna DB.

const TODAY = new Date(2026, 9, 13);
const BBD = "2027-03-15";

async function mockBackend() {
  const store = createPdaMockStore();
  const net = { mode: "ok" };
  return {
    api: withNetworkFaults(createMockPdaApi(store, { role: "sklad", latencyMs: 0 }), net),
    office: createMockPdaApi(store, { role: "office", latencyMs: 0 }),
    net,
  };
}

async function pgBackend() {
  const { q } = await createSupabaseLikeDb();
  const net = { mode: "ok" };
  return { api: withNetworkFaults(createPglitePdaApi(q, "sklad"), net), office: createPglitePdaApi(q, "office"), net };
}

// Napodobenie VydajkaScreen: rozpracovana paleta + riadky so stavom.
function createSession(api, vydajkaId) {
  const s = {
    pending: EMPTY_PENDING,
    rows: [],
    async scan(raw) {
      const parsed = parseGs1(raw, TODAY);
      const res = mergeScan(s.pending, parsed, new Set(s.rows.map((r) => r.sscc)));
      s.pending = res.pending;
      if (res.status !== "ready") return res;
      const row = { id: pdaId(), vydajka_id: vydajkaId, ...res.pallet, pracovnik: "Test", data: { warnings: res.warnings }, _status: "saving" };
      s.rows.unshift(row);
      return { ...res, save: await s.save(row), row };
    },
    async save(row) {
      row._status = "saving";
      const out = await savePalletFlow(api, row);
      if (out.outcome === "ok") Object.assign(row, out.data, { _status: "ok" });
      else if (out.outcome === "rejected") s.rows = s.rows.filter((r) => r !== row);
      else row._status = "error";
      return out;
    },
    // Cela paleta: SSCC a produkt v zvolenom poradi.
    async paleta({ sscc = randomSscc(), poradie = "sscc", produkt = { bbd: BBD, mnozstvo: 48, sarza: "L1" } } = {}) {
      const kody = [ssccCode(sscc), produktCode(produkt)];
      if (poradie !== "sscc") kody.reverse();
      const prvy = await s.scan(kody[0]);
      const druhy = await s.scan(kody[1]);
      return { sscc, prvy, druhy, row: druhy.row };
    },
    finishCheck: (online = true) => canFinish({ rows: s.rows, pending: s.pending, online }),
  };
  return s;
}

async function novaVydajka(api, ls) {
  const res = await createVydajkaFlow(api, { id: pdaId(), cislo_lieferschein: ls, pracovnik: "Test" });
  expect(res.ok).toBe(true);
  return res.data;
}

const pocetPalet = async (office, vydajkaId) => (await office.listPaletyOd(null)).data.filter((p) => p.vydajka_id === vydajkaId).length;

describe.each([
  ["simulacia", mockBackend],
  ["Postgres", pgBackend],
])("PDA postup - %s", (_nazov, makeBackend) => {
  let api, office, net;
  beforeAll(async () => {
    ({ api, office, net } = await makeBackend());
  }, 60000);
  const ok = () => { net.mode = "ok"; };

  it("kompletny postup: vydajka, palety v oboch poradiach, dokoncenie, Excel", async () => {
    ok();
    const v = await novaVydajka(api, "LS-80001");
    expect(v.stav).toBe("rozpracovana");
    const s = createSession(api, v.id);

    const a = await s.paleta({ poradie: "sscc" });
    expect(a.prvy.status).toBe("wait");
    expect(a.druhy.save.outcome).toBe("ok");
    const b = await s.paleta({ poradie: "produkt", produkt: { gtin: DEMO_GTINS[1].gtin, bbd: "2027-04-30", mnozstvo: 24, sarza: "L2" } });
    expect(b.prvy.message).toMatch(/naskenujte SSCC/);
    expect(b.druhy.save.outcome).toBe("ok");
    expect(b.row).toMatchObject({ gtin: DEMO_GTINS[1].gtin, bbd: "2027-04-30", mnozstvo: 24, sarza: "L2", _status: "ok" });

    const open = (await api.listOpenVydajky()).data.find((x) => x.id === v.id);
    expect(open.pda_palety[0].count).toBe(2);

    expect(s.finishCheck()).toEqual({ ok: true, reason: "" });
    const fin = await finishFlow(api, v.id, "Test");
    expect(fin.ok).toBe(true);
    expect(fin.data.stav).toBe("dokoncena");
    expect(fin.data.dokoncena_at).toBeTruthy();

    const vyd = (await office.listVydajkyOd(null)).data.filter((x) => x.id === v.id);
    const pal = (await office.listPaletyOd(null)).data;
    const [palety, souhrn, vydajky] = buildPdaExportSheets(vyd, pal);
    expect(palety.rows).toHaveLength(2);
    expect(palety.rows.map((r) => r.SSCC).sort()).toEqual([a.sscc, b.sscc].sort());
    expect(palety.rows[0]).toMatchObject({ Lieferschein: "LS-80001", "Stav výdejky": "Dokončená", BBD: "15.03.2027", "Množství (AI 37)": 48 });
    expect(souhrn.rows).toHaveLength(2);
    expect(vydajky.rows[0]).toMatchObject({ Lieferschein: "LS-80001", Stav: "Dokončená", Palet: 2 });
  });

  it("opakovane skenovanie: ta ista paleta znova = chyba, v DB stale 1", async () => {
    ok();
    const v = await novaVydajka(api, "LS-80002");
    const s = createSession(api, v.id);
    const a = await s.paleta();
    const znova = await s.scan(ssccCode(a.sscc));
    expect(znova.status).toBe("error");
    expect(znova.message).toMatch(/už je v této výdejce/);
    // To iste SSCC z druheho PDA (lokalna kontrola ho nevidi) -> zastavi DB.
    const druhePda = createSession(api, v.id);
    const d = await druhePda.paleta({ sscc: a.sscc });
    expect(d.druhy.save.outcome).toBe("rejected");
    expect(d.druhy.save.message).toMatch(/už je v této výdejce/);
    expect(await pocetPalet(office, v.id)).toBe(1);
  });

  it("duplicita SSCC voci dokoncenej vydajke + varovanie pri rozpracovanej", async () => {
    ok();
    const v1 = await novaVydajka(api, "LS-80003");
    const s1 = createSession(api, v1.id);
    const a = await s1.paleta();
    const v2 = await novaVydajka(api, "LS-80004");
    const s2 = createSession(api, v2.id);
    // Rozpracovana v1 -> v2 sa ulozi, ale s varovanim.
    const w = await s2.paleta({ sscc: a.sscc });
    expect(w.druhy.save.outcome).toBe("ok");
    expect(w.druhy.save.warning).toMatch(/LS-80003/);
    // Dokoncime v1 -> v2 uz dokoncit nejde.
    expect((await finishFlow(api, v1.id, "Test")).ok).toBe(true);
    const f2 = await finishFlow(api, v2.id, "Test");
    expect(f2.ok).toBe(false);
    expect(f2.message).toMatch(/je již v dokončené výdejce/);
    // Nova vydajka: SSCC z dokoncenej v1 -> odmietnute.
    const v3 = await novaVydajka(api, "LS-80005");
    const r = await createSession(api, v3.id).paleta({ sscc: a.sscc });
    expect(r.druhy.save.outcome).toBe("rejected");
    expect(r.druhy.save.message).toMatch(/LS-80003/);
    expect(await pocetPalet(office, v3.id)).toBe(0);
  });

  it("duplicitu zastavi DB aj ked predbezna kontrola zlyha (siet)", async () => {
    ok();
    const v1 = await novaVydajka(api, "LS-80006");
    const a = await createSession(api, v1.id).paleta();
    await finishFlow(api, v1.id, "Test");
    const v2 = await novaVydajka(api, "LS-80007");
    const bezKontroly = { ...api, findSscc: async () => ({ data: null, error: { message: "TypeError: Failed to fetch" } }) };
    const r = await createSession(bezKontroly, v2.id).paleta({ sscc: a.sscc });
    expect(r.druhy.save.outcome).toBe("rejected");
    expect(r.druhy.save.message).toMatch(/je již v dokončené výdejce LS-80006/);
  });

  it("bez siete: paleta NEULOZENA, v DB nic, po obnove 'Zkusit znovu' = 1 paleta", async () => {
    ok();
    const v = await novaVydajka(api, "LS-80008");
    const s = createSession(api, v.id);
    net.mode = "offline";
    const r = await s.paleta();
    expect(r.druhy.save.outcome).toBe("retry");
    expect(r.druhy.save.message).toMatch(/Bez připojení/);
    expect(r.row._status).toBe("error");
    expect(s.finishCheck(true)).toMatchObject({ ok: false, reason: "Některé palety nejsou uložené." });
    ok();
    expect(await pocetPalet(office, v.id)).toBe(0);
    const again = await s.save(r.row);
    expect(again.outcome).toBe("ok");
    expect(r.row._status).toBe("ok");
    expect(await pocetPalet(office, v.id)).toBe(1);
    expect(s.finishCheck()).toMatchObject({ ok: true });
  });

  it("stratena odpoved pri ulozeni: opakovanie NEVYTVORI duplicitu", async () => {
    ok();
    const v = await novaVydajka(api, "LS-80009");
    const s = createSession(api, v.id);
    net.mode = "lostResponse";
    const r = await s.paleta();
    expect(r.druhy.save.outcome).toBe("retry");
    ok();
    expect(await pocetPalet(office, v.id)).toBe(1); // v DB uz je
    const again = await s.save(r.row);
    expect(again.outcome).toBe("ok");
    expect(await pocetPalet(office, v.id)).toBe(1);
  });

  it("stratena odpoved + overenie bez siete = stale 'retry', nie zahodenie", async () => {
    ok();
    const v = await novaVydajka(api, "LS-80010");
    const s = createSession(api, v.id);
    net.mode = "lostResponse";
    const r = await s.paleta();
    net.mode = "offline";
    expect((await s.save(r.row)).outcome).toBe("retry");
    expect(s.rows).toContain(r.row);
    ok();
    expect((await s.save(r.row)).outcome).toBe("ok");
    expect(await pocetPalet(office, v.id)).toBe(1);
  });

  it("stratena odpoved pri zalozeni vydajky: opakovanie s rovnakym ID = 1 vydajka", async () => {
    ok();
    const row = { id: pdaId(), cislo_lieferschein: "LS-80011", pracovnik: "Test" };
    net.mode = "lostResponse";
    const r1 = await createVydajkaFlow(api, row);
    expect(r1).toMatchObject({ ok: false, retry: true });
    ok();
    const r2 = await createVydajkaFlow(api, row);
    expect(r2.ok).toBe(true);
    expect((await api.findVydajkyByLs("LS-80011")).data).toHaveLength(1);
  });

  it("stratena odpoved pri dokonceni: overenie zisti, ze je dokoncena", async () => {
    ok();
    const v = await novaVydajka(api, "LS-80012");
    await createSession(api, v.id).paleta();
    net.mode = "lostResponse";
    const f = await finishFlow(api, v.id, "Test");
    // Overenie (citanie) prebehne - stratila sa len odpoved na zapis.
    expect(f.ok).toBe(true);
    expect(f.data.stav).toBe("dokoncena");
    ok();
    // Opakovane "Potvrdit" uz tiez hlasi uspech, nie chybu.
    expect((await finishFlow(api, v.id, "Test")).ok).toBe(true);
  });

  it("dokoncenie bez siete: vydajka ostava rozpracovana", async () => {
    ok();
    const v = await novaVydajka(api, "LS-80013");
    await createSession(api, v.id).paleta();
    net.mode = "offline";
    const f = await finishFlow(api, v.id, "Test");
    expect(f.ok).toBe(false);
    ok();
    expect((await api.getVydajka(v.id)).data.stav).toBe("rozpracovana");
  });

  it("mazanie palety: bez siete zostane, stratena odpoved = zmazana", async () => {
    ok();
    const v = await novaVydajka(api, "LS-80014");
    const s = createSession(api, v.id);
    const a = await s.paleta();
    const b = await s.paleta();
    net.mode = "offline";
    expect((await deletePalletFlow(api, a.row.id)).ok).toBe(false);
    ok();
    expect(await pocetPalet(office, v.id)).toBe(2);
    net.mode = "lostResponse";
    expect((await deletePalletFlow(api, b.row.id)).ok).toBe(true);
    ok();
    expect(await pocetPalet(office, v.id)).toBe(1);
  });

  it("neuplne palety: dokoncit nejde, kym nie je paleta kompletna alebo zrusena", async () => {
    ok();
    const v = await novaVydajka(api, "LS-80015");
    const s = createSession(api, v.id);
    await s.paleta();
    const sscc = randomSscc();
    expect((await s.scan(ssccCode(sscc))).status).toBe("wait");
    expect(s.finishCheck()).toMatchObject({ ok: false, reason: "Dokončete nebo zrušte rozpracovanou paletu." });
    // Ine SSCC pri rozpracovanej palete -> chyba, rozpracovana sa neprepise.
    expect((await s.scan(ssccCode(randomSscc()))).status).toBe("error");
    expect(s.pending.sscc).toBe(sscc);
    s.pending = EMPTY_PENDING; // "Zrušit rozpracovanou paletu"
    expect(s.finishCheck()).toMatchObject({ ok: true });
    // Len produktovy kod -> tiez neuplna.
    expect((await s.scan(produktCode({ bbd: BBD, mnozstvo: 48 }))).status).toBe("wait");
    expect(s.finishCheck().ok).toBe(false);
    s.pending = EMPTY_PENDING;
    expect(await pocetPalet(office, v.id)).toBe(1);
  });

  it("etiketa bez BBD a mnozstva: ulozi sa s varovanim, suhrn oznaci neuplne mnozstvo", async () => {
    ok();
    const v = await novaVydajka(api, "LS-80016");
    const s = createSession(api, v.id);
    const r = await s.paleta({ produkt: {} });
    expect(r.druhy.warnings.join(" ")).toMatch(/BBD/);
    expect(r.druhy.warnings.join(" ")).toMatch(/množství/);
    expect(r.druhy.save.outcome).toBe("ok");
    expect(r.row).toMatchObject({ bbd: null, mnozstvo: null });
    const vyd = (await office.listVydajkyOd(null)).data.filter((x) => x.id === v.id);
    const [, souhrn] = buildPdaExportSheets(vyd, (await office.listPaletyOd(null)).data);
    expect(souhrn.rows[0]["Neúplné množství"]).toBe("ano");
  });

  it("prazdna vydajka: dokoncit nejde; sklad ju moze zrusit, neprazdnu nie", async () => {
    ok();
    const v = await novaVydajka(api, "LS-80017");
    const s = createSession(api, v.id);
    expect(s.finishCheck()).toMatchObject({ ok: false, reason: "Výdejka nemá žádnou uloženou paletu." });
    const f = await finishFlow(api, v.id, "Test");
    expect(f.ok).toBe(false);
    expect(f.message).toBe("Výdejka nemá žádnou paletu.");
    expect((await api.deleteVydajka(v.id)).data).toHaveLength(1);

    const v2 = await novaVydajka(api, "LS-80018");
    await createSession(api, v2.id).paleta();
    expect((await api.deleteVydajka(v2.id)).data).toHaveLength(0);
  });

  it("dokoncena vydajka je pre sklad zamknuta; office ju vie znovu otvorit", async () => {
    ok();
    const v = await novaVydajka(api, "LS-80019");
    const s = createSession(api, v.id);
    const a = await s.paleta();
    await finishFlow(api, v.id, "Test");
    const r = await s.paleta();
    expect(r.druhy.save.outcome).toBe("rejected");
    expect(r.druhy.save.message).toMatch(/není rozpracovaná/);
    expect((await deletePalletFlow(api, a.row.id)).ok).toBe(false);
    const reopened = await office.reopenVydajka(v.id);
    expect(reopened.data).toMatchObject({ stav: "rozpracovana", dokoncena_at: null });
    expect((await s.paleta()).druhy.save.outcome).toBe("ok");
  });
});

describe("simulacia - prepinac siete v testovacom rezime", () => {
  it("offline = chyba siete a nic sa nezapise; lostResponse = zapise sa, ale chyba", async () => {
    const store = createPdaMockStore();
    const api = createMockPdaApi(store, { latencyMs: 0 });
    store.setNetMode("offline");
    const r1 = await api.createVydajka({ id: "A", cislo_lieferschein: "1" });
    expect(r1.error.message).toMatch(/Failed to fetch/);
    expect(store.state.vydajky).toHaveLength(0);
    store.setNetMode("lostResponse");
    const r2 = await api.createVydajka({ id: "B", cislo_lieferschein: "2" });
    expect(r2.error.message).toMatch(/Failed to fetch/);
    expect(store.state.vydajky).toHaveLength(1);
    // Citanie pri lostResponse funguje (stratia sa len odpovede na zapis).
    expect((await api.getVydajka("B")).data.cislo_lieferschein).toBe("2");
  });
});

describe("mergeLoadedRows - nacitanie palet dobehne az po skenovani", () => {
  it("neprepise lokalne neulozene riadky, potvrdene nahradi verziou z DB", () => {
    const prev = [
      { id: "a", sscc: "1", _status: "saving" },
      { id: "b", sscc: "2", _status: "error" },
      { id: "c", sscc: "3", _status: "ok", mnozstvo: 1 },
    ];
    const loaded = [{ id: "c", sscc: "3", mnozstvo: 2 }, { id: "d", sscc: "4" }];
    const out = mergeLoadedRows(prev, loaded);
    expect(out.map((r) => r.id + ":" + r._status)).toEqual(["a:saving", "b:error", "c:ok", "d:ok"]);
    expect(out.find((r) => r.id === "c").mnozstvo).toBe(2);
  });
  it("prve nacitanie (prev = null)", () => {
    expect(mergeLoadedRows(null, [{ id: "x" }])).toEqual([{ id: "x", _status: "ok" }]);
  });
  it("riadok v ukladani, ktory uz v DB je, ostava lokalny (dokonci ho savePallet)", () => {
    const out = mergeLoadedRows([{ id: "a", _status: "saving" }], [{ id: "a" }]);
    expect(out).toEqual([{ id: "a", _status: "saving" }]);
  });
});
