import React, { useEffect, useRef, useState } from "react";
import { ScanLine, Trash2, AlertCircle, TriangleAlert, FileText, Camera, Loader2 } from "lucide-react";

// Skenovanie paletovych etiket na prijme (PDA skener posiela kod ako text + Enter)
// a zoznam palet. Ked etiketa GS1 nema, sarza a DMT sa zadaju rucne vo formulari.
export function PaletySken({ palety, rozpracovana, onScan, onRemove, scanError, neznameGtiny, novaKarta, onNovaKarta, material, jednotka }) {
  const [text, setText] = useState("");
  const inputRef = useRef(null);

  function odoslat() {
    const t = text;
    setText("");
    if (t.trim()) onScan(t);
    if (inputRef.current) inputRef.current.focus();
  }

  // Rucny skener (Zebra DataWedge, bluetooth) pise ako klavesnica: ked fokus
  // prave nie je v ziadnom textovom poli, znaky sa presmeruju do pola skenu,
  // aby sa nestratili a Enter nestlacil nahodne tlacidlo.
  useEffect(() => {
    function onDocKeyDown(e) {
      const t = e.target;
      const tag = t && t.tagName;
      if (t === inputRef.current || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
      if (e.key && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        setText((prev) => prev + e.key);
        if (inputRef.current) inputRef.current.focus();
      }
    }
    document.addEventListener("keydown", onDocKeyDown, true);
    return () => document.removeEventListener("keydown", onDocKeyDown, true);
  }, []);

  return (
    <div className="border-2 border-slate-200 rounded-xl p-3 mb-3" data-testid="palety-sken">
      <div className="text-sm font-medium text-slate-500 mb-1.5 flex items-center gap-1.5"><ScanLine size={16} /> Naskenujte etiketu palety (všechny kódy na etiketě)</div>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              odoslat();
            } else if (e.keyCode === 29 || (e.ctrlKey && (e.key === "]" || e.keyCode === 221))) {
              // FNC1/GS poslany ako klavesa - Chrome ho do pola sam nevlozi
              e.preventDefault();
              setText((prev) => prev + "");
            }
          }}
          placeholder="Sken nebo ručně opsaný kód"
          autoComplete="off"
          className="flex-1 min-w-0 border-2 border-slate-200 rounded-xl px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-teal-600"
        />
        <button onClick={odoslat} className="px-4 rounded-xl border-2 border-slate-200 text-base font-medium text-slate-700">Přidat</button>
      </div>
      {scanError && (
        <div className="mt-2 bg-amber-50 text-amber-800 text-sm px-3 py-2 rounded-lg flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 shrink-0" /> <span>{scanError}</span>
        </div>
      )}
      {rozpracovana && <div className="mt-2 text-sm text-slate-500">Načteno část etikety – naskenujte i ostatní kódy (hlavně SSCC palety).</div>}

      {palety.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {palety.map((p, i) => (
            <div key={(p.sscc || "bez") + i} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="font-medium">
                  Paleta {i + 1}
                  {p.mnozstvo !== null && p.mnozstvo !== undefined ? ` – ${String(p.mnozstvo).replace(".", ",")} ${jednotka}` : " – množství neznámé"}
                </div>
                <div className="text-xs text-slate-500 break-all">
                  {[p.sarza && `šarže ${p.sarza}`, p.dmt && `DMT ${p.dmt}${p.dmtVypocitane ? " (dopočteno)" : ""}`, p.sscc && `SSCC ${p.sscc}`].filter(Boolean).join(" · ") || "bez údajů"}
                </div>
              </div>
              <button onClick={() => onRemove(i)} title="Odebrat paletu" className="text-slate-400 hover:text-red-600 p-1"><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      )}

      {neznameGtiny.length > 0 && (
        <div className="mt-3 border-2 border-indigo-200 bg-indigo-50 rounded-xl p-3 text-sm">
          <div className="font-semibold text-indigo-900 mb-1">Nový kód produktu na etiketě</div>
          <div className="text-indigo-900 mb-2">
            Zapamatuje se jako <b>{material || "(vyberte materiál níže)"}</b> v jednotce <b>{jednotka}</b>. Příště se materiál doplní sám.
          </div>
          <label className="block mb-2">
            <span className="text-slate-600">Kolik {jednotka} je v 1 balení na etiketě{neznameGtiny[0].pocet ? ` (etiketa uvádí ${neznameGtiny[0].pocet} balení na paletě)` : ""}</span>
            <input value={novaKarta.mnozstvoNaKs} onChange={(e) => onNovaKarta({ ...novaKarta, mnozstvoNaKs: e.target.value })} inputMode="decimal" placeholder="např. 10" className="mt-1 w-full border-2 border-slate-200 rounded-lg px-3 py-2 text-base bg-white" />
          </label>
          <label className="block">
            <span className="text-slate-600">Trvanlivost v měsících (jen když etiketa nemá DMT, nepovinné)</span>
            <input value={novaKarta.trvanlivostMesiace} onChange={(e) => onNovaKarta({ ...novaKarta, trvanlivostMesiace: e.target.value })} inputMode="numeric" placeholder="např. 12" className="mt-1 w-full border-2 border-slate-200 rounded-lg px-3 py-2 text-base bg-white" />
          </label>
        </div>
      )}
    </div>
  );
}

export function KontrolyPrijmu({ kontroly }) {
  if (!kontroly.length) return null;
  return (
    <div className="mt-3 space-y-1.5" data-testid="kontroly-prijmu">
      {kontroly.map((k, i) => (
        <div key={i} className={"text-sm px-3 py-2 rounded-lg flex items-start gap-2 " + (k.uroven === "chyba" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-800")}>
          {k.uroven === "chyba" ? <AlertCircle size={16} className="mt-0.5 shrink-0" /> : <TriangleAlert size={16} className="mt-0.5 shrink-0" />}
          <span>{k.text}</span>
        </div>
      ))}
    </div>
  );
}

// Nacitanie dodacieho listu fotkou: AI vytiahne polozky, skladnik vyberie tu pravu.
export function DodakNacitanie({ dodak, loading, error, vybranaIdx, onFile, onVyber, onZrusit }) {
  const inputRef = useRef(null);
  return (
    <div className="border-2 border-slate-200 rounded-xl p-3 mb-3" data-testid="dodak">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-slate-500 flex items-center gap-1.5"><FileText size={16} /> Dodací list</div>
        <div className="flex gap-2">
          {dodak && !loading && <button onClick={onZrusit} className="text-sm text-slate-500 px-2">Zrušit</button>}
          <button onClick={() => inputRef.current && inputRef.current.click()} disabled={loading} className="text-sm font-medium px-3 py-2 rounded-lg border-2 border-slate-200 text-slate-700 flex items-center gap-1.5 disabled:opacity-50">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />} {loading ? "Čtu doklad…" : dodak ? "Vyfotit znovu" : "Vyfotit / nahrát"}
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files && e.target.files[0];
            e.target.value = "";
            if (file) onFile(file);
          }}
        />
      </div>
      {!dodak && !loading && !error && <div className="text-xs text-slate-400 mt-1">Když etiketa palety nemá šarži nebo DMT, vyfoťte dodací list – údaje se doplní a porovnají s etiketou.</div>}
      {error && (
        <div className="mt-2 bg-amber-50 text-amber-800 text-sm px-3 py-2 rounded-lg flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 shrink-0" /> <span>{error}</span>
        </div>
      )}
      {dodak && (
        <div className="mt-2">
          <div className="text-xs text-slate-500 mb-1.5">
            {[dodak.dodavatelNas || dodak.dodavatel, dodak.cisloDokladu && "DL " + dodak.cisloDokladu, dodak.datum, dodak.cisloObjednavky && "obj. " + dodak.cisloObjednavky].filter(Boolean).join(" · ")}
          </div>
          {dodak.polozky.length === 0 && <div className="text-sm text-amber-800">Na dokladu se nepodařilo najít položky – zadejte údaje ručně.</div>}
          {dodak.polozky.length > 1 && <div className="text-sm text-slate-600">Položky z dodacího listu ({dodak.polozky.length}) zkontrolujte níže – uloží se najednou.</div>}
          {vybranaIdx !== null && dodak.polozky[vybranaIdx] && !dodak.polozky[vybranaIdx].materialNas && (
            <div className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2 mb-1.5">Položku se nepodařilo přiřadit k našemu materiálu – vyberte materiál níže ručně.</div>
          )}
          <div className="space-y-1.5">
            {dodak.polozky.length === 1 && dodak.polozky.map((p, i) => (
              <button key={i} onClick={() => onVyber(i)} className={"w-full text-left rounded-lg px-3 py-2 border-2 text-sm " + (vybranaIdx === i ? "border-teal-700 bg-teal-50" : "border-slate-200 bg-slate-50")}>
                <div className="font-medium">
                  {p.materialNas || p.nazov}
                  {p.mnozstvo !== null ? ` – ${String(p.mnozstvo).replace(".", ",")} ${p.jednotka}` : ""}
                </div>
                <div className="text-xs text-slate-500">
                  {[p.materialNas && p.nazov !== p.materialNas && p.nazov, p.cisloObjednavky && "obj. " + p.cisloObjednavky, p.pocetPaliet && p.pocetPaliet + " pal."].filter(Boolean).join(" · ")}
                </div>
                <div className="text-xs text-slate-500">
                  {(p.sarze || []).length > 0
                    ? p.sarze.map((x) => [x.sarza && "šarže " + x.sarza, x.dmt && "DMT " + x.dmt].filter(Boolean).join(" ")).join(" · ")
                    : [p.sarza && "šarže " + p.sarza, p.dmt && "DMT " + p.dmt].filter(Boolean).join(" · ") || "bez šarže a DMT"}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const STAVY = [
  { value: "V poriadku", label: "V pořádku", active: "bg-emerald-600 text-white border-emerald-600" },
  { value: "Poskodene", label: "Poškozené", active: "bg-red-600 text-white border-red-600" },
  { value: "Nekompletne", label: "Nekompletní", active: "bg-amber-500 text-white border-amber-500" },
];

// Vsetky polozky dodacieho listu naraz - kazda sa ulozi ako samostatny prijem.
export function DodakPolozky({ riadky, onZmena, kontrolyPodlaRiadku, paletyPodlaRiadku, materialy, jednotky }) {
  const inp = "w-full border-2 border-slate-200 rounded-lg px-2.5 py-2 text-base focus:outline-none focus:ring-2 focus:ring-teal-600";
  return (
    <div className="space-y-3 mt-3" data-testid="dodak-polozky">
      <datalist id="dodak-polozky-materialy">
        {materialy.map((m) => <option key={m} value={m} />)}
      </datalist>
      {riadky.map((r) => {
        const p = r.polozka || {};
        const kontroly = kontrolyPodlaRiadku.get(r.key) || [];
        const pocetPaliet = paletyPodlaRiadku.get(r.key) || 0;
        return (
          <div key={r.key} className={"border-2 rounded-xl p-3 " + (r.zahrnut ? "border-slate-200" : "border-slate-100 opacity-60")}>
            <label className="flex items-start gap-2.5">
              <input type="checkbox" checked={r.zahrnut} onChange={(e) => onZmena(r.key, { zahrnut: e.target.checked })} className="mt-1 w-5 h-5 accent-teal-700" />
              <div className="min-w-0">
                <div className="font-medium break-words">{p.nazov || "Položka"}</div>
                <div className="text-xs text-slate-500">
                  {[p.cisloObjednavky && "obj. " + p.cisloObjednavky, p.pocetPaliet && p.pocetPaliet + " pal. na dodacím listu", pocetPaliet > 0 && pocetPaliet + " pal. naskenováno"].filter(Boolean).join(" · ") || (r.zahrnut ? "Přijmout" : "Nepřijímat")}
                </div>
              </div>
            </label>
            {r.zahrnut && (
              <div className="mt-2 space-y-2">
                <input
                  list="dodak-polozky-materialy"
                  value={r.material}
                  onChange={(e) => onZmena(r.key, { material: e.target.value })}
                  placeholder="Vyberte náš materiál"
                  className={inp + (r.material.trim() ? "" : " border-amber-300 bg-amber-50")}
                />
                <div className="flex gap-2">
                  <input value={r.mnozstvoNum} onChange={(e) => onZmena(r.key, { mnozstvoNum: e.target.value })} inputMode="decimal" placeholder="Množství" className={inp + " w-32"} />
                  <select value={r.mnozstvoUnit} onChange={(e) => onZmena(r.key, { mnozstvoUnit: e.target.value })} className={inp + " w-28"}>
                    {jednotky.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input value={r.sarza} onChange={(e) => onZmena(r.key, { sarza: e.target.value })} placeholder="Šarže" className={inp} />
                  <input value={r.dmt} onChange={(e) => onZmena(r.key, { dmt: e.target.value })} placeholder="DMT DD.MM.RRRR" className={inp} />
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {STAVY.map((st) => (
                    <button key={st.value} onClick={() => onZmena(r.key, { stavPrevzatia: st.value })} className={"text-sm font-medium px-2 py-2 rounded-lg border-2 " + (r.stavPrevzatia === st.value ? st.active : "bg-white text-slate-700 border-slate-200")}>
                      {st.label}
                    </button>
                  ))}
                </div>
                <KontrolyPrijmu kontroly={kontroly} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
