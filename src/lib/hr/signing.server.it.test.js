// Integracny test fazy F proti LOKALNEMU Supabase (Edge Function hr-signing
// + DB triggre). Vymyslene udaje. Spustenie: scripts/test-local-it.sh.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { sha256Hex } from "../../../supabase/functions/_shared/pdfTextCheck.js";
import { signaturePng } from "./__fixtures__/signaturePng.js";

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

function fakePades(finalBytes) {
  const pad = (n) => String(n).padStart(10, " ");
  const head = "\n9 0 obj\n<< /Type /Sig /SubFilter /ETSI.CAdES.detached /ByteRange [0 BBBBBBBBBB CCCCCCCCCC DDDDDDDDDD] /Contents ";
  const sig = "<3082ABCDEF>";
  const end = " >>\nendobj\n%%EOF\n";
  const b = finalBytes.length + head.length; const c = b + sig.length; const total = c + end.length;
  return concat(finalBytes, enc(head.replace("BBBBBBBBBB", pad(b)).replace("CCCCCCCCCC", pad(c)).replace("DDDDDDDDDD", pad(total - c)) + sig + end));
}

describe.skipIf(!enabled)("faza F - podpis na tablete pre HR (lokalny Supabase)", { timeout: 120000 }, () => {
  let service, hr, signerHr, tablet;
  const run = Date.now().toString(36);
  const empId = `emp-f-${run}`;
  let finalBytes;

  async function invoke(client, body) {
    const { data, error } = await client.functions.invoke("hr-signing", { body });
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
      final_pdf_text_check: { ok: true, server_verified: true, method: "it-test" }, variables_snapshot: { zastupce: "JUDr. Dominik Hríň" }, ...extra,
    });
    if (error) throw error;
    return id;
  }
  const row = async (id) => (await service.from("hr_documents").select("*").eq("id", id).single()).data;
  const signBody = (token, loaded, over = {}) => ({
    action: "sign", token, name_confirmed: true, displayed_sha256: loaded.sha256, intent_text_version_id: loaded.intent.id,
    signature_png_base64: b64(signaturePng(7)), strokes: STROKES,
    evidence: { pages_viewed: Array.from({ length: loaded.pages }, (_, i) => i + 1) }, ...over,
  });

  beforeAll(async () => {
    service = createClient(URL_, SERVICE, { auth: { persistSession: false } });
    const seed = fs.readFileSync(path.join(root, "supabase/seed.sql"), "utf8");
    const [, email, password] = seed.match(/(personalista@test\.local) \/ (\S+)/);
    hr = createClient(URL_, ANON, { auth: { persistSession: false } });
    if ((await hr.auth.signInWithPassword({ email, password })).error) throw new Error("login personalista");
    // osoba s plnou mocou (meno ako v PS_PODEPISUJICI) - lokalny testovaci ucet
    const sEmail = `podpis-${run}@test.local`;
    const sPass = `it-${run}-${Math.random().toString(36).slice(2)}`;
    const { data: created, error: cErr } = await service.auth.admin.createUser({ email: sEmail, password: sPass, email_confirm: true });
    if (cErr) throw cErr;
    await service.from("profiles").insert({ id: created.user.id, full_name: "Dominik Hrin", role: "office" });
    await service.from("hr_permissions").insert({ id: `p-${run}`, user_email: sEmail, permissions: ["HR_VIEW_BASIC", "HR_VIEW_SENSITIVE", "HR_DOCUMENT_SIGN"] });
    signerHr = createClient(URL_, ANON, { auth: { persistSession: false } });
    if ((await signerHr.auth.signInWithPassword({ email: sEmail, password: sPass })).error) throw new Error("login signer");
    tablet = createClient(URL_, ANON, { auth: { persistSession: false } }); // tablet bez prihlasenia
    await service.from("employees").insert({ id: empId, first_name: "Tereza", last_name: "Tabletová", record_flag: "TEST" });
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= 3; i++) pdf.addPage().drawText(`Pracovni smlouva - strana ${i}`, { x: 50, y: 700, font, size: 14 });
    finalBytes = await pdf.save();
  });

  it("zmluva: overenie totoznosti -> token -> podpis zamestnanca, token je jednorazovy", async () => {
    const id = await newDoc("ps", "pracovni_smlouva");
    expect((await invoke(hr, { action: "issue", document_id: id, identity: { document_type: "OP" } })).status).toBe(422);
    expect((await invoke(tablet, { action: "issue", document_id: id, identity: { document_type: "OP", confirmed: true } })).status).toBe(401);
    const iss = await invoke(hr, { action: "issue", document_id: id, identity: { document_type: "OP", confirmed: true } });
    expect(iss).toMatchObject({ ok: true, signer_name: "Tereza Tabletová" });
    const { data: tokRow } = await service.from("hr_signing_tokens").select("token_sha256").eq("hr_document_id", id).single();
    expect(tokRow.token_sha256).toBe(await sha256Hex(enc(iss.token))); // v DB len hash

    const loaded = await invoke(tablet, { action: "load", token: iss.token });
    expect(loaded).toMatchObject({ ok: true, pages: 3, sha256: await sha256Hex(finalBytes), signer_name: "Tereza Tabletová" });
    expect(await sha256Hex(Buffer.from(loaded.pdf_base64, "base64"))).toBe(loaded.sha256);
    expect(loaded.intent.body).toContain("uzavírám tuto smlouvu");

    expect((await invoke(tablet, signBody(iss.token, loaded, { evidence: { pages_viewed: [1, 2] } }))).status).toBe(422);
    expect((await invoke(tablet, signBody(iss.token, loaded, { displayed_sha256: "f".repeat(64) }))).status).toBe(409);
    expect((await invoke(tablet, signBody(iss.token, loaded, { name_confirmed: false }))).status).toBe(422);
    const signed = await invoke(tablet, signBody(iss.token, loaded));
    expect(signed).toMatchObject({ ok: true, complete: false, missing: ["EMPLOYER"] });
    expect((await invoke(tablet, signBody(iss.token, loaded))).status).toBe(410);

    const { data: sig } = await service.from("hr_document_signatures").select("*").eq("hr_document_id", id).single();
    expect(sig).toMatchObject({ method: "ELECTRONIC_TABLET", signer_type: "EMPLOYEE", signed_by_name: "Tereza Tabletová" });
    expect(sig.identity_verification).toMatchObject({ method: "ID_DOCUMENT_CHECKED_BY_HR", document_type: "OP", verified_by_name: "Test Personalista" });
    expect(sig.evidence).toMatchObject({ channel: "HR_TABLET", all_pages_viewed: true, pages_total: 3, name_confirmed: true });
    expect((await row(id)).status).toBe("READY_FOR_SIGNATURE"); // zamknuty, nie podpisany

    // zamestnavatel: personalista nema plnu moc; osoba s plnou mocou podpise -> SIGNED + original
    expect((await invoke(hr, { action: "employer_load", document_id: id })).status).toBe(403);
    const el = await invoke(signerHr, { action: "employer_load", document_id: id });
    expect(el).toMatchObject({ ok: true, signer_name: "JUDr. Dominik Hríň" });
    expect((await invoke(signerHr, { action: "employer_sign", document_id: id, displayed_sha256: el.sha256, intent_text_version_id: el.intent.id,
      signature_png_base64: b64(signaturePng(8)), strokes: STROKES, evidence: { pages_viewed: [1, 2, 3] } })).status).toBe(422); // bez potvrdenia
    const es = await invoke(signerHr, { action: "employer_sign", document_id: id, confirmed: true, displayed_sha256: el.sha256, intent_text_version_id: el.intent.id,
      signature_png_base64: b64(signaturePng(8)), strokes: STROKES, evidence: { pages_viewed: [1, 2, 3] } });
    expect(es).toMatchObject({ ok: true, complete: true });
    const done = await row(id);
    expect(done.status).toBe("SIGNED");
    expect(done.signed_pdf_path).toBeTruthy();
  });

  it("novy token zrusi stary; po zmene verzie token neplati", async () => {
    const id = await newDoc("tok", "pracovni_smlouva");
    const a = await invoke(hr, { action: "issue", document_id: id, identity: { document_type: "PAS", confirmed: true } });
    const b = await invoke(hr, { action: "issue", document_id: id, identity: { document_type: "PAS", confirmed: true } });
    expect((await invoke(tablet, { action: "load", token: a.token })).status).toBe(410);
    expect((await invoke(tablet, { action: "load", token: b.token })).ok).toBe(true);
    expect((await invoke(tablet, { action: "load", token: "x".repeat(43) })).status).toBe(410);
  });

  it("zaznam o skoleni: bez evidencie skolenia sa podpis neponukne", async () => {
    const id = await newDoc("sk", "vstupni_skoleni");
    const r = await invoke(hr, { action: "issue", document_id: id, identity: { document_type: "OP", confirmed: true } });
    expect(r.status).toBe(409);
    expect(r.error).toMatch(/evidenci školení/);
    await service.from("hr_training_records").insert({ id: `tr-${run}`, employee_id: empId, trained_at: "2026-10-01", trainer_name: "Ing. Školitel",
      scope: "Vstupní BOZP", knowledge_check_method: "TEST", knowledge_check_result: "PASSED", knowledge_checked_at: "2026-10-01", knowledge_checked_by_name: "Ing. Školitel" });
    await service.from("hr_documents").update({ training_record_id: `tr-${run}` }).eq("id", id);
    const ok = await invoke(hr, { action: "issue", document_id: id, identity: { document_type: "OP", confirmed: true } });
    const loaded = await invoke(tablet, { action: "load", token: ok.token });
    expect(loaded.intent.body).toContain("absolvování školení");
    expect(loaded.intent.detail).toContain("Vstupní BOZP, 01.10.2026");
    const s = await invoke(tablet, signBody(ok.token, loaded));
    expect(s).toMatchObject({ ok: true, complete: true });
    expect((await row(id)).status).toBe("SIGNED");
  });

  it("mzdovy vymer (§ 334): obrazok podpisu zamestnavatela nestaci, uznavany podpis (PAdES) ano", async () => {
    const id = await newDoc("mv", "mzdovy_vymer");
    const el = await invoke(signerHr, { action: "employer_load", document_id: id });
    expect(el.status).toBe(409);
    expect(el.error).toMatch(/uznávaným elektronickým podpisem/);
    const other = finalBytes.slice(); other[30] ^= 1;
    expect((await invoke(signerHr, { action: "qualified_upload", document_id: id, signed_by_name: "JUDr. Dominik Hríň", pdf_base64: b64(fakePades(other)) })).status).toBe(422);
    expect((await invoke(signerHr, { action: "qualified_upload", document_id: id, signed_by_name: "JUDr. Dominik Hríň", pdf_base64: b64(finalBytes) })).status).toBe(422);
    const pades = fakePades(finalBytes);
    const q = await invoke(signerHr, { action: "qualified_upload", document_id: id, signed_by_name: "JUDr. Dominik Hríň", pdf_base64: b64(pades) });
    expect(q).toMatchObject({ ok: true, complete: true, qualified_original: true });
    const done = await row(id);
    expect(done.status).toBe("SIGNED");
    expect(done.signed_pdf_sha256).toBe(await sha256Hex(pades)); // podpisany original = samotne PAdES PDF
    const { data: sig } = await service.from("hr_document_signatures").select("*").eq("hr_document_id", id).single();
    expect(sig).toMatchObject({ method: "ELECTRONIC_QUALIFIED", signer_type: "EMPLOYER" });
    expect(sig.evidence.certificate_validation).toBe("NOT_PERFORMED");
  });

  it("klient sa k tokenom nedostane ani ako HR", async () => {
    const { data } = await hr.from("hr_signing_tokens").select("*");
    expect(data).toEqual([]);
    const { error } = await hr.from("hr_signing_tokens").insert({ token_sha256: "a".repeat(64), hr_document_id: "x", final_pdf_sha256: "x", signer_type: "EMPLOYEE", signer_name: "x", identity_verification: {}, created_by: "22222222-2222-2222-2222-222222222222", expires_at: new Date(Date.now() + 60000).toISOString() });
    expect(error).toBeTruthy();
  });
});
