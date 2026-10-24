// Kym jednatel neschvali texty prejavu vole (migracia 66), podpis na tablete
// je neaktivny a UI to jasne vysvetli; papierovy postup ostava ponuknuty.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { approveTextsForTest } from "../src/lib/hr/itApprovedTexts.js";

const URL_ = process.env.LOCAL_SUPABASE_URL;
const SERVICE = process.env.LOCAL_SUPABASE_SERVICE_KEY;
const enabled = !!(URL_ && SERVICE && /^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_ || ""));
const run = Date.now().toString(36);

test.skip(!enabled, "chyba lokalny Supabase (scripts/test-local-e2e.sh)");

// len § 21 (aby vznikol dokument); prejavy vole ostavaju koncept
let approved;
test.beforeAll(async () => {
  if (enabled) approved = await approveTextsForTest(createClient(URL_, SERVICE, { auth: { persistSession: false } }), ["S21_ADDRESS_NOTICE"], run);
});
test.afterAll(async () => { await approved?.cleanup(); });

test("bez schvalenych textov: podpis na tablete neaktivny s vysvetlenim", async ({ page }) => {
  const service = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  const seed = fs.readFileSync(path.resolve("supabase/seed.sql"), "utf8");
  const [, email, password] = seed.match(/(personalista@test\.local) \/ (\S+)/);
  const last = `Čekající${run}`;
  await service.from("employees").insert({ id: `emp-e2e-esign-${run}`, first_name: "Ema", last_name: last, record_flag: "TEST", private_email: `ema.${run}@example.test` });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: /Personalistika, kvalita a kontroly/ }).click();
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/heslo/i).fill(password);
  await page.getByRole("button", { name: /přihlásit/i }).click();
  await page.locator("nav button", { hasText: "Personalistika" }).click();
  await page.getByRole("row", { name: new RegExp(last) }).click();
  await page.getByRole("button", { name: "Dokumenty", exact: true }).click();
  await page.getByRole("button", { name: /Prohlášení \(§ 21 \/ § 335\)/ }).click();
  await page.getByRole("button", { name: /Oznámení elektronické adresy \(§ 21\)/ }).click();

  await expect(page.getByRole("button", { name: "Podepsat na tabletu" })).toBeDisabled({ timeout: 30000 });
  await expect(page.getByText("Elektronický podpis čeká na schválení textů – použijte papírový postup.").first()).toBeVisible();
});
