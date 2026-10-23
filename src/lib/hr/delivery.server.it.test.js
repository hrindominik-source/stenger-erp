// Integracny test: osobne predanie so skenom potvrdenia o prevzati (Edge
// Function hr-delivery). Otisk skenu pocita server - hodnota z prehliadaca sa
// nepouziva. Proti LOKALNEMU Supabase, vymyslene udaje.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { sha256Hex } from "../../../supabase/functions/_shared/pdfTextCheck.js";

const URL_ = process.env.LOCAL_SUPABASE_URL;
const ANON = process.env.LOCAL_SUPABASE_ANON_KEY;
const SERVICE = process.env.LOCAL_SUPABASE_SERVICE_KEY;
const enabled = !!(URL_ && ANON && SERVICE && /^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_ || ""));
const root = path.resolve(__dirname, "../../..");
const enc = (s) => new TextEncoder().encode(s);
const b64 = (u8) => Buffer.from(u8).toString("base64");

describe.skipIf(!enabled)("predanie so skenom potvrdenia - otisk pocita server", { timeout: 60000 }, () => {
  let service, hr;
  const run = Date.now().toString(36);
  const empId = `emp-d-${run}`;

  async function invoke(body) {
    const { data, error } = await hr.functions.invoke("hr-delivery", { body });
    if (data) return { status: 200, ...data };
    return { status: error.context.status, ...(await error.context.json()) };
  }
  // podpisany mzdovy vymer (§ 334) - papierovy podpis zamestnavatela
  async function signedS334(suffix) {
    const id = `doc-d-${run}-${suffix}`;
    const fin = "a".repeat(63) + suffix.length;
    const ins = await service.from("hr_documents").insert({ id, employee_id: empId, doc_type: "mzdovy_vymer", origin: "GENERATED", status: "READY_FOR_SIGNATURE",
      final_pdf_path: `zamestnanci/${empId}/${id}/f.pdf`, final_pdf_sha256: fin, final_pdf_text_check: { ok: true, server_verified: true }, finalized_at: new Date().toISOString(),
      signed_pdf_path: `zamestnanci/${empId}/${id}/s.pdf`, signed_pdf_sha256: "b".repeat(64) });
    if (ins.error) throw ins.error;
    const sig = await service.from("hr_document_signatures").insert({ id: `sig-${id}`, hr_document_id: id, method: "PAPER", signer_type: "EMPLOYER", signed_by_name: "Ing. Petr Vzorový",
      document_hash: "c".repeat(64), file_path: `zamestnanci/${empId}/${id}/sken.pdf` });
    if (sig.error) throw sig.error;
    const up = await service.from("hr_documents").update({ status: "SIGNED" }).eq("id", id);
    if (up.error) throw up.error;
    return id;
  }

  beforeAll(async () => {
    service = createClient(URL_, SERVICE, { auth: { persistSession: false } });
    const seed = fs.readFileSync(path.join(root, "supabase/seed.sql"), "utf8");
    const [, email, password] = seed.match(/(personalista@test\.local) \/ (\S+)/);
    hr = createClient(URL_, ANON, { auth: { persistSession: false } });
    if ((await hr.auth.signInWithPassword({ email, password })).error) throw new Error("login");
    await service.from("employees").insert({ id: empId, first_name: "Petra", last_name: "Předávací", record_flag: "TEST" });
  });

  it("§ 334: sken nahra server, otisk zo servera (podvrhnuty otisk z prehliadaca sa ignoruje)", async () => {
    const id = await signedS334("a");
    const scan = enc("%PDF-1.4\n% potvrzeni o prevzeti (test)\n%%EOF\n");
    expect((await invoke({ action: "in_person", document_id: id, delivered_date: new Date().toISOString().slice(0, 10), receipt: false })).status).toBe(409);
    expect((await invoke({ action: "in_person", document_id: id, delivered_date: "2099-01-01", receipt: true, scan_base64: b64(scan) })).status).toBe(422);
    expect((await invoke({ action: "in_person", document_id: id, delivered_date: "2026-10-01", receipt: true, scan_base64: b64(enc("<html>nie sken</html>")) })).status).toBe(422);
    // datum predania nie pred podpisom dokumentu (migracia 60)
    expect((await invoke({ action: "in_person", document_id: id, delivered_date: "2026-01-01", receipt: true, scan_base64: b64(scan) })).status).toBe(409);
    const r = await invoke({ action: "in_person", document_id: id, delivered_date: new Date().toISOString().slice(0, 10), receipt: true, scan_base64: b64(scan),
      receipt_scan_sha256: "0".repeat(64) });
    expect(r.ok).toBe(true);
    const sha = await sha256Hex(scan);
    expect(r.delivery).toMatchObject({ delivery_basis: "SIGNED_RECEIPT", receipt_scan_sha256: sha, delivered_document_sha256: "b".repeat(64) });
    expect(r.delivery.receipt_scan_path).toBe(`prevzeti/${id}/${r.delivery.id}-${sha.slice(0, 16)}.pdf`);
    expect(r.delivery.confirmation_evidence.receipt_scan_hashed_by).toBe("server");
    expect(r.delivery.handed_over_by).toBe((await hr.auth.getUser()).data.user.id);
    const { data: stored } = await service.storage.from("hr-dokumenty").download(r.delivery.receipt_scan_path);
    expect(await sha256Hex(new Uint8Array(await stored.arrayBuffer()))).toBe(sha);
    // HR vidi sken (rovnaka citlivost ako dokument)
    const { data: url } = await hr.storage.from("hr-dokumenty").createSignedUrl(r.delivery.receipt_scan_path, 60);
    expect(url?.signedUrl).toBeTruthy();
  });

  it("prehliadac nemoze obist server: priamy zapis skenu ani zaznamu s otiskom", async () => {
    const id = await signedS334("bb");
    const p = `prevzeti/${id}/x-${"d".repeat(16)}.pdf`;
    const up = await hr.storage.from("hr-dokumenty").upload(p, new Blob([enc("%PDF-1.4 x")], { type: "application/pdf" }));
    expect(up.error).toBeTruthy();
    const { error } = await hr.from("hr_document_deliveries").insert({ id: `dl-${run}`, hr_document_id: id, channel: "IN_PERSON_PAPER", delivered_at: new Date().toISOString(),
      delivery_basis: "SIGNED_RECEIPT", receipt_scan_path: p, receipt_scan_sha256: "d".repeat(64) });
    expect(error?.message).toMatch(/server/);
  });
});
