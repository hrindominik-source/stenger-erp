// Pokyny k lekarskej prehliadke: PDF na stiahnutie/tlac (vstupna alebo
// periodicka) + kontakt na lekara, ktory personalistka upravuje sama.
import React, { useEffect, useState } from "react";
import { Loader2, Download, Printer, Pencil } from "lucide-react";
import { supabase } from "../supabaseClient.js";
import { NASTAVENI_LEKAR, KONTAKT_POLE, POKYNY_TYPY, kontaktChyby } from "../lib/hr/pokynyProhlidka.js";
import { JMHZ_FONT_URL, FONT_BOLD_URL, STENGER_LOGO_URL } from "../lib/hr/jmhzFill.js";

const inputCls = "w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-sm";

export default function PokynyProhlidka({ zamestnanec, canEdit, fileName, saveFile }) {
  const [kontakt, setKontakt] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    supabase.from("hr_nastaveni").select("value").eq("key", NASTAVENI_LEKAR).maybeSingle().then(({ data, error: err }) => {
      if (cancelled) return;
      if (err) { console.error(err); setLoadError("Kontakt na lékaře se nepodařilo načíst (chybí tabulka hr_nastaveni?)."); setKontakt({}); return; }
      setKontakt(data?.value || {});
    });
    return () => { cancelled = true; };
  }, []);

  async function run(key, fn) {
    setBusy(key); setError("");
    try { await fn(); } catch (e) { console.error(e); setError(e.message || String(e)); }
    setBusy("");
  }

  async function pdf(typ) {
    const { buildPokynyPdf } = await import("../lib/hr/pokynyProhlidkaPdf.js");
    const [fontBytes, boldBytes, logoBytes] = await Promise.all([JMHZ_FONT_URL, FONT_BOLD_URL, STENGER_LOGO_URL].map(async (u) => {
      const r = await fetch(u);
      if (!r.ok) throw new Error(`Nepodařilo se načíst ${u}`);
      return r.arrayBuffer();
    }));
    return buildPokynyPdf({ fontBytes, boldBytes, logoBytes }, { typ, kontakt, zamestnanec });
  }

  const stahnout = (typ) => run(`dl-${typ}`, async () => saveFile(await pdf(typ), `${fileName(POKYNY_TYPY[typ].nazev)}.pdf`));

  // Okno sa otvara hned po kliknuti (inak ho prehliadac zablokuje), PDF sa doplni.
  const tisk = (typ) => {
    const win = window.open("", "_blank");
    run(`tisk-${typ}`, async () => {
      const bytes = await pdf(typ);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      if (win) win.location.href = url; else window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }).then(() => { if (win && win.location.href === "about:blank") win.close(); });
  };

  const ulozit = () => run("ulozit", async () => {
    const value = Object.fromEntries(KONTAKT_POLE.map((p) => [p.key, String(form[p.key] || "").trim()]));
    const chyby = kontaktChyby(value);
    if (chyby.length) throw new Error("Doplňte: " + chyby.join(", "));
    const { error: err } = await supabase.from("hr_nastaveni").upsert({ key: NASTAVENI_LEKAR, value, updated_at: new Date().toISOString() });
    if (err) throw err;
    setKontakt(value);
    setEditing(false);
  });

  if (!kontakt) return <div className="text-sm text-slate-400 flex items-center gap-2 mb-4"><Loader2 size={14} className="animate-spin" /> Načítám pokyny…</div>;
  const chybi = kontaktChyby(kontakt);

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4" data-testid="pokyny-prohlidka">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-sm">Pokyny k prohlídce pro zaměstnance</div>
          <div className="text-xs text-slate-500 mt-0.5">
            {chybi.length ? "Nejdřív vyplňte kontakt na lékaře." : `Lékař: ${kontakt.volat}, tel. ${kontakt.telefon}, ${kontakt.ordinace}`}
          </div>
        </div>
        {canEdit && !editing && (
          <button onClick={() => { setForm(kontakt); setEditing(true); }} className="text-xs text-teal-700 hover:text-teal-900 flex items-center gap-1">
            <Pencil size={13} /> Kontakt na lékaře
          </button>
        )}
      </div>

      {editing && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {KONTAKT_POLE.map((p) => (
              <label key={p.key} className="block text-xs text-slate-600">
                {p.label}
                <input aria-label={p.label} className={`${inputCls} mt-1`} placeholder={p.placeholder} value={form[p.key] || ""}
                  onChange={(e) => setForm({ ...form, [p.key]: e.target.value })} />
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button onClick={() => setEditing(false)} className="text-sm text-slate-500 px-3 py-1.5">Zrušit</button>
            <button onClick={ulozit} disabled={!!busy} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-md">
              {busy === "ulozit" ? "Ukládám..." : "Uložit kontakt"}
            </button>
          </div>
        </div>
      )}

      {!editing && !chybi.length && (
        <div className="flex flex-wrap gap-x-6 gap-y-2 mt-3">
          {Object.entries(POKYNY_TYPY).map(([typ, T]) => (
            <div key={typ} className="flex items-center gap-3 text-sm">
              <span className="text-slate-700">{typ === "vstupni" ? "Vstupní" : "Periodická"}:</span>
              <button onClick={() => stahnout(typ)} disabled={!!busy} aria-label={`Stáhnout – ${T.nazev}`}
                className="text-xs text-teal-700 hover:text-teal-900 disabled:opacity-50 flex items-center gap-1">
                {busy === `dl-${typ}` ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Stáhnout
              </button>
              <button onClick={() => tisk(typ)} disabled={!!busy} aria-label={`Tisk – ${T.nazev}`}
                className="text-xs text-teal-700 hover:text-teal-900 disabled:opacity-50 flex items-center gap-1">
                {busy === `tisk-${typ}` ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />} Tisk
              </button>
            </div>
          ))}
        </div>
      )}
      {(error || loadError) && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md mt-3">{error || loadError}</div>}
    </div>
  );
}
