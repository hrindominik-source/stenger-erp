import React, { useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, FileSignature, Printer, AlertCircle, Mail } from "lucide-react";
import { supabase } from "../supabaseClient.js";
import { draftEmail, validateKioskEmail, KIOSK_DOCS } from "../lib/hr/kioskDocuments.js";
import PdfPagesViewer from "./signing/PdfPagesViewer.jsx";
import SignaturePad, { signBlockedReason } from "./signing/SignaturePad.jsx";

/* Kroky kiosku pre fazu D. Rovnako ako OnboardingKiosk: ZIADNE
   supabase.from(...) - len RPC s tokenom a Edge Function hr-kiosk, ktora
   overi token a vrati len dokumenty vlastnej relacie. */

const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function invokeKiosk(body) {
  const { data, error } = await supabase.functions.invoke("hr-kiosk", { body });
  if (data) return data;
  const detail = error?.context ? await error.context.json().catch(() => null) : null;
  const e = new Error(detail?.error || "Spojení se serverem se nezdařilo. Zkuste to znovu.");
  e.status = error?.context?.status || 0;
  throw e;
}

// Krok "Bydliště a kontakt" - doplnok pod polia: e-mail pre kontrolu a
// volba "Nemám / nechci uvést". Jedine pole e-mailu ostava private_email.
export function KioskEmailChoice({ draft, onChange, confirm, onConfirm, showErrors }) {
  const errors = showErrors ? validateKioskEmail(draft, confirm) : [];
  return (
    <div className="mt-4 bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
      {!draft.no_private_email && (
        <label className="block">
          <span className="block text-sm font-medium text-slate-600 mb-1">E-mailová adresa znovu (pro kontrolu)</span>
          <input type="email" autoComplete="off" value={confirm} onChange={(e) => onConfirm(e.target.value)} onPaste={(e) => e.preventDefault()}
            className="w-full border border-slate-300 rounded-md px-3 py-2.5 text-base" />
        </label>
      )}
      <label className="flex items-start gap-2 text-base text-slate-700">
        <input type="checkbox" className="mt-1.5 w-5 h-5" checked={!!draft.no_private_email}
          onChange={(e) => onChange("no_private_email", e.target.checked)} />
        <span>Nemám / nechci uvést soukromý e-mail
          <span className="block text-sm text-slate-500">Dokumenty vám pak budeme předávat jen osobně nebo poštou.</span></span>
      </label>
      {errors.map((e) => <div key={e} className="text-sm text-red-700">{e}</div>)}
    </div>
  );
}

function Choice({ name, value, onChange, options }) {
  return (
    <div className="space-y-2 mt-3" role="radiogroup">
      {options.map(([v, label]) => (
        <label key={v} className={"flex items-start gap-3 border rounded-lg px-4 py-3 text-base cursor-pointer " + (value === v ? "border-teal-600 bg-teal-50" : "border-slate-200")}>
          <input type="radio" name={name} className="mt-1 w-5 h-5" checked={value === v} onChange={() => onChange(v)} />
          <span>{label}</span>
        </label>
      ))}
    </div>
  );
}

function LegalText({ text, className = "" }) {
  return (
    <div className={"bg-white border border-slate-200 rounded-lg p-4 text-sm text-slate-700 whitespace-pre-line " + className}>
      <div className="font-semibold text-slate-800 mb-2">{text.title}</div>
      {text.body}
      <div className="text-xs text-slate-400 mt-2">Verze {text.version_no}{text.status === "KONCEPT" ? " – koncept" : ""}</div>
    </div>
  );
}

// Krok "Elektronická komunikace": blok A (§ 21) a blok B (§ 335) su vzdy
// oddelene; volby nie su predvyplnene.
export function KioskCommunicationStep({ draft, config, onChange, errors }) {
  const email = draftEmail(draft);
  const texts = config?.texts || {};
  const [noticeRead, setNoticeRead] = useState(!!draft.kiosk_s335_notice_id);
  const noticeBox = useRef(null);
  if (!email) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-slate-600 flex gap-2">
        <Mail size={18} className="shrink-0 mt-0.5" />
        <span>Neuvedli jste soukromý e-mail. Smlouvy i další písemnosti vám budeme předávat osobně nebo zasílat poštou. Pokračujte prosím dál.</span>
      </div>
    );
  }
  const s335Available = !!(config?.s335_consent_enabled && texts.S335_NOTICE && texts.S335_CONSENT);
  // bez schvalenych textov sa § 21 ani § 335 neponuka (migracia 66)
  if (!texts.S21_ADDRESS_NOTICE && !s335Available) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-slate-600 flex gap-2" data-testid="kiosk-no-ecomm">
        <Mail size={18} className="shrink-0 mt-0.5" />
        <span>E-mail <strong className="text-slate-700">{email}</strong> máme pro běžnou komunikaci. Smlouvy i další písemnosti vám budeme předávat osobně. Pokračujte prosím dál.</span>
      </div>
    );
  }
  return (
    <div className="space-y-8">
      {texts.S21_ADDRESS_NOTICE && (
        <section>
          <h2 className="text-base font-semibold text-slate-800 mb-1">A. Oznámení elektronické adresy (§ 21 zákoníku práce)</h2>
          <p className="text-sm text-slate-500 mb-3">E-mail: <strong className="text-slate-700">{email}</strong></p>
          <LegalText text={texts.S21_ADDRESS_NOTICE} />
          <Choice name="kiosk_s21" value={draft.kiosk_s21} onChange={(v) => onChange("kiosk_s21", v)} options={[
            ["ANO", "Ano, oznamuji tuto adresu pro účely § 21 zákoníku práce (samostatné oznámení podepíšu)."],
            ["NE", "Ne, tuto adresu pro účely § 21 neoznamuji."],
          ]} />
        </section>
      )}

      {s335Available && (
        <section>
          <h2 className="text-base font-semibold text-slate-800 mb-1">B. Doručování písemností elektronicky (§ 335 zákoníku práce)</h2>
          <p className="text-sm text-slate-500 mb-3">Dobrovolné. Bez souhlasu vám písemnosti doručujeme osobně nebo poštou. Nejdříve si prosím přečtěte celé poučení.</p>
          <div ref={noticeBox} className="max-h-72 overflow-y-auto"
            onScroll={(e) => { const t = e.currentTarget; if (t.scrollTop + t.clientHeight >= t.scrollHeight - 8) setNoticeRead(true); }}>
            <LegalText text={texts.S335_NOTICE} />
          </div>
          <label className="flex items-start gap-2 text-base text-slate-700 mt-3">
            <input type="checkbox" className="mt-1.5 w-5 h-5" disabled={!noticeRead}
              checked={draft.kiosk_s335_notice_id === texts.S335_NOTICE.id}
              onChange={(e) => { onChange("kiosk_s335_notice_id", e.target.checked ? texts.S335_NOTICE.id : ""); if (!e.target.checked) onChange("kiosk_s335", ""); }} />
            <span>Přečetl(a) jsem celé poučení.{!noticeRead && <span className="block text-sm text-slate-400">Posuňte poučení až na konec.</span>}</span>
          </label>
          {draft.kiosk_s335_notice_id === texts.S335_NOTICE.id && (
            <>
              <LegalText text={texts.S335_CONSENT} className="mt-4" />
              <Choice name="kiosk_s335" value={draft.kiosk_s335} onChange={(v) => onChange("kiosk_s335", v)} options={[
                ["ANO", "Souhlasím s doručováním písemností elektronicky (samostatný souhlas podepíšu)."],
                ["NE", "Nesouhlasím – písemnosti mi doručujte osobně nebo poštou."],
              ]} />
            </>
          )}
        </section>
      )}
      {errors?.length > 0 && <div className="space-y-1">{errors.map((e) => <div key={e} className="text-sm text-red-700">{e}</div>)}</div>}
    </div>
  );
}

// Krok "Podpis": server pripravi PDF; kazdy dokument sa zobrazi cely a
// podpise zvlast. Alternativa: podpis na papieri (pred prvym podpisom).
export function KioskSigningStep({ session, onSubmit, onSignedChange, submitting, submitError }) {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState(null); // null | ELECTRONIC | PAPER
  const [view, setView] = useState({ allViewed: false, pagesViewed: [] });
  const [padPoints, setPadPoints] = useState(0);
  const [busy, setBusy] = useState(false);
  const pad = useRef(null);

  async function load() {
    setError(""); setDocs(null);
    try {
      const r = await invokeKiosk({ action: "prepare", session_token: session.session_token });
      setDocs(r.documents.map((d) => ({ ...d, bytes: d.pdf_base64 ? fromB64(d.pdf_base64) : null })));
      if (r.documents.some((d) => d.signed)) setMode("ELECTRONIC");
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const anySigned = !!docs?.some((d) => d.signed);
  useEffect(() => { onSignedChange?.(anySigned); }, [anySigned, onSignedChange]);

  if (error) {
    return (
      <div className="text-center py-8">
        <AlertCircle className="mx-auto mb-3 text-red-400" size={32} />
        <div className="text-slate-700 mb-4">{error}</div>
        <button onClick={load} className="bg-teal-700 text-white px-5 py-2.5 rounded-lg">Zkusit znovu</button>
      </div>
    );
  }
  if (!docs) return <div className="text-center text-slate-400 py-16"><Loader2 className="animate-spin mx-auto mb-3" size={28} /> Připravuji dokumenty k podpisu…</div>;

  const current = docs.find((d) => !d.signed);
  const idx = current ? docs.indexOf(current) : docs.length;

  async function signCurrent() {
    setBusy(true); setError("");
    const target = { session_token: session.session_token, document_id: current.id };
    try {
      try {
        await invokeKiosk({
          action: "sign", ...target, displayed_sha256: current.sha256,
          intent_text_version_id: current.intent.id, signature_png_base64: pad.current.toPngBase64(), strokes: pad.current.getStrokes(),
          evidence: { pages_viewed: view.pagesViewed, viewed_at: new Date().toISOString(), viewport: { w: window.innerWidth, h: window.innerHeight } },
        });
      } catch (e) {
        // bez odpovede (spojenie / limit servera): overit, ci sa podpis ulozil
        if (e.status && e.status < 500) throw e;
        const st = await invokeKiosk({ action: "complete", ...target }).catch(() => null);
        if (!st) throw new Error("Spojení se serverem se nezdařilo a stav podpisu nelze ověřit. Zkuste to znovu – podpis se neuloží dvakrát.");
        if (!st.signed) throw new Error("Podpis se neuložil, zkuste to znovu.");
      }
      // podpisany original - opakovatelne; neuspech nerusi ulozeny podpis (dokonci HR)
      await invokeKiosk({ action: "complete", ...target }).catch(() => null);
      setDocs((list) => list.map((d) => (d.id === current.id ? { ...d, signed: true, bytes: null } : d)));
      setView({ allViewed: false, pagesViewed: [] });
      setPadPoints(0);
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  const list = (
    <ol className="space-y-1 mb-6">
      {docs.map((d, i) => (
        <li key={d.id} className={"flex items-center gap-2 text-sm " + (d.signed ? "text-emerald-700" : i === idx && mode === "ELECTRONIC" ? "text-slate-800 font-medium" : "text-slate-500")}>
          {d.signed ? <CheckCircle2 size={16} /> : <FileSignature size={16} />} {i + 1}. {d.title}{d.signed && " – podepsáno"}
        </li>
      ))}
    </ol>
  );

  // texty prejavu vole schvaluje jednatel (migracia 66); dovtedy len papier
  const electronicAvailable = docs.every((d) => d.signed || d.intent);
  if (!mode) {
    return (
      <div>
        <p className="text-slate-600 mb-3">K podpisu jsou připraveny tyto dokumenty – každý se podepisuje zvlášť:</p>
        {list}
        {!electronicAvailable && (
          <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-4 py-3 mb-3 text-sm" data-testid="esign-unavailable">Elektronický podpis čeká na schválení textů – použijte papírový postup.</div>
        )}
        <div className="grid sm:grid-cols-2 gap-3">
          {electronicAvailable && (
            <button onClick={() => setMode("ELECTRONIC")} className="flex flex-col items-start gap-1 border-2 border-teal-600 rounded-xl p-4 text-left hover:bg-teal-50">
              <span className="flex items-center gap-2 font-semibold text-teal-800"><FileSignature size={18} /> Podepsat na tabletu</span>
              <span className="text-sm text-slate-500">Každý dokument si celý prohlédnete a podepíšete prstem.</span>
            </button>
          )}
          <button onClick={() => setMode("PAPER")} className="flex flex-col items-start gap-1 border-2 border-slate-200 rounded-xl p-4 text-left hover:bg-slate-50">
            <span className="flex items-center gap-2 font-semibold text-slate-700"><Printer size={18} /> Podepíšu na papíře</span>
            <span className="text-sm text-slate-500">Personální oddělení vám dotazník i prohlášení vytiskne k podpisu.</span>
          </button>
        </div>
      </div>
    );
  }

  if (mode === "PAPER") {
    return (
      <div>
        <p className="text-slate-600 mb-4">Dotazník odešlete bez elektronického podpisu. Personální oddělení vám jej vytiskne k vlastnoručnímu podpisu{docs.length > 1 ? " a stejně tak i prohlášení k e-mailu" : ""}.</p>
        {submitError && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md mb-3">{submitError}</div>}
        <div className="flex justify-between">
          <button onClick={() => setMode(null)} className="text-slate-500 px-4 py-3">Zpět k volbě</button>
          <button onClick={() => onSubmit("PAPER")} disabled={submitting} className="flex items-center gap-2 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-base font-medium px-7 py-3 rounded-lg">
            {submitting ? <Loader2 size={20} className="animate-spin" /> : <CheckCircle2 size={20} />} Odeslat dotazník
          </button>
        </div>
      </div>
    );
  }

  if (!current) {
    return (
      <div>
        {list}
        <p className="text-slate-600 mb-4">Všechny dokumenty jsou podepsány. Odešlete prosím dotazník.</p>
        {submitError && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md mb-3">{submitError}</div>}
        <div className="flex justify-end">
          <button onClick={() => onSubmit("ELECTRONIC")} disabled={submitting} className="flex items-center gap-2 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-base font-medium px-7 py-3 rounded-lg">
            {submitting ? <Loader2 size={20} className="animate-spin" /> : <CheckCircle2 size={20} />} Odeslat dotazník
          </button>
        </div>
      </div>
    );
  }

  const blocked = signBlockedReason({ view, points: padPoints });
  return (
    <div>
      {list}
      <h2 className="text-base font-semibold text-slate-800 mb-2">Dokument {idx + 1} z {docs.length}: {current.title}</h2>
      <PdfPagesViewer key={current.id} bytes={current.bytes} onViewedChange={setView} />
      <div className={"mt-6 " + (view.allViewed ? "" : "opacity-40 pointer-events-none")} aria-disabled={!view.allViewed}>
        <div className="bg-teal-50 border border-teal-200 rounded-lg px-4 py-3 text-slate-800 mb-3">
          {current.intent?.body}
          <div className="text-xs text-slate-400 mt-1">Verze textu {current.intent?.version_no}</div>
        </div>
        <SignaturePad key={current.id} ref={pad} onChange={({ points }) => setPadPoints(points)} />
        <div className="flex justify-between items-center mt-4">
          {!anySigned ? <button onClick={() => setMode(null)} className="text-slate-500 px-2 py-3 text-sm">Raději podepíšu na papíře</button> : <span />}
          <button onClick={signCurrent} disabled={!!blocked || busy}
            className="flex items-center gap-2 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-base font-medium px-7 py-3 rounded-lg">
            {busy ? <Loader2 size={20} className="animate-spin" /> : <FileSignature size={20} />} Podepsat
          </button>
        </div>
      </div>
      {blocked && <div className="text-sm text-amber-800 text-right mt-2" data-testid="sign-blocked">{blocked}</div>}
    </div>
  );
}

export const KIOSK_DOC_TITLES = Object.fromEntries(Object.values(KIOSK_DOCS).map((d) => [d.doc_type, d.title]));
