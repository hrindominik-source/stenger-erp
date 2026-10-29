// Balik F (migracia 72): dovod opravy v historii karty, export udajov (ZIP)
// so zaznamom, anonymizacia bez vyplnenych lehot nejde, lehoty a
// spracovatelia u jednatela. Vymyslene udaje.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
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

test("oprava s dovodom a export udajov so zaznamom", async ({ page }) => {
  test.setTimeout(120000);
  const s = service();
  const last = `Gdprová${run}`;
  const empId = `emp-e2e-gdpr-${run}`;
  await s.from("employees").insert({ id: empId, first_name: "Gabriela", last_name: last, record_flag: "TEST" });

  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page, "personalistka@test.local");
  await page.getByRole("row", { name: new RegExp(last) }).click();
  await page.getByRole("button", { name: "Karta zaměstnance", exact: true }).click();
  await page.getByRole("button", { name: "Upravit / doplnit" }).click();
  await page.getByLabel(/^Telefon/).first().fill("+420 600 111 222");
  await page.getByLabel("Důvod změny").fill("Zaměstnankyně nahlásila nové číslo");
  await page.getByRole("button", { name: "Uložit", exact: true }).click();
  await expect(page.getByRole("button", { name: "Upravit / doplnit" })).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Historie", exact: true }).click();
  const corr = page.getByTestId("corrections");
  await expect(corr).toContainText("Zaměstnankyně nahlásila nové číslo");
  await expect(corr).toContainText("změněných záznamů: 1");

  const downloadP = page.waitForEvent("download");
  await page.getByTestId("employee-export").click();
  const dl = await downloadP;
  const zip = new PizZip(fs.readFileSync(await dl.path()));
  const data = JSON.parse(zip.file("udaje.json").asText());
  expect(data.employee.phone).toBe("+420 600 111 222");
  const { data: logs } = await s.from("audit_log").select("new_value").eq("entity", "employees").eq("entity_id", empId).eq("action", "read");
  expect(logs.some((l) => l.new_value?.purpose === "export")).toBe(true);
});

test("byvaly zamestnanec: anonymizacia nejde bez lehot; jednatel vidi lehoty a spracovatelov", async ({ page }) => {
  test.setTimeout(120000);
  const s = service();
  const last = `Bývalá${run}`;
  const empId = `emp-e2e-gdpr-old-${run}`;
  await s.from("employees").insert({ id: empId, first_name: "Berta", last_name: last, record_flag: "TEST", active: false });
  await s.from("employment_relationships").insert({ id: `er-e2e-gdpr-${run}`, employee_id: empId, status: "ENDED",
    employment_type: "doba_neurcita", start_date: "2001-01-01", termination_date: "2002-12-31" });

  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page, "hr.admin@test.local");
  await page.getByRole("button", { name: "Bývalí zaměstnanci", exact: true }).click();
  await page.getByRole("row", { name: new RegExp(last) }).click();
  await expect(page.getByTestId("anonymize-not-ready")).toContainText("nejsou vyplněny");
  await expect(page.getByTestId("anonymize-panel").getByRole("button", { name: "Anonymizovat" })).toHaveCount(0);

  await page.getByRole("button", { name: "Zpět na seznam" }).click();
  await page.getByRole("button", { name: "Pro jednatele" }).click();
  await expect(page.getByTestId("retention-row")).toHaveCount(10);
  await expect(page.getByTestId("retention-rules")).toContainText("nevyplněno");
  await expect(page.getByTestId("processor-row")).toHaveCount(6);
  const form = page.getByTestId("retention-rules");
  await form.getByTestId("retention-row").filter({ hasText: "Školení BOZP" }).getByRole("button", { name: "Doplnit" }).click();
  await form.getByLabel("Počet let").fill("3");
  await form.getByRole("button", { name: "Uložit" }).click();
  await expect(form.getByText(/Vyberte, od kdy/)).toBeVisible();
  // hodnotu neukladame - lehoty doplni jednatel podla pravnicky
  await form.getByRole("button", { name: "Zpět" }).click();
  const { data } = await s.from("hr_retention_rules").select("period_years").eq("key", "BOZP").single();
  expect(data.period_years).toBeNull();
});
