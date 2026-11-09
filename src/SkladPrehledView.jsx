// Prehlad skladu pre kancelariu: co treba vyriesit (problemove prijmy, visiace
// rozpracovane prijmy a vydajky, rozdiely objednavka/prijem, faktury ke kontrole)
// a co sa dnes deje (prijate, caka na prijem, expedicie na potvrdenie).

import React, { useState, useEffect, useCallback } from "react";
import { Loader2, AlertCircle, CheckCircle2, TriangleAlert, PackagePlus, Truck, ScanBarcode, Receipt, Clock } from "lucide-react";
import { supabase } from "./supabaseClient.js";
import { todayStr, formatDateTime } from "./lib/utils.js";
import { popisRozpracovaneho } from "./lib/prijemRozpracovany.js";
import { prijmyNaVyriesenie, rozdielyObjednavok, expedicieNaPotvrdenie, cakaNaPrijem, jeZPredoslehoDna } from "./lib/skladPrehled.js";

function Sekcia({ ikona, nazov, pocet, ton = "slate", children, akcia }) {
  const tony = {
    red: "border-red-300 bg-red-50",
    amber: "border-amber-300 bg-amber-50",
    slate: "border-slate-200 bg-white",
  };
  return (
    <div className={"border-2 rounded-xl p-4 mb-4 " + tony[ton]}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 font-semibold text-slate-800">{ikona} {nazov} <span className="text-sm font-medium text-slate-500">({pocet})</span></div>
        {akcia}
      </div>
      {pocet === 0 ? <div className="text-sm text-slate-400">Nic.</div> : children}
    </div>
  );
}

function Odkaz({ onClick, children }) {
  return <button onClick={onClick} className="text-xs font-medium text-teal-700 hover:text-teal-900 underline shrink-0">{children}</button>;
}

// Tlacidlo "Vyřešeno" s volitelnou poznamkou.
function Vyriesit({ onPotvrdit }) {
  const [otvorene, setOtvorene] = useState(false);
  const [poznamka, setPoznamka] = useState("");
  const [busy, setBusy] = useState(false);
  if (!otvorene) return <button onClick={() => setOtvorene(true)} className="text-xs font-medium px-2.5 py-1 rounded-md border border-slate-300 bg-white hover:bg-slate-50 shrink-0">Vyřešeno</button>;
  return (
    <div className="flex gap-1.5 items-center mt-1.5 w-full">
      <input autoFocus value={poznamka} onChange={(e) => setPoznamka(e.target.value)} placeholder="Jak vyřešeno (nepovinné)" className="flex-1 min-w-0 border border-slate-200 rounded-md px-2 py-1 text-sm" />
      <button disabled={busy} onClick={async () => { setBusy(true); await onPotvrdit(poznamka.trim()); setBusy(false); setOtvorene(false); setPoznamka(""); }} className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-teal-700 text-white disabled:opacity-60">Potvrdit</button>
      <button onClick={() => setOtvorene(false)} className="text-xs px-2 py-1.5 text-slate-500">Zpět</button>
    </div>
  );
}

export default function SkladPrehledView({ goodsReceipts, materialOrders, orders, userFullName, onUpdateReceipt, onUpdateMaterialOrder, onGoTo }) {
  const [extra, setExtra] = useState(null); // { drafty, vydajky, dispatches, faktur }
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [d, v, e, f] = await Promise.all([
      supabase.from("prijem_rozpracovany").select("*").order("created_at", { ascending: true }),
      supabase.from("pda_vydajky").select("id, stav, cislo_lieferschein, pracovnik, created_at, data"),
      supabase.from("expedicia_zaznamy").select("order_id, data"),
      supabase.from("prijate_faktury").select("id, data").eq("data->>stav", "KE_KONTROLE"),
    ]);
    const chyby = [d, v, e].filter((r) => r.error);
    setError(chyby.length ? "Část údajů se nepodařilo načíst – přehled nemusí být úplný." : "");
    setExtra({
      drafty: d.error ? [] : d.data || [],
      vydajky: v.error ? [] : v.data || [],
      dispatches: e.error ? [] : (e.data || []).map((r) => ({ ...r.data, orderId: r.order_id })),
      faktur: f.error ? null : (f.data || []).length,
    });
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  if (!extra) return <div className="flex items-center justify-center text-slate-500 py-10"><Loader2 className="animate-spin mr-2" size={20} /> Načítám...</div>;

  const vyriesene = (kto) => ({ kto: kto || "", kedy: new Date().toISOString() });
  const problemove = prijmyNaVyriesenie(goodsReceipts);
  const stareDrafty = extra.drafty.filter((r) => jeZPredoslehoDna(r.created_at));
  const otvoreneVydajky = extra.vydajky.filter((v) => v.stav === "rozpracovana");
  const stareVydajky = otvoreneVydajky.filter((v) => jeZPredoslehoDna(v.created_at));
  const rozdiely = rozdielyObjednavok(materialOrders, goodsReceipts);
  const dnes = todayStr();
  const dnesPrijate = goodsReceipts.filter((r) => r.datumPrijatia === dnes && !r.paletySDodavkou && !r.paletyZExpedice);
  const cakajuce = cakaNaPrijem(materialOrders, goodsReceipts);
  const expedicie = expedicieNaPotvrdenie(orders, extra.dispatches, extra.vydajky);
  const naVyriesenie = problemove.length + stareDrafty.length + stareVydajky.length + rozdiely.length + (extra.faktur || 0);

  return (
    <div data-testid="sklad-prehled">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h1 className="text-xl font-semibold">Přehled skladu</h1>
        <div className={"text-sm font-semibold px-3 py-1.5 rounded-full " + (naVyriesenie ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800")}>
          {naVyriesenie ? `K vyřešení: ${naVyriesenie}` : "Vše vyřešeno ✓"}
        </div>
      </div>
      {error && <div className="mb-4 bg-amber-50 text-amber-800 text-sm px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={16} /> {error}</div>}

      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">K vyřešení</h2>

      <Sekcia ikona={<TriangleAlert size={18} className="text-red-600" />} nazov="Příjmy s problémem" pocet={problemove.length} ton={problemove.length ? "red" : "slate"} akcia={<Odkaz onClick={() => onGoTo("goodsreceipts")}>Příjem zboží</Odkaz>}>
        <div className="space-y-2">
          {problemove.map((r) => (
            <div key={r.id} className="bg-white border border-red-200 rounded-lg px-3 py-2">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <div className="text-sm font-medium">{r.dodavatel} · {r.material} · {r.mnozstvo}</div>
                  <div className="text-xs text-slate-500">{r.datumPrijatia} {r.casPrijatia || ""} · převzal {r.prevzal || "-"}{r.kontrolyPotvrdil ? " · uloženo přes upozornění" : ""}</div>
                </div>
                <Vyriesit onPotvrdit={(poznamka) => onUpdateReceipt(r.id, { vyriesene: { ...vyriesene(userFullName), poznamka } })} />
              </div>
              <ul className="mt-1 text-xs text-red-800 list-disc pl-4">{r.dovody.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          ))}
        </div>
      </Sekcia>

      <Sekcia ikona={<Receipt size={18} className="text-amber-600" />} nazov="Objednávka nesedí s příjmem" pocet={rozdiely.length} ton={rozdiely.length ? "amber" : "slate"} akcia={<Odkaz onClick={() => onGoTo("materials")}>Objednávky surovin</Odkaz>}>
        <div className="space-y-2">
          {rozdiely.map((x) => (
            <div key={x.objednavka.id} className="bg-white border border-amber-200 rounded-lg px-3 py-2 flex items-start justify-between gap-2 flex-wrap">
              <div>
                <div className="text-sm font-medium">{x.objednavka.dodavatel} · {x.objednavka.cisloObjednavkyDopravy || "-"} · {x.objednavka.popisMaterialu || ""}</div>
                <div className="text-xs text-amber-900">Objednáno {x.objednane} {x.jednotka}, přijato {x.prijate} {x.jednotka} ({x.rozdiel > 0 ? "+" : ""}{x.rozdiel} {x.jednotka})</div>
              </div>
              <Vyriesit onPotvrdit={(poznamka) => onUpdateMaterialOrder(x.objednavka.id, { rozdielVyrieseny: { ...vyriesene(userFullName), poznamka } })} />
            </div>
          ))}
        </div>
      </Sekcia>

      {extra.faktur !== null && (
        <Sekcia ikona={<Receipt size={18} className="text-amber-600" />} nazov="Faktury ke kontrole" pocet={extra.faktur} ton={extra.faktur ? "amber" : "slate"} akcia={<Odkaz onClick={() => onGoTo("goodsreceipts")}>Otevřít faktury</Odkaz>}>
          <div className="text-sm text-slate-700">Došlé faktury čekají na napárování na příjmy. U každé položky uvidíte, kolik se přijalo a objednalo.</div>
        </Sekcia>
      )}

      <Sekcia ikona={<Clock size={18} className="text-amber-600" />} nazov="Visí z předchozích dnů" pocet={stareDrafty.length + stareVydajky.length} ton={stareDrafty.length + stareVydajky.length ? "amber" : "slate"}>
        <div className="space-y-1.5">
          {stareDrafty.map((r) => (
            <div key={r.id} className="bg-white border border-amber-200 rounded-lg px-3 py-2 text-sm">
              <div className="font-medium">Rozpracovaný příjem: {popisRozpracovaneho(r.data)}</div>
              <div className="text-xs text-slate-500">{r.data.ulozil || "-"} · {r.data.cas || formatDateTime(r.created_at)} – dokončit nebo smazat ve skladu (Příjem)</div>
            </div>
          ))}
          {stareVydajky.map((v) => (
            <div key={v.id} className="bg-white border border-amber-200 rounded-lg px-3 py-2 text-sm flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">Nedokončená výdejka LS {v.cislo_lieferschein}</div>
                <div className="text-xs text-slate-500">{v.pracovnik || "-"} · {formatDateTime(v.created_at)}</div>
              </div>
              <Odkaz onClick={() => onGoTo("pda")}>PDA / Expedice</Odkaz>
            </div>
          ))}
        </div>
      </Sekcia>

      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2 mt-6">Dnes</h2>

      <Sekcia ikona={<Truck size={18} className="text-teal-700" />} nazov="Expedice čeká na potvrzení" pocet={expedicie.length} akcia={<Odkaz onClick={() => onGoTo("register")}>Objednávky</Odkaz>}>
        <div className="divide-y divide-slate-100">
          {expedicie.map((x) => (
            <div key={x.order.id} className="py-1.5 text-sm">
              <span className="font-medium">{x.order.adresaDodaniaNazov || x.order.zakaznik}</span>
              <span className="text-slate-500"> · {x.order.cisloObjednavkyDopravy || "-"}{x.order.cisloDodaciehoListu ? " · LS " + x.order.cisloDodaciehoListu : ""}</span>
              <span className="text-xs text-slate-500"> · {[x.nalozenePalet ? `naloženo ${x.nalozenePalet} pal.` : "", x.vydajek ? "sken dokončen" : ""].filter(Boolean).join(", ")}</span>
            </div>
          ))}
        </div>
      </Sekcia>

      <Sekcia ikona={<ScanBarcode size={18} className="text-teal-700" />} nazov="Výdejky na PDA rozpracované" pocet={otvoreneVydajky.length} akcia={<Odkaz onClick={() => onGoTo("pda")}>PDA / Expedice</Odkaz>}>
        <div className="divide-y divide-slate-100">
          {otvoreneVydajky.map((v) => (
            <div key={v.id} className="py-1.5 text-sm">
              <span className="font-medium">LS {v.cislo_lieferschein}</span>
              <span className="text-slate-500"> · {(v.data && v.data.objednavka && v.data.objednavka.zakaznik) || "bez objednávky"} · {v.pracovnik || "-"}</span>
            </div>
          ))}
        </div>
      </Sekcia>

      <Sekcia ikona={<PackagePlus size={18} className="text-teal-700" />} nazov="Rozpracované příjmy" pocet={extra.drafty.length}>
        <div className="divide-y divide-slate-100">
          {extra.drafty.map((r) => (
            <div key={r.id} className="py-1.5 text-sm">{popisRozpracovaneho(r.data)} <span className="text-xs text-slate-500">· {r.data.ulozil || "-"} {r.data.cas || ""}</span></div>
          ))}
        </div>
      </Sekcia>

      <Sekcia ikona={<CheckCircle2 size={18} className="text-emerald-600" />} nazov={`Dnes přijato (${dnes})`} pocet={dnesPrijate.length} akcia={<Odkaz onClick={() => onGoTo("goodsreceipts")}>Příjem zboží</Odkaz>}>
        <div className="divide-y divide-slate-100">
          {dnesPrijate.map((r) => (
            <div key={r.id} className="py-1.5 text-sm">
              <span className="font-medium">{r.material}</span> <span className="text-slate-500">· {r.mnozstvo} · {r.dodavatel} · {r.casPrijatia || ""} · {r.prevzal || "-"}</span>
            </div>
          ))}
        </div>
      </Sekcia>

      <Sekcia ikona={<Clock size={18} className="text-teal-700" />} nazov="Čeká na příjem (objednáno, zatím nepřijato)" pocet={cakajuce.length} akcia={<Odkaz onClick={() => onGoTo("materials")}>Objednávky surovin</Odkaz>}>
        <div className="divide-y divide-slate-100">
          {cakajuce.map((o) => (
            <div key={o.id} className="py-1.5 text-sm">
              <span className="font-medium">{o.dodavatel || "-"}</span>
              <span className="text-slate-500"> · {o.popisMaterialu || ((o.polozky || []).map((p) => p.popis).filter(Boolean).join(", ")) || "-"}{o.mnozstvo ? " · " + o.mnozstvo : ""}{o.datumVyzdvihnutia ? " · " + o.datumVyzdvihnutia : o.terminDodania ? " · " + o.terminDodania : ""}</span>
            </div>
          ))}
        </div>
      </Sekcia>
    </div>
  );
}
