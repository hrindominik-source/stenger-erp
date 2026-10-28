// Obnova dvojfazoveho prihlasenia (migracia 69): zalozny kod -> nova
// registracia aplikacie; jednatel zrusi overenie uctovnicke v prehlade, sebe nie.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { prepareMfa, completeMfa } from "./mfa.js";
import { signInAal2 } from "../src/lib/hr/itTotp.js";

const enabled = !!process.env.LOCAL_SUPABASE_URL;
test.skip(!enabled, "chyba lokalny Supabase (scripts/test-local-e2e.sh)");

const password = () => fs.readFileSync(path.resolve("supabase/seed.sql"), "utf8").match(/hr\.admin@test\.local \/ (\S+)/)[1];

async function passwordLogin(page, email) {
  await page.goto("/");
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  await page.getByRole("button", { name: /Personalistika, kvalita a kontroly/ }).click();
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/heslo/i).fill(password());
  await page.getByRole("button", { name: /přihlásit/i }).click();
  if (email === "hr.admin@test.local") await page.locator("nav button", { hasText: "Personalistika" }).click();
}

test("zalozny kod: bez telefonu -> nova registracia aplikacie a nove kody", async ({ page, browser }) => {
  await prepareMfa("personalistka@test.local");
  await passwordLogin(page, "personalistka@test.local");
  const { codes } = await completeMfa(page);

  const ctx = await browser.newContext();
  const page2 = await ctx.newPage();
  await passwordLogin(page2, "personalistka@test.local");
  await page2.getByRole("button", { name: /Nemám telefon/ }).click();
  await page2.getByLabel("Záložní kód").fill("AAAAA-AAAAA");
  await page2.getByRole("button", { name: "Použít" }).click();
  await expect(page2.getByText(/Záložní kód neplatí/)).toBeVisible({ timeout: 30000 });
  await page2.getByLabel("Záložní kód").fill(codes[0]);
  await page2.getByRole("button", { name: "Použít" }).click();
  const fresh = await completeMfa(page2); // novy QR + nove kody
  expect(fresh.codes).not.toContain(codes[0]);
  await expect(page2.getByRole("button", { name: "Zaměstnanci", exact: true })).toBeVisible({ timeout: 30000 });
  await ctx.close();
});

test("jednatel zrusi overenie externej uctovnicke s dovodom; vlastne nie", async ({ page }) => {
  const service = createClient(process.env.LOCAL_SUPABASE_URL, process.env.LOCAL_SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  await signInAal2(createClient(process.env.LOCAL_SUPABASE_URL, process.env.LOCAL_SUPABASE_ANON_KEY, { auth: { persistSession: false } }),
    service, "ucetni@test.local", password());

  await prepareMfa("hr.admin@test.local");
  await passwordLogin(page, "hr.admin@test.local");
  await completeMfa(page);
  await page.getByRole("button", { name: "Pro jednatele" }).click();
  const row = page.getByTestId("konatel-access-row").filter({ hasText: "Test Ucetni" });
  await expect(row.getByTestId("konatel-mfa-cell")).toContainText("aktivní");
  const own = page.getByTestId("konatel-access-row").filter({ hasText: /Jednatel/ }).first();
  await expect(own.getByRole("button", { name: "Zrušit ověření" })).toHaveCount(0);

  await row.getByRole("button", { name: "Zrušit ověření" }).click();
  const form = page.getByTestId("konatel-mfa-reset-form");
  await expect(form.getByRole("button", { name: "Zrušit ověření" })).toBeDisabled();
  await form.getByLabel("Důvod zrušení ověření").fill("Ztracený telefon (e2e)");
  await form.getByRole("button", { name: "Zrušit ověření" }).click();
  await expect(row.getByTestId("konatel-mfa-cell")).toContainText("neregistrováno", { timeout: 30000 });
  await expect(page.getByText(/Dvoufázové ověření zrušeno jednatelem: ucetni@test.local/).first()).toBeVisible();
});
