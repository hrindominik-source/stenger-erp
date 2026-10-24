import React, { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, CheckCircle2, ArrowLeft, ArrowRight, AlertCircle, ShieldCheck } from "lucide-react";
import { supabase } from "../supabaseClient.js";
import { emptyEmployeeValues, MAX_CHILDREN } from "../lib/hr/employeeFields.js";
import EmployeeFieldsForm, { EmployeeFieldsView, applyFieldChange, visibleSections } from "./EmployeeFieldsForm.jsx";
import { validateKioskEmail, validateKioskCommunication } from "../lib/hr/kioskDocuments.js";
import { KioskEmailChoice, KioskCommunicationStep, KioskSigningStep } from "./KioskSteps.jsx";

/* =========================================================================
   Tabletovy onboarding dotaznik (kiosk) pre noveho zamestnanca.
   KRITICKA BEZPECNOSTNA VLASTNOST (MASTER_PROMPT bod 7 zadania): tento
   komponent NEČÍTA a NEMÔŽE čítať žiadne zamestnanecké/HR data cez priame
   API volania - v celom subore nie je ANI JEDNO `supabase.from(...)`. Jediny
   sposob komunikacie s DB su 3 security-definer RPC funkcie viazane na
   nahodny session_token (supabase/schema.sql 45.8): hr_onboarding_start_session,
   hr_onboarding_save_draft, hr_onboarding_submit, hr_onboarding_config a
   Edge Function hr-kiosk (faza D - PDF na podpis a podpis, tiez len s
   tokenom; KioskSteps.jsx) - RPC su explicitne
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
  { id: "dane", label: "Daně a děti", sections: ["dane_nadpis", "dane", "deti", ...Array.from({ length: MAX_CHILDREN }, (_, i) => `dep_dite${i + 1}`), "dep_jina_osoba", "soubeh"] },
  { id: "komunikace", label: "Elektronická komunikace", sections: [], custom: true },
  { id: "shrnuti", label: "Shrnutí", sections: [], custom: true },
  { id: "podpis", label: "Dokumenty a podpis", sections: [], custom: true },
];
const KIOSK_CTX = { mode: "kiosk", canSensitive: true, canPayroll: true };

export default function OnboardingKiosk() {
  const [phase, setPhase] = useState("starting"); // starting | error | form | submitting | done
  const [session, setSession] = useState(null); // { id, session_token }
  const [draft, setDraft] = useState(emptyEmployeeValues());
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState("");
  const [config, setConfig] = useState(null);
  const [emailConfirm, setEmailConfirm] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [anySigned, setAnySigned] = useState(false);
  const [submittedMode, setSubmittedMode] = useState(null);
  const saveTimer = useRef(null);

  useEffect(() => {
    // Best-effort - viz komentar na zaciatku suboru. Nezavisi od vysledku,
    // pokracuje aj ked signOut zlyha (napr. ziadna relacia neexistovala).
    supabase.auth.signOut().catch(() => {});
    startSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Kiosk je odomknuty kodom od HR (Nástupy -> Odemknout tablet) - bez neho
  // nevznikne relacia (audit S-03). Kazdy novy dotaznik = novy kod.
  async function startSession(unlockCode) {
    setPhase("starting");
    setError("");
    const { data: cfg, error: cfgErr } = await supabase.rpc("hr_onboarding_config");
    if (cfgErr || !cfg) {
      setError("Nepodařilo se zahájit dotazník. Zkontrolujte připojení a zkuste to znovu.");
      setPhase("error");
      return;
    }
    if (cfg.device_unlock_required !== false && !unlockCode) {
      setConfig(cfg);
      setPhase("unlock");
      return;
    }
    const { data, error: err } = await supabase.rpc("hr_onboarding_start_session", unlockCode ? { p_unlock_code: unlockCode } : {});
    if (err && /odemceno/i.test(err.message || "")) {
      setError("Kód je neplatný, už byl použit nebo vypršel. Požádejte personální oddělení o nový.");
      setPhase("unlock");
      return;
    }
    if (err || !data || !data[0]) {
      setError("Nepodařilo se zahájit dotazník. Zkontrolujte připojení a zkuste to znovu.");
      setPhase("error");
      return;
    }
    setSession(data[0]);
    setConfig(cfg);
    setDraft(emptyEmployeeValues());
    setEmailConfirm("");
    setShowErrors(false);
    setAnySigned(false);
    setStepIndex(0);
    setPhase("form");
  }

  const saveDraftNow = useCallback(async (nextDraft, sess) => {
    if (!sess) return;
    await supabase.rpc("hr_onboarding_save_draft", { p_session_token: sess.session_token, p_draft_data: nextDraft });
  }, []);

  function setField(key, value) {
    setDraft((prev) => {
      let next = applyFieldChange(prev, key, value);
      // Volby k e-mailu sa vztahuju len k jednej adrese - pri zmene adresy
      // (alebo "Nemám e-mail") sa musia zvolit znova.
      if ((key === "private_email" && String(value).trim() !== String(prev.private_email || "").trim()) || key === "no_private_email") {
        next = { ...next, kiosk_s21: "", kiosk_s335: "", kiosk_s335_notice_id: "" };
        if (key === "no_private_email" && value) next.private_email = "";
      }
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => saveDraftNow(next, session), 600);
      return next;
    });
  }

  function stepErrors(id) {
    if (id === "adresa") return validateKioskEmail(draft, emailConfirm);
    if (id === "komunikace") return validateKioskCommunication(draft, config);
    if (id === "shrnuti" && (!draft.first_name.trim() || !draft.last_name.trim())) return ["Vyplňte jméno a příjmení."];
    return [];
  }

  async function goNext() {
    if (stepErrors(STEPS[stepIndex].id).length) { setShowErrors(true); return; }
    setShowErrors(false);
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
    while (j > 0 && j < STEPS.length - 1 && !STEPS[j].custom && visibleSections({ ...KIOSK_CTX, values: draft, sectionIds: STEPS[j].sections }).length === 0) j += dir;
    return Math.min(Math.max(j, 0), STEPS.length - 1);
  }

  // Koncept sa uz neuklada - udaje su ulozene pred pripravou dokumentov a po
  // prvom podpise ich DB nedovoli zmenit.
  async function submit(signingMode) {
    setPhase("submitting");
    setError("");
    const { data: ok, error: err } = await supabase.rpc("hr_onboarding_submit", { p_session_token: session.session_token, p_signing_mode: signingMode });
    if (err || ok !== true) {
      setError("Odeslání se nezdařilo. Zkuste to prosím znovu.");
      setPhase("form");
      return;
    }
    setSubmittedMode(signingMode);
    setPhase("done");
  }

  if (phase === "starting") {
    return (
      <KioskShell>
        <div className="text-center text-slate-400 py-20"><Loader2 className="animate-spin mx-auto mb-3" size={32} /> Připravuji dotazník...</div>
      </KioskShell>
    );
  }

  if (phase === "unlock") {
    return (
      <KioskShell>
        <KioskUnlock error={error} onSubmit={(code) => startSession(code)} />
      </KioskShell>
    );
  }

  if (phase === "error") {
    return (
      <KioskShell>
        <div className="text-center py-16">
          <AlertCircle className="mx-auto mb-3 text-red-400" size={36} />
          <div className="text-slate-700 mb-4">{error}</div>
          <button onClick={() => startSession()} className="bg-teal-700 hover:bg-teal-800 text-white text-base font-medium px-6 py-3 rounded-lg">Zkusit znovu</button>
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
          <div className="text-slate-500 mb-8">Váš dotazník byl odeslán. Osobní referent jej zkontroluje a založí váš personální spis.{submittedMode === "PAPER" && " Dotazník vám vytiskne k vlastnoručnímu podpisu."}</div>
          <button onClick={() => startSession()} className="bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium px-5 py-2.5 rounded-lg">Začít nový dotazník (další osoba)</button>
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

      {!step.custom && (
        <EmployeeFieldsForm values={draft} onChange={setField} {...KIOSK_CTX} variant="kiosk" sectionIds={step.sections} />
      )}
      {step.id === "adresa" && (
        <KioskEmailChoice draft={draft} onChange={setField} confirm={emailConfirm} onConfirm={setEmailConfirm} showErrors={showErrors} />
      )}
      {step.id === "komunikace" && (
        <KioskCommunicationStep draft={draft} config={config} onChange={setField} errors={showErrors ? stepErrors("komunikace") : []} />
      )}

      {step.id === "shrnuti" && (
        <div>
          <p className="text-slate-500 mb-4">Zkontrolujte prosím vyplněné údaje. V dalším kroku z nich připravíme dokumenty k podpisu – po prvním podpisu už údaje nepůjde měnit.</p>
          <div className="mb-4"><EmployeeFieldsView values={draft} {...KIOSK_CTX} /></div>
          {showErrors && stepErrors("shrnuti").map((e) => <div key={e} className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md mb-3">{e}</div>)}
        </div>
      )}

      {step.id === "podpis" && (
        <KioskSigningStep session={session} onSubmit={submit} onSignedChange={setAnySigned} submitting={phase === "submitting"} submitError={error} />
      )}

      <div className="flex justify-between mt-8">
        <button onClick={goBack} disabled={stepIndex === 0 || anySigned} className="flex items-center gap-1.5 text-slate-500 disabled:opacity-0 text-base px-4 py-3">
          <ArrowLeft size={18} /> Zpět
        </button>
        {step.id !== "podpis" && (
          <button onClick={goNext} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-base font-medium px-7 py-3 rounded-lg">
            {step.id === "shrnuti" ? "Pokračovat k dokumentům" : "Další"} <ArrowRight size={18} />
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

function KioskUnlock({ error, onSubmit }) {
  const [code, setCode] = useState("");
  return (
    <form className="max-w-sm mx-auto text-center py-12" onSubmit={(e) => { e.preventDefault(); if (code.trim()) onSubmit(code.trim().toUpperCase()); }}>
      <ShieldCheck className="mx-auto mb-3 text-teal-600" size={36} />
      <div className="text-lg font-semibold text-slate-800 mb-1">Tablet je zamčený</div>
      <div className="text-slate-500 text-sm mb-5">Kód pro odemčení vám dá personální oddělení (platí jednou, 15 minut).</div>
      <input aria-label="Kód pro odemčení" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters"
        className="w-full text-center text-2xl tracking-widest font-mono border border-slate-300 rounded-lg px-4 py-3 mb-3 uppercase" maxLength={16} />
      {error && <div className="text-red-600 text-sm mb-3">{error}</div>}
      <button type="submit" disabled={!code.trim()} className="w-full bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-base font-medium px-6 py-3 rounded-lg">Odemknout a začít dotazník</button>
    </form>
  );
}
