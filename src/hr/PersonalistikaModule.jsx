import React, { useState, useEffect, useCallback } from "react";
import { Loader2, AlertCircle, Users2, UserPlus, ArrowLeft, ShieldAlert, Settings, LayoutDashboard, FileText, Pencil, X, CheckCircle2 } from "lucide-react";
import { supabase } from "../supabaseClient.js";
import { uid, skDateStrFromIso } from "../lib/utils.js";

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
  { key: "sablony", label: "Šablony dokumentů", icon: FileText },
  { key: "nastaveni", label: "Nastavení", icon: Settings, adminOnly: true },
];

function HrSubNav({ tab, onChange, permissions }) {
  return (
    <div className="flex flex-wrap gap-1.5 bg-white border border-slate-200 rounded-lg p-1.5 mb-4">
      {HR_SUB_TABS.filter((t) => !t.adminOnly || hasPerm(permissions, "HR_ADMIN")).map((t) => {
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
      {tab === "sablony" && <TemplatesPlaceholder />}
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [empRes, empmRes] = await Promise.all([
        supabase.from("employees").select("id, first_name, last_name, title, active").eq("active", true),
        supabase.from("employment_relationships").select("id, employee_id, status, fixed_term_end_date, employment_type").in("status", ["ACTIVE", "PLANNED", "NOTICE_PERIOD"]),
      ]);
      if (cancelled) return;
      if (empRes.error || empmRes.error) { setError("Nepodařilo se načíst přehled."); setLoading(false); return; }
      setEmployees(empRes.data || []);
      setEmployments(empmRes.data || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="text-center text-slate-400 py-10"><Loader2 className="animate-spin mx-auto mb-2" size={24} /> Načítám...</div>;
  if (error) return <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md">{error}</div>;

  const noticePeriod = employments.filter((e) => e.status === "NOTICE_PERIOD").length;
  const ending30 = employments.filter((e) => { const d = daysUntilIso(e.fixed_term_end_date); return d !== null && d >= 0 && d <= 30; });
  const ending60 = employments.filter((e) => { const d = daysUntilIso(e.fixed_term_end_date); return d !== null && d >= 0 && d <= 60; });
  const ending90 = employments.filter((e) => { const d = daysUntilIso(e.fixed_term_end_date); return d !== null && d >= 0 && d <= 90; });

  const byEmployeeId = new Map(employees.map((e) => [e.id, e]));

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Aktivní zaměstnanci" value={employees.length} />
        <StatCard label="Smlouvy do 30 dnů" value={ending30.length} alert={ending30.length > 0} />
        <StatCard label="Smlouvy do 60 dnů" value={ending60.length} />
        <StatCard label="Smlouvy do 90 dnů" value={ending90.length} />
        <StatCard label="Ve výpovědní lhůtě" value={noticePeriod} alert={noticePeriod > 0} />
      </div>
      {ending90.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 font-semibold text-sm">Blížící se konec smlouvy (do 90 dnů)</div>
          <table className="w-full text-sm">
            <tbody>
              {ending90
                .slice()
                .sort((a, b) => daysUntilIso(a.fixed_term_end_date) - daysUntilIso(b.fixed_term_end_date))
                .map((em) => {
                  const e = byEmployeeId.get(em.employee_id);
                  const d = daysUntilIso(em.fixed_term_end_date);
                  return (
                    <tr key={em.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => onOpenEmployee(em.employee_id)}>
                      <td className="px-4 py-2 font-medium">{e ? fullName(e) : "?"}</td>
                      <td className="px-4 py-2 text-slate-500">Konec: {fmtDate(em.fixed_term_end_date)}</td>
                      <td className={"px-4 py-2 text-right " + (d <= 30 ? "text-red-600 font-medium" : "text-amber-600")}>za {d} dní</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
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

function EmployeesListTab({ mode, permissions, onOpen }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [employees, setEmployees] = useState([]);
  const [employmentsByEmployee, setEmploymentsByEmployee] = useState(new Map());
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const empRes = await supabase.from("employees").select("*").eq("active", mode === "active").order("last_name");
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
  }, [mode]);

  useEffect(() => { load(); }, [load]);

  const filtered = employees.filter((e) => !search.trim() || fullName(e).toLowerCase().includes(search.trim().toLowerCase()));

  if (creating) {
    return <EmployeeCreateForm permissions={permissions} onCancel={() => setCreating(false)} onCreated={(id) => { setCreating(false); load(); onOpen(id); }} />;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-xl font-semibold">{mode === "active" ? "Zaměstnanci" : "Bývalí zaměstnanci"}</h1>
        {mode === "active" && hasPerm(permissions, "HR_EDIT") && (
          <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md">
            <UserPlus size={16} /> Nový zaměstnanec
          </button>
        )}
      </div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Hledat jméno..."
        className="w-full sm:w-80 border border-slate-200 rounded-md px-3 py-2 text-sm mb-3"
      />
      {loading ? (
        <div className="text-center text-slate-400 py-10"><Loader2 className="animate-spin mx-auto mb-2" size={24} /> Načítám...</div>
      ) : error ? (
        <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md">{error}</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden overflow-x-auto">
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
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">{mode === "active" ? "Zatím žádní zaměstnanci." : "Žádní bývalí zaměstnanci."}</td></tr>
              )}
            </tbody>
          </table>
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
    workplace: "", weekly_hours: "40",
  };
}

function EmployeeCreateForm({ permissions, onCancel, onCreated }) {
  const [f, setF] = useState(emptyEmployeeForm());
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
          position_id: f.position_id || null,
          workplace: f.workplace.trim() || null,
          weekly_hours: f.weekly_hours ? Number(f.weekly_hours) : null,
        });
        if (emErr) throw emErr;
        await supabase.from("employment_contract_events").insert({
          id: uid(), employment_id: employmentId, event_type: "CREATED", event_date: f.start_date,
          valid_from: f.start_date, valid_to: f.employment_type === "doba_urcita" ? (f.fixed_term_end_date || null) : null,
        });
      }

      await supabase.from("employee_timeline_events").insert({
        id: uid(), employee_id: employeeId, event_date: f.start_date || new Date().toISOString().slice(0, 10),
        event_type: "EMPLOYEE_CREATED", title: "Založen personální spis", source: "MANUAL",
      });

      onCreated(employeeId);
    } catch (e) {
      console.error(e);
      setError(e.message || "Uložení se nezdařilo.");
    }
    setSaving(false);
  }

  return (
    <div>
      <button onClick={onCancel} className="text-sm text-slate-500 flex items-center gap-1 hover:text-slate-800 mb-3"><ArrowLeft size={14} /> Zpět na seznam</button>
      <h1 className="text-xl font-semibold mb-4">Nový zaměstnanec</h1>

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
          <p className="text-xs text-amber-700 mb-3">Viditelné jen pro uživatele s oprávněním HR_VIEW_SENSITIVE.</p>
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
          <DateFieldLocal label="Datum nástupu" value={f.start_date} onChange={(v) => set({ start_date: v })} />
          <SelectFieldLocal label="Typ smlouvy" value={f.employment_type} onChange={(v) => set({ employment_type: v })} options={[{ value: "doba_neurcita", label: "Doba neurčitá" }, { value: "doba_urcita", label: "Doba určitá" }]} />
          {f.employment_type === "doba_urcita" && <DateFieldLocal label="Konec smlouvy" value={f.fixed_term_end_date} onChange={(v) => set({ fixed_term_end_date: v })} />}
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
  { key: "historie", label: "Historie" },
];

function EmployeeDetail({ id, permissions, onBack }) {
  const [detailTab, setDetailTab] = useState("prehled");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [employee, setEmployee] = useState(null);
  const [sensitive, setSensitive] = useState(null);
  const [employments, setEmployments] = useState([]);
  const [positions, setPositions] = useState([]);
  const [timeline, setTimeline] = useState([]);

  const canEdit = hasPerm(permissions, "HR_EDIT");
  const canSensitive = hasPerm(permissions, "HR_VIEW_SENSITIVE");

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
    setEmployments(empmRes.data || []);
    setPositions(posRes.data || []);
    setTimeline(tlRes.data || []);
    if (canSensitive) {
      const { data } = await supabase.from("employee_sensitive_data").select("*").eq("employee_id", id).maybeSingle();
      setSensitive(data || null);
    }
    setLoading(false);
  }, [id, canSensitive]);

  useEffect(() => { load(); }, [load]);

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
        <span className={"px-2.5 py-1 rounded-full text-xs font-medium " + (employee.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500")}>
          {employee.active ? "Aktivní" : "Bývalý zaměstnanec"}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-slate-200 mb-4">
        {DETAIL_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setDetailTab(t.key)}
            className={"px-3 py-2 text-sm font-medium border-b-2 -mb-px " + (detailTab === t.key ? "border-teal-600 text-teal-700" : "border-transparent text-slate-500 hover:text-slate-800")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {detailTab === "prehled" && <PrehledDetailTab employee={employee} currentEmployment={currentEmployment} positionLabel={positionLabel} />}
      {detailTab === "osobni" && <OsobniUdajeTab employee={employee} sensitive={sensitive} canEdit={canEdit} canSensitive={canSensitive} onSaved={load} />}
      {detailTab === "pomer" && <PracovniPomerTab employeeId={id} employments={employments} positions={positions} positionLabel={positionLabel} canEdit={canEdit} onChanged={load} />}
      {detailTab === "historie" && <HistorieTab timeline={timeline} />}
    </div>
  );
}

function PrehledDetailTab({ employee, currentEmployment, positionLabel }) {
  const endDays = currentEmployment ? daysUntilIso(currentEmployment.fixed_term_end_date) : null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h2 className="font-semibold text-sm mb-3">Pracovní poměr</h2>
        {currentEmployment ? (
          <dl className="text-sm space-y-1.5">
            <Row label="Pozice" value={positionLabel(currentEmployment.position_id)} />
            <Row label="Nástup" value={fmtDate(currentEmployment.start_date)} />
            <Row label="Typ" value={currentEmployment.employment_type === "doba_urcita" ? "Doba určitá" : "Doba neurčitá"} />
            {currentEmployment.fixed_term_end_date && <Row label="Konec smlouvy" value={fmtDate(currentEmployment.fixed_term_end_date)} />}
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
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h2 className="font-semibold text-sm mb-3">Kontakt</h2>
        <dl className="text-sm space-y-1.5">
          <Row label="Telefon" value={employee.phone || "—"} />
          <Row label="E-mail" value={employee.private_email || "—"} />
          <Row label="Adresa" value={[employee.permanent_address?.ulice, employee.permanent_address?.mesto].filter(Boolean).join(", ") || "—"} />
        </dl>
      </div>
    </div>
  );
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

function PracovniPomerTab({ employeeId, employments, positions, positionLabel, canEdit, onChanged }) {
  const [addingNew, setAddingNew] = useState(false);
  const [endingId, setEndingId] = useState(null);
  const [extendingId, setExtendingId] = useState(null);

  return (
    <div>
      {canEdit && !addingNew && (
        <div className="flex justify-end mb-3">
          <button onClick={() => setAddingNew(true)} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md">
            <UserPlus size={16} /> Nový pracovní poměr
          </button>
        </div>
      )}
      {addingNew && <NewEmploymentForm employeeId={employeeId} positions={positions} onCancel={() => setAddingNew(false)} onSaved={() => { setAddingNew(false); onChanged(); }} />}
      <div className="space-y-3">
        {employments.map((em) => (
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
              {em.status === "ENDED" && <Row label="Důvod ukončení" value={em.termination_reason || "—"} />}
            </dl>
            {canEdit && ["ACTIVE", "NOTICE_PERIOD"].includes(em.status) && (
              <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
                {em.employment_type === "doba_urcita" && (
                  extendingId === em.id
                    ? <ExtendEmploymentForm employment={em} onCancel={() => setExtendingId(null)} onSaved={() => { setExtendingId(null); onChanged(); }} />
                    : <button onClick={() => setExtendingId(em.id)} className="text-sm text-teal-700 hover:text-teal-900">Prodloužit smlouvu</button>
                )}
                {endingId === em.id
                  ? null
                  : <button onClick={() => setEndingId(em.id)} className="text-sm text-red-600 hover:text-red-800">Ukončit pracovní poměr</button>}
              </div>
            )}
            {endingId === em.id && <EndEmploymentForm employment={em} onCancel={() => setEndingId(null)} onSaved={() => { setEndingId(null); onChanged(); }} />}
          </div>
        ))}
        {employments.length === 0 && <div className="text-sm text-slate-400">Žádný pracovní poměr.</div>}
      </div>
    </div>
  );
}

function NewEmploymentForm({ employeeId, positions, onCancel, onSaved }) {
  const [f, setF] = useState({ position_id: "", start_date: "", employment_type: "doba_neurcita", fixed_term_end_date: "", workplace: "", weekly_hours: "40" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!f.start_date) { setError("Vyplňte datum nástupu."); return; }
    setSaving(true);
    setError("");
    try {
      const employmentId = uid();
      const { error: emErr } = await supabase.from("employment_relationships").insert({
        id: employmentId, employee_id: employeeId, status: "ACTIVE", employment_type: f.employment_type,
        start_date: f.start_date, fixed_term_end_date: f.employment_type === "doba_urcita" ? (f.fixed_term_end_date || null) : null,
        position_id: f.position_id || null, workplace: f.workplace.trim() || null, weekly_hours: f.weekly_hours ? Number(f.weekly_hours) : null,
      });
      if (emErr) throw emErr;
      await supabase.from("employment_contract_events").insert({
        id: uid(), employment_id: employmentId, event_type: "CREATED", event_date: f.start_date,
        valid_from: f.start_date, valid_to: f.employment_type === "doba_urcita" ? (f.fixed_term_end_date || null) : null,
      });
      await supabase.from("employee_timeline_events").insert({
        id: uid(), employee_id: employeeId, event_date: f.start_date, event_type: "EMPLOYMENT_CREATED", title: "Nový pracovní poměr", source: "MANUAL",
      });
      // predchadzajuci aktivny pracovny pomer (ak existoval) sa rucne neuzatvara -
      // HR to musi urobit vedome cez "Ukoncit pracovni pomer", aby sa nestratil dovod/datum ukoncenia.
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
        <DateFieldLocal label="Datum nástupu" value={f.start_date} onChange={(v) => setF({ ...f, start_date: v })} />
        <SelectFieldLocal label="Typ smlouvy" value={f.employment_type} onChange={(v) => setF({ ...f, employment_type: v })} options={[{ value: "doba_neurcita", label: "Doba neurčitá" }, { value: "doba_urcita", label: "Doba určitá" }]} />
        {f.employment_type === "doba_urcita" && <DateFieldLocal label="Konec smlouvy" value={f.fixed_term_end_date} onChange={(v) => setF({ ...f, fixed_term_end_date: v })} />}
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

function ExtendEmploymentForm({ employment, onCancel, onSaved }) {
  const [newEnd, setNewEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!newEnd) { setError("Vyplňte nové datum konce."); return; }
    setSaving(true);
    setError("");
    try {
      const { error: emErr } = await supabase.from("employment_relationships").update({ fixed_term_end_date: newEnd, updated_at: new Date().toISOString() }).eq("id", employment.id);
      if (emErr) throw emErr;
      await supabase.from("employment_contract_events").insert({
        id: uid(), employment_id: employment.id, event_type: "EXTENDED", event_date: new Date().toISOString().slice(0, 10),
        valid_from: employment.fixed_term_end_date, valid_to: newEnd,
      });
      await supabase.from("employee_timeline_events").insert({
        id: uid(), employee_id: employment.employee_id, event_date: new Date().toISOString().slice(0, 10), event_type: "CONTRACT_EXTENDED",
        title: "Smlouva prodloužena", description: `Nový konec: ${skDateStrFromIso(newEnd)}`, source: "MANUAL",
      });
      onSaved();
    } catch (e) {
      console.error(e);
      setError(e.message || "Uložení se nezdařilo.");
    }
    setSaving(false);
  }

  return (
    <div className="flex items-end gap-2 bg-slate-50 border border-slate-200 rounded-md p-3">
      <DateFieldLocal label="Nový konec smlouvy" value={newEnd} onChange={setNewEnd} />
      {error && <div className="text-red-600 text-xs">{error}</div>}
      <button onClick={onCancel} className="text-sm text-slate-500 px-2 py-2">Zrušit</button>
      <button onClick={submit} disabled={saving} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium px-3 py-2 rounded-md">{saving ? "Ukládám..." : "Prodloužit"}</button>
    </div>
  );
}

function EndEmploymentForm({ employment, onCancel, onSaved }) {
  const [f, setF] = useState({ termination_date: "", termination_type: "dohoda", termination_reason: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!f.termination_date) { setError("Vyplňte datum ukončení."); return; }
    setSaving(true);
    setError("");
    try {
      const { error: emErr } = await supabase.from("employment_relationships").update({
        status: "ENDED", termination_date: f.termination_date, termination_type: f.termination_type, termination_reason: f.termination_reason.trim() || null,
        updated_at: new Date().toISOString(),
      }).eq("id", employment.id);
      if (emErr) throw emErr;
      await supabase.from("employment_contract_events").insert({
        id: uid(), employment_id: employment.id, event_type: "ENDED", event_date: f.termination_date, valid_to: f.termination_date,
      });
      // ak zamestnancovi uz nezostava ziadny aktivny/planovany pracovny pomer, oznaci sa ako byvaly
      // (filter "Byvali zamestnanci" cita prave toto pole - riadok aj cela historia zostavaju v DB).
      const { data: remaining } = await supabase.from("employment_relationships").select("id").eq("employee_id", employment.employee_id).in("status", ["ACTIVE", "PLANNED", "NOTICE_PERIOD"]).neq("id", employment.id);
      if (!remaining || remaining.length === 0) {
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
          options={[
            { value: "dohoda", label: "Dohoda o skončení" },
            { value: "vypoved_zamestnance", label: "Výpověď zaměstnance" },
            { value: "vypoved_zamestnavatele", label: "Výpověď zaměstnavatele" },
            { value: "zkusebni_doba", label: "Zrušení ve zkušební době" },
            { value: "jine", label: "Jiné" },
          ]}
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

function HistorieTab({ timeline }) {
  if (timeline.length === 0) return <div className="text-sm text-slate-400">Zatím žádné události.</div>;
  return (
    <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
      {timeline.map((t) => (
        <div key={t.id} className="px-4 py-3 flex gap-3">
          <div className="text-xs text-slate-400 whitespace-nowrap w-24 pt-0.5">{fmtDate(t.event_date)}</div>
          <div>
            <div className="text-sm font-medium">{t.title}</div>
            {t.description && <div className="text-xs text-slate-500 mt-0.5">{t.description}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Šablony dokumentů (placeholder) ---------------- */

function TemplatesPlaceholder() {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
      <FileText className="mx-auto mb-3 text-slate-300" size={32} />
      <div className="text-slate-600 text-sm font-medium">Šablony dokumentů</div>
      <div className="text-slate-400 text-xs mt-1 max-w-md mx-auto">
        Připravujeme. Bude potřeba dodat vzory (pracovní smlouva, popisy pracovních míst HI-001–HI-007), než půjde tuto část zprovoznit.
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
