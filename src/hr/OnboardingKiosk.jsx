import React, { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, CheckCircle2, ArrowLeft, ArrowRight, AlertCircle, ShieldCheck } from "lucide-react";
import { supabase } from "../supabaseClient.js";
import { emptyEmployeeValues } from "../lib/hr/employeeFields.js";
import EmployeeFieldsForm, { EmployeeFieldsView, applyFieldChange, visibleSections } from "./EmployeeFieldsForm.jsx";

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

// Polia su spolocne s HR formularom (lib/hr/employeeFields.js, mode "kiosk"
// = bez poli, ktore vyplna len HR). Draft sa uklada v rovnakych plochych
// klucoch, takze HR ho pri kontrole len predvyplni do "Nový zaměstnanec".
const STEPS = [
  { id: "osobni", label: "Osobní údaje", sections: ["zakladni", "rezidence"] },
  { id: "adresa", label: "Bydliště a kontakt", sections: ["adresa_trvala", "adresa_cr", "adresa_kontaktni", "kontakt"] },
  { id: "pojisteni", label: "Vzdělání, pojištění, zdraví", sections: ["vzdelani", "pojisteni", "zdravi", "cizi_predpisy", "duchod"] },
  { id: "cizinec", label: "Údaje cizince", sections: ["cizinec"] },
  { id: "pozice", label: "Nástup", sections: ["pozice"] },
  { id: "dane", label: "Daně a děti", sections: ["dane", "dep_dite1", "dep_dite2", "dep_dite3", "dep_dite4", "dep_manzel", "dep_jina_osoba", "soubeh"] },
  { id: "shrnuti", label: "Shrnutí", sections: [] },
];
const KIOSK_CTX = { mode: "kiosk", canSensitive: true, canPayroll: true };

export default function OnboardingKiosk() {
  const [phase, setPhase] = useState("starting"); // starting | error | form | submitting | done
  const [session, setSession] = useState(null); // { id, session_token }
  const [draft, setDraft] = useState(emptyEmployeeValues());
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
    setDraft(emptyEmployeeValues());
    setStepIndex(0);
    setPhase("form");
  }

  const saveDraftNow = useCallback(async (nextDraft, sess) => {
    if (!sess) return;
    await supabase.rpc("hr_onboarding_save_draft", { p_session_token: sess.session_token, p_draft_data: nextDraft });
  }, []);

  function setField(key, value) {
    setDraft((prev) => {
      const next = applyFieldChange(prev, key, value);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => saveDraftNow(next, session), 600);
      return next;
    });
  }

  async function goNext() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await saveDraftNow(draft, session);
    setStepIndex((i) => nextNonEmptyStep(i, 1));
  }
  function goBack() {
    setStepIndex((i) => nextNonEmptyStep(i, -1));
  }
  // Krok bez jedineho viditelneho pola (napr. "Údaje cizince" pre obcana
  // ČR) sa preskoci.
  function nextNonEmptyStep(i, dir) {
    let j = i + dir;
    while (j > 0 && j < STEPS.length - 1 && visibleSections({ ...KIOSK_CTX, values: draft, sectionIds: STEPS[j].sections }).length === 0) j += dir;
    return Math.min(Math.max(j, 0), STEPS.length - 1);
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
        <div className="text-sm font-medium text-slate-600">{step.label}</div>
      </div>
      <div className="flex gap-1.5 mb-8">
        {STEPS.map((s, i) => <div key={s.id} className={"h-1.5 flex-1 rounded-full " + (i <= stepIndex ? "bg-teal-600" : "bg-slate-200")} />)}
      </div>

      {step.id === "adresa" && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4 flex items-start gap-2 text-sm text-amber-800">
          <ShieldCheck size={18} className="shrink-0 mt-0.5" />
          <span>Osobní údaje se odesílají přímo osobnímu oddělení a nejsou na tomto zařízení nijak ukládány. Uvidí je jen pověřený personalista po kontrole dotazníku.</span>
        </div>
      )}

      {step.id !== "shrnuti" && (
        <EmployeeFieldsForm values={draft} onChange={setField} {...KIOSK_CTX} variant="kiosk" sectionIds={step.sections} />
      )}

      {step.id === "shrnuti" && (
        <div>
          <p className="text-slate-500 mb-4">Zkontrolujte prosím vyplněné údaje. Po odeslání je zkontroluje osobní oddělení.</p>
          <div className="mb-4"><EmployeeFieldsView values={draft} {...KIOSK_CTX} /></div>
          {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md mb-3">{error}</div>}
        </div>
      )}

      <div className="flex justify-between mt-8">
        <button onClick={goBack} disabled={stepIndex === 0} className="flex items-center gap-1.5 text-slate-500 disabled:opacity-0 text-base px-4 py-3">
          <ArrowLeft size={18} /> Zpět
        </button>
        {step.id === "shrnuti" ? (
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
