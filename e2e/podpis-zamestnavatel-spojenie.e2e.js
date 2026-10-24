// Podpis za zamestnavatela (hr.admin, plna moc Mgr. Jana Zkusebni) pri strate
// spojenia v skutocnom prehliadaci:
//  1. poziadavka sa na server nedostane -> „Podpis se neuložil, zkuste znovu“;
//  2. server podpis ulozi, odpoved sa strati -> klient overi stav na serveri,
//     ukaze „Podpis byl uložen“ a dokument dokonci (podpisany original, SIGNED).
// Dokument (vymyslene udaje) pripravi test ako integracne testy: finalne PDF
// overene serverom + papierovy podpis zamestnanca.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { approveTextsForTest, ESIGN_TEXT_KEYS } from "../src/lib/hr/itApprovedTexts.js";
import { PDFDocument, StandardFonts } from "pdf-lib";

const URL_ = process.env.LOCAL_SUPABASE_URL;
const SERVICE = process.env.LOCAL_SUPABASE_SERVICE_KEY;
const enabled = !!(URL_ && SERVICE && /^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_ || ""));
const run = Date.now().toString(36);

// texty prejavu vole su od migracie 66 koncept - docasne schvalenie len pre test
let approvedTexts;
test.beforeAll(async () => {
  if (enabled) approvedTexts = await approveTextsForTest(createClient(URL_, SERVICE, { auth: { persistSession: false } }), ESIGN_TEXT_KEYS, run);
});
test.afterAll(async () => { await approvedTexts?.cleanup(); });
const SIGNATORY = "Mgr. Jana Zkušební";

test.skip(!enabled, "chyba lokalny Supabase (scripts/test-local-e2e.sh)");
test.use({ actionTimeout: 20000 });

async function contractPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const text of ["Pracovni smlouva (test spojeni)", "Strana 2 - podpisy"]) {
    pdf.addPage([595, 842]).drawText(text, { x: 60, y: 760, size: 14, font });
  }
  return pdf.save();
}

test("strata spojenia pri podpise za zamestnavatela: klient ukaze pravdu a dokument dokonci", async ({ page }) => {
  test.setTimeout(180000);
  const service = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  const seed = fs.readFileSync(path.resolve("supabase/seed.sql"), "utf8");
  const [, email, password] = seed.match(/(hr\.admin@test\.local) \/ (\S+)/);
  const last = `Spojená${run}`;
  const empId = `emp-e2e-sp-${run}`;
  const docId = `doc-e2e-sp-${run}`;
  await service.from("employees").insert({ id: empId, first_name: "Olga", last_name: last, record_flag: "TEST" });
  const bytes = await contractPdf();
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  const finalPath = `zamestnanci/${empId}/${docId}/finalni-${run}.pdf`;
  await service.storage.from("hr-dokumenty").upload(finalPath, new Blob([bytes], { type: "application/pdf" }), { contentType: "application/pdf" });
  const { error: dErr } = await service.from("hr_documents").insert({
    id: docId, employee_id: empId, doc_type: "pracovni_smlouva", origin: "GENERATED", status: "READY_FOR_SIGNATURE",
    final_pdf_path: finalPath, final_pdf_sha256: sha, finalized_at: new Date().toISOString(),
    final_pdf_text_check: { ok: true, server_verified: true, method: "e2e-test", pages: 2 }, variables_snapshot: { zastupce: SIGNATORY },
  });
  if (dErr) throw dErr;
  const { error: sErr } = await service.from("hr_document_signatures").insert({ id: `sig-e2e-sp-${run}`, hr_document_id: docId, method: "PAPER",
    signer_type: "EMPLOYEE", signed_by_name: `Olga ${last}`, document_hash: "e".repeat(64), file_path: `zamestnanci-podpisy/${docId}-e2e.pdf` });
  if (sErr) throw sErr;

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: /Personalistika, kvalita a kontroly/ }).click();
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/heslo/i).fill(password);
  await page.getByRole("button", { name: /přihlásit/i }).click();
  await page.locator("nav button", { hasText: "Personalistika" }).click();
  await page.getByRole("row", { name: new RegExp(last) }).click();
  await page.getByRole("button", { name: "Dokumenty", exact: true }).click();
  await page.getByRole("button", { name: /Detail – vytvoření, podpis/ }).first().click();
  await page.getByRole("button", { name: "Podepsat za zaměstnavatele" }).click();

  // projst PDF, potvrdit, podepsat
  const box = page.locator("[data-pdf-scroll]");
  await expect(page.locator("[data-rendered=true]")).toHaveCount(2, { timeout: 30000 });
  const bb = await box.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + 100);
  for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(40); }
  await page.getByRole("checkbox").check();
  const pad = page.getByLabel("Podpisové pole");
  await pad.scrollIntoViewIfNeeded();
  const pb = await pad.boundingBox();
  await page.mouse.move(pb.x + 20, pb.y + 20);
  await page.mouse.down();
  for (let i = 1; i <= 15; i++) await page.mouse.move(pb.x + 20 + i * 12, pb.y + 20 + (i % 5) * 8);
  await page.mouse.up();
  const signBtn = page.getByRole("button", { name: "Podepsat", exact: true });
  await expect(signBtn).toBeEnabled();

  // 1. spojenie spadne PRED serverom
  let mode = "before";
  await page.route("**/functions/v1/hr-signing", async (route) => {
    const action = route.request().postDataJSON()?.action;
    if (action !== "employer_sign" || mode === "pass") return route.continue();
    if (mode === "before") return route.abort("connectionreset");
    await route.fetch(); // server podpis ulozi ...
    mode = "pass";
    return route.abort("connectionreset"); // ... ale odpoved sa k prehliadacu nedostane
  });
  await signBtn.click();
  await expect(page.getByText("Podpis se neuložil, zkuste to znovu.")).toBeVisible();
  const sigs = async () => (await service.from("hr_document_signatures").select("id").eq("hr_document_id", docId).eq("signer_type", "EMPLOYER")).data.length;
  expect(await sigs()).toBe(0);

  // 2. server ulozi, odpoved sa strati
  mode = "after";
  await signBtn.click();
  await expect(page.getByTestId("sign-result")).toHaveText("Podpis byl uložen.", { timeout: 30000 });
  await expect(page.getByText("Dokument je podepsán všemi stranami.")).toBeVisible({ timeout: 60000 });
  expect(await sigs()).toBe(1);
  const { data: d } = await service.from("hr_documents").select("status, signed_pdf_path").eq("id", docId).single();
  expect(d.status).toBe("SIGNED");
  expect(d.signed_pdf_path).toBeTruthy();
  // detail rozlisuje sposob: prihlaseny pouzivatel na svojej obrazovke, nie tablet
  await page.getByRole("button", { name: "Hotovo" }).click();
  await expect(page.getByText(/elektronicky – přihlášený uživatel/)).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/papír \(sken\)/)).toBeVisible();
});
