// Pracovni smlouva zo sablony v DB (migracia 59): vzor = aktualna verzia
// sablony tpl-ps / tpl-ps-cizinec, subor sa pouzije len ked sedi jeho
// SHA-256 s content_hash verzie. Ak subor v ulozisku este nie je (prve
// pouzitie po nasadeni), vezme sa dodany vzor z public/ - opat len pri
// zhodnom otlacku - a ulozi sa na file_path verzie.
import { PS_TEMPLATES } from "./pracovniSmlouva.js";
import { sha256Hex } from "./documentHash.js";

const HR_DOKUMENTY_BUCKET = "hr-dokumenty";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PS_TEMPLATE_IDS = { pracovni_smlouva: "tpl-ps", pracovni_smlouva_cizinec: "tpl-ps-cizinec" };
export const isPsDocType = (docType) => Object.prototype.hasOwnProperty.call(PS_TEMPLATE_IDS, docType);

async function bundledTemplate(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("Nepodařilo se načíst vzor smlouvy.");
  return r.arrayBuffer();
}

export async function loadPsTemplate(supabase, variant, { fetchBundled = bundledTemplate } = {}) {
  const templateId = PS_TEMPLATE_IDS[variant];
  if (!templateId) throw new Error("Neznámý vzor smlouvy.");
  const { data: template, error: tErr } = await supabase.from("hr_document_templates").select("*").eq("id", templateId).maybeSingle();
  if (tErr) throw tErr;
  if (!template || template.status !== "SCHVALENA" || !template.current_version_id) throw new Error("Šablona smlouvy není schválená.");
  const { data: version, error: vErr } = await supabase.from("hr_document_template_versions").select("*").eq("id", template.current_version_id).single();
  if (vErr) throw vErr;
  if (!version.content_hash) throw new Error("Verze šablony nemá otisk.");

  const { data: file } = await supabase.storage.from(HR_DOKUMENTY_BUCKET).download(version.file_path);
  if (file) {
    const bytes = await file.arrayBuffer();
    if ((await sha256Hex(bytes)) !== version.content_hash) throw new Error("Soubor šablony nesouhlasí s otiskem verze – nepoužito.");
    return { bytes, template, version, source: "storage" };
  }
  const bytes = await fetchBundled(PS_TEMPLATES[variant].url);
  if ((await sha256Hex(bytes)) !== version.content_hash) throw new Error("Šablona není v úložišti a dodaný vzor nesouhlasí s otiskem verze.");
  // Doplnenie do ulozista (bez prepisu); chyba nevadi - subor overeny otlackom.
  await supabase.storage.from(HR_DOKUMENTY_BUCKET).upload(version.file_path, new Blob([bytes], { type: DOCX_MIME }), { contentType: DOCX_MIME, upsert: false });
  return { bytes, template, version, source: "bundle" };
}

// Ulozi vyplnenu zmluvu k podpisu vratane verzie sablony.
export async function savePsDocument(supabase, { docId, employeeId, employmentId, variant, data, bytes, template, version, userId }) {
  const storagePath = `zamestnanci/${employeeId}/${docId}.docx`;
  const { error: upErr } = await supabase.storage.from(HR_DOKUMENTY_BUCKET).upload(storagePath, new Blob([bytes], { type: DOCX_MIME }), { contentType: DOCX_MIME });
  if (upErr) throw upErr;
  const { error: insErr } = await supabase.from("hr_documents").insert({
    id: docId, employee_id: employeeId, employment_id: employmentId || null, doc_type: variant,
    template_id: template.id, template_version_id: version.id,
    origin: "GENERATED", status: "READY_FOR_SIGNATURE", generated_at: new Date().toISOString(), generated_by: userId || null,
    file_path: storagePath, variables_snapshot: data,
  });
  if (insErr) throw insErr;
  return storagePath;
}
