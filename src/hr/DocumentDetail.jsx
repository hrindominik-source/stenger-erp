import React, { useState, useEffect, useCallback } from "react";
import { Loader2, Printer, Tablet, Handshake, Mail, Ban, FilePlus2, CheckCircle2, Clock, AlertCircle, FileSignature, GraduationCap, Stamp } from "lucide-react";
import { supabase } from "../supabaseClient.js";
import { uid } from "../lib/utils.js";
import { hrFileName } from "../lib/hr/fileNames.js";
import {
  documentRequiredSigners, defaultLegalActType, signatureCounts, isS334Document, missingSigners,
  SIGNER_LABELS, LEGAL_ACT_LABELS, signatureMethodLabel,
} from "../lib/hr/signingRules.js";
import TabletSigning, { invokeSigning } from "./signing/TabletSigning.jsx";
import { invokeDeclarations } from "./Declarations.jsx";
import { IDENTITY_DOCUMENTS, CERTIFICATE_STATUS_LABELS } from "../../supabase/functions/_shared/hr/tabletSigning.js";
import QRCode from "qrcode";
import { deliveryState, deliveryDeadlines, documentDeliveryState, czDate, DELIVERY_CHANNEL_LABELS, MAX_SEND_ATTEMPTS } from "../lib/hr/deliveryStatus.js";

/* =========================================================================
   Detail dokumentu (faza E) - rozbalovaci panel pod polozkou v zalozke
   Dokumenty. Tri casti: vytvorenie, podpis, odovzdanie/dorucenie + akcie.
   Pravidla vynucuje DB (migracie 48-52); tu sa len zobrazuju a vysvetluju.
   ========================================================================= */

const CLOSED = ["VOIDED", "SUPERSEDED"];
const SIGNED = ["SIGNED", "ARCHIVED"];
const SIGNED_DECLARATION_TYPES = ["s21_oznameni_adresy", "s335_souhlas", "s335_odvolani"]; // = hr_is_employee_declaration (migracia 61)
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

const ESIGN_PENDING = "Elektronický podpis čeká na schválení textů – použijte papírový postup.";

export default function DocumentDetail({ doc, signatures = [], previousSignatures = [], documents = [], employee, employment, docLabel, openFile, can, onChanged }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deliveries, setDeliveries] = useState([]);
  const [events, setEvents] = useState([]);
  const [templateName, setTemplateName] = useState("");
  const [names, setNames] = useState({}); // auth uid -> full_name
  const [form, setForm] = useState(null); // "handover" | "void" | "version" | "amendment" | "tablet" | ...
  const [verifications, setVerifications] = useState([]); // overenie certifikatu uznavaneho podpisu
  const [verifyId, setVerifyId] = useState(null);
  const [dlForm, setDlForm] = useState(null); // { id, kind: "confirm" | "withdrawal" }
  const [dlBusy, setDlBusy] = useState(false);
  // chybajuce podpisy podla servera (ten isty udaj, z ktoreho server odmieta „uz podepsal“)
  const [serverMissing, setServerMissing] = useState(null);
  const [completion, setCompletion] = useState({ busy: false, error: "" });

  // Kluc (string), nie pole - rodic posiela pri kazdom vykresleni nove pole.
  const signatureUsers = signatures.flatMap((s) => [s.uploaded_by, s.scan_matches_original_confirmed_by]).filter(Boolean).join(",");
  const textVersionId = doc.variables_snapshot?.text_version_id || "";
  const qualifiedIds = signatures.filter((s) => s.method === "ELECTRONIC_QUALIFIED").map((s) => s.id).join(",");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    // Faza G: vyhodnotit lehoty (neucinnost § 335 odst. 3, fikcia § 335) pred zobrazenim.
    await supabase.rpc("hr_document_deliveries_sweep").then(() => null, () => null);
    const [dlRes, evRes, tplRes, verRes, missRes] = await Promise.all([
      supabase.from("hr_document_deliveries").select("*").eq("hr_document_id", doc.id).order("created_at", { ascending: true }),
      supabase.from("hr_document_events").select("*").eq("hr_document_id", doc.id).order("created_at", { ascending: true }),
      doc.template_id ? supabase.from("hr_document_templates").select("name").eq("id", doc.template_id).maybeSingle()
        // vyhlasenia (§ 21 / § 335) vznikaju z verzovaneho textu, nie zo sablony
        : textVersionId ? supabase.from("hr_legal_text_versions").select("title, version_no, status").eq("id", textVersionId).maybeSingle()
        : Promise.resolve({ data: null }),
      qualifiedIds ? supabase.from("hr_signature_verifications").select("*").in("signature_id", qualifiedIds.split(",")).order("verified_at", { ascending: false }) : Promise.resolve({ data: [] }),
      supabase.rpc("hr_document_missing_signers", { p_document_id: doc.id }),
    ]);
    setServerMissing(missRes.error ? null : (missRes.data || []));
    setVerifications(verRes.data || []);
    if (dlRes.error || evRes.error) setError("Nepodařilo se načíst předání a události dokumentu.");
    const dls = dlRes.data || [];
    const evs = evRes.data || [];
    setDeliveries(dls);
    setEvents(evs);
    const tpl = tplRes.data;
    setTemplateName(!tpl ? "" : tpl.name || `text „${tpl.title}“, verze ${tpl.version_no}${tpl.status === "KONCEPT" ? " (koncept)" : tpl.status === "VYRAZENO" ? " (vyřazená)" : ""}`);
    const ids = [...new Set([doc.generated_by, doc.finalized_by, ...dls.map((d) => d.handed_over_by), ...evs.map((e) => e.created_by),
      ...signatureUsers.split(",")].filter(Boolean))];
    if (ids.length) {
      const { data } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      setNames(Object.fromEntries((data || []).map((p) => [p.id, p.full_name])));
    }
    setLoading(false);
  }, [doc.id, doc.template_id, textVersionId, doc.generated_by, doc.finalized_by, signatureUsers, qualifiedIds]);
  useEffect(() => { load(); }, [load]);
  // schvalene texty prejavu vole (migracia 66) - bez nich len papierovy postup
  const [esignReady, setEsignReady] = useState(null);
  useEffect(() => {
    let cancelled = false;
    supabase.rpc("hr_esign_ready_keys").then(({ data }) => { if (!cancelled) setEsignReady(data || []); });
    return () => { cancelled = true; };
  }, []);

  async function completeSigning() {
    setCompletion({ busy: true, error: "" });
    try {
      const c = await invokeSigning({ action: "complete", document_id: doc.id });
      if (c.complete) await invokeSigning({ action: "deliver_after_signing", document_id: doc.id }).catch(() => null);
      setCompletion({ busy: false, error: "" });
      onChanged?.();
    } catch (e) {
      setCompletion({ busy: false, error: e.message });
    }
  }

  const who = (id) => (id ? names[id] || "—" : "—");
  const legalAct = doc.legal_act_type || defaultLegalActType(doc.doc_type);
  const required = documentRequiredSigners(doc);
  const closed = CLOSED.includes(doc.status);
  const fullySigned = SIGNED.includes(doc.status);
  const previous = documents.find((d) => d.id === doc.supersedes_document_id);
  const overall = documentDeliveryState(deliveries);
  const s334 = isS334Document(doc);
  const amends = documents.find((d) => d.id === doc.amends_document_id);
  const amendments = documents.filter((d) => d.amends_document_id === doc.id);
  // Zamknuty prvym podpisom, ale nie uplne podpisany -> zneplatnit a nova verzia.
  const lockedPartial = !!doc.locked_at && !fullySigned && !closed;
  const canAmend = fullySigned && legalAct === "BILATERAL_CONTRACT" && doc.doc_type !== "dodatek";
  const isTraining = legalAct === "TRAINING_RECORD";

  async function printDownload() {
    const { error: err } = await supabase.from("hr_document_events").insert({ hr_document_id: doc.id, event_type: "PRINT_DOWNLOADED" });
    if (err) { setError(err.message); return; }
    await openFile(doc.final_pdf_path, hrFileName(`${docLabel} – k tisku`, employee, doc.finalized_at, "pdf"));
    load();
  }

  const printReason = !doc.final_pdf_path ? "Nejdřív nahrajte finální PDF." : fullySigned ? "Dokument je podepsán – použijte podepsaný originál." : closed ? "Dokument je zneplatněn / nahrazen." : "";
  const handoverReason = !can.send ? "Chybí oprávnění k předávání dokumentů." : closed ? "Dokument je zneplatněn / nahrazen."
    : !fullySigned ? "Předat lze až dokument podepsaný všemi stranami." : overall.key === "DELIVERED" ? "Dokument už byl předán." : "";
  const missing = serverMissing || missingSigners(doc, signatures);
  // vsetky podpisy su ulozene, ale podpisany original / stav este nevznikol
  // (napr. strata spojenia alebo limit servera) - dokoncit opakovatelne
  const needsCompletion = serverMissing !== null && !serverMissing.length && !fullySigned && !closed && !!doc.locked_at;
  // podpisane vyhlasenie zamestnanca (§ 21 / § 335) - len HR_ADMIN (migracia 61)
  const signedDeclaration = SIGNED_DECLARATION_TYPES.includes(doc.doc_type) && ["SIGNED", "ARCHIVED"].includes(doc.status);
  const voidReason = signedDeclaration
    ? (can.admin ? "" : "Podepsané prohlášení zaměstnance smí zneplatnit jen administrátor HR (HR_ADMIN). Změna adresy se řeší novým oznámením, souhlas podle § 335 odvoláním.")
    : (can.void ? "" : "Zneplatnit smí jen uživatel s oprávněním HR_DOCUMENT_VOID.");
  const serverPdf = !!doc.final_pdf_path && !!doc.final_pdf_text_check?.ok && !!doc.final_pdf_text_check?.server_verified;
  const signState = closed ? "Dokument je zneplatněn / nahrazen."
    : fullySigned ? "Dokument je už podepsán všemi stranami." : !serverPdf ? "Nejdřív nahrajte finální PDF (ověřené serverem)." : "";
  const signBase = !can.sign ? "Chybí oprávnění k podpisu dokumentů." : signState;
  const tabletReason = (!required.includes("EMPLOYEE") ? "Podpis zaměstnance se u tohoto dokumentu nevyžaduje." : "") || signBase || (!missing.includes("EMPLOYEE") ? "Zaměstnanec už podepsal."
    : isTraining && !doc.training_record_id ? "Nejdřív doplňte evidenci školení a ověření znalostí."
    : esignReady && !esignReady.includes(`INTENT_${legalAct}`) ? ESIGN_PENDING : "");
  const employerReason = (!required.includes("EMPLOYER") ? "Podpis zaměstnavatele se u tohoto dokumentu nevyžaduje." : "")
    || (!can.signEmployer ? "Chybí oprávnění podepisovat za zaměstnavatele (HR_SIGN_FOR_EMPLOYER)." : signState) || (!missing.includes("EMPLOYER") ? "Zaměstnavatel už podepsal."
    : s334 ? "Písemnost § 334 podepisuje zaměstnavatel uznávaným el. podpisem – nahrajte podepsané PDF."
    : esignReady && !esignReady.includes("INTENT_EMPLOYER_SIGNATURE") ? ESIGN_PENDING : "");
  const qualifiedReason = signBase || (!missing.length ? "Nikdo další už podepsat nemusí." : "");
  const emailChannels = [
    legalAct === "BILATERAL_CONTRACT" && "EMAIL_S21",
    s334 && "EMAIL_S335_CONSENT",
    s334 && doc.doc_type === "mzdovy_vymer" && "EMAIL_S335_WAGE_OTHER_ADDRESS",
  ].filter(Boolean);
  const emailReason = !can.send ? "Chybí oprávnění k předávání dokumentů." : closed ? "Dokument je zneplatněn / nahrazen."
    : !fullySigned ? "Dokument není podepsán všemi stranami." : overall.key === "DELIVERED" ? "Dokument už byl doručen."
    : !emailChannels.length ? "Tento dokument se e-mailem nedoručuje – předejte osobně." : "";

  // Faza I: potvrzeni o prevzeti k podpisu (papir / tablet) - server ho
  // vytvori z aktualni verze textu a otisku podepsaneho originalu.
  async function createReceipt() {
    setDlBusy(true);
    setError("");
    try {
      await invokeDeclarations({ action: "create", employee_id: doc.employee_id, kind: "RECEIPT", target_document_id: doc.id });
      onChanged?.();
    } catch (e) { setError(e.message); }
    setDlBusy(false);
  }
  const receiptReason = !can.generate ? "Chybí oprávnění generovat dokumenty." : !fullySigned || !(doc.signed_pdf_sha256 || doc.final_pdf_sha256) ? "Jen k podepsanému dokumentu."
    : !doc.employee_id ? "Dokument není přiřazen zaměstnanci." : "";

  async function retryDelivery(dl) {
    setDlBusy(true);
    setError("");
    try { await invokeFunction("hr-delivery", { action: "retry", delivery_id: dl.id }); } catch (e) { setError(e.message); }
    setDlBusy(false);
    load();
  }

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
            {doc.amends_document_id && (
              <Row label="Dodatek ke smlouvě">{amends ? `${docTitle(amends)} v${amends.version_no || 1} (${STATUS_TEXT[amends.status] || amends.status})` : doc.amends_document_id}</Row>
            )}
            {amendments.length > 0 && (
              <Row label="Dodatky">{amendments.map((a) => `v${a.version_no || 1} – ${STATUS_TEXT[a.status] || a.status} (${czDate(a.created_at)})`).join("; ")}</Row>
            )}
            <Row label="Šablona">{templateName || (doc.origin === "UPLOADED" ? "nahráno ručně" : doc.doc_type === "dodatek" ? <span className="text-amber-700">šablona dodatku zatím chybí (otevřená úloha) – dodatek připravte mimo systém a nahrajte podepsaný sken</span> : "—")}</Row>
            <Row label="Vytvořil(a)">{who(doc.generated_by)} · {fmtTs(doc.generated_at || doc.created_at)}</Row>
            <Row label="Finální PDF">
              {doc.final_pdf_sha256
                ? <>otisk <code className="font-mono text-xs">{short(doc.final_pdf_sha256)}</code> · {fmtTs(doc.finalized_at)}{doc.finalized_by ? ` · ${who(doc.finalized_by)}` : ""}</>
                : <span className="text-slate-500">zatím nenahráno</span>}
            </Row>
            {doc.void_reason && <Row label={doc.status === "VOIDED" ? "Zneplatněno" : "Důvod náhrady"}>{doc.void_reason}{doc.voided_at ? ` · ${fmtTs(doc.voided_at)}` : ""}</Row>}
          </Section>

          <Section title="Podpis">
            {needsCompletion && (
              <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-md px-3 py-2 mb-2 text-sm" data-testid="needs-completion">
                Všechny podpisy jsou uloženy, ale dokument ještě není dokončen (podepsaný originál, stav „Podepsáno“, e-mail).
                <div className="mt-1 flex items-center gap-2">
                  <button type="button" onClick={completeSigning} disabled={completion.busy} className="text-teal-700 hover:text-teal-900 font-medium disabled:opacity-50">
                    {completion.busy ? "Dokončuji…" : "Dokončit podpis"}
                  </button>
                  {completion.error && <span className="text-red-700">{completion.error}</span>}
                </div>
              </div>
            )}
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
                    <div key={s.id} className={"ml-5 text-xs " + (signatureCounts(doc, s) && !closed ? "text-slate-600" : "text-red-700")}>
                      {s.signed_by_name || "—"} · {fmtTs(s.signed_at || s.created_at)} · {signatureMethodLabel(s)}
                      {" · "}
                      {s.method === "PAPER"
                        ? <>sken <code className="font-mono">{short(s.document_hash)}</code>{s.signed_content_sha256 ? <> k verzi <code className="font-mono">{short(s.signed_content_sha256)}</code></> : " (bez finálního PDF)"}{s.scan_matches_original_confirmed_by ? `, shodu ověřil(a) ${who(s.scan_matches_original_confirmed_by)}` : ""}</>
                        : signatureCounts(doc, s) ? <>k aktuální verzi <code className="font-mono">{short(s.signed_content_sha256)}</code></> : "podpis jiné verze – nepočítá se"}
                      {closed && <b> · neplatí – verze {doc.status === "VOIDED" ? "zneplatněna" : "nahrazena"} (podpis zůstává jen jako záznam)</b>}
                      {s.method === "ELECTRONIC_QUALIFIED" && (
                        <CertificateStatus verification={verifications.find((v) => v.signature_id === s.id)} canVerify={can.sign && !closed}
                          onVerify={() => setVerifyId(s.id)} openFile={openFile} />
                      )}
                      {verifyId === s.id && (
                        <VerifyCertificateForm signature={s} onCancel={() => setVerifyId(null)} onSaved={() => { setVerifyId(null); load(); }} />
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
            {signatures.filter((s) => !required.includes(s.signer_type)).map((s) => (
              <div key={s.id} className="text-xs text-slate-500">Navíc: {SIGNER_LABELS[s.signer_type] || s.signer_type} – {s.signed_by_name} · {fmtTs(s.signed_at || s.created_at)}</div>
            ))}
            {previous && previousSignatures.length > 0 && (
              <div className="text-xs bg-amber-50 text-amber-800 rounded-md px-2 py-1.5 mt-1">
                Předchozí verze v{previous.version_no || 1} byla {previous.status === "VOIDED" ? "zneplatněna" : "nahrazena"} – její podpisy se k této verzi nepočítají
                ({previousSignatures.map((s) => `${SIGNER_LABELS[s.signer_type] || s.signer_type} ${s.signed_by_name || ""}, ${fmtTs(s.signed_at || s.created_at)}`).join("; ")}).
                Tuto verzi musí znovu podepsat všechny strany.
              </div>
            )}
            <div className="text-xs text-slate-500 pt-1">
              {fullySigned ? "Podepsáno všemi stranami." : closed ? "Dokument je zneplatněn / nahrazen – další podpisy se nesbírají." : doc.locked_at ? `Zamčeno ${fmtTs(doc.locked_at)} – obsah už nelze měnit, čeká se na zbývající podpisy.` : "Zatím bez podpisu."}
            </div>
          </Section>

          {isTraining && (
            <Section title="Evidence školení a ověření znalostí">
              <TrainingEvidence doc={doc} employee={employee} canEdit={(can.edit || can.generate) && !doc.locked_at && !closed} onChanged={onChanged} />
            </Section>
          )}

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
                  {dl.channel.startsWith("EMAIL") && can.send && !closed && (
                    <div className="flex flex-wrap gap-x-3 text-xs">
                      {dl.send_status === "FAILED" && (dl.attempts || 0) < MAX_SEND_ATTEMPTS && !dl.ineffective_at && (
                        <button type="button" disabled={dlBusy} onClick={() => retryDelivery(dl)} className="text-teal-700 hover:text-teal-900 disabled:opacity-50">Opakovat odeslání</button>
                      )}
                      {dl.send_status === "SENT" && !dl.delivered_at && !dl.ineffective_at && (
                        <button type="button" onClick={() => setDlForm({ id: dl.id, kind: "confirm", sentAt: dl.sent_at })} className="text-teal-700 hover:text-teal-900">Zaznamenat písemné potvrzení převzetí</button>
                      )}
                      {dl.channel === "EMAIL_S21" && dl.delivered_at && !dl.withdrawal_received_at && (
                        <button type="button" onClick={() => setDlForm({ id: dl.id, kind: "withdrawal" })} className="text-red-700 hover:text-red-900">Zaznamenat odstoupení od smlouvy</button>
                      )}
                    </div>
                  )}
                  {dlForm?.id === dl.id && (
                    <DeliveryRecordForm form={dlForm} onCancel={() => setDlForm(null)} onSaved={() => { setDlForm(null); load(); onChanged?.(); }} />
                  )}
                  {dl.withdrawal_scan_path && (
                    <button type="button" onClick={() => openFile(dl.withdrawal_scan_path)} className="text-xs text-red-700 hover:text-red-900 flex items-center gap-1">
                      <Stamp size={12} /> Písemné odstoupení (sken) · otisk <code className="font-mono">{short(dl.withdrawal_scan_sha256)}</code>
                    </button>
                  )}
                  {dl.receipt_scan_path && (
                    <button type="button" onClick={() => openFile(dl.receipt_scan_path)} className="text-xs text-emerald-700 hover:text-emerald-900 flex items-center gap-1">
                      <Stamp size={12} /> Potvrzení o převzetí ({dl.confirmation_evidence?.confirmation?.kind === "EMAIL_REPLY" ? "odpověď e-mailem .eml" : "sken"}) · otisk <code className="font-mono">{short(dl.receipt_scan_sha256)}</code>
                    </button>
                  )}
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
              <ActionButton icon={Tablet} onClick={() => setForm("tablet")} disabled={!!tabletReason} reason={tabletReason}>Podepsat na tabletu</ActionButton>
              <ActionButton icon={FileSignature} onClick={() => setForm("employer")} disabled={!!employerReason} reason={employerReason}>Podepsat za zaměstnavatele</ActionButton>
              <ActionButton icon={Stamp} onClick={() => setForm("qualified")} disabled={!!qualifiedReason} reason={qualifiedReason}>Nahrát PDF s uznávaným podpisem</ActionButton>
              <ActionButton icon={Handshake} onClick={() => setForm("handover")} disabled={!!handoverReason} reason={handoverReason}>Zaznamenat předání</ActionButton>
              {doc.doc_type !== "potvrzeni_prevzeti" && (
                <ActionButton icon={Stamp} onClick={createReceipt} disabled={!!receiptReason || dlBusy} reason={receiptReason}>Vytvořit potvrzení o převzetí</ActionButton>
              )}
              <ActionButton icon={Mail} onClick={() => setForm("email")} disabled={!!emailReason} reason={emailReason}>Odeslat e-mailem</ActionButton>
              {!closed && (
                <ActionButton icon={Ban} tone="red" onClick={() => setForm("void")} disabled={!!voidReason} reason={voidReason}>Zneplatnit</ActionButton>
              )}
              {can.generate && !closed && !fullySigned && (
                <ActionButton icon={FilePlus2} onClick={() => setForm("version")} disabled={lockedPartial && !can.void}
                  reason={lockedPartial && !can.void ? "Zamčený dokument zneplatní jen uživatel s oprávněním HR_DOCUMENT_VOID." : ""}>
                  {lockedPartial ? "Zneplatnit a vytvořit novou verzi" : "Vytvořit novou verzi"}
                </ActionButton>
              )}
              {can.generate && canAmend && (
                <ActionButton icon={FileSignature} onClick={() => setForm("amendment")}>Vytvořit dodatek</ActionButton>
              )}
            </div>
            {form === "tablet" && (
              <TabletIssueForm doc={doc} onCancel={() => setForm(null)} onDone={() => { setForm(null); load(); onChanged?.(); }} />
            )}
            {form === "employer" && (
              <FullScreen>
                <TabletSigning mode="employer" documentId={doc.id} onCancel={() => { setForm(null); load(); onChanged?.(); }} onDone={() => { setForm(null); load(); onChanged?.(); }} />
              </FullScreen>
            )}
            {form === "qualified" && (
              <QualifiedUploadForm doc={doc} missing={missing} onCancel={() => setForm(null)} onSaved={() => { setForm(null); load(); onChanged?.(); }} />
            )}
            {form === "email" && (
              <EmailForm doc={doc} channels={emailChannels} onCancel={() => setForm(null)} onSaved={() => { setForm(null); load(); onChanged?.(); }} />
            )}
            {form === "handover" && (
              <HandoverForm doc={doc} s334={s334} onCancel={() => setForm(null)} onSaved={() => { setForm(null); load(); onChanged?.(); }} />
            )}
            {form === "void" && (
              <ReasonForm title={signedDeclaration ? "Zneplatnit podepsané prohlášení zaměstnance" : "Zneplatnit dokument"} confirm="Zneplatnit" danger
                minLength={signedDeclaration ? 10 : 1}
                warning={signedDeclaration ? (doc.doc_type === "s21_oznameni_adresy"
                  ? "Pozor: jde o prohlášení zaměstnance. Změna e-mailové adresy se neřeší zneplatněním, ale novým oznámením (§ 21), které zaměstnanec podepíše. Zneplatněte jen chybně pořízený záznam."
                  : "Pozor: jde o prohlášení zaměstnance. Souhlas s elektronickým doručováním (§ 335) se neruší zneplatněním, ale odvoláním, které podepíše zaměstnanec. Zneplatněte jen chybně pořízený záznam.") : ""}
                placeholder={signedDeclaration ? "Důvod (povinný, alespoň 10 znaků)" : "Důvod"}
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
              <ReasonForm title={lockedPartial ? "Zneplatnit a vytvořit novou verzi" : "Vytvořit novou verzi"} confirm={lockedPartial ? "Zneplatnit a vytvořit verzi" : "Vytvořit verzi"}
                danger={lockedPartial}
                hint={lockedPartial
                  ? "Tato verze už má podpis, proto se zneplatní (s důvodem). Její podpisy zůstanou jako záznam, ale k nové verzi se nepočítají – novou verzi musí znovu podepsat všechny strany. Vznikne koncept (verze + 1) se stejným vygenerovaným souborem; upravte ho ve Wordu a nahrajte nové finální PDF."
                  : "Vznikne kopie jako koncept (verze + 1) se stejným vygenerovaným souborem; upravte ji ve Wordu a nahrajte nové finální PDF. Tato verze bude označena jako nahrazená."}
                onCancel={() => setForm(null)}
                onSubmit={async (reason) => {
                  const { error: err } = await supabase.rpc("hr_document_new_version", { p_document_id: doc.id, p_reason: reason });
                  if (err) return err.message;
                  setForm(null); onChanged?.();
                  return null;
                }} />
            )}
            {form === "amendment" && (
              <ReasonForm title="Vytvořit dodatek" confirm="Vytvořit dodatek" optional
                hint="Vznikne nový dokument „Dodatek“ navázaný na tuto smlouvu (podepisují obě strany). Podepsaná smlouva se nemění ani nezneplatňuje. Šablona dodatku zatím chybí – dodatek připravte mimo systém a nahrajte podepsaný sken."
                placeholder="Předmět dodatku (nepovinné), např. změna mzdy od 1. 1."
                onCancel={() => setForm(null)}
                onSubmit={async (note) => {
                  const { error: err } = await supabase.rpc("hr_document_create_amendment", { p_document_id: doc.id, p_note: note || null });
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

const STATUS_TEXT = { DRAFT: "koncept", READY_FOR_REVIEW: "ke kontrole", APPROVED: "schváleno", READY_FOR_SIGNATURE: "k podpisu", SIGNED: "podepsáno", ARCHIVED: "archivováno", VOIDED: "zneplatněno", SUPERSEDED: "nahrazeno" };
const docTitle = (d) => ({ pracovni_smlouva: "Pracovní smlouva", pracovni_smlouva_cizinec: "Pracovní smlouva – cizinec" }[d.doc_type] || d.doc_type);

const CHECK_METHOD = { TEST: "test", ORAL: "ústně", PRACTICAL: "prakticky" };
const CHECK_RESULT = { PASSED: "prospěl(a)", FAILED: "neprospěl(a)" };

// Evidencia skolenia a overenia znalosti (migracia 53). Zaznam o skoleni sa
// da podpisat a je "hotovo" len s naviazanou evidenciou s vysledkom PASSED.
function TrainingEvidence({ doc, employee, canEdit, onChanged }) {
  const [records, setRecords] = useState(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const { data, error: err } = await supabase.from("hr_training_records").select("*").eq("employee_id", employee.id).order("created_at", { ascending: false });
    if (err) setError(err.message);
    setRecords(data || []);
  }, [employee.id]);
  useEffect(() => { load(); }, [load]);
  if (!records) return <div className="text-slate-400 text-xs">Načítám…</div>;
  const linked = records.find((r) => r.id === doc.training_record_id);

  async function link(id) {
    const { error: err } = await supabase.from("hr_documents").update({ training_record_id: id, updated_at: new Date().toISOString() }).eq("id", doc.id);
    if (err) { setError(err.message); return; }
    onChanged?.();
  }

  return (
    <div>
      {linked ? (
        <div className={linked.knowledge_check_result === "PASSED" ? "" : "text-red-700"}>
          <div className="flex items-center gap-1.5"><GraduationCap size={14} /> Školení {czDate(linked.trained_at)} · školitel {linked.trainer_name}</div>
          <div className="text-xs text-slate-600 ml-5">Rozsah: {linked.scope}</div>
          <div className="text-xs ml-5">
            Ověření znalostí: {CHECK_METHOD[linked.knowledge_check_method]} · {CHECK_RESULT[linked.knowledge_check_result]} · {czDate(linked.knowledge_checked_at)} · ověřil(a) {linked.knowledge_checked_by_name}
          </div>
          {linked.knowledge_check_result !== "PASSED" && <div className="text-xs ml-5">Bez úspěšného ověření znalostí nelze záznam podepsat.</div>}
        </div>
      ) : (
        <div className="text-amber-800 text-sm">Chybí evidence školení a ověření znalostí – záznam o školení nelze podepsat.</div>
      )}
      {canEdit && records.filter((r) => r.id !== doc.training_record_id).length > 0 && (
        <div className="text-xs mt-1">
          Navázat existující:{" "}
          {records.filter((r) => r.id !== doc.training_record_id).map((r) => (
            <button key={r.id} type="button" onClick={() => link(r.id)} className="text-teal-700 hover:text-teal-900 underline mr-2">
              {czDate(r.trained_at)} ({CHECK_RESULT[r.knowledge_check_result]})
            </button>
          ))}
        </div>
      )}
      {canEdit && !adding && (
        <button type="button" onClick={() => setAdding(true)} className="text-sm text-teal-700 hover:text-teal-900 mt-1">+ Zapsat evidenci školení</button>
      )}
      {adding && <TrainingForm employee={employee} onCancel={() => setAdding(false)} onSaved={async (id) => { setAdding(false); await load(); await link(id); }} />}
      {error && <div className="text-xs text-red-700 mt-1">{error}</div>}
    </div>
  );
}

function TrainingForm({ employee, onCancel, onSaved }) {
  const [f, setF] = useState({ trained_at: todayIso(), trainer_name: "", scope: "Vstupní školení BOZP a PO", knowledge_check_method: "TEST", knowledge_check_result: "PASSED", knowledge_checked_at: todayIso(), knowledge_checked_by_name: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit() {
    if (!f.trainer_name.trim() || !f.scope.trim() || !f.knowledge_checked_by_name.trim()) { setError("Vyplňte školitele, rozsah a kdo ověřil znalosti."); return; }
    if (f.knowledge_checked_at < f.trained_at) { setError("Ověření znalostí nemůže být před školením."); return; }
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const id = uid();
    const { error: err } = await supabase.from("hr_training_records").insert({ id, employee_id: employee.id, created_by: u?.user?.id, ...f, note: f.note.trim() || null });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onSaved(id);
  }
  const inp = "border border-slate-300 rounded-md px-2 py-1.5 text-sm w-full";
  return (
    <div className="mt-2 border border-slate-200 rounded-md p-3 bg-slate-50 grid grid-cols-1 sm:grid-cols-2 gap-2">
      <label className="text-xs text-slate-600">Datum školení<input type="date" value={f.trained_at} max={todayIso()} onChange={set("trained_at")} className={inp} /></label>
      <label className="text-xs text-slate-600">Školitel<input value={f.trainer_name} onChange={set("trainer_name")} className={inp} /></label>
      <label className="text-xs text-slate-600 sm:col-span-2">Rozsah / obsah<input value={f.scope} onChange={set("scope")} className={inp} /></label>
      <label className="text-xs text-slate-600">Ověření znalostí – způsob
        <select value={f.knowledge_check_method} onChange={set("knowledge_check_method")} className={inp}>
          {Object.entries(CHECK_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="text-xs text-slate-600">Výsledek
        <select value={f.knowledge_check_result} onChange={set("knowledge_check_result")} className={inp}>
          {Object.entries(CHECK_RESULT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="text-xs text-slate-600">Datum ověření<input type="date" value={f.knowledge_checked_at} max={todayIso()} onChange={set("knowledge_checked_at")} className={inp} /></label>
      <label className="text-xs text-slate-600">Ověřil(a)<input value={f.knowledge_checked_by_name} onChange={set("knowledge_checked_by_name")} className={inp} /></label>
      <div className="text-[11px] text-slate-500 sm:col-span-2">Evidence se po uložení nemění – oprava = nový záznam (navázat lze jen před podpisem).</div>
      {error && <div className="text-xs text-red-700 sm:col-span-2">{error}</div>}
      <div className="flex gap-2 sm:col-span-2">
        <button type="button" onClick={submit} disabled={busy} className="bg-teal-700 hover:bg-teal-800 text-white text-sm px-3 py-1.5 rounded-md disabled:opacity-50">{busy ? "Ukládám…" : "Uložit a navázat"}</button>
        <button type="button" onClick={onCancel} className="text-sm px-3 py-1.5 text-slate-600">Zrušit</button>
      </div>
    </div>
  );
}

async function invokeFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (data) return data;
  const detail = error?.context ? await error.context.json().catch(() => null) : null;
  throw new Error(detail?.error || "Spojení se serverem se nezdařilo. Zkuste to znovu.");
}

export async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Uznavany podpis: kym sa neoveri certifikat = "podpis přítomen, certifikát neověřen".
function CertificateStatus({ verification: v, canVerify, onVerify, openFile }) {
  const status = v?.result || "NOT_VERIFIED";
  const tone = status === "VALID" ? "text-emerald-700" : status === "NOT_VERIFIED" ? "text-amber-700" : "text-red-700";
  return (
    <div className={"mt-0.5 " + tone}>
      {CERTIFICATE_STATUS_LABELS[status]}
      {v && <> · {v.service_name}, ověřil(a) {v.verified_by_name || "—"} {fmtTs(v.verified_at)} · protokol{" "}
        <button type="button" onClick={() => openFile(v.protocol_path, v.protocol_path.split("/").pop())} className="underline">
          <code className="font-mono">{short(v.protocol_sha256)}</code></button></>}
      {canVerify && status !== "VALID" && (
        <button type="button" onClick={onVerify} className="ml-2 underline text-teal-700">Zaznamenat ověření certifikátu</button>
      )}
    </div>
  );
}

// Rucne overenie cez verejnu overovaciu sluzbu: vysledok + protokol (PDF /
// snimka), otisk protokolu pocita server, zapise sa kto overil.
function VerifyCertificateForm({ signature, onCancel, onSaved }) {
  const [result, setResult] = useState("VALID");
  const [serviceName, setServiceName] = useState("");
  const [file, setFile] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true); setError("");
    try {
      await invokeSigning({ action: "qualified_verify", signature_id: signature.id, result, service_name: serviceName.trim(), note: note.trim() || null, protocol_base64: await fileToBase64(file) });
      onSaved();
    } catch (e) { setError(e.message); }
    setBusy(false);
  }
  return (
    <div className="mt-2 bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm text-slate-700 space-y-2 max-w-xl">
      <div className="font-medium">Ověření certifikátu podpisu ({signature.signed_by_name})</div>
      <div className="text-xs text-slate-500">Ověřte podepsané PDF ve veřejné ověřovací službě a nahrajte protokol o ověření (PDF nebo snímek). Zaznamená se, kdo a kdy ověřil.</div>
      <select value={result} onChange={(e) => setResult(e.target.value)} className="block w-full border border-slate-300 rounded-md px-2 py-1.5 bg-white">
        <option value="VALID">platný (kvalifikovaný / uznávaný podpis)</option>
        <option value="INVALID">neplatný</option>
        <option value="INDETERMINATE">neprůkazné</option>
      </select>
      <input value={serviceName} onChange={(e) => setServiceName(e.target.value)} placeholder="Ověřovací služba (např. EU DSS validace)" className="block w-full border border-slate-300 rounded-md px-2 py-1.5" />
      <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Poznámka (nepovinné)" className="block w-full border border-slate-300 rounded-md px-2 py-1.5" />
      {error && <div className="bg-red-50 text-red-700 px-3 py-2 rounded-md">{error}</div>}
      <div className="flex gap-2">
        <button onClick={submit} disabled={!file || !serviceName.trim() || busy} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white px-3 py-1.5 rounded-md">Uložit ověření</button>
        <button onClick={onCancel} className="text-slate-500 px-3 py-1.5">Zrušit</button>
      </div>
    </div>
  );
}

function FullScreen({ children }) {
  return <div className="fixed inset-0 z-50 overflow-auto bg-slate-50">{children}</div>;
}

// Faza F: HR overi totoznost podla dokladu a vyda jednorazovy podpisovy
// odkaz - podpis hned na tomto zariadeni alebo odkazom na inom tablete.
function TabletIssueForm({ doc, onCancel, onDone }) {
  const [idDoc, setIdDoc] = useState("OP");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState(null);
  const [qr, setQr] = useState("");
  const [signingHere, setSigningHere] = useState(false);
  const [tokenState, setTokenState] = useState(null);

  // Stav vydaneho odkazu (3 zle kody, vyprsanie, podpis) - obrazovka HR nesmie
  // ukazovat zruseny kod ako platny.
  useEffect(() => {
    if (!issued || signingHere) return undefined;
    let stop = false;
    const poll = async () => {
      try {
        const r = await invokeSigning({ action: "token_status", token: issued.token });
        if (!stop) setTokenState(r);
      } catch { /* docasny vypadok - skusi znova */ }
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => { stop = true; clearInterval(t); };
  }, [issued, signingHere]);
  const closed = tokenState && ["REVOKED_CODE", "REVOKED", "EXPIRED", "USED"].includes(tokenState.status);

  function reissue() {
    setIssued(null); setQr(""); setTokenState(null); setConfirmed(false); setError("");
  }

  async function issue() {
    setBusy(true); setError("");
    try {
      const r = await invokeSigning({ action: "issue", document_id: doc.id, identity: { document_type: idDoc, confirmed: true } });
      // Odkaz existuje LEN v QR kode na tejto obrazovke - nezobrazuje sa ako
      // text a neda sa skopirovat ani poslat. Bez kodu z obrazovky HR a
      // aktivnej relacie HR ho tablet neotvori.
      const url = `${window.location.origin}${window.location.pathname}?podpis=${encodeURIComponent(r.token)}`;
      setQr(await QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 240 }));
      setIssued(r);
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  if (signingHere) {
    return (
      <FullScreen>
        <TabletSigning mode="employee" token={issued.token} onCancel={() => { setSigningHere(false); onDone?.(); }} onDone={onDone} />
      </FullScreen>
    );
  }
  return (
    <div className="mt-3 bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm space-y-2 max-w-xl">
      <div className="font-medium text-slate-700">Podpis zaměstnance na tabletu – jen při osobní přítomnosti</div>
      {!issued ? (
        <>
          <div className="text-slate-500">Ověřte totožnost zaměstnance podle dokladu. Číslo dokladu se neukládá – zaznamená se jen druh dokladu, kdo totožnost ověřil a jeho přihlášení.</div>
          <label className="block">
            <span className="text-slate-600">Doklad totožnosti</span>
            <select value={idDoc} onChange={(e) => setIdDoc(e.target.value)} className="mt-1 block w-full border border-slate-300 rounded-md px-2 py-1.5 bg-white">
              {Object.entries(IDENTITY_DOCUMENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
            <span>Zaměstnanec je osobně přítomen a ověřil(a) jsem jeho totožnost podle tohoto dokladu.</span>
          </label>
          {error && <div className="bg-red-50 text-red-700 px-3 py-2 rounded-md">{error}</div>}
          <div className="flex gap-2">
            <button onClick={issue} disabled={!confirmed || busy} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white px-3 py-1.5 rounded-md flex items-center gap-1">
              {busy && <Loader2 size={14} className="animate-spin" />} Připravit podpis
            </button>
            <button onClick={onCancel} className="text-slate-500 px-3 py-1.5">Zrušit</button>
          </div>
        </>
      ) : closed ? (
        <>
          {tokenState.status === "USED" ? (
            <div className="bg-emerald-50 text-emerald-800 px-3 py-2 rounded-md flex items-center gap-2"><CheckCircle2 size={16} /> Zaměstnanec dokument podepsal.</div>
          ) : (
            <div className="bg-red-50 text-red-700 px-3 py-2 rounded-md flex items-start gap-2" data-testid="pairing-closed">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>
                {tokenState.status === "REVOKED_CODE" && "Kód byl zrušen – na tabletu byl třikrát zadán chybný kód. QR kód ani kód už neplatí."}
                {tokenState.status === "REVOKED" && "Podpis byl zrušen (byl připraven nový nebo se změnil dokument). QR kód ani kód už neplatí."}
                {tokenState.status === "EXPIRED" && "Platnost QR kódu a kódu vypršela."}
              </span>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {tokenState.status !== "USED" && (
              <button onClick={reissue} className="bg-teal-700 hover:bg-teal-800 text-white px-3 py-1.5 rounded-md">Připravit nový kód</button>
            )}
            <button onClick={onDone} className="text-slate-500 px-3 py-1.5">Zavřít</button>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-4">
            <img src={qr} alt="QR kód pro podpis na tabletu" width={240} height={240} className="bg-white border border-slate-200 rounded" />
            <div>
              <div className="text-slate-600">Naskenujte QR kód tabletem a na tabletu zadejte kód:</div>
              <div className="text-3xl font-mono font-semibold tracking-widest text-slate-800 my-2" data-testid="pairing-code">{issued.code}</div>
              {tokenState?.status === "ACTIVE" && tokenState.attempts_left < 3 && (
                <div className="text-sm text-amber-700">Na tabletu byl zadán chybný kód – zbývající pokusy: {tokenState.attempts_left}.</div>
              )}
              {tokenState?.status === "OPENED" && <div className="text-sm text-emerald-700">Dokument je otevřen na tabletu.</div>}
              <div className="text-xs text-slate-500">Pro <b>{issued.signer_name}</b>. Platí jednou, do {new Date(issued.expires_at).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}, jen dokud jste přihlášen(a). Třikrát chybný kód podpis zruší.</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setSigningHere(true)} className="bg-teal-700 hover:bg-teal-800 text-white px-3 py-1.5 rounded-md">Podepsat na tomto zařízení</button>
            <button onClick={onDone} className="text-slate-500 px-3 py-1.5">Zavřít</button>
          </div>
        </>
      )}
    </div>
  );
}

// Uznavany el. podpis (PAdES): PDF podpisane mimo systemu (napr. Adobe s
// kvalifikovanym certifikatom) - server overi vazbu na finalne PDF.
function QualifiedUploadForm({ doc, missing, onCancel, onSaved }) {
  const [signer, setSigner] = useState(missing.includes("EMPLOYER") ? "EMPLOYER" : "EMPLOYEE");
  const [name, setName] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true); setError("");
    try {
      await invokeSigning({ action: "qualified_upload", document_id: doc.id, signer_type: signer, signed_by_name: name.trim(), pdf_base64: await fileToBase64(file) });
      onSaved();
    } catch (e) { setError(e.message); }
    setBusy(false);
  }
  return (
    <div className="mt-3 bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm space-y-2 max-w-xl">
      <div className="font-medium text-slate-700">PDF s uznávaným elektronickým podpisem</div>
      <div className="text-slate-500">Nahrajte finální PDF této verze podepsané uznávaným (kvalifikovaným) podpisem, např. v Adobe Acrobat. Server ověří, že jde přesně o tuto verzi. Platnost certifikátu se zatím neověřuje.</div>
      {missing.length > 1 && (
        <select value={signer} onChange={(e) => setSigner(e.target.value)} className="block w-full border border-slate-300 rounded-md px-2 py-1.5 bg-white">
          {missing.map((m) => <option key={m} value={m}>{SIGNER_LABELS[m]}</option>)}
        </select>
      )}
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Kdo podepsal (jméno)" className="block w-full border border-slate-300 rounded-md px-2 py-1.5" />
      <input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      {error && <div className="bg-red-50 text-red-700 px-3 py-2 rounded-md">{error}</div>}
      <div className="flex gap-2">
        <button onClick={submit} disabled={!file || !name.trim() || busy} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white px-3 py-1.5 rounded-md flex items-center gap-1">
          {busy && <Loader2 size={14} className="animate-spin" />} Nahrát
        </button>
        <button onClick={onCancel} className="text-slate-500 px-3 py-1.5">Zrušit</button>
      </div>
    </div>
  );
}

function ReasonForm({ title, hint, warning, confirm, danger, optional, minLength = 1, placeholder = "Důvod", onCancel, onSubmit }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (!optional && !reason.trim()) { setError("Uveďte důvod."); return; }
    if (!optional && reason.trim().length < minLength) { setError(`Uveďte důvod (alespoň ${minLength} znaků).`); return; }
    setBusy(true);
    setError((await onSubmit(reason.trim())) || "");
    setBusy(false);
  }
  return (
    <div className="mt-3 border border-slate-200 rounded-md p-3 bg-slate-50">
      <div className="font-medium text-sm mb-1">{title}</div>
      {warning && <div className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-md px-2.5 py-2 mb-2" data-testid="void-warning">{warning}</div>}
      {hint && <div className="text-xs text-slate-500 mb-2">{hint}</div>}
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={placeholder}
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
  const [receipt, setReceipt] = useState(s334);
  const [scan, setScan] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (!date || date > todayIso()) { setError("Zadejte datum předání (nejpozději dnes)."); return; }
    if (s334 && !receipt) { setError("Písemnost § 334 lze předat jen proti podpisu potvrzení o převzetí."); return; }
    if (receipt && !scan) { setError("Nahrajte sken podepsaného potvrzení o převzetí."); return; }
    setBusy(true);
    setError("");
    try {
      // Sken nahra a zahashuje server (hr-delivery) - otisk z prehliadaca sa nepouziva.
      await invokeFunction("hr-delivery", {
        action: "in_person", document_id: doc.id, delivered_date: date, receipt, note: note.trim() || null,
        scan_base64: receipt ? await fileToBase64(scan) : null,
      });
      onSaved();
    } catch (e) { setError(e.message); }
    setBusy(false);
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
      {receipt && (
        <label className="block text-xs text-slate-600 mb-2">
          Sken podepsaného potvrzení o převzetí (povinný)
          <input type="file" accept="application/pdf,image/*" className="block text-sm mt-1"
            onChange={(e) => setScan(e.target.files?.[0] || null)} />
          <span className="block mt-1">Otisk skenu spočítá server při uložení; potom se sken nedá změnit.</span>
        </label>
      )}
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

// Faza G: odoslanie podpisaneho originalu e-mailom. Adresu pri § 21 / § 335
// suhlase urcuje platne vyhlasenie pre aktualny e-mail (overuje aj server);
// pri mzdovom vymere na inu adresu ju zada HR. Odoslane != dorucene.
const EMAIL_HINTS = {
  EMAIL_S21: "Vyhotovení smlouvy uzavřené elektronicky na adresu oznámenou podle § 21. Lhůta 7 dnů k odstoupení běží až od dodání do schránky.",
  EMAIL_S335_CONSENT: "Jen se platným, neodvolaným souhlasem a uznávaným podpisem s ověřeným certifikátem. Doručeno potvrzením zaměstnance, jinak fikce 15. den od dodání.",
  EMAIL_S335_WAGE_OTHER_ADDRESS: "Mzdový výměr na jinou adresu: doručen jen písemným potvrzením převzetí. Bez potvrzení do 15 dnů od odeslání je doručení neúčinné.",
};
const DECLARATION_KIND = { EMAIL_S21: "S21_ADDRESS_NOTICE", EMAIL_S335_CONSENT: "S335_CONSENT" };

function EmailForm({ doc, channels, onCancel, onSaved }) {
  const [channel, setChannel] = useState(channels[0]);
  const [recipient, setRecipient] = useState("");
  const [declared, setDeclared] = useState({}); // channel -> e-mail z platneho vyhlasenia | null
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const channelKey = channels.join(","); // rodic posiela pri kazdom vykresleni nove pole
  useEffect(() => {
    let alive = true;
    (async () => {
      const out = {};
      for (const ch of channels.filter((c) => DECLARATION_KIND[c])) {
        const { data: id } = await supabase.rpc("hr_valid_contact_declaration", { p_employee_id: doc.employee_id, p_kind: DECLARATION_KIND[ch] });
        const { data } = id ? await supabase.from("employee_contact_declarations").select("email_snapshot").eq("id", id).maybeSingle() : { data: null };
        out[ch] = data?.email_snapshot || null;
      }
      if (alive) setDeclared(out);
    })();
    return () => { alive = false; };
  }, [doc.employee_id, channelKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const needsDeclaration = !!DECLARATION_KIND[channel];
  const address = needsDeclaration ? declared[channel] : recipient.trim();
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const r = await invokeFunction("hr-delivery", { action: "send_email", document_id: doc.id, channel, recipient: needsDeclaration ? null : recipient.trim() });
      setResult(r.delivery);
    } catch (e) { setError(e.message); }
    setBusy(false);
  }
  if (result) {
    const st = deliveryState(result);
    return (
      <div className="mt-3 border border-slate-200 rounded-md p-3 bg-slate-50 text-sm">
        <div className={result.send_status === "SENT" ? "text-emerald-700" : "text-red-700"}>{st.label}{result.send_error ? ` – ${result.send_error}` : ""}</div>
        <div className="text-xs text-slate-500 mt-1">Odesláno neznamená doručeno – stav a lhůty sledujte v části „Předání / doručení“.</div>
        <button type="button" onClick={onSaved} className="mt-2 bg-teal-700 hover:bg-teal-800 text-white text-sm px-3 py-1.5 rounded-md">Zavřít</button>
      </div>
    );
  }
  return (
    <div className="mt-3 border border-slate-200 rounded-md p-3 bg-slate-50">
      <div className="font-medium text-sm mb-1">Odeslat podepsaný originál e-mailem</div>
      <div className="text-xs text-amber-700 mb-2">Testovací režim: zprávy jdou jen do lokální testovací schránky, skutečné e-maily se neodesílají.</div>
      <div className="space-y-1 mb-2">
        {channels.map((ch) => (
          <label key={ch} className="flex items-start gap-2 text-sm">
            <input type="radio" name="email-channel" checked={channel === ch} onChange={() => setChannel(ch)} className="mt-1" />
            <span>{DELIVERY_CHANNEL_LABELS[ch]}<span className="block text-xs text-slate-500">{EMAIL_HINTS[ch]}</span></span>
          </label>
        ))}
      </div>
      {needsDeclaration ? (
        declared[channel] === undefined ? <div className="text-xs text-slate-500 mb-2">Ověřuji vyhlášení…</div>
          : declared[channel] ? <div className="text-sm mb-2">Adresa z platného vyhlášení: <b>{declared[channel]}</b></div>
          : <div className="text-xs text-red-700 mb-2">Pro aktuální e-mail zaměstnance chybí platné {channel === "EMAIL_S21" ? "oznámení adresy (§ 21)" : "a neodvolaný souhlas (§ 335)"} – po změně e-mailu je třeba nové vyhlášení. Zatím předejte osobně.</div>
      ) : (
        <input type="email" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="E-mailová adresa zaměstnance"
          className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm mb-2" />
      )}
      {error && <div className="text-xs text-red-700 mb-2">{error}</div>}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={busy || !address} className="bg-teal-700 hover:bg-teal-800 text-white text-sm px-3 py-1.5 rounded-md disabled:opacity-50">
          {busy ? "Odesílám…" : "Odeslat"}
        </button>
        <button type="button" onClick={onCancel} className="text-sm px-3 py-1.5 text-slate-600">Zrušit</button>
      </div>
    </div>
  );
}

// Pisomne potvrdenie prevzatia e-mailu / pisomne odstupenie od zmluvy (§ 21).
// Sken nahra a zahashuje server.
function DeliveryRecordForm({ form, onCancel, onSaved }) {
  const confirm = form.kind === "confirm";
  const [date, setDate] = useState(todayIso());
  const [scan, setScan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (!scan) { setError(confirm ? "Nahrajte písemné potvrzení převzetí (sken, PDF nebo uložený e-mail .eml)." : "Nahrajte sken písemného odstoupení."); return; }
    setBusy(true);
    setError("");
    try {
      const scan_base64 = await fileToBase64(scan);
      await invokeFunction("hr-delivery", confirm
        ? { action: "confirm_receipt", delivery_id: form.id, confirmed_date: date, scan_base64 }
        : { action: "record_withdrawal", delivery_id: form.id, received_date: date, scan_base64 });
      onSaved();
    } catch (e) { setError(e.message); }
    setBusy(false);
  }
  return (
    <div className="mt-2 border border-slate-200 rounded-md p-3 bg-white">
      <div className="font-medium text-sm mb-1">{confirm ? "Písemné potvrzení převzetí" : "Písemné odstoupení od smlouvy (§ 21)"}</div>
      <label className="block text-xs text-slate-600 mb-1">{confirm ? "Datum potvrzení" : "Datum, kdy odstoupení došlo"}</label>
      <input type="date" value={date} max={todayIso()} min={confirm && form.sentAt ? String(form.sentAt).slice(0, 10) : undefined} onChange={(e) => setDate(e.target.value)}
        className="border border-slate-300 rounded-md px-3 py-1.5 text-sm mb-2" />
      <label className="block text-xs text-slate-600 mb-2">
        {confirm ? "Potvrzení (sken, PDF nebo odpověď zaměstnance uložená jako .eml)" : "Sken písemného odstoupení"}
        <input type="file" accept={confirm ? "application/pdf,image/*,.eml,message/rfc822" : "application/pdf,image/*"} className="block text-sm mt-1" onChange={(e) => setScan(e.target.files?.[0] || null)} />
        <span className="block mt-1">Otisk spočítá server při uložení; potom se soubor nedá změnit.</span>
      </label>
      {error && <div className="text-xs text-red-700 mb-2">{error}</div>}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={busy} className={(confirm ? "bg-teal-700 hover:bg-teal-800" : "bg-red-700 hover:bg-red-800") + " text-white text-sm px-3 py-1.5 rounded-md disabled:opacity-50"}>
          {busy ? "Ukládám…" : "Uložit"}
        </button>
        <button type="button" onClick={onCancel} className="text-sm px-3 py-1.5 text-slate-600">Zrušit</button>
      </div>
    </div>
  );
}
