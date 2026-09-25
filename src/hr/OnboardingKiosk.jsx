import React, { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, CheckCircle2, ArrowLeft, ArrowRight, AlertCircle, ShieldCheck } from "lucide-react";
import { supabase } from "../supabaseClient.js";

/* =========================================================================
   Tabletovy onboarding dotaznik (kiosk) pre noveho zamestnanca.
   KRITICKA BEZPECNOSTNA VLASTNOST (MASTER_PROMPT bod 7 zadania): tento
   komponent NEČÍTA a NEMÔŽE čítať žiadne zamestnanecké/HR data cez priame
   API volania - v celom subore nie je ANI JEDNO `supabase.from(...)`. Jediny
   sposob komunikacie s DB su 3 security-definer RPC funkcie viazane na
   nahodny session_token (supabase/schema.sql 45.8): hr_onboarding_start_session,
   hr_onboarding_save_draft, hr_onboarding_submit - vsetky su explicitne
   grantnute aj rolu "anon", takze tento kiosk NEPOTREBUJE a NEPOUZIVA
   Supabase Auth prihlasenie vobec.
   Navyse - pre pripad, ze by rovnake zariadenie predtym niekedy pouzil
   prihlaseny office ucet (zdielany tablet) - kiosk pri kazdom otvoreni
   NAJPRV vynúti odhlasenie (supabase.auth.signOut()), aby v prehliadaci
   nezostala ziadna office JWT relacia, ktoru by dalo zneuzit cez devtools.
   Toto NIE JE nahrada za spravnu prevadzkovu izolaciu (vyhradene zariadenie,
   ktore sa nikdy nepouziva na prihlasenie do office uctu) - je to dodatocna
   poistka, nie jediny mechanizmus (ten je DB RLS, overeny empiricky v
   sprave: anon rola nevidi employees/onboarding_sessions/... aj ked ma
   table-level grant SELECT=true).
   ========================================================================= */

function emptyDraft() {
  return {
    title: "", first_name: "", last_name: "", maiden_name: "",
    date_of_birth: "", place_of_birth: "", country_of_birth: "", gender: "", nationality: "", is_foreigner: false,
    permanent_street: "", permanent_city: "", permanent_zip: "", permanent_country: "",
    phone: "", private_email: "", id_document_type: "", health_insurance_company: "", highest_education: "",
    birth_number: "", id_document_number: "", bank_account: "",
    position_label: "", start_date: "", employment_type: "doba_neurcita", fixed_term_end_date: "",
    workplace: "", weekly_hours: "40",
  };
}

const STEPS = ["osobni", "kontakt", "citlive", "pozice", "shrnuti"];
const STEP_LABELS = { osobni: "Osobní údaje", kontakt: "Bydliště a kontakt", citlive: "Citlivé údaje", pozice: "Pracovní pozice", shrnuti: "Shrnutí" };

export default function OnboardingKiosk() {
  const [phase, setPhase] = useState("starting"); // starting | error | form | submitting | done
  const [session, setSession] = useState(null); // { id, session_token }
  const [draft, setDraft] = useState(emptyDraft());
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState("");
  const saveTimer = useRef(null);

  useEffect(() => {
    // Best-effort - viz komentar na zaciatku suboru. Nezavisi od vysledku,
    // pokracuje aj ked signOut zlyha (napr. ziadna relacia neexistovala).
    supabase.auth.signOut().catch(() => {});
    startSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startSession() {
    setPhase("starting");
    setError("");
    const { data, error: err } = await supabase.rpc("hr_onboarding_start_session");
    if (err || !data || !data[0]) {
      setError("Nepodařilo se zahájit dotazník. Zkontrolujte připojení a zkuste to znovu.");
      setPhase("error");
      return;
    }
    setSession(data[0]);
    setDraft(emptyDraft());
    setStepIndex(0);
    setPhase("form");
  }

  const saveDraftNow = useCallback(async (nextDraft, sess) => {
    if (!sess) return;
    await supabase.rpc("hr_onboarding_save_draft", { p_session_token: sess.session_token, p_draft_data: nextDraft });
  }, []);

  function set(patch) {
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => saveDraftNow(next, session), 600);
      return next;
    });
  }

  async function goNext() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await saveDraftNow(draft, session);
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }
  function goBack() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  async function submit() {
    setPhase("submitting");
    setError("");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await saveDraftNow(draft, session);
    const { data: ok, error: err } = await supabase.rpc("hr_onboarding_submit", { p_session_token: session.session_token });
    if (err || ok !== true) {
      setError("Odeslání se nezdařilo. Zkuste to prosím znovu.");
      setPhase("form");
      return;
    }
    setPhase("done");
  }

  if (phase === "starting") {
    return (
      <KioskShell>
        <div className="text-center text-slate-400 py-20"><Loader2 className="animate-spin mx-auto mb-3" size={32} /> Připravuji dotazník...</div>
      </KioskShell>
    );
  }

  if (phase === "error") {
    return (
      <KioskShell>
        <div className="text-center py-16">
          <AlertCircle className="mx-auto mb-3 text-red-400" size={36} />
          <div className="text-slate-700 mb-4">{error}</div>
          <button onClick={startSession} className="bg-teal-700 hover:bg-teal-800 text-white text-base font-medium px-6 py-3 rounded-lg">Zkusit znovu</button>
        </div>
      </KioskShell>
    );
  }

  if (phase === "done") {
    return (
      <KioskShell>
        <div className="text-center py-16">
          <CheckCircle2 className="mx-auto mb-4 text-emerald-500" size={48} />
          <div className="text-xl font-semibold text-slate-800 mb-2">Děkujeme!</div>
          <div className="text-slate-500 mb-8">Váš dotazník byl odeslán. Osobní referent jej zkontroluje a založí váš personální spis.</div>
          <button onClick={startSession} className="bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium px-5 py-2.5 rounded-lg">Začít nový dotazník (další osoba)</button>
        </div>
      </KioskShell>
    );
  }

  const step = STEPS[stepIndex];

  return (
    <KioskShell>
      <div className="flex items-center justify-between mb-6">
        <div className="text-sm text-slate-400">Krok {stepIndex + 1} z {STEPS.length}</div>
        <div className="text-sm font-medium text-slate-600">{STEP_LABELS[step]}</div>
      </div>
      <div className="flex gap-1.5 mb-8">
        {STEPS.map((s, i) => <div key={s} className={"h-1.5 flex-1 rounded-full " + (i <= stepIndex ? "bg-teal-600" : "bg-slate-200")} />)}
      </div>

      {step === "osobni" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5">
          <KField label="Titul" value={draft.title} onChange={(v) => set({ title: v })} />
          <KField label="Jméno *" value={draft.first_name} onChange={(v) => set({ first_name: v })} />
          <KField label="Příjmení *" value={draft.last_name} onChange={(v) => set({ last_name: v })} />
          <KField label="Rodné příjmení" value={draft.maiden_name} onChange={(v) => set({ maiden_name: v })} />
          <KDateField label="Datum narození" value={draft.date_of_birth} onChange={(v) => set({ date_of_birth: v })} />
          <KField label="Místo narození" value={draft.place_of_birth} onChange={(v) => set({ place_of_birth: v })} />
          <KField label="Stát narození" value={draft.country_of_birth} onChange={(v) => set({ country_of_birth: v })} />
          <KSelectField label="Pohlaví" value={draft.gender} onChange={(v) => set({ gender: v })} options={[{ value: "", label: "— vyberte —" }, { value: "muz", label: "Muž" }, { value: "zena", label: "Žena" }]} />
          <KField label="Státní občanství" value={draft.nationality} onChange={(v) => set({ nationality: v })} />
          <label className="flex items-center gap-2 mt-2 mb-3 text-base text-slate-600 sm:col-span-2">
            <input type="checkbox" className="w-5 h-5" checked={draft.is_foreigner} onChange={(e) => set({ is_foreigner: e.target.checked })} /> Jsem cizinec (mimo ČR/SR)
          </label>
        </div>
      )}

      {step === "kontakt" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5">
          <KField label="Ulice, číslo popisné" value={draft.permanent_street} onChange={(v) => set({ permanent_street: v })} />
          <KField label="Obec" value={draft.permanent_city} onChange={(v) => set({ permanent_city: v })} />
          <KField label="PSČ" value={draft.permanent_zip} onChange={(v) => set({ permanent_zip: v })} />
          <KField label="Stát" value={draft.permanent_country} onChange={(v) => set({ permanent_country: v })} />
          <KField label="Telefon" value={draft.phone} onChange={(v) => set({ phone: v })} />
          <KField label="E-mail" value={draft.private_email} onChange={(v) => set({ private_email: v })} />
          <KField label="Typ dokladu totožnosti" value={draft.id_document_type} onChange={(v) => set({ id_document_type: v })} />
          <KField label="Zdravotní pojišťovna" value={draft.health_insurance_company} onChange={(v) => set({ health_insurance_company: v })} />
          <KField label="Nejvyšší dosažené vzdělání" value={draft.highest_education} onChange={(v) => set({ highest_education: v })} />
        </div>
      )}

      {step === "citlive" && (
        <div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4 flex items-start gap-2 text-sm text-amber-800">
            <ShieldCheck size={18} className="shrink-0 mt-0.5" />
            <span>Tyto údaje se odesílají přímo osobnímu oddělení a nejsou na tomto zařízení nijak ukládány. Uvidí je jen pověřený personalista po kontrole dotazníku.</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5">
            <KField label="Rodné číslo" value={draft.birth_number} onChange={(v) => set({ birth_number: v })} />
            <KField label="Číslo dokladu totožnosti" value={draft.id_document_number} onChange={(v) => set({ id_document_number: v })} />
            <KField label="Číslo bankovního účtu" value={draft.bank_account} onChange={(v) => set({ bank_account: v })} />
          </div>
        </div>
      )}

      {step === "pozice" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5">
          <KField label="Pracovní pozice (název)" value={draft.position_label} onChange={(v) => set({ position_label: v })} />
          <KDateField label="Datum nástupu" value={draft.start_date} onChange={(v) => set({ start_date: v })} />
          <KSelectField label="Typ smlouvy" value={draft.employment_type} onChange={(v) => set({ employment_type: v })} options={[{ value: "doba_neurcita", label: "Doba neurčitá" }, { value: "doba_urcita", label: "Doba určitá" }]} />
          {draft.employment_type === "doba_urcita" && <KDateField label="Konec smlouvy" value={draft.fixed_term_end_date} onChange={(v) => set({ fixed_term_end_date: v })} />}
          <KField label="Místo výkonu práce" value={draft.workplace} onChange={(v) => set({ workplace: v })} />
          <KField label="Týdenní úvazek (hodin)" value={draft.weekly_hours} onChange={(v) => set({ weekly_hours: v })} />
        </div>
      )}

      {step === "shrnuti" && (
        <div>
          <p className="text-slate-500 mb-4">Zkontrolujte prosím vyplněné údaje. Po odeslání je zkontroluje osobní oddělení.</p>
          <div className="bg-slate-50 rounded-lg p-4 space-y-1 text-sm mb-4">
            <SummaryRow label="Jméno a příjmení" value={[draft.title, draft.first_name, draft.last_name].filter(Boolean).join(" ")} />
            <SummaryRow label="Datum narození" value={draft.date_of_birth} />
            <SummaryRow label="Adresa" value={[draft.permanent_street, draft.permanent_city].filter(Boolean).join(", ")} />
            <SummaryRow label="Telefon" value={draft.phone} />
            <SummaryRow label="E-mail" value={draft.private_email} />
            <SummaryRow label="Pozice" value={draft.position_label} />
            <SummaryRow label="Datum nástupu" value={draft.start_date} />
          </div>
          {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md mb-3">{error}</div>}
        </div>
      )}

      <div className="flex justify-between mt-8">
        <button onClick={goBack} disabled={stepIndex === 0} className="flex items-center gap-1.5 text-slate-500 disabled:opacity-0 text-base px-4 py-3">
          <ArrowLeft size={18} /> Zpět
        </button>
        {step === "shrnuti" ? (
          <button onClick={submit} disabled={phase === "submitting" || !draft.first_name.trim() || !draft.last_name.trim()} className="flex items-center gap-2 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-base font-medium px-7 py-3 rounded-lg">
            {phase === "submitting" ? <Loader2 size={20} className="animate-spin" /> : <CheckCircle2 size={20} />} Odeslat dotazník
          </button>
        ) : (
          <button onClick={goNext} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-base font-medium px-7 py-3 rounded-lg">
            Další <ArrowRight size={18} />
          </button>
        )}
      </div>
    </KioskShell>
  );
}

function KioskShell({ children }) {
  return (
    <div className="min-h-screen bg-slate-100 flex items-start justify-center py-10 px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 w-full max-w-2xl p-6 sm:p-8">
        <h1 className="text-lg font-semibold text-slate-800 mb-1">Osobní dotazník nového zaměstnance</h1>
        <div className="text-sm text-slate-400 mb-6">Stenger Czech, s.r.o.</div>
        {children}
      </div>
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-900 font-medium text-right">{value || "—"}</span>
    </div>
  );
}

function KField({ label, value, onChange }) {
  return (
    <label className="block mb-4">
      <span className="block text-sm font-medium text-slate-500 mb-1.5">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-base" />
    </label>
  );
}
function KDateField({ label, value, onChange }) {
  return (
    <label className="block mb-4">
      <span className="block text-sm font-medium text-slate-500 mb-1.5">{label}</span>
      <input type="date" value={value || ""} onChange={(e) => onChange(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-base" />
    </label>
  );
}
function KSelectField({ label, value, onChange, options }) {
  return (
    <label className="block mb-4">
      <span className="block text-sm font-medium text-slate-500 mb-1.5">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-base bg-white">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
