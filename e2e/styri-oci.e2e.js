// Balik E (migracia 71): personalistka poziada jednatela o schvalenie podpisu
// upravenej zmluvy (verzia 2) za zamestnavatela; jednatel v prehlade schvali; podpis sa
// personalistke odomkne. Vymyslene udaje.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { prepareMfa, completeMfa } from "./mfa.js";
import { approveTextsForTest, ESIGN_TEXT_KEYS } from "../src/lib/hr/itApprovedTexts.js";

const URL_ = process.env.LOCAL_SUPABASE_URL;
const SERVICE = process.env.LOCAL_SUPABASE_SERVICE_KEY;
const enabled = !!(URL_ && SERVICE && /^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_ || ""));
const run = Date.now().toString(36);
const service = () => createClient(URL_, SERVICE, { auth: { persistSession: false } });
const password = () => fs.readFileSync(path.resolve("supabase/seed.sql"), "utf8").match(/hr\.admin@test\.local \/ (\S+)/)[1];

// texty prejavu vole su koncept - docasne schvalenie len pre test
let approvedTexts;
test.beforeAll(async () => {
  if (enabled) approvedTexts = await approveTextsForTest(service(), ESIGN_TEXT_KEYS, run);
});
test.afterAll(async () => { await approvedTexts?.cleanup(); });
test.skip(!enabled, "chyba lokalny Supabase (scripts/test-local-e2e.sh)");
test.use({ actionTimeout: 20000 });

async function login(page, email) {
  await prepareMfa(email);
  await page.goto("/");
  await page.getByRole("button", { name: /Personalistika, kvalita a kontroly/ }).click();
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/heslo/i).fill(password());
  await page.getByRole("button", { name: /přihlásit/i }).click();
  await page.locator("nav button", { hasText: "Personalistika" }).click();
  await completeMfa(page);
}

test("podpis upravenej zmluvy: ziadost personalistky, schvalenie jednatelom", async ({ page, browser }) => {
  test.setTimeout(180000);
  const s = service();
  const last = `Schvalovaný${run}`;
  const empId = `emp-e2e-oci-${run}`;
  const docId = `doc-e2e-oci-${run}`;
  await s.from("employees").insert({ id: empId, first_name: "Ota", last_name: last, record_flag: "TEST" });
  const { error: dErr } = await s.from("hr_documents").insert({
    id: docId, employee_id: empId, doc_type: "pracovni_smlouva", origin: "GENERATED", status: "READY_FOR_SIGNATURE", version_no: 2,
    final_pdf_path: `zamestnanci/${empId}/${docId}/finalni.pdf`, final_pdf_sha256: "f".repeat(64), finalized_at: new Date().toISOString(),
    final_pdf_text_check: { ok: true, server_verified: true, method: "e2e-test", pages: 1 },
  });
  if (dErr) throw dErr;

  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page, "personalistka@test.local");
  await page.getByRole("row", { name: new RegExp(last) }).click();
  await page.getByRole("button", { name: "Dokumenty", exact: true }).click();
  await page.getByRole("button", { name: /Detail – vytvoření, podpis/ }).first().click();
  const sign = page.getByRole("button", { name: "Podepsat za zaměstnavatele" });
  await expect(sign).toBeDisabled();
  const box = page.getByTestId("approval-box").filter({ hasText: "Podpis za zaměstnavatele" });
  await box.getByRole("button", { name: "Požádat jednatele o schválení" }).click();
  await box.getByLabel("Důvod žádosti").fill("Smlouva upravená podle dohody – e2e");
  await box.getByRole("button", { name: "Odeslat žádost" }).click();
  await expect(box.getByTestId("approval-status")).toContainText("čeká na jednatele");

  // jednatel v druhom okne
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await ctx.newPage();
  await login(admin, "hr.admin@test.local");
  await admin.getByRole("button", { name: "Pro jednatele" }).click();
  const row = admin.getByTestId("konatel-approval-row").filter({ hasText: last });
  await expect(row).toContainText("Smlouva upravená podle dohody – e2e");
  await row.getByRole("button", { name: "Schválit" }).click();
  await row.getByRole("button", { name: "Potvrdit schválení" }).click();
  await expect(row).toHaveCount(0, { timeout: 15000 });
  await ctx.close();

  const { data } = await s.from("hr_approval_requests").select("status, decided_by").eq("entity_id", docId).single();
  expect(data.status).toBe("APPROVED");
  expect(data.decided_by).toBeTruthy();

  // personalistke sa podpis odomkne (box zmizne) - detail zavriet a otvorit = nove nacitanie
  const detail = page.getByRole("button", { name: /Detail – vytvoření, podpis/ }).first();
  await detail.click();
  await detail.click();
  await expect(page.getByRole("button", { name: "Podepsat za zaměstnavatele" })).toBeEnabled({ timeout: 15000 });
  await expect(page.getByTestId("approval-box")).toHaveCount(0);
});
