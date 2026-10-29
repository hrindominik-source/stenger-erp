// Balik H (migracia 74): jednatel vidi pololetnu reviziu a potvrdi ju;
// strazca zmien zakona je vypnuty a zdroj len z e-Sbirky.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { prepareMfa, completeMfa } from "./mfa.js";

const URL_ = process.env.LOCAL_SUPABASE_URL;
const SERVICE = process.env.LOCAL_SUPABASE_SERVICE_KEY;
const enabled = !!(URL_ && SERVICE && /^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_ || ""));
const password = () => fs.readFileSync(path.resolve("supabase/seed.sql"), "utf8").match(/hr\.admin@test\.local \/ (\S+)/)[1];

test.skip(!enabled, "chyba lokalny Supabase (scripts/test-local-e2e.sh)");
test.use({ actionTimeout: 20000 });

test("pololetna revizia a nastavenie strazcu zakona", async ({ page }) => {
  test.setTimeout(120000);
  const s = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  await s.from("hr_revision_reviews").delete().gte("period", "2000-01-01");
  await page.setViewportSize({ width: 1280, height: 900 });
  await prepareMfa("hr.admin@test.local");
  await page.goto("/");
  await page.getByRole("button", { name: /Personalistika, kvalita a kontroly/ }).click();
  await page.getByLabel(/e-?mail/i).fill("hr.admin@test.local");
  await page.getByLabel(/heslo/i).fill(password());
  await page.getByRole("button", { name: /přihlásit/i }).click();
  await page.locator("nav button", { hasText: "Personalistika" }).click();
  await completeMfa(page);
  await page.getByRole("button", { name: "Pro jednatele" }).click();

  const box = page.getByTestId("revisions");
  const item = box.getByTestId("revision-item").filter({ hasText: "Pololetní revize" });
  await item.getByRole("button", { name: "Potvrdit revizi" }).click();
  await box.getByLabel("Co bylo zkontrolováno").fill("Šablony, texty a parametry – e2e");
  await box.getByRole("button", { name: "Potvrdit", exact: true }).click();
  await expect(box.getByTestId("revision-item").filter({ hasText: "Pololetní revize" })).toHaveCount(0, { timeout: 15000 });

  const watch = box.getByTestId("legislation-watch");
  await expect(watch).toContainText("Vypnuto");
  await watch.getByRole("button", { name: "Nastavit zdroj" }).click();
  await watch.getByLabel("Zdroj (e-Sbírka)").fill("https://example.com/zakon");
  await watch.getByRole("button", { name: "Uložit" }).click();
  await expect(box.getByText(/musí být adresa https na e-Sbírce/)).toBeVisible();
  await watch.getByRole("button", { name: "Zpět" }).click();
  const { data } = await s.from("hr_legislation_watch").select("source_url, enabled").eq("id", "ZP_262_2006").single();
  expect(data).toEqual({ source_url: null, enabled: false });
  await s.from("hr_revision_reviews").delete().gte("period", "2000-01-01");
});
