// Integracny test fazy F (+ doplnky pred G) proti LOKALNEMU Supabase (Edge
// Function hr-signing + DB triggre). Vymyslene udaje. Spustenie:
// scripts/test-local-it.sh.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { sha256Hex } from "../../../supabase/functions/_shared/pdfTextCheck.js";
import { signaturePng } from "./__fixtures__/signaturePng.js";
import { extractPdfPages } from "./finalPdf.js";

const URL_ = process.env.LOCAL_SUPABASE_URL;
const ANON = process.env.LOCAL_SUPABASE_ANON_KEY;
const SERVICE = process.env.LOCAL_SUPABASE_SERVICE_KEY;
const enabled = !!(URL_ && ANON && SERVICE && /^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_ || ""));
const root = path.resolve(__dirname, "../../..");
const BUCKET = "hr-dokumenty";
const b64 = (u8) => Buffer.from(u8).toString("base64");
const enc = (s) => new TextEncoder().encode(s);
const concat = (...ps) => { const o = new Uint8Array(ps.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of ps) { o.set(p, i); i += p.length; } return o; };
const STROKES = [Array.from({ length: 15 }, (_, i) => [i * 3, i * 2])];
const TABLET = "tablet-it-0123456789abcdef";
const OTHER_TABLET = "tablet-it-ffffffffffffffff";
const SIGNATORY = "JUDr. Test Zmocněnec";
const SIGNER_PERMS = ["HR_VIEW_BASIC", "HR_VIEW_SENSITIVE", "HR_VIEW_PAYROLL", "HR_DOCUMENT_SIGN", "HR_SIGN_FOR_EMPLOYER"];
const EMP_EMAIL = `tereza.${Date.now().toString(36)}@example.test`;
const MAILPIT = "http://127.0.0.1:54324";

function fakePades(finalBytes) {
  const pad = (n) => String(n).padStart(10, " ");
  const head = "\n9 0 obj\n<< /Type /Sig /SubFilter /ETSI.CAdES.detached /ByteRange [0 BBBBBBBBBB CCCCCCCCCC DDDDDDDDDD] /Contents ";
  const sig = "<3082ABCDEF>";
  const end = " >>\nendobj\n%%EOF\n";
  const b = finalBytes.length + head.length; const c = b + sig.length; const total = c + end.length;
  return concat(finalBytes, enc(head.replace("BBBBBBBBBB", pad(b)).replace("CCCCCCCCCC", pad(c)).replace("DDDDDDDDDD", pad(total - c)) + sig + end));
}

describe.skipIf(!enabled)("faza F - podpis na tablete pri osobnej pritomnosti (lokalny Supabase)", { timeout: 120000 }, () => {
  let service, hr, signerHr, tablet, hrCreds;
  const run = Date.now().toString(36);
  const empId = `emp-f-${run}`;
  let finalBytes;

  async function invoke(client, body, fn = "hr-signing") {
    const { data, error } = await client.functions.invoke(fn, { body });
    if (data) return { status: 200, ...data };
    return { status: error.context.status, ...(await error.context.json()) };
  }
  async function newDoc(suffix, docType, extra = {}) {
    const id = `doc-f-${run}-${suffix}`;
    const p = `zamestnanci/${empId}/${id}/finalni-${run}.pdf`;
    await service.storage.from(BUCKET).upload(p, new Blob([finalBytes], { type: "application/pdf" }), { contentType: "application/pdf" });
    const { error } = await service.from("hr_documents").insert({
      id, employee_id: empId, doc_type: docType, origin: "GENERATED", status: "READY_FOR_SIGNATURE",
      final_pdf_path: p, final_pdf_sha256: await sha256Hex(finalBytes), finalized_at: new Date().toISOString(),
      final_pdf_text_check: { ok: true, server_verified: true, method: "it-test" }, variables_snapshot: { zastupce: SIGNATORY }, ...extra,
    });
    if (error) throw error;
    return id;
  }
  const row = async (id) => (await service.from("hr_documents").select("*").eq("id", id).single()).data;
  const issue = (client, id) => invoke(client, { action: "issue", document_id: id, identity: { document_type: "OP", confirmed: true } });
  const signBody = (token, loaded, over = {}) => ({
    action: "sign", token, device_id: TABLET, name_confirmed: true, displayed_sha256: loaded.sha256, intent_text_version_id: loaded.intent.id,
    signature_png_base64: b64(signaturePng(7)), strokes: STROKES,
    evidence: { pages_viewed: Array.from({ length: loaded.pages }, (_, i) => i + 1) }, ...over,
  });
  const wrongCode = (code) => String((Number(code) + 1) % 1000000).padStart(6, "0");

  beforeAll(async () => {
    service = createClient(URL_, SERVICE, { auth: { persistSession: false } });
    const seed = fs.readFileSync(path.join(root, "supabase/seed.sql"), "utf8");
    const [, email, password] = seed.match(/(personalista@test\.local) \/ (\S+)/);
    hrCreds = { email, password };
    hr = createClient(URL_, ANON, { auth: { persistSession: false } });
    if ((await hr.auth.signInWithPassword(hrCreds)).error) throw new Error("login personalista");
    // osoba s plnou mocou (DB hr_signatories) - lokalny testovaci ucet
    const sEmail = `podpis-${run}@test.local`;
    const sPass = `it-${run}-${Math.random().toString(36).slice(2)}`;
    const { data: created, error: cErr } = await service.auth.admin.createUser({ email: sEmail, password: sPass, email_confirm: true });
    if (cErr) throw cErr;
    await service.from("profiles").insert({ id: created.user.id, full_name: "Test Zmocnenec", role: "office" });
    await service.from("hr_permissions").insert({ id: `p-${run}`, user_email: sEmail, permissions: SIGNER_PERMS });
    await service.from("hr_signatories").insert({ id: `sig-${run}`, full_name: SIGNATORY, full_name_instrumental: "JUDr. Testem Zmocněncem", user_id: created.user.id, valid_from: "2026-01-01" });
    signerHr = createClient(URL_, ANON, { auth: { persistSession: false } });
    if ((await signerHr.auth.signInWithPassword({ email: sEmail, password: sPass })).error) throw new Error("login signer");
    tablet = createClient(URL_, ANON, { auth: { persistSession: false } }); // tablet bez prihlasenia
    await service.from("employees").insert({ id: empId, first_name: "Tereza", last_name: "Tabletová", record_flag: "TEST", private_email: EMP_EMAIL });
    // § 21: elektronicke uzavretie zapnute (lokalne) + oznamenie adresy
    await service.from("hr_settings").update({ value: true }).eq("key", "electronic_contract_enabled");
    await service.from("employee_contact_declarations").insert({ id: `decl-${run}`, kind: "S21_ADDRESS_NOTICE", employee_id: empId,
      email_snapshot: EMP_EMAIL, declared_at: new Date().toISOString(), channel: "TABLET_HR" });
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= 3; i++) pdf.addPage().drawText(`Pracovni smlouva - strana ${i}`, { x: 50, y: 700, font, size: 14 });
    finalBytes = await pdf.save();
  });

  it("zmluva: overenie totoznosti -> QR token + kod z obrazovky HR -> podpis na tablete", async () => {
    const id = await newDoc("ps", "pracovni_smlouva");
    expect((await invoke(hr, { action: "issue", document_id: id, identity: { document_type: "OP" } })).status).toBe(422);
    expect((await issue(tablet, id)).status).toBe(401);
    const iss = await issue(hr, id);
    expect(iss).toMatchObject({ ok: true, signer_name: "Tereza Tabletová" });
    expect(iss.code).toMatch(/^\d{6}$/);
    const { data: tokRow } = await service.from("hr_signing_tokens").select("*").eq("hr_document_id", id).single();
    expect(tokRow.token_sha256).toBe(await sha256Hex(enc(iss.token))); // v DB len hash
    expect(tokRow.pairing_code_sha256).not.toContain(iss.code);
    expect(tokRow.hr_session_id).toMatch(/^[0-9a-f-]{36}$/);

    // bez kodu dokument neuvidi; kod je viazany na zariadenie
    expect((await invoke(tablet, { action: "load", token: iss.token, device_id: TABLET })).status).toBe(428);
    expect((await invoke(tablet, { action: "load", token: iss.token, code: iss.code })).status).toBe(422); // bez zariadenia
    const loaded = await invoke(tablet, { action: "load", token: iss.token, device_id: TABLET, code: iss.code });
    expect(loaded).toMatchObject({ ok: true, pages: 3, sha256: await sha256Hex(finalBytes), signer_name: "Tereza Tabletová" });
    expect(loaded.intent.body).toContain("uzavírám tuto smlouvu");
    expect((await invoke(tablet, { action: "load", token: iss.token, device_id: OTHER_TABLET, code: iss.code })).status).toBe(403);
    expect((await invoke(tablet, signBody(iss.token, loaded, { device_id: OTHER_TABLET }))).status).toBe(403);

    expect((await invoke(tablet, signBody(iss.token, loaded, { evidence: { pages_viewed: [1, 2] } }))).status).toBe(422);
    expect((await invoke(tablet, signBody(iss.token, loaded, { displayed_sha256: "f".repeat(64) }))).status).toBe(409);
    expect((await invoke(tablet, signBody(iss.token, loaded, { name_confirmed: false }))).status).toBe(422);
    const signed = await invoke(tablet, signBody(iss.token, loaded));
    expect(signed).toMatchObject({ ok: true, complete: false, missing: ["EMPLOYER"] });
    expect((await invoke(tablet, signBody(iss.token, loaded))).status).toBe(410);

    const { data: sig } = await service.from("hr_document_signatures").select("*").eq("hr_document_id", id).single();
    expect(sig).toMatchObject({ method: "ELECTRONIC_TABLET", signer_type: "EMPLOYEE", signed_by_name: "Tereza Tabletová" });
    expect(sig.identity_verification).toMatchObject({ method: "ID_DOCUMENT_CHECKED_BY_HR_IN_PERSON", document_type: "OP", verified_by_name: "Test Personalista", hr_session_id: tokRow.hr_session_id });
    expect(sig.evidence).toMatchObject({ channel: "HR_TABLET_IN_PERSON", device_id: TABLET, hr_session_id: tokRow.hr_session_id, code_attempts: 0, all_pages_viewed: true, pages_total: 3 });
    expect(sig.device_metadata.device_id).toBe(TABLET);
    expect((await row(id)).status).toBe("READY_FOR_SIGNATURE"); // zamknuty, nie podpisany

    // zamestnavatel: personalista nema plnu moc; osoba s plnou mocou (DB) podpise -> SIGNED
    expect((await invoke(hr, { action: "employer_load", document_id: id })).status).toBe(403);
    const el = await invoke(signerHr, { action: "employer_load", document_id: id });
    expect(el).toMatchObject({ ok: true, signer_name: SIGNATORY });
    const empBody = { action: "employer_sign", document_id: id, displayed_sha256: el.sha256, intent_text_version_id: el.intent.id,
      signature_png_base64: b64(signaturePng(8)), strokes: STROKES, evidence: { pages_viewed: [1, 2, 3] } };
    expect((await invoke(signerHr, empBody)).status).toBe(422); // bez potvrdenia
    // pred podpisom: stav "neulozeny" (klient po strate spojenia ukaze pravdu)
    expect(await invoke(signerHr, { action: "signing_status", document_id: id, signer_type: "EMPLOYER" })).toMatchObject({ signed: false, missing: ["EMPLOYER"] });
    const saved = await invoke(signerHr, { ...empBody, confirmed: true });
    // podpis sa len ulozi; podpisany original a e-mail su samostatne opakovatelne kroky
    expect(saved).toMatchObject({ ok: true, saved: true, complete: false, missing: [], needs_completion: true });
    expect((await row(id)).status).toBe("READY_FOR_SIGNATURE");
    // strata spojenia po ulozeni: klient overi stav - podpis je ulozeny
    expect(await invoke(signerHr, { action: "signing_status", document_id: id, signer_type: "EMPLOYER" })).toMatchObject({ signed: true, missing: [], needs_completion: true });
    // opakovany podpis odmietne (uz podepsal) - z toho isteho udaja
    expect((await invoke(signerHr, { ...empBody, confirmed: true })).status).toBe(409);
    const c1 = await invoke(signerHr, { action: "complete", document_id: id });
    expect(c1).toMatchObject({ ok: true, complete: true });
    const c2 = await invoke(signerHr, { action: "complete", document_id: id });
    expect(c2).toMatchObject({ ok: true, complete: true, already: true, signed_pdf_sha256: c1.signed_pdf_sha256 });
    const fin = await invoke(signerHr, { action: "deliver_after_signing", document_id: id });
    expect(fin).toMatchObject({ ok: true, s21: { sent: true, send_status: "SENT" } });
    const again = await invoke(signerHr, { action: "deliver_after_signing", document_id: id });
    expect(again.s21).toMatchObject({ already: true, delivery_id: fin.s21.delivery_id });
    const { count: dlCount } = await service.from("hr_document_deliveries").select("id", { count: "exact", head: true }).eq("hr_document_id", id);
    expect(dlCount).toBe(1); // e-mail len raz
    const done = await row(id);
    expect(done.status).toBe("SIGNED");
    // faza G: podpisany original hned zaslany na § 21 adresu (lokalny Mailpit)
    const { data: dl } = await service.from("hr_document_deliveries").select("*").eq("id", fin.s21.delivery_id).single();
    expect(dl).toMatchObject({ channel: "EMAIL_S21", recipient_snapshot: EMP_EMAIL, send_status: "SENT", delivered_at: null, delivered_document_sha256: done.signed_pdf_sha256 });
    const found = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${EMP_EMAIL}`)}`)).json();
    expect(found.messages?.length).toBeGreaterThan(0);
    expect(found.messages[0].Attachments).toBe(1);
    // priloha = ulozeny podpisany original (rovnaky hash) s dokaznym listom
    const msg = await (await fetch(`${MAILPIT}/api/v1/message/${found.messages[0].ID}`)).json();
    expect(msg.Attachments).toHaveLength(1);
    expect(msg.Attachments[0].ContentType).toBe("application/pdf");
    const att = new Uint8Array(await (await fetch(`${MAILPIT}/api/v1/message/${found.messages[0].ID}/part/${msg.Attachments[0].PartID}`)).arrayBuffer());
    expect(await sha256Hex(att)).toBe(done.signed_pdf_sha256);
    const { data: storedSigned } = await service.storage.from("hr-dokumenty").download(done.signed_pdf_path);
    expect(await sha256Hex(new Uint8Array(await storedSigned.arrayBuffer()))).toBe(done.signed_pdf_sha256);
    const attPages = await extractPdfPages(att);
    expect(attPages.length).toBeGreaterThan(3); // 3 strany finalneho PDF + dokazny list
    const evidence = attPages.slice(3).join(" ").replace(/\s+/g, " ");
    expect(evidence).toContain("DŮKAZNÍ LIST K ELEKTRONICKY PODEPSANÉMU DOKUMENTU");
    expect(evidence).toContain(`SHA-256 finálního PDF (podepsaný obsah): ${await sha256Hex(finalBytes)}`);
    expect(evidence).toContain("na tabletu za přítomnosti HR"); // zamestnanec
    expect(evidence).toContain("přihlášeného uživatele na jeho obrazovce"); // za zamestnavatela
    const { data: emp } = await service.from("hr_document_signatures").select("evidence").eq("hr_document_id", id).eq("signer_type", "EMPLOYER").single();
    expect(emp.evidence.signatory_id).toBe(`sig-${run}`);
  });

  it("§ 21: bez platneho oznamenia adresy alebo pri vypnutom nastaveni zmluvu elektronicky nepodpise", async () => {
    const id = await newDoc("s21", "pracovni_smlouva");
    await service.from("hr_settings").update({ value: false }).eq("key", "electronic_contract_enabled");
    let r = await issue(hr, id);
    expect(r.status).toBe(409);
    expect(r.error).toMatch(/vypnuté/);
    await service.from("hr_settings").update({ value: true }).eq("key", "electronic_contract_enabled");
    await service.from("employees").update({ private_email: "novy.email@example.test" }).eq("id", empId);
    r = await issue(hr, id);
    expect(r.status).toBe(409);
    expect(r.error).toMatch(/§ 21/);
    await service.from("employees").update({ private_email: EMP_EMAIL }).eq("id", empId);
    expect((await issue(hr, id)).ok).toBe(true);
  });

  it("faza H: podpis za zamestnavatela len s HR_SIGN_FOR_EMPLOYER (plna moc sama nestaci)", async () => {
    const id = await newDoc("h", "pracovni_smlouva");
    await service.from("hr_permissions").update({ permissions: SIGNER_PERMS.filter((p) => p !== "HR_SIGN_FOR_EMPLOYER") }).eq("id", `p-${run}`);
    const r = await invoke(signerHr, { action: "employer_load", document_id: id });
    expect(r.status).toBe(403);
    await service.from("hr_permissions").update({ permissions: SIGNER_PERMS }).eq("id", `p-${run}`);
    expect((await invoke(signerHr, { action: "employer_load", document_id: id })).ok).toBe(true);
  });

  it("tri zle kody zrusia odkaz; novy token zrusi stary", async () => {
    const id = await newDoc("tok", "pracovni_smlouva");
    const a = await issue(hr, id);
    expect(await invoke(hr, { action: "token_status", token: a.token })).toMatchObject({ status: "ACTIVE", attempts_left: 3 });
    expect((await invoke(signerHr, { action: "token_status", token: a.token })).status).toBe(404); // len ten, kto vydal
    let r = await invoke(tablet, { action: "load", token: a.token, device_id: TABLET, code: wrongCode(a.code) });
    expect(r.status).toBe(403);
    expect(r.error).toMatch(/Zbývající pokusy: 2/);
    expect(await invoke(hr, { action: "token_status", token: a.token })).toMatchObject({ status: "ACTIVE", attempts_left: 2 });
    expect((await invoke(tablet, { action: "load", token: a.token, device_id: TABLET, code: "12" })).status).toBe(403);
    r = await invoke(tablet, { action: "load", token: a.token, device_id: TABLET, code: wrongCode(a.code) });
    expect(r.status).toBe(410);
    expect((await invoke(tablet, { action: "load", token: a.token, device_id: TABLET, code: a.code })).status).toBe(410); // uz ani spravny
    // obrazovka HR musi ukazat, ze kod bol zruseny
    expect(await invoke(hr, { action: "token_status", token: a.token })).toMatchObject({ status: "REVOKED_CODE", attempts_left: 0 });
    const b = await issue(hr, id);
    const c = await issue(hr, id);
    expect((await invoke(tablet, { action: "load", token: b.token, device_id: TABLET, code: b.code })).status).toBe(410);
    expect((await invoke(tablet, { action: "load", token: c.token, device_id: TABLET, code: c.code })).ok).toBe(true);
    expect((await invoke(tablet, { action: "load", token: "x".repeat(43), device_id: TABLET, code: "000000" })).status).toBe(410);
  });

  it("odhlasenie HR, ktory overil doklad, odkaz zrusi (ziadny podpis na dialku)", async () => {
    const id = await newDoc("odhl", "pracovni_smlouva");
    const hr2 = createClient(URL_, ANON, { auth: { persistSession: false } });
    if ((await hr2.auth.signInWithPassword(hrCreds)).error) throw new Error("login 2");
    const t = await issue(hr2, id);
    expect((await invoke(tablet, { action: "load", token: t.token, device_id: TABLET, code: t.code })).ok).toBe(true);
    await hr2.auth.signOut({ scope: "local" });
    const r = await invoke(tablet, { action: "load", token: t.token, device_id: TABLET });
    expect(r.status).toBe(410);
    expect(r.error).toMatch(/není přihlášen/);
  });

  it("zaznam o skoleni: bez evidencie skolenia sa podpis neponukne", async () => {
    const id = await newDoc("sk", "vstupni_skoleni");
    const r = await issue(hr, id);
    expect(r.status).toBe(409);
    expect(r.error).toMatch(/evidenci školení/);
    await service.from("hr_training_records").insert({ id: `tr-${run}`, employee_id: empId, trained_at: "2026-10-01", trainer_name: "Ing. Školitel",
      scope: "Vstupní BOZP", knowledge_check_method: "TEST", knowledge_check_result: "PASSED", knowledge_checked_at: "2026-10-01", knowledge_checked_by_name: "Ing. Školitel" });
    await service.from("hr_documents").update({ training_record_id: `tr-${run}` }).eq("id", id);
    const ok = await issue(hr, id);
    const loaded = await invoke(tablet, { action: "load", token: ok.token, device_id: TABLET, code: ok.code });
    expect(loaded.intent.body).toContain("absolvování školení");
    expect(loaded.intent.detail).toContain("Vstupní BOZP, 01.10.2026");
    expect(await invoke(tablet, signBody(ok.token, loaded))).toMatchObject({ ok: true, saved: true, needs_completion: true });
    expect(await invoke(tablet, { action: "signing_status", token: ok.token })).toMatchObject({ signed: true });
    expect(await invoke(tablet, { action: "complete", token: ok.token })).toMatchObject({ ok: true, complete: true });
    expect((await row(id)).status).toBe("SIGNED");
  });

  it("mzdovy vymer (§ 334): uznavany podpis = 'certifikát neověřen' a e-mail az po overeni", async () => {
    const id = await newDoc("mv", "mzdovy_vymer");
    const el = await invoke(signerHr, { action: "employer_load", document_id: id });
    expect(el.status).toBe(409);
    expect(el.error).toMatch(/uznávaným elektronickým podpisem/);
    const other = finalBytes.slice(); other[30] ^= 1;
    expect((await invoke(signerHr, { action: "qualified_upload", document_id: id, signed_by_name: SIGNATORY, pdf_base64: b64(fakePades(other)) })).status).toBe(422);
    expect((await invoke(signerHr, { action: "qualified_upload", document_id: id, signed_by_name: SIGNATORY, pdf_base64: b64(finalBytes) })).status).toBe(422);
    const pades = fakePades(finalBytes);
    const q = await invoke(signerHr, { action: "qualified_upload", document_id: id, signed_by_name: SIGNATORY, pdf_base64: b64(pades) });
    expect(q).toMatchObject({ ok: true, complete: true, qualified_original: true, certificate: "NOT_VERIFIED" });
    const done = await row(id);
    expect(done.status).toBe("SIGNED");
    expect(done.signed_pdf_sha256).toBe(await sha256Hex(pades));
    const { data: sig } = await service.from("hr_document_signatures").select("*").eq("hr_document_id", id).single();
    expect(sig.identity_verification.label).toContain("podpis přítomen, certifikát neověřen");
    const { data: st } = await service.rpc("hr_signature_certificate_status", { p_signature_id: sig.id });
    expect(st).toBe("NOT_VERIFIED");

    // elektronicke dorucenie § 334 bez overeneho certifikatu odmietnute
    const email = { hr_document_id: id, channel: "EMAIL_S335_WAGE_OTHER_ADDRESS", recipient_snapshot: "jina@example.com", queued_at: new Date().toISOString() };
    expect((await service.from("hr_document_deliveries").insert({ id: `dl-${run}-a`, ...email })).error?.message).toMatch(/overenym certifikatem/);

    // rucne overenie: protokol nahra a zahashuje server, zapise sa kto overil
    const protocol = enc("%PDF-1.4\n% protokol o overeni (test)\n%%EOF\n");
    expect((await invoke(signerHr, { action: "qualified_verify", signature_id: sig.id, result: "VALID", service_name: "EU DSS", protocol_base64: b64(enc("nie pdf")) })).status).toBe(422);
    const v = await invoke(hr, { action: "qualified_verify", signature_id: sig.id, result: "VALID", service_name: "EU DSS", protocol_base64: b64(protocol), protocol_sha256: "0".repeat(64) });
    expect(v).toMatchObject({ ok: true, label: "podpis přítomen, certifikát ověřen – platný" });
    expect(v.verification).toMatchObject({ result: "VALID", method: "MANUAL_PUBLIC_SERVICE", verified_by_name: "Test Personalista", protocol_sha256: await sha256Hex(protocol) });
    const { data: stored } = await service.storage.from(BUCKET).download(v.verification.protocol_path);
    expect(await sha256Hex(new Uint8Array(await stored.arrayBuffer()))).toBe(v.verification.protocol_sha256);
    expect((await service.from("hr_document_deliveries").insert({ id: `dl-${run}-b`, ...email })).error).toBeNull();
  });

  it("plna moc z DB: neplatna alebo ina osoba nepodpise", async () => {
    const id = await newDoc("pm", "pracovni_smlouva", { variables_snapshot: { zastupce: "Ing. Petr Vzorový" } });
    const r = await invoke(signerHr, { action: "employer_load", document_id: id });
    expect(r.status).toBe(403);
    expect(r.error).toMatch(/Ing\. Petr Vzorový/);
    await service.from("hr_signatories").update({ valid_to: "2026-01-31" }).eq("id", `sig-${run}`);
    const id2 = await newDoc("pm2", "pracovni_smlouva");
    const r2 = await invoke(signerHr, { action: "employer_load", document_id: id2 });
    expect(r2.status).toBe(403);
    expect(r2.error).toMatch(/platnou plnou moc/);
    await service.from("hr_signatories").update({ valid_to: null }).eq("id", `sig-${run}`);
  });

  it("sken plnej moci: len HR_ADMIN, otisk pocita server, potom nemenny", async () => {
    const scan = enc("%PDF-1.4\n% plna moc (test)\n%%EOF\n");
    expect((await invoke(hr, { action: "signatory_scan", signatory_id: `sig-${run}`, scan_base64: b64(scan) })).status).toBe(403);
    const admin = createClient(URL_, ANON, { auth: { persistSession: false } });
    if ((await admin.auth.signInWithPassword({ email: "hr.admin@test.local", password: hrCreds.password })).error) throw new Error("login admin");
    const r = await invoke(admin, { action: "signatory_scan", signatory_id: `sig-${run}`, scan_base64: b64(scan) });
    expect(r).toMatchObject({ ok: true, sha256: await sha256Hex(scan) });
    expect(r.path).toMatch(new RegExp(`^plne-moci/sig-${run}-[0-9a-f]{16}\\.pdf$`));
    expect((await invoke(admin, { action: "signatory_scan", signatory_id: `sig-${run}`, scan_base64: b64(scan) })).status).toBe(409);
  });

  it("papierovy sken: ulozi a zahashuje server, prehliadac podpis nezapise (migracia 60)", async () => {
    const id = await newDoc("paper", "pracovni_smlouva");
    const scan = enc("%PDF-1.4\n% podepsany sken (test)\n%%EOF\n");
    const base = { action: "paper_upload", document_id: id, confirmed: true, signed_date: new Date().toISOString().slice(0, 10) };
    expect((await invoke(hr, { ...base, scan_base64: b64(enc("<html>nie sken</html>")), signers: [{ signer_type: "EMPLOYEE", name: "Test" }] })).status).toBe(422);
    expect((await invoke(hr, { ...base, confirmed: false, scan_base64: b64(scan), signers: [{ signer_type: "EMPLOYEE", name: "Test" }] })).status).toBe(422);
    expect((await invoke(hr, { ...base, signed_date: "2099-01-01", scan_base64: b64(scan), signers: [{ signer_type: "EMPLOYEE", name: "Test" }] })).status).toBe(422);
    const a = await invoke(hr, { ...base, scan_base64: b64(scan), signers: [{ signer_type: "EMPLOYEE", name: "Zaměstnanec Test" }] });
    expect(a).toMatchObject({ ok: true, complete: false, missing: ["EMPLOYER"] });
    const { data: sig } = await service.from("hr_document_signatures").select("*").eq("hr_document_id", id).single();
    expect(sig).toMatchObject({ method: "PAPER", document_hash: await sha256Hex(scan), signed_content_sha256: await sha256Hex(finalBytes) });
    expect(sig.file_path).toMatch(new RegExp(`^zamestnanci-podpisy/${id}-[0-9a-f]{16}\\.pdf$`));
    const { error: direct } = await hr.from("hr_document_signatures").insert({ id: `x-${run}`, hr_document_id: id, method: "PAPER", signer_type: "EMPLOYER",
      signed_by_name: "x", document_hash: "c".repeat(64), file_path: "zamestnanci-podpisy/x.pdf" });
    expect(direct?.message).toMatch(/jen server/);
    const up = await hr.storage.from(BUCKET).upload(`zamestnanci-podpisy/${id}-podvrh.pdf`, new Blob([scan], { type: "application/pdf" }));
    expect(up.error).toBeTruthy();
    const scan2 = enc("%PDF-1.4\n% podpis zamestnavatela (test)\n%%EOF\n");
    const b = await invoke(hr, { ...base, scan_base64: b64(scan2), signers: [{ signer_type: "EMPLOYER", name: SIGNATORY }] });
    expect(b).toMatchObject({ ok: true, complete: true });
    expect((await row(id)).status).toBe("SIGNED");
  });

  it("uznavany podpis zamestnanca sa zapocita az po overeni certifikatu; meno z karty (migracia 60)", async () => {
    const id = await newDoc("qe", "vypoved_zamestnance");
    const q = await invoke(hr, { action: "qualified_upload", document_id: id, signer_type: "EMPLOYEE", signed_by_name: "Niekto Iny", pdf_base64: b64(fakePades(finalBytes)) });
    expect(q).toMatchObject({ ok: true, complete: false, missing: ["EMPLOYEE"] });
    const { data: sig } = await service.from("hr_document_signatures").select("*").eq("hr_document_id", id).single();
    const { data: e } = await service.from("employees").select("title, first_name, last_name").eq("id", empId).single();
    expect(sig.signed_by_name).toBe([e.title, e.first_name, e.last_name].filter(Boolean).join(" "));
    expect((await row(id)).status).toBe("READY_FOR_SIGNATURE");
    const v = await invoke(hr, { action: "qualified_verify", signature_id: sig.id, result: "VALID", service_name: "EU DSS", protocol_base64: b64(enc("%PDF-1.4\n% protokol\n%%EOF\n")) });
    expect(v.completion).toMatchObject({ complete: true, qualified_original: true });
    expect((await row(id)).status).toBe("SIGNED");
  });

  it("klient sa k tokenom nedostane ani ako HR", async () => {
    const { data } = await hr.from("hr_signing_tokens").select("*");
    expect(data).toEqual([]);
  });
});
