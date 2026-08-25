import React, { useState, useEffect, useCallback, useRef } from "react";
import { LogOut, ArrowLeft, Loader2, AlertCircle, LayoutDashboard, ListChecks, CalendarClock, Plus, Trash2, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "./supabaseClient.js";
import { todayStr, uid, computeNextDue, daysUntil, isoFromSkDateStr, skDateStrFromIso } from "./lib/utils.js";

const POLL_MS = 10000;

const FREKVENCIA_OPTIONS = [
  { value: "dni", label: "Dní" },
  { value: "tyzdne", label: "Týdnů" },
  { value: "mesiace", label: "Měsíců" },
  { value: "roky", label: "Roků" },
];

const TERMIN_TYP_OPTIONS = [
  { value: "zdravotna_prehliadka", label: "Zdravotní prohlídka" },
  { value: "vzv_kontrola", label: "Kontrola VZV" },
  { value: "vzv_skolenie", label: "Školení VZV" },
  { value: "skolenie", label: "Školení" },
  { value: "ine_bozp", label: "Jiné BOZP" },
];

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
            <img src="/stenger-logo.png" alt="Stenger" className="h-10 w-auto" />
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
  return { nazov: "", polozky: [""], frekvenciaTyp: "mesiace", frekvenciaHodnota: "1" };
}

function ChecklistyTab({ fullName, templates, submissions, onSaveTemplate, onUpdateTemplate, onDeleteTemplate, onSaveSubmission }) {
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyTemplateForm());
  const [formError, setFormError] = useState("");
  const [fillId, setFillId] = useState(null);
  const [openHistoryId, setOpenHistoryId] = useState(null);

  function updatePolozka(i, v) {
    const next = form.polozky.slice();
    next[i] = v;
    setForm({ ...form, polozky: next });
  }
  function addPolozka() { setForm({ ...form, polozky: [...form.polozky, ""] }); }
  function removePolozka(i) { setForm({ ...form, polozky: form.polozky.filter((_, idx) => idx !== i) }); }

  function submitTemplate() {
    const polozky = form.polozky.map((p) => p.trim()).filter(Boolean);
    if (!form.nazov.trim()) { setFormError("Vyplňte název checklistu."); return; }
    if (polozky.length === 0) { setFormError("Přidejte alespoň jednu položku."); return; }
    if (!Number(form.frekvenciaHodnota)) { setFormError("Vyplňte frekvenci."); return; }
    setFormError("");
    onSaveTemplate({
      id: uid(),
      nazov: form.nazov.trim(),
      polozky: polozky.map((text) => ({ text })),
      frekvenciaTyp: form.frekvenciaTyp,
      frekvenciaHodnota: form.frekvenciaHodnota,
      aktivny: true,
      vytvorene: todayStr(),
    });
    setForm(emptyTemplateForm());
    setFormOpen(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Checklisty</h1>
        <button onClick={() => setFormOpen((v) => !v)} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md">
          <Plus size={16} /> Nový checklist
        </button>
      </div>

      {formOpen && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
          <label className="block mb-2">
            <span className="block text-xs font-medium text-slate-500 mb-1">Název checklistu</span>
            <input value={form.nazov} onChange={(e) => setForm({ ...form, nazov: e.target.value })} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
          </label>
          <div className="mb-2">
            <span className="block text-xs font-medium text-slate-500 mb-1">Položky checklistu</span>
            {form.polozky.map((p, i) => (
              <div key={i} className="flex gap-2 mb-1.5">
                <input value={p} onChange={(e) => updatePolozka(i, e.target.value)} className="flex-1 border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" placeholder={`Položka ${i + 1}`} />
                <button onClick={() => removePolozka(i)} className="text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>
              </div>
            ))}
            <button onClick={addPolozka} className="text-xs text-teal-700 hover:text-teal-900 flex items-center gap-1 mt-1"><Plus size={12} /> Přidat položku</button>
          </div>
          <div className="flex gap-2 items-end mb-3">
            <label className="w-40">
              <span className="block text-xs font-medium text-slate-500 mb-1">Frekvence - každých</span>
              <input value={form.frekvenciaHodnota} onChange={(e) => setForm({ ...form, frekvenciaHodnota: e.target.value })} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
            </label>
            <label className="w-40">
              <span className="block text-xs font-medium text-slate-500 mb-1">&nbsp;</span>
              <select value={form.frekvenciaTyp} onChange={(e) => setForm({ ...form, frekvenciaTyp: e.target.value })} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm">
                {FREKVENCIA_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </label>
          </div>
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
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="font-semibold">{t.nazov}</div>
                    <div className="text-xs text-slate-400">Frekvence: každých {t.frekvenciaHodnota} {frekvenciaLabel(t.frekvenciaTyp).toLowerCase()} - další termín: {nextDue || "-"}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setFillId(fillId === t.id ? null : t.id)} className="text-xs bg-teal-700 hover:bg-teal-800 text-white font-medium px-3 py-1.5 rounded-md">Vyplnit</button>
                    <button onClick={() => onDeleteTemplate(t.id)} className="text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChecklistFillForm({ template, fullName, onCancel, onSave }) {
  const [odpovede, setOdpovede] = useState(template.polozky.map((p) => ({ text: p.text, ok: true, poznamka: "" })));
  const [vyplnil, setVyplnil] = useState(fullName || "");
  const [poznamka, setPoznamka] = useState("");

  function toggle(i) {
    const next = odpovede.slice();
    next[i] = { ...next[i], ok: !next[i].ok };
    setOdpovede(next);
  }
  function setNote(i, v) {
    const next = odpovede.slice();
    next[i] = { ...next[i], poznamka: v };
    setOdpovede(next);
  }

  return (
    <div className="mt-3 pt-3 border-t border-slate-100 bg-slate-50 -mx-4 -mb-4 px-4 pb-4 rounded-b-lg">
      <label className="block mb-2">
        <span className="block text-xs font-medium text-slate-500 mb-1">Vyplnil(a)</span>
        <input value={vyplnil} onChange={(e) => setVyplnil(e.target.value)} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
      </label>
      <div className="space-y-1.5 mb-2">
        {odpovede.map((o, i) => (
          <div key={i} className="flex items-center gap-2 bg-white border border-slate-200 rounded-md px-2.5 py-1.5">
            <input type="checkbox" checked={o.ok} onChange={() => toggle(i)} />
            <span className="text-sm flex-1">{o.text}</span>
            {!o.ok && (
              <input value={o.poznamka} onChange={(e) => setNote(i, e.target.value)} placeholder="Poznámka k neshodě" className="w-48 border border-slate-200 rounded px-2 py-1 text-xs" />
            )}
          </div>
        ))}
      </div>
      <label className="block mb-2">
        <span className="block text-xs font-medium text-slate-500 mb-1">Poznámka (nepovinné)</span>
        <input value={poznamka} onChange={(e) => setPoznamka(e.target.value)} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
      </label>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
        <button
          onClick={() => onSave({ id: uid(), templateId: template.id, datum: todayStr(), vyplnil: vyplnil.trim() || "-", odpovede, poznamka: poznamka.trim() })}
          className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md"
        >
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

function TerminyTab({ terminy, onSaveTermin, onUpdateTermin, onDeleteTermin }) {
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyTerminForm());
  const [formError, setFormError] = useState("");
  const [filterTyp, setFilterTyp] = useState("vsetko");

  function submit() {
    if (!form.predmet.trim()) { setFormError("Vyplňte, koho/čeho se termín týká."); return; }
    if (!form.datumPoslednej) { setFormError("Vyplňte datum poslední revize/prohlídky."); return; }
    if (!Number(form.frekvenciaHodnota)) { setFormError("Vyplňte frekvenci."); return; }
    setFormError("");
    onSaveTermin({ id: uid(), ...form });
    setForm(emptyTerminForm());
    setFormOpen(false);
  }

  const filtered = filterTyp === "vsetko" ? terminy : terminy.filter((t) => t.typ === filterTyp);
  const sorted = filtered.slice().sort((a, b) => {
    const da = daysUntil(computeNextDue(a.datumPoslednej, a.frekvenciaTyp, a.frekvenciaHodnota));
    const db = daysUntil(computeNextDue(b.datumPoslednej, b.frekvenciaTyp, b.frekvenciaHodnota));
    return (da ?? 9999) - (db ?? 9999);
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-xl font-semibold">Termíny / BOZP</h1>
        <button onClick={() => setFormOpen((v) => !v)} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md">
          <Plus size={16} /> Nový termín
        </button>
      </div>

      <div className="flex gap-2 flex-wrap mb-4">
        <button onClick={() => setFilterTyp("vsetko")} className={"text-xs px-3 py-1.5 rounded-md border " + (filterTyp === "vsetko" ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>Vše</button>
        {TERMIN_TYP_OPTIONS.map((o) => (
          <button key={o.value} onClick={() => setFilterTyp(o.value)} className={"text-xs px-3 py-1.5 rounded-md border " + (filterTyp === o.value ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>{o.label}</button>
        ))}
      </div>

      {formOpen && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <label className="block mb-2">
              <span className="block text-xs font-medium text-slate-500 mb-1">Typ</span>
              <select value={form.typ} onChange={(e) => setForm({ ...form, typ: e.target.value })} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm">
                {TERMIN_TYP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="block mb-2">
              <span className="block text-xs font-medium text-slate-500 mb-1">Koho/čeho se týká (jméno, VZV č. ...)</span>
              <input value={form.predmet} onChange={(e) => setForm({ ...form, predmet: e.target.value })} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
            </label>
            <label className="block mb-2 sm:col-span-2">
              <span className="block text-xs font-medium text-slate-500 mb-1">Název / poznámka (nepovinné)</span>
              <input value={form.nazov} onChange={(e) => setForm({ ...form, nazov: e.target.value })} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
            </label>
            <label className="block mb-2">
              <span className="block text-xs font-medium text-slate-500 mb-1">Datum poslední revize/prohlídky</span>
              <input type="date" value={isoFromSkDateStr(form.datumPoslednej)} onChange={(e) => setForm({ ...form, datumPoslednej: skDateStrFromIso(e.target.value) })} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
            </label>
            <div className="flex gap-2 mb-2">
              <label className="w-1/2">
                <span className="block text-xs font-medium text-slate-500 mb-1">Frekvence - každých</span>
                <input value={form.frekvenciaHodnota} onChange={(e) => setForm({ ...form, frekvenciaHodnota: e.target.value })} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
              </label>
              <label className="w-1/2">
                <span className="block text-xs font-medium text-slate-500 mb-1">&nbsp;</span>
                <select value={form.frekvenciaTyp} onChange={(e) => setForm({ ...form, frekvenciaTyp: e.target.value })} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm">
                  {FREKVENCIA_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </label>
            </div>
            <label className="block mb-2">
              <span className="block text-xs font-medium text-slate-500 mb-1">Upozornit kolik dní předem</span>
              <input value={form.notifikaciaDniPred} onChange={(e) => setForm({ ...form, notifikaciaDniPred: e.target.value })} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
            </label>
            <label className="block mb-2">
              <span className="block text-xs font-medium text-slate-500 mb-1">Poznámka</span>
              <input value={form.poznamka} onChange={(e) => setForm({ ...form, poznamka: e.target.value })} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
            </label>
          </div>
          {formError && <div className="mb-2 text-xs text-red-700 flex items-center gap-1.5"><AlertCircle size={12} /> {formError}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={() => { setFormOpen(false); setForm(emptyTerminForm()); setFormError(""); }} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
            <button onClick={submit} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Uložit</button>
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500">Žádné termíny.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-left">
                <th className="px-3 py-2 font-medium">Typ</th>
                <th className="px-3 py-2 font-medium">Koho/čeho se týká</th>
                <th className="px-3 py-2 font-medium">Poslední</th>
                <th className="px-3 py-2 font-medium">Frekvence</th>
                <th className="px-3 py-2 font-medium">Další termín</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((k) => {
                const nextDue = computeNextDue(k.datumPoslednej, k.frekvenciaTyp, k.frekvenciaHodnota);
                const diff = daysUntil(nextDue);
                const tone = diff !== null && diff < 0 ? "bg-red-50" : diff !== null && diff <= (Number(k.notifikaciaDniPred) || 0) ? "bg-amber-50" : "";
                return (
                  <tr key={k.id} className={"border-t border-slate-100 " + tone}>
                    <td className="px-3 py-2 whitespace-nowrap">{terminTypLabel(k.typ)}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{k.predmet}</div>
                      {k.nazov && <div className="text-xs text-slate-400">{k.nazov}</div>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <input
                        type="date"
                        value={isoFromSkDateStr(k.datumPoslednej)}
                        onChange={(e) => onUpdateTermin({ ...k, datumPoslednej: skDateStrFromIso(e.target.value) })}
                        className="border border-slate-200 rounded px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-500">{k.frekvenciaHodnota} {frekvenciaLabel(k.frekvenciaTyp).toLowerCase()}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-medium">{nextDue || "-"}</td>
                    <td className="px-3 py-2 text-right"><button onClick={() => onDeleteTermin(k.id)} className="text-slate-400 hover:text-red-600"><Trash2 size={16} /></button></td>
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
