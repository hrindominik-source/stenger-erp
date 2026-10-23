import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadPsTemplate, isPsDocType } from "./psTemplates.js";
import { sha256Hex } from "./documentHash.js";

const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const vzor = ab(readFileSync(new URL("../../../public/hr/sablony/pracovni_smlouva.docx", import.meta.url)));

// Falosny klient: sablona + verzia, ulozisko s danym obsahom (null = subor chyba).
function fakeClient({ stored, hash, status = "SCHVALENA" }) {
  const uploads = [];
  const rows = {
    hr_document_templates: { id: "tpl-ps", status, current_version_id: "tpl-ps-v1" },
    hr_document_template_versions: { id: "tpl-ps-v1", version_number: 1, file_path: "sablony/tpl-ps/v1.docx", content_hash: hash },
  };
  const q = (t) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: rows[t] }), single: async () => ({ data: rows[t] }) }) }) });
  return {
    uploads,
    from: q,
    storage: { from: () => ({
      download: async () => (stored ? { data: new Blob([stored]) } : { data: null, error: { message: "not found" } }),
      upload: async (p) => { uploads.push(p); return {}; },
    }) },
  };
}

describe("vzor pracovnej zmluvy zo sablony", async () => {
  const hash = await sha256Hex(vzor);
  it("prve pouzitie: dodany vzor so zhodnym otlackom, ulozi sa na file_path", async () => {
    const c = fakeClient({ stored: null, hash });
    const t = await loadPsTemplate(c, "pracovni_smlouva", { fetchBundled: async () => vzor });
    expect(t.source).toBe("bundle");
    expect(c.uploads).toEqual(["sablony/tpl-ps/v1.docx"]);
  });
  it("dodany vzor s inym otlackom sa odmietne", async () => {
    const c = fakeClient({ stored: null, hash: "0".repeat(64) });
    await expect(loadPsTemplate(c, "pracovni_smlouva", { fetchBundled: async () => vzor })).rejects.toThrow(/nesouhlasí s otiskem/);
    expect(c.uploads).toEqual([]);
  });
  it("subor v ulozisku s inym obsahom sa odmietne", async () => {
    const c = fakeClient({ stored: "podvrh", hash });
    await expect(loadPsTemplate(c, "pracovni_smlouva")).rejects.toThrow(/nesouhlasí s otiskem/);
  });
  it("neschvalena sablona sa nepouzije", async () => {
    await expect(loadPsTemplate(fakeClient({ stored: null, hash, status: "VYRAZENA" }), "pracovni_smlouva")).rejects.toThrow(/není schválená/);
  });
  it("typy zmluvy su mimo generickeho generovania", () => {
    expect(isPsDocType("pracovni_smlouva_cizinec")).toBe(true);
    expect(isPsDocType("mzdovy_vymer")).toBe(false);
  });
});

describe("nova verzia vzoru zmluvy", () => {
  it("dnesne vzory pouzivaju len znacky generatora zmluvy", async () => {
    const { validateTemplateKeysAgainstAllowlist } = await import("./docxTemplate.js");
    const { PS_TEMPLATE_KEYS } = await import("./pracovniSmlouva.js");
    for (const f of ["pracovni_smlouva", "pracovni_smlouva_cizinec"]) {
      const b = ab(readFileSync(new URL(`../../../public/hr/sablony/${f}.docx`, import.meta.url)));
      expect(validateTemplateKeysAgainstAllowlist(b, PS_TEMPLATE_KEYS)).toMatchObject({ ok: true, unknown: [] });
    }
  });
});
