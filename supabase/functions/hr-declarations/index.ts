// Edge Function: vyhlasenia a poucenia pre existujuceho zamestnanca (faza I).
//
// HR (prihlaseny, HR_DOCUMENT_GENERATE):
// { action: "create", employee_id, kind: "S21" | "S335_NOTICE" | "S335" | "S335_REVOCATION" | "RECEIPT",
//   target_document_id? (RECEIPT) }
//   Server vygeneruje PDF z AKTUALNEJ verzie textu (hr_current_legal_text),
//   ulozi ho ako finalne PDF (overene serverom) a dokument je pripraveny na
//   podpis beznym postupom (tablet / papier). Po uplnom podpise vznikne
//   vyhlasenie alebo odvolanie v DB (trigger hr_documents_declaration_signed).
import { PDFDocument } from "pdf-lib";
import { json, handle, HttpError, authorize, loadVisibleDocument, BUCKET } from "../_shared/hrServer.ts";
import { sha256Hex, documentFolder } from "../_shared/pdfTextCheck.js";
import { DOC_TITLES } from "../_shared/signedOriginalServer.ts";
import { DECLARATION_DOCS, declarationInputErrors, buildEmployeeDeclarationPdf } from "../_shared/hr/declarationDocuments.js";
import { defaultLegalActType } from "../_shared/signingRules.js";

const asset = (f: string) => Deno.readFile(new URL(`../_shared/${f}`, import.meta.url));
const SERVER_CHECK = { ok: true, server_verified: true, method: "server-generated-v1", checked_keys: [], missing_keys: [] };

async function create(req: Request, body: any) {
  const { user, userClient, service } = await authorize(req, ["HR_DOCUMENT_GENERATE"]);
  const kind = String(body.kind || "");
  const def = (DECLARATION_DOCS as Record<string, any>)[kind];
  if (!def) throw new HttpError(400, "Neznámý druh dokumentu.");
  // zamestnanec pod pravami pouzivatela (RLS)
  const { data: visible } = await userClient.from("employees").select("id").eq("id", String(body.employee_id || "")).maybeSingle();
  if (!visible) throw new HttpError(404, "Zaměstnanec nenalezen.");
  const { data: employee } = await service.from("employees").select("id, title, first_name, last_name, date_of_birth, private_email").eq("id", visible.id).single();

  const textRow = async (key: string) => (await service.rpc("hr_current_legal_text", { p_key: key })).data;
  const text = await textRow(def.textKey);
  const notice = def.noticeKey ? await textRow(def.noticeKey) : null;
  const { data: s335 } = await service.from("hr_settings").select("value").eq("key", "s335_consent_enabled").maybeSingle();

  let email = employee.private_email ? String(employee.private_email).trim().toLowerCase() : "";
  let consentId: string | null = null;
  let target: Record<string, any> | null = null;
  if (kind === "S335_REVOCATION") {
    const { data: consents } = await service.from("employee_contact_declarations").select("id, email_snapshot")
      .eq("employee_id", employee.id).eq("kind", "S335_CONSENT").is("revoked_at", null).order("declared_at", { ascending: false }).limit(1);
    if (!consents?.length) throw new HttpError(409, "Zaměstnanec nemá platný souhlas § 335, který by šel odvolat.");
    consentId = consents[0].id;
    email = consents[0].email_snapshot;
  }
  if (kind === "RECEIPT") {
    const doc = await loadVisibleDocument(userClient, service, String(body.target_document_id || ""));
    if (doc.employee_id !== employee.id) throw new HttpError(409, "Dokument patří jinému zaměstnanci.");
    // elektronicky podpis: podepsany original; papir: vytistene finalni PDF
    const sha = doc.signed_pdf_sha256 || doc.final_pdf_sha256;
    if (!["SIGNED", "ARCHIVED"].includes(doc.status) || !sha) throw new HttpError(409, "Potvrzení o převzetí jen k podepsanému dokumentu.");
    target = { id: doc.id, title: DOC_TITLES[doc.doc_type] || doc.doc_type, version_no: doc.version_no || 1, sha256: sha };
  }
  const errors = declarationInputErrors(kind, { employee, email, text, notice, target, s335Enabled: s335?.value === true });
  if (errors.length) throw new HttpError(409, errors.join(" "));

  // nepodpisany (nezamknuty) dokument rovnakeho druhu sa nahradi novym
  const { data: open } = await service.from("hr_documents").select("id, variables_snapshot")
    .eq("employee_id", employee.id).eq("doc_type", def.doc_type).is("locked_at", null).not("status", "in", "(VOIDED,SUPERSEDED,SIGNED,ARCHIVED)");
  for (const d of (open || []).filter((d) => (d.variables_snapshot?.target_document_id || null) === (target?.id || null))) {
    await service.from("hr_documents").update({ status: "VOIDED", void_reason: "Nahrazeno novým vyhotovením před podpisem", updated_at: new Date().toISOString() }).eq("id", d.id);
  }

  const createdAt = new Date().toISOString();
  const [font, bold] = await Promise.all([asset("fonts/DejaVuSans.ttf"), asset("fonts/DejaVuSans-Bold.ttf")]);
  const bytes = await buildEmployeeDeclarationPdf({ kind, employee, email, text, notice, target, createdAt, fontBytes: font, boldFontBytes: bold, s335Enabled: s335?.value === true });
  const pages = (await PDFDocument.load(bytes)).getPageCount();
  const sha256 = await sha256Hex(bytes);
  const id = `doc-${crypto.randomUUID().replaceAll("-", "")}`;
  const doc = { id, employee_id: employee.id };
  const { error: insErr } = await service.from("hr_documents").insert({
    ...doc, doc_type: def.doc_type, origin: "GENERATED", status: "READY_FOR_SIGNATURE", legal_act_type: defaultLegalActType(def.doc_type),
    generated_at: createdAt, generated_by: user.id,
    variables_snapshot: {
      text_kind: kind, declaration_kind: def.declarationKind, email: def.needsEmail ? email : null, pages,
      text_version_id: text.id, notice_version_id: notice?.id || null, consent_id: consentId,
      target_document_id: target?.id || null, target_sha256: target?.sha256 || null,
    },
  });
  if (insErr) throw new HttpError(409, insErr.message);
  const path = `${documentFolder(doc)}finalni-${sha256.slice(0, 16)}.pdf`;
  const { error: upErr } = await service.storage.from(BUCKET)
    .upload(path, new Blob([bytes], { type: "application/pdf" }), { contentType: "application/pdf", upsert: false });
  if (upErr) throw new HttpError(500, upErr.message);
  const { error: updErr } = await service.from("hr_documents").update({
    final_pdf_path: path, final_pdf_sha256: sha256, finalized_at: createdAt, finalized_by: user.id,
    final_pdf_text_check: { ...SERVER_CHECK, checked_at: createdAt },
  }).eq("id", id);
  if (updErr) throw new HttpError(500, updErr.message);
  return json({ ok: true, document_id: id, sha256, pages, text_version: text.version_no, text_status: text.status });
}

Deno.serve(handle(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.action === "create") return create(req, body);
  throw new HttpError(400, "Neznama akce.");
}));
