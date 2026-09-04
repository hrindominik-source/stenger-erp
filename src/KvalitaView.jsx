import React, { useState, useEffect, useCallback, useRef } from "react";
import { LogOut, ArrowLeft, Loader2, AlertCircle, LayoutDashboard, ListChecks, CalendarClock, Plus, Trash2, CheckCircle2, ChevronDown, ChevronUp, Upload, FileCheck, Download, Pencil } from "lucide-react";
import { supabase } from "./supabaseClient.js";
import { todayStr, uid, computeNextDue, daysUntil, isoFromSkDateStr, skDateStrFromIso } from "./lib/utils.js";
import { exportRowsToExcel } from "./lib/exportExcel.js";

const POLL_MS = 10000;
const KVALITA_DOKUMENTY_BUCKET = "kvalita-dokumenty";

const FREKVENCIA_OPTIONS = [
  { value: "dni", label: "Dní" },
  { value: "tyzdne", label: "Týdnů" },
  { value: "mesiace", label: "Měsíců" },
  { value: "roky", label: "Roků" },
];

const TERMIN_TYP_OPTIONS = [
  { value: "zdravotna_prehliadka", label: "Zdravotní prohlídka", group: "zdravie" },
  { value: "vzv_kontrola", label: "Kontrola VZV", group: "zdravie" },
  { value: "vzv_skolenie", label: "Školení VZV", group: "zdravie" },
  { value: "skolenie", label: "Školení", group: "zdravie" },
  { value: "ifs_certifikat", label: "IFS certifikát", group: "certifikacia" },
  { value: "rspo_certifikat", label: "RSPO certifikát", group: "certifikacia" },
  { value: "ifs_audit", label: "IFS audit", group: "certifikacia" },
  { value: "kvalita_haccp", label: "Kvalita/HACCP", group: "certifikacia" },
  { value: "elektro", label: "Elektro", group: "elektro_vtz" },
  { value: "vtz", label: "VTZ", group: "elektro_vtz" },
  { value: "poziarna_ochrana", label: "Požární ochrana", group: "po" },
  { value: "sklad", label: "Sklad", group: "sklad" },
  { value: "chladenie_vzt", label: "Chlazení/VZT", group: "chladenie" },
  { value: "kalibrace", label: "Kalibrace/měření", group: "metrologia" },
  { value: "detektor_kovov", label: "Detektor kovů", group: "detektor" },
  { value: "ddd", label: "DDD (deratizace/dezinsekce)", group: "hygiena" },
  { value: "rozbor_vody", label: "Rozbor vody", group: "hygiena" },
  { value: "hygiena", label: "Hygiena (stěry/rozbory)", group: "hygiena" },
  { value: "bozp", label: "BOZP", group: "bozp" },
  { value: "ine_bozp", label: "Jiné BOZP", group: "bozp" },
  { value: "revize_zarizeni", label: "Revize zařízení", group: "ostatne" },
];

const TERMIN_GROUP_META = {
  zdravie: { label: "Zdraví a školení", badge: "bg-sky-100 text-sky-700", dot: "bg-sky-500" },
  certifikacia: { label: "Certifikace a audity", badge: "bg-violet-100 text-violet-700", dot: "bg-violet-500" },
  elektro_vtz: { label: "Elektro a VTZ", badge: "bg-amber-100 text-amber-700", dot: "bg-amber-500" },
  po: { label: "Požární ochrana", badge: "bg-rose-100 text-rose-700", dot: "bg-rose-500" },
  sklad: { label: "Sklad", badge: "bg-indigo-100 text-indigo-700", dot: "bg-indigo-500" },
  chladenie: { label: "Chlazení/VZT", badge: "bg-cyan-100 text-cyan-700", dot: "bg-cyan-500" },
  metrologia: { label: "Metrologie", badge: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500" },
  detektor: { label: "Detektor kovů", badge: "bg-fuchsia-100 text-fuchsia-700", dot: "bg-fuchsia-500" },
  hygiena: { label: "Hygiena", badge: "bg-lime-100 text-lime-800", dot: "bg-lime-500" },
  bozp: { label: "BOZP", badge: "bg-orange-100 text-orange-700", dot: "bg-orange-500" },
  ostatne: { label: "Ostatní", badge: "bg-slate-100 text-slate-700", dot: "bg-slate-400" },
};

const TERMIN_TYP_GROUPED = Object.keys(TERMIN_GROUP_META)
  .map((group) => ({ group, label: TERMIN_GROUP_META[group].label, options: TERMIN_TYP_OPTIONS.filter((o) => o.group === group) }))
  .filter((g) => g.options.length > 0);

function terminGroupOf(typ) {
  return (TERMIN_TYP_OPTIONS.find((t) => t.value === typ) || {}).group || "ostatne";
}
function terminGroupBadgeClass(typ) {
  return (TERMIN_GROUP_META[terminGroupOf(typ)] || TERMIN_GROUP_META.ostatne).badge;
}

const TERMIN_STATUS_META = {
  po_terminu: { label: "Po termínu", cls: "bg-red-100 text-red-700" },
  blizi_se: { label: "Blíží se", cls: "bg-amber-100 text-amber-700" },
  v_poradku: { label: "V pořádku", cls: "bg-emerald-100 text-emerald-700" },
  neznamy: { label: "Bez termínu", cls: "bg-slate-100 text-slate-500" },
};

function terminStatusOf(k) {
  const nextDue = computeNextDue(k.datumPoslednej, k.frekvenciaTyp, k.frekvenciaHodnota);
  const diff = daysUntil(nextDue);
  if (diff === null) return { key: "neznamy", nextDue, diff };
  if (diff < 0) return { key: "po_terminu", nextDue, diff };
  if (diff <= (Number(k.notifikaciaDniPred) || 0)) return { key: "blizi_se", nextDue, diff };
  return { key: "v_poradku", nextDue, diff };
}

function terminStatusLabel(status) {
  if (status.key === "po_terminu") return `Po termínu ${-status.diff} dní`;
  if (status.key === "blizi_se") return status.diff === 0 ? "Dnes" : `Za ${status.diff} dní`;
  if (status.key === "v_poradku") return "V pořádku";
  return "Bez termínu";
}

async function openKvalitaDokument(path) {
  if (!path) return;
  const { data, error } = await supabase.storage.from(KVALITA_DOKUMENTY_BUCKET).createSignedUrl(path, 3600);
  if (!error && data) window.open(data.signedUrl, "_blank");
}

function frekvenciaLabel(typ) {
  return (FREKVENCIA_OPTIONS.find((f) => f.value === typ) || {}).label || typ || "";
}
function terminTypLabel(typ) {
  return (TERMIN_TYP_OPTIONS.find((t) => t.value === typ) || {}).label || typ || "";
}

// Najnovsie vyplnenie danej sablony (podla datumu, DD.MM.RRRR retazce).
function latestSubmission(submissions, templateId) {
  const list = submissions.filter((s) => s.templateId === templateId);
  if (list.length === 0) return null;
  return list.reduce((best, s) => (daysUntil(s.datum) > daysUntil(best.datum) ? s : best));
}

const KVALITA_TAB_COLORS = {
  prehlad: { badge: "from-teal-400 to-teal-600", shadow: "shadow-teal-500/40" },
  checklisty: { badge: "from-violet-400 to-violet-600", shadow: "shadow-violet-500/40" },
  terminy: { badge: "from-amber-400 to-amber-600", shadow: "shadow-amber-500/40" },
};

function KvalitaTabButton({ active, onClick, color, icon, label }) {
  const c = KVALITA_TAB_COLORS[color] || KVALITA_TAB_COLORS.prehlad;
  return (
    <button
      onClick={onClick}
      className={
        "group relative flex-1 flex flex-col items-center justify-center gap-1.5 py-3.5 px-2 rounded-xl text-base font-bold text-center leading-tight transition-all duration-200 " +
        (active
          ? "bg-gradient-to-b from-white to-slate-50 text-slate-900 shadow-lg " + c.shadow + " -translate-y-0.5"
          : "text-slate-300 hover:text-white hover:bg-white/5 hover:-translate-y-0.5")
      }
    >
      <span className={"flex items-center justify-center w-11 h-11 rounded-lg bg-gradient-to-br text-white shadow-md transition-transform duration-200 group-hover:scale-110 " + c.badge}>
        {icon}
      </span>
      {label}
    </button>
  );
}

export default function KvalitaView({ fullName, onSignOut, onBack }) {
  const [tab, setTab] = useState("prehlad");
  const [templates, setTemplates] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [terminy, setTerminy] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pollRef = useRef(null);

  const fetchAll = useCallback(async () => {
    const [templatesRes, submissionsRes, terminyRes] = await Promise.all([
      supabase.from("checklist_templates").select("*").order("created_at", { ascending: false }),
      supabase.from("checklist_submissions").select("*").order("created_at", { ascending: false }),
      supabase.from("kvalita_terminy").select("*").order("created_at", { ascending: false }),
    ]);
    if (templatesRes.error || submissionsRes.error || terminyRes.error) {
      setError("Nepodařilo se načíst data.");
      return;
    }
    setError("");
    setTemplates((templatesRes.data || []).map((r) => r.data));
    setSubmissions((submissionsRes.data || []).map((r) => r.data));
    setTerminy((terminyRes.data || []).map((r) => r.data));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchAll();
      if (!cancelled) setLoading(false);
    })();
    pollRef.current = setInterval(fetchAll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(pollRef.current);
    };
  }, [fetchAll]);

  async function saveTemplate(record) {
    const { error: err } = await supabase.from("checklist_templates").insert({ id: record.id, data: record });
    if (err) { console.error(err); setError("Uložení se nezdařilo."); return; }
    setTemplates((prev) => [record, ...prev]);
  }
  async function updateTemplate(record) {
    const { error: err } = await supabase.from("checklist_templates").update({ data: record, updated_at: new Date().toISOString() }).eq("id", record.id);
    if (err) { console.error(err); setError("Uložení se nezdařilo."); return; }
    setTemplates((prev) => prev.map((t) => (t.id === record.id ? record : t)));
  }
  async function deleteTemplate(id) {
    const { error: err } = await supabase.from("checklist_templates").delete().eq("id", id);
    if (err) { console.error(err); setError("Smazání se nezdařilo."); return; }
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  }
  async function saveSubmission(record) {
    const { error: err } = await supabase.from("checklist_submissions").insert({ id: record.id, data: record });
    if (err) { console.error(err); setError("Uložení se nezdařilo."); return; }
    setSubmissions((prev) => [record, ...prev]);
  }
  async function saveTermin(record) {
    const { error: err } = await supabase.from("kvalita_terminy").insert({ id: record.id, data: record });
    if (err) { console.error(err); setError("Uložení se nezdařilo."); return; }
    setTerminy((prev) => [record, ...prev]);
  }
  async function updateTermin(record) {
    const { error: err } = await supabase.from("kvalita_terminy").update({ data: record, updated_at: new Date().toISOString() }).eq("id", record.id);
    if (err) { console.error(err); setError("Uložení se nezdařilo."); return; }
    setTerminy((prev) => prev.map((t) => (t.id === record.id ? record : t)));
  }
  async function deleteTermin(id) {
    const { error: err } = await supabase.from("kvalita_terminy").delete().eq("id", id);
    if (err) { console.error(err); setError("Smazání se nezdařilo."); return; }
    setTerminy((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" style={{ fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}>
      <header className="bg-slate-900 text-white">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="text-slate-400 hover:text-white"><ArrowLeft size={20} /></button>
            <img src={`${import.meta.env.BASE_URL}stenger-logo.png`} alt="Stenger" className="h-10 w-auto" />
            <div>
              <div className="text-xs tracking-wider text-slate-400">Stenger Czech s.r.o.</div>
              <div className="text-lg font-semibold">Kvalita a kontroly</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-300">{fullName}</span>
            <button onClick={onSignOut} className="flex items-center gap-1.5 text-slate-300 hover:bg-slate-800 px-3 py-1.5 rounded-md text-sm">
              <LogOut size={16} /> Odhlásit
            </button>
          </div>
        </div>
        <div className="max-w-4xl mx-auto px-4 pb-4">
          <nav className="flex items-stretch gap-2 mt-1 bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-2 shadow-inner overflow-x-auto">
            <KvalitaTabButton active={tab === "prehlad"} onClick={() => setTab("prehlad")} color="prehlad" icon={<LayoutDashboard size={20} />} label="Přehled" />
            <KvalitaTabButton active={tab === "checklisty"} onClick={() => setTab("checklisty")} color="checklisty" icon={<ListChecks size={20} />} label="Checklisty" />
            <KvalitaTabButton active={tab === "terminy"} onClick={() => setTab("terminy")} color="terminy" icon={<CalendarClock size={20} />} label="Termíny" />
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {error && <div className="mb-4 bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={16} /> {error}</div>}
        {loading ? (
          <div className="text-center text-slate-400 py-10"><Loader2 className="animate-spin mx-auto mb-2" size={24} /> Načítám...</div>
        ) : tab === "prehlad" ? (
          <PrehledTab templates={templates} submissions={submissions} terminy={terminy} onGoToChecklisty={() => setTab("checklisty")} onGoToTerminy={() => setTab("terminy")} />
        ) : tab === "checklisty" ? (
          <ChecklistyTab
            fullName={fullName}
            templates={templates}
            submissions={submissions}
            onSaveTemplate={saveTemplate}
            onUpdateTemplate={updateTemplate}
            onDeleteTemplate={deleteTemplate}
            onSaveSubmission={saveSubmission}
          />
        ) : (
          <TerminyTab terminy={terminy} onSaveTermin={saveTermin} onUpdateTermin={updateTermin} onDeleteTermin={deleteTermin} />
        )}
      </main>
    </div>
  );
}

/* ---------------- Přehled ---------------- */

function PrehledTab({ templates, submissions, terminy, onGoToChecklisty, onGoToTerminy }) {
  const checklistItems = templates
    .filter((t) => t.aktivny !== false)
    .map((t) => {
      const last = latestSubmission(submissions, t.id);
      const lastDate = last ? last.datum : t.vytvorene;
      const nextDue = computeNextDue(lastDate, t.frekvenciaTyp, t.frekvenciaHodnota);
      const diff = daysUntil(nextDue);
      return { t, nextDue, diff };
    })
    .filter((x) => x.diff !== null && x.diff <= 0)
    .sort((a, b) => a.diff - b.diff);

  const terminItems = terminy
    .map((k) => {
      const nextDue = computeNextDue(k.datumPoslednej, k.frekvenciaTyp, k.frekvenciaHodnota);
      const diff = daysUntil(nextDue);
      return { k, nextDue, diff };
    })
    .filter((x) => x.diff !== null && x.diff <= (Number(x.k.notifikaciaDniPred) || 0))
    .sort((a, b) => a.diff - b.diff);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-slate-500 mb-2">Checklisty - na vyplnění / po termínu</h2>
        {checklistItems.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm">Vše vyplněno včas.</div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            {checklistItems.map(({ t, nextDue, diff }) => (
              <div key={t.id} onClick={onGoToChecklisty} className={"px-4 py-2.5 border-t border-slate-100 first:border-t-0 flex items-center justify-between cursor-pointer hover:bg-slate-50 " + (diff <= -5 ? "bg-red-50" : "")}>
                <div>
                  <div className="font-medium text-sm">{t.nazov}</div>
                  <div className="text-xs text-slate-400">Frekvence: {t.frekvenciaHodnota} {frekvenciaLabel(t.frekvenciaTyp).toLowerCase()}</div>
                </div>
                <div className={"text-xs font-semibold whitespace-nowrap " + (diff <= -5 ? "text-red-600" : "text-amber-600")}>
                  {diff === 0 ? "dnes" : diff < 0 ? `po termínu ${-diff} dní` : `za ${diff} dní`} ({nextDue})
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <h2 className="text-sm font-semibold text-slate-500 mb-2">Termíny / BOZP - blíží se / po termínu</h2>
        {terminItems.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm">Žádné blížící se termíny.</div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            {terminItems.map(({ k, nextDue, diff }) => (
              <div key={k.id} onClick={onGoToTerminy} className={"px-4 py-2.5 border-t border-slate-100 first:border-t-0 flex items-center justify-between cursor-pointer hover:bg-slate-50 " + (diff < 0 ? "bg-red-50" : "bg-amber-50")}>
                <div>
                  <div className="font-medium text-sm">{k.nazov || terminTypLabel(k.typ)}</div>
                  <div className="text-xs text-slate-400">{terminTypLabel(k.typ)}{k.predmet ? " - " + k.predmet : ""}</div>
                </div>
                <div className={"text-xs font-semibold whitespace-nowrap " + (diff < 0 ? "text-red-600" : "text-amber-600")}>
                  {diff === 0 ? "dnes" : diff < 0 ? `po termínu ${-diff} dní` : `za ${diff} dní`} ({nextDue})
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Checklisty ---------------- */

function emptyTemplateForm() {
  return { nazov: "", polozky: [{ text: "", type: "boolean", legendaId: "" }], legendy: [], frekvenciaTyp: "mesiace", frekvenciaHodnota: "1" };
}

function templateFormFromRecord(t) {
  return {
    nazov: t.nazov || "",
    polozky: (t.polozky && t.polozky.length ? t.polozky : [{ text: "", type: "boolean", legendaId: "" }]).map((p) => ({ text: p.text, type: p.type || "boolean", legendaId: p.legendaId || "" })),
    legendy: (t.legendy || []).map((l) => ({ id: l.id, nazov: l.nazov, kody: l.kody.map((k) => ({ ...k })) })),
    frekvenciaTyp: t.frekvenciaTyp || "mesiace",
    frekvenciaHodnota: String(t.frekvenciaHodnota ?? "1"),
  };
}

// Validuje a oreze formularove hodnoty na ulozitelny tvar sablony (polozky +
// legendy), spolocne pre vytvorenie aj upravu checklistu.
function buildTemplatePayload(values) {
  const polozky = values.polozky
    .map((p) => ({
      text: p.text.trim(),
      type: p.type === "legenda" && p.legendaId ? "legenda" : "boolean",
      legendaId: p.type === "legenda" && p.legendaId ? p.legendaId : null,
    }))
    .filter((p) => p.text);
  if (!values.nazov.trim()) return { error: "Vyplňte název checklistu." };
  if (polozky.length === 0) return { error: "Přidejte alespoň jednu položku." };
  if (!Number(values.frekvenciaHodnota)) return { error: "Vyplňte frekvenci." };
  const legendy = values.legendy
    .map((l) => ({ id: l.id, nazov: l.nazov.trim(), kody: l.kody.map((k) => ({ kod: k.kod.trim(), popis: k.popis.trim() })).filter((k) => k.kod) }))
    .filter((l) => l.nazov && l.kody.length > 0);
  return {
    payload: {
      nazov: values.nazov.trim(),
      polozky,
      legendy,
      frekvenciaTyp: values.frekvenciaTyp,
      frekvenciaHodnota: values.frekvenciaHodnota,
    },
  };
}

// Kazde vyplnenie si nesie vlastnu kopiu poloziek (text/typ/legendaId) tak,
// ako vyzerali v case vyplnenia - union naprieC historiou tak zvladne aj
// checklisty, ktore sa medzitym upravovali (pridane/ubrane polozky).
async function exportChecklistHistory(template, submissions) {
  const history = submissions.filter((s) => s.templateId === template.id).slice().sort((a, b) => daysUntil(a.datum) - daysUntil(b.datum));
  if (history.length === 0) return;
  const itemTexts = [];
  const seen = new Set();
  for (const s of history) {
    for (const o of s.odpovede || []) {
      if (!seen.has(o.text)) { seen.add(o.text); itemTexts.push(o.text); }
    }
  }
  const rows = history.map((s) => {
    const row = { Datum: s.datum, Vyplnil: s.vyplnil };
    for (const text of itemTexts) {
      const o = (s.odpovede || []).find((x) => x.text === text);
      row[text] = o ? (o.type === "legenda" ? o.hodnota || "" : o.ok === true ? "OK" : o.ok === false ? "Nevyhovuje" : "") : "";
      row[`${text} - náprava/poznámka`] = o ? o.poznamka || "" : "";
    }
    row["Celková poznámka"] = s.poznamka || "";
    return row;
  });
  await exportRowsToExcel(rows, template.nazov.slice(0, 31), template.nazov.replace(/[^a-z0-9]+/gi, "_") || "checklist");
}

// Vecsina checklistov je jednoduche "OK / Nevyhovuje", ale niektore tlacene
// formulare (napr. evidence deratizace) hodnotia kazdu polozku kodom z
// legendy (A-D, 1-5...) namiesto ano/nie - legenda sa definuje na urovni
// sablony a polozka na nu len odkazuje (legendaId), aby sa dala zdielat
// medzi viacerymi polozkami rovnakeho typu (napr. vsetky mucholapky).
function TemplateFormFields({ values, onChange }) {
  function updatePolozka(i, patch) {
    const next = values.polozky.slice();
    next[i] = { ...next[i], ...patch };
    onChange({ ...values, polozky: next });
  }
  function addPolozka() { onChange({ ...values, polozky: [...values.polozky, { text: "", type: "boolean", legendaId: "" }] }); }
  function removePolozka(i) { onChange({ ...values, polozky: values.polozky.filter((_, idx) => idx !== i) }); }

  function addLegenda() {
    onChange({ ...values, legendy: [...values.legendy, { id: uid(), nazov: "", kody: [{ kod: "", popis: "" }] }] });
  }
  function updateLegenda(li, patch) {
    const next = values.legendy.slice();
    next[li] = { ...next[li], ...patch };
    onChange({ ...values, legendy: next });
  }
  function removeLegenda(li) {
    const removed = values.legendy[li];
    onChange({
      ...values,
      legendy: values.legendy.filter((_, idx) => idx !== li),
      polozky: values.polozky.map((p) => (p.legendaId === removed.id ? { ...p, type: "boolean", legendaId: "" } : p)),
    });
  }
  function addKod(li) {
    const next = values.legendy.slice();
    next[li] = { ...next[li], kody: [...next[li].kody, { kod: "", popis: "" }] };
    onChange({ ...values, legendy: next });
  }
  function updateKod(li, ki, patch) {
    const next = values.legendy.slice();
    const kody = next[li].kody.slice();
    kody[ki] = { ...kody[ki], ...patch };
    next[li] = { ...next[li], kody };
    onChange({ ...values, legendy: next });
  }
  function removeKod(li, ki) {
    const next = values.legendy.slice();
    next[li] = { ...next[li], kody: next[li].kody.filter((_, idx) => idx !== ki) };
    onChange({ ...values, legendy: next });
  }

  return (
    <>
      <label className="block mb-2">
        <span className="block text-xs font-medium text-slate-500 mb-1">Název checklistu</span>
        <input value={values.nazov} onChange={(e) => onChange({ ...values, nazov: e.target.value })} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
      </label>
      <div className="mb-3 border border-slate-100 rounded-md p-3 bg-slate-50">
        <div className="flex items-center justify-between mb-2">
          <span className="block text-xs font-medium text-slate-500">Legendy (kódy hodnocení, např. A/B/C/D nebo 1-5)</span>
          <button onClick={addLegenda} className="text-xs text-teal-700 hover:text-teal-900 flex items-center gap-1"><Plus size={12} /> Přidat legendu</button>
        </div>
        {values.legendy.length === 0 && <div className="text-xs text-slate-400">Zatím žádné legendy - položky budou typu Ano/Ne.</div>}
        {values.legendy.map((l, li) => (
          <div key={l.id} className="bg-white border border-slate-200 rounded-md p-2.5 mb-2 last:mb-0">
            <div className="flex gap-2 mb-1.5">
              <input value={l.nazov} onChange={(e) => updateLegenda(li, { nazov: e.target.value })} placeholder="Název legendy (např. Hodnocení stavu)" className="flex-1 border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
              <button onClick={() => removeLegenda(li)} className="text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>
            </div>
            {l.kody.map((k, ki) => (
              <div key={ki} className="flex gap-2 mb-1 pl-2">
                <input value={k.kod} onChange={(e) => updateKod(li, ki, { kod: e.target.value })} placeholder="Kód (A, 1...)" className="w-20 border border-slate-200 rounded-md px-2 py-1 text-xs" />
                <input value={k.popis} onChange={(e) => updateKod(li, ki, { popis: e.target.value })} placeholder="Popis (např. bez závad)" className="flex-1 border border-slate-200 rounded-md px-2 py-1 text-xs" />
                <button onClick={() => removeKod(li, ki)} className="text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
              </div>
            ))}
            <button onClick={() => addKod(li)} className="text-xs text-teal-700 hover:text-teal-900 flex items-center gap-1 mt-1 pl-2"><Plus size={10} /> Přidat kód</button>
          </div>
        ))}
      </div>

      <div className="mb-2">
        <span className="block text-xs font-medium text-slate-500 mb-1">Položky checklistu</span>
        {values.polozky.map((p, i) => (
          <div key={i} className="flex gap-2 mb-1.5">
            <input value={p.text} onChange={(e) => updatePolozka(i, { text: e.target.value })} className="flex-1 border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" placeholder={`Položka ${i + 1}`} />
            <select
              value={p.type === "legenda" && p.legendaId ? p.legendaId : "boolean"}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "boolean") updatePolozka(i, { type: "boolean", legendaId: "" });
                else updatePolozka(i, { type: "legenda", legendaId: v });
              }}
              className="w-44 border border-slate-200 rounded-md px-2 py-1.5 text-xs shrink-0"
            >
              <option value="boolean">Ano / Ne</option>
              {values.legendy.filter((l) => l.nazov.trim()).map((l) => <option key={l.id} value={l.id}>{l.nazov}</option>)}
            </select>
            <button onClick={() => removePolozka(i)} className="text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>
          </div>
        ))}
        <button onClick={addPolozka} className="text-xs text-teal-700 hover:text-teal-900 flex items-center gap-1 mt-1"><Plus size={12} /> Přidat položku</button>
      </div>
      <div className="flex gap-2 items-end mb-1">
        <label className="w-40">
          <span className="block text-xs font-medium text-slate-500 mb-1">Frekvence - každých</span>
          <input value={values.frekvenciaHodnota} onChange={(e) => onChange({ ...values, frekvenciaHodnota: e.target.value })} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
        </label>
        <label className="w-40">
          <span className="block text-xs font-medium text-slate-500 mb-1">&nbsp;</span>
          <select value={values.frekvenciaTyp} onChange={(e) => onChange({ ...values, frekvenciaTyp: e.target.value })} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm">
            {FREKVENCIA_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </label>
      </div>
    </>
  );
}

function ChecklistyTab({ fullName, templates, submissions, onSaveTemplate, onUpdateTemplate, onDeleteTemplate, onSaveSubmission }) {
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyTemplateForm());
  const [formError, setFormError] = useState("");
  const [fillId, setFillId] = useState(null);
  const [openHistoryId, setOpenHistoryId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editError, setEditError] = useState("");

  function submitTemplate() {
    const { error, payload } = buildTemplatePayload(form);
    if (error) { setFormError(error); return; }
    setFormError("");
    onSaveTemplate({ id: uid(), ...payload, aktivny: true, vytvorene: todayStr() });
    setForm(emptyTemplateForm());
    setFormOpen(false);
  }

  function startEdit(t) {
    setEditingId(t.id);
    setEditForm(templateFormFromRecord(t));
    setEditError("");
    setFormOpen(false);
    setFillId(null);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditForm(null);
    setEditError("");
  }
  function saveEdit() {
    const { error, payload } = buildTemplatePayload(editForm);
    if (error) { setEditError(error); return; }
    const current = templates.find((t) => t.id === editingId);
    if (!current) { cancelEdit(); return; }
    onUpdateTemplate({ ...current, ...payload });
    cancelEdit();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Checklisty</h1>
        <button onClick={() => { setFormOpen((v) => !v); cancelEdit(); }} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md">
          <Plus size={16} /> Nový checklist
        </button>
      </div>

      {formOpen && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
          <TemplateFormFields values={form} onChange={setForm} />
          {formError && <div className="mb-2 text-xs text-red-700 flex items-center gap-1.5"><AlertCircle size={12} /> {formError}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={() => { setFormOpen(false); setForm(emptyTemplateForm()); setFormError(""); }} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
            <button onClick={submitTemplate} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Uložit</button>
          </div>
        </div>
      )}

      {templates.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500">Zatím žádné checklisty.</div>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => {
            const last = latestSubmission(submissions, t.id);
            const lastDate = last ? last.datum : t.vytvorene;
            const nextDue = computeNextDue(lastDate, t.frekvenciaTyp, t.frekvenciaHodnota);
            const history = submissions.filter((s) => s.templateId === t.id);
            return (
              <div key={t.id} className="bg-white border border-slate-200 rounded-lg p-4">
                {editingId === t.id ? (
                  <>
                    <TemplateFormFields values={editForm} onChange={setEditForm} />
                    {editError && <div className="mb-2 text-xs text-red-700 flex items-center gap-1.5"><AlertCircle size={12} /> {editError}</div>}
                    <div className="flex justify-end gap-2">
                      <button onClick={cancelEdit} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
                      <button onClick={saveEdit} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Uložit</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <div className="font-semibold">{t.nazov}</div>
                        <div className="text-xs text-slate-400">Frekvence: každých {t.frekvenciaHodnota} {frekvenciaLabel(t.frekvenciaTyp).toLowerCase()} - další termín: {nextDue || "-"}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setFillId(fillId === t.id ? null : t.id)} className="text-xs bg-teal-700 hover:bg-teal-800 text-white font-medium px-3 py-1.5 rounded-md">Vyplnit</button>
                        <button onClick={() => exportChecklistHistory(t, submissions)} disabled={history.length === 0} title={history.length === 0 ? "Zatím žádná vyplnění" : "Stáhnout historii vyplnění do Excelu"} className="text-slate-400 hover:text-teal-700 disabled:opacity-30 disabled:cursor-not-allowed p-1"><Download size={16} /></button>
                        <button onClick={() => startEdit(t)} title="Upravit checklist" className="text-slate-400 hover:text-teal-700 p-1"><Pencil size={16} /></button>
                        <button onClick={() => onDeleteTemplate(t.id)} title="Smazat checklist" className="text-slate-400 hover:text-red-600 p-1"><Trash2 size={16} /></button>
                      </div>
                    </div>

                    {fillId === t.id && (
                      <ChecklistFillForm
                        template={t}
                        fullName={fullName}
                        onCancel={() => setFillId(null)}
                        onSave={(record) => { onSaveSubmission(record); setFillId(null); }}
                      />
                    )}

                    {history.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-100">
                        <button onClick={() => setOpenHistoryId(openHistoryId === t.id ? null : t.id)} className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
                          {openHistoryId === t.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Historie vyplnění ({history.length})
                        </button>
                        {openHistoryId === t.id && (
                          <div className="mt-2 space-y-1">
                            {history.slice().sort((a, b) => daysUntil(b.datum) - daysUntil(a.datum)).map((s) => (
                              <div key={s.id} className="text-xs text-slate-500 flex items-center gap-2">
                                <CheckCircle2 size={12} className="text-emerald-600 shrink-0" />
                                {s.datum} - {s.vyplnil}{s.poznamka ? " - " + s.poznamka : ""}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChecklistFillForm({ template, fullName, onCancel, onSave }) {
  const legendy = template.legendy || [];
  const [odpovede, setOdpovede] = useState(
    template.polozky.map((p) => ({ text: p.text, type: p.type === "legenda" && p.legendaId ? "legenda" : "boolean", legendaId: p.legendaId || null, ok: null, hodnota: null, poznamka: "" }))
  );
  const [vyplnil, setVyplnil] = useState(fullName || "");
  const [poznamka, setPoznamka] = useState("");
  const [error, setError] = useState("");

  function setOk(i, value) {
    const next = odpovede.slice();
    next[i] = { ...next[i], ok: value };
    setOdpovede(next);
  }
  function setHodnota(i, kod) {
    const next = odpovede.slice();
    next[i] = { ...next[i], hodnota: kod };
    setOdpovede(next);
  }
  function setNote(i, v) {
    const next = odpovede.slice();
    next[i] = { ...next[i], poznamka: v };
    setOdpovede(next);
  }

  const neposudene = odpovede.filter((o) => (o.type === "legenda" ? !o.hodnota : o.ok === null)).length;

  function handleSave() {
    if (!vyplnil.trim()) {
      setError("Vyplňte, kdo kontrolu provedl.");
      return;
    }
    if (neposudene > 0) {
      setError(`Posuďte ještě ${neposudene} nezaškrtnutou položku(y).`);
      return;
    }
    setError("");
    onSave({ id: uid(), templateId: template.id, datum: todayStr(), vyplnil: vyplnil.trim(), odpovede, poznamka: poznamka.trim() });
  }

  return (
    <div className="mt-3 pt-3 border-t border-slate-100 bg-slate-50 -mx-4 -mb-4 px-4 pb-4 rounded-b-lg">
      <label className="block mb-2">
        <span className="block text-xs font-medium text-slate-500 mb-1">Vyplnil(a)</span>
        <input value={vyplnil} onChange={(e) => setVyplnil(e.target.value)} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
      </label>
      {legendy.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {legendy.map((l) => (
            <div key={l.id} className="text-[11px] text-slate-500 bg-white border border-slate-200 rounded-md px-2 py-1">
              <span className="font-semibold text-slate-600">{l.nazov}: </span>
              {l.kody.map((k, idx) => (
                <span key={k.kod}>
                  {idx > 0 ? ", " : ""}
                  <b>{k.kod}</b>={k.popis}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="space-y-1.5 mb-2">
        {odpovede.map((o, i) => {
          const legenda = o.type === "legenda" ? legendy.find((l) => l.id === o.legendaId) : null;
          const nezodpovedane = o.type === "legenda" ? !o.hodnota : o.ok === null;
          return (
            <div key={i} className={"bg-white border rounded-md px-2.5 py-1.5 " + (nezodpovedane ? "border-amber-300" : "border-slate-200")}>
              <div className="flex items-center gap-2">
                <span className="text-sm flex-1">{o.text}</span>
                {legenda ? (
                  <div className="flex gap-1 flex-wrap shrink-0 justify-end">
                    {legenda.kody.map((k) => (
                      <button
                        key={k.kod}
                        type="button"
                        title={k.popis}
                        onClick={() => setHodnota(i, k.kod)}
                        className={"text-xs font-medium px-2 py-1 rounded-md border " + (o.hodnota === k.kod ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-500 border-slate-200")}
                      >
                        {k.kod}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex gap-1 shrink-0">
                    <button type="button" onClick={() => setOk(i, true)} className={"text-xs font-medium px-2 py-1 rounded-md border " + (o.ok === true ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-500 border-slate-200")}>OK</button>
                    <button type="button" onClick={() => setOk(i, false)} className={"text-xs font-medium px-2 py-1 rounded-md border " + (o.ok === false ? "bg-red-600 text-white border-red-600" : "bg-white text-slate-500 border-slate-200")}>Nevyhovuje</button>
                  </div>
                )}
              </div>
              {legenda ? (
                <input value={o.poznamka} onChange={(e) => setNote(i, e.target.value)} placeholder="Náprava (nepovinné)" className="mt-1.5 w-full border border-slate-200 rounded px-2 py-1 text-xs" />
              ) : (
                o.ok === false && (
                  <input value={o.poznamka} onChange={(e) => setNote(i, e.target.value)} placeholder="Poznámka k neshodě" className="mt-1.5 w-48 border border-slate-200 rounded px-2 py-1 text-xs" />
                )
              )}
            </div>
          );
        })}
      </div>
      <label className="block mb-2">
        <span className="block text-xs font-medium text-slate-500 mb-1">Poznámka (nepovinné)</span>
        <input value={poznamka} onChange={(e) => setPoznamka(e.target.value)} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
      </label>
      {error && <div className="mb-2 text-xs text-red-700">{error}</div>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
        <button onClick={handleSave} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">
          Uložit vyplnění
        </button>
      </div>
    </div>
  );
}

/* ---------------- Termíny / BOZP ---------------- */

function emptyTerminForm() {
  return { typ: "zdravotna_prehliadka", nazov: "", predmet: "", datumPoslednej: todayStr(), frekvenciaTyp: "roky", frekvenciaHodnota: "1", notifikaciaDniPred: "30", notifikaciaOpakovaniePoDnoch: "5", poznamka: "" };
}

function TerminFormFields({ values, onChange }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
      <label className="block mb-2">
        <span className="block text-xs font-medium text-slate-500 mb-1">Kategorie</span>
        <select value={values.typ} onChange={(e) => onChange({ ...values, typ: e.target.value })} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm">
          {TERMIN_TYP_GROUPED.map((g) => (
            <optgroup key={g.group} label={g.label}>
              {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="block mb-2">
        <span className="block text-xs font-medium text-slate-500 mb-1">Koho/čeho se týká (jméno, VZV č. ...)</span>
        <input value={values.predmet} onChange={(e) => onChange({ ...values, predmet: e.target.value })} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
      </label>
      <label className="block mb-2 sm:col-span-2">
        <span className="block text-xs font-medium text-slate-500 mb-1">Název / poznámka (nepovinné)</span>
        <input value={values.nazov} onChange={(e) => onChange({ ...values, nazov: e.target.value })} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
      </label>
      <label className="block mb-2">
        <span className="block text-xs font-medium text-slate-500 mb-1">Datum poslední revize/prohlídky</span>
        <input type="date" value={isoFromSkDateStr(values.datumPoslednej)} onChange={(e) => onChange({ ...values, datumPoslednej: skDateStrFromIso(e.target.value) })} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
      </label>
      <div className="flex gap-2 mb-2">
        <label className="w-1/2">
          <span className="block text-xs font-medium text-slate-500 mb-1">Frekvence - každých</span>
          <input value={values.frekvenciaHodnota} onChange={(e) => onChange({ ...values, frekvenciaHodnota: e.target.value })} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
        </label>
        <label className="w-1/2">
          <span className="block text-xs font-medium text-slate-500 mb-1">&nbsp;</span>
          <select value={values.frekvenciaTyp} onChange={(e) => onChange({ ...values, frekvenciaTyp: e.target.value })} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm">
            {FREKVENCIA_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </label>
      </div>
      <label className="block mb-2">
        <span className="block text-xs font-medium text-slate-500 mb-1">Upozornit kolik dní předem</span>
        <input value={values.notifikaciaDniPred} onChange={(e) => onChange({ ...values, notifikaciaDniPred: e.target.value })} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
      </label>
      <label className="block mb-2">
        <span className="block text-xs font-medium text-slate-500 mb-1">Poznámka</span>
        <input value={values.poznamka} onChange={(e) => onChange({ ...values, poznamka: e.target.value })} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
      </label>
    </div>
  );
}

function TerminStatCard({ label, value, tone, alert }) {
  return (
    <div className={"bg-white rounded-lg px-4 py-3 border " + (alert && value > 0 ? "border-red-400" : "border-slate-200")}>
      <div className={"text-2xl font-bold " + tone}>{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

function TerminyTab({ terminy, onSaveTermin, onUpdateTermin, onDeleteTermin }) {
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyTerminForm());
  const [formError, setFormError] = useState("");
  const [filterTyp, setFilterTyp] = useState("vsetko");
  const [filterStav, setFilterStav] = useState("vsetko");
  const [uploadingId, setUploadingId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editError, setEditError] = useState("");

  async function uploadDokument(termin, file) {
    if (!file) return;
    setUploadingId(termin.id);
    try {
      const ext = (file.name.split(".").pop() || "pdf").toLowerCase();
      const path = `${termin.id}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from(KVALITA_DOKUMENTY_BUCKET).upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      onUpdateTermin({ ...termin, dokumentPath: path, dokumentNazovSuboru: file.name });
    } catch (e) {
      console.error(e);
    }
    setUploadingId(null);
  }

  function submit() {
    if (!form.predmet.trim()) { setFormError("Vyplňte, koho/čeho se termín týká."); return; }
    if (!form.datumPoslednej) { setFormError("Vyplňte datum poslední revize/prohlídky."); return; }
    if (!Number(form.frekvenciaHodnota)) { setFormError("Vyplňte frekvenci."); return; }
    setFormError("");
    onSaveTermin({ id: uid(), ...form });
    setForm(emptyTerminForm());
    setFormOpen(false);
  }

  function startEdit(k) {
    setEditingId(k.id);
    setEditForm({
      typ: k.typ,
      nazov: k.nazov || "",
      predmet: k.predmet || "",
      datumPoslednej: k.datumPoslednej,
      frekvenciaTyp: k.frekvenciaTyp,
      frekvenciaHodnota: String(k.frekvenciaHodnota ?? ""),
      notifikaciaDniPred: String(k.notifikaciaDniPred ?? ""),
      poznamka: k.poznamka || "",
    });
    setEditError("");
    setFormOpen(false);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditForm(null);
    setEditError("");
  }
  function saveEdit() {
    if (!editForm.predmet.trim()) { setEditError("Vyplňte, koho/čeho se termín týká."); return; }
    if (!editForm.datumPoslednej) { setEditError("Vyplňte datum poslední revize/prohlídky."); return; }
    if (!Number(editForm.frekvenciaHodnota)) { setEditError("Vyplňte frekvenci."); return; }
    const current = terminy.find((t) => t.id === editingId);
    if (!current) { cancelEdit(); return; }
    onUpdateTermin({ ...current, ...editForm });
    cancelEdit();
  }

  const withStatus = terminy.map((k) => ({ k, status: terminStatusOf(k) }));
  const stats = withStatus.reduce((acc, { status }) => {
    acc[status.key] = (acc[status.key] || 0) + 1;
    return acc;
  }, {});

  const filteredWithStatus = withStatus.filter(({ k, status }) => {
    if (filterTyp !== "vsetko" && k.typ !== filterTyp) return false;
    if (filterStav !== "vsetko" && status.key !== filterStav) return false;
    return true;
  });
  const sortedWithStatus = filteredWithStatus.slice().sort((a, b) => (a.status.diff ?? 9999) - (b.status.diff ?? 9999));

  async function exportToExcel() {
    const rows = sortedWithStatus.map(({ k, status }) => ({
      "Kategorie": terminTypLabel(k.typ),
      "Předmět": k.predmet || "",
      "Název / poznámka": k.nazov || "",
      "Datum poslední revize": k.datumPoslednej || "",
      "Frekvence": `${k.frekvenciaHodnota} ${frekvenciaLabel(k.frekvenciaTyp).toLowerCase()}`,
      "Další termín": status.nextDue || "",
      "Dní do termínu": status.diff ?? "",
      "Upozornit dní předem": k.notifikaciaDniPred || "",
      "Poznámka": k.poznamka || "",
      "Dokument nahrán": k.dokumentPath ? "Ano" : "Ne",
    }));
    await exportRowsToExcel(rows, "Termíny", "Terminy_BOZP");
  }

  const hasActiveFilters = filterTyp !== "vsetko" || filterStav !== "vsetko";

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-xl font-semibold">Termíny / BOZP</h1>
        <div className="flex gap-2">
          <button onClick={exportToExcel} disabled={terminy.length === 0} title={terminy.length === 0 ? "Zatím žádné termíny" : "Exportovat do Excelu"} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-sm font-medium px-3 py-2 rounded-md">
            <Download size={16} /> Export do Excelu
          </button>
          <button onClick={() => { setFormOpen((v) => !v); cancelEdit(); }} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md">
            <Plus size={16} /> Nový termín
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <TerminStatCard label="Po termínu" value={stats.po_terminu || 0} tone="text-red-600" alert />
        <TerminStatCard label="Blíží se" value={stats.blizi_se || 0} tone="text-amber-600" />
        <TerminStatCard label="V pořádku" value={stats.v_poradku || 0} tone="text-emerald-600" />
        <TerminStatCard label="Celkem" value={terminy.length} tone="text-slate-700" />
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-3 mb-4 flex flex-wrap gap-3 items-end">
        <label className="min-w-[220px]">
          <span className="block text-xs font-medium text-slate-500 mb-1">Kategorie</span>
          <select value={filterTyp} onChange={(e) => setFilterTyp(e.target.value)} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm">
            <option value="vsetko">Všechny kategorie</option>
            {TERMIN_TYP_GROUPED.map((g) => (
              <optgroup key={g.group} label={g.label}>
                {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="min-w-[160px]">
          <span className="block text-xs font-medium text-slate-500 mb-1">Stav</span>
          <select value={filterStav} onChange={(e) => setFilterStav(e.target.value)} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm">
            <option value="vsetko">Všechny stavy</option>
            <option value="po_terminu">Po termínu</option>
            <option value="blizi_se">Blíží se</option>
            <option value="v_poradku">V pořádku</option>
          </select>
        </label>
        {hasActiveFilters && (
          <button onClick={() => { setFilterTyp("vsetko"); setFilterStav("vsetko"); }} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1.5">
            Zrušit filtry
          </button>
        )}
        {hasActiveFilters && (
          <div className="text-xs text-slate-400 ml-auto">{sortedWithStatus.length} z {terminy.length} termínů</div>
        )}
      </div>

      {formOpen && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
          <TerminFormFields values={form} onChange={setForm} />
          {formError && <div className="mb-2 text-xs text-red-700 flex items-center gap-1.5"><AlertCircle size={12} /> {formError}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={() => { setFormOpen(false); setForm(emptyTerminForm()); setFormError(""); }} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
            <button onClick={submit} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Uložit</button>
          </div>
        </div>
      )}

      {sortedWithStatus.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500">
          {terminy.length === 0 ? "Žádné termíny." : "Žádné termíny neodpovídají zadaným filtrům."}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {sortedWithStatus.map(({ k, status }) => (
            <div key={k.id} className={"bg-white rounded-lg p-4 border " + (status.key === "po_terminu" ? "border-red-400" : "border-slate-200")}>
              {editingId === k.id ? (
                <>
                  <TerminFormFields values={editForm} onChange={setEditForm} />
                  {editError && <div className="mb-2 text-xs text-red-700 flex items-center gap-1.5"><AlertCircle size={12} /> {editError}</div>}
                  <div className="flex justify-end gap-2">
                    <button onClick={cancelEdit} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
                    <button onClick={saveEdit} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Uložit</button>
                  </div>
                </>
              ) : (
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-[240px]">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className={"text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap " + terminGroupBadgeClass(k.typ)}>{terminTypLabel(k.typ)}</span>
                      <span className={"text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap " + TERMIN_STATUS_META[status.key].cls}>{terminStatusLabel(status)}</span>
                    </div>
                    <div className="font-medium text-slate-800">{k.predmet}</div>
                    {k.nazov && <div className="text-sm text-slate-500">{k.nazov}</div>}
                    {k.poznamka && <div className="text-xs text-slate-400 mt-1">{k.poznamka}</div>}
                  </div>

                  <div className="text-sm text-right">
                    <div className="text-xs text-slate-400">Poslední: {k.datumPoslednej || "-"}</div>
                    <div className="font-semibold text-slate-800">Další: {status.nextDue || "-"}</div>
                    <div className="text-xs text-slate-400">Frekvence: {k.frekvenciaHodnota}&times; {frekvenciaLabel(k.frekvenciaTyp).toLowerCase()}</div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    {k.dokumentPath ? (
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => openKvalitaDokument(k.dokumentPath)} title={k.dokumentNazovSuboru} className="text-xs text-teal-700 hover:text-teal-900 font-medium flex items-center gap-1"><FileCheck size={14} /> Otevřít</button>
                        <label className="text-xs text-slate-400 hover:text-slate-700 cursor-pointer">
                          (nahradit)
                          <input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => uploadDokument(k, e.target.files && e.target.files[0])} />
                        </label>
                      </div>
                    ) : (
                      <label className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded-md font-medium flex items-center gap-1 w-fit cursor-pointer">
                        {uploadingId === k.id ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Nahrát
                        <input type="file" accept=".pdf,image/*" className="hidden" disabled={uploadingId === k.id} onChange={(e) => uploadDokument(k, e.target.files && e.target.files[0])} />
                      </label>
                    )}
                    <button onClick={() => startEdit(k)} title="Upravit termín" className="text-slate-400 hover:text-teal-700 p-1"><Pencil size={16} /></button>
                    <button onClick={() => onDeleteTermin(k.id)} title="Smazat termín" className="text-slate-400 hover:text-red-600 p-1"><Trash2 size={16} /></button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
