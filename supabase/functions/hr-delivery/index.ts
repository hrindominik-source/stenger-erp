// Edge Function: predanie / dorucenie pisomnosti zamestnancovi.
//
// { action: "in_person", document_id, delivered_date, receipt, scan_base64?, note? }
//   Osobne predanie podpisaneho vyhotovenia. Sken potvrdenia o prevzati
//   nahra a zahashuje SERVER (hodnota z prehliadaca sa neberie do uvahy),
//   ulozi ho do prevzeti/<dokument>/ a zapise zaznam predania.
import {
  json, handle, HttpError, authorize, loadVisibleDocument, BUCKET, scanType, MAX_SCAN_BYTES, fromBase64,
} from "../_shared/hrServer.ts";
import { sha256Hex } from "../_shared/pdfTextCheck.js";

async function inPerson(req: Request, body: any) {
  const { user, userClient, service } = await authorize(req, ["HR_DOCUMENT_SEND"]);
  const doc = await loadVisibleDocument(userClient, service, String(body.document_id || ""));
  const date = String(body.delivered_date || "");
  const todayIso = new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayIso) throw new HttpError(422, "Zadejte datum předání (nejpozději dnes).");
  const receipt = body.receipt === true;
  const id = crypto.randomUUID();
  let scanPath: string | null = null;
  let scanSha: string | null = null;
  if (receipt) {
    const bytes = fromBase64(String(body.scan_base64 || ""));
    if (!bytes.length) throw new HttpError(422, "Nahrajte sken podepsaného potvrzení o převzetí.");
    if (bytes.length > MAX_SCAN_BYTES) throw new HttpError(413, "Sken je příliš velký (max. 15 MB).");
    const type = scanType(bytes);
    if (!type) throw new HttpError(422, "Sken musí být PDF, PNG nebo JPG.");
    scanSha = await sha256Hex(bytes);
    scanPath = `prevzeti/${doc.id}/${id}-${scanSha.slice(0, 16)}.${type.ext}`;
    const { error: upErr } = await service.storage.from(BUCKET).upload(scanPath, new Blob([bytes], { type: type.mime }), { contentType: type.mime, upsert: false });
    if (upErr) throw new HttpError(409, upErr.message);
  }
  const note = String(body.note || "").trim() || null;
  const { data: row, error } = await service.from("hr_document_deliveries").insert({
    id, hr_document_id: doc.id, channel: "IN_PERSON_PAPER",
    delivered_at: date === todayIso ? new Date().toISOString() : `${date}T12:00:00Z`,
    delivery_basis: receipt ? "SIGNED_RECEIPT" : "HANDED_OVER",
    receipt_scan_path: scanPath, receipt_scan_sha256: scanSha,
    handed_over_by: user.id, created_by: user.id,
    confirmation_evidence: receipt || note ? { receipt: receipt ? "PAPER_SCAN" : null, receipt_scan_hashed_by: receipt ? "server" : null, note } : null,
  }).select("*").single();
  if (error) {
    if (scanPath) await service.storage.from(BUCKET).remove([scanPath]); // nezapisane predanie = ziadny osirely sken
    throw new HttpError(409, error.message);
  }
  return json({ ok: true, delivery: row });
}

Deno.serve(handle(async (req) => {
  const body = await req.json().catch(() => ({}));
  switch (body.action) {
    case "in_person": return inPerson(req, body);
    default: throw new HttpError(400, "Neznama akce.");
  }
}));
