// Balik D (migracia 70): jednatel doplni zakonny parameter; karta zamestnanca
// ukaze zakonny limit (blok) a po oprave udajov zmizne.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { prepareMfa, completeMfa } from "./mfa.js";

const enabled = !!process.env.LOCAL_SUPABASE_URL;
test.skip(!enabled, "chyba lokalny Supabase (scripts/test-local-e2e.sh)");

const password = () => fs.readFileSync(path.resolve("supabase/seed.sql"), "utf8").match(/hr\.admin@test\.local \/ (\S+)/)[1];
const service = () => createClient(process.env.LOCAL_SUPABASE_URL, process.env.LOCAL_SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

async function login(page, email) {
  await page.goto("/");
  await page.getByRole("button", { name: /Personalistika, kvalita a kontroly/ }).click();
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/heslo/i).fill(password());
  await page.getByRole("button", { name: /přihlásit/i }).click();
  await page.locator("nav button", { hasText: "Personalistika" }).click();
}

test("jednatel doplni prazdny parameter so zdrojom", async ({ page }) => {
  const s = service();
  await s.from("hr_legal_parameters").update({ value: null, source: null }).eq("key", "BOZP_TRAINING_INTERVAL");
  await prepareMfa("hr.admin@test.local");
  await login(page, "hr.admin@test.local");
  await completeMfa(page);
  await page.getByRole("button", { name: "Pro jednatele" }).click();
  const box = page.getByTestId("legal-parameters");
  await expect(box.getByTestId("legal-param-row").filter({ hasText: "Minimální mzda – měsíční" })).toContainText("22400 Kč/měsíc");
  const row = box.getByTestId("legal-param-row").filter({ hasText: "Lhůta opakování školení BOZP" });
  await expect(row).toContainText("nevyplněno");
  await row.getByRole("button", { name: "Doplnit" }).click();
  const form = box.getByTestId("legal-param-form");
  await form.getByLabel("Hodnota parametru").fill("24");
  await form.getByLabel("Zdroj parametru").fill("");
  await form.getByRole("button", { name: "Uložit" }).click();
  await expect(box.getByText(/Uveďte zdroj/)).toBeVisible();
  await form.getByLabel("Zdroj parametru").fill("Test e2e – interní směrnice");
  await form.getByRole("button", { name: "Uložit" }).click();
  await expect(row).toContainText("24 měsíce", { timeout: 15000 });
  const { data } = await s.from("hr_legal_parameters").select("approved_by, source").eq("key", "BOZP_TRAINING_INTERVAL").single();
  expect(data.approved_by).toBeTruthy();
  await s.from("hr_legal_parameters").update({ value: null, source: null }).eq("key", "BOZP_TRAINING_INTERVAL");
});

test("karta: skusobna doba nad limit -> zakonny limit, po oprave zmizne", async ({ page }) => {
  const s = service();
  const run = Date.now().toString(36);
  const empId = `emp-d-${run}`;
  await s.from("employees").insert({ id: empId, first_name: "Zdeněk", last_name: `Zkušební${run}` });
  await s.from("employment_relationships").insert({ id: `er-d-${run}`, employee_id: empId, status: "PLANNED", employment_type: "doba_neurcita",
    start_date: "2026-12-01", weekly_hours: 40, data: { zkusebni_doba_mesice: "6" } });

  await login(page, "personalista@test.local");
  await page.getByRole("button", { name: "Zaměstnanci", exact: true }).click();
  await page.locator("tr", { hasText: `Zkušební${run}` }).first().click();
  await expect(page.getByTestId("legal-block")).toContainText("Zkušební doba 6 měs. překračuje maximum 4 měs.", { timeout: 30000 });

  await s.from("employment_relationships").update({ data: { zkusebni_doba_mesice: "3" } }).eq("id", `er-d-${run}`);
  await page.reload();
  await page.locator("nav button", { hasText: "Personalistika" }).click();
  await page.getByRole("button", { name: "Zaměstnanci", exact: true }).click();
  await page.locator("tr", { hasText: `Zkušební${run}` }).first().click();
  await expect(page.getByTestId("legal-check")).toBeVisible({ timeout: 30000 }); // zostanu upozornenia (prehliadka, skolenie)
  await expect(page.getByTestId("legal-block")).toHaveCount(0);
});
