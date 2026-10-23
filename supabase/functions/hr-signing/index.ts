// Edge Function: podpisovy rezim na tablete pre HR (faza F + doplnky).
//
// Podpis zamestnanca LEN pri osobnej pritomnosti:
//   HR { action: "issue", document_id, identity: { document_type, confirmed } }
//     HR overi totoznost podla dokladu; server vyda jednorazovy token (len do
//     QR na obrazovke HR) + kratky kod (zobrazeny HR), 10 min, viazany na
//     dokument, otisk finalneho PDF a AKTIVNU relaciu HR (odhlasenie = koniec).
//   tablet { action: "load", token, device_id, code? }
//     Prve otvorenie vyzaduje kod z obrazovky HR (3 zle kody = token zruseny);
//     potom je token viazany na toto zariadenie.
//   tablet { action: "sign", token, device_id, ... }
// Za zamestnavatela (prihlaseny, platna plna moc z hr_signatories):
//   { action: "employer_load" | "employer_sign", document_id, ... }
// Uznavany el. podpis:
//   { action: "qualified_upload", document_id, pdf_base64, signed_by_name, signer_type }
//   { action: "qualified_verify", signature_id, result, service_name, protocol_base64, note }
// Plna moc (HR_ADMIN): { action: "signatory_scan", signatory_id, scan_base64 }
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  json, handle, HttpError, download, authorize, loadVisibleDocument, extractPdfPages, BUCKET,
  sessionIdFromRequest, scanType, MAX_SCAN_BYTES, fromBase64,
} from "../_shared/hrServer.ts";
import { createSignedOriginal, missingSigners, DOC_TITLES } from "../_shared/signedOriginalServer.ts";
import { sha256Hex, documentFolder } from "../_shared/pdfTextCheck.js";
import { defaultLegalActType, isS334Document } from "../_shared/signingRules.js";
import {
  EMPLOYEE_INTENT_KEY, EMPLOYER_INTENT_KEY, IDENTITY_DOCUMENTS, TOKEN_MINUTES, MAX_CODE_ATTEMPTS, PAIRING_CODE_LENGTH,
  validDeviceId, validPairingCode, trainingIntentDetail, allPagesViewed, validSignatureImage, employerSignatory, inspectPades,
  CERTIFICATE_STATUS_LABELS,
} from "../_shared/hr/tabletSigning.js";
import { queueAndSend, validDeclaration } from "../_shared/hrMail.ts";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
function b64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const legalAct = (doc: Record<string, any>) => doc.legal_act_type || defaultLegalActType(doc.doc_type);
const newId = (p: string) => `${p}-${crypto.randomUUID().replaceAll("-", "")}`;
const enc = (s: string) => new TextEncoder().encode(s);
const codeHash = (tokenSha: string, code: string) => sha256Hex(enc(`${tokenSha}:${code}`));
const today = () => new Date().toISOString().slice(0, 10);

async function currentText(service: SupabaseClient, key: string) {
  const { data, error } = await service.rpc("hr_current_legal_text", { p_key: key });
  if (error || !data?.id) throw new HttpError(500, `Chybi text ${key}.`);
  return data;
}

async function employeeName(service: SupabaseClient, employeeId: string) {
  const { data: e } = await service.from("employees").select("title, first_name, last_name").eq("id", employeeId).maybeSingle();
  return e ? [e.title, e.first_name, e.last_name].filter(Boolean).join(" ") : "";
}

async function profileName(service: SupabaseClient, user: { id: string; email?: string }) {
  const { data: prof } = await service.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  return prof?.full_name || user.email || user.id;
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

async function finish(service: SupabaseClient, docId: string, actorId: string) {
  const { data: doc } = await service.from("hr_documents").select("*").eq("id", docId).single();
  const missing = await missingSigners(service, doc);
  if (missing.length) return { complete: false, missing };
  const r = await createSignedOriginal(service, doc);
  return { complete: true, signed_pdf_sha256: r.sha256, s21: await sendS21AfterSigning(service, docId, actorId) };
}

// Faza G: zmluva podpisana elektronicky (zamestnanec na tablete) -> hned
// zaslat podpisany original na § 21 adresu (konzervativne aj pri osobnom
// stretnuti - hr_settings.s21_tablet_in_person_conservative). Zlyhanie
// odoslania nerusi podpis; zostava viditelne v detaile dokumentu.
async function sendS21AfterSigning(service: SupabaseClient, docId: string, actorId: string) {
  const { data: doc } = await service.from("hr_documents").select("*").eq("id", docId).single();
  if (legalAct(doc) !== "BILATERAL_CONTRACT") return null;
  const { data: sigs } = await service.from("hr_document_signatures").select("method, signer_type").eq("hr_document_id", docId);
  if (!(sigs || []).some((x) => x.signer_type === "EMPLOYEE" && x.method.startsWith("ELECTRONIC"))) return null;
  const decl = await validDeclaration(service, doc.employee_id, "S21_ADDRESS_NOTICE");
  if (!decl) return { sent: false, reason: "Chybí platné § 21 oznámení – předejte vyhotovení osobně." };
  try {
    const dl = await queueAndSend(service, doc, { channel: "EMAIL_S21", recipient: decl.email_snapshot, declarationId: decl.id, actorId });
    return { sent: dl?.send_status === "SENT", delivery_id: dl?.id, send_status: dl?.send_status, send_error: dl?.send_error || null };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

// § 21: elektronicke uzavretie zmluvy len ked je zapnute a zamestnanec ma
// platne oznamenie adresy pre aktualny e-mail; inak papier + osobne predanie.
async function electronicContractGate(service: SupabaseClient, doc: Record<string, any>) {
  if (legalAct(doc) !== "BILATERAL_CONTRACT") return;
  const { data: rows } = await service.from("hr_settings").select("key, value").in("key", ["electronic_contract_enabled", "s21_tablet_in_person_conservative"]);
  const set = Object.fromEntries((rows || []).map((r) => [r.key, r.value]));
  if (set.s21_tablet_in_person_conservative === false) return;
  if (set.electronic_contract_enabled !== true) {
    throw new HttpError(409, "Elektronické uzavírání smluv (§ 21) je vypnuté – smlouvu podepište na papíře a vyhotovení předejte osobně.");
  }
  if (!(await validDeclaration(service, doc.employee_id, "S21_ADDRESS_NOTICE"))) {
    throw new HttpError(409, "Zaměstnanec nemá platné oznámení e-mailové adresy podle § 21 pro aktuální e-mail – elektronické uzavření smlouvy není aktivní, použijte papír.");
  }
}

function checkSignaturePayload(body: any, doc: Record<string, any>, pages: number, intent: Record<string, any>) {
  if (body.displayed_sha256 !== doc.final_pdf_sha256) throw new HttpError(409, "Zobrazený dokument neodpovídá finální verzi – načtěte ho znovu.");
  if (!allPagesViewed(pages, body.evidence?.pages_viewed)) throw new HttpError(422, "Před podpisem je nutné zobrazit všechny strany dokumentu.");
  if (body.intent_text_version_id !== intent.id) throw new HttpError(409, "Text prohlášení byl změněn – načtěte dokument znovu.");
  const png = fromBase64(String(body.signature_png_base64 || ""));
  const strokes = Array.isArray(body.strokes) ? body.strokes : [];
  if (!validSignatureImage(png, strokes)) throw new HttpError(422, "Podpis chybí nebo je neplatný.");
  return { png, strokes };
}

async function saveTabletSignature(service: SupabaseClient, req: Request, doc: Record<string, any>, p: {
  signer: string; name: string; png: Uint8Array; strokes: unknown[]; intent: Record<string, any>; identity: unknown;
  signerUserId?: string | null; evidence: Record<string, unknown>; deviceId?: string | null;
}) {
  const imgId = newId("img");
  const { error: iErr } = await service.from("hr_signature_images").insert({ id: imgId, png: `\\x${hex(p.png)}`, png_sha256: "x", strokes: p.strokes });
  if (iErr) throw new HttpError(500, iErr.message);
  const { error: sErr } = await service.from("hr_document_signatures").insert({
    id: newId("sig"), hr_document_id: doc.id, method: "ELECTRONIC_TABLET", signer_type: p.signer, signed_by_name: p.name,
    signed_content_sha256: doc.final_pdf_sha256, document_hash: doc.final_pdf_sha256, signature_image_id: imgId,
    intent_text_version_id: p.intent.id, intent_text_sha256: p.intent.body_sha256, identity_verification: p.identity,
    signer_user_id: p.signerUserId || null, evidence: p.evidence,
    device_metadata: { device_id: p.deviceId || null, user_agent: (req.headers.get("user-agent") || "").slice(0, 300) },
  });
  if (sErr) throw new HttpError(409, sErr.message);
}

async function pdfForSigning(service: SupabaseClient, doc: Record<string, any>) {
  const bytes = await download(service, doc.final_pdf_path);
  if ((await sha256Hex(bytes)) !== doc.final_pdf_sha256) throw new HttpError(500, "Finální PDF v úložišti neodpovídá otisku.");
  const pages = (await extractPdfPages(bytes)).length;
  return { bytes, pages };
}

function randomCode() {
  const r = new Uint32Array(1);
  crypto.getRandomValues(r);
  return String(r[0] % 10 ** PAIRING_CODE_LENGTH).padStart(PAIRING_CODE_LENGTH, "0");
}

// ---------- HR: vydanie tokenu (osobna pritomnost) ----------
async function issue(req: Request, body: any) {
  const { user, userClient, service } = await authorize(req, ["HR_DOCUMENT_SIGN"]);
  const hrSession = sessionIdFromRequest(req);
  const doc = await loadVisibleDocument(userClient, service, String(body.document_id || ""));
  await signable(service, doc, "EMPLOYEE");
  if (!EMPLOYEE_INTENT_KEY[legalAct(doc) as keyof typeof EMPLOYEE_INTENT_KEY]) throw new HttpError(409, "Tento dokument zaměstnanec nepodepisuje.");
  await training(service, doc);
  await electronicContractGate(service, doc);
  const idDoc = String(body.identity?.document_type || "");
  if (!(idDoc in IDENTITY_DOCUMENTS) || body.identity?.confirmed !== true) {
    throw new HttpError(422, "Potvrďte ověření totožnosti podle dokladu.");
  }
  const name = await employeeName(service, doc.employee_id);
  const hrName = await profileName(service, user);
  const identity = {
    method: "ID_DOCUMENT_CHECKED_BY_HR_IN_PERSON", document_type: idDoc,
    verified_by: user.id, verified_by_name: hrName, verified_at: new Date().toISOString(), hr_session_id: hrSession,
    label: `Totožnost ověřil(a) osobně ${hrName} podle dokladu (${IDENTITY_DOCUMENTS[idDoc as keyof typeof IDENTITY_DOCUMENTS]})`,
  };
  const now = new Date().toISOString();
  await service.from("hr_signing_tokens").update({ revoked_at: now }).eq("hr_document_id", doc.id).is("used_at", null).is("revoked_at", null);
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const token = b64(raw).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const tokenSha = await sha256Hex(enc(token));
  const code = randomCode();
  const expires = new Date(Date.now() + TOKEN_MINUTES * 60_000).toISOString();
  const { error } = await service.from("hr_signing_tokens").insert({
    token_sha256: tokenSha, pairing_code_sha256: await codeHash(tokenSha, code), hr_session_id: hrSession,
    hr_document_id: doc.id, final_pdf_sha256: doc.final_pdf_sha256,
    signer_type: "EMPLOYEE", signer_name: name, identity_verification: identity, created_by: user.id, expires_at: expires,
  });
  if (error) throw new HttpError(500, error.message);
  // token patri len do QR kodu na obrazovke HR; kod HR zada/povie na tablete
  return json({ ok: true, token, code, expires_at: expires, signer_name: name });
}

// ---------- tablet: token + kod + zariadenie ----------
async function tokenRow(service: SupabaseClient, token: unknown) {
  if (typeof token !== "string" || token.length < 30) throw new HttpError(401, "Neplatný podpisový kód QR.");
  const { data: t } = await service.from("hr_signing_tokens").select("*").eq("token_sha256", await sha256Hex(enc(token))).maybeSingle();
  if (!t || t.revoked_at || t.used_at || new Date(t.expires_at) < new Date()) {
    throw new HttpError(410, "Podpis už není možný (QR kód byl použit, zrušen nebo vypršel). Požádejte personální oddělení o nový.");
  }
  const { data: active } = await service.rpc("hr_auth_session_active", { p_session_id: t.hr_session_id, p_user_id: t.created_by });
  if (active !== true) throw new HttpError(410, "Pracovník HR, který ověřil totožnost, už není přihlášen – podpis je nutné připravit znovu.");
  const { data: doc } = await service.from("hr_documents").select("*").eq("id", t.hr_document_id).single();
  if (!doc || doc.final_pdf_sha256 !== t.final_pdf_sha256) throw new HttpError(410, "Dokument se mezitím změnil – podpis je nutné připravit znovu.");
  await signable(service, doc, "EMPLOYEE");
  return { t, doc };
}

// Prve otvorenie: kod z obrazovky HR, potom vazba na zariadenie.
async function pairDevice(service: SupabaseClient, t: Record<string, any>, body: any) {
  const deviceId = body.device_id;
  if (!validDeviceId(deviceId)) throw new HttpError(422, "Chybí identifikátor zařízení.");
  if (t.code_verified_at) {
    if (t.device_id !== deviceId) throw new HttpError(403, "Podpis byl otevřen na jiném zařízení.");
    return t;
  }
  if (body.code === undefined || body.code === null || body.code === "") {
    throw new HttpError(428, "Zadejte kód zobrazený na obrazovce personálního oddělení.");
  }
  const ok = validPairingCode(String(body.code)) && (await codeHash(t.token_sha256, String(body.code))) === t.pairing_code_sha256;
  if (!ok) {
    const attempts = t.code_attempts + 1;
    await service.from("hr_signing_tokens").update({ code_attempts: attempts }).eq("id", t.id).eq("code_attempts", t.code_attempts);
    if (attempts >= MAX_CODE_ATTEMPTS) throw new HttpError(410, "Třikrát chybný kód – podpis byl zrušen. Požádejte personální oddělení o nový.");
    throw new HttpError(403, `Chybný kód. Zbývající pokusy: ${MAX_CODE_ATTEMPTS - attempts}.`);
  }
  const verifiedAt = new Date().toISOString();
  const { data: upd } = await service.from("hr_signing_tokens").update({ code_verified_at: verifiedAt, device_id: deviceId })
    .eq("id", t.id).is("code_verified_at", null).is("revoked_at", null).select("*");
  if (!upd?.length) throw new HttpError(409, "Podpis byl mezitím otevřen jinde.");
  return upd[0];
}

async function employeeIntent(service: SupabaseClient, doc: Record<string, any>) {
  const intent = await currentText(service, EMPLOYEE_INTENT_KEY[legalAct(doc) as keyof typeof EMPLOYEE_INTENT_KEY]);
  const t = await training(service, doc);
  return { intent, detail: trainingIntentDetail(t), training: t };
}

async function load(service: SupabaseClient, body: any) {
  const { t: t0, doc } = await tokenRow(service, body.token);
  const t = await pairDevice(service, t0, body);
  const { bytes, pages } = await pdfForSigning(service, doc);
  const { intent, detail } = await employeeIntent(service, doc);
  return json({
    ok: true, document: { id: doc.id, title: DOC_TITLES[doc.doc_type] || doc.doc_type, version_no: doc.version_no },
    signer_name: t.signer_name, sha256: doc.final_pdf_sha256, pages, pdf_base64: b64(bytes), expires_at: t.expires_at,
    intent: { id: intent.id, version_no: intent.version_no, body: intent.body, detail },
  });
}

async function sign(service: SupabaseClient, req: Request, body: any) {
  const { t: t0, doc } = await tokenRow(service, body.token);
  if (!t0.code_verified_at) throw new HttpError(428, "Zadejte kód zobrazený na obrazovce personálního oddělení.");
  await electronicContractGate(service, doc);
  const t = await pairDevice(service, t0, body);
  if (body.name_confirmed !== true) throw new HttpError(422, "Potvrďte své jméno.");
  const { pages } = await pdfForSigning(service, doc);
  const { intent, detail, training: tr } = await employeeIntent(service, doc);
  const { png, strokes } = checkSignaturePayload(body, doc, pages, intent);
  // jednorazovost: token sa oznaci ako pouzity atomicky PRED zapisom podpisu
  const { data: used } = await service.from("hr_signing_tokens").update({ used_at: new Date().toISOString() })
    .eq("id", t.id).is("used_at", null).is("revoked_at", null).select("id");
  if (!used?.length) throw new HttpError(410, "Podpis už byl proveden.");
  await saveTabletSignature(service, req, doc, {
    signer: "EMPLOYEE", name: t.signer_name, png, strokes, intent, identity: t.identity_verification, deviceId: t.device_id,
    evidence: {
      channel: "HR_TABLET_IN_PERSON", signing_token_id: t.id, issued_by: t.created_by, hr_session_id: t.hr_session_id,
      device_id: t.device_id, code_verified_at: t.code_verified_at, code_attempts: t.code_attempts,
      all_pages_viewed: true, pages_total: pages,
      pages_viewed: [...new Set((body.evidence?.pages_viewed || []).map(Number))].sort((a, b) => a - b),
      viewed_at: body.evidence?.viewed_at || null, viewport: body.evidence?.viewport || null, name_confirmed: true,
      intent_detail: detail || null, training_record_id: tr?.id || null, stroke_count: strokes.length,
    },
  });
  return json({ ok: true, ...(await finish(service, doc.id, t.created_by)) });
}

// ---------- HR: podpis za zamestnavatela ----------
async function signatoryFor(service: SupabaseClient, userId: string) {
  const d = today();
  const { data } = await service.from("hr_signatories").select("*").eq("user_id", userId)
    .lte("valid_from", d).or(`valid_to.is.null,valid_to.gte.${d}`).order("valid_from", { ascending: false }).limit(1);
  return data?.[0] || null;
}

async function employerContext(req: Request, body: any) {
  const { user, userClient, service } = await authorize(req, ["HR_DOCUMENT_SIGN"]);
  const doc = await loadVisibleDocument(userClient, service, String(body.document_id || ""));
  await signable(service, doc, "EMPLOYER");
  if (isS334Document(doc)) {
    throw new HttpError(409, "Písemnost § 334 podepisuje zaměstnavatel uznávaným elektronickým podpisem (nahrajte podepsané PDF) nebo na papíře.");
  }
  const who = employerSignatory(await signatoryFor(service, user.id), doc.variables_snapshot || {}, today());
  if (!who.ok) throw new HttpError(403, who.reason);
  const intent = await currentText(service, EMPLOYER_INTENT_KEY);
  return { user, service, doc, name: who.name as string, signatoryId: who.signatoryId as string, intent };
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
  const { user, service, doc, name, signatoryId, intent } = await employerContext(req, body);
  if (body.confirmed !== true) throw new HttpError(422, "Potvrďte podpis za zaměstnavatele.");
  const { pages } = await pdfForSigning(service, doc);
  const { png, strokes } = checkSignaturePayload(body, doc, pages, intent);
  await saveTabletSignature(service, req, doc, {
    signer: "EMPLOYER", name, png, strokes, intent, signerUserId: user.id,
    identity: { method: "LOGGED_IN_ACCOUNT", user_id: user.id, email: user.email, signatory_id: signatoryId, hr_session_id: sessionIdFromRequest(req),
      label: `Přihlášený účet ${user.email}, podpis na základě plné moci` },
    evidence: {
      channel: "HR_TABLET_EMPLOYER", signatory_id: signatoryId, all_pages_viewed: true, pages_total: pages,
      pages_viewed: [...new Set((body.evidence?.pages_viewed || []).map(Number))].sort((a, b) => a - b),
      viewed_at: body.evidence?.viewed_at || null, confirmed: true, stroke_count: strokes.length,
    },
  });
  return json({ ok: true, ...(await finish(service, doc.id, user.id)) });
}

// ---------- HR: uznavany el. podpis (PAdES) ----------
async function qualifiedUpload(req: Request, body: any) {
  const { user, userClient, service } = await authorize(req, ["HR_DOCUMENT_SIGN"]);
  const doc = await loadVisibleDocument(userClient, service, String(body.document_id || ""));
  const signer = body.signer_type === "EMPLOYEE" ? "EMPLOYEE" : "EMPLOYER";
  await signable(service, doc, signer);
  const name = String(body.signed_by_name || "").trim();
  if (!name) throw new HttpError(422, "Uveďte, kdo dokument podepsal.");
  const signed = fromBase64(String(body.pdf_base64 || ""));
  if (signed.length > MAX_SCAN_BYTES) throw new HttpError(413, "Soubor je příliš velký.");
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
    identity_verification: { method: "QUALIFIED_CERTIFICATE", certificate_validation: "NOT_PERFORMED", label: `Uznávaný el. podpis – ${CERTIFICATE_STATUS_LABELS.NOT_VERIFIED}` },
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
    return json({ ok: true, complete: true, signed_pdf_sha256: sha, qualified_original: true, certificate: "NOT_VERIFIED" });
  }
  return json({ ok: true, certificate: "NOT_VERIFIED", ...(await finish(service, doc.id, user.id)) });
}

// Rucne overenie certifikatu cez verejnu overovaciu sluzbu: protokol o
// overeni ulozi a zahashuje server, zaznam kto a kedy overil.
async function qualifiedVerify(req: Request, body: any) {
  const { user, userClient, service } = await authorize(req, ["HR_DOCUMENT_SIGN"]);
  const { data: sig } = await service.from("hr_document_signatures").select("*").eq("id", String(body.signature_id || "")).maybeSingle();
  if (!sig) throw new HttpError(404, "Podpis nenalezen.");
  const doc = await loadVisibleDocument(userClient, service, sig.hr_document_id);
  if (sig.method !== "ELECTRONIC_QUALIFIED") throw new HttpError(409, "Ověření certifikátu jen u uznávaného elektronického podpisu.");
  const result = String(body.result || "");
  if (!["VALID", "INVALID", "INDETERMINATE"].includes(result)) throw new HttpError(422, "Vyberte výsledek ověření.");
  const serviceName = String(body.service_name || "").trim();
  if (!serviceName) throw new HttpError(422, "Uveďte ověřovací službu.");
  const protocol = fromBase64(String(body.protocol_base64 || ""));
  if (!protocol.length) throw new HttpError(422, "Nahrajte protokol o ověření.");
  if (protocol.length > MAX_SCAN_BYTES) throw new HttpError(413, "Soubor je příliš velký.");
  const type = scanType(protocol);
  if (!type) throw new HttpError(422, "Protokol musí být PDF, PNG nebo JPG.");
  const sha = await sha256Hex(protocol);
  const path = `${documentFolder(doc)}overeni-podpisu-${sha.slice(0, 16)}.${type.ext}`;
  const { error: upErr } = await service.storage.from(BUCKET).upload(path, new Blob([protocol], { type: type.mime }), { contentType: type.mime, upsert: false });
  if (upErr && !/exists|Duplicate/i.test(upErr.message)) throw new HttpError(409, upErr.message);
  const { data: row, error } = await service.from("hr_signature_verifications").insert({
    signature_id: sig.id, result, method: "MANUAL_PUBLIC_SERVICE", service_name: serviceName, protocol_path: path, protocol_sha256: sha,
    verified_by: user.id, verified_by_name: await profileName(service, user), note: String(body.note || "").trim() || null,
  }).select("*").single();
  if (error) throw new HttpError(409, error.message);
  return json({ ok: true, verification: row, label: CERTIFICATE_STATUS_LABELS[result as keyof typeof CERTIFICATE_STATUS_LABELS] });
}

// ---------- HR_ADMIN: sken plnej moci ----------
async function signatoryScan(req: Request, body: any) {
  const { service } = await authorize(req, ["HR_ADMIN"]);
  const { data: s } = await service.from("hr_signatories").select("*").eq("id", String(body.signatory_id || "")).maybeSingle();
  if (!s) throw new HttpError(404, "Osoba s plnou mocí nenalezena.");
  if (s.poa_scan_path) throw new HttpError(409, "Sken plné moci je už uložen (nemění se) – pro novou plnou moc založte nový záznam.");
  const bytes = fromBase64(String(body.scan_base64 || ""));
  if (!bytes.length || bytes.length > MAX_SCAN_BYTES) throw new HttpError(422, "Nahrajte sken plné moci (max. 15 MB).");
  const type = scanType(bytes);
  if (!type) throw new HttpError(422, "Sken musí být PDF, PNG nebo JPG.");
  const sha = await sha256Hex(bytes);
  const path = `plne-moci/${s.id}-${sha.slice(0, 16)}.${type.ext}`;
  const { error: upErr } = await service.storage.from(BUCKET).upload(path, new Blob([bytes], { type: type.mime }), { contentType: type.mime, upsert: false });
  if (upErr) throw new HttpError(409, upErr.message);
  const { error } = await service.from("hr_signatories").update({ poa_scan_path: path, poa_scan_sha256: sha }).eq("id", s.id);
  if (error) throw new HttpError(409, error.message);
  return json({ ok: true, path, sha256: sha });
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
    case "qualified_verify": return qualifiedVerify(req, body);
    case "signatory_scan": return signatoryScan(req, body);
    default: throw new HttpError(400, "Neznama akce.");
  }
}));
