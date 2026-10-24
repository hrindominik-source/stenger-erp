// Prehlad pre jednatela (balik A auditu, docs/audit/03): co caka na
// schvalenie, nove rizikove udalosti (hr_notifications plnene triggrami v DB),
// lehoty a kto ma aky pristup. Len HR_ADMIN - DB inym nic nevrati.
import React, { useState, useEffect, useCallback } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { supabase } from "../supabaseClient.js";

export const EVENT_LABELS = {
  DOC_SIGNED: "Podepsané smlouvy a úkony",
  DOC_VOIDED: "Zneplatněné dokumenty",
  WAGE_CHANGED: "Změny mzdy",
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
const PROFILE_LABELS = { KONATEL: "Jednatel", PERSONALISTA: "Personalista", UCTOVNIK_EXT: "Externí účetní", VLASTNI: "Vlastní nastavení" };

const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const fmtDate = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join(".") : "—");

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

  const load = useCallback(async () => {
    const [sumRes, pendRes, unreadRes, accRes, profRes] = await Promise.all([
      supabase.rpc("hr_konatel_summary", { p_days: 7 }),
      supabase.from("hr_notifications").select("*").eq("kind", "KE_SCHVALENI").is("resolved_at", null).order("created_at", { ascending: false }),
      supabase.from("hr_notifications").select("*").eq("kind", "NA_VEDOMI").is("read_at", null).order("created_at", { ascending: false }).limit(200),
      supabase.from("hr_permissions").select("id, user_email, user_id, profile, valid_from, valid_until, granted_by, granted_at").order("user_email"),
      supabase.from("profiles").select("id, full_name"),
    ]);
    const err = sumRes.error || pendRes.error || unreadRes.error || accRes.error;
    if (err) { setError("Nepodařilo se načíst přehled."); setLoading(false); return; }
    setSummary(sumRes.data);
    setPending(pendRes.data || []);
    setUnread(unreadRes.data || []);
    setAccess(accRes.data || []);
    setNames(Object.fromEntries((profRes.data || []).map((p) => [p.id, p.full_name])));
    setError("");
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

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

      <section className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <div className="px-4 py-2.5 border-b border-slate-100 font-semibold text-sm">Kdo má přístup do Personalistiky</div>
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 text-left">
            <tr><th className="px-4 py-1.5">Uživatel</th><th className="px-4 py-1.5">Profil</th><th className="px-4 py-1.5">Platnost</th><th className="px-4 py-1.5">Naposledy změnil</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {access.map((a) => {
              const expired = (a.valid_until && a.valid_until < today) || (a.valid_from && a.valid_from > today);
              return (
                <tr key={a.id} className={expired ? "text-slate-400" : ""} data-testid="konatel-access-row">
                  <td className="px-4 py-1.5">{names[a.user_id] || a.user_email}</td>
                  <td className="px-4 py-1.5">{PROFILE_LABELS[a.profile] || a.profile}</td>
                  <td className="px-4 py-1.5">{a.valid_from || a.valid_until ? `${fmtDate(a.valid_from)} – ${fmtDate(a.valid_until)}` : "bez omezení"}{expired ? " (neplatí)" : ""}</td>
                  <td className="px-4 py-1.5">{fmtDateTime(a.granted_at)}{a.granted_by ? ` · ${names[a.granted_by] || "uživatel"}` : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
