// Integracny test fazy D proti LOKALNEMU Supabase: kiosk (anon) ->
// Edge Function hr-kiosk -> DB triggre -> kontrola HR. Vymyslene udaje.
// Spustenie: scripts/test-local-it.sh. Bez LOCAL_SUPABASE_* sa preskoci.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { approveTextsForTest } from "./itApprovedTexts.js";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { sha256Hex } from "../../../supabase/functions/_shared/pdfTextCheck.js";
import { extractPdfText } from "./finalPdf.js";
import { signaturePng } from "./__fixtures__/signaturePng.js";

const URL_ = process.env.LOCAL_SUPABASE_URL;
const ANON = process.env.LOCAL_SUPABASE_ANON_KEY;
const SERVICE = process.env.LOCAL_SUPABASE_SERVICE_KEY;
const enabled = !!(URL_ && ANON && SERVICE && /^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_ || ""));
const root = path.resolve(__dirname, "../../..");

const fromB64 = (s) => new Uint8Array(Buffer.from(s, "base64"));
const toB64 = (b) => Buffer.from(b).toString("base64");
const STROKES = [Array.from({ length: 30 }, (_, i) => [i * 5, 20 + (i % 7)])];

describe.skipIf(!enabled)("faza D - kiosk dotaznik (lokalny Supabase)", { timeout: 180000 }, () => {
  let kiosk, service, hr, approved;

  async function newSession(draft) {
    // kiosk sa odomyka kodom od HR (audit S-03, migr. 63)
    const { data: code, error: codeErr } = await hr.rpc("hr_kiosk_issue_unlock");
    if (codeErr) throw codeErr;
    const { data, error } = await kiosk.rpc("hr_onboarding_start_session", { p_unlock_code: code });
    if (error) throw error;
    const s = data[0];
    const { data: saved } = await kiosk.rpc("hr_onboarding_save_draft", { p_session_token: s.session_token, p_draft_data: draft });
    expect(saved).toBe(true);
    return s;
  }
  async function call(body) {
    const { data, error } = await kiosk.functions.invoke("hr-kiosk", { body });
    if (data) return { status: 200, ...data };
    return { status: error.context.status, ...(await error.context.json()) };
  }
  const prepare = (s) => call({ action: "prepare", session_token: s.session_token });
  // ako klient: ulozenie podpisu, potom samostatne dokoncenie (podpisany original)
  const sign = async (s, d, over = {}) => {
    const r = await call({
      action: "sign", session_token: s.session_token, document_id: d.id, displayed_sha256: d.sha256,
      intent_text_version_id: d.intent.id, signature_png_base64: toB64(signaturePng(Math.random() * 6)), strokes: STROKES,
      evidence: { pages_viewed: Array.from({ length: d.pages }, (_, i) => i + 1), viewed_at: new Date().toISOString() }, ...over,
    });
    if (r.status !== 200 || !r.needs_completion) return r;
    const c = await call({ action: "complete", session_token: s.session_token, document_id: d.id });
    return { ...r, ...c, status: c.status };
  };

  beforeAll(async () => {
    kiosk = createClient(URL_, ANON, { auth: { persistSession: false } });
    service = createClient(URL_, SERVICE, { auth: { persistSession: false } });
    hr = createClient(URL_, ANON, { auth: { persistSession: false } });
    const seed = fs.readFileSync(path.join(root, "supabase/seed.sql"), "utf8");
    const [, email, password] = seed.match(/(personalista@test\.local) \/ (\S+)/);
    const { error } = await hr.auth.signInWithPassword({ email, password });
    if (error) throw error;
    approved = await approveTextsForTest(service);
  });
  afterAll(async () => {
    await service.from("hr_settings").update({ value: false }).eq("key", "s335_consent_enabled");
    await approved?.cleanup();
  });

  it("podpis len k udajom, z ktorych PDF vzniklo (migracia 60)", async () => {
    const draft = { first_name: "Olga", last_name: "Zmenená", date_of_birth: "1990-01-01", private_email: "olga.a@example.test", kiosk_s21: "ANO" };
    const s = await newSession(draft);
    const p = await prepare(s);
    const s21 = p.documents.find((d) => d.kind === "S21");
    await kiosk.rpc("hr_onboarding_save_draft", { p_session_token: s.session_token, p_draft_data: { ...draft, private_email: "olga.b@example.test" } });
    const r = await sign(s, s21);
    expect(r.status).toBe(409);
    expect(r.error).toMatch(/změnily/);
    const { count } = await service.from("employee_contact_declarations").select("id", { count: "exact", head: true }).eq("onboarding_session_id", s.id);
    expect(count).toBe(0);
  });

  it("s e-mailom a § 21: dotaznik a oznamenie zvlast, podpis kazdeho, prenos na zamestnanca bez zmeny hashov", async () => {
    const s = await newSession({ first_name: "Jana", last_name: "Kiosková", date_of_birth: "1991-03-07", private_email: "jana.kioskova@example.test", kiosk_s21: "ANO" });
    const p = await prepare(s);
    expect(p.ok).toBe(true);
    expect(p.documents.map((d) => d.kind)).toEqual(["QUESTIONNAIRE", "S21"]);
    for (const d of p.documents) {
      expect(await sha256Hex(fromB64(d.pdf_base64))).toBe(d.sha256); // kiosk zobrazi presne finalnu verziu
      expect(d.intent.body).toMatch(/^KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU/);
    }
    const [q, s21] = p.documents;
    expect(q.pages).toBe(8);
    expect((await extractPdfText(fromB64(s21.pdf_base64))).text).toContain("jana.kioskova@example.test");

    // neuplne zobrazenie, ina verzia, prazdny podpis, cudzi token
    expect((await sign(s, q, { evidence: { pages_viewed: [1, 2] } })).status).toBe(422);
    expect((await sign(s, q, { displayed_sha256: "0".repeat(64) })).status).toBe(409);
    expect((await sign(s, q, { strokes: [] })).status).toBe(422);
    const other = await newSession({ first_name: "Cizí", last_name: "Relace" });
    expect((await sign(other, q)).status).toBe(404);

    expect((await sign(s, q)).ok).toBe(true);
    const { data: saved } = await kiosk.rpc("hr_onboarding_save_draft", { p_session_token: s.session_token, p_draft_data: { first_name: "Zmena" } });
    expect(saved).toBe(false); // po podpise sa udaje nemenia
    const again = await prepare(s); // rovnake dokumenty, dotaznik uz podpisany
    expect(again.documents.map((d) => [d.id, d.signed])).toEqual([[q.id, true], [s21.id, false]]);
    expect((await kiosk.rpc("hr_onboarding_submit", { p_session_token: s.session_token, p_signing_mode: "ELECTRONIC" })).error?.message).toMatch(/podepsany vsechny/);

    expect((await sign(s, s21)).ok).toBe(true);
    const { data: submitted } = await kiosk.rpc("hr_onboarding_submit", { p_session_token: s.session_token, p_signing_mode: "ELECTRONIC" });
    expect(submitted).toBe(true);

    // HR: dokumenty, podpisy (rozne obrazky), vyhlasenie
    const { data: docs } = await hr.from("hr_documents").select("*").eq("onboarding_session_id", s.id).order("doc_type");
    expect(docs.map((d) => [d.doc_type, d.status])).toEqual([["osobni_dotaznik", "SIGNED"], ["s21_oznameni_adresy", "SIGNED"]]);
    const { data: sigs } = await hr.from("hr_document_signatures").select("*").in("hr_document_id", docs.map((d) => d.id));
    expect(new Set(sigs.map((x) => x.signature_image_id)).size).toBe(2);
    expect(sigs.every((x) => x.evidence.all_pages_viewed && x.identity_verification.method === "KIOSK_SELF_DECLARED")).toBe(true);
    const { data: decl } = await hr.from("employee_contact_declarations").select("*").eq("onboarding_session_id", s.id);
    expect(decl.map((x) => [x.kind, x.email_snapshot, x.hr_document_id])).toEqual([["S21_ADDRESS_NOTICE", "jana.kioskova@example.test", s21.id]]);
    const { data: blob } = await hr.storage.from("hr-dokumenty").download(docs[0].signed_pdf_path);
    expect(await sha256Hex(new Uint8Array(await blob.arrayBuffer()))).toBe(docs[0].signed_pdf_sha256);

    // kontrola HR -> zamestnanec; obsah a hashe bez zmeny
    const empId = `emp-kiosk-${Date.now()}`;
    await service.from("employees").insert({ id: empId, first_name: "Jana", last_name: "Kiosková", private_email: "jana.kioskova@example.test", record_flag: "TEST" });
    const { data: rev, error: revErr } = await hr.rpc("hr_onboarding_review", { p_session_id: s.id, p_status: "REVIEWED", p_resulting_employee_id: empId });
    expect(revErr).toBeNull();
    expect(rev).toBe(true);
    const { data: after } = await hr.from("hr_documents").select("*").eq("onboarding_session_id", s.id).order("doc_type");
    expect(after.map((d) => [d.employee_id, d.final_pdf_sha256, d.signed_pdf_sha256])).toEqual(docs.map((d) => [empId, d.final_pdf_sha256, d.signed_pdf_sha256]));
    const { data: valid } = await hr.rpc("hr_valid_contact_declaration", { p_employee_id: empId, p_kind: "S21_ADDRESS_NOTICE" });
    expect(valid).toBe(decl[0].id);
  });

  it("bez e-mailu: len dotaznik, ziadne vyhlasenie; papierovy podpis zneplatni pripravene PDF", async () => {
    const s = await newSession({ first_name: "Petr", last_name: "Bezmailový", no_private_email: true, kiosk_s21: "ANO" });
    const p = await prepare(s);
    expect(p.documents.map((d) => d.kind)).toEqual(["QUESTIONNAIRE"]);
    const { data: ok } = await kiosk.rpc("hr_onboarding_submit", { p_session_token: s.session_token, p_signing_mode: "PAPER" });
    expect(ok).toBe(true);
    const { data: docs } = await hr.from("hr_documents").select("status, void_reason").eq("onboarding_session_id", s.id);
    expect(docs).toEqual([{ status: "VOIDED", void_reason: "Zvolen podpis na papíře" }]);
    const { data: sess } = await hr.from("onboarding_sessions").select("signing_mode, status").eq("id", s.id).single();
    expect(sess).toEqual({ signing_mode: "PAPER", status: "SUBMITTED" });
  });

  it("chybajuca volba § 21 a zmena udajov pred podpisom", async () => {
    const s = await newSession({ first_name: "Eva", last_name: "Nerozhodná", private_email: "eva@example.test" });
    expect((await prepare(s)).status).toBe(422); // volba § 21 nie je predvyplnena
    await kiosk.rpc("hr_onboarding_save_draft", { p_session_token: s.session_token, p_draft_data: { first_name: "Eva", last_name: "Nerozhodná", private_email: "eva@example.test", kiosk_s21: "NE" } });
    const p1 = await prepare(s);
    expect(p1.documents.map((d) => d.kind)).toEqual(["QUESTIONNAIRE"]);
    await kiosk.rpc("hr_onboarding_save_draft", { p_session_token: s.session_token, p_draft_data: { first_name: "Eva", last_name: "Rozhodná", private_email: "eva@example.test", kiosk_s21: "NE" } });
    const p2 = await prepare(s);
    expect(p2.documents[0].id).not.toBe(p1.documents[0].id);
    expect((await sign(s, p1.documents[0])).status).toBe(409); // stara verzia je zneplatnena
    const { data: old } = await hr.from("hr_documents").select("status").eq("id", p1.documents[0].id).single();
    expect(old.status).toBe("VOIDED");
  });

  it("§ 335 zapnuty: poucenie v dokumente, samostatny suhlas s verziou poucenia", async () => {
    await service.from("hr_settings").update({ value: true }).eq("key", "s335_consent_enabled");
    const { data: cfg } = await kiosk.rpc("hr_onboarding_config");
    expect(cfg.texts.S335_NOTICE.body).toMatch(/15 dnů/);
    const s = await newSession({
      first_name: "Ota", last_name: "Souhlasný", private_email: "ota@example.test",
      kiosk_s21: "ANO", kiosk_s335: "ANO", kiosk_s335_notice_id: cfg.texts.S335_NOTICE.id,
    });
    const p = await prepare(s);
    expect(p.documents, JSON.stringify(p).slice(0, 300)).toBeDefined();
    expect(p.documents.map((d) => d.kind)).toEqual(["QUESTIONNAIRE", "S21", "S335"]);
    const text = (await extractPdfText(fromB64(p.documents[2].pdf_base64))).text;
    expect(text).toContain("S335_NOTICE verze");
    expect(text).toContain("odvolat");
    for (const d of p.documents) expect((await sign(s, d)).ok).toBe(true);
    const { data: decl } = await hr.from("employee_contact_declarations").select("kind, notice_version_id").eq("onboarding_session_id", s.id).order("kind");
    expect(decl).toEqual([
      { kind: "S21_ADDRESS_NOTICE", notice_version_id: cfg.texts.S21_ADDRESS_NOTICE.id },
      { kind: "S335_CONSENT", notice_version_id: cfg.texts.S335_NOTICE.id },
    ]);
  });
});
