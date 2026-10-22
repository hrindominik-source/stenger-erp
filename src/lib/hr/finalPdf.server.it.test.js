// Integracny test fazy C proti LOKALNEMU Supabase (Edge Functions
// hr-finalize-pdf a hr-signed-original + DB triggre). Vymyslene udaje.
// Spustenie: scripts/test-local-it.sh (nastavi LOCAL_SUPABASE_* zo
// `supabase status`). Bez tychto premennych sa test preskoci.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { signaturePng } from "./__fixtures__/signaturePng.js";
import { createClient } from "@supabase/supabase-js";
import { sha256Hex } from "../../../supabase/functions/_shared/pdfTextCheck.js";
import { verifySignedOriginal } from "./signedOriginal.js";
import { extractPdfPages, normalizeForMatch } from "./finalPdf.js";

const URL_ = process.env.LOCAL_SUPABASE_URL;
const ANON = process.env.LOCAL_SUPABASE_ANON_KEY;
const SERVICE = process.env.LOCAL_SUPABASE_SERVICE_KEY;
const enabled = !!(URL_ && ANON && SERVICE && /^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_ || ""));

const root = path.resolve(__dirname, "../../..");
const fx = (f) => new Uint8Array(fs.readFileSync(path.join(root, "src/lib/hr/__fixtures__/word_final_pdf", f)));
const BUCKET = "hr-dokumenty";
const PNG = signaturePng();

// Edge Functions pri prvom volani stahuju npm zavislosti (cold start).
describe.skipIf(!enabled)("faza C - overenie na serveri (lokalny Supabase)", { timeout: 120000 }, () => {
  let service, user, SNAPSHOT;
  const run = Date.now().toString(36);
  const empId = `emp-it-${run}`;

  async function newDoc(suffix) {
    const id = `doc-it-${run}-${suffix}`;
    const docxPath = `zamestnanci/${empId}/${id}.docx`;
    await service.storage.from(BUCKET).upload(docxPath, new Blob([fx("zmluva.docx")]), { contentType: "application/octet-stream" });
    const { error } = await service.from("hr_documents").insert({
      id, employee_id: empId, doc_type: "pracovni_smlouva", origin: "GENERATED", status: "READY_FOR_SIGNATURE",
      legal_act_type: "BILATERAL_CONTRACT", file_path: docxPath, variables_snapshot: SNAPSHOT,
    });
    if (error) throw error;
    return id;
  }
  async function finalize(id, pdfFile, pathOverride) {
    const p = pathOverride || `zamestnanci/${empId}/${id}/finalni-${run}-${pdfFile}`;
    const { error } = await user.storage.from(BUCKET).upload(p, new Blob([fx(pdfFile)], { type: "application/pdf" }), { contentType: "application/pdf" });
    if (error) throw error;
    const { data, error: fnErr } = await user.functions.invoke("hr-finalize-pdf", { body: { document_id: id, pdf_path: p } });
    return data || (await fnErr.context.json());
  }
  const row = async (id) => (await service.from("hr_documents").select("*").eq("id", id).single()).data;

  beforeAll(async () => {
    ({ SNAPSHOT } = await import("./__fixtures__/word_final_pdf/make_docx.mjs"));
    service = createClient(URL_, SERVICE, { auth: { persistSession: false } });
    user = createClient(URL_, ANON, { auth: { persistSession: false } });
    // testovacie prihlasenie z projektoveho seedu (supabase/seed.sql)
    const seed = fs.readFileSync(path.join(root, "supabase/seed.sql"), "utf8");
    const [, email, password] = seed.match(/(personalista@test\.local) \/ (\S+)/);
    const { error } = await user.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await service.from("employees").insert({ id: empId, first_name: "Jana", last_name: "Nováková-Testová", record_flag: "TEST" });
  });

  it("PDF z Wordu (zalomenia, delenie slov, NBSP) server overi a ulozi s vlastnym hashom", async () => {
    const id = await newDoc("ok");
    const r = await finalize(id, "zmluva.pdf");
    expect(r.ok).toBe(true);
    expect(r.sha256).toBe(await sha256Hex(fx("zmluva.pdf")));
    const d = await row(id);
    expect(d.final_pdf_sha256).toBe(r.sha256);
    expect(d.final_pdf_text_check.server_verified).toBe(true);
    expect(d.final_pdf_text_check.missing_keys).toEqual([]);
    expect(JSON.stringify(d.final_pdf_text_check)).not.toContain("32 500"); // ziadne hodnoty, len nazvy poli
  });

  it("ina mzda / ine meno: server odmietne a vrati nazov pola, DB sa nezmeni", async () => {
    const id = await newDoc("bad");
    const r1 = await finalize(id, "zmluva_ina_mzda.pdf");
    expect(r1.ok).toBe(false);
    expect(r1.check.missing_keys).toEqual(["mzda"]);
    const r2 = await finalize(id, "zmluva_ine_meno.pdf");
    expect(r2.check.missing_keys).toEqual(["jmeno"]);
    expect((await row(id)).final_pdf_sha256).toBeNull();
  });

  it("subor mimo priecinka dokumentu server odmietne", async () => {
    const id = await newDoc("path");
    const r = await finalize(id, "zmluva.pdf", `zamestnanci/${empId}/iny-dokument/finalni-${run}.pdf`);
    expect(r.check.reason).toBe("PATH_MISMATCH");
  });

  it("podvrhnuty hash / vysledok kontroly z prehliadaca DB odmietne", async () => {
    const id = await newDoc("forge");
    const { error } = await user.from("hr_documents").update({
      final_pdf_path: `zamestnanci/${empId}/${id}/x.pdf`, final_pdf_sha256: "a".repeat(64), finalized_at: new Date().toISOString(),
      final_pdf_text_check: { ok: true, server_verified: true, method: "pdftext-docx-snapshot-v2" },
    }).eq("id", id);
    expect(error?.message).toMatch(/jen server/);
    expect((await row(id)).final_pdf_sha256).toBeNull();
  });

  it("zmluva len s podpisom zamestnanca: server original nevytvori a nie je podpisana", async () => {
    const id = await newDoc("partial");
    expect((await finalize(id, "zmluva.pdf")).ok).toBe(true);
    const d = await row(id);
    const { data: lt } = await service.from("hr_legal_text_versions").select("id, body_sha256").eq("id", "lt-intent-bilateral-contract-v1").single();
    const imgId = `img-it-${run}-p`;
    await service.from("hr_signature_images").insert({ id: imgId, png: `\\x${Buffer.from(signaturePng(3)).toString("hex")}`, png_sha256: "x" });
    const { error: sErr } = await service.from("hr_document_signatures").insert({
      id: `sig-it-${run}-p`, hr_document_id: id, method: "ELECTRONIC_TABLET", signer_type: "EMPLOYEE", signed_by_name: "Jana Nováková-Testová",
      signed_content_sha256: d.final_pdf_sha256, signature_image_id: imgId, intent_text_version_id: lt.id, intent_text_sha256: lt.body_sha256,
    });
    expect(sErr).toBeNull();
    const { error } = await user.functions.invoke("hr-signed-original", { body: { document_id: id } });
    expect(error.context.status).toBe(409);
    expect((await error.context.json()).error).toMatch(/EMPLOYER/);
    const { error: stErr } = await user.from("hr_documents").update({ status: "SIGNED" }).eq("id", id);
    expect(stErr?.message).toMatch(/chybi: EMPLOYER/);
    const after = await row(id);
    expect([after.status, after.signed_pdf_path, !!after.locked_at]).toEqual(["READY_FOR_SIGNATURE", null, true]);
  });

  it("podpisany original: server ho postavi, overi a spocita hash; klient ho zapisat nemoze", async () => {
    const id = await newDoc("sign");
    expect((await finalize(id, "zmluva.pdf")).ok).toBe(true);
    const d = await row(id);
    const { data: lt } = await service.from("hr_legal_text_versions").insert({
      id: `lt-it-${run}`, text_key: "INTENT_BILATERAL_CONTRACT", version_no: Number(Date.now() % 100000), title: "Projev vůle",
      body: "KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU. Seznámil/a jsem se s celým obsahem a uzavírám tuto smlouvu.", body_sha256: "x",
    }).select().single();
    for (const [i, signer] of ["EMPLOYEE", "EMPLOYER"].entries()) {
      const imgId = `img-it-${run}-${i}`;
      const { error: iErr } = await service.from("hr_signature_images").insert({ id: imgId, png: `\\x${Buffer.from(PNG).toString("hex")}`, png_sha256: "x" });
      if (iErr) throw iErr;
      const { error: sErr } = await service.from("hr_document_signatures").insert({
        id: `sig-it-${run}-${i}`, hr_document_id: id, method: "ELECTRONIC_TABLET", signer_type: signer,
        signed_by_name: signer === "EMPLOYEE" ? "Jana Nováková-Testová" : "JUDr. Testovací Zástupce",
        signed_content_sha256: d.final_pdf_sha256, signature_image_id: imgId,
        intent_text_version_id: lt.id, intent_text_sha256: lt.body_sha256, evidence: { all_pages_viewed: true },
      });
      if (sErr) throw sErr;
    }
    const { error: forgeErr } = await user.from("hr_documents").update({ signed_pdf_path: "x.pdf", signed_pdf_sha256: "f".repeat(64) }).eq("id", id);
    expect(forgeErr?.message).toMatch(/jen server/);

    const { data, error } = await user.functions.invoke("hr-signed-original", { body: { document_id: id } });
    if (error) throw new Error(JSON.stringify(await error.context.json()));
    expect(data.ok).toBe(true);
    const after = await row(id);
    expect(after.status).toBe("SIGNED");
    const { data: blob } = await service.storage.from(BUCKET).download(after.signed_pdf_path);
    const signed = new Uint8Array(await blob.arrayBuffer());
    expect(await sha256Hex(signed)).toBe(after.signed_pdf_sha256); // hash spocital server spravne
    const { data: sigs } = await service.from("hr_document_signatures").select("*").eq("hr_document_id", id);
    const v = await verifySignedOriginal({
      signedBytes: signed, finalBytes: fx("zmluva.pdf"), finalSha256: after.final_pdf_sha256,
      signatures: sigs, extractPages: extractPdfPages, normalize: normalizeForMatch,
    });
    expect(v).toEqual({ ok: true, problems: [] });
  });
});
