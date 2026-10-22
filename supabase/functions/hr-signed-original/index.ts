// Edge Function: podpisany original (faza C) - vytvori ho a OVERI server.
// POST { document_id }  (Authorization: Bearer <JWT pouzivatela>)
//
// Podmienky: dokument je zamknuty, ma serverom overene finalne PDF a vsetky
// pozadovane elektronicke podpisy. Server:
//  - nacita finalne PDF z uloziska a overi jeho hash voci DB,
//  - zostavi original (strany finalneho PDF + dokazna strana) LEN z udajov v DB,
//  - overi, ze strany finalneho PDF su nezmenene a dokazna strana sedi s DB,
//  - sam spocita hash a zapise ho (DB prijme signed_pdf_* len od servera).
import { buildSignedOriginal, verifySignedOriginal } from "../_shared/signedOriginal.js";
import { normalizeForMatch, documentFolder } from "../_shared/pdfTextCheck.js";
import { authorize, loadVisibleDocument, download, extractPdfPages, json, handle, HttpError, BUCKET } from "../_shared/hrServer.ts";

const REQUIRED_SIGNERS: Record<string, string[]> = {
  BILATERAL_CONTRACT: ["EMPLOYEE", "EMPLOYER"],
  EMPLOYER_UNILATERAL: ["EMPLOYER"],
  EMPLOYEE_DECLARATION: ["EMPLOYEE"],
  RECEIPT_ACKNOWLEDGEMENT: ["EMPLOYEE"],
  TRAINING_RECORD: ["EMPLOYEE"],
};
const TITLES: Record<string, string> = {
  pracovni_smlouva: "Pracovní smlouva", pracovni_smlouva_cizinec: "Pracovní smlouva",
  platovy_vymer: "Mzdový výměr", mzdovy_vymer: "Mzdový výměr", popis_pracovniho_mista: "Náplň práce",
  vstupni_skoleni: "Záznam o vstupním školení", osobni_dotaznik: "Osobní dotazník",
};
const ELECTRONIC = ["ELECTRONIC_TABLET", "ELECTRONIC_QUALIFIED"];

function byteaToBytes(v: string): Uint8Array {
  const hex = v.startsWith("\\x") ? v.slice(2) : v;
  return Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
}

const fontUrl = (f: string) => new URL(`../_shared/fonts/${f}`, import.meta.url);

Deno.serve(handle(async (req) => {
  const { document_id } = await req.json().catch(() => ({}));
  if (!document_id) throw new HttpError(400, "Chybi document_id.");
  const { user, userClient, service } = await authorize(req, ["HR_DOCUMENT_SIGN"]);
  const doc = await loadVisibleDocument(userClient, service, document_id);

  if (doc.signed_pdf_path) return json({ ok: true, already: true, path: doc.signed_pdf_path, sha256: doc.signed_pdf_sha256 });
  if (!doc.locked_at || !doc.final_pdf_path || !doc.final_pdf_text_check?.server_verified || !doc.final_pdf_text_check?.ok) {
    throw new HttpError(409, "Dokument nema serverem overene finalni PDF nebo neni podepsany.");
  }
  if (["VOIDED", "SUPERSEDED"].includes(doc.status)) throw new HttpError(409, "Dokument je zneplatneny.");

  const { data: sigs, error: sErr } = await service.from("hr_document_signatures").select("*")
    .eq("hr_document_id", doc.id).order("signed_at", { ascending: true });
  if (sErr) throw new HttpError(500, sErr.message);
  const electronic = (sigs || []).filter((s) => ELECTRONIC.includes(s.method) && s.signed_content_sha256 === doc.final_pdf_sha256);
  const required = REQUIRED_SIGNERS[doc.legal_act_type] || ["EMPLOYEE"];
  const missing = required.filter((r) => !electronic.some((s) => s.signer_type === r));
  if (missing.length) throw new HttpError(409, `Chybi podpis: ${missing.join(", ")}.`);

  const imageIds = electronic.map((s) => s.signature_image_id).filter(Boolean);
  const textIds = electronic.map((s) => s.intent_text_version_id).filter(Boolean);
  const [{ data: images }, { data: texts }, { data: emp }] = await Promise.all([
    imageIds.length ? service.from("hr_signature_images").select("id, png").in("id", imageIds) : Promise.resolve({ data: [] }),
    textIds.length ? service.from("hr_legal_text_versions").select("id, version_no, body").in("id", textIds) : Promise.resolve({ data: [] }),
    doc.employee_id ? service.from("employees").select("first_name, last_name, title").eq("id", doc.employee_id).single() : Promise.resolve({ data: null }),
  ]);
  const imgById = new Map((images || []).map((i: { id: string; png: string }) => [i.id, byteaToBytes(i.png)]));
  const textById = new Map((texts || []).map((t: { id: string; version_no: number; body: string }) => [t.id, t]));

  const signatures = electronic.map((s) => {
    const t = textById.get(s.intent_text_version_id);
    const iv = s.identity_verification || {};
    return {
      signer_type: s.signer_type, signed_by_name: s.signed_by_name, signed_at: s.signed_at, method: s.method,
      intent_text: t?.body, intent_text_version: t?.version_no, intent_text_sha256: s.intent_text_sha256,
      identity_verification_label: iv.method ? `${iv.method}${iv.verified_by_name ? `, ověřil(a) ${iv.verified_by_name}` : ""}` : null,
      evidence_sha256: s.evidence_sha256, signature_png: imgById.get(s.signature_image_id) || null,
    };
  });

  const finalBytes = await download(service, doc.final_pdf_path);
  const [font, bold] = await Promise.all([Deno.readFile(fontUrl("DejaVuSans.ttf")), Deno.readFile(fontUrl("DejaVuSans-Bold.ttf"))]);
  const employeeName = emp ? [emp.title, emp.first_name, emp.last_name].filter(Boolean).join(" ") : "—";
  const built = await buildSignedOriginal({
    originalPdfBytes: finalBytes, expectedSha256: doc.final_pdf_sha256, fontBytes: font, boldFontBytes: bold,
    document: { id: doc.id, title: TITLES[doc.doc_type] || doc.doc_type, employeeName },
    signatures, createdAt: new Date().toISOString(),
  });

  const verification = await verifySignedOriginal({
    signedBytes: built.bytes, finalBytes, finalSha256: doc.final_pdf_sha256, signatures,
    extractPages: extractPdfPages, normalize: normalizeForMatch,
  });
  if (!verification.ok) throw new HttpError(500, `Overeni podepsaneho originalu selhalo: ${verification.problems.join(", ")}`);

  const path = `${documentFolder(doc)}podepsany-original-${built.sha256.slice(0, 16)}.pdf`;
  const { error: upErr } = await service.storage.from(BUCKET)
    .upload(path, new Blob([built.bytes], { type: "application/pdf" }), { contentType: "application/pdf", upsert: false });
  if (upErr) throw new HttpError(500, upErr.message);
  const { error: updErr } = await service.from("hr_documents").update({
    signed_pdf_path: path, signed_pdf_sha256: built.sha256, status: "SIGNED", updated_at: new Date().toISOString(),
  }).eq("id", doc.id);
  if (updErr) throw new HttpError(409, updErr.message);

  if (doc.employee_id) {
    await service.from("employee_timeline_events").insert({
      id: crypto.randomUUID(), employee_id: doc.employee_id, event_date: new Date().toISOString().slice(0, 10),
      event_type: "SIGNED", title: `Podepsaný originál: ${TITLES[doc.doc_type] || doc.doc_type}`,
      description: `SHA-256 ${built.sha256.slice(0, 16)}… (ověřeno serverem)`,
      related_entity_type: "hr_documents", related_entity_id: doc.id, source: "SYSTEM", created_by: user.id,
    });
  }
  return json({ ok: true, path, sha256: built.sha256, pages: built.totalPages });
}));
