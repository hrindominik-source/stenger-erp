import React, { useState, useEffect, useCallback } from "react";
import { Loader2, Printer, Tablet, Handshake, Mail, Ban, FilePlus2, CheckCircle2, Clock, AlertCircle } from "lucide-react";
import { supabase } from "../supabaseClient.js";
import { uid } from "../lib/utils.js";
import { hrFileName } from "../lib/hr/fileNames.js";
import {
  documentRequiredSigners, defaultLegalActType, signatureCounts, isS334Document,
  SIGNER_LABELS, LEGAL_ACT_LABELS, SIGNATURE_METHOD_LABELS,
} from "../lib/hr/signingRules.js";
import { deliveryState, deliveryDeadlines, documentDeliveryState, DELIVERY_CHANNEL_LABELS } from "../lib/hr/deliveryStatus.js";

/* =========================================================================
   Detail dokumentu (faza E) - rozbalovaci panel pod polozkou v zalozke
   Dokumenty. Tri casti: vytvorenie, podpis, odovzdanie/dorucenie + akcie.
   Pravidla vynucuje DB (migracie 48-52); tu sa len zobrazuju a vysvetluju.
   ========================================================================= */

const CLOSED = ["VOIDED", "SUPERSEDED"];
const SIGNED = ["SIGNED", "ARCHIVED"];
const fmtTs = (iso) => (iso ? new Date(iso).toLocaleString("cs-CZ") : "—");
const short = (h) => (h ? `${h.slice(0, 16)}…` : "—");
const todayIso = () => new Date().toISOString().slice(0, 10);

function Section({ title, children }) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">{title}</div>
      <div className="text-sm space-y-1">{children}</div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex gap-2 flex-wrap">
      <span className="text-slate-500 w-36 shrink-0">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

const DEADLINE_CLS = { running: "text-slate-700", warn: "text-amber-700 font-medium", over: "text-red-700 font-medium", info: "text-slate-500" };

function ActionButton({ icon: Icon, children, onClick, disabled, reason, tone = "teal" }) {
  const cls = disabled
    ? "text-slate-400 cursor-not-allowed"
    : tone === "red" ? "text-red-700 hover:text-red-900" : "text-teal-700 hover:text-teal-900";
  return (
    <span className="inline-flex flex-col">
      <button type="button" onClick={onClick} disabled={disabled} title={disabled ? reason : undefined}
        className={"text-sm flex items-center gap-1 " + cls}>
        <Icon size={14} /> {children}
      </button>
      {disabled && reason && <span className="text-[11px] text-slate-400 max-w-[16rem]">{reason}</span>}
    </span>
  );
}

export default function DocumentDetail({ doc, signatures = [], documents = [], employee, employment, docLabel, openFile, can, onChanged }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deliveries, setDeliveries] = useState([]);
  const [events, setEvents] = useState([]);
  const [templateName, setTemplateName] = useState("");
  const [names, setNames] = useState({}); // auth uid -> full_name
  const [form, setForm] = useState(null); // "handover" | "void" | "version"

  // Kluc (string), nie pole - rodic posiela pri kazdom vykresleni nove pole.
  const signatureUsers = signatures.flatMap((s) => [s.uploaded_by, s.scan_matches_original_confirmed_by]).filter(Boolean).join(",");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const [dlRes, evRes, tplRes] = await Promise.all([
      supabase.from("hr_document_deliveries").select("*").eq("hr_document_id", doc.id).order("created_at", { ascending: true }),
      supabase.from("hr_document_events").select("*").eq("hr_document_id", doc.id).order("created_at", { ascending: true }),
      doc.template_id ? supabase.from("hr_document_templates").select("name").eq("id", doc.template_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    if (dlRes.error || evRes.error) setError("Nepodařilo se načíst předání a události dokumentu.");
    const dls = dlRes.data || [];
    const evs = evRes.data || [];
    setDeliveries(dls);
    setEvents(evs);
    setTemplateName(tplRes.data?.name || "");
    const ids = [...new Set([doc.generated_by, doc.finalized_by, ...dls.map((d) => d.handed_over_by), ...evs.map((e) => e.created_by),
      ...signatureUsers.split(",")].filter(Boolean))];
    if (ids.length) {
      const { data } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      setNames(Object.fromEntries((data || []).map((p) => [p.id, p.full_name])));
    }
    setLoading(false);
  }, [doc.id, doc.template_id, doc.generated_by, doc.finalized_by, signatureUsers]);
  useEffect(() => { load(); }, [load]);

  const who = (id) => (id ? names[id] || "—" : "—");
  const legalAct = doc.legal_act_type || defaultLegalActType(doc.doc_type);
  const required = documentRequiredSigners(doc);
  const closed = CLOSED.includes(doc.status);
  const fullySigned = SIGNED.includes(doc.status);
  const previous = documents.find((d) => d.id === doc.supersedes_document_id);
  const overall = documentDeliveryState(deliveries);
  const s334 = isS334Document(doc);

  async function printDownload() {
    const { error: err } = await supabase.from("hr_document_events").insert({ hr_document_id: doc.id, event_type: "PRINT_DOWNLOADED" });
    if (err) { setError(err.message); return; }
    await openFile(doc.final_pdf_path, hrFileName(`${docLabel} – k tisku`, employee, doc.finalized_at, "pdf"));
    load();
  }

  const printReason = !doc.final_pdf_path ? "Nejdřív nahrajte finální PDF." : fullySigned ? "Dokument je podepsán – použijte podepsaný originál." : closed ? "Dokument je zneplatněn / nahrazen." : "";
  const handoverReason = !can.send ? "Chybí oprávnění k předávání dokumentů." : closed ? "Dokument je zneplatněn / nahrazen."
    : !fullySigned ? "Předat lze až dokument podepsaný všemi stranami." : overall.key === "DELIVERED" ? "Dokument už byl předán." : "";
  const emailReason = !fullySigned ? "Dokument není podepsán všemi stranami." : "Odesílání e-mailem se připravuje (fáze G) – zatím předejte osobně.";

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      {loading ? (
        <div className="text-sm text-slate-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Načítám detail…</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md mb-2">{error}</div>}

          <Section title="Vytvoření">
            <Row label="Typ úkonu">{LEGAL_ACT_LABELS[legalAct] || "neurčen"}{!doc.legal_act_type && legalAct && <span className="text-slate-400"> (podle druhu dokumentu)</span>}</Row>
            <Row label="Verze">
              v{doc.version_no || 1}
              {previous && <span className="text-slate-500"> · nahrazuje v{previous.version_no || 1}{previous.void_reason ? ` (${previous.void_reason})` : ""}</span>}
              {doc.superseded_by && <span className="text-amber-700"> · nahrazena novější verzí</span>}
            </Row>
            <Row label="Šablona">{templateName || (doc.origin === "UPLOADED" ? "nahráno ručně" : "—")}</Row>
            <Row label="Vytvořil(a)">{who(doc.generated_by)} · {fmtTs(doc.generated_at || doc.created_at)}</Row>
            <Row label="Finální PDF">
              {doc.final_pdf_sha256
                ? <>otisk <code className="font-mono text-xs">{short(doc.final_pdf_sha256)}</code> · {fmtTs(doc.finalized_at)}{doc.finalized_by ? ` · ${who(doc.finalized_by)}` : ""}</>
                : <span className="text-slate-500">zatím nenahráno</span>}
            </Row>
            {doc.void_reason && <Row label={doc.status === "VOIDED" ? "Zneplatněno" : "Důvod náhrady"}>{doc.void_reason}{doc.voided_at ? ` · ${fmtTs(doc.voided_at)}` : ""}</Row>}
          </Section>

          <Section title="Podpis">
            {required.map((r) => {
              const mine = signatures.filter((s) => s.signer_type === r);
              const ok = mine.filter((s) => signatureCounts(doc, s));
              return (
                <div key={r}>
                  <div className="flex items-center gap-1.5">
                    {ok.length ? <CheckCircle2 size={14} className="text-emerald-600" /> : <Clock size={14} className="text-slate-400" />}
                    <span className="font-medium">{SIGNER_LABELS[r]}</span>
                    {!ok.length && <span className="text-slate-500">– {closed ? "nepodepsáno" : "čeká na podpis"}</span>}
                  </div>
                  {mine.map((s) => (
                    <div key={s.id} className={"ml-5 text-xs " + (signatureCounts(doc, s) ? "text-slate-600" : "text-red-700")}>
                      {s.signed_by_name || "—"} · {fmtTs(s.signed_at || s.created_at)} · {SIGNATURE_METHOD_LABELS[s.method] || s.method}
                      {" · "}
                      {s.method === "PAPER"
                        ? <>sken <code className="font-mono">{short(s.document_hash)}</code>{s.signed_content_sha256 ? <> k verzi <code className="font-mono">{short(s.signed_content_sha256)}</code></> : " (bez finálního PDF)"}{s.scan_matches_original_confirmed_by ? `, shodu ověřil(a) ${who(s.scan_matches_original_confirmed_by)}` : ""}</>
                        : signatureCounts(doc, s) ? <>k aktuální verzi <code className="font-mono">{short(s.signed_content_sha256)}</code></> : "podpis jiné verze – nepočítá se"}
                    </div>
                  ))}
                </div>
              );
            })}
            {signatures.filter((s) => !required.includes(s.signer_type)).map((s) => (
              <div key={s.id} className="text-xs text-slate-500">Navíc: {SIGNER_LABELS[s.signer_type] || s.signer_type} – {s.signed_by_name} · {fmtTs(s.signed_at || s.created_at)}</div>
            ))}
            <div className="text-xs text-slate-500 pt-1">
              {fullySigned ? "Podepsáno všemi stranami." : closed ? "Dokument je zneplatněn / nahrazen – další podpisy se nesbírají." : doc.locked_at ? `Zamčeno ${fmtTs(doc.locked_at)} – obsah už nelze měnit, čeká se na zbývající podpisy.` : "Zatím bez podpisu."}
            </div>
          </Section>

          <Section title="Předání / doručení">
            <Row label="Stav"><span className={overall.key === "DELIVERED" ? "text-emerald-700" : overall.key === "INEFFECTIVE" ? "text-red-700" : ""}>{overall.label}</span></Row>
            {deliveries.map((dl) => {
              const st = deliveryState(dl);
              return (
                <div key={dl.id} className="border-l-2 border-slate-200 pl-2">
                  <div>{DELIVERY_CHANNEL_LABELS[dl.channel] || dl.channel}{dl.recipient_snapshot ? ` → ${dl.recipient_snapshot}` : ""} · <span className="text-slate-600">{st.label}</span>{st.reason ? ` (${st.reason})` : ""}</div>
                  <div className="text-xs text-slate-500">
                    {dl.delivered_at && <>předáno/doručeno {fmtTs(dl.delivered_at)}{dl.handed_over_by ? ` · předal(a) ${who(dl.handed_over_by)}` : ""}</>}
                    {!dl.delivered_at && dl.sent_at && <>odesláno {fmtTs(dl.sent_at)}</>}
                    {dl.confirmation_evidence?.note && <> · {dl.confirmation_evidence.note}</>}
                  </div>
                  {deliveryDeadlines(dl, { today: todayIso(), startDate: employment?.start_date }).map((d) => (
                    <div key={d.key} className={"text-xs flex items-center gap-1 " + DEADLINE_CLS[d.state]}>
                      {d.state === "over" || d.state === "warn" ? <AlertCircle size={12} /> : <Clock size={12} />} {d.label}
                    </div>
                  ))}
                </div>
              );
            })}
            {events.map((e) => (
              <div key={e.id} className="text-xs text-slate-500">Staženo k tisku {fmtTs(e.created_at)} · {who(e.created_by)}{e.document_sha256 ? <> · verze <code className="font-mono">{short(e.document_sha256)}</code></> : ""}</div>
            ))}
          </Section>

          <Section title="Akce">
            <div className="flex flex-wrap gap-x-5 gap-y-2 items-start">
              <ActionButton icon={Printer} onClick={printDownload} disabled={!!printReason} reason={printReason}>Stáhnout k tisku</ActionButton>
              <ActionButton icon={Tablet} disabled reason="Připravuje se (fáze F).">Podepsat na tabletu</ActionButton>
              <ActionButton icon={Handshake} onClick={() => setForm("handover")} disabled={!!handoverReason} reason={handoverReason}>Zaznamenat předání</ActionButton>
              <ActionButton icon={Mail} disabled reason={emailReason}>Odeslat e-mailem</ActionButton>
              {(can.generate || can.approve) && !closed && (
                <ActionButton icon={Ban} tone="red" onClick={() => setForm("void")}>Zneplatnit</ActionButton>
              )}
              {can.generate && !closed && (
                <ActionButton icon={FilePlus2} onClick={() => setForm("version")} disabled={fullySigned}
                  reason={fullySigned ? "Podepsaný dokument se nenahrazuje – zneplatněte ho a vytvořte nový." : ""}>Vytvořit novou verzi</ActionButton>
              )}
            </div>
            {form === "handover" && (
              <HandoverForm doc={doc} s334={s334} onCancel={() => setForm(null)} onSaved={() => { setForm(null); load(); onChanged?.(); }} />
            )}
            {form === "void" && (
              <ReasonForm title="Zneplatnit dokument" confirm="Zneplatnit" danger
                hint={fullySigned ? "Podepsaný dokument zůstane v archivu jako zneplatněný – nic se nemaže." : "Dokument zůstane v archivu jako zneplatněný – nic se nemaže."}
                onCancel={() => setForm(null)}
                onSubmit={async (reason) => {
                  const { error: err } = await supabase.from("hr_documents").update({ status: "VOIDED", void_reason: reason, updated_at: new Date().toISOString() }).eq("id", doc.id);
                  if (err) return err.message;
                  setForm(null); onChanged?.();
                  return null;
                }} />
            )}
            {form === "version" && (
              <ReasonForm title="Vytvořit novou verzi" confirm="Vytvořit verzi"
                hint="Vznikne kopie jako koncept (verze + 1) se stejným vygenerovaným souborem; upravte ji ve Wordu a nahrajte nové finální PDF. Tato verze bude označena jako nahrazená."
                onCancel={() => setForm(null)}
                onSubmit={async (reason) => {
                  const { error: err } = await supabase.rpc("hr_document_new_version", { p_document_id: doc.id, p_reason: reason });
                  if (err) return err.message;
                  setForm(null); onChanged?.();
                  return null;
                }} />
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

function ReasonForm({ title, hint, confirm, danger, onCancel, onSubmit }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (!reason.trim()) { setError("Uveďte důvod."); return; }
    setBusy(true);
    setError((await onSubmit(reason.trim())) || "");
    setBusy(false);
  }
  return (
    <div className="mt-3 border border-slate-200 rounded-md p-3 bg-slate-50">
      <div className="font-medium text-sm mb-1">{title}</div>
      {hint && <div className="text-xs text-slate-500 mb-2">{hint}</div>}
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Důvod"
        className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm mb-2" />
      {error && <div className="text-xs text-red-700 mb-2">{error}</div>}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={busy}
          className={"text-white text-sm px-3 py-1.5 rounded-md disabled:opacity-50 " + (danger ? "bg-red-700 hover:bg-red-800" : "bg-teal-700 hover:bg-teal-800")}>
          {busy ? "Ukládám…" : confirm}
        </button>
        <button type="button" onClick={onCancel} className="text-sm px-3 py-1.5 text-slate-600">Zrušit</button>
      </div>
    </div>
  );
}

// Osobne odovzdanie vyhotovenia. Pisomnost § 334 len proti podpisu
// potvrdenia prevzatia (DB: hr_document_deliveries_in_person).
function HandoverForm({ doc, s334, onCancel, onSaved }) {
  const [date, setDate] = useState(todayIso());
  const [receipt, setReceipt] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (!date || date > todayIso()) { setError("Zadejte datum předání (nejpozději dnes)."); return; }
    if (s334 && !receipt) { setError("Písemnost § 334 lze předat jen proti podpisu potvrzení o převzetí."); return; }
    setBusy(true);
    setError("");
    const basis = receipt ? "SIGNED_RECEIPT" : "HANDED_OVER";
    const { error: err } = await supabase.from("hr_document_deliveries").insert({
      id: uid(), hr_document_id: doc.id, channel: "IN_PERSON_PAPER",
      delivered_at: date === todayIso() ? new Date().toISOString() : `${date}T12:00:00Z`, delivery_basis: basis,
      confirmation_evidence: receipt || note.trim() ? { receipt: receipt ? "PAPER_SIGNATURE" : null, note: note.trim() || null } : null,
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onSaved();
  }
  return (
    <div className="mt-3 border border-slate-200 rounded-md p-3 bg-slate-50">
      <div className="font-medium text-sm mb-1">Zaznamenat osobní předání vyhotovení</div>
      <div className="text-xs text-slate-500 mb-2">Předal(a): přihlášený uživatel. Předává se podepsané vyhotovení{doc.signed_pdf_sha256 ? " (podepsaný originál)" : ""}.</div>
      <label className="block text-xs text-slate-600 mb-1">Datum předání</label>
      <input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)}
        className="border border-slate-300 rounded-md px-3 py-1.5 text-sm mb-2" />
      <label className="flex items-start gap-2 text-sm mb-2">
        <input type="checkbox" checked={receipt} onChange={(e) => setReceipt(e.target.checked)} className="mt-0.5" />
        <span>Zaměstnanec převzetí potvrdil podpisem (potvrzení o převzetí / podpis na kopii){s334 && <span className="text-red-700"> – povinné u písemnosti § 334</span>}</span>
      </label>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Poznámka (nepovinné)"
        className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm mb-2" />
      {error && <div className="text-xs text-red-700 mb-2">{error}</div>}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={busy} className="bg-teal-700 hover:bg-teal-800 text-white text-sm px-3 py-1.5 rounded-md disabled:opacity-50">
          {busy ? "Ukládám…" : "Zaznamenat předání"}
        </button>
        <button type="button" onClick={onCancel} className="text-sm px-3 py-1.5 text-slate-600">Zrušit</button>
      </div>
    </div>
  );
}
