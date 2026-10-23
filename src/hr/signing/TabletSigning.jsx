import React, { useState, useEffect, useRef } from "react";
import { Loader2, AlertCircle, CheckCircle2, FileSignature, X } from "lucide-react";
import { supabase } from "../../supabaseClient.js";
import PdfPagesViewer from "./PdfPagesViewer.jsx";
import SignaturePad from "./SignaturePad.jsx";

/* =========================================================================
   Podpisovy rezim na tablete (faza F). Dve pouzitia:
   - mode "employee": podpisujuci zamestnanec, identita = jednorazovy token
     (vydal ho HR po overeni totoznosti); funguje aj bez prihlasenia
     (samostatna stranka ?podpis=<token>);
   - mode "employer": prihlasena osoba s plnou mocou podpisuje za
     zamestnavatela.
   Server (Edge Function hr-signing) overi otisk zobrazeneho PDF, zobrazenie
   vsetkych stran a text prejavu vule; tu sa len zobrazuje.
   ========================================================================= */

const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function invokeSigning(body) {
  const { data, error } = await supabase.functions.invoke("hr-signing", { body });
  if (data) return data;
  const detail = error?.context ? await error.context.json().catch(() => null) : null;
  throw new Error(detail?.error || "Spojení se serverem se nezdařilo. Zkuste to znovu.");
}

export default function TabletSigning({ mode = "employee", token, documentId, onDone, onCancel }) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState("");
  const [view, setView] = useState({ allViewed: false, pagesViewed: [] });
  const [confirmed, setConfirmed] = useState(false);
  const [padEmpty, setPadEmpty] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const pad = useRef(null);
  const employer = mode === "employer";

  async function load() {
    setError(""); setDoc(null);
    try {
      const r = await invokeSigning(employer ? { action: "employer_load", document_id: documentId } : { action: "load", token });
      setDoc({ ...r, bytes: fromB64(r.pdf_base64) });
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function sign() {
    setBusy(true); setError("");
    try {
      const common = {
        displayed_sha256: doc.sha256, intent_text_version_id: doc.intent.id,
        signature_png_base64: pad.current.toPngBase64(), strokes: pad.current.getStrokes(),
        evidence: { pages_viewed: view.pagesViewed, viewed_at: new Date().toISOString(), viewport: { w: window.innerWidth, h: window.innerHeight } },
      };
      const r = await invokeSigning(employer
        ? { action: "employer_sign", document_id: documentId, confirmed: true, ...common }
        : { action: "sign", token, name_confirmed: true, ...common });
      setResult(r);
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  const shell = (children) => (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm text-slate-500">Stenger Czech s.r.o. · {employer ? "podpis za zaměstnavatele" : "podpis dokumentu"}</div>
          {onCancel && !result && (
            <button onClick={onCancel} className="text-slate-500 hover:text-slate-800 flex items-center gap-1 text-sm"><X size={16} /> Zavřít</button>
          )}
        </div>
        {children}
      </div>
    </div>
  );

  if (result) {
    return shell(
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
        <CheckCircle2 className="mx-auto mb-3 text-emerald-600" size={40} />
        <div className="text-lg font-semibold text-slate-800 mb-1">Podepsáno</div>
        <div className="text-slate-600 mb-6">
          {result.complete ? "Dokument je podepsán všemi stranami." : "Váš podpis je uložen. Dokument ještě podepíše druhá strana."}
          {!employer && " Vraťte prosím zařízení personálnímu oddělení."}
        </div>
        {onDone && <button onClick={() => onDone(result)} className="bg-teal-700 hover:bg-teal-800 text-white px-6 py-2.5 rounded-lg">Hotovo</button>}
      </div>,
    );
  }
  if (error && !doc) {
    return shell(
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
        <AlertCircle className="mx-auto mb-3 text-red-400" size={32} />
        <div className="text-slate-700 mb-4">{error}</div>
        <button onClick={load} className="bg-teal-700 text-white px-5 py-2.5 rounded-lg">Zkusit znovu</button>
      </div>,
    );
  }
  if (!doc) return shell(<div className="text-center text-slate-400 py-16"><Loader2 className="animate-spin mx-auto mb-3" size={28} /> Načítám dokument…</div>);

  return shell(
    <div>
      <h1 className="text-xl font-semibold text-slate-800">{doc.document.title}</h1>
      <div className="text-sm text-slate-500 mb-4">verze v{doc.document.version_no || 1} · otisk {doc.sha256.slice(0, 16)}…</div>
      <label className="flex items-start gap-3 bg-white border border-slate-200 rounded-lg px-4 py-3 mb-4 text-slate-800">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1 w-5 h-5" />
        <span>
          {employer
            ? <>Podepisuji jako <b>{doc.signer_name}</b> za zaměstnavatele na základě plné moci.</>
            : <>Jsem <b>{doc.signer_name}</b> a tento dokument podepisuji osobně.</>}
        </span>
      </label>
      <PdfPagesViewer bytes={doc.bytes} onViewedChange={setView} />
      <div className={"mt-6 " + (view.allViewed && confirmed ? "" : "opacity-40 pointer-events-none")} aria-disabled={!view.allViewed || !confirmed}>
        <div className="bg-teal-50 border border-teal-200 rounded-lg px-4 py-3 text-slate-800 mb-3">
          {doc.intent.body}
          {doc.intent.detail && <div className="mt-1">{doc.intent.detail}</div>}
          <div className="text-xs text-slate-400 mt-1">Verze textu {doc.intent.version_no}</div>
        </div>
        <SignaturePad ref={pad} onChange={({ empty }) => setPadEmpty(empty)} />
        {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md mt-3">{error}</div>}
        <div className="flex justify-end mt-4">
          <button onClick={sign} disabled={!view.allViewed || !confirmed || padEmpty || busy}
            className="flex items-center gap-2 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-base font-medium px-7 py-3 rounded-lg">
            {busy ? <Loader2 size={20} className="animate-spin" /> : <FileSignature size={20} />} Podepsat
          </button>
        </div>
      </div>
      {!view.allViewed && <div className="text-sm text-slate-500 mt-2">Podpis bude možný po zobrazení všech stran dokumentu{confirmed ? "" : " a potvrzení jména"}.</div>}
      {view.allViewed && !confirmed && <div className="text-sm text-slate-500 mt-2">Potvrďte prosím jméno nahoře.</div>}
    </div>,
  );
}

// Samostatna stranka ?podpis=<token> (tablet bez prihlasenia).
export function TabletSigningPage() {
  const token = new URLSearchParams(window.location.search).get("podpis") || "";
  const [done, setDone] = useState(false);
  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-600 px-4 text-center">
        Děkujeme. Podpisový odkaz je použit – zařízení můžete vrátit personálnímu oddělení.
      </div>
    );
  }
  return <TabletSigning mode="employee" token={token} onDone={() => setDone(true)} />;
}
