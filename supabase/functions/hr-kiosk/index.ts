// Edge Function: vstupny dotaznik na tablete (faza D). Volajuci je kiosk
// (anon kluc) - jedina identita je session_token relacie IN_PROGRESS.
//
// POST { action: "prepare", session_token }
//   Server z draft_data vygeneruje PDF na podpis (osobny dotaznik, pripadne
//   § 21 oznamenie a § 335 suhlas - kazde zvlast), ulozi ich, spocita hash
//   a vrati ich kiosku na zobrazenie. Kiosk ziadne PDF nevytvara.
// POST { action: "sign", session_token, document_id, displayed_sha256,
//        intent_text_version_id, signature_png_base64, strokes, evidence }
//   Overi, ze podpisuje presne zobrazenu verziu (hash), ze videl vsetky
//   strany, ulozi novy obrazok podpisu (nikdy nie opakovane pouzity),
//   nemenny podpisovy zaznam, pri vyhlaseniach zaznam o vyhlaseni a podpisany
//   original. Anon nikdy nedostane ine data nez PDF vlastnej relacie.
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { fillJmhzPdf } from "../_shared/hr/jmhzFill.js";
import {
  KIOSK_DOCS, kioskDocumentPlan, validateKioskCommunication, draftEmail, draftFingerprint, personName,
  buildDeclarationPdf, isValidEmail,
} from "../_shared/hr/kioskDocuments.js";
import { sha256Hex, documentFolder } from "../_shared/pdfTextCheck.js";
import { json, handle, HttpError, download, BUCKET } from "../_shared/hrServer.ts";
import { createSignedOriginal } from "../_shared/signedOriginalServer.ts";

const asset = (f: string) => Deno.readFile(new URL(`../_shared/${f}`, import.meta.url));
const SERVER_CHECK = { ok: true, server_verified: true, method: "server-generated-v1", checked_keys: [], missing_keys: [] };
const MAX_PNG = 300000;
const MAX_DRAFT_CHARS = 200000;
const MAX_SESSION_DOCUMENTS = 40; // vratane zneplatnenych po zmene udajov

function b64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(s: string) {
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

async function loadSession(service: SupabaseClient, token: unknown) {
  if (typeof token !== "string" || token.length < 32) throw new HttpError(401, "Neplatna relace.");
  const { data } = await service.from("onboarding_sessions").select("id, status, draft_data, expires_at")
    .eq("session_token", token).maybeSingle();
  if (!data || data.status !== "IN_PROGRESS" || (data.expires_at && new Date(data.expires_at) < new Date())) {
    throw new HttpError(401, "Relace dotazniku neplati - zacnete prosim znovu.");
  }
  return data;
}

async function config(service: SupabaseClient) {
  const { data, error } = await service.rpc("hr_onboarding_config");
  if (error) throw new HttpError(500, error.message);
  return data as { s335_consent_enabled: boolean; texts: Record<string, any> };
}

function kindOf(doc: Record<string, any>) {
  return Object.keys(KIOSK_DOCS).find((k) => KIOSK_DOCS[k as keyof typeof KIOSK_DOCS].doc_type === doc.doc_type)!;
}

async function generate(service: SupabaseClient, session: Record<string, any>, kind: string, cfg: any, fp: string) {
  const def = (KIOSK_DOCS as Record<string, any>)[kind];
  const draft = session.draft_data || {};
  const createdAt = new Date().toISOString();
  let bytes: Uint8Array;
  if (kind === "QUESTIONNAIRE") {
    const [tpl, font, bold, serif, logo] = await Promise.all([
      asset("hr/JMHZ_dotaznik_2026-03-20C.pdf"), asset("fonts/DejaVuSans.ttf"), asset("fonts/DejaVuSans-Bold.ttf"),
      asset("hr/DejaVuSerif.ttf"), asset("hr/stenger-logo.png"),
    ]);
    ({ bytes } = await fillJmhzPdf(tpl, font, draft, { logoBytes: logo, boldFontBytes: bold, serifFontBytes: serif }));
  } else {
    const [font, bold] = await Promise.all([asset("fonts/DejaVuSans.ttf"), asset("fonts/DejaVuSans-Bold.ttf")]);
    bytes = await buildDeclarationPdf({
      kind, draft, text: cfg.texts[def.textKey], notice: def.noticeKey ? cfg.texts[def.noticeKey] : null,
      createdAt, fontBytes: font, boldFontBytes: bold,
    });
  }
  const pages = (await PDFDocument.load(bytes)).getPageCount();
  const sha256 = await sha256Hex(bytes);
  const id = `doc-${crypto.randomUUID().replaceAll("-", "")}`;
  const doc = { id, employee_id: null, onboarding_session_id: session.id };
  const { error: insErr } = await service.from("hr_documents").insert({
    ...doc, doc_type: def.doc_type, origin: "GENERATED", status: "READY_FOR_SIGNATURE", legal_act_type: "EMPLOYEE_DECLARATION",
    generated_at: createdAt, signing_channel: "ELECTRONIC",
    variables_snapshot: {
      kiosk_kind: kind, draft_sha256: fp, pages,
      text_version_id: def.textKey ? cfg.texts[def.textKey]?.id : null,
      notice_version_id: def.noticeKey ? cfg.texts[def.noticeKey]?.id : null,
    },
  });
  if (insErr) throw new HttpError(500, insErr.message);
  const path = `${documentFolder(doc)}finalni-${sha256.slice(0, 16)}.pdf`;
  const { error: upErr } = await service.storage.from(BUCKET)
    .upload(path, new Blob([bytes], { type: "application/pdf" }), { contentType: "application/pdf", upsert: false });
  if (upErr) throw new HttpError(500, upErr.message);
  const { error: updErr } = await service.from("hr_documents").update({
    final_pdf_path: path, final_pdf_sha256: sha256, finalized_at: createdAt,
    final_pdf_text_check: { ...SERVER_CHECK, checked_at: createdAt },
  }).eq("id", id);
  if (updErr) throw new HttpError(500, updErr.message);
  return { id, kind, bytes, sha256, pages };
}

function describe(cfg: any, kind: string, d: { id: string; sha256: string; pages: number; bytes?: Uint8Array; signed?: boolean }) {
  const def = (KIOSK_DOCS as Record<string, any>)[kind];
  const intent = cfg.texts[def.intentKey];
  return {
    id: d.id, kind, title: def.title, sha256: d.sha256, pages: d.pages, signed: !!d.signed,
    intent: intent ? { id: intent.id, version_no: intent.version_no, body: intent.body } : null,
    pdf_base64: d.bytes ? b64(d.bytes) : null,
  };
}

async function prepare(service: SupabaseClient, body: any) {
  const session = await loadSession(service, body.session_token);
  const draft = session.draft_data || {};
  const cfg = await config(service);
  if (!String(draft.first_name || "").trim() || !String(draft.last_name || "").trim()) throw new HttpError(422, "Vyplnte jmeno a prijmeni.");
  if (!draft.no_private_email && draft.private_email && !isValidEmail(draft.private_email)) throw new HttpError(422, "E-mail nema spravny format.");
  const commErrors = validateKioskCommunication(draft, cfg);
  if (commErrors.length) throw new HttpError(422, commErrors.join(" "));
  if (draft.kiosk_s335 === "ANO" && draft.kiosk_s335_notice_id !== cfg.texts.S335_NOTICE?.id) {
    throw new HttpError(409, "Pouceni k § 335 bylo mezitim zmeneno - prectete si ho prosim znovu.");
  }
  if (JSON.stringify(draft).length > MAX_DRAFT_CHARS) throw new HttpError(413, "Dotazník je příliš velký.");
  const plan = kioskDocumentPlan(draft, cfg);
  const fp = await draftFingerprint(draft);

  const { data: existing } = await service.from("hr_documents")
    .select("id, doc_type, status, locked_at, final_pdf_path, final_pdf_sha256, variables_snapshot")
    .eq("onboarding_session_id", session.id).not("status", "in", "(VOIDED,SUPERSEDED)");
  const current = existing || [];
  const reusable = current.length === plan.length
    && current.every((d) => d.variables_snapshot?.draft_sha256 === fp && plan.includes(d.variables_snapshot?.kiosk_kind));
  if (!reusable && current.some((d) => d.locked_at)) {
    throw new HttpError(409, "Cast dokumentu je jiz podepsana - udaje uz nelze menit.");
  }

  const out = [];
  if (reusable) {
    for (const kind of plan) {
      const d = current.find((x) => x.variables_snapshot.kiosk_kind === kind)!;
      const bytes = d.status === "SIGNED" ? undefined : await download(service, d.final_pdf_path);
      out.push(describe(cfg, kind, { id: d.id, sha256: d.final_pdf_sha256, pages: d.variables_snapshot.pages, bytes, signed: d.status === "SIGNED" }));
    }
  } else {
    // Ochrana pred zahltenim: kazda zmena udajov = nove PDF.
    const { count } = await service.from("hr_documents").select("id", { count: "exact", head: true }).eq("onboarding_session_id", session.id);
    if ((count || 0) + plan.length > MAX_SESSION_DOCUMENTS) {
      throw new HttpError(429, "Příliš mnoho změn dotazníku – požádejte personální oddělení o nový dotazník.");
    }
    for (const d of current) {
      const { error } = await service.from("hr_documents")
        .update({ status: "VOIDED", void_reason: "Údaje dotazníku změněny před podpisem", updated_at: new Date().toISOString() }).eq("id", d.id);
      if (error) throw new HttpError(500, error.message);
    }
    for (const kind of plan) out.push(describe(cfg, kind, await generate(service, session, kind, cfg, fp)));
  }
  return json({ ok: true, documents: out });
}

async function sign(service: SupabaseClient, body: any, req: Request) {
  const session = await loadSession(service, body.session_token);
  const draft = session.draft_data || {};
  const { data: doc } = await service.from("hr_documents").select("*").eq("id", String(body.document_id || "")).maybeSingle();
  if (!doc || doc.onboarding_session_id !== session.id) throw new HttpError(404, "Dokument nenalezen.");
  const kind = kindOf(doc);
  const def = (KIOSK_DOCS as Record<string, any>)[kind];
  if (!def) throw new HttpError(400, "Tento dokument nelze v dotazniku podepsat.");

  // Podpis uz je ulozeny (dokument zamknuty) - dalsi podpis nie; original
  // dokonci samostatna akcia "complete".
  if (doc.locked_at) return json({ ok: true, saved: true, already: true, needs_completion: doc.status !== "SIGNED" });
  if (doc.status !== "READY_FOR_SIGNATURE") throw new HttpError(409, "Dokument neni pripraven k podpisu.");
  if (body.displayed_sha256 !== doc.final_pdf_sha256) throw new HttpError(409, "Zobrazeny dokument neodpovida finalni verzi - nactete ho prosim znovu.");
  // Podpis (meno, e-mail vo vyhlaseni) len k udajom, z ktorych PDF vzniklo.
  if ((await draftFingerprint(draft)) !== doc.variables_snapshot?.draft_sha256) {
    throw new HttpError(409, "Údaje dotazníku se od přípravy dokumentu změnily – načtěte dokumenty znovu.");
  }

  const pages = Number(doc.variables_snapshot?.pages || 0);
  const viewed = new Set((body.evidence?.pages_viewed || []).map(Number));
  if (!pages || Array.from({ length: pages }, (_, i) => i + 1).some((p) => !viewed.has(p))) {
    throw new HttpError(422, "Před podpisem je nutné zobrazit všechny strany dokumentu.");
  }
  const cfg = await config(service);
  const intent = cfg.texts[def.intentKey];
  if (!intent || body.intent_text_version_id !== intent.id) throw new HttpError(409, "Text prohlaseni byl zmenen - nactete dokument znovu.");

  const png = fromB64(String(body.signature_png_base64 || ""));
  const isPng = png.length > 8 && png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47;
  const strokes = Array.isArray(body.strokes) ? body.strokes : [];
  const points = strokes.reduce((n: number, s: unknown[]) => n + (Array.isArray(s) ? s.length : 0), 0);
  if (!isPng || png.length < 100 || png.length > MAX_PNG || points < 10) throw new HttpError(422, "Podpis chybí nebo je neplatný.");

  const imgId = `img-${crypto.randomUUID().replaceAll("-", "")}`;
  const { error: iErr } = await service.from("hr_signature_images").insert({ id: imgId, png: `\\x${hex(png)}`, png_sha256: "x", strokes });
  if (iErr) throw new HttpError(500, iErr.message);
  const ua = req.headers.get("user-agent") || "";
  const { error: sErr } = await service.from("hr_document_signatures").insert({
    id: `sig-${crypto.randomUUID().replaceAll("-", "")}`, hr_document_id: doc.id, method: "ELECTRONIC_TABLET", signer_type: "EMPLOYEE",
    signed_by_name: personName(draft), signed_content_sha256: doc.final_pdf_sha256, document_hash: doc.final_pdf_sha256,
    signature_image_id: imgId, intent_text_version_id: intent.id, intent_text_sha256: intent.body_sha256,
    identity_verification: { method: "KIOSK_SELF_DECLARED", label: "Totožnost při podpisu neověřena – ověří personální oddělení při kontrole dotazníku" },
    evidence: {
      channel: "KIOSK_TABLET", onboarding_session_id: session.id, all_pages_viewed: true, pages_total: pages,
      pages_viewed: [...viewed].sort((a, b) => a - b), viewed_at: body.evidence?.viewed_at || null,
      viewport: body.evidence?.viewport || null, stroke_count: strokes.length, point_count: points,
    },
    device_metadata: { user_agent: ua.slice(0, 300) },
  });
  if (sErr) throw new HttpError(409, sErr.message);

  if (def.declarationKind) {
    const { data: dup } = await service.from("employee_contact_declarations").select("id").eq("hr_document_id", doc.id).maybeSingle();
    if (!dup) {
      const { error: dErr } = await service.from("employee_contact_declarations").insert({
        id: `decl-${crypto.randomUUID().replaceAll("-", "")}`, kind: def.declarationKind, onboarding_session_id: session.id,
        email_snapshot: draftEmail(draft), declared_at: new Date().toISOString(), channel: "KIOSK_TABLET", hr_document_id: doc.id,
        notice_version_id: doc.variables_snapshot?.notice_version_id || doc.variables_snapshot?.text_version_id,
      });
      if (dErr) throw new HttpError(500, dErr.message);
    }
  }

  // Podpisany original v samostatnej poziadavke (limit CPU) - klient vola "complete".
  return json({ ok: true, saved: true, needs_completion: true });
}

// Podpisany original + SIGNED; idempotentne a bezpecne opakovatelne aj po
// strate spojenia (signed = ci je podpis ulozeny).
async function complete(service: SupabaseClient, body: any) {
  const session = await loadSession(service, body.session_token);
  const draft = session.draft_data || {};
  const { data: doc } = await service.from("hr_documents").select("*").eq("id", String(body.document_id || "")).maybeSingle();
  if (!doc || doc.onboarding_session_id !== session.id) throw new HttpError(404, "Dokument nenalezen.");
  if (!doc.locked_at) return json({ ok: true, signed: false, complete: false });
  if (doc.status === "SIGNED" && doc.signed_pdf_path) return json({ ok: true, signed: true, complete: true, already: true });
  const r = await createSignedOriginal(service, doc, { employeeName: personName(draft) });
  return json({ ok: true, signed: true, complete: true, signed_pdf_sha256: r.sha256 });
}

Deno.serve(handle(async (req) => {
  const body = await req.json().catch(() => ({}));
  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  if (body.action === "prepare") return prepare(service, body);
  if (body.action === "sign") return sign(service, body, req);
  if (body.action === "complete") return complete(service, body);
  throw new HttpError(400, "Neznama akce.");
}));
