import React, { useState, useEffect, useCallback } from "react";
import { Loader2, AlertCircle, Users2, UserPlus, ArrowLeft, ShieldAlert, Settings, LayoutDashboard, FileText, Pencil, CheckCircle2, Briefcase, Plus, Upload, Download, Stamp, HeartPulse, History } from "lucide-react";
import { supabase } from "../supabaseClient.js";
import { uid, skDateStrFromIso } from "../lib/utils.js";
import { computeFixedTermStatus, canProposeExtension, FIXED_TERM_RULES, sortContractEventsChronologically, shouldMarkEmployeeInactive } from "../lib/hrContractRules.js";
import { computeMedicalStatus, MEDICAL_STATUS, MEDICAL_STATUS_LABEL, DEFAULT_EXPIRING_THRESHOLD_DAYS } from "../lib/hrMedicalStatus.js";
import { computeHrWarnings } from "../lib/hrWarnings.js";
import { fillDocxTemplate, extractTemplateKeys, validateTemplateKeysAgainstAllowlist, validateRequiredKeys } from "../lib/hr/docxTemplate.js";
import { KNOWN_TEMPLATE_KEYS, TEMPLATE_REQUIRED_KEYS, buildDocumentData } from "../lib/hr/docxMapping.js";
import { convertFilledDocxToPdf } from "../lib/hr/docxToPdf.js";
import { extractJmhzFields, detectJmhzVersionCandidates, knownJmhzVersions } from "../lib/hr/jmhzPdf.js";
import { buildComparisonRows } from "../lib/hr/jmhzImport.js";
import { sha256Hex, buildSignedScanPath } from "../lib/hr/documentHash.js";

const HR_DOKUMENTY_BUCKET = "hr-dokumenty";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Popisky pre doc_type - vratane 3 typov naviazanych na skutocne dodane vzory
// (docxMapping.js TEMPLATE_REQUIRED_KEYS) aj tych, pre ktore vzor este
// nemame (napr. pracovni_smlouva - user ho dodá neskôr, viz schema.sql 45.10).
const DOC_TYPE_LABELS = {
  platovy_vymer: "Platový výměr",
  hi001_naplen_prace_delnice: "HI-001 – Náplň práce dělnice",
  vstupni_skoleni: "Vstupní školení",
  pracovni_smlouva: "Pracovní smlouva",
  mzdovy_vymer: "Mzdový výměr (obecný)",
  popis_pracovniho_mista: "Popis pracovního místa (obecný)",
  dodatek: "Dodatek",
  dohoda_o_skonceni: "Dohoda o skončení",
  vypoved_zamestnance: "Výpověď zaměstnance",
  vypoved_zamestnavatele: "Výpověď zaměstnavatele",
  zruseni_ve_zkusebni_dobe: "Zrušení ve zkušební době",
  other: "Jiné",
};
const DOC_TYPE_OPTIONS = Object.keys(DOC_TYPE_LABELS).map((v) => ({ value: v, label: DOC_TYPE_LABELS[v] }));

const HR_DOCUMENT_STATUS_LABEL = {
  DRAFT: "Koncept", READY_FOR_REVIEW: "Ke kontrole", APPROVED: "Schváleno",
  READY_FOR_SIGNATURE: "K podpisu", SIGNED: "Podepsáno", ARCHIVED: "Archivováno",
};
const HR_DOCUMENT_STATUS_ORDER = ["DRAFT", "READY_FOR_REVIEW", "APPROVED", "READY_FOR_SIGNATURE", "SIGNED", "ARCHIVED"];


/* =========================================================================
   Personalistika - trvaly personalny spis zamestnancov.
   Vsetky data su v realnych relacnych tabulkach (nie jsonb blob ako inde v
   appke) - viz supabase/schema.sql cast 43 a .claude/plans/cryptic-munching-quill.md.
   Kazda obrazovka si nacitava len to, co potrebuje (na rozdiel od
   KvalitaView, ktora vsetko poll-uje naraz - tu su data relacne a rastu
   s poctom zamestnancov, preto per-obrazovka fetch).
   ========================================================================= */

const HR_PERMISSION_OPTIONS = [
  { value: "HR_VIEW_BASIC", label: "Zobrazit základní údaje" },
  { value: "HR_VIEW_SENSITIVE", label: "Zobrazit citlivé údaje (rodné číslo, účet...)" },
  { value: "HR_VIEW_PAYROLL", label: "Zobrazit mzdové/rodinné podklady (daně, srážky...)" },
  { value: "HR_VIEW_MEDICAL_ADMIN", label: "Zobrazit evidenci lékařských prohlídek" },
  { value: "HR_EDIT", label: "Upravovat záznamy" },
  { value: "HR_DOCUMENT_GENERATE", label: "Generovat dokumenty" },
  { value: "HR_DOCUMENT_APPROVE", label: "Schvalovat dokumenty/šablony" },
  { value: "HR_DOCUMENT_SIGN", label: "Zaznamenávat podpisy" },
  { value: "HR_AUDIT_VIEW", label: "Zobrazit audit log" },
  { value: "HR_ADMIN", label: "Administrátor (má vše)" },
];

function hasPerm(permissions, p) {
  return permissions.includes(p) || permissions.includes("HR_ADMIN");
}

function fmtDate(iso) {
  return iso ? skDateStrFromIso(iso) : "";
}
// Zkusebna doba podla ceskej legislativy - 4 mesiace od nastupu (zadal uzivatel,
// automaticky sa dopocitava pri zadani data nastupu, rucne prepisatelne).
const PROBATION_MONTHS = 4;
function addMonthsIso(iso, months) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(y, m - 1, d);
  dt.setMonth(dt.getMonth() + months);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
function daysUntilIso(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}
function fullName(e) {
  return [e.title, e.first_name, e.last_name].filter(Boolean).join(" ");
}

const HR_SUB_TABS = [
  { key: "dashboard", label: "Přehled", icon: LayoutDashboard },
  { key: "zamestnanci", label: "Zaměstnanci", icon: Users2 },
  { key: "byvali", label: "Bývalí zaměstnanci", icon: Users2 },
  { key: "nastupy", label: "Nástupy", icon: UserPlus, editOnly: true },
  { key: "pozice", label: "Pozice", icon: Briefcase },
  { key: "sablony", label: "Šablony dokumentů", icon: FileText },
  { key: "nastaveni", label: "Nastavení", icon: Settings, adminOnly: true },
];

function HrSubNav({ tab, onChange, permissions }) {
  return (
    <div className="flex flex-wrap gap-1.5 bg-white border border-slate-200 rounded-lg p-1.5 mb-4">
      {HR_SUB_TABS.filter((t) => (!t.adminOnly || hasPerm(permissions, "HR_ADMIN")) && (!t.editOnly || hasPerm(permissions, "HR_EDIT"))).map((t) => {
        const Icon = t.icon;
        const active = tab === t.key;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium " +
              (active ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100")
            }
          >
            <Icon size={15} /> {t.label}
          </button>
        );
      })}
    </div>
  );
}

export default function PersonalistikaModule() {
  const [permissions, setPermissions] = useState(null);
  const [permError, setPermError] = useState("");
  const [tab, setTab] = useState("dashboard");
  const [openEmployeeId, setOpenEmployeeId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("hr_get_permissions");
      if (cancelled) return;
      if (error) { setPermError("Nepodařilo se načíst oprávnění."); setPermissions([]); return; }
      setPermissions(data || []);
    })();
    return () => { cancelled = true; };
  }, []);

  function changeTab(next) {
    setTab(next);
    setOpenEmployeeId(null);
  }

  if (permissions === null) {
    return <div className="text-center text-slate-400 py-10"><Loader2 className="animate-spin mx-auto mb-2" size={24} /> Načítám oprávnění...</div>;
  }
  if (permError) {
    return <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={16} /> {permError}</div>;
  }
  if (!hasPerm(permissions, "HR_VIEW_BASIC")) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
        <ShieldAlert className="mx-auto mb-3 text-slate-300" size={32} />
        <div className="text-slate-600 text-sm">Nemáte oprávnění zobrazit personalistiku.</div>
        <div className="text-slate-400 text-xs mt-1">Požádejte administrátora HR o přidělení přístupu.</div>
      </div>
    );
  }

  return (
    <div>
      <HrSubNav tab={tab} onChange={changeTab} permissions={permissions} />
      {tab === "dashboard" && <DashboardTab permissions={permissions} onOpenEmployee={(id) => { setOpenEmployeeId(id); setTab("zamestnanci"); }} />}
      {tab === "zamestnanci" && (
        openEmployeeId
          ? <EmployeeDetail id={openEmployeeId} permissions={permissions} onBack={() => setOpenEmployeeId(null)} />
          : <EmployeesListTab mode="active" permissions={permissions} onOpen={setOpenEmployeeId} />
      )}
      {tab === "byvali" && (
        openEmployeeId
          ? <EmployeeDetail id={openEmployeeId} permissions={permissions} onBack={() => setOpenEmployeeId(null)} />
          : <EmployeesListTab mode="former" permissions={permissions} onOpen={setOpenEmployeeId} />
      )}
      {tab === "nastupy" && hasPerm(permissions, "HR_EDIT") && <OnboardingReviewTab permissions={permissions} onOpenEmployee={(id) => { setOpenEmployeeId(id); setTab("zamestnanci"); }} />}
      {tab === "pozice" && <PositionsTab permissions={permissions} />}
      {tab === "sablony" && <TemplatesTab permissions={permissions} />}
      {tab === "nastaveni" && hasPerm(permissions, "HR_ADMIN") && <SettingsTab />}
    </div>
  );
}

/* ---------------- Přehled (Dashboard) ---------------- */

function DashboardTab({ permissions, onOpenEmployee }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [employees, setEmployees] = useState([]);
  const [employments, setEmployments] = useState([]);
  const [positions, setPositions] = useState([]);
  const [contractEvents, setContractEvents] = useState([]);
  const [medicalExams, setMedicalExams] = useState([]);
  const [onboardingPendingCount, setOnboardingPendingCount] = useState(0);
  const canMedical = hasPerm(permissions, "HR_VIEW_MEDICAL_ADMIN");
  const canReviewOnboarding = hasPerm(permissions, "HR_EDIT");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [empRes, empmRes, posRes] = await Promise.all([
        supabase.from("employees").select("id, first_name, last_name, title, active").eq("active", true),
        supabase.from("employment_relationships").select("id, employee_id, status, fixed_term_end_date, employment_type, start_date, workplace, weekly_hours, position_id").in("status", ["ACTIVE", "PLANNED", "NOTICE_PERIOD"]),
        supabase.from("positions").select("id, code, name"),
      ]);
      if (cancelled) return;
      if (empRes.error || empmRes.error) { setError("Nepodařilo se načíst přehled."); setLoading(false); return; }
      const emps = empRes.data || [];
      const ems = empmRes.data || [];
      setEmployees(emps);
      setEmployments(ems);
      setPositions(posRes.data || []);

      const fetches2 = [];
      if (ems.length > 0) fetches2.push(supabase.from("employment_contract_events").select("id, employment_id, event_type").in("employment_id", ems.map((e) => e.id)));
      else fetches2.push(Promise.resolve({ data: [] }));
      if (canMedical) fetches2.push(supabase.from("medical_examinations").select("id, employee_id, exam_type, exam_date, valid_until").order("exam_date", { ascending: false }));
      else fetches2.push(Promise.resolve({ data: [] }));
      if (canReviewOnboarding) fetches2.push(supabase.from("onboarding_sessions").select("id", { count: "exact", head: true }).eq("status", "SUBMITTED"));
      else fetches2.push(Promise.resolve({ count: 0 }));
      const [evRes, medRes, onbRes] = await Promise.all(fetches2);
      if (cancelled) return;
      setContractEvents(evRes.data || []);
      setMedicalExams(medRes.data || []);
      setOnboardingPendingCount(onbRes.count || 0);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [canMedical, canReviewOnboarding]);

  if (loading) return <div className="text-center text-slate-400 py-10"><Loader2 className="animate-spin mx-auto mb-2" size={24} /> Načítám...</div>;
  if (error) return <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md">{error}</div>;

  const noticePeriod = employments.filter((e) => e.status === "NOTICE_PERIOD").length;
  const ending30 = employments.filter((e) => { const d = daysUntilIso(e.fixed_term_end_date); return d !== null && d >= 0 && d <= 30; });
  const ending60 = employments.filter((e) => { const d = daysUntilIso(e.fixed_term_end_date); return d !== null && d >= 0 && d <= 60; });
  const ending90 = employments.filter((e) => { const d = daysUntilIso(e.fixed_term_end_date); return d !== null && d >= 0 && d <= 90; });
  const medExpiring90 = medicalExams.filter((m) => { const d = daysUntilIso(m.valid_until); return d !== null && d <= 90; });
  const medExpired = medExpiring90.filter((m) => daysUntilIso(m.valid_until) < 0);

  // najnovsia (najdulezitejsia) prehlidka na zamestnanca, pre warnings aj tabulku
  const latestExamByEmployee = new Map();
  for (const m of medicalExams) {
    if (!latestExamByEmployee.has(m.employee_id)) latestExamByEmployee.set(m.employee_id, m);
  }
  const warnings = computeHrWarnings({ employments, medicalExams: [...latestExamByEmployee.values()], employees });

  const positionLabel = (positionId) => { const p = positions.find((x) => x.id === positionId); return p ? (p.code ? `${p.code} – ${p.name}` : p.name) : "—"; };
  const extensionsCountFor = (employmentId) => contractEvents.filter((e) => e.employment_id === employmentId && e.event_type === "EXTENDED").length;

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Aktivní zaměstnanci" value={employees.length} />
        <StatCard label="Smlouvy do 30 dnů" value={ending30.length} alert={ending30.length > 0} />
        <StatCard label="Smlouvy do 60 dnů" value={ending60.length} />
        <StatCard label="Smlouvy do 90 dnů" value={ending90.length} />
        <StatCard label="Ve výpovědní lhůtě" value={noticePeriod} alert={noticePeriod > 0} />
        {canMedical && <StatCard label="Prohlídky po platnosti" value={medExpired.length} alert={medExpired.length > 0} />}
        {canMedical && <StatCard label="Prohlídky do 60 dnů" value={medExpiring90.filter((m) => daysUntilIso(m.valid_until) <= DEFAULT_EXPIRING_THRESHOLD_DAYS).length - medExpired.length} />}
        {canReviewOnboarding && <StatCard label="Probíhající nástupy" value={onboardingPendingCount} alert={onboardingPendingCount > 0} />}
      </div>

      {warnings.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden mb-4">
          <div className="px-4 py-2.5 border-b border-slate-100 font-semibold text-sm">Upozornění</div>
          <div className="divide-y divide-slate-100">
            {warnings
              .slice()
              .sort((a, b) => (a.level === b.level ? 0 : a.level === "red" ? -1 : 1))
              .map((w, i) => (
                <div key={i} className="px-4 py-2 text-sm flex items-center gap-2 cursor-pointer hover:bg-slate-50" onClick={() => onOpenEmployee(w.employeeId)}>
                  <span>{w.level === "red" ? "🔴" : "🟠"}</span>
                  <span className="font-medium">{w.employeeName || "?"}</span>
                  <span className="text-slate-500">— {w.message}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <div className="px-4 py-2.5 border-b border-slate-100 font-semibold text-sm">Aktivní zaměstnanci</div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2">Zaměstnanec</th>
              <th className="text-left px-4 py-2">Pozice</th>
              <th className="text-left px-4 py-2">Nástup</th>
              <th className="text-left px-4 py-2">Typ</th>
              <th className="text-left px-4 py-2">Konec smlouvy</th>
              <th className="text-left px-4 py-2">Prodloužení</th>
              <th className="text-left px-4 py-2">Lékařská prohlídka</th>
              <th className="text-left px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => {
              const em = employments.find((x) => x.employee_id === e.id);
              const exam = latestExamByEmployee.get(e.id);
              const medStatus = canMedical && exam ? computeMedicalStatus(exam.valid_until) : null;
              return (
                <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => onOpenEmployee(e.id)}>
                  <td className="px-4 py-2 font-medium whitespace-nowrap">{fullName(e)}</td>
                  <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{em ? positionLabel(em.position_id) : "—"}</td>
                  <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{em ? fmtDate(em.start_date) : "—"}</td>
                  <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{em?.employment_type === "doba_urcita" ? "Doba určitá" : em?.employment_type === "doba_neurcita" ? "Doba neurčitá" : "—"}</td>
                  <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{em?.fixed_term_end_date ? fmtDate(em.fixed_term_end_date) : "—"}</td>
                  <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{em ? extensionsCountFor(em.id) : "—"}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{canMedical ? (exam ? <MedicalStatusBadge status={medStatus} /> : "—") : "—"}</td>
                  <td className="px-4 py-2 whitespace-nowrap"><span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">{em ? EMPLOYMENT_STATUS_LABEL[em.status] : "—"}</span></td>
                </tr>
              );
            })}
            {employees.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Zatím žádní aktivní zaměstnanci.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value, alert }) {
  return (
    <div className={"bg-white rounded-lg px-4 py-3 border " + (alert && value > 0 ? "border-red-400" : "border-slate-200")}>
      <div className={"text-2xl font-bold " + (alert && value > 0 ? "text-red-600" : "text-slate-700")}>{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

/* ---------------- Zaměstnanci / Bývalí zaměstnanci ---------------- */

const EMPLOYMENT_STATUS_LABEL = {
  DRAFT: "Koncept", PLANNED: "Naplánováno", ACTIVE: "Aktivní", NOTICE_PERIOD: "Výpovědní lhůta", ENDED: "Ukončeno",
};

const EMPLOYEE_LIST_FILTERS = [
  { value: "active", label: "Aktivní" },
  { value: "former", label: "Bývalí" },
  { value: "all", label: "Všichni" },
];

function EmployeesListTab({ mode, permissions, onOpen }) {
  const [filter, setFilter] = useState(mode);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [employees, setEmployees] = useState([]);
  const [employmentsByEmployee, setEmploymentsByEmployee] = useState(new Map());
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");

  // Klik na "Zaměstnanci" / "Bývalí zaměstnanci" v hlavní navigaci nastavuje
  // vychozi filtr, ale "Všichni" nie je jina databaze - len tretia hodnota
  // tohto istého filtru (viz .claude/plans - "Bývalí není jiná databáze").
  useEffect(() => { setFilter(mode); }, [mode]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    let query = supabase.from("employees").select("*").order("last_name");
    if (filter !== "all") query = query.eq("active", filter === "active");
    const empRes = await query;
    if (empRes.error) { setError("Nepodařilo se načíst zaměstnance."); setLoading(false); return; }
    const emps = empRes.data || [];
    setEmployees(emps);
    if (emps.length > 0) {
      const empmRes = await supabase.from("employment_relationships").select("*").in("employee_id", emps.map((e) => e.id)).order("start_date", { ascending: false });
      if (!empmRes.error) {
        const map = new Map();
        (empmRes.data || []).forEach((em) => {
          if (!map.has(em.employee_id)) map.set(em.employee_id, em);
        });
        setEmploymentsByEmployee(map);
      }
    } else {
      setEmploymentsByEmployee(new Map());
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const filtered = employees.filter((e) => !search.trim() || fullName(e).toLowerCase().includes(search.trim().toLowerCase()));
  const emptyLabel = filter === "active" ? "Zatím žádní zaměstnanci." : filter === "former" ? "Žádní bývalí zaměstnanci." : "Žádní zaměstnanci.";

  if (creating) {
    return <EmployeeCreateForm permissions={permissions} onCancel={() => setCreating(false)} onCreated={(id) => { setCreating(false); load(); onOpen(id); }} />;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-xl font-semibold">Zaměstnanci</h1>
        {filter === "active" && hasPerm(permissions, "HR_EDIT") && (
          <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md">
            <UserPlus size={16} /> Nový zaměstnanec
          </button>
        )}
      </div>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="inline-flex bg-slate-100 rounded-md p-1 text-sm">
          {EMPLOYEE_LIST_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={"px-3 py-1.5 rounded-md font-medium " + (filter === f.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Hledat jméno..."
          className="flex-1 min-w-[200px] sm:max-w-xs border border-slate-200 rounded-md px-3 py-2 text-sm"
        />
      </div>
      {loading ? (
        <div className="text-center text-slate-400 py-10"><Loader2 className="animate-spin mx-auto mb-2" size={24} /> Načítám...</div>
      ) : error ? (
        <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md">{error}</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2">Jméno</th>
                <th className="text-left px-4 py-2">Nástup</th>
                <th className="text-left px-4 py-2">Typ smlouvy</th>
                <th className="text-left px-4 py-2">Konec smlouvy</th>
                <th className="text-left px-4 py-2">Stav</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const em = employmentsByEmployee.get(e.id);
                return (
                  <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => onOpen(e.id)}>
                    <td className="px-4 py-2 font-medium whitespace-nowrap">{fullName(e)}</td>
                    <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{em ? fmtDate(em.start_date) : "—"}</td>
                    <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{em?.employment_type === "doba_urcita" ? "Doba určitá" : em?.employment_type === "doba_neurcita" ? "Doba neurčitá" : "—"}</td>
                    <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{em?.fixed_term_end_date ? fmtDate(em.fixed_term_end_date) : "—"}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">{em ? EMPLOYMENT_STATUS_LABEL[em.status] : "—"}</span>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">{emptyLabel}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------- Nástupy (kontrola tabletových onboarding dotazníků) ---------------- */
/* Presne ta ista trasa ako priame zadanie: draft_data z onboarding_sessions
   sa len predvyplní do EmployeeCreateForm (rovnaky insert kod, rovnaka
   karta), HR po kontrole ulozi - nic sa nezapisuje automaticky. */

function OnboardingReviewTab({ permissions, onOpenEmployee }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sessions, setSessions] = useState([]);
  const [reviewing, setReviewing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: err } = await supabase.from("onboarding_sessions").select("*").eq("status", "SUBMITTED").order("submitted_at", { ascending: true });
    if (err) { setError("Nepodařilo se načíst čekající nástupy."); setLoading(false); return; }
    setSessions(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function discard(session) {
    if (!window.confirm("Zamítnout tento dotazník? Nezaloží se žádný zaměstnanec, dotazník zůstane v evidenci jako zamítnutý.")) return;
    const { error: err } = await supabase.rpc("hr_onboarding_review", { p_session_id: session.id, p_status: "DISCARDED", p_resulting_employee_id: null });
    if (err) { window.alert(err.message); return; }
    load();
  }

  if (reviewing) {
    const d = reviewing.draft_data || {};
    const initialData = {
      title: d.title || "", first_name: d.first_name || "", last_name: d.last_name || "", maiden_name: d.maiden_name || "",
      date_of_birth: d.date_of_birth || "", place_of_birth: d.place_of_birth || "", country_of_birth: d.country_of_birth || "",
      gender: d.gender || "", nationality: d.nationality || "",
      permanent_street: d.permanent_street || "", permanent_city: d.permanent_city || "", permanent_zip: d.permanent_zip || "", permanent_country: d.permanent_country || "",
      phone: d.phone || "", private_email: d.private_email || "", id_document_type: d.id_document_type || "",
      health_insurance_company: d.health_insurance_company || "", highest_education: d.highest_education || "",
      is_foreigner: !!d.is_foreigner, notes: "",
      birth_number: d.birth_number || "", id_document_number: d.id_document_number || "", bank_account: d.bank_account || "",
      start_date: d.start_date || "", employment_type: d.employment_type || "doba_neurcita", fixed_term_end_date: d.fixed_term_end_date || "",
      workplace: d.workplace || "", weekly_hours: d.weekly_hours || "40",
    };
    return (
      <EmployeeCreateForm
        permissions={permissions}
        initialData={initialData}
        positionLabelHint={d.position_label}
        onboardingSessionId={reviewing.id}
        onCancel={() => setReviewing(null)}
        onCreated={(id) => { setReviewing(null); load(); onOpenEmployee(id); }}
      />
    );
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Nástupy - čekající na kontrolu</h1>
      <p className="text-xs text-slate-400 mb-3">Dotazníky vyplněné na tabletu novým zaměstnancem - nic se nezaloží automaticky, každý vyžaduje ruční kontrolu a potvrzení.</p>
      {loading ? (
        <div className="text-center text-slate-400 py-10"><Loader2 className="animate-spin mx-auto mb-2" size={24} /> Načítám...</div>
      ) : error ? (
        <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md">{error}</div>
      ) : sessions.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
          <UserPlus className="mx-auto mb-3 text-slate-300" size={32} />
          <div className="text-slate-600 text-sm">Žádné čekající dotazníky.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => {
            const d = s.draft_data || {};
            const name = [d.title, d.first_name, d.last_name].filter(Boolean).join(" ") || "(bez jména)";
            return (
              <div key={s.id} className="bg-white border border-slate-200 rounded-lg p-4 flex justify-between items-center flex-wrap gap-2">
                <div>
                  <div className="font-medium">{name}</div>
                  <div className="text-xs text-slate-500">Odesláno: {s.submitted_at ? new Date(s.submitted_at).toLocaleString("cs-CZ") : "—"} {d.position_label ? `· ${d.position_label}` : ""}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => discard(s)} className="text-xs text-red-500 hover:text-red-700 underline underline-offset-2">Zamítnout</button>
                  <button onClick={() => setReviewing(s)} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md">
                    <CheckCircle2 size={15} /> Zkontrolovat a založit
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------- Nový zaměstnanec ---------------- */

function emptyEmployeeForm() {
  return {
    title: "", first_name: "", last_name: "", maiden_name: "",
    date_of_birth: "", place_of_birth: "", country_of_birth: "", gender: "", nationality: "",
    permanent_street: "", permanent_city: "", permanent_zip: "", permanent_country: "",
    phone: "", private_email: "", id_document_type: "", health_insurance_company: "", highest_education: "",
    is_foreigner: false, notes: "",
    birth_number: "", id_document_number: "", bank_account: "",
    // pracovni pomer
    position_id: "", start_date: "", employment_type: "doba_neurcita", fixed_term_end_date: "",
    workplace: "", weekly_hours: "40", probation_end_date: "",
  };
}

function EmployeeCreateForm({ permissions, onCancel, onCreated, initialData, positionLabelHint, onboardingSessionId }) {
  const [f, setF] = useState(() => ({ ...emptyEmployeeForm(), ...(initialData || {}) }));
  const [positions, setPositions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const canSensitive = hasPerm(permissions, "HR_VIEW_SENSITIVE");

  useEffect(() => {
    supabase.from("positions").select("*").eq("active", true).order("name").then(({ data }) => setPositions(data || []));
  }, []);

  function set(patch) { setF((prev) => ({ ...prev, ...patch })); }

  async function submit() {
    if (!f.first_name.trim() || !f.last_name.trim()) { setError("Vyplňte jméno a příjmení."); return; }
    setError("");
    setSaving(true);
    try {
      const employeeId = uid();
      const { data: userData } = await supabase.auth.getUser();
      const { error: empErr } = await supabase.from("employees").insert({
        id: employeeId,
        first_name: f.first_name.trim(),
        last_name: f.last_name.trim(),
        maiden_name: f.maiden_name.trim() || null,
        title: f.title.trim() || null,
        date_of_birth: f.date_of_birth || null,
        place_of_birth: f.place_of_birth.trim() || null,
        country_of_birth: f.country_of_birth.trim() || null,
        gender: f.gender || null,
        nationality: f.nationality.trim() || null,
        permanent_address: { ulice: f.permanent_street.trim(), mesto: f.permanent_city.trim(), psc: f.permanent_zip.trim(), stat: f.permanent_country.trim() },
        correspondence_address: {},
        phone: f.phone.trim() || null,
        private_email: f.private_email.trim() || null,
        id_document_type: f.id_document_type.trim() || null,
        health_insurance_company: f.health_insurance_company.trim() || null,
        highest_education: f.highest_education.trim() || null,
        is_foreigner: f.is_foreigner,
        notes: f.notes.trim() || null,
        active: true,
      });
      if (empErr) throw empErr;

      if (canSensitive && (f.birth_number || f.id_document_number || f.bank_account)) {
        const { error: sensErr } = await supabase.from("employee_sensitive_data").insert({
          employee_id: employeeId,
          birth_number: f.birth_number.trim() || null,
          id_document_number: f.id_document_number.trim() || null,
          bank_account: f.bank_account.trim() || null,
        });
        if (sensErr) throw sensErr;
      }

      let employmentId = null;
      if (f.start_date) {
        employmentId = uid();
        const { error: emErr } = await supabase.from("employment_relationships").insert({
          id: employmentId,
          employee_id: employeeId,
          status: "ACTIVE",
          employment_type: f.employment_type,
          start_date: f.start_date,
          fixed_term_end_date: f.employment_type === "doba_urcita" ? (f.fixed_term_end_date || null) : null,
          probation_end_date: f.probation_end_date || null,
          position_id: f.position_id || null,
          workplace: f.workplace.trim() || null,
          weekly_hours: f.weekly_hours ? Number(f.weekly_hours) : null,
          created_by: userData?.user?.id || null, updated_by: userData?.user?.id || null,
        });
        if (emErr) throw emErr;
        await supabase.from("employment_contract_events").insert({
          id: uid(), employment_id: employmentId, event_type: "CREATED", event_date: f.start_date,
          valid_from: f.start_date, valid_to: f.employment_type === "doba_urcita" ? (f.fixed_term_end_date || null) : null,
          created_by: userData?.user?.id || null,
        });
      }

      await supabase.from("employee_timeline_events").insert({
        id: uid(), employee_id: employeeId, event_date: f.start_date || new Date().toISOString().slice(0, 10),
        event_type: "EMPLOYEE_CREATED",
        title: onboardingSessionId ? "Založen personální spis (z tabletového nástupního dotazníku)" : "Založen personální spis",
        source: "MANUAL",
      });

      if (onboardingSessionId) {
        const { error: revErr } = await supabase.rpc("hr_onboarding_review", {
          p_session_id: onboardingSessionId, p_status: "REVIEWED", p_resulting_employee_id: employeeId,
        });
        if (revErr) throw revErr;
      }

      onCreated(employeeId);
    } catch (e) {
      console.error(e);
      setError(e.message || "Uložení se nezdařilo.");
    }
    setSaving(false);
  }

  return (
    <div>
      <button onClick={onCancel} className="text-sm text-slate-500 flex items-center gap-1 hover:text-slate-800 mb-3"><ArrowLeft size={14} /> Zpět</button>
      <h1 className="text-xl font-semibold mb-4">Nový zaměstnanec</h1>

      {onboardingSessionId && (
        <div className="bg-teal-50 border border-teal-200 rounded-lg px-4 py-3 mb-4 text-sm text-teal-800">
          Předvyplněno z tabletového nástupního dotazníku - zkontrolujte prosím všechny údaje před uložením.
          {positionLabelHint && <div className="mt-1">Zaměstnanec uvedl pozici: <strong>{positionLabelHint}</strong> - vyberte prosím odpovídající pozici ze seznamu níže.</div>}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
        <h2 className="font-semibold text-sm mb-3">Osobní údaje</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4">
          <TextField label="Titul" value={f.title} onChange={(v) => set({ title: v })} />
          <TextField label="Jméno *" value={f.first_name} onChange={(v) => set({ first_name: v })} />
          <TextField label="Příjmení *" value={f.last_name} onChange={(v) => set({ last_name: v })} />
          <TextField label="Rodné příjmení" value={f.maiden_name} onChange={(v) => set({ maiden_name: v })} />
          <DateFieldLocal label="Datum narození" value={f.date_of_birth} onChange={(v) => set({ date_of_birth: v })} />
          <TextField label="Místo narození" value={f.place_of_birth} onChange={(v) => set({ place_of_birth: v })} />
          <TextField label="Stát narození" value={f.country_of_birth} onChange={(v) => set({ country_of_birth: v })} />
          <SelectFieldLocal label="Pohlaví" value={f.gender} onChange={(v) => set({ gender: v })} options={[{ value: "", label: "—" }, { value: "muz", label: "Muž" }, { value: "zena", label: "Žena" }]} />
          <TextField label="Státní občanství" value={f.nationality} onChange={(v) => set({ nationality: v })} />
        </div>
        <label className="flex items-center gap-2 mt-2 text-sm text-slate-600">
          <input type="checkbox" checked={f.is_foreigner} onChange={(e) => set({ is_foreigner: e.target.checked })} /> Cizinec (mimo ČR/SR)
        </label>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
        <h2 className="font-semibold text-sm mb-3">Adresa trvalého bydliště a kontakt</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
          <TextField label="Ulice, č.p." value={f.permanent_street} onChange={(v) => set({ permanent_street: v })} />
          <TextField label="Obec, PSČ, stát" value={f.permanent_city} onChange={(v) => set({ permanent_city: v })} />
          <TextField label="Telefon" value={f.phone} onChange={(v) => set({ phone: v })} />
          <TextField label="Soukromý e-mail" value={f.private_email} onChange={(v) => set({ private_email: v })} />
          <TextField label="Typ dokladu" value={f.id_document_type} onChange={(v) => set({ id_document_type: v })} />
          <TextField label="Zdravotní pojišťovna" value={f.health_insurance_company} onChange={(v) => set({ health_insurance_company: v })} />
          <TextField label="Nejvyšší dosažené vzdělání" value={f.highest_education} onChange={(v) => set({ highest_education: v })} />
        </div>
      </div>

      {canSensitive && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
          <h2 className="font-semibold text-sm mb-1 flex items-center gap-1.5"><ShieldAlert size={15} className="text-amber-600" /> Citlivé údaje</h2>
          <p className="text-xs text-amber-700 mb-3">Viditelné jen pro uživatele s oprávněním zobrazit citlivé osobní údaje.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4">
            <TextField label="Rodné číslo" value={f.birth_number} onChange={(v) => set({ birth_number: v })} />
            <TextField label="Číslo dokladu" value={f.id_document_number} onChange={(v) => set({ id_document_number: v })} />
            <TextField label="Bankovní účet pro výplatu mzdy" value={f.bank_account} onChange={(v) => set({ bank_account: v })} />
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
        <h2 className="font-semibold text-sm mb-3">Pracovní poměr (nepovinné - lze doplnit později)</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4">
          <SelectFieldLocal label="Pozice" value={f.position_id} onChange={(v) => set({ position_id: v })} options={[{ value: "", label: "— nevybráno —" }, ...positions.map((p) => ({ value: p.id, label: p.code ? `${p.code} – ${p.name}` : p.name }))]} />
          <DateFieldLocal label="Datum nástupu" value={f.start_date} onChange={(v) => set({ start_date: v, probation_end_date: addMonthsIso(v, PROBATION_MONTHS) })} />
          <SelectFieldLocal label="Typ smlouvy" value={f.employment_type} onChange={(v) => set({ employment_type: v })} options={[{ value: "doba_neurcita", label: "Doba neurčitá" }, { value: "doba_urcita", label: "Doba určitá" }]} />
          {f.employment_type === "doba_urcita" && <DateFieldLocal label="Konec smlouvy" value={f.fixed_term_end_date} onChange={(v) => set({ fixed_term_end_date: v })} />}
          <DateFieldLocal label={`Konec zkušební doby (${PROBATION_MONTHS} měsíce)`} value={f.probation_end_date} onChange={(v) => set({ probation_end_date: v })} />
          <TextField label="Místo výkonu práce" value={f.workplace} onChange={(v) => set({ workplace: v })} />
          <TextField label="Týdenní úvazek (hodin)" value={f.weekly_hours} onChange={(v) => set({ weekly_hours: v })} />
        </div>
      </div>

      <TextAreaField label="Poznámka" value={f.notes} onChange={(v) => set({ notes: v })} />

      {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md mb-3 flex items-center gap-2"><AlertCircle size={16} /> {error}</div>}

      <div className="flex justify-end gap-2 pb-4">
        <button onClick={onCancel} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
        <button onClick={submit} disabled={saving} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} {saving ? "Ukládám..." : "Uložit zaměstnance"}
        </button>
      </div>
    </div>
  );
}

/* ---------------- Detail zaměstnance ---------------- */

const DETAIL_TABS = [
  { key: "prehled", label: "Přehled" },
  { key: "osobni", label: "Osobní údaje" },
  { key: "pomer", label: "Pracovní poměr" },
  { key: "dokumenty", label: "Dokumenty" },
  { key: "jmhz", label: "JMHZ dotazník", editOnly: true },
  { key: "lekarske", label: "Lékařské prohlídky", medicalOnly: true },
  { key: "historie", label: "Historie" },
  { key: "audit", label: "Audit", auditOnly: true },
];

function EmployeeDetail({ id, permissions, onBack }) {
  const [detailTab, setDetailTab] = useState("prehled");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [employee, setEmployee] = useState(null);
  const [sensitive, setSensitive] = useState(null);
  const [payroll, setPayroll] = useState(null);
  const [employments, setEmployments] = useState([]);
  const [contractEvents, setContractEvents] = useState([]);
  const [positions, setPositions] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [medicalExams, setMedicalExams] = useState([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const canEdit = hasPerm(permissions, "HR_EDIT");
  const canSensitive = hasPerm(permissions, "HR_VIEW_SENSITIVE");
  const canPayroll = hasPerm(permissions, "HR_VIEW_PAYROLL");
  const canMedical = hasPerm(permissions, "HR_VIEW_MEDICAL_ADMIN");
  const canAudit = hasPerm(permissions, "HR_AUDIT_VIEW") || hasPerm(permissions, "HR_ADMIN");
  const canDelete = hasPerm(permissions, "HR_ADMIN");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const [empRes, empmRes, posRes, tlRes] = await Promise.all([
      supabase.from("employees").select("*").eq("id", id).single(),
      supabase.from("employment_relationships").select("*").eq("employee_id", id).order("start_date", { ascending: false }),
      supabase.from("positions").select("*").eq("active", true).order("name"),
      supabase.from("employee_timeline_events").select("*").eq("employee_id", id).order("event_date", { ascending: false }).order("created_at", { ascending: false }),
    ]);
    if (empRes.error) { setError("Nepodařilo se načíst zaměstnance."); setLoading(false); return; }
    setEmployee(empRes.data);
    const emps = empmRes.data || [];
    setEmployments(emps);
    setPositions(posRes.data || []);
    setTimeline(tlRes.data || []);
    if (emps.length > 0) {
      const { data: events } = await supabase.from("employment_contract_events").select("*").in("employment_id", emps.map((e) => e.id)).order("event_date");
      setContractEvents(events || []);
    } else {
      setContractEvents([]);
    }
    if (canSensitive) {
      const { data } = await supabase.from("employee_sensitive_data").select("*").eq("employee_id", id).maybeSingle();
      setSensitive(data || null);
    }
    if (canPayroll) {
      const { data } = await supabase.from("employee_payroll_data").select("*").eq("employee_id", id).maybeSingle();
      setPayroll(data || null);
    }
    if (canMedical) {
      const { data } = await supabase.from("medical_examinations").select("*").eq("employee_id", id).order("exam_date", { ascending: false });
      setMedicalExams(data || []);
    } else {
      setMedicalExams([]);
    }
    setLoading(false);
  }, [id, canSensitive, canPayroll, canMedical]);

  useEffect(() => { load(); }, [load]);

  async function confirmDelete() {
    setDeleting(true);
    setDeleteError("");
    const { error: err } = await supabase.rpc("hr_admin_delete_employee", { p_employee_id: id });
    if (err) { setDeleteError(err.message || "Smazání se nezdařilo."); setDeleting(false); return; }
    onBack();
  }

  if (loading) return <div className="text-center text-slate-400 py-10"><Loader2 className="animate-spin mx-auto mb-2" size={24} /> Načítám...</div>;
  if (error || !employee) return <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md">{error || "Zaměstnanec nenalezen."}</div>;

  const currentEmployment = employments.find((e) => ["ACTIVE", "NOTICE_PERIOD"].includes(e.status)) || employments[0];
  const positionLabel = (positionId) => { const p = positions.find((x) => x.id === positionId); return p ? (p.code ? `${p.code} – ${p.name}` : p.name) : "—"; };

  return (
    <div>
      <button onClick={onBack} className="text-sm text-slate-500 flex items-center gap-1 hover:text-slate-800 mb-3"><ArrowLeft size={14} /> Zpět na seznam</button>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">{fullName(employee)}</h1>
          <div className="text-sm text-slate-500">{currentEmployment ? positionLabel(currentEmployment.position_id) : "Bez aktivního pracovního poměru"}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className={"px-2.5 py-1 rounded-full text-xs font-medium " + (employee.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500")}>
            {employee.active ? "Aktivní" : "Bývalý zaměstnanec"}
          </span>
          {canDelete && (
            <button onClick={() => setConfirmingDelete(true)} className="text-xs text-red-500 hover:text-red-700 underline underline-offset-2">
              Trvale smazat
            </button>
          )}
        </div>
      </div>

      {confirmingDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5">
            <div className="flex items-center gap-2 text-red-700 font-semibold mb-2"><AlertCircle size={18} /> Trvale smazat zaměstnance?</div>
            <p className="text-sm text-slate-600 mb-1">
              Nevratně se smaže celý personální spis <strong>{fullName(employee)}</strong> - osobní údaje, všechny pracovní poměry, historie i dokumenty. Použijte jen na opravu omylu (např. duplicitní záznam).
            </p>
            <p className="text-sm text-slate-600 mb-4">
              Pro ukončení skutečného pracovního poměru použijte místo toho "Ukončit pracovní poměr" v záložce Pracovní poměr - ta historii zachová.
            </p>
            {deleteError && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md mb-3">{deleteError}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={() => { setConfirmingDelete(false); setDeleteError(""); }} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
              <button onClick={confirmDelete} disabled={deleting} className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md">
                {deleting ? "Mažu..." : "Ano, trvale smazat"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 border-b border-slate-200 mb-4">
        {DETAIL_TABS.filter((t) => (!t.editOnly || canEdit) && (!t.medicalOnly || canMedical) && (!t.auditOnly || canAudit)).map((t) => (
          <button
            key={t.key}
            onClick={() => setDetailTab(t.key)}
            className={"px-3 py-2 text-sm font-medium border-b-2 -mb-px " + (detailTab === t.key ? "border-teal-600 text-teal-700" : "border-transparent text-slate-500 hover:text-slate-800")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {detailTab === "prehled" && (
        <PrehledDetailTab
          employee={employee} currentEmployment={currentEmployment} contractEvents={contractEvents}
          positionLabel={positionLabel} medicalExams={medicalExams} canMedical={canMedical}
          employments={employments}
        />
      )}
      {detailTab === "osobni" && <OsobniUdajeTab employee={employee} sensitive={sensitive} canEdit={canEdit} canSensitive={canSensitive} onSaved={load} />}
      {detailTab === "pomer" && (
        <PracovniPomerTab
          employeeId={id} employee={employee} employments={employments} contractEvents={contractEvents}
          positions={positions} positionLabel={positionLabel} canEdit={canEdit} canOverride={hasPerm(permissions, "HR_ADMIN")}
          onChanged={load}
        />
      )}
      {detailTab === "dokumenty" && <DokumentyTab employee={employee} sensitive={sensitive} currentEmployment={currentEmployment} permissions={permissions} />}
      {detailTab === "jmhz" && canEdit && (
        <JmhzImportTab
          employee={employee} sensitive={sensitive} payroll={payroll} currentEmployment={currentEmployment}
          canSensitive={canSensitive} canPayroll={canPayroll} canEditEmployment={canEdit}
          onImported={load}
        />
      )}
      {detailTab === "lekarske" && canMedical && (
        <MedicalExamsTab employeeId={id} medicalExams={medicalExams} canEdit={canEdit} onChanged={load} />
      )}
      {detailTab === "historie" && <HistorieTab timeline={timeline} />}
      {detailTab === "audit" && canAudit && <AuditTab employee={employee} employments={employments} contractEvents={contractEvents} medicalExams={medicalExams} positions={positions} />}
    </div>
  );
}

function PrehledDetailTab({ employee, currentEmployment, contractEvents, positionLabel, medicalExams, canMedical, employments }) {
  const endDays = currentEmployment ? daysUntilIso(currentEmployment.fixed_term_end_date) : null;
  const fixedTermStatus = currentEmployment && currentEmployment.employment_type === "doba_urcita"
    ? computeFixedTermStatus({ startDate: currentEmployment.start_date, currentEndDate: currentEmployment.fixed_term_end_date, events: contractEvents.filter((e) => e.employment_id === currentEmployment.id) })
    : null;
  const latestExam = (medicalExams || [])[0] || null;
  const medicalStatus = latestExam ? computeMedicalStatus(latestExam.valid_until) : null;
  const warnings = computeHrWarnings({
    employments: currentEmployment ? [currentEmployment] : [],
    medicalExams: latestExam ? [latestExam] : [],
    employees: [employee],
  });

  return (
    <div>
      <div className="mb-4">
        <div className="text-lg font-semibold">{fullName(employee).toUpperCase()}</div>
        <div className="text-sm text-slate-500">{currentEmployment ? positionLabel(currentEmployment.position_id) : "Bez aktivního pracovního poměru"} · {employee.active ? "AKTIVNÍ" : "BÝVALÝ ZAMĚSTNANEC"}</div>
      </div>
      {warnings.length > 0 && (
        <div className="mb-4 space-y-1.5">
          {warnings.map((w, i) => (
            <div key={i} className={"text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1.5 " + (w.level === "red" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700")}>
              {w.level === "red" ? "🔴" : "🟠"} {w.message.charAt(0).toUpperCase() + w.message.slice(1)}
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h2 className="font-semibold text-sm mb-3">Pracovní poměr</h2>
          {currentEmployment ? (
            <dl className="text-sm space-y-1.5">
              <Row label="Pozice" value={positionLabel(currentEmployment.position_id)} />
              <Row label="Nástup" value={fmtDate(currentEmployment.start_date)} />
              <Row label="Typ" value={currentEmployment.employment_type === "doba_urcita" ? "Doba určitá" : "Doba neurčitá"} />
              {currentEmployment.fixed_term_end_date && <Row label="Konec smlouvy" value={fmtDate(currentEmployment.fixed_term_end_date)} />}
              {fixedTermStatus && (
                <Row
                  label="Evidovaná prodloužení"
                  value={fixedTermStatus.requiresReview ? "Vyžaduje kontrolu" : `${fixedTermStatus.extensionsCount} (zbývá ${fixedTermStatus.remainingExtensions} z max. ${FIXED_TERM_RULES.maxExtensions})`}
                />
              )}
              <Row label="Místo výkonu práce" value={currentEmployment.workplace || "—"} />
              <Row label="Úvazek" value={currentEmployment.weekly_hours ? `${currentEmployment.weekly_hours} h/týden` : "—"} />
              <Row label="Stav" value={EMPLOYMENT_STATUS_LABEL[currentEmployment.status]} />
            </dl>
          ) : <div className="text-sm text-slate-400">Žádný pracovní poměr.</div>}
          {endDays !== null && endDays >= 0 && endDays <= 90 && (
            <div className={"mt-3 text-xs px-2.5 py-1.5 rounded-md " + (endDays <= 30 ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700")}>
              Smlouva končí za {endDays} dní ({fmtDate(currentEmployment.fixed_term_end_date)})
            </div>
          )}
        </div>
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <h2 className="font-semibold text-sm mb-3">Kontakt</h2>
            <dl className="text-sm space-y-1.5">
              <Row label="Telefon" value={employee.phone || "—"} />
              <Row label="E-mail" value={employee.private_email || "—"} />
              <Row label="Adresa" value={[employee.permanent_address?.ulice, employee.permanent_address?.mesto].filter(Boolean).join(", ") || "—"} />
            </dl>
          </div>
          {canMedical && (
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <h2 className="font-semibold text-sm mb-3 flex items-center gap-1.5"><HeartPulse size={15} /> Lékařská prohlídka</h2>
              {latestExam ? (
                <dl className="text-sm space-y-1.5">
                  <Row label="Poslední" value={fmtDate(latestExam.exam_date)} />
                  <Row label="Platnost do" value={latestExam.valid_until ? fmtDate(latestExam.valid_until) : "—"} />
                  <Row label="Stav" value={<MedicalStatusBadge status={medicalStatus} />} />
                </dl>
              ) : <div className="text-sm text-slate-400">Zatím žádná evidovaná prohlídka.</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MedicalStatusBadge({ status }) {
  const map = {
    VALID: "bg-emerald-100 text-emerald-700", EXPIRING: "bg-amber-100 text-amber-700",
    EXPIRED: "bg-red-100 text-red-700", UNKNOWN: "bg-slate-100 text-slate-500",
  };
  return <span className={"px-2 py-0.5 rounded-full text-xs font-medium " + (map[status] || map.UNKNOWN)}>{MEDICAL_STATUS_LABEL[status] || "—"}</span>;
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-900 font-medium text-right">{value}</dd>
    </div>
  );
}

function OsobniUdajeTab({ employee, sensitive, canEdit, canSensitive, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function startEdit() {
    setF({
      title: employee.title || "", first_name: employee.first_name || "", last_name: employee.last_name || "", maiden_name: employee.maiden_name || "",
      date_of_birth: employee.date_of_birth || "", place_of_birth: employee.place_of_birth || "", country_of_birth: employee.country_of_birth || "",
      gender: employee.gender || "", nationality: employee.nationality || "",
      permanent_street: employee.permanent_address?.ulice || "", permanent_city: employee.permanent_address?.mesto || "",
      phone: employee.phone || "", private_email: employee.private_email || "",
      id_document_type: employee.id_document_type || "", health_insurance_company: employee.health_insurance_company || "", highest_education: employee.highest_education || "",
      notes: employee.notes || "",
      birth_number: sensitive?.birth_number || "", id_document_number: sensitive?.id_document_number || "", bank_account: sensitive?.bank_account || "",
    });
    setError("");
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const { error: empErr } = await supabase.from("employees").update({
        title: f.title.trim() || null, first_name: f.first_name.trim(), last_name: f.last_name.trim(), maiden_name: f.maiden_name.trim() || null,
        date_of_birth: f.date_of_birth || null, place_of_birth: f.place_of_birth.trim() || null, country_of_birth: f.country_of_birth.trim() || null,
        gender: f.gender || null, nationality: f.nationality.trim() || null,
        permanent_address: { ...(employee.permanent_address || {}), ulice: f.permanent_street.trim(), mesto: f.permanent_city.trim() },
        phone: f.phone.trim() || null, private_email: f.private_email.trim() || null,
        id_document_type: f.id_document_type.trim() || null, health_insurance_company: f.health_insurance_company.trim() || null, highest_education: f.highest_education.trim() || null,
        notes: f.notes.trim() || null, updated_at: new Date().toISOString(),
      }).eq("id", employee.id);
      if (empErr) throw empErr;

      if (canSensitive) {
        const { error: sensErr } = await supabase.from("employee_sensitive_data").upsert({
          employee_id: employee.id,
          birth_number: f.birth_number.trim() || null, id_document_number: f.id_document_number.trim() || null, bank_account: f.bank_account.trim() || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "employee_id" });
        if (sensErr) throw sensErr;
      }
      setEditing(false);
      onSaved();
    } catch (e) {
      console.error(e);
      setError(e.message || "Uložení se nezdařilo.");
    }
    setSaving(false);
  }

  if (!editing) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex justify-between items-start mb-3">
          <h2 className="font-semibold text-sm">Osobní údaje</h2>
          {canEdit && <button onClick={startEdit} className="flex items-center gap-1 text-sm text-teal-700 hover:text-teal-900"><Pencil size={14} /> Upravit</button>}
        </div>
        <dl className="text-sm space-y-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-8">
          <Row label="Datum narození" value={fmtDate(employee.date_of_birth) || "—"} />
          <Row label="Místo narození" value={employee.place_of_birth || "—"} />
          <Row label="Stát narození" value={employee.country_of_birth || "—"} />
          <Row label="Státní občanství" value={employee.nationality || "—"} />
          <Row label="Rodné příjmení" value={employee.maiden_name || "—"} />
          <Row label="Nejvyšší vzdělání" value={employee.highest_education || "—"} />
          <Row label="Zdravotní pojišťovna" value={employee.health_insurance_company || "—"} />
          <Row label="Typ dokladu" value={employee.id_document_type || "—"} />
        </dl>
        {canSensitive && (
          <div className="mt-4 pt-3 border-t border-amber-200 bg-amber-50 -mx-4 -mb-4 px-4 pb-4 rounded-b-lg">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 mb-2"><ShieldAlert size={13} /> Citlivé údaje</div>
            <dl className="text-sm space-y-1.5">
              <Row label="Rodné číslo" value={sensitive?.birth_number || "—"} />
              <Row label="Číslo dokladu" value={sensitive?.id_document_number || "—"} />
              <Row label="Bankovní účet" value={sensitive?.bank_account || "—"} />
            </dl>
          </div>
        )}
        {employee.notes && <div className="mt-3 text-sm text-slate-500 whitespace-pre-wrap">{employee.notes}</div>}
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <h2 className="font-semibold text-sm mb-3">Upravit osobní údaje</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4">
        <TextField label="Titul" value={f.title} onChange={(v) => setF({ ...f, title: v })} />
        <TextField label="Jméno" value={f.first_name} onChange={(v) => setF({ ...f, first_name: v })} />
        <TextField label="Příjmení" value={f.last_name} onChange={(v) => setF({ ...f, last_name: v })} />
        <TextField label="Rodné příjmení" value={f.maiden_name} onChange={(v) => setF({ ...f, maiden_name: v })} />
        <DateFieldLocal label="Datum narození" value={f.date_of_birth} onChange={(v) => setF({ ...f, date_of_birth: v })} />
        <TextField label="Místo narození" value={f.place_of_birth} onChange={(v) => setF({ ...f, place_of_birth: v })} />
        <TextField label="Stát narození" value={f.country_of_birth} onChange={(v) => setF({ ...f, country_of_birth: v })} />
        <TextField label="Státní občanství" value={f.nationality} onChange={(v) => setF({ ...f, nationality: v })} />
        <TextField label="Nejvyšší vzdělání" value={f.highest_education} onChange={(v) => setF({ ...f, highest_education: v })} />
        <TextField label="Zdravotní pojišťovna" value={f.health_insurance_company} onChange={(v) => setF({ ...f, health_insurance_company: v })} />
        <TextField label="Typ dokladu" value={f.id_document_type} onChange={(v) => setF({ ...f, id_document_type: v })} />
        <TextField label="Telefon" value={f.phone} onChange={(v) => setF({ ...f, phone: v })} />
        <TextField label="E-mail" value={f.private_email} onChange={(v) => setF({ ...f, private_email: v })} />
        <TextField label="Ulice, č.p." value={f.permanent_street} onChange={(v) => setF({ ...f, permanent_street: v })} />
        <TextField label="Obec, PSČ, stát" value={f.permanent_city} onChange={(v) => setF({ ...f, permanent_city: v })} />
      </div>
      {canSensitive && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mt-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 mb-2"><ShieldAlert size={13} /> Citlivé údaje</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4">
            <TextField label="Rodné číslo" value={f.birth_number} onChange={(v) => setF({ ...f, birth_number: v })} />
            <TextField label="Číslo dokladu" value={f.id_document_number} onChange={(v) => setF({ ...f, id_document_number: v })} />
            <TextField label="Bankovní účet" value={f.bank_account} onChange={(v) => setF({ ...f, bank_account: v })} />
          </div>
        </div>
      )}
      <TextAreaField label="Poznámka" value={f.notes} onChange={(v) => setF({ ...f, notes: v })} />
      {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md mt-2 mb-2">{error}</div>}
      <div className="flex justify-end gap-2 mt-3">
        <button onClick={() => setEditing(false)} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
        <button onClick={save} disabled={saving} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md">
          {saving ? "Ukládám..." : "Uložit"}
        </button>
      </div>
    </div>
  );
}

const CONTRACT_EVENT_TYPE_LABEL = {
  CREATED: "Nástup do zaměstnání",
  CONTRACT_SIGNED: "Pracovní smlouva podepsána",
  EXTENDED: "Prodloužení",
  CHANGED: "Změna podmínek",
  POSITION_CHANGED: "Změna pozice",
  WORKING_HOURS_CHANGED: "Změna úvazku",
  CONVERTED_TO_INDEFINITE: "Převedeno na dobu neurčitou",
  NOTICE_STARTED: "Zahájena výpovědní lhůta",
  ENDED: "Pracovní poměr ukončen",
};

function PracovniPomerTab({ employeeId, employee, employments, contractEvents, positions, positionLabel, canEdit, canOverride, onChanged }) {
  const [addingNew, setAddingNew] = useState(false);
  const [endingId, setEndingId] = useState(null);
  const [extendingId, setExtendingId] = useState(null);
  const [changingId, setChangingId] = useState(null);
  const [historicalOpen, setHistoricalOpen] = useState(false);

  return (
    <div>
      {canEdit && !addingNew && (
        <div className="flex justify-end gap-2 mb-3">
          <button onClick={() => setHistoricalOpen(true)} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 border border-slate-200 px-3 py-2 rounded-md">
            <History size={15} /> Doplnit historická data
          </button>
          <button onClick={() => setAddingNew(true)} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md">
            <UserPlus size={16} /> Nový pracovní poměr
          </button>
        </div>
      )}
      {historicalOpen && (
        <ManualHistoricalEntryForm
          employeeId={employeeId} employee={employee} employments={employments} positions={positions}
          onCancel={() => setHistoricalOpen(false)} onSaved={() => { setHistoricalOpen(false); onChanged(); }}
        />
      )}
      {addingNew && <NewEmploymentForm employeeId={employeeId} positions={positions} onCancel={() => setAddingNew(false)} onSaved={() => { setAddingNew(false); onChanged(); }} />}
      <div className="space-y-3">
        {employments.map((em) => {
          const events = contractEvents.filter((e) => e.employment_id === em.id);
          const fixedTermStatus = em.employment_type === "doba_urcita"
            ? computeFixedTermStatus({ startDate: em.start_date, currentEndDate: em.fixed_term_end_date, events })
            : null;
          return (
            <div key={em.id} className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="flex justify-between items-start flex-wrap gap-2">
                <div>
                  <div className="font-medium">{positionLabel(em.position_id)}</div>
                  <div className="text-sm text-slate-500">{fmtDate(em.start_date)} – {em.termination_date ? fmtDate(em.termination_date) : (em.fixed_term_end_date ? fmtDate(em.fixed_term_end_date) : "trvá")}</div>
                </div>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 h-fit">{EMPLOYMENT_STATUS_LABEL[em.status]}</span>
              </div>
              <dl className="text-sm mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-8">
                <Row label="Typ smlouvy" value={em.employment_type === "doba_urcita" ? "Doba určitá" : "Doba neurčitá"} />
                <Row label="Místo výkonu práce" value={em.workplace || "—"} />
                <Row label="Úvazek" value={em.weekly_hours ? `${em.weekly_hours} h/týden` : "—"} />
                <Row label="Zkušební doba do" value={em.probation_end_date ? fmtDate(em.probation_end_date) : "—"} />
                {fixedTermStatus && (
                  <Row label="Využitá prodloužení" value={fixedTermStatus.requiresReview ? "Vyžaduje kontrolu" : `${fixedTermStatus.extensionsCount} z max. ${FIXED_TERM_RULES.maxExtensions}`} />
                )}
                {em.status === "ENDED" && <Row label="Důvod ukončení" value={em.termination_reason || "—"} />}
              </dl>
              {fixedTermStatus && fixedTermStatus.requiresReview && (
                <div className="mt-2 text-xs px-2.5 py-1.5 rounded-md bg-slate-100 text-slate-600 flex items-center gap-1.5">
                  <ShieldAlert size={13} /> Chybí datum nástupu - zákonný limit nelze bezpečně vypočítat. Vyžaduje kontrolu.
                </div>
              )}
              {fixedTermStatus && !fixedTermStatus.requiresReview && !fixedTermStatus.withinLimits && (
                <div className="mt-2 text-xs px-2.5 py-1.5 rounded-md bg-amber-50 text-amber-700 flex items-center gap-1.5">
                  <ShieldAlert size={13} />
                  {fixedTermStatus.overExtensionLimit
                    ? `Dosažen zákonný limit počtu prodloužení (max. ${FIXED_TERM_RULES.maxExtensions}x).`
                    : `Přesahuje zákonný limit celkové doby (max. do ${fmtDate(fixedTermStatus.maxAllowedEndDate)}).`}
                  {fixedTermStatus.hasOverride && " Zaznamenána výjimka administrátora."}
                </div>
              )}
              {events.length > 0 && <ContractEventsList events={events} />}
              {canEdit && ["ACTIVE", "NOTICE_PERIOD"].includes(em.status) && (
                <div className="flex gap-3 mt-3 pt-3 border-t border-slate-100 flex-wrap">
                  {em.employment_type === "doba_urcita" && (
                    extendingId === em.id
                      ? null
                      : <button onClick={() => setExtendingId(em.id)} className="text-sm text-teal-700 hover:text-teal-900">Prodloužit smlouvu</button>
                  )}
                  {changingId === em.id ? null : <button onClick={() => setChangingId(em.id)} className="text-sm text-teal-700 hover:text-teal-900">Změnit pozici / úvazek</button>}
                  {em.status === "ACTIVE" && (
                    <StartNoticeButton employment={em} onSaved={onChanged} />
                  )}
                  {endingId === em.id
                    ? null
                    : <button onClick={() => setEndingId(em.id)} className="text-sm text-red-600 hover:text-red-800">Ukončit pracovní poměr</button>}
                </div>
              )}
              {extendingId === em.id && <ExtendEmploymentForm employment={em} events={events} canOverride={canOverride} onCancel={() => setExtendingId(null)} onSaved={() => { setExtendingId(null); onChanged(); }} />}
              {changingId === em.id && <ChangePositionHoursForm employment={em} positions={positions} onCancel={() => setChangingId(null)} onSaved={() => { setChangingId(null); onChanged(); }} />}
              {endingId === em.id && <EndEmploymentForm employment={em} onCancel={() => setEndingId(null)} onSaved={() => { setEndingId(null); onChanged(); }} />}
              {["NOTICE_PERIOD", "ENDED"].includes(em.status) && <OffboardingChecklist employment={em} canEdit={canEdit} onChanged={onChanged} />}
            </div>
          );
        })}
        {employments.length === 0 && <div className="text-sm text-slate-400">Žádný pracovní poměr.</div>}
      </div>
    </div>
  );
}

// Skutocne chronologicke udalosti (bod 2 zadania) - nie len pocitadlo.
// Kazda udalost nesie type/effective date/old-new/note/created_by/created_at,
// vratane oznacenia rucne doplnenej historickej udalosti.
function ContractEventsList({ events }) {
  const sorted = sortContractEventsChronologically(events);
  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <div className="text-xs font-medium text-slate-500 mb-2">Historie a dodatky</div>
      <div className="space-y-1.5">
        {sorted.map((e) => (
          <div key={e.id} className="text-xs bg-slate-50 rounded-md px-3 py-1.5 flex items-start justify-between gap-3">
            <div>
              <span className="font-medium text-slate-700">{fmtDate(e.event_date)}</span> — {CONTRACT_EVENT_TYPE_LABEL[e.event_type] || e.event_type}
              {(e.old_value || e.new_value) && (
                <span className="text-slate-500"> ({e.old_value || "—"} → {e.new_value || "—"})</span>
              )}
              {e.valid_to && !e.new_value && <span className="text-slate-500"> (do {fmtDate(e.valid_to)})</span>}
              {e.note && <div className="text-slate-500 mt-0.5">{e.note}</div>}
              {e.is_legal_override && <div className="text-amber-700 mt-0.5">Evidovaná výjimka{e.override_reason ? `: ${e.override_reason}` : ""}</div>}
            </div>
            {e.is_manual_historical_entry && <span className="shrink-0 px-1.5 py-0.5 rounded bg-slate-200 text-slate-500 whitespace-nowrap">ručně doplněno</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function StartNoticeButton({ employment, onSaved }) {
  const [saving, setSaving] = useState(false);
  async function start() {
    if (!window.confirm("Zahájit výpovědní lhůtu pro tento pracovní poměr?")) return;
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    await supabase.from("employment_relationships").update({ status: "NOTICE_PERIOD", updated_at: new Date().toISOString(), updated_by: userData?.user?.id || null }).eq("id", employment.id);
    await supabase.from("employment_contract_events").insert({
      id: uid(), employment_id: employment.id, event_type: "NOTICE_STARTED", event_date: new Date().toISOString().slice(0, 10),
      created_by: userData?.user?.id || null,
    });
    await supabase.from("employee_timeline_events").insert({
      id: uid(), employee_id: employment.employee_id, event_date: new Date().toISOString().slice(0, 10), event_type: "NOTICE_STARTED",
      title: "Zahájena výpovědní lhůta", source: "MANUAL",
    });
    setSaving(false);
    onSaved();
  }
  return <button onClick={start} disabled={saving} className="text-sm text-amber-700 hover:text-amber-900">{saving ? "Ukládám..." : "Zahájit výpovědní lhůtu"}</button>;
}

function ChangePositionHoursForm({ employment, positions, onCancel, onSaved }) {
  const [positionId, setPositionId] = useState(employment.position_id || "");
  const [workplace, setWorkplace] = useState(employment.workplace || "");
  const [weeklyHours, setWeeklyHours] = useState(employment.weekly_hours ? String(employment.weekly_hours) : "");
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function positionLabelFor(id) { const p = positions.find((x) => x.id === id); return p ? (p.code ? `${p.code} – ${p.name}` : p.name) : "—"; }

  async function submit() {
    if (!effectiveDate) { setError("Vyplňte datum účinnosti."); return; }
    const positionChanged = positionId !== (employment.position_id || "");
    const hoursChanged = String(weeklyHours || "") !== String(employment.weekly_hours || "");
    if (!positionChanged && !hoursChanged && workplace === (employment.workplace || "")) { setError("Nebyla provedena žádná změna."); return; }
    setSaving(true);
    setError("");
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { error: updErr } = await supabase.from("employment_relationships").update({
        position_id: positionId || null, workplace: workplace.trim() || null, weekly_hours: weeklyHours ? Number(weeklyHours) : null,
        updated_at: new Date().toISOString(), updated_by: userData?.user?.id || null,
      }).eq("id", employment.id);
      if (updErr) throw updErr;

      if (positionChanged) {
        await supabase.from("employment_contract_events").insert({
          id: uid(), employment_id: employment.id, event_type: "POSITION_CHANGED", event_date: effectiveDate,
          old_value: positionLabelFor(employment.position_id), new_value: positionLabelFor(positionId),
          note: note.trim() || null, created_by: userData?.user?.id || null,
        });
        await supabase.from("employee_timeline_events").insert({
          id: uid(), employee_id: employment.employee_id, event_date: effectiveDate, event_type: "POSITION_CHANGED",
          title: "Změna pozice", description: `${positionLabelFor(employment.position_id)} → ${positionLabelFor(positionId)}`, source: "MANUAL",
        });
      }
      if (hoursChanged) {
        await supabase.from("employment_contract_events").insert({
          id: uid(), employment_id: employment.id, event_type: "WORKING_HOURS_CHANGED", event_date: effectiveDate,
          old_value: employment.weekly_hours ? `${employment.weekly_hours} h/týden` : "—", new_value: weeklyHours ? `${weeklyHours} h/týden` : "—",
          note: note.trim() || null, created_by: userData?.user?.id || null,
        });
        await supabase.from("employee_timeline_events").insert({
          id: uid(), employee_id: employment.employee_id, event_date: effectiveDate, event_type: "WORKING_HOURS_CHANGED",
          title: "Změna úvazku", description: `${employment.weekly_hours || "—"} → ${weeklyHours || "—"} h/týden`, source: "MANUAL",
        });
      }
      onSaved();
    } catch (e) {
      console.error(e);
      setError(e.message || "Uložení se nezdařilo.");
    }
    setSaving(false);
  }

  return (
    <div className="mt-3 pt-3 border-t border-slate-100 bg-slate-50 -mx-4 -mb-4 px-4 pb-4 rounded-b-lg">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4">
        <SelectFieldLocal label="Nová pozice" value={positionId} onChange={setPositionId} options={[{ value: "", label: "— nevybráno —" }, ...positions.map((p) => ({ value: p.id, label: p.code ? `${p.code} – ${p.name}` : p.name }))]} />
        <TextField label="Místo výkonu práce" value={workplace} onChange={setWorkplace} />
        <TextField label="Týdenní úvazek (hodin)" value={weeklyHours} onChange={setWeeklyHours} />
        <DateFieldLocal label="Účinnost od" value={effectiveDate} onChange={setEffectiveDate} />
      </div>
      <TextField label="Poznámka" value={note} onChange={setNote} />
      {error && <div className="text-red-600 text-xs mb-2">{error}</div>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
        <button onClick={submit} disabled={saving} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md">{saving ? "Ukládám..." : "Uložit změnu"}</button>
      </div>
    </div>
  );
}

/* ---------------- Doplnit historická data (bod 11 zadania) ---------------- */
/* Nezpetne nerekonstruuje vsetko - zadaju sa len zname fakty. Vsetko z tohto
   formulara sa oznacuje ako MANUAL_HISTORICAL_ENTRY (timeline) resp.
   is_manual_historical_entry=true (contract events), aby bolo v UI aj v DB
   vzdy zjavne, ze ide o rucne doplnenu historiu, nie zive zaznamenanu
   udalost. "Existujici dokumenty" sa nahravaju cez uz existujucu zalozku
   Dokumenty (REUSE, ziadny novy upload mechanizmus tu). */
function ManualHistoricalEntryForm({ employeeId, employee, employments, positions, onCancel, onSaved }) {
  const currentEmployment = employments.find((e) => ["ACTIVE", "NOTICE_PERIOD"].includes(e.status)) || employments[0] || null;
  const [startDate, setStartDate] = useState(currentEmployment?.start_date || "");
  const [employmentType, setEmploymentType] = useState(currentEmployment?.employment_type || "doba_neurcita");
  const [fixedTermEndDate, setFixedTermEndDate] = useState(currentEmployment?.fixed_term_end_date || "");
  const [positionId, setPositionId] = useState(currentEmployment?.position_id || "");
  const [extensions, setExtensions] = useState([]); // {date, newEndDate, note}
  const [examType, setExamType] = useState("");
  const [examDate, setExamDate] = useState("");
  const [examValidUntil, setExamValidUntil] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function addExtensionRow() { setExtensions((prev) => [...prev, { date: "", newEndDate: "", note: "" }]); }
  function updateExtensionRow(i, patch) { setExtensions((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r))); }
  function removeExtensionRow(i) { setExtensions((prev) => prev.filter((_, idx) => idx !== i)); }

  async function submit() {
    setSaving(true);
    setError("");
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uidVal = userData?.user?.id || null;

      if (currentEmployment) {
        const { error: updErr } = await supabase.from("employment_relationships").update({
          start_date: startDate || null, employment_type: employmentType,
          fixed_term_end_date: employmentType === "doba_urcita" ? (fixedTermEndDate || null) : null,
          position_id: positionId || null, updated_at: new Date().toISOString(), updated_by: uidVal,
        }).eq("id", currentEmployment.id);
        if (updErr) throw updErr;

        for (const row of extensions) {
          if (!row.date || !row.newEndDate) continue;
          await supabase.from("employment_contract_events").insert({
            id: uid(), employment_id: currentEmployment.id, event_type: "EXTENDED", event_date: row.date, valid_to: row.newEndDate,
            new_value: fmtDate(row.newEndDate), note: row.note.trim() || null, is_manual_historical_entry: true, created_by: uidVal,
          });
        }
      }

      if (examDate) {
        await supabase.from("medical_examinations").insert({
          id: uid(), employee_id: employeeId, exam_type: examType.trim() || null, exam_date: examDate,
          valid_until: examValidUntil || null, created_by: uidVal,
        });
      }

      await supabase.from("employee_timeline_events").insert({
        id: uid(), employee_id: employeeId, event_date: startDate || new Date().toISOString().slice(0, 10),
        event_type: "MANUAL_HISTORICAL_ENTRY", title: "Doplněna historická data", source: "MANUAL_HISTORICAL_ENTRY",
        description: `Doplněno: nástup, typ poměru${extensions.length ? `, ${extensions.length} prodloužení` : ""}${examDate ? ", lékařská prohlídka" : ""}.`,
      });

      onSaved();
    } catch (e) {
      console.error(e);
      setError(e.message || "Uložení se nezdařilo.");
    }
    setSaving(false);
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
      <h2 className="font-semibold text-sm mb-1">Doplnit historická data</h2>
      <p className="text-xs text-slate-400 mb-3">Pro zaměstnance, jejichž historie předchází zavedení systému. Zadejte jen fakta, která skutečně známe - vše se označí jako ručně doplněná historie.</p>
      {!currentEmployment && <div className="bg-amber-50 text-amber-700 text-xs px-3 py-2 rounded-md mb-3">Zaměstnanec zatím nemá založený pracovní poměr - nejprve jej založte v záložce Pracovní poměr, nebo doplňte alespoň lékařskou prohlídku níže.</div>}
      {currentEmployment && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4">
            <DateFieldLocal label="Skutečný datum nástupu" value={startDate} onChange={setStartDate} />
            <SelectFieldLocal label="Aktuální typ poměru" value={employmentType} onChange={setEmploymentType} options={[{ value: "doba_neurcita", label: "Doba neurčitá" }, { value: "doba_urcita", label: "Doba určitá" }]} />
            {employmentType === "doba_urcita" && <DateFieldLocal label="Aktuální konec smlouvy" value={fixedTermEndDate} onChange={setFixedTermEndDate} />}
            <SelectFieldLocal label="Aktuální pozice" value={positionId} onChange={setPositionId} options={[{ value: "", label: "— nevybráno —" }, ...positions.map((p) => ({ value: p.id, label: p.code ? `${p.code} – ${p.name}` : p.name }))]} />
          </div>

          <div className="mt-2 mb-2">
            <div className="text-xs font-medium text-slate-500 mb-1.5">Známá prodloužení (nepovinné)</div>
            {extensions.map((row, i) => (
              <div key={i} className="flex items-end gap-2 mb-2">
                <DateFieldLocal label="Datum prodloužení" value={row.date} onChange={(v) => updateExtensionRow(i, { date: v })} />
                <DateFieldLocal label="Nový konec" value={row.newEndDate} onChange={(v) => updateExtensionRow(i, { newEndDate: v })} />
                <TextField label="Poznámka" value={row.note} onChange={(v) => updateExtensionRow(i, { note: v })} />
                <button onClick={() => removeExtensionRow(i)} className="text-xs text-red-500 mb-3">Odebrat</button>
              </div>
            ))}
            <button onClick={addExtensionRow} className="text-xs text-teal-700 hover:text-teal-900">+ Přidat prodloužení</button>
          </div>
        </>
      )}

      <div className="mt-3 pt-3 border-t border-slate-100">
        <div className="text-xs font-medium text-slate-500 mb-1.5">Poslední/platná lékařská prohlídka (nepovinné)</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4">
          <TextField label="Typ prohlídky" value={examType} onChange={setExamType} />
          <DateFieldLocal label="Datum prohlídky" value={examDate} onChange={setExamDate} />
          <DateFieldLocal label="Platnost do" value={examValidUntil} onChange={setExamValidUntil} />
        </div>
      </div>

      <p className="text-xs text-slate-400 mt-2">Existující dokumenty (smlouva, dodatky, prohlídky) nahrajte v záložce Dokumenty.</p>
      {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md mt-2 mb-2">{error}</div>}
      <div className="flex justify-end gap-2 mt-3">
        <button onClick={onCancel} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
        <button onClick={submit} disabled={saving} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md">{saving ? "Ukládám..." : "Uložit historická data"}</button>
      </div>
    </div>
  );
}

/* ---------------- Offboarding checklist ---------------- */
/* Prakticka pripomienka pre HR pri ukoncovani pomeru - VEDOME BEZ pravneho
   textu/lehot (tie MASTER_PROMPT explicitne zakazuje vymyslat) - len bezne
   prevadzkove ulohy. Ulozene do uz existujuceho employment_relationships.data
   (aditivne, ziadna nova tabulka/stlpec). Zobrazuje sa pri NOTICE_PERIOD aj
   ENDED, aby sa dalo pripravit este pred poslednym dnom. */
const OFFBOARDING_CHECKLIST_ITEMS = [
  { key: "vraceni_pomucek", label: "Vráceny pracovní pomůcky/vybavení" },
  { key: "vraceni_klicu_karet", label: "Vráceny klíče / přístupové karty" },
  { key: "predani_agendy", label: "Předána agenda a rozpracované úkoly" },
  { key: "vystupni_pohovor", label: "Proveden výstupní pohovor" },
  { key: "vydany_doklady", label: "Vydán zápočtový list a ostatní doklady" },
  { key: "odhlaseni_pin_system", label: "Odhlášen z docházkového PIN / interních systémů" },
];

function OffboardingChecklist({ employment, canEdit, onChanged }) {
  const checklist = employment.data?.offboarding_checklist || {};
  const [saving, setSaving] = useState(false);
  const doneCount = OFFBOARDING_CHECKLIST_ITEMS.filter((i) => checklist[i.key]).length;

  async function toggle(key) {
    if (!canEdit || saving) return;
    setSaving(true);
    const nextChecklist = { ...checklist, [key]: !checklist[key] };
    const nextData = { ...(employment.data || {}), offboarding_checklist: nextChecklist };
    await supabase.from("employment_relationships").update({ data: nextData, updated_at: new Date().toISOString() }).eq("id", employment.id);
    setSaving(false);
    onChanged();
  }

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <div className="text-xs font-medium text-slate-500 mb-2">Offboarding - kontrolní seznam ({doneCount}/{OFFBOARDING_CHECKLIST_ITEMS.length})</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {OFFBOARDING_CHECKLIST_ITEMS.map((item) => (
          <label key={item.key} className={"flex items-center gap-2 text-sm " + (canEdit ? "text-slate-600 cursor-pointer" : "text-slate-400")}>
            <input type="checkbox" disabled={!canEdit || saving} checked={!!checklist[item.key]} onChange={() => toggle(item.key)} />
            {item.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function NewEmploymentForm({ employeeId, positions, onCancel, onSaved }) {
  const [f, setF] = useState({ position_id: "", start_date: "", employment_type: "doba_neurcita", fixed_term_end_date: "", workplace: "", weekly_hours: "40", probation_end_date: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!f.start_date) { setError("Vyplňte datum nástupu."); return; }
    setSaving(true);
    setError("");
    try {
      const employmentId = uid();
      const { data: userData } = await supabase.auth.getUser();
      const { error: emErr } = await supabase.from("employment_relationships").insert({
        id: employmentId, employee_id: employeeId, status: "ACTIVE", employment_type: f.employment_type,
        start_date: f.start_date, fixed_term_end_date: f.employment_type === "doba_urcita" ? (f.fixed_term_end_date || null) : null,
        probation_end_date: f.probation_end_date || null,
        position_id: f.position_id || null, workplace: f.workplace.trim() || null, weekly_hours: f.weekly_hours ? Number(f.weekly_hours) : null,
        created_by: userData?.user?.id || null, updated_by: userData?.user?.id || null,
      });
      if (emErr) throw emErr;
      await supabase.from("employment_contract_events").insert({
        id: uid(), employment_id: employmentId, event_type: "CREATED", event_date: f.start_date,
        valid_from: f.start_date, valid_to: f.employment_type === "doba_urcita" ? (f.fixed_term_end_date || null) : null,
        created_by: userData?.user?.id || null,
      });
      await supabase.from("employee_timeline_events").insert({
        id: uid(), employee_id: employeeId, event_date: f.start_date, event_type: "EMPLOYMENT_CREATED", title: "Nový pracovní poměr", source: "MANUAL",
      });
      // predchadzajuci aktivny pracovny pomer (ak existoval) sa rucne neuzatvara -
      // HR to musi urobit vedome cez "Ukoncit pracovni pomer", aby sa nestratil dovod/datum ukoncenia.
      // Ale zamestnanec (mozny "byvaly" pri opatovnom nastupe) sa musi oznacit
      // spat ako aktivny - inak by po rehire zostal nespravne v "Byvali".
      await supabase.from("employees").update({ active: true, updated_at: new Date().toISOString() }).eq("id", employeeId);
      onSaved();
    } catch (e) {
      console.error(e);
      setError(e.message || "Uložení se nezdařilo.");
    }
    setSaving(false);
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 mb-3">
      <h2 className="font-semibold text-sm mb-3">Nový pracovní poměr</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4">
        <SelectFieldLocal label="Pozice" value={f.position_id} onChange={(v) => setF({ ...f, position_id: v })} options={[{ value: "", label: "— nevybráno —" }, ...positions.map((p) => ({ value: p.id, label: p.code ? `${p.code} – ${p.name}` : p.name }))]} />
        <DateFieldLocal label="Datum nástupu" value={f.start_date} onChange={(v) => setF({ ...f, start_date: v, probation_end_date: addMonthsIso(v, PROBATION_MONTHS) })} />
        <SelectFieldLocal label="Typ smlouvy" value={f.employment_type} onChange={(v) => setF({ ...f, employment_type: v })} options={[{ value: "doba_neurcita", label: "Doba neurčitá" }, { value: "doba_urcita", label: "Doba určitá" }]} />
        {f.employment_type === "doba_urcita" && <DateFieldLocal label="Konec smlouvy" value={f.fixed_term_end_date} onChange={(v) => setF({ ...f, fixed_term_end_date: v })} />}
        <DateFieldLocal label={`Konec zkušební doby (${PROBATION_MONTHS} měsíce)`} value={f.probation_end_date} onChange={(v) => setF({ ...f, probation_end_date: v })} />
        <TextField label="Místo výkonu práce" value={f.workplace} onChange={(v) => setF({ ...f, workplace: v })} />
        <TextField label="Týdenní úvazek (hodin)" value={f.weekly_hours} onChange={(v) => setF({ ...f, weekly_hours: v })} />
      </div>
      {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md mt-2 mb-2">{error}</div>}
      <div className="flex justify-end gap-2 mt-2">
        <button onClick={onCancel} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
        <button onClick={submit} disabled={saving} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md">{saving ? "Ukládám..." : "Uložit"}</button>
      </div>
    </div>
  );
}

function ExtendEmploymentForm({ employment, events, canOverride, onCancel, onSaved }) {
  const [newEnd, setNewEnd] = useState("");
  const [overrideChecked, setOverrideChecked] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const proposed = newEnd ? canProposeExtension({ startDate: employment.start_date, proposedEndDate: newEnd, events }) : null;
  const needsOverride = proposed && !proposed.withinLimits;
  const canSubmit = newEnd && (!needsOverride || (canOverride && overrideChecked && overrideReason.trim()));

  async function submit() {
    if (!newEnd) { setError("Vyplňte nové datum konce."); return; }
    if (needsOverride && !canSubmit) { setError("Přesahuje zákonný limit doby určité - potvrďte výjimku s důvodem, nebo zvolte dřívější datum."); return; }
    setSaving(true);
    setError("");
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { error: emErr } = await supabase.from("employment_relationships").update({ fixed_term_end_date: newEnd, updated_at: new Date().toISOString(), updated_by: userData?.user?.id || null }).eq("id", employment.id);
      if (emErr) throw emErr;
      await supabase.from("employment_contract_events").insert({
        id: uid(), employment_id: employment.id, event_type: "EXTENDED", event_date: new Date().toISOString().slice(0, 10),
        valid_from: employment.fixed_term_end_date, valid_to: newEnd,
        old_value: employment.fixed_term_end_date ? fmtDate(employment.fixed_term_end_date) : "—", new_value: fmtDate(newEnd),
        is_legal_override: needsOverride ? true : false,
        override_reason: needsOverride ? overrideReason.trim() : null,
        overridden_by: needsOverride ? userData?.user?.id || null : null,
        created_by: userData?.user?.id || null,
      });
      await supabase.from("employee_timeline_events").insert({
        id: uid(), employee_id: employment.employee_id, event_date: new Date().toISOString().slice(0, 10), event_type: "CONTRACT_EXTENDED",
        title: "Smlouva prodloužena", description: `Nový konec: ${skDateStrFromIso(newEnd)}` + (needsOverride ? ` (výjimka: ${overrideReason.trim()})` : ""), source: "MANUAL",
      });
      onSaved();
    } catch (e) {
      console.error(e);
      setError(e.message || "Uložení se nezdařilo.");
    }
    setSaving(false);
  }

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-md p-3 w-full">
      <div className="flex items-end gap-2 flex-wrap">
        <DateFieldLocal label="Nový konec smlouvy" value={newEnd} onChange={setNewEnd} />
        <button onClick={onCancel} className="text-sm text-slate-500 px-2 py-2">Zrušit</button>
        <button onClick={submit} disabled={saving || !canSubmit} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-3 py-2 rounded-md">{saving ? "Ukládám..." : "Prodloužit"}</button>
      </div>
      {needsOverride && (
        <div className="mt-2 text-xs px-2.5 py-2 rounded-md bg-amber-100 text-amber-800">
          <div className="flex items-center gap-1.5 font-medium"><ShieldAlert size={13} />
            {proposed.overExtensionLimit
              ? `Toto by bylo ${proposed.extensionsCount + 1}. prodloužení - zákon dovoluje max. ${FIXED_TERM_RULES.maxExtensions}x.`
              : `Toto by přesáhlo max. celkovou dobu určitou (do ${fmtDate(proposed.maxAllowedEndDate)}).`}
          </div>
          {canOverride ? (
            <div className="mt-2 space-y-1.5">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={overrideChecked} onChange={(e) => setOverrideChecked(e.target.checked)} /> Přesto prodloužit (evidovaná výjimka)
              </label>
              {overrideChecked && (
                <input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Důvod výjimky (povinné)" className="w-full border border-amber-300 rounded-md px-2.5 py-1.5 text-sm" />
              )}
            </div>
          ) : (
            <div className="mt-1">Prodloužení nad tento limit může potvrdit jen administrátor.</div>
          )}
        </div>
      )}
      {error && <div className="text-red-600 text-xs mt-1.5">{error}</div>}
    </div>
  );
}

const TERMINATION_TYPE_LABEL = {
  dohoda: "Dohoda o skončení",
  vypoved_zamestnance: "Výpověď zaměstnance",
  vypoved_zamestnavatele: "Výpověď zaměstnavatele",
  zkusebni_doba: "Zrušení ve zkušební době",
  okamzite_zruseni: "Okamžité zrušení",
  uplynuti_doby_urcite: "Uplynutí doby určité",
  jine: "Jiné",
};

function EndEmploymentForm({ employment, onCancel, onSaved }) {
  const [f, setF] = useState({ termination_date: "", termination_type: "dohoda", termination_reason: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!f.termination_date) { setError("Vyplňte datum ukončení."); return; }
    setSaving(true);
    setError("");
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { error: emErr } = await supabase.from("employment_relationships").update({
        status: "ENDED", termination_date: f.termination_date, termination_type: f.termination_type, termination_reason: f.termination_reason.trim() || null,
        updated_at: new Date().toISOString(), updated_by: userData?.user?.id || null,
      }).eq("id", employment.id);
      if (emErr) throw emErr;
      await supabase.from("employment_contract_events").insert({
        id: uid(), employment_id: employment.id, event_type: "ENDED", event_date: f.termination_date, valid_to: f.termination_date,
        old_value: EMPLOYMENT_STATUS_LABEL[employment.status], new_value: TERMINATION_TYPE_LABEL[f.termination_type] || f.termination_type,
        note: f.termination_reason.trim() || null, created_by: userData?.user?.id || null,
      });
      // ak zamestnancovi uz nezostava ziadny aktivny/planovany pracovny pomer, oznaci sa ako byvaly
      // (filter "Byvali zamestnanci" cita prave toto pole - riadok aj cela historia zostavaju v DB).
      const { data: remaining } = await supabase.from("employment_relationships").select("id").eq("employee_id", employment.employee_id).in("status", ["ACTIVE", "PLANNED", "NOTICE_PERIOD"]).neq("id", employment.id);
      if (shouldMarkEmployeeInactive(remaining?.length || 0)) {
        await supabase.from("employees").update({ active: false, updated_at: new Date().toISOString() }).eq("id", employment.employee_id);
      }
      await supabase.from("employee_timeline_events").insert({
        id: uid(), employee_id: employment.employee_id, event_date: f.termination_date, event_type: "EMPLOYMENT_ENDED",
        title: "Pracovní poměr ukončen", description: f.termination_reason.trim() || undefined, source: "MANUAL",
      });
      onSaved();
    } catch (e) {
      console.error(e);
      setError(e.message || "Uložení se nezdařilo.");
    }
    setSaving(false);
  }

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4">
        <DateFieldLocal label="Datum ukončení" value={f.termination_date} onChange={(v) => setF({ ...f, termination_date: v })} />
        <SelectFieldLocal
          label="Způsob ukončení"
          value={f.termination_type}
          onChange={(v) => setF({ ...f, termination_type: v })}
          options={Object.entries(TERMINATION_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <TextField label="Důvod / poznámka" value={f.termination_reason} onChange={(v) => setF({ ...f, termination_reason: v })} />
      </div>
      {error && <div className="text-red-600 text-xs mt-1">{error}</div>}
      <div className="flex justify-end gap-2 mt-2">
        <button onClick={onCancel} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
        <button onClick={submit} disabled={saving} className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md">{saving ? "Ukládám..." : "Potvrdit ukončení"}</button>
      </div>
    </div>
  );
}

/* ---------------- Dokumenty (na karte zamestnanca) ---------------- */
/* Naplnenie sablony: buildDocumentData rozdeluje udaje na AUTO (z karty
   zamestnanca - person/sensitive, uz existujuce polia) a MANUALNE (specificke
   pre konkretny generovany dokument - napr. mzda_hod, zastupce - HR ich
   zada pri kazdom generovani zvlast, nie su cast trvaleho zaznamu). PDF
   nahled je len na stiahnutie (docxToPdf.js, klientsky render) - ulozeny
   artefakt v hr_documents je vzdy .docx so skutocnym textom. */

const MANUAL_DOC_FIELD_KEYS = [
  "cele_jmeno", "rodinny_stav", "pojistovna", "zarazeni", "druh_prace",
  "mzda_hod", "priplatek_noc", "priplatek_vikend", "datum", "datum_dokumentu",
  "datum_skoleni", "zastupce", "zastupce_pad7", "predavajici", "skolitel",
];
const MANUAL_DOC_FIELD_LABELS = {
  cele_jmeno: "Celé jméno (jak má být na dokumentu)", rodinny_stav: "Rodinný stav", pojistovna: "Zdravotní pojišťovna (kód – název)",
  zarazeni: "Pracovní zařazení", druh_prace: "Druh práce", mzda_hod: "Mzda (Kč/hod, jen číslo)",
  priplatek_noc: "Příplatek za noc (Kč/hod, jen číslo)", priplatek_vikend: "Příplatek za víkend (Kč/hod, jen číslo)",
  datum: "Datum dokumentu", datum_dokumentu: "Datum dokumentu", datum_skoleni: "Datum školení",
  zastupce: "Zástupce zaměstnavatele (jméno)", zastupce_pad7: "Zástupce zaměstnavatele (7. pád, \"kým\")",
  predavajici: "Předávající", skolitel: "Školitel",
};
const MANUAL_DOC_FIELD_DATE_KEYS = new Set(["datum", "datum_dokumentu", "datum_skoleni"]);

function downloadArrayBufferAsFile(arrayBuffer, filename, mime) {
  const blob = new Blob([arrayBuffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function DokumentyTab({ employee, sensitive, currentEmployment, permissions }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [documents, setDocuments] = useState([]);
  const [signaturesByDoc, setSignaturesByDoc] = useState(new Map()); // hr_document_id -> hr_document_signatures[]
  const [templates, setTemplates] = useState([]);
  const [creating, setCreating] = useState(false);
  const [signingId, setSigningId] = useState(null);
  const canGenerate = hasPerm(permissions, "HR_DOCUMENT_GENERATE");
  const canApprove = hasPerm(permissions, "HR_DOCUMENT_APPROVE");
  const canSign = hasPerm(permissions, "HR_DOCUMENT_SIGN");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const [docsRes, tplsRes] = await Promise.all([
      supabase.from("hr_documents").select("*").eq("employee_id", employee.id).order("created_at", { ascending: false }),
      supabase.from("hr_document_templates").select("*").eq("status", "SCHVALENA"),
    ]);
    if (docsRes.error) { setError("Nepodařilo se načíst dokumenty."); setLoading(false); return; }
    const docs = docsRes.data || [];
    setDocuments(docs);
    setTemplates(tplsRes.data || []);
    if (docs.length > 0) {
      const { data: sigs } = await supabase.from("hr_document_signatures").select("*").in("hr_document_id", docs.map((d) => d.id)).order("created_at", { ascending: false });
      const map = new Map();
      (sigs || []).forEach((s) => { const arr = map.get(s.hr_document_id) || []; arr.push(s); map.set(s.hr_document_id, arr); });
      setSignaturesByDoc(map);
    } else {
      setSignaturesByDoc(new Map());
    }
    setLoading(false);
  }, [employee.id]);

  useEffect(() => { load(); }, [load]);

  async function advanceStatus(doc) {
    const idx = HR_DOCUMENT_STATUS_ORDER.indexOf(doc.status);
    const next = HR_DOCUMENT_STATUS_ORDER[idx + 1];
    if (!next || next === "SIGNED") return; // SIGNED sa nastavi az cez "Nahrát podepsaný sken"
    const { error: err } = await supabase.from("hr_documents").update({ status: next, updated_at: new Date().toISOString() }).eq("id", doc.id);
    if (err) { window.alert(err.message); return; }
    load();
  }

  // path sa preberá explicitne (nie doc.file_path natvrdo) - GENERATED
  // ORIGINAL (hr_documents.file_path, nikdy sa neprepisuje) a SIGNED
  // ORIGINAL (hr_document_signatures.file_path, WORM chranene) su takto
  // vzdy dve nezavisle dohladatelne cesty, nikdy tichá zámena jedné za druhou.
  async function openFile(path) {
    const { data, error: err } = await supabase.storage.from(HR_DOKUMENTY_BUCKET).createSignedUrl(path, 3600);
    if (err) { window.alert(err.message); return; }
    window.open(data.signedUrl, "_blank");
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        {canGenerate && !creating && (
          <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md">
            <FileText size={16} /> Vytvořit dokument
          </button>
        )}
      </div>
      {creating && (
        <GenerateDocumentForm
          employee={employee} sensitive={sensitive} currentEmployment={currentEmployment} templates={templates}
          onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }}
        />
      )}
      {loading ? (
        <div className="text-center text-slate-400 py-10"><Loader2 className="animate-spin mx-auto mb-2" size={24} /> Načítám...</div>
      ) : error ? (
        <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md">{error}</div>
      ) : documents.length === 0 ? (
        <div className="text-sm text-slate-400">Zatím žádné dokumenty.</div>
      ) : (
        <div className="space-y-3">
          {documents.map((d) => {
            const nextStatus = HR_DOCUMENT_STATUS_ORDER[HR_DOCUMENT_STATUS_ORDER.indexOf(d.status) + 1];
            const canAdvance = nextStatus && nextStatus !== "SIGNED" && (canGenerate || canApprove);
            const signatures = signaturesByDoc.get(d.id) || [];
            const latestSignature = signatures[0] || null;
            return (
              <div key={d.id} className="bg-white border border-slate-200 rounded-lg p-4">
                <div className="flex justify-between items-start flex-wrap gap-2">
                  <div>
                    <div className="font-medium">{DOC_TYPE_LABELS[d.doc_type] || d.doc_type}</div>
                    <div className="text-xs text-slate-500">
                      {d.origin === "GENERATED" ? "Vygenerováno" : "Nahráno ručně"} · {fmtDate(d.created_at?.slice(0, 10))}
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">{HR_DOCUMENT_STATUS_LABEL[d.status] || d.status}</span>
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-slate-100">
                  {/* GENERATED ORIGINAL - hr_documents.file_path sa po podpise nikdy neprepisuje, zostava trvalo dostupny */}
                  {d.file_path && (
                    <button onClick={() => openFile(d.file_path)} className="text-sm text-teal-700 hover:text-teal-900 flex items-center gap-1">
                      <Download size={14} /> {latestSignature ? "Otevřít původní vygenerovaný soubor" : "Otevřít soubor"}
                    </button>
                  )}
                  {/* SIGNED ORIGINAL - samostatna cesta z hr_document_signatures, nikdy nezamenena za vygenerovany original */}
                  {latestSignature?.file_path && (
                    <button onClick={() => openFile(latestSignature.file_path)} className="text-sm text-emerald-700 hover:text-emerald-900 flex items-center gap-1">
                      <Stamp size={14} /> Otevřít podepsaný sken
                    </button>
                  )}
                  {canAdvance && (
                    <button onClick={() => advanceStatus(d)} className="text-sm text-slate-500 hover:text-slate-800">Posunout stav → {HR_DOCUMENT_STATUS_LABEL[nextStatus]}</button>
                  )}
                  {canSign && d.status === "READY_FOR_SIGNATURE" && signingId !== d.id && (
                    <button onClick={() => setSigningId(d.id)} className="text-sm text-teal-700 hover:text-teal-900 flex items-center gap-1"><Stamp size={14} /> Nahrát podepsaný sken</button>
                  )}
                </div>
                {latestSignature && (
                  <div className="mt-2 text-xs text-slate-400">
                    Podepsal: {latestSignature.signed_by_name || "—"} ({latestSignature.signer_type === "EMPLOYEE" ? "zaměstnanec" : "zaměstnavatel"}) ·
                    {" "}potvrzeno: {latestSignature.created_at ? new Date(latestSignature.created_at).toLocaleString("cs-CZ") : "—"} ·
                    {" "}SHA-256: <code className="font-mono">{latestSignature.document_hash ? latestSignature.document_hash.slice(0, 16) + "…" : "—"}</code>
                  </div>
                )}
                {signingId === d.id && <SignDocumentForm doc={d} onCancel={() => setSigningId(null)} onSaved={() => { setSigningId(null); load(); }} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GenerateDocumentForm({ employee, sensitive, currentEmployment, templates, onCancel, onSaved }) {
  const [templateId, setTemplateId] = useState(templates[0]?.id || "");
  const [manualFields, setManualFields] = useState({ cele_jmeno: fullName(employee) });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(null);
  const [loadingVersion, setLoadingVersion] = useState(false);

  const template = templates.find((t) => t.id === templateId);

  useEffect(() => {
    let cancelled = false;
    if (!template?.current_version_id) { setVersion(null); return; }
    setLoadingVersion(true);
    supabase.from("hr_document_template_versions").select("*").eq("id", template.current_version_id).single().then(({ data }) => {
      if (!cancelled) { setVersion(data || null); setLoadingVersion(false); }
    });
    return () => { cancelled = true; };
  }, [template?.current_version_id]);

  const usedKeys = version?.variables_schema?.keys || TEMPLATE_REQUIRED_KEYS[template?.doc_type] || [];
  const requiredKeys = TEMPLATE_REQUIRED_KEYS[template?.doc_type] || usedKeys;
  const manualKeysToShow = usedKeys.filter((k) => MANUAL_DOC_FIELD_KEYS.includes(k));
  const autoKeysToShow = usedKeys.filter((k) => !MANUAL_DOC_FIELD_KEYS.includes(k));

  function setManual(key, v) { setManualFields((prev) => ({ ...prev, [key]: v })); }

  const person = {
    maiden_name: employee.maiden_name, date_of_birth: employee.date_of_birth, place_of_birth: employee.place_of_birth,
    permanent_address: employee.permanent_address, correspondence_address: employee.correspondence_address,
    phone: employee.phone, private_email: employee.private_email,
  };
  const mergedData = buildDocumentData({ person, sensitive, documentFields: manualFields });
  const { missing } = validateRequiredKeys(mergedData, requiredKeys);

  async function loadFilledArrayBuffer() {
    const { data: blob, error: dlErr } = await supabase.storage.from(HR_DOKUMENTY_BUCKET).download(version.file_path);
    if (dlErr) throw dlErr;
    const templateAb = await blob.arrayBuffer();
    return fillDocxTemplate(templateAb, mergedData);
  }

  async function downloadPreview() {
    setError("");
    try {
      const filled = await loadFilledArrayBuffer();
      // Nazov suboru zamerne obsahuje "NAHLED" - PDF vznika prerenderovanim
      // (mammoth+html2canvas), ktore NEZACHOVAVA presne stranky/riadkovanie
      // povodneho .docx (over eno na realnych vzoroch, viz docxToPdf.js).
      // Nikdy sa neuklada ako hr_documents.file_path a nikdy sa nesklada za
      // archivovany/podpisany vystup - len na rychlu vizualnu kontrolu pred
      // tlacou/podpisom.
      const filename = `NAHLED - ${DOC_TYPE_LABELS[template.doc_type] || template.doc_type} - ${fullName(employee)}.pdf`;
      await convertFilledDocxToPdf(filename, filled);
    } catch (e) {
      console.error(e);
      setError(e.message || "Náhled se nepodařilo vytvořit.");
    }
  }

  async function downloadDocxPreview() {
    setError("");
    try {
      const filled = await loadFilledArrayBuffer();
      downloadArrayBufferAsFile(filled, `${DOC_TYPE_LABELS[template.doc_type] || template.doc_type} - ${fullName(employee)}.docx`, DOCX_MIME);
    } catch (e) {
      console.error(e);
      setError(e.message || "Soubor se nepodařilo vytvořit.");
    }
  }

  async function generateAndSave() {
    if (missing.length > 0) { setError("Vyplňte povinná pole: " + missing.join(", ")); return; }
    setSaving(true);
    setError("");
    try {
      const filled = await loadFilledArrayBuffer();
      const { data: userData } = await supabase.auth.getUser();
      const docId = uid();
      const storagePath = `zamestnanci/${employee.id}/${docId}.docx`;
      const blob = new Blob([filled], { type: DOCX_MIME });
      const { error: upErr } = await supabase.storage.from(HR_DOKUMENTY_BUCKET).upload(storagePath, blob, { contentType: DOCX_MIME });
      if (upErr) throw upErr;
      const { error: insErr } = await supabase.from("hr_documents").insert({
        id: docId, employee_id: employee.id, employment_id: currentEmployment?.id || null, doc_type: template.doc_type,
        template_id: template.id, template_version_id: version.id, origin: "GENERATED", status: "DRAFT",
        generated_at: new Date().toISOString(), generated_by: userData?.user?.id || null,
        file_path: storagePath, variables_snapshot: mergedData,
      });
      if (insErr) throw insErr;
      await supabase.from("employee_timeline_events").insert({
        id: uid(), employee_id: employee.id, event_date: new Date().toISOString().slice(0, 10), event_type: "DOCUMENT_GENERATED",
        title: `Vygenerován dokument: ${DOC_TYPE_LABELS[template.doc_type] || template.doc_type}`, source: "MANUAL",
      });
      onSaved();
    } catch (e) {
      console.error(e);
      setError(e.message || "Uložení se nezdařilo.");
    }
    setSaving(false);
  }

  if (templates.length === 0) {
    return <div className="bg-amber-50 text-amber-700 text-sm px-3 py-2 rounded-md mb-3">Žádná schválená šablona zatím není k dispozici - nahrajte a aktivujte ji v záložce "Šablony dokumentů".</div>;
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
      <h2 className="font-semibold text-sm mb-3">Vytvořit dokument</h2>
      <SelectFieldLocal label="Šablona" value={templateId} onChange={setTemplateId} options={templates.map((t) => ({ value: t.id, label: `${DOC_TYPE_LABELS[t.doc_type] || t.doc_type} – ${t.name}` }))} />

      {loadingVersion ? (
        <div className="text-sm text-slate-400 py-2"><Loader2 className="inline animate-spin mr-1.5" size={14} /> Načítám šablonu...</div>
      ) : version ? (
        <>
          {autoKeysToShow.length > 0 && (
            <div className="bg-slate-50 rounded-md p-3 mb-3">
              <div className="text-xs font-medium text-slate-500 mb-1.5">Doplní se automaticky z karty zaměstnance - zkontrolujte, prosím:</div>
              <dl className="text-sm space-y-1">
                {autoKeysToShow.map((k) => <Row key={k} label={k} value={mergedData[k] || "— (chybí, doplňte v Osobních údajích)"} />)}
              </dl>
            </div>
          )}
          {manualKeysToShow.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
              {manualKeysToShow.map((k) =>
                MANUAL_DOC_FIELD_DATE_KEYS.has(k)
                  ? <DateFieldLocal key={k} label={MANUAL_DOC_FIELD_LABELS[k] || k} value={manualFields[k] || ""} onChange={(v) => setManual(k, v)} />
                  : <TextField key={k} label={MANUAL_DOC_FIELD_LABELS[k] || k} value={manualFields[k] || ""} onChange={(v) => setManual(k, v)} />
              )}
            </div>
          )}
          {missing.length > 0 && (
            <div className="text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded-md mb-2">Chybí: {missing.join(", ")}</div>
          )}
          {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md mb-2">{error}</div>}
          <div className="flex justify-end gap-2 flex-wrap mt-2">
            <button onClick={onCancel} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
            <button onClick={downloadDocxPreview} className="text-sm text-slate-600 hover:text-slate-900 px-3 py-2 border border-slate-200 rounded-md">Stáhnout .docx (přesný dokument)</button>
            <button onClick={downloadPreview} className="text-sm text-slate-600 hover:text-slate-900 px-3 py-2 border border-slate-200 rounded-md">Stáhnout PDF (jen náhled)</button>
            <button onClick={generateAndSave} disabled={saving || missing.length > 0} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-md">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} {saving ? "Ukládám..." : "Vygenerovat a uložit"}
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-2">
            PDF je jen orientační náhled pro rychlou kontrolu - vzniká převodem z .docx a jeho stránkování (počet stran, zalomení řádků) se může lišit od skutečného vzhledu ve Wordu.
            Za skutečný dokument vždy považujte staženou/vygenerovanou .docx, po podpisu pak nahraný sken.
          </p>
        </>
      ) : (
        <div className="text-sm text-slate-400">Šablona nemá žádnou aktivní verzi.</div>
      )}
    </div>
  );
}

function SignDocumentForm({ doc, onCancel, onSaved }) {
  const [signerType, setSignerType] = useState("EMPLOYEE");
  const [signedByName, setSignedByName] = useState("");
  const [signedAt, setSignedAt] = useState(new Date().toISOString().slice(0, 10));
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!file) { setError("Vyberte naskenovaný podepsaný soubor."); return; }
    if (!signedByName.trim()) { setError("Vyplňte jméno podepsaného."); return; }
    setSaving(true);
    setError("");
    try {
      const { data: userData } = await supabase.auth.getUser();
      const storagePath = buildSignedScanPath(doc.id, uid(), file.name.split(".").pop());
      const { error: upErr } = await supabase.storage.from(HR_DOKUMENTY_BUCKET).upload(storagePath, file, { contentType: file.type });
      if (upErr) throw upErr;
      const ab = await file.arrayBuffer();
      const hash = await sha256Hex(ab);
      const { error: sigErr } = await supabase.from("hr_document_signatures").insert({
        id: uid(), hr_document_id: doc.id, method: "PAPER", signer_type: signerType,
        signed_at: signedAt ? new Date(signedAt).toISOString() : null, signed_by_name: signedByName.trim(),
        document_hash: hash, uploaded_by: userData?.user?.id || null, file_path: storagePath,
      });
      if (sigErr) throw sigErr;
      // hr_documents.file_path sa ZAMERNE NEPREPISUJE - zostava navzdy
      // ukazovat na PUVODNI vygenerovany original (bod "GENERATED ORIGINAL"
      // z kontroly lifecycle). Podpisany sken ("SIGNED ORIGINAL") je
      // dohladatelny samostatne cez hr_document_signatures.file_path (uz
      // ulozene vyssie) - DokumentyTab nizsie ponuka OBE cesty ako dve
      // oddelene tlacidla, aby ziadna z nich nebola tichou zamenou tej druhej.
      const { error: docErr } = await supabase.from("hr_documents").update({
        status: "SIGNED", updated_at: new Date().toISOString(),
      }).eq("id", doc.id);
      if (docErr) throw docErr;
      onSaved();
    } catch (e) {
      console.error(e);
      setError(e.message || "Nahrání se nezdařilo.");
    }
    setSaving(false);
  }

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4">
        <SelectFieldLocal label="Kdo podepsal" value={signerType} onChange={setSignerType} options={[{ value: "EMPLOYEE", label: "Zaměstnanec" }, { value: "EMPLOYER", label: "Zaměstnavatel" }]} />
        <TextField label="Jméno podepsaného" value={signedByName} onChange={setSignedByName} />
        <DateFieldLocal label="Datum podpisu" value={signedAt} onChange={setSignedAt} />
      </div>
      <label className="block mb-3">
        <span className="block text-xs font-medium text-slate-500 mb-1">Naskenovaný podepsaný soubor</span>
        <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm" />
      </label>
      {error && <div className="text-red-600 text-xs mb-2">{error}</div>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
        <button onClick={submit} disabled={saving} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md">{saving ? "Ukládám..." : "Uložit podpis"}</button>
      </div>
    </div>
  );
}

/* ---------------- JMHZ dotazník (import) ---------------- */
/* Presny tok podla zadania: nacitanie poli a odpovedi -> nahlad povodnych a
   navrhovanych hodnot -> kontrola konfliktov -> potvrdenie clovekom -> zapis
   do TEJ ISTEJ karty zamestnanca (rovnake tabulky ako pri priamom zadani -
   employees/employee_sensitive_data/employment_relationships/employee_payroll_data).
   Neznama verzia (mapa poli prazdna) sa VZDY zastavi - ziadna tycha extrakcia. */

function JmhzImportTab({ employee, sensitive, payroll, currentEmployment, canSensitive, canPayroll, canEditEmployment, onImported }) {
  const [fileBuffer, setFileBuffer] = useState(null);
  const [fileName, setFileName] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [version, setVersion] = useState("");
  const [extractResult, setExtractResult] = useState(null);
  const [rows, setRows] = useState([]);
  const [checked, setChecked] = useState({});
  const [loadingExtract, setLoadingExtract] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const versionOptions = knownJmhzVersions();

  async function onFileChange(e) {
    const f = e.target.files?.[0];
    setError(""); setSuccessMsg(""); setExtractResult(null); setRows([]); setChecked({});
    if (!f) { setFileBuffer(null); setFileName(""); return; }
    try {
      const ab = await f.arrayBuffer();
      setFileBuffer(ab);
      setFileName(f.name);
      const { candidates: cands } = await detectJmhzVersionCandidates(ab);
      setCandidates(cands);
      setVersion(cands[0] || "");
    } catch (err) {
      setError("Soubor se nepodařilo přečíst jako PDF: " + (err.message || err));
    }
  }

  async function runExtraction() {
    if (!fileBuffer || !version) { setError("Vyberte soubor a verzi dotazníku."); return; }
    setLoadingExtract(true);
    setError(""); setSuccessMsg("");
    try {
      const result = await extractJmhzFields(fileBuffer, version);
      setExtractResult(result);
      if (result.status === "OK") {
        const ctx = { employee, sensitive, payroll, currentEmployment, canSensitive, canPayroll, canEditEmployment };
        const built = buildComparisonRows(result.results, ctx);
        setRows(built);
        const initialChecked = {};
        built.forEach((r) => { initialChecked[r.key] = r.defaultChecked; });
        setChecked(initialChecked);
      }
    } catch (err) {
      console.error(err);
      setError("Načtení dotazníku se nezdařilo: " + (err.message || err));
    }
    setLoadingExtract(false);
  }

  function toggleRow(key) {
    setChecked((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function confirmImport() {
    const selected = rows.filter((r) => r.writable && checked[r.key]);
    if (selected.length === 0) { setError("Nejsou vybrána žádná pole k zápisu."); return; }
    setSaving(true);
    setError("");
    try {
      const employeesDirect = {}; const employeesJsonb = {};
      const sensitiveDirect = {}; const sensitiveJsonb = {};
      const employmentPatch = {};
      const payrollBucket = {};
      const dependentsWorking = JSON.parse(JSON.stringify(payroll?.dependents || []));

      for (const row of selected) {
        const t = row.target;
        if (t.table === "employees") {
          if (t.path) employeesJsonb[t.column] = { ...(employeesJsonb[t.column] || employee[t.column] || {}), [t.path]: row.proposedValue };
          else employeesDirect[t.column] = row.proposedValue;
        } else if (t.table === "employee_sensitive_data") {
          if (t.path) sensitiveJsonb[t.column] = { ...(sensitiveJsonb[t.column] || sensitive?.[t.column] || {}), [t.path]: row.proposedValue };
          else sensitiveDirect[t.column] = row.proposedValue;
        } else if (t.table === "employment_relationships") {
          employmentPatch[t.column] = row.proposedValue;
        } else if (t.table === "employee_payroll_data") {
          if (t.bucket === "dependents") {
            const idx = dependentsWorking.findIndex((d) => d.slot === t.slot);
            if (idx === -1) dependentsWorking.push({ slot: t.slot, [t.field]: row.proposedValue });
            else dependentsWorking[idx] = { ...dependentsWorking[idx], [t.field]: row.proposedValue };
          } else {
            payrollBucket[t.bucket] = { ...(payrollBucket[t.bucket] || payroll?.[t.bucket] || {}), [t.field]: row.proposedValue };
          }
        }
      }

      if (Object.keys(employeesDirect).length || Object.keys(employeesJsonb).length) {
        const { error: err } = await supabase.from("employees").update({ ...employeesDirect, ...employeesJsonb, updated_at: new Date().toISOString() }).eq("id", employee.id);
        if (err) throw err;
      }
      if (Object.keys(sensitiveDirect).length || Object.keys(sensitiveJsonb).length) {
        const { error: err } = await supabase.from("employee_sensitive_data").upsert({ employee_id: employee.id, ...sensitiveDirect, ...sensitiveJsonb, updated_at: new Date().toISOString() }, { onConflict: "employee_id" });
        if (err) throw err;
      }
      if (currentEmployment && Object.keys(employmentPatch).length) {
        const { error: err } = await supabase.from("employment_relationships").update({ ...employmentPatch, updated_at: new Date().toISOString() }).eq("id", currentEmployment.id);
        if (err) throw err;
      }
      if (Object.keys(payrollBucket).length || selected.some((r) => r.target.table === "employee_payroll_data" && r.target.bucket === "dependents")) {
        const { error: err } = await supabase.from("employee_payroll_data").upsert({ employee_id: employee.id, ...payrollBucket, dependents: dependentsWorking, updated_at: new Date().toISOString() }, { onConflict: "employee_id" });
        if (err) throw err;
      }

      await supabase.from("employee_timeline_events").insert({
        id: uid(), employee_id: employee.id, event_date: new Date().toISOString().slice(0, 10), event_type: "JMHZ_IMPORT",
        title: `Import z JMHZ dotazníku (verze ${version})`, description: `Zapsáno ${selected.length} polí po ruční kontrole.`, source: "MANUAL",
      });

      setSuccessMsg(`Zapsáno ${selected.length} polí do karty zaměstnance.`);
      setFileBuffer(null); setFileName(""); setExtractResult(null); setRows([]); setChecked({});
      onImported();
    } catch (e) {
      console.error(e);
      setError(e.message || "Zápis se nezdařil.");
    }
    setSaving(false);
  }

  return (
    <div>
      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
        <h2 className="font-semibold text-sm mb-3">Načíst JMHZ dotazník</h2>
        <p className="text-xs text-slate-500 mb-3">
          Nahrajte vyplněný PDF dotazník (JMHZ). Verzi dotazníku potvrďte ručně podle textu "Verze dokumentu ze dne..." na stránce PDF -
          appka ji sama nedomýšlí. Neznámá/nepodporovaná verze se vždy zastaví na ruční kontrolu, nikdy se tiše nezapíše.
        </p>
        <label className="block mb-3">
          <span className="block text-xs font-medium text-slate-500 mb-1">Soubor PDF</span>
          <input type="file" accept=".pdf" onChange={onFileChange} className="text-sm" />
        </label>
        {fileName && (
          <>
            <SelectFieldLocal
              label="Verze dotazníku (potvrďte podle textu v PDF)"
              value={version}
              onChange={setVersion}
              options={[{ value: "", label: "— vyberte —" }, ...versionOptions.map((v) => ({ value: v.value, label: v.label + (v.hasMapping ? "" : " (bez mapování polí)") }))]}
            />
            {candidates.length > 0 && <div className="text-xs text-emerald-700 mb-2">Navrženo podle metadat PDF: {candidates.join(", ")} - přesto prosím potvrďte ručně.</div>}
            {!version && (
              <div className="text-xs text-amber-700 mb-2">
                Appka nedokázala verzi poznat automaticky (v PDF chybí rozpoznatelný text "Verze dokumentu ze dne..."). Vyberte prosím verzi ručně výše - tlačítko níže je do té doby záměrně neaktivní.
              </div>
            )}
            <div className="flex justify-end">
              <button onClick={runExtraction} disabled={loadingExtract || !version} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md">
                {loadingExtract ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} {loadingExtract ? "Načítám..." : "Načíst podle vybrané verze"}
              </button>
            </div>
          </>
        )}
        {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md mt-3">{error}</div>}
        {successMsg && <div className="bg-emerald-50 text-emerald-700 text-sm px-3 py-2 rounded-md mt-3">{successMsg}</div>}
      </div>

      {extractResult?.status === "NEZNAMA_VERZIA" && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          <div className="flex items-center gap-1.5 font-medium mb-1"><ShieldAlert size={15} /> Neznámá nebo nemapovaná verze dotazníku</div>
          Pro verzi "{version}" zatím není k dispozici ověřená mapa polí - data se NEIMPORTOVALA. Zkontrolujte prosím verzi dotazníku ručně,
          nebo požádejte o rozšíření mapování v <code>src/lib/hr/jmhzPdf.js</code>.
        </div>
      )}

      {rows.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 font-semibold text-sm flex items-center justify-between flex-wrap gap-2">
            <span>Náhled a kontrola konfliktů ({rows.length} polí s odpovědí)</span>
            <button onClick={confirmImport} disabled={saving} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} {saving ? "Zapisuji..." : "Potvrdit a zapsat do karty"}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2"></th>
                  <th className="text-left px-3 py-2">Pole</th>
                  <th className="text-left px-3 py-2">Původní hodnota</th>
                  <th className="text-left px-3 py-2">Navrhovaná hodnota</th>
                  <th className="text-left px-3 py-2">Stav</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className={"border-t border-slate-100 " + (r.hasConflict ? "bg-amber-50" : "")}>
                    <td className="px-3 py-2">
                      <input type="checkbox" disabled={!r.writable} checked={!!checked[r.key]} onChange={() => toggleRow(r.key)} />
                    </td>
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{r.label}</td>
                    <td className="px-3 py-2 text-slate-500">{r.existingValue === "" || r.existingValue === null || r.existingValue === undefined ? "—" : (typeof r.existingValue === "boolean" ? (r.existingValue ? "Ano" : "Ne") : String(r.existingValue))}</td>
                    <td className="px-3 py-2 font-medium">{r.proposedDisplay ?? "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {!r.writable ? (
                        <span className="text-xs text-slate-400" title={r.blockedReason}>Nelze zapsat{r.blockedReason ? ` – ${r.blockedReason}` : ""}</span>
                      ) : r.hasConflict ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">Konflikt - zkontrolujte</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">V pořádku</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Lékařské prohlídky ---------------- */
/* Administrativne udaje - ZIADNA diagnoza (bod 4 zadania). Stav (VALID/
   EXPIRING/EXPIRED/UNKNOWN) sa POCITA (hrMedicalStatus.js), nikdy neuklada. */
function MedicalExamsTab({ employeeId, medicalExams, canEdit, onChanged }) {
  const [adding, setAdding] = useState(false);
  return (
    <div>
      {canEdit && !adding && (
        <div className="flex justify-end mb-3">
          <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md">
            <HeartPulse size={16} /> Přidat prohlídku
          </button>
        </div>
      )}
      {adding && <AddMedicalExamForm employeeId={employeeId} onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); onChanged(); }} />}
      {medicalExams.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-400 text-sm">Zatím žádná evidovaná prohlídka.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2">Typ</th>
                <th className="text-left px-4 py-2">Datum</th>
                <th className="text-left px-4 py-2">Platnost do</th>
                <th className="text-left px-4 py-2">Poskytovatel</th>
                <th className="text-left px-4 py-2">Stav</th>
              </tr>
            </thead>
            <tbody>
              {medicalExams.map((m) => (
                <tr key={m.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-medium">{m.exam_type || "—"}</td>
                  <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{fmtDate(m.exam_date)}</td>
                  <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{m.valid_until ? fmtDate(m.valid_until) : "—"}</td>
                  <td className="px-4 py-2 text-slate-500">{m.provider || "—"}</td>
                  <td className="px-4 py-2"><MedicalStatusBadge status={computeMedicalStatus(m.valid_until)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AddMedicalExamForm({ employeeId, onCancel, onSaved }) {
  const [f, setF] = useState({ exam_type: "", exam_date: "", valid_until: "", provider: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!f.exam_date) { setError("Vyplňte datum prohlídky."); return; }
    setSaving(true);
    setError("");
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { error: err } = await supabase.from("medical_examinations").insert({
        id: uid(), employee_id: employeeId, exam_type: f.exam_type.trim() || null, exam_date: f.exam_date,
        valid_until: f.valid_until || null, provider: f.provider.trim() || null, notes: f.notes.trim() || null,
        created_by: userData?.user?.id || null,
      });
      if (err) throw err;
      await supabase.from("employee_timeline_events").insert({
        id: uid(), employee_id: employeeId, event_date: f.exam_date, event_type: "MEDICAL_EXAM_ADDED",
        title: "Lékařská prohlídka", description: f.exam_type.trim() || undefined, source: "MANUAL",
      });
      onSaved();
    } catch (e) {
      console.error(e);
      setError(e.message || "Uložení se nezdařilo.");
    }
    setSaving(false);
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 mb-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4">
        <TextField label="Typ prohlídky" value={f.exam_type} onChange={(v) => setF({ ...f, exam_type: v })} />
        <DateFieldLocal label="Datum prohlídky" value={f.exam_date} onChange={(v) => setF({ ...f, exam_date: v })} />
        <DateFieldLocal label="Platnost do / další termín" value={f.valid_until} onChange={(v) => setF({ ...f, valid_until: v })} />
        <TextField label="Poskytovatel" value={f.provider} onChange={(v) => setF({ ...f, provider: v })} />
      </div>
      <TextAreaField label="Poznámka (administrativní, ne diagnóza)" value={f.notes} onChange={(v) => setF({ ...f, notes: v })} />
      {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md mb-2">{error}</div>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
        <button onClick={submit} disabled={saving} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md">{saving ? "Ukládám..." : "Uložit"}</button>
      </div>
    </div>
  );
}

function HistorieTab({ timeline }) {
  if (timeline.length === 0) return <div className="text-sm text-slate-400">Zatím žádné události.</div>;
  return (
    <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
      {timeline.map((t) => (
        <div key={t.id} className="px-4 py-3 flex gap-3">
          <div className="text-xs text-slate-400 whitespace-nowrap w-24 pt-0.5">{fmtDate(t.event_date)}</div>
          <div className="flex-1">
            <div className="text-sm font-medium flex items-center gap-2">
              {t.title}
              {t.source === "MANUAL_HISTORICAL_ENTRY" && <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-500 text-[10px] font-normal">ručně doplněno</span>}
            </div>
            {t.description && <div className="text-xs text-slate-500 mt-0.5">{t.description}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Audit (per zamestnanec) ---------------- */
/* Znovu POUZITA existujuca infrastruktura (audit_log tabulka, audit_trigger,
   HR_AUDIT_VIEW RLS z schema.sql 45.9) - toto je len SPRAVNE TVAROVANY
   citac pre HR tabulky. Existujuci globalny AuditLogView (App.jsx) cita
   old_value/new_value v tvare {data:{...}} (jsonb-blob konvencia ineho
   casti appky) - HR tabulky su VSAK plnohodnotne stlpce bez "data" wrapperu,
   takze ten citac by tu vzdy ukazal prazdny diff. Mechanizmus (RLS, trigger,
   ukladanie) je 100% zdielany, len rendering je specificky pre tento tvar. */
function AuditTab({ employee, employments, contractEvents, medicalExams, positions = [] }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);
  const [names, setNames] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const employmentIds = employments.map((e) => e.id);
      const contractEventIds = contractEvents.map((e) => e.id);
      const medicalIds = medicalExams.map((m) => m.id);
      const [docsRes, sigsRes] = await Promise.all([
        supabase.from("hr_documents").select("id").eq("employee_id", employee.id),
        supabase.from("hr_document_signatures").select("id, hr_document_id"),
      ]);
      const docIds = (docsRes.data || []).map((d) => d.id);
      const sigIds = (sigsRes.data || []).filter((s) => docIds.includes(s.hr_document_id)).map((s) => s.id);

      const entityIdSets = [
        { entity: "employees", ids: [employee.id] },
        { entity: "employment_relationships", ids: employmentIds },
        { entity: "employment_contract_events", ids: contractEventIds },
        { entity: "medical_examinations", ids: medicalIds },
        { entity: "hr_documents", ids: docIds },
        { entity: "hr_document_signatures", ids: sigIds },
      ].filter((s) => s.ids.length > 0);

      const allIds = Array.from(new Set(entityIdSets.flatMap((s) => s.ids)));
      if (allIds.length === 0) { setRows([]); setLoading(false); return; }

      const [logRes, profilesRes] = await Promise.all([
        supabase.from("audit_log").select("*").in("entity_id", allIds).order("created_at", { ascending: false }).limit(200),
        supabase.from("profiles").select("id, full_name"),
      ]);
      if (cancelled) return;
      if (logRes.error) { setError("Nepodařilo se načíst audit log."); setLoading(false); return; }
      setRows(logRes.data || []);
      setNames(Object.fromEntries((profilesRes.data || []).map((p) => [p.id, p.full_name])));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [employee.id, employments, medicalExams]);

  if (loading) return <div className="text-center text-slate-400 py-10"><Loader2 className="animate-spin mx-auto mb-2" size={24} /> Načítám...</div>;
  if (error) return <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md">{error}</div>;
  if (rows.length === 0) return <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-400 text-sm">Zatím žádné zaznamenané změny.</div>;

  const ACTION_LABEL = { insert: "Vytvořeno", update: "Upraveno", delete: "Smazáno" };
  const ENTITY_LABEL = {
    employees: "Zaměstnanec", employment_relationships: "Pracovní poměr", employment_contract_events: "Dodatek/prodloužení",
    medical_examinations: "Lékařská prohlídka", hr_documents: "Dokument", hr_document_signatures: "Podpis dokumentu",
  };

  function diffFlat(oldVal, newVal) {
    const before = oldVal || {};
    const after = newVal || {};
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
    return keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map((k) => ({ key: k, before: before[k], after: after[k] }));
  }
  function valText(v) {
    if (v === undefined) return "—";
    if (v === null || v === "") return "(prázdné)";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  }
  // Cistě prezentační: position_id v audit diffu je pro clověka nečitelné
  // UUID. Pokud jej lze dohledat v aktuálně nactenych pozicich, zobrazi sa
  // misto neho nazov pozicie - surova hodnota v DB (audit_log) sa tymto
  // nemeni, len sa inak vykresli. Ked sa ID nepodari dohladat (napr. pozice
  // uz neexistuje), zobrazi sa povodna surova hodnota - audit nesmie
  // informaciu skryt ani zahodit.
  function positionName(id) {
    if (!id) return null;
    const p = positions.find((x) => x.id === id);
    return p ? (p.code ? `${p.code} – ${p.name}` : p.name) : null;
  }
  function diffKeyLabel(key) {
    return key === "position_id" ? "Pozice" : key;
  }
  function diffValText(key, v) {
    if (key === "position_id") {
      const name = positionName(v);
      if (name) return name;
    }
    return valText(v);
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
          <tr>
            <th className="text-left px-3 py-2">Datum a čas</th>
            <th className="text-left px-3 py-2">Entita</th>
            <th className="text-left px-3 py-2">Akce</th>
            <th className="text-left px-3 py-2">Kdo</th>
            <th className="text-left px-3 py-2">Změna</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const diff = r.action === "update" ? diffFlat(r.old_value, r.new_value) : [];
            return (
              <tr key={r.id} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2 whitespace-nowrap text-slate-500">{r.created_at ? new Date(r.created_at).toLocaleString("cs-CZ") : "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap">{ENTITY_LABEL[r.entity] || r.entity}</td>
                <td className="px-3 py-2 whitespace-nowrap">{ACTION_LABEL[r.action] || r.action}</td>
                <td className="px-3 py-2 whitespace-nowrap text-slate-500">{r.changed_by ? (names[r.changed_by] || "Neznámý uživatel") : "Automatizace"}</td>
                <td className="px-3 py-2">
                  {r.action === "insert" ? <span className="text-slate-400">Vytvořený záznam</span> : diff.length === 0 ? <span className="text-slate-400">—</span> : (
                    <div className="space-y-1">
                      {diff.slice(0, 6).map((d) => (
                        <div key={d.key} className="text-xs"><span className="font-medium">{diffKeyLabel(d.key)}</span>: {diffValText(d.key, d.before)} → <span className="text-teal-700">{diffValText(d.key, d.after)}</span></div>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Pozice ---------------- */

function PositionsTab({ permissions }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [positions, setPositions] = useState([]);
  const [adding, setAdding] = useState(false);
  const canEdit = hasPerm(permissions, "HR_EDIT");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase.from("positions").select("*").order("code").order("name");
    if (err) { setError("Nepodařilo se načíst pozice."); setLoading(false); return; }
    setPositions(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleActive(p) {
    await supabase.from("positions").update({ active: !p.active, updated_at: new Date().toISOString() }).eq("id", p.id);
    load();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Pozice</h1>
        {canEdit && !adding && <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md"><Plus size={16} /> Nová pozice</button>}
      </div>
      <p className="text-xs text-slate-400 mb-3">Zatím jen název a kód (např. HI-002 – Skladník) - popis pracovního místa se doplní později, jakmile budou k dispozici šablony.</p>
      {adding && <AddPositionForm onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      {loading ? (
        <div className="text-center text-slate-400 py-10"><Loader2 className="animate-spin mx-auto mb-2" size={24} /> Načítám...</div>
      ) : error ? (
        <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md">{error}</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr><th className="text-left px-4 py-2">Kód</th><th className="text-left px-4 py-2">Název</th><th className="text-left px-4 py-2">Stav</th><th></th></tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{p.code || "—"}</td>
                  <td className="px-4 py-2 font-medium">{p.name}</td>
                  <td className="px-4 py-2">
                    {canEdit ? (
                      <button onClick={() => toggleActive(p)} className={"px-2 py-0.5 rounded-full text-xs font-medium " + (p.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500")}>
                        {p.active ? "Aktivní" : "Neaktivní"}
                      </button>
                    ) : (
                      <span className={"px-2 py-0.5 rounded-full text-xs font-medium " + (p.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500")}>{p.active ? "Aktivní" : "Neaktivní"}</span>
                    )}
                  </td>
                  <td></td>
                </tr>
              ))}
              {positions.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">Zatím žádné pozice.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AddPositionForm({ onCancel, onSaved }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!name.trim()) { setError("Vyplňte název pozice."); return; }
    setSaving(true);
    setError("");
    const { error: err } = await supabase.from("positions").insert({ id: uid(), code: code.trim() || null, name: name.trim(), active: true });
    if (err) { setError(err.message); setSaving(false); return; }
    onSaved();
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 mb-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <TextField label="Kód (např. HI-002)" value={code} onChange={setCode} />
        <TextField label="Název pozice" value={name} onChange={setName} />
      </div>
      {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md mb-2">{error}</div>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
        <button onClick={submit} disabled={saving} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md">{saving ? "Ukládám..." : "Uložit"}</button>
      </div>
    </div>
  );
}

/* ---------------- Šablony dokumentů ---------------- */
/* Zivotny cyklus (schema.sql 45.4): kazda NAHRANA verzia sa hned overi proti
   KNOWN_TEMPLATE_KEYS (neznamy tag = sablona sa neda pouzit, kym niekto tag
   bud odstrani zo sablony, alebo ho pridaju do allowlistu v kode). Klasifikacia
   citlivosti (required_permissions) je VZDY explicitna volba HR pri nahrani -
   ziadna automaticka analyza obsahu (bod 3 zadania). "Vytvořit dokument" v
   zalozke zamestnanca ponuka len sablony so status='SCHVALENA'. */

function TemplatesTab({ permissions }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [templates, setTemplates] = useState([]);
  const [versionsByTemplate, setVersionsByTemplate] = useState(new Map());
  const [uploading, setUploading] = useState(false);
  const canApprove = hasPerm(permissions, "HR_DOCUMENT_APPROVE");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data: tpls, error: tErr } = await supabase.from("hr_document_templates").select("*").order("doc_type");
    if (tErr) { setError("Nepodařilo se načíst šablony."); setLoading(false); return; }
    setTemplates(tpls || []);
    if ((tpls || []).length > 0) {
      const { data: vers } = await supabase.from("hr_document_template_versions").select("*").in("template_id", tpls.map((t) => t.id)).order("version_number", { ascending: false });
      const map = new Map();
      (vers || []).forEach((v) => { const arr = map.get(v.template_id) || []; arr.push(v); map.set(v.template_id, arr); });
      setVersionsByTemplate(map);
    } else {
      setVersionsByTemplate(new Map());
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function approveVersion(template, version) {
    const { data: userData } = await supabase.auth.getUser();
    const { error: vErr } = await supabase.from("hr_document_template_versions").update({ mapping_status: "SCHVALENA" }).eq("id", version.id);
    if (vErr) { window.alert(vErr.message); return; }
    const { error: tErr } = await supabase.from("hr_document_templates").update({
      status: "SCHVALENA", current_version_id: version.id, approved_by: userData?.user?.id || null, approved_at: new Date().toISOString(),
    }).eq("id", template.id);
    if (tErr) { window.alert(tErr.message); return; }
    load();
  }

  async function retireTemplate(template) {
    if (!window.confirm(`Vyřadit šablonu "${template.name}"? Dosud vygenerované dokumenty zůstanou beze změny, jen se přestane nabízet pro nové generování.`)) return;
    await supabase.from("hr_document_templates").update({ status: "VYRAZENA", active: false }).eq("id", template.id);
    load();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Šablony dokumentů</h1>
      </div>
      {hasPerm(permissions, "HR_DOCUMENT_APPROVE") && (
        <UploadTemplateForm uploading={uploading} setUploading={setUploading} onUploaded={load} templates={templates} />
      )}
      {loading ? (
        <div className="text-center text-slate-400 py-10"><Loader2 className="animate-spin mx-auto mb-2" size={24} /> Načítám...</div>
      ) : error ? (
        <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md">{error}</div>
      ) : templates.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
          <FileText className="mx-auto mb-3 text-slate-300" size={32} />
          <div className="text-slate-600 text-sm font-medium">Zatím žádné šablony</div>
          <div className="text-slate-400 text-xs mt-1 max-w-md mx-auto">Nahrajte .docx vzor výše - text s {"{{"}zástupnými značkami{"}}"} se automaticky ověří proti seznamu podporovaných polí.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => {
            const versions = versionsByTemplate.get(t.id) || [];
            const currentVersion = versions.find((v) => v.id === t.current_version_id);
            return (
              <div key={t.id} className="bg-white border border-slate-200 rounded-lg p-4">
                <div className="flex justify-between items-start flex-wrap gap-2">
                  <div>
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-slate-500">{DOC_TYPE_LABELS[t.doc_type] || t.doc_type}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <TemplateStatusBadge status={t.status} />
                    {t.status !== "VYRAZENA" && canApprove && (
                      <button onClick={() => retireTemplate(t)} className="text-xs text-red-500 hover:text-red-700 underline underline-offset-2">Vyřadit</button>
                    )}
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  {versions.map((v) => (
                    <div key={v.id} className={"flex items-center justify-between gap-2 text-sm px-3 py-2 rounded-md " + (v.id === t.current_version_id ? "bg-emerald-50" : "bg-slate-50")}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium whitespace-nowrap">v{v.version_number}</span>
                        {v.id === t.current_version_id && <span className="text-xs text-emerald-700 whitespace-nowrap">(aktivní)</span>}
                        <span className="text-xs text-slate-400 truncate">{v.required_permissions?.length ? v.required_permissions.join(", ") : "výchozí ochrana"}</span>
                      </div>
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <MappingStatusBadge status={v.mapping_status} />
                        {v.mapping_status === "SCHVALENA" && v.id !== t.current_version_id && canApprove && (
                          <button onClick={() => approveVersion(t, v)} className="text-xs text-teal-700 hover:text-teal-900 underline underline-offset-2">Aktivovat</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TemplateStatusBadge({ status }) {
  const map = {
    NAHRANA: "bg-slate-100 text-slate-600", K_MAPOVANI: "bg-amber-100 text-amber-700", KE_SCHVALENI: "bg-amber-100 text-amber-700",
    SCHVALENA: "bg-emerald-100 text-emerald-700", VYRAZENA: "bg-slate-200 text-slate-400",
  };
  const labels = { NAHRANA: "Nahraná", K_MAPOVANI: "K mapování", KE_SCHVALENI: "Ke schválení", SCHVALENA: "Schválená", VYRAZENA: "Vyřazená" };
  return <span className={"px-2 py-0.5 rounded-full text-xs font-medium " + (map[status] || map.NAHRANA)}>{labels[status] || status}</span>;
}
function MappingStatusBadge({ status }) {
  const map = { K_MAPOVANI: "bg-red-100 text-red-700", ROZPRACOVANA: "bg-amber-100 text-amber-700", SCHVALENA: "bg-emerald-100 text-emerald-700" };
  const labels = { K_MAPOVANI: "Neznámé tagy", ROZPRACOVANA: "Rozpracovaná", SCHVALENA: "Tagy OK" };
  return <span className={"px-2 py-0.5 rounded-full text-xs font-medium " + (map[status] || map.K_MAPOVANI)}>{labels[status] || status}</span>;
}

const TEMPLATE_SENSITIVITY_OPTIONS = [
  { value: "HR_VIEW_SENSITIVE", label: "Osobní identifikátory (rodné číslo, doklad...)" },
  { value: "HR_VIEW_PAYROLL", label: "Mzdové/rodinné podklady" },
  { value: "HR_VIEW_MEDICAL_ADMIN", label: "Evidence lékařských prohlídek" },
  { value: "HR_ADMIN", label: "Jen administrátor" },
];

function UploadTemplateForm({ uploading, setUploading, onUploaded, templates }) {
  const [docType, setDocType] = useState("platovy_vymer");
  const [name, setName] = useState("");
  const [requiredPerms, setRequiredPerms] = useState(["HR_VIEW_SENSITIVE"]);
  const [file, setFile] = useState(null);
  const [checkResult, setCheckResult] = useState(null);
  const [error, setError] = useState("");

  async function onFileChange(e) {
    const f = e.target.files?.[0];
    setFile(f || null);
    setCheckResult(null);
    setError("");
    if (!f) return;
    try {
      const ab = await f.arrayBuffer();
      const { used, unknown, ok } = validateTemplateKeysAgainstAllowlist(ab, KNOWN_TEMPLATE_KEYS);
      setCheckResult({ used, unknown, ok });
    } catch (err) {
      setError("Soubor se nepodařilo přečíst jako .docx šablonu s {{tagy}}: " + (err.message || err));
    }
  }

  function togglePerm(p) {
    setRequiredPerms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  async function submit() {
    if (!file || !checkResult) { setError("Nejprve vyberte .docx soubor."); return; }
    if (!checkResult.ok) { setError("Šablonu nelze nahrát - obsahuje nemapované tagy (viz níže). Opravte šablonu nebo tagy odstraňte."); return; }
    if (!name.trim()) { setError("Vyplňte název šablony."); return; }
    setUploading(true);
    setError("");
    try {
      const ab = await file.arrayBuffer();
      const contentHash = await sha256Hex(ab);
      const { data: userData } = await supabase.auth.getUser();

      let template = templates.find((t) => t.doc_type === docType && t.name === name.trim());
      let templateId = template?.id;
      if (!templateId) {
        templateId = uid();
        const { error: tErr } = await supabase.from("hr_document_templates").insert({ id: templateId, doc_type: docType, name: name.trim(), active: true, status: "NAHRANA" });
        if (tErr) throw tErr;
      }
      const { data: existingVersions } = await supabase.from("hr_document_template_versions").select("version_number").eq("template_id", templateId).order("version_number", { ascending: false }).limit(1);
      const nextVersion = (existingVersions?.[0]?.version_number || 0) + 1;

      const storagePath = `sablony/${templateId}/v${nextVersion}.docx`;
      const { error: upErr } = await supabase.storage.from(HR_DOKUMENTY_BUCKET).upload(storagePath, file, { contentType: DOCX_MIME });
      if (upErr) throw upErr;

      const versionId = uid();
      const { error: vErr } = await supabase.from("hr_document_template_versions").insert({
        id: versionId, template_id: templateId, version_number: nextVersion, file_path: storagePath,
        variables_schema: { keys: checkResult.used }, effective_date: new Date().toISOString().slice(0, 10),
        uploaded_by: userData?.user?.id || null, content_hash: contentHash,
        mapping_status: "SCHVALENA", required_permissions: requiredPerms,
      });
      if (vErr) throw vErr;

      await supabase.from("hr_document_templates").update({ status: "KE_SCHVALENI" }).eq("id", templateId).eq("status", "NAHRANA");

      setFile(null); setCheckResult(null); setName("");
      onUploaded();
    } catch (e) {
      console.error(e);
      setError(e.message || "Nahrání se nezdařilo.");
    }
    setUploading(false);
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
      <h2 className="font-semibold text-sm mb-3">Nahrát novou šablonu / verzi</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <SelectFieldLocal label="Typ dokumentu" value={docType} onChange={setDocType} options={DOC_TYPE_OPTIONS} />
        <TextField label="Název šablony" value={name} onChange={setName} />
      </div>
      <label className="block mb-3">
        <span className="block text-xs font-medium text-slate-500 mb-1">Soubor .docx (obsahuje {"{{"}tagy{"}}"})</span>
        <input type="file" accept=".docx" onChange={onFileChange} className="text-sm" />
      </label>
      <div className="mb-3">
        <span className="block text-xs font-medium text-slate-500 mb-1.5">Klasifikace citlivosti této verze (explicitní volba HR, ne automatická)</span>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {TEMPLATE_SENSITIVITY_OPTIONS.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={requiredPerms.includes(o.value)} onChange={() => togglePerm(o.value)} /> {o.label}
            </label>
          ))}
        </div>
      </div>
      {checkResult && (
        <div className={"text-xs px-3 py-2 rounded-md mb-3 " + (checkResult.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>
          {checkResult.ok ? (
            <>Rozpoznáno {checkResult.used.length} tagů, všechny podporované: {checkResult.used.join(", ") || "—"}</>
          ) : (
            <>Nepodporované tagy: <strong>{checkResult.unknown.join(", ")}</strong>. Podporované: {KNOWN_TEMPLATE_KEYS.join(", ")}</>
          )}
        </div>
      )}
      {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md mb-2">{error}</div>}
      <div className="flex justify-end">
        <button onClick={submit} disabled={uploading || !checkResult?.ok} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-md">
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} {uploading ? "Nahrávám..." : "Nahrát šablonu"}
        </button>
      </div>
    </div>
  );
}

/* ---------------- Nastavení (HR_ADMIN) ---------------- */

function SettingsTab() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase.from("hr_permissions").select("*").order("user_email");
    if (err) { setError("Nepodařilo se načíst oprávnění."); setLoading(false); return; }
    setRows(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function savePermissions(row, permissions) {
    await supabase.from("hr_permissions").upsert({ id: row.id || uid(), user_email: row.user_email, permissions }, { onConflict: "user_email" });
    load();
  }

  if (loading) return <div className="text-center text-slate-400 py-10"><Loader2 className="animate-spin mx-auto mb-2" size={24} /> Načítám...</div>;
  if (error) return <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md">{error}</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Nastavení přístupů</h1>
        {!adding && <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md"><UserPlus size={16} /> Přidat osobu</button>}
      </div>
      {adding && <AddPermissionForm onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      <div className="space-y-3">
        {rows.map((row) => <PermissionRow key={row.id} row={row} onSave={(p) => savePermissions(row, p)} />)}
        {rows.length === 0 && <div className="text-sm text-slate-400">Zatím nikdo nemá přiřazená oprávnění.</div>}
      </div>
    </div>
  );
}

function AddPermissionForm({ onCancel, onSaved }) {
  const [email, setEmail] = useState("");
  const [selected, setSelected] = useState(["HR_VIEW_BASIC"]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!email.trim()) { setError("Vyplňte e-mail."); return; }
    setSaving(true);
    setError("");
    const { error: err } = await supabase.from("hr_permissions").insert({ id: uid(), user_email: email.trim().toLowerCase(), permissions: selected });
    if (err) { setError(err.message.includes("duplicate") ? "Tento e-mail už má oprávnění přiřazená." : err.message); setSaving(false); return; }
    onSaved();
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 mb-3">
      <TextField label="E-mail uživatele" value={email} onChange={setEmail} />
      <PermissionCheckboxes selected={selected} onChange={setSelected} />
      {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md mt-2 mb-2">{error}</div>}
      <div className="flex justify-end gap-2 mt-2">
        <button onClick={onCancel} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
        <button onClick={submit} disabled={saving} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md">{saving ? "Ukládám..." : "Uložit"}</button>
      </div>
    </div>
  );
}

function PermissionRow({ row, onSave }) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(row.permissions || []);

  if (!editing) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex justify-between items-start flex-wrap gap-2">
        <div>
          <div className="font-medium text-sm">{row.user_email}</div>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {(row.permissions || []).map((p) => <span key={p} className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600">{p}</span>)}
            {(row.permissions || []).length === 0 && <span className="text-xs text-slate-400">Žádná oprávnění</span>}
          </div>
        </div>
        <button onClick={() => { setSelected(row.permissions || []); setEditing(true); }} className="flex items-center gap-1 text-sm text-teal-700 hover:text-teal-900"><Pencil size={14} /> Upravit</button>
      </div>
    );
  }
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="font-medium text-sm mb-2">{row.user_email}</div>
      <PermissionCheckboxes selected={selected} onChange={setSelected} />
      <div className="flex justify-end gap-2 mt-2">
        <button onClick={() => setEditing(false)} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
        <button onClick={() => { onSave(selected); setEditing(false); }} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Uložit</button>
      </div>
    </div>
  );
}

function PermissionCheckboxes({ selected, onChange }) {
  function toggle(p) {
    onChange(selected.includes(p) ? selected.filter((x) => x !== p) : [...selected, p]);
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mt-2">
      {HR_PERMISSION_OPTIONS.map((o) => (
        <label key={o.value} className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} /> {o.label}
        </label>
      ))}
    </div>
  );
}

/* ---------------- Lokalne formularove pomocky (rovnaky vizual ako zvysok appky, viz TerminFormFields v KvalitaView.jsx) ---------------- */

function TextField({ label, value, onChange }) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
    </label>
  );
}
function TextAreaField({ label, value, onChange }) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
    </label>
  );
}
function DateFieldLocal({ label, value, onChange }) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>
      <input type="date" value={value || ""} onChange={(e) => onChange(e.target.value)} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
    </label>
  );
}
function SelectFieldLocal({ label, value, onChange, options }) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
