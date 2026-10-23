// Odosielanie pisomnosti e-mailom (faza G). Jediny implementovany rezim je
// "mock" = lokalna testovacia schranka Mailpit v lokalnom Supabase stacku.
// Mimo lokalneho stacku (alebo pri inom email_mode) sa NIC neodosle -
// skutocny poskytovatel nie je nakonfigurovany (az po schvaleni, cez secrets).
// Texty e-mailov su KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { HttpError, download } from "./hrServer.ts";
import { sha256Hex } from "./pdfTextCheck.js";
import { DOC_TITLES } from "./signedOriginalServer.ts";

export const MAX_SEND_ATTEMPTS = 3;
const MAILPIT_SEND_URL = "http://inbucket:8025/api/v1/send"; // alias kontajnera v sieti lokalneho stacku
const FROM = { Email: "personalni@stenger.test", Name: "Stenger Czech – personální oddělení (TEST)" };

// Lokalny stack: Edge runtime vidi API ako http://kong:8000.
export const isLocalStack = () => Deno.env.get("SUPABASE_URL") === "http://kong:8000";

export async function mailTransport(service: SupabaseClient) {
  const { data } = await service.from("hr_settings").select("value").eq("key", "email_mode").maybeSingle();
  const mode = data?.value ?? "mock";
  if (mode === "mock" && isLocalStack()) return { mode: "mock", provider: "mailpit-local" };
  throw new HttpError(503, "Odesílání e-mailů není nakonfigurováno (zatím jen lokální testovací schránka). Předejte dokument osobně.");
}

const CZ = (iso: string) => String(iso).slice(0, 10).split("-").reverse().join(".");

export function composeEmail(channel: string, doc: Record<string, any>, sentAtIso: string) {
  const title = DOC_TITLES[doc.doc_type] || doc.doc_type;
  const common = "Dokument je v příloze ve formátu PDF – uložte si jej a případně vytiskněte.";
  const draft = "\n\n(Text: KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.)";
  if (channel === "EMAIL_S21") {
    return {
      subject: `${title} – vyhotovení smlouvy uzavřené elektronicky`,
      text: `Dobrý den,\n\nzasíláme Vám vyhotovení dokumentu „${title}“ uzavřeného elektronicky, na adresu, kterou jste nám k tomuto účelu písemně oznámil(a) (§ 21 zákoníku práce). ${common}\n\nOd smlouvy můžete písemně odstoupit do 7 dnů ode dne jejího dodání na tuto adresu, nejpozději však do doby, než začnete plnit.${draft}`,
    };
  }
  if (channel === "EMAIL_S335_CONSENT") {
    return {
      subject: `${title} – doručení písemnosti (§ 335 zákoníku práce)`,
      text: `Dobrý den,\n\nna základě Vašeho souhlasu s elektronickým doručováním Vám doručujeme písemnost „${title}“. ${common}\n\nProsíme, potvrďte převzetí odpovědí na tento e-mail. Nepotvrdíte-li převzetí do 15 dnů od dodání zprávy, považuje se písemnost za doručenou posledním dnem této lhůty.${draft}`,
    };
  }
  if (channel === "EMAIL_S335_WAGE_OTHER_ADDRESS") {
    return {
      subject: `${title} – prosíme o potvrzení převzetí`,
      text: `Dobrý den,\n\nzasíláme Vám mzdový výměr (odesláno ${CZ(sentAtIso)}). ${common}\n\nProsíme o písemné potvrzení převzetí (odpovědí na tento e-mail). Bez potvrzení do 15 dnů od odeslání je doručení neúčinné a výměr Vám předáme osobně.${draft}`,
    };
  }
  throw new HttpError(400, "Neznamy kanal.");
}

function b64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const asciiName = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_");

// Odosle zaznam v stave QUEUED; vysledok zapise (SENT / FAILED). Vrati riadok.
export async function sendQueuedDelivery(service: SupabaseClient, deliveryId: string) {
  const { data: dl } = await service.from("hr_document_deliveries").select("*").eq("id", deliveryId).single();
  if (!dl || dl.send_status !== "QUEUED") throw new HttpError(409, "Zásilka není připravena k odeslání.");
  const { data: doc } = await service.from("hr_documents").select("*").eq("id", dl.hr_document_id).single();
  const transport = await mailTransport(service);
  const now = new Date().toISOString();
  const fail = async (msg: string) => {
    const { data } = await service.from("hr_document_deliveries").update({
      send_status: "FAILED", send_error: msg.slice(0, 500), attempts: dl.attempts + 1, last_attempt_at: now, provider: transport.provider,
    }).eq("id", dl.id).select("*").single();
    return data;
  };
  let pdf: Uint8Array;
  try {
    pdf = await download(service, doc.signed_pdf_path);
  } catch {
    return await fail("Podepsaný originál nelze načíst.");
  }
  const pdfSha = await sha256Hex(pdf);
  if (pdfSha !== dl.delivered_document_sha256) return await fail("Podepsaný originál neodpovídá otisku zásilky.");
  const mail = composeEmail(dl.channel, doc, now);
  const attachment = `${asciiName(DOC_TITLES[doc.doc_type] || doc.doc_type)}_v${doc.version_no || 1}.pdf`;
  let messageId = "";
  try {
    // testovaci hacik (len mock): adresa @fail.invalid simuluje chybu poskytovatela
    if (/@fail\.invalid$/i.test(dl.recipient_snapshot)) throw new Error("Simulovaná chyba poskytovatele (testovací adresa).");
    const res = await fetch(MAILPIT_SEND_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        From: FROM, To: [{ Email: dl.recipient_snapshot }], Subject: `[TEST] ${mail.subject}`, Text: mail.text,
        Attachments: [{ Content: b64(pdf), Filename: attachment, ContentType: "application/pdf" }],
        Headers: { "X-Stenger-Delivery": dl.id },
      }),
    });
    if (!res.ok) throw new Error(`Mailpit ${res.status}: ${(await res.text()).slice(0, 200)}`);
    messageId = (await res.json())?.ID || "";
  } catch (e) {
    return await fail(e instanceof Error ? e.message : String(e));
  }
  const evidence = {
    ...(dl.confirmation_evidence || {}),
    email: { mode: transport.mode, provider: transport.provider, from: FROM.Email, subject: mail.subject,
      body_sha256: await sha256Hex(new TextEncoder().encode(mail.text)), attachment_name: attachment, attachment_sha256: pdfSha },
  };
  const { data, error } = await service.from("hr_document_deliveries").update({
    send_status: "SENT", sent_at: now, provider_message_id: messageId, attempts: dl.attempts + 1, last_attempt_at: now,
    provider: transport.provider, confirmation_evidence: evidence,
  }).eq("id", dl.id).select("*").single();
  if (error) throw new HttpError(500, error.message);
  return data;
}

// Vytvori zaznam QUEUED a hned odosle. DB triggre overia vyhlasenie,
// adresu, kanal, § 334 uznavany podpis s overenym certifikatom atd.
export async function queueAndSend(service: SupabaseClient, doc: Record<string, any>, p: {
  channel: string; recipient: string; declarationId?: string | null; actorId: string;
}) {
  await mailTransport(service); // bez nakonfigurovaneho odoslania ani nezalozime zaznam
  if (!["SIGNED", "ARCHIVED"].includes(doc.status) || !doc.signed_pdf_path || !doc.signed_pdf_sha256) {
    throw new HttpError(409, "Odeslat lze jen dokument podepsaný všemi stranami (podepsaný originál).");
  }
  const { data: open } = await service.from("hr_document_deliveries").select("id, send_status")
    .eq("hr_document_id", doc.id).eq("channel", p.channel).eq("recipient_snapshot", p.recipient.toLowerCase().trim())
    .is("ineffective_at", null).in("send_status", ["QUEUED", "SENT"]);
  if (open?.length) throw new HttpError(409, "Dokument už byl na tuto adresu tímto způsobem odeslán.");
  const id = crypto.randomUUID();
  const { error } = await service.from("hr_document_deliveries").insert({
    id, hr_document_id: doc.id, channel: p.channel, recipient_snapshot: p.recipient, declaration_id: p.declarationId || null,
    delivered_document_sha256: doc.signed_pdf_sha256, send_status: "QUEUED", attempts: 0, created_by: p.actorId,
  });
  if (error) throw new HttpError(409, error.message);
  return await sendQueuedDelivery(service, id);
}

export async function validDeclaration(service: SupabaseClient, employeeId: string, kind: "S21_ADDRESS_NOTICE" | "S335_CONSENT") {
  const { data: id } = await service.rpc("hr_valid_contact_declaration_server", { p_employee_id: employeeId, p_kind: kind });
  if (!id) return null;
  const { data } = await service.from("employee_contact_declarations").select("*").eq("id", id).single();
  return data;
}
