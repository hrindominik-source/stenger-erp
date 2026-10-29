// Migracia 78: zmena cisla uctu -> upozornenie jednatelovi (len posledne 4
// cislice a kto zmenil) a oznacenie v mzdovych udajoch, kym ho uctovnicka
// alebo jednatel nepotvrdi. Vymyslene udaje.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { prepareMfa, completeMfa } from "./mfa.js";

const URL_ = process.env.LOCAL_SUPABASE_URL;
const SERVICE = process.env.LOCAL_SUPABASE_SERVICE_KEY;
const enabled = !!(URL_ && SERVICE && /^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_ || ""));
const run = Date.now().toString(36);
const service = () => createClient(URL_, SERVICE, { auth: { persistSession: false } });
const password = () => fs.readFileSync(path.resolve("supabase/seed.sql"), "utf8").match(/hr\.admin@test\.local \/ (\S+)/)[1];

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

test("zmena uctu: jednatel upozorneny, uctovnicka overi a potvrdi", async ({ page }) => {
  test.setTimeout(150000);
  const s = service();
  const last = `Účtová${run}`;
  const empId = `emp-e2e-ucet-${run}`;
  await s.from("employees").insert({ id: empId, first_name: "Uršula", last_name: last, record_flag: "TEST", active: true });
  await s.from("employment_relationships").insert({ id: `er-e2e-ucet-${run}`, employee_id: empId, status: "ACTIVE",
    employment_type: "doba_neurcita", start_date: "2026-01-01", weekly_hours: 40 });
  // zmena zo servera (napr. kiosk)
  const { error } = await s.from("employee_sensitive_data").insert({ employee_id: empId, bank_account: "123456789/0100" });
  if (error) throw error;
  const { data: n } = await s.from("hr_notifications").select("title, data").eq("event_type", "BANK_ACCOUNT_CHANGED").eq("entity_id", empId).single();
  expect(n.title).toContain("končí …6789");
  expect(JSON.stringify(n)).not.toContain("12345");

  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page, "ucetni@test.local");
  await expect(page.getByText(new RegExp(`${last}.*Účet změněn od poslední výplaty – ověřte`)).first()).toBeVisible({ timeout: 20000 });
  await page.getByRole("row", { name: new RegExp(last) }).click();
  await page.getByRole("button", { name: "Mzdové podmínky", exact: true }).click();
  const box = page.getByTestId("bank-account-check");
  await expect(box).toContainText("Účet změněn od poslední výplaty – ověřte");
  await expect(box).toContainText("…6789");
  await expect(box).not.toContainText("12345");
  await box.getByRole("button", { name: /Ověřeno/ }).click();
  await expect(page.getByTestId("bank-account-check")).toHaveCount(0, { timeout: 15000 });
  const { data: c } = await s.from("hr_bank_account_checks").select("confirmed_at").eq("employee_id", empId).single();
  expect(c.confirmed_at).not.toBeNull();
});
