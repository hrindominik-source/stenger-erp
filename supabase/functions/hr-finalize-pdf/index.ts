// Edge Function: DOVERYHODNA finalizacia PDF na podpis (faza C).
// POST { document_id, pdf_path }  (Authorization: Bearer <JWT pouzivatela>)
//
// Server sam nacita PDF z uloziska, spocita SHA-256, vytiahne text a zopakuje
// kontrolu proti variables_snapshot (rovnake pravidlo ako klient, ale
// vysledok z prehliadaca sa nikdy nepouzije). Do DB zapise LEN uspesny
// vysledok - databaza (trigger hr_documents_finalize) finalne PDF od nikoho
// ineho neprijme.
import PizZip from "npm:pizzip@3.1.7";
import {
  checkPdfAgainstSnapshot, docxXmlToText, isPdfBytes, sha256Hex, documentFolder,
} from "../_shared/pdfTextCheck.js";
import { authorize, loadVisibleDocument, download, extractPdfPages, json, handle, HttpError, BUCKET } from "../_shared/hrServer.ts";

function docxText(bytes: Uint8Array) {
  const zip = new PizZip(bytes);
  return Object.keys(zip.files)
    .filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n))
    .sort()
    .map((n) => docxXmlToText(zip.file(n)!.asText()))
    .join("\n");
}

Deno.serve(handle(async (req) => {
  const { document_id, pdf_path } = await req.json().catch(() => ({}));
  if (!document_id || !pdf_path) throw new HttpError(400, "Chybi document_id nebo pdf_path.");
  const { user, userClient, service } = await authorize(req, ["HR_DOCUMENT_GENERATE"]);
  const doc = await loadVisibleDocument(userClient, service, document_id);

  if (doc.locked_at || ["SIGNED", "ARCHIVED", "VOIDED", "SUPERSEDED"].includes(doc.status)) {
    return json({ ok: false, check: { ok: false, reason: "DOCUMENT_LOCKED", checked_keys: [], missing_keys: [] } }, 409);
  }
  if (!String(pdf_path).startsWith(documentFolder(doc)) || !/\.pdf$/i.test(pdf_path) || pdf_path.includes("..")) {
    return json({ ok: false, check: { ok: false, reason: "PATH_MISMATCH", checked_keys: [], missing_keys: [] } }, 400);
  }

  const pdfBytes = await download(service, pdf_path);
  const sha256 = await sha256Hex(pdfBytes);
  let check;
  if (!isPdfBytes(pdfBytes)) {
    check = { ok: false, reason: "NOT_PDF", checked_keys: [], missing_keys: [] };
  } else {
    let pages: string[] = [];
    try {
      pages = await extractPdfPages(pdfBytes);
    } catch (_e) {
      check = { ok: false, reason: "UNREADABLE_PDF", checked_keys: [], missing_keys: [] };
    }
    if (!check) {
      const docxBytes = doc.file_path && /\.docx$/i.test(doc.file_path) ? await download(service, doc.file_path) : null;
      check = checkPdfAgainstSnapshot({
        pdfText: pages.join("\n"), pages: pages.length,
        docxText: docxBytes ? docxText(docxBytes) : null,
        snapshot: doc.variables_snapshot || {},
      });
    }
  }
  const serverCheck = { ...check, server_verified: true, checked_at: new Date().toISOString(), checked_by: user.id };

  if (!serverCheck.ok) {
    // Neuspech: nic sa nezapise, HR dostane nazvy chybajucich poli.
    return json({ ok: false, sha256, check: serverCheck }, 422);
  }

  const { error: updErr } = await service.from("hr_documents").update({
    final_pdf_path: pdf_path, final_pdf_sha256: sha256, final_pdf_text_check: serverCheck,
    finalized_at: new Date().toISOString(), finalized_by: user.id, updated_at: new Date().toISOString(),
  }).eq("id", doc.id);
  if (updErr) throw new HttpError(409, updErr.message);

  if (doc.employee_id) {
    await service.from("employee_timeline_events").insert({
      id: crypto.randomUUID(), employee_id: doc.employee_id, event_date: new Date().toISOString().slice(0, 10),
      event_type: "DOC_FINALIZED", title: "Finální PDF ověřeno serverem",
      description: `SHA-256 ${sha256.slice(0, 16)}…, zkontrolováno ${serverCheck.checked_keys.length} polí.`,
      related_entity_type: "hr_documents", related_entity_id: doc.id, source: "SYSTEM", created_by: user.id,
    });
  }
  return json({ ok: true, sha256, path: pdf_path, bucket: BUCKET, check: serverCheck });
}));
