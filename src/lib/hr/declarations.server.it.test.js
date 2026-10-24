// Integracny test fazy I: vyhlasenia a poucenia z verzovanych textov
// (Edge Function hr-declarations). Proti LOKALNEMU Supabase, vymyslene udaje.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { approveTextsForTest } from "./itApprovedTexts.js";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { sha256Hex } from "../../../supabase/functions/_shared/pdfTextCheck.js";
import { extractPdfText } from "./finalPdf.js";

const URL_ = process.env.LOCAL_SUPABASE_URL;
const ANON = process.env.LOCAL_SUPABASE_ANON_KEY;
const SERVICE = process.env.LOCAL_SUPABASE_SERVICE_KEY;
const enabled = !!(URL_ && ANON && SERVICE && /^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_ || ""));
const root = path.resolve(__dirname, "../../..");
const BUCKET = "hr-dokumenty";

describe.skipIf(!enabled)("faza I - vyhlasenia z verzovanych textov (lokalny Supabase)", { timeout: 120000 }, () => {
  let service, hr, approved;
  const run = Date.now().toString(36);
  const empId = `emp-i-${run}`;
  const email = `iveta.${run}@example.test`;

  async function create(body) {
    const { data, error } = await hr.functions.invoke("hr-declarations", { body: { action: "create", employee_id: empId, ...body } });
    if (data) return { status: 200, ...data };
    return { status: error.context.status, ...(await error.context.json()) };
  }
  const row = async (id) => (await service.from("hr_documents").select("*").eq("id", id).single()).data;
  async function paperSign(id) {
    await service.from("hr_document_signatures").insert({ id: `s-${id}`, hr_document_id: id, method: "PAPER", signer_type: "EMPLOYEE",
      signed_by_name: "Iveta Textová", document_hash: "c".repeat(64), file_path: `zamestnanci/${empId}/${id}/sken.pdf` });
    const { error } = await service.from("hr_documents").update({ status: "SIGNED" }).eq("id", id);
    if (error) throw error;
  }

  beforeAll(async () => {
    service = createClient(URL_, SERVICE, { auth: { persistSession: false } });
    const seed = fs.readFileSync(path.join(root, "supabase/seed.sql"), "utf8");
    const [, login, password] = seed.match(/(personalista@test\.local) \/ (\S+)/);
    hr = createClient(URL_, ANON, { auth: { persistSession: false } });
    if ((await hr.auth.signInWithPassword({ email: login, password })).error) throw new Error("login");
    await service.from("employees").insert({ id: empId, first_name: "Iveta", last_name: "Textová", record_flag: "TEST", private_email: email });
    approved = await approveTextsForTest(service, undefined, run);
  });
  afterAll(async () => { await approved?.cleanup(); });

  it("§ 21 oznamenie: server PDF z aktualneho textu, po podpise vznikne vyhlasenie; nove vyhotovenie nahradi nepodpisane", async () => {
    const a = await create({ kind: "S21" });
    expect(a).toMatchObject({ ok: true, text_status: "SCHVALENO" });
    const b = await create({ kind: "S21" });
    expect((await row(a.document_id)).status).toBe("VOIDED");
    const d = await row(b.document_id);
    expect(d).toMatchObject({ doc_type: "s21_oznameni_adresy", status: "READY_FOR_SIGNATURE", legal_act_type: "EMPLOYEE_DECLARATION" });
    expect(d.final_pdf_text_check).toMatchObject({ ok: true, server_verified: true, method: "server-generated-v1" });
    expect(d.variables_snapshot).toMatchObject({ declaration_kind: "S21_ADDRESS_NOTICE", email, text_version_id: approved.ids[0] });
    const { data: file } = await service.storage.from(BUCKET).download(d.final_pdf_path);
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect(await sha256Hex(bytes)).toBe(d.final_pdf_sha256);
    expect((await extractPdfText(bytes)).text).toContain(email);

    await paperSign(b.document_id);
    const { data: decl } = await service.from("employee_contact_declarations").select("*").eq("hr_document_id", b.document_id).single();
    expect(decl).toMatchObject({ kind: "S21_ADDRESS_NOTICE", employee_id: empId, email_snapshot: email, channel: "PAPER_SCAN" });
    const { data: valid } = await hr.rpc("hr_valid_contact_declaration", { p_employee_id: empId, p_kind: "S21_ADDRESS_NOTICE" });
    expect(valid).toBe(decl.id);

    // potvrdenie o prevzati k podpisanemu dokumentu
    const r = await create({ kind: "RECEIPT", target_document_id: b.document_id });
    const rd = await row(r.document_id);
    expect(rd).toMatchObject({ doc_type: "potvrzeni_prevzeti", legal_act_type: "RECEIPT_ACKNOWLEDGEMENT" });
    const signed = await row(b.document_id);
    expect(rd.variables_snapshot.target_sha256).toBe(signed.signed_pdf_sha256 || signed.final_pdf_sha256); // papier: vytistene finalni PDF
    expect((await create({ kind: "RECEIPT", target_document_id: a.document_id })).status).toBe(409); // zneplatneny
  });

  it("§ 335: pri vypnutom nastaveni nie; zapnute -> suhlas s poucenim; odvolanie po podpise zrusi suhlas", async () => {
    await service.from("hr_settings").update({ value: false }).eq("key", "s335_consent_enabled");
    const off = await create({ kind: "S335" });
    expect(off.status).toBe(409);
    expect(off.error).toMatch(/vypnuté/);
    await service.from("hr_settings").update({ value: true }).eq("key", "s335_consent_enabled");
    try {
      expect((await create({ kind: "S335_REVOCATION" })).status).toBe(409); // nie je co odvolat
      const c = await create({ kind: "S335" });
      const cd = await row(c.document_id);
      expect(cd.variables_snapshot).toMatchObject({ declaration_kind: "S335_CONSENT", notice_version_id: approved.ids[1] });
      await paperSign(c.document_id);
      const { data: consent } = await service.from("employee_contact_declarations").select("*").eq("hr_document_id", c.document_id).single();
      expect(consent).toMatchObject({ kind: "S335_CONSENT", notice_version_id: approved.ids[1] });

      const rv = await create({ kind: "S335_REVOCATION" });
      expect((await row(rv.document_id)).variables_snapshot.consent_id).toBe(consent.id);
      await paperSign(rv.document_id);
      const { data: after } = await service.from("employee_contact_declarations").select("revoked_at").eq("id", consent.id).single();
      expect(after.revoked_at).toBeTruthy();
    } finally {
      await service.from("hr_settings").update({ value: false }).eq("key", "s335_consent_enabled");
    }
  });

  it("nova verzia textu sa pouzije pre nove dokumenty; stary podpisany dokument ostava na starej verzii", async () => {
    const before = await create({ kind: "S21" });
    const { data: v } = await service.from("hr_legal_text_versions").insert({
      id: `lt-s21-it-${run}`, text_key: "S21_ADDRESS_NOTICE", version_no: (await service.from("hr_legal_text_versions").select("version_no").eq("text_key", "S21_ADDRESS_NOTICE").order("version_no", { ascending: false }).limit(1).single()).data.version_no + 1, title: "Oznámení elektronické adresy (§ 21 zákoníku práce)",
      body: "KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU. Upravená verze pro test.", body_sha256: "x", status: "SCHVALENO",
    }).select().single();
    try {
      const after = await create({ kind: "S21" });
      expect((await row(after.document_id)).variables_snapshot.text_version_id).toBe(v.id);
      expect((await row(before.document_id)).variables_snapshot.text_version_id).toBe(approved.ids[0]);
    } finally {
      await service.from("hr_legal_text_versions").update({ status: "VYRAZENO" }).eq("id", v.id);
    }
  });

  it("bez e-mailu sa § 21 oznamenie nevytvori", async () => {
    await service.from("employees").update({ private_email: null }).eq("id", empId);
    const r = await create({ kind: "S21" });
    expect(r.status).toBe(409);
    expect(r.error).toMatch(/e-mail/);
    await service.from("employees").update({ private_email: email }).eq("id", empId);
  });
});
