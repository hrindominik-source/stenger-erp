// Integracny test fazy G: dorucovanie e-mailom (Edge Function hr-delivery,
// lokalny Mailpit). Proti LOKALNEMU Supabase, vymyslene udaje. Ziadny
// skutocny e-mail - adresy @example.test idu len do lokalnej schranky.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import { sha256Hex } from "../../../supabase/functions/_shared/pdfTextCheck.js";

const URL_ = process.env.LOCAL_SUPABASE_URL;
const ANON = process.env.LOCAL_SUPABASE_ANON_KEY;
const SERVICE = process.env.LOCAL_SUPABASE_SERVICE_KEY;
const enabled = !!(URL_ && ANON && SERVICE && /^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_ || ""));
const root = path.resolve(__dirname, "../../..");
const MAILPIT = "http://127.0.0.1:54324";
const BUCKET = "hr-dokumenty";
const enc = (s) => new TextEncoder().encode(s);
const b64 = (u8) => Buffer.from(u8).toString("base64");
const SCAN = enc("%PDF-1.4\n% pisemne potvrzeni / odstoupeni (test)\n%%EOF\n");
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

describe.skipIf(!enabled)("faza G - dorucovanie e-mailom (lokalny Mailpit)", { timeout: 120000 }, () => {
  let service, hr;
  const run = Date.now().toString(36);
  const empId = `emp-g-${run}`;
  const email = `gustav.${run}@example.test`;
  let pdfBytes;

  async function call(client, body) {
    const { data, error } = await client.functions.invoke("hr-delivery", { body });
    if (data) return { status: 200, ...data };
    return { status: error.context.status, ...(await error.context.json()) };
  }
  const hrCall = (body) => call(hr, body);
  const provider = (body) => call(service, { action: "provider_event", ...body });
  const dl = async (id) => (await service.from("hr_document_deliveries").select("*").eq("id", id).single()).data;
  const mails = async (to) => (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json()).messages || [];

  // Podpisany dokument s originalom v ulozisku. Mzdovy vymer: uznavany podpis
  // zamestnavatela + (volitelne) overeny certifikat; zmluva: papier oboch stran.
  async function signedDoc(suffix, docType, { verified = true } = {}) {
    const id = `doc-g-${run}-${suffix}`;
    const sha = await sha256Hex(pdfBytes);
    const signedPath = `zamestnanci/${empId}/${id}/podepsany-${sha.slice(0, 16)}.pdf`;
    await service.storage.from(BUCKET).upload(signedPath, new Blob([pdfBytes], { type: "application/pdf" }), { contentType: "application/pdf", upsert: true });
    const ins = await service.from("hr_documents").insert({ id, employee_id: empId, doc_type: docType, origin: "GENERATED", status: "READY_FOR_SIGNATURE",
      final_pdf_path: signedPath, final_pdf_sha256: sha, final_pdf_text_check: { ok: true, server_verified: true }, finalized_at: new Date().toISOString() });
    if (ins.error) throw ins.error;
    if (docType === "mzdovy_vymer") {
      const s = await service.from("hr_document_signatures").insert({ id: `q-${id}`, hr_document_id: id, method: "ELECTRONIC_QUALIFIED", signer_type: "EMPLOYER",
        signed_by_name: "Ing. Petr Vzorový", signed_content_sha256: sha, document_hash: sha, file_path: signedPath });
      if (s.error) throw s.error;
      if (verified) await service.from("hr_signature_verifications").insert({ signature_id: `q-${id}`, result: "VALID", method: "AUTOMATIC", service_name: "it-test" });
    } else {
      for (const who of ["EMPLOYEE", "EMPLOYER"]) {
        const s = await service.from("hr_document_signatures").insert({ id: `p-${who}-${id}`, hr_document_id: id, method: "PAPER", signer_type: who,
          signed_by_name: who, document_hash: "c".repeat(64), file_path: `zamestnanci/${empId}/${id}/sken.pdf` });
        if (s.error) throw s.error;
      }
    }
    const up = await service.from("hr_documents").update({ status: "SIGNED", signed_pdf_path: signedPath, signed_pdf_sha256: sha }).eq("id", id);
    if (up.error) throw up.error;
    return id;
  }

  beforeAll(async () => {
    service = createClient(URL_, SERVICE, { auth: { persistSession: false } });
    const seed = fs.readFileSync(path.join(root, "supabase/seed.sql"), "utf8");
    const [, login, password] = seed.match(/(personalista@test\.local) \/ (\S+)/);
    hr = createClient(URL_, ANON, { auth: { persistSession: false } });
    if ((await hr.auth.signInWithPassword({ email: login, password })).error) throw new Error("login");
    await service.from("employees").insert({ id: empId, first_name: "Gustav", last_name: "Doručovací", record_flag: "TEST", private_email: email });
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdfBytes = await pdf.save();
  });

  it("§ 21: bez oznamenia sa neposiela; s oznamenim odoslane != dodane; doklad o dodani spusti 7-dnovu lehotu; odstupenie", async () => {
    const id = await signedDoc("ps", "pracovni_smlouva");
    let r = await hrCall({ action: "send_email", document_id: id, channel: "EMAIL_S21" });
    expect(r.status).toBe(409);
    expect(r.error).toMatch(/§ 21/);
    await service.from("employee_contact_declarations").insert({ id: `d21-${run}`, kind: "S21_ADDRESS_NOTICE", employee_id: empId,
      email_snapshot: email, declared_at: new Date().toISOString(), channel: "TABLET_HR" });
    r = await hrCall({ action: "send_email", document_id: id, channel: "EMAIL_S21" });
    expect(r.delivery).toMatchObject({ channel: "EMAIL_S21", send_status: "SENT", recipient_snapshot: email, delivered_at: null, attempts: 1 });
    expect(r.delivery.confirmation_evidence.email.attachment_sha256).toBe(await sha256Hex(pdfBytes));
    const m = await mails(email);
    expect(m.length).toBeGreaterThan(0);
    expect(m[0].Subject).toMatch(/^\[TEST\]/);
    expect((await hrCall({ action: "send_email", document_id: id, channel: "EMAIL_S21" })).status).toBe(409); // duplicitne nie

    // HR nemoze zaznamenat dodanie/odstupenie priamo
    const { error: direct } = await hr.from("hr_document_deliveries").update({ delivered_at: new Date().toISOString(), delivery_basis: "PROVIDER_DELIVERED_S21" }).eq("id", r.delivery.id);
    expect(direct?.message || "").toMatch(/server/);
    expect((await call(hr, { action: "provider_event", delivery_id: r.delivery.id, event: "DELIVERED" })).status).toBe(403);

    const at = daysAgo(2);
    const d = await provider({ delivery_id: r.delivery.id, event: "DELIVERED", at });
    expect(d.delivery).toMatchObject({ delivery_basis: "PROVIDER_DELIVERED_S21" });
    const deadline = new Date(new Date(at).getTime() + 7 * 86400000).toISOString().slice(0, 10);
    expect(d.delivery.withdrawal_deadline).toBe(deadline);

    expect((await hrCall({ action: "record_withdrawal", delivery_id: r.delivery.id, received_date: new Date().toISOString().slice(0, 10) })).status).toBe(422); // bez skenu
    const w = await hrCall({ action: "record_withdrawal", delivery_id: r.delivery.id, received_date: new Date().toISOString().slice(0, 10), scan_base64: b64(SCAN) });
    expect(w.delivery.withdrawal_scan_sha256).toBe(await sha256Hex(SCAN));
    expect((await hrCall({ action: "record_withdrawal", delivery_id: r.delivery.id, received_date: new Date().toISOString().slice(0, 10), scan_base64: b64(SCAN) })).status).toBe(409);
  });

  it("§ 21: odstupenie po lehote odmietnute", async () => {
    const id = await signedDoc("ps2", "pracovni_smlouva");
    const r = await hrCall({ action: "send_email", document_id: id, channel: "EMAIL_S21" });
    await provider({ delivery_id: r.delivery.id, event: "DELIVERED", at: daysAgo(10) });
    const w = await hrCall({ action: "record_withdrawal", delivery_id: r.delivery.id, received_date: new Date().toISOString().slice(0, 10), scan_base64: b64(SCAN) });
    expect(w.status).toBe(409);
    expect(w.error).toMatch(/po lhute/);
  });

  it("mzdovy vymer na inu adresu: bez overeneho podpisu nie; bez potvrdenia do 15 dni od odoslania = neucinne (sweep)", async () => {
    const un = await signedDoc("mv0", "mzdovy_vymer", { verified: false });
    const r0 = await hrCall({ action: "send_email", document_id: un, channel: "EMAIL_S335_WAGE_OTHER_ADDRESS", recipient: `jina.${run}@example.test` });
    expect(r0.status).toBe(409);
    expect(r0.error).toMatch(/overenym certifikatem/);

    const id = await signedDoc("mv", "mzdovy_vymer");
    const r = await hrCall({ action: "send_email", document_id: id, channel: "EMAIL_S335_WAGE_OTHER_ADDRESS", recipient: `jina.${run}@example.test` });
    expect(r.delivery).toMatchObject({ send_status: "SENT", delivered_at: null });
    expect((await provider({ delivery_id: r.delivery.id, event: "DELIVERED" })).delivery.delivered_at).toBeNull(); // dodanie != dorucenie

    // zaznam odoslany pred 16 dnami (server) -> sweep ho oznaci ako neucinny
    const oldId = crypto.randomUUID();
    await service.from("hr_document_deliveries").insert({ id: oldId, hr_document_id: id, channel: "EMAIL_S335_WAGE_OTHER_ADDRESS",
      recipient_snapshot: `stara.${run}@example.test`, delivered_document_sha256: await sha256Hex(pdfBytes), send_status: "QUEUED" });
    await service.from("hr_document_deliveries").update({ send_status: "SENT", sent_at: daysAgo(16), attempts: 1 }).eq("id", oldId);
    const sw = await hrCall({ action: "sweep" });
    expect(sw.changed).toBeGreaterThanOrEqual(1);
    const old = await dl(oldId);
    expect(old.ineffective_at).toBeTruthy();
    expect(old.ineffective_reason).toMatch(/§ 335 odst. 3/);
    expect((await dl(r.delivery.id)).ineffective_at).toBeNull(); // cerstvy este plati

    // potvrdenie prevzatia: len so skenom, server hash
    expect((await hrCall({ action: "confirm_receipt", delivery_id: r.delivery.id, confirmed_date: new Date().toISOString().slice(0, 10) })).status).toBe(422);
    const c = await hrCall({ action: "confirm_receipt", delivery_id: r.delivery.id, confirmed_date: new Date().toISOString().slice(0, 10), scan_base64: b64(SCAN) });
    expect(c.delivery).toMatchObject({ delivery_basis: "EMPLOYEE_CONFIRMATION", receipt_scan_sha256: await sha256Hex(SCAN) });
  });

  it("mzdovy vymer: potvrdenie prevzatia ako odpoved e-mailom (.eml) - server hash, nemenne, citatelne len s pravami k dokumentu", async () => {
    const id = await signedDoc("mveml", "mzdovy_vymer");
    const r = await hrCall({ action: "send_email", document_id: id, channel: "EMAIL_S335_WAGE_OTHER_ADDRESS", recipient: `eml.${run}@example.test` });
    const today = new Date().toISOString().slice(0, 10);
    const junk = enc("toto nie je e-mail ani sken");
    const bad = await hrCall({ action: "confirm_receipt", delivery_id: r.delivery.id, confirmed_date: today, scan_base64: b64(junk) });
    expect(bad.status).toBe(422);
    expect(bad.error).toMatch(/\.eml/);
    const eml = enc([`From: Gustav <eml.${run}@example.test>`, "To: personalni@stenger.test", "Date: Fri, 23 Oct 2026 10:00:00 +0200",
      "Subject: Re: Mzdovy vymer", "Content-Type: text/plain; charset=utf-8", "", "Potvrzuji prevzeti mzdoveho vymeru.", ""].join("\r\n"));
    const c = await hrCall({ action: "confirm_receipt", delivery_id: r.delivery.id, confirmed_date: today, scan_base64: b64(eml), receipt_sha256: "f".repeat(64) });
    expect(c.delivery).toMatchObject({ delivery_basis: "EMPLOYEE_CONFIRMATION", receipt_scan_sha256: await sha256Hex(eml) });
    expect(c.delivery.receipt_scan_path).toMatch(/^prevzeti\/.+\.eml$/);
    expect(c.delivery.confirmation_evidence.confirmation).toMatchObject({ kind: "EMAIL_REPLY", receipt_scan_hashed_by: "server" });
    const { data: file } = await hr.storage.from(BUCKET).download(c.delivery.receipt_scan_path);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(eml);
    const { error: up } = await hr.storage.from(BUCKET).upload(c.delivery.receipt_scan_path, new Blob([junk]), { upsert: true });
    expect(up).toBeTruthy();
    const { error: ch } = await service.from("hr_document_deliveries").update({ receipt_scan_path: `prevzeti/${id}/ine.eml` }).eq("id", r.delivery.id);
    expect(ch?.message || "").toMatch(/nem|nelze|sken/i);
  });

  it("§ 335 suhlas: fikcia 15. den od dodania; odvolany suhlas blokuje dalsie zasielky", async () => {
    const id = await signedDoc("mvs", "mzdovy_vymer");
    expect((await hrCall({ action: "send_email", document_id: id, channel: "EMAIL_S335_CONSENT" })).status).toBe(409); // bez suhlasu
    await service.from("employee_contact_declarations").insert({ id: `d335-${run}`, kind: "S335_CONSENT", employee_id: empId, email_snapshot: email,
      declared_at: new Date().toISOString(), channel: "TABLET_HR", notice_version_id: "lt-s335-notice-v1" });
    const r = await hrCall({ action: "send_email", document_id: id, channel: "EMAIL_S335_CONSENT" });
    expect(r.delivery).toMatchObject({ send_status: "SENT", recipient_snapshot: email });
    await provider({ delivery_id: r.delivery.id, event: "DELIVERED", at: daysAgo(16) });
    await hrCall({ action: "sweep" });
    const done = await dl(r.delivery.id);
    expect(done.delivery_basis).toBe("FICTION_15_DAYS");

    const { error: revErr } = await hr.rpc("hr_revoke_s335_consent", { p_consent_id: `d335-${run}`, p_received_at: new Date().toISOString(), p_hr_document_id: null });
    expect(revErr).toBeNull();
    const id2 = await signedDoc("mvs2", "mzdovy_vymer");
    const r2 = await hrCall({ action: "send_email", document_id: id2, channel: "EMAIL_S335_CONSENT" });
    expect(r2.status).toBe(409);
    expect(r2.error).toMatch(/souhlas/);
    expect((await dl(r.delivery.id)).delivery_basis).toBe("FICTION_15_DAYS"); // existujuce zaznamy nezmenene
  });

  it("zlyhanie odoslania: FAILED, max. 3 pokusy; nedorucitelna sprava = neucinne", async () => {
    const id = await signedDoc("mvf", "mzdovy_vymer");
    const r = await hrCall({ action: "send_email", document_id: id, channel: "EMAIL_S335_WAGE_OTHER_ADDRESS", recipient: `zamestnanec@fail.invalid` });
    expect(r.delivery).toMatchObject({ send_status: "FAILED", attempts: 1 });
    expect(r.delivery.send_error).toMatch(/Simulovaná chyba/);
    expect((await hrCall({ action: "retry", delivery_id: r.delivery.id })).delivery.attempts).toBe(2);
    expect((await hrCall({ action: "retry", delivery_id: r.delivery.id })).delivery.attempts).toBe(3);
    const ex = await hrCall({ action: "retry", delivery_id: r.delivery.id });
    expect(ex.status).toBe(409);
    expect(ex.error).toMatch(/osobně/);

    const ok = await hrCall({ action: "send_email", document_id: id, channel: "EMAIL_S335_WAGE_OTHER_ADDRESS", recipient: `bounce.${run}@example.test` });
    const b = await provider({ delivery_id: ok.delivery.id, event: "BOUNCED", reason: "550 mailbox unavailable" });
    expect(b.delivery).toMatchObject({ send_status: "BOUNCED" });
    expect(b.delivery.ineffective_at).toBeTruthy();
    expect(b.delivery.ineffective_reason).toMatch(/nedorucitelna/);
  });

  it("zmena e-mailu: stare oznamenie neplati, zlyhanu zasielku na staru adresu nejde zopakovat", async () => {
    const id = await signedDoc("ps3", "pracovni_smlouva");
    // zlyhane odoslanie na § 21 adresu (server simuluje chybu)
    const fid = crypto.randomUUID();
    await service.from("hr_document_deliveries").insert({ id: fid, hr_document_id: id, channel: "EMAIL_S21", recipient_snapshot: email, declaration_id: `d21-${run}`,
      delivered_document_sha256: await sha256Hex(pdfBytes), send_status: "QUEUED" });
    await service.from("hr_document_deliveries").update({ send_status: "FAILED", send_error: "test", attempts: 1 }).eq("id", fid);
    await service.from("employees").update({ private_email: `novy.${run}@example.test` }).eq("id", empId);
    const r = await hrCall({ action: "retry", delivery_id: fid });
    expect(r.status).toBe(409);
    expect(r.error).toMatch(/změna e-mailu/);
    expect((await hrCall({ action: "send_email", document_id: id, channel: "EMAIL_S21" })).status).toBe(409);
    await service.from("employees").update({ private_email: email }).eq("id", empId);
  });

  it("e-mail nezalozi ani HR priamo", async () => {
    const id = await signedDoc("ps4", "pracovni_smlouva");
    const { error } = await hr.from("hr_document_deliveries").insert({ id: crypto.randomUUID(), hr_document_id: id, channel: "EMAIL_S21",
      recipient_snapshot: email, declaration_id: `d21-${run}`, queued_at: new Date().toISOString() });
    expect(error?.message || "").toMatch(/server/);
  });
});
