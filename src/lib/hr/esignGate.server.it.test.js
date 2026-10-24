// Integracny test (rozhodnutie jednatela k balíku C, migracia 66): kym nie su
// texty prejavu vole schvalene, elektronicky podpis (kiosk aj tablet u HR) sa
// neda vytvorit a papierovy postup prejde. Proti LOKALNEMU Supabase.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { approveTextsForTest } from "./itApprovedTexts.js";

const URL_ = process.env.LOCAL_SUPABASE_URL;
const ANON = process.env.LOCAL_SUPABASE_ANON_KEY;
const SERVICE = process.env.LOCAL_SUPABASE_SERVICE_KEY;
const enabled = !!(URL_ && ANON && SERVICE && /^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_ || ""));
const root = path.resolve(__dirname, "../../..");
const PENDING = /Elektronický podpis čeká na schválení textů – použijte papírový postup/;

describe.skipIf(!enabled)("elektronicky podpis len so schvalenymi textami prejavu vule (lokalny Supabase)", { timeout: 120000 }, () => {
  let service, hr, kiosk, approvedS21;
  const run = Date.now().toString(36);

  async function invoke(client, fn, body) {
    const { data, error } = await client.functions.invoke(fn, { body });
    if (data) return { status: 200, ...data };
    return { status: error.context.status, ...(await error.context.json()) };
  }

  beforeAll(async () => {
    service = createClient(URL_, SERVICE, { auth: { persistSession: false } });
    kiosk = createClient(URL_, ANON, { auth: { persistSession: false } });
    hr = createClient(URL_, ANON, { auth: { persistSession: false } });
    const seed = fs.readFileSync(path.join(root, "supabase/seed.sql"), "utf8");
    const [, email, password] = seed.match(/(personalista@test\.local) \/ (\S+)/);
    if ((await hr.auth.signInWithPassword({ email, password })).error) throw new Error("login");
    // len § 21 (aby vznikol dokument na podpis); prejavy vole ostavaju koncept
    approvedS21 = await approveTextsForTest(service, ["S21_ADDRESS_NOTICE"], run);
  });
  afterAll(async () => { await approvedS21?.cleanup(); });

  it("predpoklad: ziadny text prejavu vule nie je schvaleny", async () => {
    const { data } = await hr.rpc("hr_esign_ready_keys");
    expect(data).toEqual([]);
  });

  it("kiosk: dokumenty bez prejavu vule, podpis odmietnuty, papierovy postup prejde", async () => {
    const { data: code } = await hr.rpc("hr_kiosk_issue_unlock");
    const { data, error } = await kiosk.rpc("hr_onboarding_start_session", { p_unlock_code: code });
    if (error) throw error;
    const s = data[0];
    await kiosk.rpc("hr_onboarding_save_draft", { p_session_token: s.session_token,
      p_draft_data: { first_name: "Pavla", last_name: "Papírová", date_of_birth: "1990-01-01", no_private_email: true } });
    const prep = await invoke(kiosk, "hr-kiosk", { action: "prepare", session_token: s.session_token });
    expect(prep.status).toBe(200);
    expect(prep.documents.length).toBeGreaterThan(0);
    expect(prep.documents.every((d) => d.intent === null)).toBe(true);
    const d = prep.documents[0];
    const sign = await invoke(kiosk, "hr-kiosk", { action: "sign", session_token: s.session_token, document_id: d.id,
      displayed_sha256: d.sha256, intent_text_version_id: "lt-intent-questionnaire-v1", signature_png_base64: "", strokes: [], evidence: {} });
    expect(sign.status).toBe(409);
    expect(sign.error).toMatch(PENDING);
    const { data: ok, error: subErr } = await kiosk.rpc("hr_onboarding_submit", { p_session_token: s.session_token, p_signing_mode: "PAPER" });
    expect(subErr).toBeNull();
    expect(ok).toBe(true);
    const { count } = await service.from("hr_document_signatures").select("id", { count: "exact", head: true }).eq("hr_document_id", d.id);
    expect(count).toBe(0);
  });

  it("tablet u HR: kod sa nevyda; papierovy sken podpisu prejde", async () => {
    const empId = `emp-esign-${run}`;
    await service.from("employees").insert({ id: empId, first_name: "Petr", last_name: "Papírový", record_flag: "TEST", private_email: `petr.${run}@example.test` });
    const doc = await invoke(hr, "hr-declarations", { action: "create", employee_id: empId, kind: "S21" });
    expect(doc.status).toBe(200);
    const issue = await invoke(hr, "hr-signing", { action: "issue", document_id: doc.document_id, identity: { document_type: "OP", confirmed: true } });
    expect(issue.status).toBe(409);
    expect(issue.error).toMatch(PENDING);
    const { count: tokens } = await service.from("hr_signing_tokens").select("id", { count: "exact", head: true }).eq("hr_document_id", doc.document_id);
    expect(tokens).toBe(0);

    const scan = Buffer.from(`%PDF-1.4\n% sken ${run}\n%%EOF\n`).toString("base64");
    const paper = await invoke(hr, "hr-signing", { action: "paper_upload", document_id: doc.document_id, confirmed: true,
      signers: [{ signer_type: "EMPLOYEE", name: "Petr Papírový" }], signed_date: new Date().toISOString().slice(0, 10), scan_base64: scan });
    expect(paper.status).toBe(200);
    const { data: sigs } = await service.from("hr_document_signatures").select("method").eq("hr_document_id", doc.document_id);
    expect(sigs.map((x) => x.method)).toEqual(["PAPER"]);
  });
});
