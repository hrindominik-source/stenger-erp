// Prehlad pre jednatela (balik A auditu, docs/audit/03): co caka na
// schvalenie, nove rizikove udalosti (hr_notifications plnene triggrami v DB),
// lehoty a kto ma aky pristup. Len HR_ADMIN - DB inym nic nevrati.
import React, { useState, useEffect, useCallback } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { supabase } from "../supabaseClient.js";
import LegalParameters from "./LegalParameters.jsx";
import { APPROVAL_STATUS_LABELS } from "./ApprovalRequest.jsx";
import { RetentionRules, RetentionDue, Processors } from "./Gdpr.jsx";
import Legislativa from "./Legislativa.jsx";

export const EVENT_LABELS = {
  DOC_SIGNED: "Podepsané smlouvy a úkony",
  DOC_VOIDED: "Zneplatněné dokumenty",
  WAGE_CHANGED: "Změny mzdy",
  MFA_RESET: "Zrušená či obnovená dvoufázová ověření",
  LEGAL_PARAM_CHANGED: "Změny zákonných parametrů",
  APPROVAL_REQUESTED: "Žádosti o schválení",
  EMERGENCY_STEP: "Nouzové postupy",
  RETENTION_CHANGED: "Změny lhůt uchovávání",
  EMPLOYEE_EXPORTED: "Exporty údajů zaměstnance",
  EMPLOYEE_ANONYMIZED: "Anonymizace",
  LOGIN_FAILURES: "Opakovaná neúspěšná přihlášení",
  USER_OFFBOARDED: "Zablokované účty (odchod z firmy)",
  HR_ACCESS_ENDED: "Ukončené přístupy do HR",
  NEW_DEVICE: "Přihlášení z nového zařízení",
  REVISION_DUE: "Revize šablon a parametrů",
  REMEDIATION_REQUIRED: "Náprava po zamítnutém nouzovém postupu",
  BANK_ACCOUNT_CHANGED: "Změna čísla účtu zaměstnance",
  LEGISLATION_CHANGED: "Možné změny zákoníku práce",
  LEGISLATION_CHECK_FAILED: "Selhávající kontrola změn zákona",
  TEMPLATE_PENDING: "Šablony ke schválení",
  TEMPLATE_APPROVED: "Schválené šablony",
  LEGAL_TEXT_PENDING: "Texty ke schválení",
  PERMISSIONS_CHANGED: "Změny přístupů",
  ACCOUNT_ROLE_CHANGED: "Změny rolí účtů",
  SIGNATORY_CHANGED: "Plné moci",
  SETTINGS_CHANGED: "Nastavení HR",
  EMPLOYEE_DELETED: "Trvalé vymazání",
  DELIVERY_FAILED: "Nezdařené doručení",
  DELIVERY_INEFFECTIVE: "Neúčinné doručení",
};
const APPROVAL_KIND_LABELS = { EMPLOYER_SIGN: "Podpis za zaměstnavatele", VOID_DOCUMENT: "Zneplatnění podepsaného dokumentu", LEGAL_EXCEPTION: "Výjimka ze zákonného limitu", ANONYMIZE: "Anonymizace zaměstnance" };
const PROFILE_LABELS = { KONATEL: "Jednatel", PERSONALISTA: "Personalista", UCTOVNIK_EXT: "Externí účetní", VLASTNI: "Vlastní nastavení" };
// ostatnym (jednatel) rusi overenie len IT serverovo - zhodne s hr-mfa
const MFA_RESETTABLE = ["PERSONALISTA", "UCTOVNIK_EXT"];

const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const fmtDate = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join(".") : "—");

const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

function Stat({ label, value, alert }) {
  return (
    <div className={"bg-white rounded-lg px-4 py-3 border " + (alert && value > 0 ? "border-red-400" : "border-slate-200")}>
      <div className={"text-2xl font-bold " + (alert && value > 0 ? "text-red-600" : "text-slate-700")}>{value ?? "—"}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

function NotificationRow({ n, names, action }) {
  return (
    <div className="px-4 py-2 text-sm flex items-start gap-3" data-testid="konatel-notification">
      <div className="flex-1 min-w-0">
        <div className="font-medium">{n.title}</div>
        <div className="text-xs text-slate-500">
          {fmtDateTime(n.created_at)} · {names[n.actor_id] || (n.actor_id ? "uživatel" : "systém")}
          {n.data?.reason ? ` · důvod: ${n.data.reason}` : ""}
          {n.event_type === "WAGE_CHANGED" ? ` · ${n.data?.z || "—"} → ${n.data?.na || "—"}${n.data?.platnost_od ? ` od ${fmtDate(n.data.platnost_od)}` : ""}` : ""}
        </div>
      </div>
      {action}
    </div>
  );
}

export default function KonatelPrehled() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);
  const [pending, setPending] = useState([]);
  const [unread, setUnread] = useState([]);
  const [access, setAccess] = useState([]);
  const [names, setNames] = useState({});
  const [mfa, setMfa] = useState({}); // email -> { mfa_active, recovery_left }
  const [resetting, setResetting] = useState(null); // { email, reason, busy, error }
  const [approvals, setApprovals] = useState([]);
  const [employeeNames, setEmployeeNames] = useState({});
  const [deciding, setDeciding] = useState(null); // { id, approve, note, busy, error }
  const [security, setSecurity] = useState({}); // email -> relacie, neuspesne prihlasenia (migracia 73)
  const [remedies, setRemedies] = useState([]); // otvorene ulohy napravy (migracia 76)
  const [closing, setClosing] = useState(null); // { id, resolution, busy, error }
  const [offboarding, setOffboarding] = useState(null); // { email, mode: "ACCOUNT"|"HR", reason, busy, error }

  const load = useCallback(async () => {
    const [sumRes, pendRes, unreadRes, accRes, profRes, mfaRes, apprRes, secRes] = await Promise.all([
      supabase.rpc("hr_konatel_summary", { p_days: 7 }),
      supabase.from("hr_notifications").select("*").eq("kind", "KE_SCHVALENI").is("resolved_at", null).order("created_at", { ascending: false }),
      supabase.from("hr_notifications").select("*").eq("kind", "NA_VEDOMI").is("read_at", null).order("created_at", { ascending: false }).limit(200),
      supabase.from("hr_permissions").select("id, user_email, user_id, profile, valid_from, valid_until, granted_by, granted_at").order("user_email"),
      supabase.from("profiles").select("id, full_name"),
      supabase.rpc("hr_mfa_overview"),
      supabase.rpc("hr_open_approvals"),
      supabase.rpc("hr_account_security_overview"),
    ]);
    const { data: rem } = await supabase.from("hr_remediation_tasks").select("*").eq("status", "OPEN").order("due_date");
    setRemedies(rem || []);
    const err = sumRes.error || pendRes.error || unreadRes.error || accRes.error;
    if (err) { setError("Nepodařilo se načíst přehled."); setLoading(false); return; }
    setSummary(sumRes.data);
    // ziadosti styroch oci sa vybavuju rozhodnutim nizsie, nie "Vyřízeno";
    // revizie sa vybavuju potvrdenim / novym terminom v sekcii Revize
    // ulohy napravy sa uzatvaraju popisom napravy v sekcii Nápravy
    setPending((pendRes.data || []).filter((n) => !["hr_approval_requests", "hr_remediation_tasks"].includes(n.entity) && n.event_type !== "REVISION_DUE"));
    const appr = apprRes.data || [];
    setApprovals(appr);
    const empIds = [...new Set([...appr, ...(rem || [])].map((a) => a.employee_id).filter(Boolean))];
    if (empIds.length) {
      const { data: emps } = await supabase.from("employees").select("id, first_name, last_name").in("id", empIds);
      setEmployeeNames(Object.fromEntries((emps || []).map((e) => [e.id, `${e.first_name} ${e.last_name}`])));
    }
    setUnread(unreadRes.data || []);
    setAccess(accRes.data || []);
    setNames(Object.fromEntries((profRes.data || []).map((p) => [p.id, p.full_name])));
    setSecurity(Object.fromEntries((secRes.data || []).map((x) => [String(x.email).toLowerCase(), x])));
    setMfa(Object.fromEntries((mfaRes.data || []).map((m) => [String(m.email).toLowerCase(), m])));
    setError("");
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Zrusenie dvojfazoveho overenia (strata telefonu) - len personalistke a
  // externej uctovnicke; jednatela rusi IT serverovo (migracia 69).
  async function resetMfa(e) {
    e.preventDefault();
    setResetting((r) => ({ ...r, busy: true, error: "" }));
    const { error: fnErr } = await supabase.functions.invoke("hr-mfa", { body: { action: "reset_user", user_email: resetting.email, reason: resetting.reason } });
    if (fnErr) {
      let message = "Zrušení ověření se nezdařilo.";
      try { message = (await fnErr.context.json()).error || message; } catch { /* bez JSON */ }
      setResetting((r) => ({ ...r, busy: false, error: message }));
      return;
    }
    setResetting(null);
    load();
  }

  async function decide(e) {
    e.preventDefault();
    setDeciding((d) => ({ ...d, busy: true, error: "" }));
    const { error: err } = await supabase.rpc("hr_decide_approval", { p_id: deciding.id, p_approve: deciding.approve, p_note: deciding.note || null,
      p_remedy_due: deciding.due || null });
    if (err) { setDeciding((d) => ({ ...d, busy: false, error: err.message })); return; }
    setDeciding(null);
    load();
  }

  async function closeRemedy(e) {
    e.preventDefault();
    setClosing((c) => ({ ...c, busy: true, error: "" }));
    const { error: err } = await supabase.rpc("hr_remediation_close", { p_id: closing.id, p_resolution: closing.resolution });
    if (err) { setClosing((c) => ({ ...c, busy: false, error: err.message })); return; }
    setClosing(null);
    load();
  }

  // Odchod pouzivatela: koniec pristupu do HR, zrusenie relacii, blokacia uctu.
  async function offboard(e) {
    e.preventDefault();
    setOffboarding((o) => ({ ...o, busy: true, error: "" }));
    const action = offboarding.mode === "HR" ? "end_hr_access" : "offboard_user";
    const { error: fnErr } = await supabase.functions.invoke("hr-ucty", { body: { action, user_email: offboarding.email, reason: offboarding.reason } });
    if (fnErr) {
      let message = "Ukončení přístupu se nezdařilo.";
      try { message = (await fnErr.context.json()).error || message; } catch { /* bez JSON */ }
      setOffboarding((o) => ({ ...o, busy: false, error: message }));
      return;
    }
    setOffboarding(null);
    load();
  }

  async function markRead(ids) {
    if (ids.length === 0) return;
    const { error: e } = await supabase.from("hr_notifications").update({ read_at: new Date().toISOString() }).in("id", ids);
    if (e) { setError("Nepodařilo se označit jako přečtené."); return; }
    load();
  }
  async function resolve(id) {
    const { error: e } = await supabase.from("hr_notifications").update({ resolved_at: new Date().toISOString() }).eq("id", id);
    if (e) { setError("Nepodařilo se označit jako vyřízené."); return; }
    load();
  }

  if (loading) return <div className="text-center text-slate-400 py-10"><Loader2 className="animate-spin mx-auto mb-2" size={24} /> Načítám...</div>;

  const today = new Date().toISOString().slice(0, 10);
  const events = Object.entries(summary?.udalosti || {});

  return (
    <div className="space-y-4">
      {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md">{error}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Čeká na schválení" value={summary?.ke_schvaleni} alert />
        <Stat label="Nové události" value={summary?.neprectene} />
        <Stat label="Smlouvy končí do 30 dnů" value={summary?.smlouvy_konci_30_dni} alert />
        <Stat label="Smlouvy po konci, stále aktivní" value={summary?.smlouvy_po_konci} alert />
        <Stat label="Prohlídky po platnosti" value={summary?.prohlidky_po_platnosti} alert />
        <Stat label="Prohlídky do 30 dnů" value={summary?.prohlidky_do_30_dni} />
        <Stat label="Platné přístupy do HR" value={summary?.pristupy} />
        <Stat label="Přístupy končí do 14 dnů" value={summary?.pristupy_konci_14_dni} />
      </div>

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden" data-testid="konatel-approvals">
        <div className="px-4 py-2.5 border-b border-slate-100 font-semibold text-sm">Žádosti o schválení a nouzové postupy (čtyři oči)</div>
        {approvals.length === 0
          ? <div className="px-4 py-3 text-sm text-slate-400">Nic nečeká.</div>
          : <div className="divide-y divide-slate-100">{approvals.map((a) => (
              <div key={a.id} className={"px-4 py-2 text-sm " + (a.emergency ? "bg-red-50" : "")} data-testid="konatel-approval-row">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                  <div className="flex-1 min-w-60">
                    <div className="font-medium">{APPROVAL_KIND_LABELS[a.kind] || a.kind}{a.employee_id ? ` – ${employeeNames[a.employee_id] || a.employee_id}` : ""}
                      {a.emergency && <span className="ml-2 text-xs text-red-700 font-semibold">NOUZOVÝ POSTUP – už provedeno</span>}</div>
                    <div className="text-slate-600">Důvod: {a.reason}</div>
                    {a.emergency && <div className="text-slate-600">Jak byl jednatel informován: {a.emergency_info}</div>}
                    {a.kind === "LEGAL_EXCEPTION" && <div className="text-xs text-slate-500">Limity: {(a.payload?.codes || []).join(", ")}</div>}
                    <div className="text-xs text-slate-400">{names[a.requested_by] || "—"} · {fmtDateTime(a.requested_at)} · {APPROVAL_STATUS_LABELS[a.status]}</div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button className="text-xs bg-teal-700 hover:bg-teal-800 text-white px-2.5 py-1 rounded-md"
                      onClick={() => setDeciding({ id: a.id, approve: true, note: "", busy: false, error: "" })}>{a.emergency ? "Potvrdit" : "Schválit"}</button>
                    <button className="text-xs border border-red-300 text-red-700 px-2.5 py-1 rounded-md"
                      onClick={() => setDeciding({ id: a.id, approve: false, note: "", due: a.emergency ? plusDays(14) : "", emergency: a.emergency, busy: false, error: "" })}>{a.emergency ? "Odmítnout" : "Zamítnout"}</button>
                  </div>
                </div>
                {deciding?.id === a.id && (
                  <form onSubmit={decide} className="mt-2 flex flex-wrap items-center gap-2" data-testid="konatel-approval-form">
                    <input aria-label="Poznámka k rozhodnutí" value={deciding.note} onChange={(e) => setDeciding((d) => ({ ...d, note: e.target.value }))}
                      placeholder={deciding.approve ? "Poznámka (nepovinná)" : "Důvod zamítnutí (povinný)"} className="border border-slate-300 rounded-md px-2 py-1 text-sm flex-1 min-w-48" />
                    {!deciding.approve && deciding.emergency && (
                      <label className="text-xs text-slate-600 flex items-center gap-1">Náprava do
                        <input type="date" aria-label="Termín nápravy" value={deciding.due} onChange={(e) => setDeciding((d) => ({ ...d, due: e.target.value }))}
                          className="border border-slate-300 rounded-md px-2 py-1 text-sm" /></label>
                    )}
                    <button type="submit" disabled={deciding.busy} className="text-xs bg-slate-800 text-white px-3 py-1.5 rounded-md disabled:opacity-50">
                      {deciding.approve ? "Potvrdit schválení" : "Potvrdit zamítnutí"}</button>
                    <button type="button" onClick={() => setDeciding(null)} className="text-xs text-slate-500">Zpět</button>
                    {deciding.error && <span className="text-xs text-red-700 w-full">{deciding.error}</span>}
                  </form>
                )}
              </div>
            ))}</div>}
        {approvals.some((a) => a.emergency && a.status === "EMERGENCY") && (
          <div className="px-4 pb-2.5 text-xs text-red-700">Odmítnutí nouzového postupu krok nevrací – dokument zůstává platný, dostane označení „Zamítnuto jednatelem – vyžaduje nápravu“ a vznikne úkol nápravy s termínem.</div>
        )}
      </section>

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden" data-testid="konatel-remedies">
        <div className="px-4 py-2.5 border-b border-slate-100 font-semibold text-sm">Nápravy po zamítnutém nouzovém postupu</div>
        {remedies.length === 0
          ? <div className="px-4 py-3 text-sm text-slate-400">Žádná otevřená náprava.</div>
          : <div className="divide-y divide-slate-100">{remedies.map((t) => {
              const overdue = t.due_date < new Date().toISOString().slice(0, 10);
              return (
                <div key={t.id} className={"px-4 py-2 text-sm " + (overdue ? "bg-red-50" : "")} data-testid="konatel-remedy-row">
                  <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                    <div className="flex-1 min-w-60">
                      <div className="font-medium">{t.title}{t.employee_id ? ` – ${employeeNames[t.employee_id] || t.employee_id}` : ""}</div>
                      <div className="text-slate-600">Důvod zamítnutí: {t.rejection_reason}</div>
                      <div className={"text-xs " + (overdue ? "text-red-700 font-semibold" : "text-slate-500")}>Termín: {t.due_date.split("-").reverse().join(".")}{overdue ? " – po termínu" : ""}</div>
                    </div>
                    <button className="text-xs bg-teal-700 hover:bg-teal-800 text-white px-2.5 py-1 rounded-md shrink-0"
                      onClick={() => setClosing({ id: t.id, resolution: "", busy: false, error: "" })}>Uzavřít nápravu</button>
                  </div>
                  {closing?.id === t.id && (
                    <form onSubmit={closeRemedy} className="mt-2 flex flex-wrap items-center gap-2" data-testid="konatel-remedy-form">
                      <input aria-label="Popis nápravy" value={closing.resolution} onChange={(e) => setClosing((c) => ({ ...c, resolution: e.target.value }))}
                        placeholder="Jak byla náprava provedena (povinné)" className="border border-slate-300 rounded-md px-2 py-1 text-sm flex-1 min-w-48" />
                      <button type="submit" disabled={closing.busy} className="text-xs bg-slate-800 text-white px-3 py-1.5 rounded-md disabled:opacity-50">Uzavřít</button>
                      <button type="button" onClick={() => setClosing(null)} className="text-xs text-slate-500">Zpět</button>
                      {closing.error && <span className="text-xs text-red-700 w-full">{closing.error}</span>}
                    </form>
                  )}
                </div>
              );
            })}</div>}
      </section>

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100 font-semibold text-sm">Čeká na schválení</div>
        {pending.length === 0
          ? <div className="px-4 py-3 text-sm text-slate-400">Nic nečeká.</div>
          : <div className="divide-y divide-slate-100">{pending.map((n) => (
              <NotificationRow key={n.id} n={n} names={names}
                action={<button className="text-xs text-slate-500 hover:underline shrink-0" onClick={() => resolve(n.id)}>Vyřízeno</button>} />
            ))}</div>}
      </section>

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100 font-semibold text-sm flex items-center justify-between">
          <span>Nové události ({unread.length})</span>
          {unread.length > 0 && (
            <button className="text-xs font-normal text-slate-600 hover:underline flex items-center gap-1" onClick={() => markRead(unread.map((n) => n.id))}>
              <CheckCircle2 size={13} /> Vše přečteno
            </button>
          )}
        </div>
        {unread.length === 0
          ? <div className="px-4 py-3 text-sm text-slate-400">Žádné nové události.</div>
          : <div className="divide-y divide-slate-100 max-h-[28rem] overflow-y-auto">{unread.map((n) => (
              <NotificationRow key={n.id} n={n} names={names}
                action={<button className="text-xs text-slate-500 hover:underline shrink-0" onClick={() => markRead([n.id])}>Přečteno</button>} />
            ))}</div>}
      </section>

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100 font-semibold text-sm">Týdenní souhrn (posledních 7 dní)</div>
        {events.length === 0
          ? <div className="px-4 py-3 text-sm text-slate-400">Za posledních 7 dní žádné události.</div>
          : <ul className="px-4 py-2 text-sm grid sm:grid-cols-2 gap-x-6">{events.map(([k, v]) => (
              <li key={k} className="flex justify-between py-0.5"><span className="text-slate-600">{EVENT_LABELS[k] || k}</span><span className="font-medium">{v}</span></li>
            ))}</ul>}
        <div className="px-4 pb-2.5 text-xs text-slate-400">Zasílání souhrnu e-mailem se zapne až po výběru poskytovatele e-mailů.</div>
      </section>

      <RetentionDue />

      <Legislativa />

      <LegalParameters canEdit />

      <RetentionRules canEdit />

      <Processors />

      <section className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <div className="px-4 py-2.5 border-b border-slate-100 font-semibold text-sm">Kdo má přístup do Personalistiky</div>
        <div className="px-4 py-1.5 text-xs text-slate-500 border-b border-slate-100">Účty jsou osobní – jeden e-mail patří jedné osobě, sdílené účty nejsou dovolené. Přihlášení na více zařízeních současně může znamenat sdílený účet.</div>
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 text-left">
            <tr><th className="px-4 py-1.5">Uživatel</th><th className="px-4 py-1.5">Profil</th><th className="px-4 py-1.5">Platnost</th><th className="px-4 py-1.5">Naposledy změnil</th><th className="px-4 py-1.5">Dvoufázové ověření</th><th className="px-4 py-1.5">Přihlášení</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {access.map((a) => {
              const expired = (a.valid_until && a.valid_until < today) || (a.valid_from && a.valid_from > today);
              const m = mfa[String(a.user_email).toLowerCase()];
              const canReset = MFA_RESETTABLE.includes(a.profile) && m?.mfa_active;
              const sec = security[String(a.user_email).toLowerCase()];
              const canOffboard = a.profile !== "KONATEL" && sec?.user_id && !sec.banned_until;
              const canEndHr = canOffboard && !expired;
              return (
                <React.Fragment key={a.id}>
                <tr className={expired ? "text-slate-400" : ""} data-testid="konatel-access-row">
                  <td className="px-4 py-1.5">{names[a.user_id] || a.user_email}</td>
                  <td className="px-4 py-1.5">{PROFILE_LABELS[a.profile] || a.profile}</td>
                  <td className="px-4 py-1.5">{a.valid_from || a.valid_until ? `${fmtDate(a.valid_from)} – ${fmtDate(a.valid_until)}` : "bez omezení"}{expired ? " (neplatí)" : ""}</td>
                  <td className="px-4 py-1.5">{fmtDateTime(a.granted_at)}{a.granted_by ? ` · ${names[a.granted_by] || "uživatel"}` : ""}</td>
                  <td className="px-4 py-1.5" data-testid="konatel-mfa-cell">
                    {m?.mfa_active ? `aktivní · záložních kódů ${m.recovery_left}` : "neregistrováno"}
                    {canReset && (
                      <button type="button" onClick={() => setResetting({ email: a.user_email, reason: "", busy: false, error: "" })}
                        className="ml-2 text-xs text-red-700 hover:text-red-900 underline">Zrušit ověření</button>
                    )}
                  </td>
                  <td className="px-4 py-1.5 text-xs" data-testid="konatel-login-cell">
                    {sec?.banned_until ? <span className="text-red-700">účet zablokován</span>
                      : <>{sec?.active_sessions ? `aktivní relace: ${sec.active_sessions}` : "nepřihlášen"}
                        {sec?.active_sessions > 1 && <span className="ml-1 text-amber-700 font-medium" data-testid="konatel-multi-device">· více zařízení současně</span>}</>}
                    {sec?.failed_7d > 0 && <div className="text-red-700">neúspěšná přihlášení (7 dní): {sec.failed_7d}, naposledy {fmtDateTime(sec.last_failed_at)}</div>}
                    {canOffboard && (
                      <button type="button" onClick={() => setOffboarding({ email: a.user_email, mode: "ACCOUNT", reason: "", busy: false, error: "" })}
                        className="block text-red-700 hover:text-red-900 underline mt-0.5">Zablokovat účet – odchod z firmy</button>
                    )}
                    {canEndHr && (
                      <button type="button" onClick={() => setOffboarding({ email: a.user_email, mode: "HR", reason: "", busy: false, error: "" })}
                        className="block text-slate-600 hover:text-slate-900 underline mt-0.5">Ukončit přístup do HR</button>
                    )}
                  </td>
                </tr>
                {offboarding?.email === a.user_email && (
                  <tr><td colSpan={6} className="px-4 py-2 bg-red-50">
                    <form onSubmit={offboard} className="flex flex-wrap items-center gap-2 text-sm" data-testid="konatel-offboard-form">
                      <span>{offboarding.mode === "HR"
                        ? `Ukončit přístup do HR (${a.user_email}): přístup do Personalistiky skončí, účet v ERP zůstává.`
                        : `Zablokovat účet (${a.user_email}): přístup do HR skončí, všechna přihlášení se zruší a účet se zablokuje v celém ERP. Odblokuje jen IT.`}</span>
                      <input aria-label="Důvod ukončení přístupu" value={offboarding.reason} onChange={(e) => setOffboarding((o) => ({ ...o, reason: e.target.value }))}
                        placeholder="Důvod (např. skončení spolupráce)" className="border border-slate-300 rounded-md px-2 py-1 flex-1 min-w-48" />
                      <button type="submit" disabled={offboarding.busy || offboarding.reason.trim().length < 5} className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-md">{offboarding.mode === "HR" ? "Ukončit přístup do HR" : "Zablokovat účet"}</button>
                      <button type="button" onClick={() => setOffboarding(null)} className="text-xs text-slate-500">Zpět</button>
                      {offboarding.error && <span className="w-full text-red-700 text-xs">{offboarding.error}</span>}
                    </form>
                  </td></tr>
                )}
                {resetting?.email === a.user_email && (
                  <tr><td colSpan={6} className="px-4 py-2 bg-red-50">
                    <form onSubmit={resetMfa} className="flex flex-wrap items-center gap-2 text-sm" data-testid="konatel-mfa-reset-form">
                      <span>Zrušit dvoufázové ověření ({a.user_email}) – po přihlášení si zaregistruje novou aplikaci.</span>
                      <input aria-label="Důvod zrušení ověření" value={resetting.reason} onChange={(e) => setResetting((r) => ({ ...r, reason: e.target.value }))}
                        placeholder="Důvod (např. ztracený telefon)" className="border border-slate-300 rounded-md px-2 py-1 flex-1 min-w-48" />
                      <button type="submit" disabled={resetting.busy || !resetting.reason.trim()} className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-md">Zrušit ověření</button>
                      <button type="button" onClick={() => setResetting(null)} className="text-xs text-slate-500">Zpět</button>
                      {resetting.error && <span className="w-full text-red-700 text-xs">{resetting.error}</span>}
                    </form>
                  </td></tr>
                )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
