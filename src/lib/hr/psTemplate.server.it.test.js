// Integracny test migracie 59: pracovna zmluva zo sablony v DB je obsahovo
// zhodna so zmluvou z povodneho vzoru (public/) z tych istych vymyslenych
// udajov a novy dokument ma ulozenu verziu sablony. Proti LOKALNEMU Supabase.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import { createClient } from "@supabase/supabase-js";
import { fillDocxTemplate } from "./docxTemplate.js";
import { buildPsData } from "./pracovniSmlouva.js";
import { loadPsTemplate, savePsDocument } from "./psTemplates.js";

const URL_ = process.env.LOCAL_SUPABASE_URL;
const ANON = process.env.LOCAL_SUPABASE_ANON_KEY;
const SERVICE = process.env.LOCAL_SUPABASE_SERVICE_KEY;
const enabled = !!(URL_ && ANON && SERVICE && /^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_ || ""));
const root = path.resolve(__dirname, "../../..");
const BUCKET = "hr-dokumenty";

const readPublic = (variant) => {
  const b = fs.readFileSync(path.join(root, `public/hr/sablony/${variant}.docx`));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const fetchBundled = async (url) => readPublic(url.match(/(pracovni_smlouva(?:_cizinec)?)\.docx$/)[1]);
const docText = (ab) => new PizZip(ab).file("word/document.xml").asText();

// Vymyslene udaje (rovnake pred aj po presune).
const SIG = { full_name: "Mgr. Jana Zkušební", full_name_instrumental: "Mgr. Janou Zkušební" };
const values = {
  title: "Ing.", first_name: "Petra", last_name: "Šablonová", gender: "zena", date_of_birth: "1991-04-02", place_of_birth: "Příbram",
  nationality: "Česká republika", birth_number: "915402/1234", rodinny_stav: "svobodna", id_document_number: "987654321",
  perm_ulice: "Krátká", perm_cp: "5", perm_obec: "Příbram", perm_psc: "26101", phone: "+420 777 000 111", private_email: "petra@example.test",
  health_insurance_company: "111", bank_account: "123456789/0100", pozice_kategorie: "HI-001", nazev_pozice: "dělnice",
  start_date: "2026-11-02", zkusebni_doba_mesice: "3", employment_type: "doba_neurcita", weekly_hours: "40",
};
const foreign = { ...values, nationality: "Ukrajina", birth_number: "", passport_number: "FX123456", foreigner_status: "docasna_ochrana" };

describe.skipIf(!enabled)("migracia 59 - vzor pracovnej zmluvy ako sablona (lokalny Supabase)", { timeout: 60000 }, () => {
  let service, hr;
  const run = Date.now().toString(36);
  const empId = `emp-ps-${run}`;

  beforeAll(async () => {
    service = createClient(URL_, SERVICE, { auth: { persistSession: false } });
    const seed = fs.readFileSync(path.join(root, "supabase/seed.sql"), "utf8");
    const [, login, password] = seed.match(/(personalista@test\.local) \/ (\S+)/);
    hr = createClient(URL_, ANON, { auth: { persistSession: false } });
    if ((await hr.auth.signInWithPassword({ email: login, password })).error) throw new Error("login");
    await service.from("employees").insert({ id: empId, first_name: "Petra", last_name: "Šablonová", record_flag: "TEST" });
  });

  for (const [variant, v] of [["pracovni_smlouva", values], ["pracovni_smlouva_cizinec", foreign]]) {
    it(`${variant}: obsah zhodny pred a po presune, ulozena verzia sablony`, async () => {
      const data = buildPsData(v, { podepisujici: SIG, datumPodpisu: "2026-10-30", povinnosti: "Testovací povinnosti." });
      const before = docText(fillDocxTemplate(readPublic(variant), data));

      const t = await loadPsTemplate(hr, variant, { fetchBundled });
      expect(t.version).toMatchObject({ version_number: 1, mapping_status: "SCHVALENA" });
      const after = docText(fillDocxTemplate(t.bytes, data));
      expect(after).toBe(before);
      expect(after).toContain("Šablonová");

      // druhe nacitanie uz zo ulozista (subor doplneny pri prvom pouziti)
      const again = await loadPsTemplate(hr, variant, { fetchBundled: async () => { throw new Error("nema sa pouzit"); } });
      expect(again.source).toBe("storage");
      expect(docText(fillDocxTemplate(again.bytes, data))).toBe(before);

      const docId = `ps-${variant}-${run}`;
      await savePsDocument(hr, { docId, employeeId: empId, variant, data, bytes: fillDocxTemplate(t.bytes, data), template: t.template, version: t.version });
      const { data: row } = await service.from("hr_documents").select("*").eq("id", docId).single();
      expect(row).toMatchObject({ doc_type: variant, template_id: t.template.id, template_version_id: t.version.id, origin: "GENERATED" });
      const { data: file } = await service.storage.from(BUCKET).download(row.file_path);
      expect(docText(await file.arrayBuffer())).toBe(before);
    });
  }

  it("ulozeny vzor sa neda prepisat", async () => {
    const { error } = await hr.storage.from(BUCKET).upload("sablony/tpl-ps/v1.docx", new Blob(["podvrh"]), { upsert: true });
    expect(error).toBeTruthy();
    const t = await loadPsTemplate(hr, "pracovni_smlouva", { fetchBundled });
    expect(t.source).toBe("storage");
  });
});
