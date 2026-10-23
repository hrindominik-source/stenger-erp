// Edge Function: predanie / dorucenie pisomnosti zamestnancovi.
//
// HR (prihlaseny, HR_DOCUMENT_SEND):
// { action: "in_person", document_id, delivered_date, receipt, scan_base64?, note? }
//   Osobne predanie podpisaneho vyhotovenia. Sken potvrdenia o prevzati
//   nahra a zahashuje SERVER (hodnota z prehliadaca sa neberie do uvahy),
//   ulozi ho do prevzeti/<dokument>/ a zapise zaznam predania.
// { action: "send_email", document_id, channel, recipient? }      (faza G)
//   EMAIL_S21 / EMAIL_S335_CONSENT: adresa z platneho vyhlasenia pre aktualny
//   private_email; EMAIL_S335_WAGE_OTHER_ADDRESS: adresa zadana HR.
//   Lokalne len do testovacej schranky Mailpit.
// { action: "retry", delivery_id }                 zlyhane odoslanie (max. 3 pokusy)
// { action: "confirm_receipt", delivery_id, confirmed_date, scan_base64 }
//   pisomne potvrdenie prevzatia od zamestnanca (sken / PDF odpovede)
// { action: "record_withdrawal", delivery_id, received_date, scan_base64 }
//   pisomne odstupenie od zmluvy (§ 21 odst. 2)
// { action: "sweep" }                              vyhodnotenie lehot
// Server / poskytovatel (Authorization = service role):
// { action: "provider_event", delivery_id, event: "DELIVERED" | "BOUNCED", at? }
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  json, handle, HttpError, authorize, loadVisibleDocument, BUCKET, scanType, MAX_SCAN_BYTES, fromBase64,
} from "../_shared/hrServer.ts";
import { sha256Hex } from "../_shared/pdfTextCheck.js";
import { defaultLegalActType, isS334Document } from "../_shared/signingRules.js";
import { queueAndSend, sendQueuedDelivery, validDeclaration, MAX_SEND_ATTEMPTS } from "../_shared/hrMail.ts";

const todayIso = () => new Date().toISOString().slice(0, 10);
const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

// Sken (PDF/PNG/JPG) do prevzeti/<dokument>/ - otisk pocita server.
async function storeScan(service: any, docId: string, prefix: string, base64: unknown) {
  const bytes = fromBase64(String(base64 || ""));
  if (!bytes.length) throw new HttpError(422, "Nahrajte sken (PDF, PNG nebo JPG).");
  if (bytes.length > MAX_SCAN_BYTES) throw new HttpError(413, "Sken je příliš velký (max. 15 MB).");
  const type = scanType(bytes);
  if (!type) throw new HttpError(422, "Sken musí být PDF, PNG nebo JPG.");
  const sha = await sha256Hex(bytes);
  const path = `prevzeti/${docId}/${prefix}-${sha.slice(0, 16)}.${type.ext}`;
  const { error } = await service.storage.from(BUCKET).upload(path, new Blob([bytes], { type: type.mime }), { contentType: type.mime, upsert: false });
  if (error) throw new HttpError(409, error.message);
  return { path, sha };
}

async function inPerson(req: Request, body: any) {
  const { user, userClient, service } = await authorize(req, ["HR_DOCUMENT_SEND"]);
  const doc = await loadVisibleDocument(userClient, service, String(body.document_id || ""));
  const date = String(body.delivered_date || "");
  const today = todayIso();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) throw new HttpError(422, "Zadejte datum předání (nejpozději dnes).");
  const receipt = body.receipt === true;
  const id = crypto.randomUUID();
  let scan: { path: string; sha: string } | null = null;
  if (receipt) scan = await storeScan(service, doc.id, id, body.scan_base64);
  const note = String(body.note || "").trim() || null;
  const { data: row, error } = await service.from("hr_document_deliveries").insert({
    id, hr_document_id: doc.id, channel: "IN_PERSON_PAPER",
    delivered_at: date === today ? new Date().toISOString() : `${date}T12:00:00Z`,
    delivery_basis: receipt ? "SIGNED_RECEIPT" : "HANDED_OVER",
    receipt_scan_path: scan?.path || null, receipt_scan_sha256: scan?.sha || null,
    handed_over_by: user.id, created_by: user.id,
    confirmation_evidence: receipt || note ? { receipt: receipt ? "PAPER_SCAN" : null, receipt_scan_hashed_by: receipt ? "server" : null, note } : null,
  }).select("*").single();
  if (error) {
    if (scan) await service.storage.from(BUCKET).remove([scan.path]); // nezapisane predanie = ziadny osirely sken
    throw new HttpError(409, error.message);
  }
  return json({ ok: true, delivery: row });
}

// ---------- faza G: e-mail ----------
async function sendEmail(req: Request, body: any) {
  const { user, userClient, service } = await authorize(req, ["HR_DOCUMENT_SEND"]);
  const doc = await loadVisibleDocument(userClient, service, String(body.document_id || ""));
  const channel = String(body.channel || "");
  const legal = doc.legal_act_type || defaultLegalActType(doc.doc_type);
  let recipient = "";
  let declarationId: string | null = null;
  if (channel === "EMAIL_S21") {
    if (legal !== "BILATERAL_CONTRACT") throw new HttpError(409, "Zaslání podle § 21 je jen pro smlouvy.");
    const d = await validDeclaration(service, doc.employee_id, "S21_ADDRESS_NOTICE");
    if (!d) throw new HttpError(409, "Chybí platné oznámení e-mailové adresy podle § 21 pro aktuální e-mail zaměstnance – předejte vyhotovení osobně.");
    recipient = d.email_snapshot; declarationId = d.id;
  } else if (channel === "EMAIL_S335_CONSENT") {
    if (!isS334Document(doc)) throw new HttpError(409, "Doručení se souhlasem podle § 335 je pro písemnosti § 334.");
    const d = await validDeclaration(service, doc.employee_id, "S335_CONSENT");
    if (!d) throw new HttpError(409, "Chybí platný a neodvolaný souhlas s elektronickým doručováním (§ 335) pro aktuální e-mail zaměstnance.");
    recipient = d.email_snapshot; declarationId = d.id;
  } else if (channel === "EMAIL_S335_WAGE_OTHER_ADDRESS") {
    recipient = String(body.recipient || "").trim().toLowerCase();
    if (!isEmail(recipient)) throw new HttpError(422, "Zadejte e-mailovou adresu.");
  } else {
    throw new HttpError(400, "Neznámý způsob doručení.");
  }
  const row = await queueAndSend(service, doc, { channel, recipient, declarationId, actorId: user.id });
  return json({ ok: true, delivery: row });
}

async function loadDelivery(req: Request, body: any) {
  const { user, userClient, service } = await authorize(req, ["HR_DOCUMENT_SEND"]);
  const { data: dl } = await service.from("hr_document_deliveries").select("*").eq("id", String(body.delivery_id || "")).maybeSingle();
  if (!dl) throw new HttpError(404, "Záznam o doručení nenalezen.");
  const doc = await loadVisibleDocument(userClient, service, dl.hr_document_id);
  return { user, service, dl, doc };
}

async function retry(req: Request, body: any) {
  const { service, dl, doc } = await loadDelivery(req, body);
  if (dl.send_status !== "FAILED") throw new HttpError(409, "Opakovat lze jen neúspěšné odeslání.");
  if (dl.attempts >= MAX_SEND_ATTEMPTS) throw new HttpError(409, "Vyčerpány pokusy o odeslání – předejte dokument osobně.");
  if (dl.ineffective_at) throw new HttpError(409, "Doručení je neúčinné – předejte dokument osobně.");
  // po zmene e-mailu / odvolani sa na staru adresu automaticky neposiela
  if (dl.channel === "EMAIL_S21" || dl.channel === "EMAIL_S335_CONSENT") {
    const d = await validDeclaration(service, doc.employee_id, dl.channel === "EMAIL_S21" ? "S21_ADDRESS_NOTICE" : "S335_CONSENT");
    if (!d || d.id !== dl.declaration_id) {
      throw new HttpError(409, "Vyhlášení k této adrese už neplatí (změna e-mailu nebo odvolání) – zásilku nelze opakovat, rozhodněte o dalším postupu.");
    }
  }
  const { error } = await service.from("hr_document_deliveries").update({ send_status: "QUEUED" }).eq("id", dl.id).eq("send_status", "FAILED");
  if (error) throw new HttpError(409, error.message);
  return json({ ok: true, delivery: await sendQueuedDelivery(service, dl.id) });
}

async function confirmReceipt(req: Request, body: any) {
  const { user, service, dl } = await loadDelivery(req, body);
  if (!dl.channel.startsWith("EMAIL")) throw new HttpError(409, "Potvrzení převzetí e-mailem jen u e-mailové zásilky.");
  if (dl.send_status !== "SENT" || dl.delivered_at || dl.ineffective_at) throw new HttpError(409, "Zásilka není odeslaná a otevřená.");
  const date = String(body.confirmed_date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayIso() || date < String(dl.sent_at).slice(0, 10)) {
    throw new HttpError(422, "Datum potvrzení musí být mezi odesláním a dneškem.");
  }
  const scan = await storeScan(service, dl.hr_document_id, `${dl.id}-potvrzeni`, body.scan_base64);
  const { data, error } = await service.from("hr_document_deliveries").update({
    delivered_at: date === todayIso() ? new Date().toISOString() : `${date}T12:00:00Z`, delivery_basis: "EMPLOYEE_CONFIRMATION",
    receipt_scan_path: scan.path, receipt_scan_sha256: scan.sha, handed_over_by: user.id,
    confirmation_evidence: { ...(dl.confirmation_evidence || {}), confirmation: { recorded_by: user.id, receipt_scan_hashed_by: "server" } },
  }).eq("id", dl.id).select("*").single();
  if (error) {
    await service.storage.from(BUCKET).remove([scan.path]);
    throw new HttpError(409, error.message);
  }
  return json({ ok: true, delivery: data });
}

async function recordWithdrawal(req: Request, body: any) {
  const { user, service, dl } = await loadDelivery(req, body);
  if (dl.channel !== "EMAIL_S21") throw new HttpError(409, "Odstoupení jen u smlouvy zaslané podle § 21.");
  if (dl.withdrawal_received_at) throw new HttpError(409, "Odstoupení už je zaznamenáno.");
  const date = String(body.received_date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayIso()) throw new HttpError(422, "Zadejte datum doručení odstoupení (nejpozději dnes).");
  const scan = await storeScan(service, dl.hr_document_id, `${dl.id}-odstoupeni`, body.scan_base64);
  const { data, error } = await service.from("hr_document_deliveries").update({
    withdrawal_received_at: date === todayIso() ? new Date().toISOString() : `${date}T12:00:00Z`,
    withdrawal_scan_path: scan.path, withdrawal_scan_sha256: scan.sha,
    confirmation_evidence: { ...(dl.confirmation_evidence || {}), withdrawal: { recorded_by: user.id, scan_hashed_by: "server" } },
  }).eq("id", dl.id).select("*").single();
  if (error) {
    await service.storage.from(BUCKET).remove([scan.path]);
    throw new HttpError(409, error.message);
  }
  return json({ ok: true, delivery: data });
}

// Udalost od poskytovatela (doklad o dodani / nedorucitelnost). Len server.
async function providerEvent(req: Request, body: any) {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if ((req.headers.get("Authorization") || "") !== `Bearer ${key}`) throw new HttpError(403, "Jen pro server.");
  const service = createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false } });
  const { data: dl } = await service.from("hr_document_deliveries").select("*").eq("id", String(body.delivery_id || "")).maybeSingle();
  if (!dl) throw new HttpError(404, "Záznam o doručení nenalezen.");
  const at = body.at ? new Date(String(body.at)).toISOString() : new Date().toISOString();
  let patch: Record<string, unknown>;
  if (body.event === "DELIVERED") {
    patch = { provider_delivered_at: at };
    if (dl.channel === "EMAIL_S21") Object.assign(patch, { delivered_at: at, delivery_basis: "PROVIDER_DELIVERED_S21" });
  } else if (body.event === "BOUNCED") {
    patch = { send_status: "BOUNCED", send_error: String(body.reason || "Nedoručitelná zpráva").slice(0, 500) };
  } else {
    throw new HttpError(400, "Neznámá událost.");
  }
  const { data, error } = await service.from("hr_document_deliveries").update(patch).eq("id", dl.id).select("*").single();
  if (error) throw new HttpError(409, error.message);
  return json({ ok: true, delivery: data });
}

async function sweep(req: Request) {
  const { service } = await authorize(req, ["HR_VIEW_BASIC"]);
  const { data, error } = await service.rpc("hr_document_deliveries_sweep");
  if (error) throw new HttpError(500, error.message);
  return json({ ok: true, changed: data });
}

Deno.serve(handle(async (req) => {
  const body = await req.json().catch(() => ({}));
  switch (body.action) {
    case "in_person": return inPerson(req, body);
    case "send_email": return sendEmail(req, body);
    case "retry": return retry(req, body);
    case "confirm_receipt": return confirmReceipt(req, body);
    case "record_withdrawal": return recordWithdrawal(req, body);
    case "provider_event": return providerEvent(req, body);
    case "sweep": return sweep(req);
    default: throw new HttpError(400, "Neznama akce.");
  }
}));
