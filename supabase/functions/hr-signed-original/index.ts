// Edge Function: podpisany original (faza C) - vytvori ho a OVERI server.
// POST { document_id }  (Authorization: Bearer <JWT pouzivatela>)
//
// Podmienky: dokument je zamknuty, ma serverom overene finalne PDF a vsetky
// pozadovane elektronicke podpisy. Server (_shared/signedOriginalServer.ts):
//  - nacita finalne PDF z uloziska a overi jeho hash voci DB,
//  - zostavi original (strany finalneho PDF + dokazna strana) LEN z udajov v DB,
//  - overi, ze strany finalneho PDF su nezmenene a dokazna strana sedi s DB,
//  - sam spocita hash a zapise ho (DB prijme signed_pdf_* len od servera).
import { authorize, loadVisibleDocument, json, handle, HttpError } from "../_shared/hrServer.ts";
import { createSignedOriginal } from "../_shared/signedOriginalServer.ts";

Deno.serve(handle(async (req) => {
  const { document_id } = await req.json().catch(() => ({}));
  if (!document_id) throw new HttpError(400, "Chybi document_id.");
  const { user, userClient, service } = await authorize(req, ["HR_DOCUMENT_SIGN"]);
  const doc = await loadVisibleDocument(userClient, service, document_id);

  const r = await createSignedOriginal(service, doc);
  if (r.already) return json({ ok: true, already: true, path: r.path, sha256: r.sha256 });

  if (doc.employee_id) {
    await service.from("employee_timeline_events").insert({
      id: crypto.randomUUID(), employee_id: doc.employee_id, event_date: new Date().toISOString().slice(0, 10),
      event_type: "SIGNED", title: `Podepsaný originál: ${r.title}`,
      description: `SHA-256 ${r.sha256.slice(0, 16)}… (ověřeno serverem)`,
      related_entity_type: "hr_documents", related_entity_id: doc.id, source: "SYSTEM", created_by: user.id,
    });
  }
  return json({ ok: true, path: r.path, sha256: r.sha256, pages: r.pages });
}));
