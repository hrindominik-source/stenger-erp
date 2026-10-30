// Pracovni odev: personalistka vyda odev s predavacim protokolom (PDF) a
// zapise rukavice (len evidencia). Vymyslene udaje.
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

test("pracovni odev: protokol PDF a evidencia rukavic", async ({ page }) => {
  test.setTimeout(150000);
  const s = service();
  const last = `Oděvní${run}`;
  const empId = `emp-e2e-odev-${run}`;
  await s.from("employees").insert({ id: empId, first_name: "Olga", last_name: last, record_flag: "TEST", active: true });
  await s.from("employment_relationships").insert({ id: `er-e2e-odev-${run}`, employee_id: empId, status: "ACTIVE",
    employment_type: "doba_neurcita", start_date: "2026-10-01", weekly_hours: 40 });

  const email = "personalistka@test.local";
  await prepareMfa(email);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: /Personalistika, kvalita a kontroly/ }).click();
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/heslo/i).fill(password());
  await page.getByRole("button", { name: /přihlásit/i }).click();
  await page.locator("nav button", { hasText: "Personalistika" }).click();
  await completeMfa(page);
  await page.getByRole("button", { name: "Zaměstnanci" }).first().click();
  await page.getByRole("row", { name: new RegExp(last) }).click();
  await page.getByRole("button", { name: "Pracovní oděv", exact: true }).click();

  await page.getByLabel("Tričko – počet kusů").fill("3");
  await page.getByLabel("Tričko – velikost").selectOption("M");
  await page.getByLabel("Obuv – počet kusů").fill("1");
  await page.getByLabel("Obuv – velikost").selectOption("39");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Vytvořit předávací protokol/ }).click();
  expect((await download).suggestedFilename()).toMatch(/Předávací protokol.*\.pdf$/);
  await expect(page.getByTestId("odev-vydej")).toContainText("Tričko M × 3, Obuv 39 × 1");

  await page.getByLabel("Počet rukavic").fill("10");
  await page.getByRole("button", { name: "Zapsat" }).click();
  await expect(page.getByTestId("rukavice-row")).toContainText("10");

  const { data } = await s.from("employees").select("data").eq("id", empId).single();
  expect(data.data.odev_vydeje[0].polozky).toEqual([
    { key: "tricko", label: "Tričko", pocet: 3, velikost: "M" }, { key: "obuv", label: "Obuv", pocet: 1, velikost: "39" }]);
  expect(data.data.rukavice[0].pocet).toBe(10);
});
