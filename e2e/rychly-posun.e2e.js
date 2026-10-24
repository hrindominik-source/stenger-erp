// Rychly posun v prehliadaci PDF (4 strany, vymyslene udaje): strana sa
// pocita ako prezreta, ked ju posun presiel - aj ked sa v okne nezastavila.
//  - velke kroky koleckom (1 krok preskoci celu stranu),
//  - svihnutie prstom na dotykovom zariadeni (zotrvacny posun).
// Z rucneho testu: pri rychlom posune ostalo pocitadlo na „3 z 4“.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts } from "pdf-lib";

const URL_ = process.env.LOCAL_SUPABASE_URL;
const ANON = process.env.LOCAL_SUPABASE_ANON_KEY;
const SERVICE = process.env.LOCAL_SUPABASE_SERVICE_KEY;
const enabled = !!(URL_ && ANON && SERVICE && /^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_ || ""));
const run = Date.now().toString(36);

let service, hr;

async function fourPagePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 4; i++) {
    const p = pdf.addPage([595, 842]);
    p.drawText(`Popis pracovniho mista (test rychleho posunu) - strana ${i} ze 4`, { x: 60, y: 760, size: 14, font });
    for (let r = 0; r < 30; r++) p.drawText(`Clanek ${i}.${r + 1} - vymysleny text pro test.`, { x: 60, y: 720 - r * 20, size: 10, font });
  }
  return pdf.save();
}

// potvrdenie o prevzati (bez § 21) k podpisu (finalne PDF overene serverom) + podpisovy odkaz z hr-signing
async function issueFourPages(suffix) {
  const empId = `emp-e2e-rp-${run}-${suffix}`;
  const docId = `doc-e2e-rp-${run}-${suffix}`;
  await service.from("employees").insert({ id: empId, first_name: "Iva", last_name: `Rychlá${run}`, record_flag: "TEST" });
  const bytes = await fourPagePdf();
  const finalPath = `zamestnanci/${empId}/${docId}/finalni.pdf`;
  await service.storage.from("hr-dokumenty").upload(finalPath, new Blob([bytes], { type: "application/pdf" }), { contentType: "application/pdf" });
  const { error } = await service.from("hr_documents").insert({
    id: docId, employee_id: empId, doc_type: "popis_pracovniho_mista", origin: "GENERATED", status: "READY_FOR_SIGNATURE",
    final_pdf_path: finalPath, final_pdf_sha256: crypto.createHash("sha256").update(bytes).digest("hex"), finalized_at: new Date().toISOString(),
    final_pdf_text_check: { ok: true, server_verified: true, method: "e2e-test", pages: 4 },
  });
  if (error) throw error;
  const { data, error: iErr } = await hr.functions.invoke("hr-signing", {
    body: { action: "issue", document_id: docId, identity: { document_type: "OP", confirmed: true } },
  });
  if (iErr) throw new Error(`issue: ${iErr.context?.status} ${await iErr.context?.text?.()}`);
  return data;
}

async function openOnTablet(page, suffix) {
  const { token, code } = await issueFourPages(suffix);
  await page.goto(`/?podpis=${token}`);
  await page.getByLabel("Kód").fill(code);
  await page.getByRole("button", { name: "Pokračovat" }).click();
  await expect(page.locator("[data-rendered=true]")).toHaveCount(4, { timeout: 30000 });
  const counter = page.getByText(/Zobrazeno \d+ z 4 stran/);
  await expect(counter).toHaveText(/Zobrazeno [01] z 4 stran/);
  return counter;
}

test.describe("rychly posun – kazda presla strana sa zapocita", () => {
  test.skip(!enabled, "chyba lokalny Supabase (scripts/test-local-e2e.sh)");

  test.beforeAll(async () => {
    service = createClient(URL_, SERVICE, { auth: { persistSession: false } });
    const seed = fs.readFileSync(path.resolve("supabase/seed.sql"), "utf8");
    const [, email, password] = seed.match(/(personalista@test\.local) \/ (\S+)/);
    hr = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { error } = await hr.auth.signInWithPassword({ email, password });
    if (error) throw error;
  });

  test("velke kroky koleckom: posun preskoci strany 2 a 3 naraz", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    const counter = await openOnTablet(page, "wheel");
    const box = page.locator("[data-pdf-scroll]");
    await box.scrollIntoViewIfNeeded();
    const bb = await box.boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + 40);
    // dva obrie kroky - medzi nimi sa ziadna strana v okne nezastavi
    await page.mouse.wheel(0, 2600);
    await page.mouse.wheel(0, 20000);
    await expect(counter).toHaveText("Zobrazeno 4 z 4 stran", { timeout: 5000 });
  });

  test("svihnutie prstom na dotykovom zariadeni", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const counter = await openOnTablet(page, "touch");
    const box = page.locator("[data-pdf-scroll]");
    await box.scrollIntoViewIfNeeded();
    const bb = await box.boundingBox();
    // svihnutie prstom: rychly tah zdola nahor a pustenie (dotykove udalosti
    // prehliadaca -> nativny posun so zotrvacnostou)
    const cdp = await ctx.newCDPSession(page);
    const x = Math.round(bb.x + bb.width / 2);
    const y0 = Math.round(bb.y + bb.height * 0.85), y1 = Math.round(bb.y + bb.height * 0.1);
    const atEnd = () => page.evaluate(() => { const b = document.querySelector("[data-pdf-scroll]"); return b.scrollTop + b.clientHeight >= b.scrollHeight - 2; });
    for (let n = 0; n < 12 && !(await atEnd()); n++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y0 }] });
      for (let k = 1; k <= 6; k++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: Math.round(y0 + ((y1 - y0) * k) / 6) }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(150);
    }
    expect(await atEnd()).toBe(true);
    await expect(counter).toHaveText("Zobrazeno 4 z 4 stran", { timeout: 5000 });
    await ctx.close();
  });
});
