// Integracny test migracie 81 proti LOKALNEMU Supabase: jednatel nahra
// zaciernenu kopiu plnej moci, hr-finalize-pdf ju pripoji k finalnemu PDF
// dokumentu, ktory ta osoba podpisuje. Vymyslene udaje.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { createClient } from "@supabase/supabase-js";
import { signInAal2 } from "./itTotp.js";
import { sha256Hex } from "../../../supabase/functions/_shared/pdfTextCheck.js";

const URL_ = process.env.LOCAL_SUPABASE_URL;
const ANON = process.env.LOCAL_SUPABASE_ANON_KEY;
const SERVICE = process.env.LOCAL_SUPABASE_SERVICE_KEY;
const enabled = !!(URL_ && ANON && SERVICE && /^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_ || ""));
const root = path.resolve(__dirname, "../../..");
const fx = (f) => new Uint8Array(fs.readFileSync(path.join(root, "src/lib/hr/__fixtures__/word_final_pdf", f)));
const BUCKET = "hr-dokumenty";
const b64 = (bytes) => Buffer.from(bytes).toString("base64");

describe.skipIf(!enabled)("kopie plne moci u finalniho PDF (lokalny Supabase)", { timeout: 120000 }, () => {
  let service, admin, user, SNAPSHOT, sigId;
  const run = Date.now().toString(36);
  const empId = `emp-it-poa-${run}`;

  beforeAll(async () => {
    ({ SNAPSHOT } = await import("./__fixtures__/word_final_pdf/make_docx.mjs"));
    service = createClient(URL_, SERVICE, { auth: { persistSession: false } });
    const seed = fs.readFileSync(path.join(root, "supabase/seed.sql"), "utf8");
    const password = seed.match(/hr\.admin@test\.local \/ (\S+)/)[1];
    admin = createClient(URL_, ANON, { auth: { persistSession: false } });
    await signInAal2(admin, service, "hr.admin@test.local", password);
    user = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { error } = await user.auth.signInWithPassword({ email: "personalista@test.local", password });
    if (error) throw error;
    await service.from("employees").insert({ id: empId, first_name: "Jana", last_name: "Nováková-Testová", record_flag: "TEST" });
    const { data: sig, error: sErr } = await admin.from("hr_signatories").insert({
      full_name: SNAPSHOT.zastupce, full_name_instrumental: `${SNAPSHOT.zastupce}em`, valid_from: "2025-07-01", valid_to: "2030-07-01",
    }).select("id").single();
    if (sErr) throw sErr;
    sigId = sig.id;
  });
  // meno sa zmeni, aby kopiu nedostali dalsie testy s rovnakym zastupcom
  afterAll(async () => { if (sigId) await service.from("hr_signatories").update({ full_name: `Ukončený test ${run}` }).eq("id", sigId); });

  it("kopiu uklada len server a je nemenna", async () => {
    const { error } = await admin.from("hr_signatories").update({ poa_copy_path: "plne-moci/x.pdf", poa_copy_sha256: "a".repeat(64) }).eq("id", sigId);
    expect(error?.message).toMatch(/uklada server/);
    const copy = await PDFDocument.create(); copy.addPage([595, 842]);
    const bytes = await copy.save();
    const { data } = await admin.functions.invoke("hr-signing", { body: { action: "signatory_copy", signatory_id: sigId, scan_base64: b64(bytes) } });
    expect(data.ok).toBe(true);
    expect(data.path).toMatch(/^plne-moci\/.+-kopie-/);
    const { data: again, error: aErr } = await admin.functions.invoke("hr-signing", { body: { action: "signatory_copy", signatory_id: sigId, scan_base64: b64(bytes) } });
    expect(again).toBeNull();
    expect((await aErr.context.json()).error).toMatch(/už uložena/);
    // personalista (bez HR_ADMIN) kopiu nenahra, ale subor vidi
    const { data: denied } = await user.functions.invoke("hr-signing", { body: { action: "signatory_copy", signatory_id: sigId, scan_base64: b64(bytes) } });
    expect(denied).toBeNull();
    expect((await user.storage.from(BUCKET).download(data.path)).error).toBeNull();
  });

  it("finalni PDF dostane kopii jako posledni stranu, hash pokryva celek", async () => {
    const id = `doc-it-poa-${run}`;
    const docxPath = `zamestnanci/${empId}/${id}.docx`;
    await service.storage.from(BUCKET).upload(docxPath, new Blob([fx("zmluva.docx")]), { contentType: "application/octet-stream" });
    const { error } = await service.from("hr_documents").insert({
      id, employee_id: empId, doc_type: "pracovni_smlouva", origin: "GENERATED", status: "READY_FOR_SIGNATURE",
      legal_act_type: "BILATERAL_CONTRACT", file_path: docxPath, variables_snapshot: SNAPSHOT,
    });
    if (error) throw error;
    const p = `zamestnanci/${empId}/${id}/finalni-${run}.pdf`;
    await user.storage.from(BUCKET).upload(p, new Blob([fx("zmluva.pdf")], { type: "application/pdf" }), { contentType: "application/pdf" });
    const { data, error: fnErr } = await user.functions.invoke("hr-finalize-pdf", { body: { document_id: id, pdf_path: p } });
    const r = data || (await fnErr.context.json());
    expect(r.error || "").toBe("");
    expect(r.ok).toBe(true);
    expect(r.path).toBe(p.replace(/\.pdf$/, "-s-plnou-moci.pdf"));
    const { data: d } = await service.from("hr_documents").select("*").eq("id", id).single();
    expect(d.final_pdf_path).toBe(r.path);
    expect(d.final_pdf_text_check.poa_attached).toMatchObject({ signatory_id: sigId, signatory_name: SNAPSHOT.zastupce, pages_added: 1,
      source_pdf_sha256: await sha256Hex(fx("zmluva.pdf")) });
    const merged = new Uint8Array(await (await service.storage.from(BUCKET).download(r.path)).data.arrayBuffer());
    expect(await sha256Hex(merged)).toBe(d.final_pdf_sha256);
    const orig = await PDFDocument.load(fx("zmluva.pdf"));
    expect((await PDFDocument.load(merged)).getPageCount()).toBe(orig.getPageCount() + 1);
  });
});
