// Edge Function: podpisovy rezim na tablete pre HR (faza F).
//
// HR (prihlaseny, HR_DOCUMENT_SIGN):
//   { action: "issue", document_id, identity: { document_type, confirmed } }
//     Overi dokument (finalne PDF overene serverom, chyba podpis zamestnanca,
//     pri zazname o skoleni evidencia s overenim znalosti), zrusi starsie
//     tokeny a vyda JEDNORAZOVY token viazany na dokument + otisk finalneho
//     PDF (30 min). Token sa vrati len raz; v DB je iba jeho hash.
//   { action: "employer_load", document_id } / { action: "employer_sign", ... }
//     Podpis za zamestnavatela prihlasenou osobou s plnou mocou.
//   { action: "qualified_upload", document_id, pdf_base64, signed_by_name }
//     Externe podpisane PDF (PAdES) - nutne pri pisomnostiach § 334.
// Podpisujuci (tablet, bez prihlasenia - identita = token):
//   { action: "load", token } / { action: "sign", token, ... }
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { json, handle, HttpError, download, authorize, loadVisibleDocument, extractPdfPages, BUCKET } from "../_shared/hrServer.ts";
import { createSignedOriginal, missingSigners, DOC_TITLES } from "../_shared/signedOriginalServer.ts";
import { sha256Hex, documentFolder } from "../_shared/pdfTextCheck.js";
import { defaultLegalActType, isS334Document } from "../_shared/signingRules.js";
import {
  EMPLOYEE_INTENT_KEY, EMPLOYER_INTENT_KEY, IDENTITY_DOCUMENTS, TOKEN_MINUTES,
  trainingIntentDetail, allPagesViewed, validSignatureImage, employerSignatory, inspectPades,
} from "../_shared/hr/tabletSigning.js";

const MAX_QUALIFIED_PDF = 15_000_000;
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
function b64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const legalAct = (doc: Record<string, any>) => doc.legal_act_type || defaultLegalActType(doc.doc_type);
const newId = (p: string) => `${p}-${crypto.randomUUID().replaceAll("-", "")}`;

async function currentText(service: SupabaseClient, key: string) {
  const { data, error } = await service.rpc("hr_current_legal_text", { p_key: key });
  if (error || !data?.id) throw new HttpError(500, `Chybi text ${key}.`);
  return data;
}

async function employeeName(service: SupabaseClient, employeeId: string) {
  const { data: e } = await service.from("employees").select("title, first_name, last_name").eq("id", employeeId).maybeSingle();
  return e ? [e.title, e.first_name, e.last_name].filter(Boolean).join(" ") : "";
}

async function training(service: SupabaseClient, doc: Record<string, any>) {
  if (legalAct(doc) !== "TRAINING_RECORD") return null;
  const { data: t } = doc.training_record_id
    ? await service.from("hr_training_records").select("*").eq("id", doc.training_record_id).maybeSingle()
    : { data: null };
  if (!t || t.employee_id !== doc.employee_id || t.knowledge_check_result !== "PASSED") {
    throw new HttpError(409, "Záznam o školení nemá evidenci školení s úspěšným ověřením znalostí – podpis nelze nabídnout.");
  }
  return t;
}

// Spolocne kontroly dokumentu pred podpisom.
async function signable(service: SupabaseClient, doc: Record<string, any>, signer: "EMPLOYEE" | "EMPLOYER") {
  if (["SIGNED", "ARCHIVED", "VOIDED", "SUPERSEDED"].includes(doc.status)) throw new HttpError(409, "Dokument nelze podepsat (podepsán, zneplatněn nebo nahrazen).");
  if (!doc.final_pdf_path || !doc.final_pdf_text_check?.ok || !doc.final_pdf_text_check?.server_verified) {
    throw new HttpError(409, "Dokument nemá serverem ověřené finální PDF.");
  }
  if (!doc.employee_id) throw new HttpError(409, "Dokument zatím nepatří zaměstnanci.");
  const missing = await missingSigners(service, doc);
  if (!missing.includes(signer)) throw new HttpError(409, signer === "EMPLOYEE" ? "Zaměstnanec už podepsal nebo podpis nepotřebuje." : "Zaměstnavatel už podepsal nebo podpis nepotřebuje.");
}

async function finish(service: SupabaseClient, docId: string) {
  const { data: doc } = await service.from("hr_documents").select("*").eq("id", docId).single();
  const missing = await missingSigners(service, doc);
  if (missing.length) return { complete: false, missing };
  const r = await createSignedOriginal(service, doc);
  return { complete: true, signed_pdf_sha256: r.sha256 };
}

function checkSignaturePayload(body: any, doc: Record<string, any>, pages: number, intent: Record<string, any>) {
  if (body.displayed_sha256 !== doc.final_pdf_sha256) throw new HttpError(409, "Zobrazený dokument neodpovídá finální verzi – načtěte ho znovu.");
  if (!allPagesViewed(pages, body.evidence?.pages_viewed)) throw new HttpError(422, "Před podpisem je nutné zobrazit všechny strany dokumentu.");
  if (body.intent_text_version_id !== intent.id) throw new HttpError(409, "Text prohlášení byl změněn – načtěte dokument znovu.");
  const png = fromB64(String(body.signature_png_base64 || ""));
  const strokes = Array.isArray(body.strokes) ? body.strokes : [];
  if (!validSignatureImage(png, strokes)) throw new HttpError(422, "Podpis chybí nebo je neplatný.");
  return { png, strokes };
}

async function saveTabletSignature(service: SupabaseClient, req: Request, doc: Record<string, any>, p: {
  signer: string; name: string; png: Uint8Array; strokes: unknown[]; intent: Record<string, any>; identity: unknown;
  signerUserId?: string | null; evidence: Record<string, unknown>;
}) {
  const imgId = newId("img");
  const { error: iErr } = await service.from("hr_signature_images").insert({ id: imgId, png: `\\x${hex(p.png)}`, png_sha256: "x", strokes: p.strokes });
  if (iErr) throw new HttpError(500, iErr.message);
  const { error: sErr } = await service.from("hr_document_signatures").insert({
    id: newId("sig"), hr_document_id: doc.id, method: "ELECTRONIC_TABLET", signer_type: p.signer, signed_by_name: p.name,
    signed_content_sha256: doc.final_pdf_sha256, document_hash: doc.final_pdf_sha256, signature_image_id: imgId,
    intent_text_version_id: p.intent.id, intent_text_sha256: p.intent.body_sha256, identity_verification: p.identity,
    signer_user_id: p.signerUserId || null, evidence: p.evidence,
    device_metadata: { user_agent: (req.headers.get("user-agent") || "").slice(0, 300) },
  });
  if (sErr) throw new HttpError(409, sErr.message);
}

async function pdfForSigning(service: SupabaseClient, doc: Record<string, any>) {
  const bytes = await download(service, doc.final_pdf_path);
  if ((await sha256Hex(bytes)) !== doc.final_pdf_sha256) throw new HttpError(500, "Finální PDF v úložišti neodpovídá otisku.");
  const pages = (await extractPdfPages(bytes)).length;
  return { bytes, pages };
}

// ---------- HR: vydanie tokenu ----------
async function issue(req: Request, body: any) {
  const { user, userClient, service } = await authorize(req, ["HR_DOCUMENT_SIGN"]);
  const doc = await loadVisibleDocument(userClient, service, String(body.document_id || ""));
  await signable(service, doc, "EMPLOYEE");
  if (!EMPLOYEE_INTENT_KEY[legalAct(doc) as keyof typeof EMPLOYEE_INTENT_KEY]) throw new HttpError(409, "Tento dokument zaměstnanec nepodepisuje.");
  await training(service, doc);
  const idDoc = String(body.identity?.document_type || "");
  if (!(idDoc in IDENTITY_DOCUMENTS) || body.identity?.confirmed !== true) {
    throw new HttpError(422, "Potvrďte ověření totožnosti podle dokladu.");
  }
  const name = await employeeName(service, doc.employee_id);
  const { data: prof } = await service.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const identity = {
    method: "ID_DOCUMENT_CHECKED_BY_HR", document_type: idDoc,
    verified_by: user.id, verified_by_name: prof?.full_name || user.email, verified_at: new Date().toISOString(),
    label: `Totožnost ověřil(a) ${prof?.full_name || user.email} podle dokladu (${IDENTITY_DOCUMENTS[idDoc as keyof typeof IDENTITY_DOCUMENTS]})`,
  };
  const now = new Date().toISOString();
  await service.from("hr_signing_tokens").update({ revoked_at: now }).eq("hr_document_id", doc.id).is("used_at", null).is("revoked_at", null);
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const token = b64(raw).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const expires = new Date(Date.now() + TOKEN_MINUTES * 60_000).toISOString();
  const { error } = await service.from("hr_signing_tokens").insert({
    token_sha256: await sha256Hex(new TextEncoder().encode(token)), hr_document_id: doc.id, final_pdf_sha256: doc.final_pdf_sha256,
    signer_type: "EMPLOYEE", signer_name: name, identity_verification: identity, created_by: user.id, expires_at: expires,
  });
  if (error) throw new HttpError(500, error.message);
  return json({ ok: true, token, expires_at: expires, signer_name: name });
}

// ---------- podpisujuci: token ----------
async function tokenRow(service: SupabaseClient, token: unknown) {
  if (typeof token !== "string" || token.length < 30) throw new HttpError(401, "Neplatný podpisový odkaz.");
  const { data: t } = await service.from("hr_signing_tokens").select("*")
    .eq("token_sha256", await sha256Hex(new TextEncoder().encode(token))).maybeSingle();
  if (!t || t.revoked_at || t.used_at || new Date(t.expires_at) < new Date()) {
    throw new HttpError(410, "Podpisový odkaz už neplatí (použit, zrušen nebo vypršel). Požádejte personální oddělení o nový.");
  }
  const { data: doc } = await service.from("hr_documents").select("*").eq("id", t.hr_document_id).single();
  if (!doc || doc.final_pdf_sha256 !== t.final_pdf_sha256) throw new HttpError(410, "Dokument se mezitím změnil – podpisový odkaz neplatí.");
  await signable(service, doc, "EMPLOYEE");
  return { t, doc };
}

async function employeeIntent(service: SupabaseClient, doc: Record<string, any>) {
  const intent = await currentText(service, EMPLOYEE_INTENT_KEY[legalAct(doc) as keyof typeof EMPLOYEE_INTENT_KEY]);
  const t = await training(service, doc);
  return { intent, detail: trainingIntentDetail(t), training: t };
}

async function load(service: SupabaseClient, body: any) {
  const { t, doc } = await tokenRow(service, body.token);
  const { bytes, pages } = await pdfForSigning(service, doc);
  const { intent, detail } = await employeeIntent(service, doc);
  return json({
    ok: true, document: { id: doc.id, title: DOC_TITLES[doc.doc_type] || doc.doc_type, version_no: doc.version_no },
    signer_name: t.signer_name, sha256: doc.final_pdf_sha256, pages, pdf_base64: b64(bytes), expires_at: t.expires_at,
    intent: { id: intent.id, version_no: intent.version_no, body: intent.body, detail },
  });
}

async function sign(service: SupabaseClient, req: Request, body: any) {
  const { t, doc } = await tokenRow(service, body.token);
  if (body.name_confirmed !== true) throw new HttpError(422, "Potvrďte své jméno.");
  const { pages } = await pdfForSigning(service, doc);
  const { intent, detail, training: tr } = await employeeIntent(service, doc);
  const { png, strokes } = checkSignaturePayload(body, doc, pages, intent);
  // jednorazovost: token sa oznaci ako pouzity atomicky PRED zapisom podpisu
  const { data: used } = await service.from("hr_signing_tokens").update({ used_at: new Date().toISOString() })
    .eq("id", t.id).is("used_at", null).is("revoked_at", null).select("id");
  if (!used?.length) throw new HttpError(410, "Podpisový odkaz už byl použit.");
  await saveTabletSignature(service, req, doc, {
    signer: "EMPLOYEE", name: t.signer_name, png, strokes, intent, identity: t.identity_verification,
    evidence: {
      channel: "HR_TABLET", signing_token_id: t.id, all_pages_viewed: true, pages_total: pages,
      pages_viewed: [...new Set((body.evidence?.pages_viewed || []).map(Number))].sort((a, b) => a - b),
      viewed_at: body.evidence?.viewed_at || null, viewport: body.evidence?.viewport || null, name_confirmed: true,
      intent_detail: detail || null, training_record_id: tr?.id || null, stroke_count: strokes.length,
    },
  });
  return json({ ok: true, ...(await finish(service, doc.id)) });
}

// ---------- HR: podpis za zamestnavatela ----------
async function employerContext(req: Request, body: any) {
  const { user, userClient, service } = await authorize(req, ["HR_DOCUMENT_SIGN"]);
  const doc = await loadVisibleDocument(userClient, service, String(body.document_id || ""));
  await signable(service, doc, "EMPLOYER");
  if (isS334Document(doc)) {
    throw new HttpError(409, "Písemnost § 334 podepisuje zaměstnavatel uznávaným elektronickým podpisem (nahrajte podepsané PDF) nebo na papíře.");
  }
  const { data: prof } = await service.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const who = employerSignatory(prof?.full_name || "", doc.variables_snapshot || {});
  if (!who.ok) throw new HttpError(403, who.reason);
  const intent = await currentText(service, EMPLOYER_INTENT_KEY);
  return { user, service, doc, name: who.name as string, intent };
}

async function employerLoad(req: Request, body: any) {
  const { service, doc, name, intent } = await employerContext(req, body);
  const { bytes, pages } = await pdfForSigning(service, doc);
  return json({
    ok: true, document: { id: doc.id, title: DOC_TITLES[doc.doc_type] || doc.doc_type, version_no: doc.version_no },
    signer_name: name, sha256: doc.final_pdf_sha256, pages, pdf_base64: b64(bytes),
    intent: { id: intent.id, version_no: intent.version_no, body: intent.body, detail: "" },
  });
}

async function employerSign(req: Request, body: any) {
  const { user, service, doc, name, intent } = await employerContext(req, body);
  if (body.confirmed !== true) throw new HttpError(422, "Potvrďte podpis za zaměstnavatele.");
  const { pages } = await pdfForSigning(service, doc);
  const { png, strokes } = checkSignaturePayload(body, doc, pages, intent);
  await saveTabletSignature(service, req, doc, {
    signer: "EMPLOYER", name, png, strokes, intent, signerUserId: user.id,
    identity: { method: "LOGGED_IN_ACCOUNT", user_id: user.id, email: user.email, label: `Přihlášený účet ${user.email}, podpis na základě plné moci` },
    evidence: {
      channel: "HR_TABLET_EMPLOYER", all_pages_viewed: true, pages_total: pages,
      pages_viewed: [...new Set((body.evidence?.pages_viewed || []).map(Number))].sort((a, b) => a - b),
      viewed_at: body.evidence?.viewed_at || null, confirmed: true, stroke_count: strokes.length,
    },
  });
  return json({ ok: true, ...(await finish(service, doc.id)) });
}

// ---------- HR: uznavany el. podpis (PAdES) ----------
async function qualifiedUpload(req: Request, body: any) {
  const { user, userClient, service } = await authorize(req, ["HR_DOCUMENT_SIGN"]);
  const doc = await loadVisibleDocument(userClient, service, String(body.document_id || ""));
  const signer = body.signer_type === "EMPLOYEE" ? "EMPLOYEE" : "EMPLOYER";
  await signable(service, doc, signer);
  const name = String(body.signed_by_name || "").trim();
  if (!name) throw new HttpError(422, "Uveďte, kdo dokument podepsal.");
  const signed = fromB64(String(body.pdf_base64 || ""));
  if (signed.length > MAX_QUALIFIED_PDF) throw new HttpError(413, "Soubor je příliš velký.");
  const finalBytes = await download(service, doc.final_pdf_path);
  const check = inspectPades(signed, finalBytes);
  if (!check.ok) throw new HttpError(422, check.reason);
  const sha = await sha256Hex(signed);
  const path = `${documentFolder(doc)}uznavany-podpis-${sha.slice(0, 16)}.pdf`;
  const { error: upErr } = await service.storage.from(BUCKET).upload(path, new Blob([signed], { type: "application/pdf" }), { contentType: "application/pdf", upsert: false });
  if (upErr) throw new HttpError(409, upErr.message);
  const { error: sErr } = await service.from("hr_document_signatures").insert({
    id: newId("sig"), hr_document_id: doc.id, method: "ELECTRONIC_QUALIFIED", signer_type: signer, signed_by_name: name,
    signed_content_sha256: doc.final_pdf_sha256, document_hash: sha, file_path: path, uploaded_by: user.id, signer_user_id: signer === "EMPLOYER" ? user.id : null,
    identity_verification: { method: "QUALIFIED_CERTIFICATE", certificate_validation: "NOT_PERFORMED", label: "Uznávaný el. podpis – platnost certifikátu zatím neověřena (otevřená úloha)" },
    evidence: { pades: { sub_filter: check.subFilter, byte_range: check.byteRange }, uploaded_by: user.id, certificate_validation: "NOT_PERFORMED" },
  });
  if (sErr) throw new HttpError(409, sErr.message);
  // Jediny podpis = uznavany: podpisanym originalom je samotne PAdES PDF
  // (novy subor s dokaznym listom by podpis porusil).
  const { data: sigs } = await service.from("hr_document_signatures").select("method").eq("hr_document_id", doc.id);
  const missing = await missingSigners(service, doc);
  if (!missing.length && (sigs || []).every((s) => s.method === "ELECTRONIC_QUALIFIED")) {
    const { error } = await service.from("hr_documents").update({
      signed_pdf_path: path, signed_pdf_sha256: sha, status: "SIGNED", updated_at: new Date().toISOString(),
    }).eq("id", doc.id);
    if (error) throw new HttpError(409, error.message);
    return json({ ok: true, complete: true, signed_pdf_sha256: sha, qualified_original: true });
  }
  return json({ ok: true, ...(await finish(service, doc.id)) });
}

Deno.serve(handle(async (req) => {
  const body = await req.json().catch(() => ({}));
  const service = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  switch (body.action) {
    case "issue": return issue(req, body);
    case "load": return load(service(), body);
    case "sign": return sign(service(), req, body);
    case "employer_load": return employerLoad(req, body);
    case "employer_sign": return employerSign(req, body);
    case "qualified_upload": return qualifiedUpload(req, body);
    default: throw new HttpError(400, "Neznama akce.");
  }
}));
