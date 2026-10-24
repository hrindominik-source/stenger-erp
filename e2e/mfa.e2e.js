// Dvojfazove prihlasenie (migracia 67): personalistka bez kodu z aplikacie
// nevidi ziadne HR udaje; zly kod sa odmietne; pri dalsom prihlaseni uz len
// zada kod (bez novej registracie).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { prepareMfa, completeMfa } from "./mfa.js";
import { totp } from "../src/lib/hr/itTotp.js";

const enabled = !!process.env.LOCAL_SUPABASE_URL;
test.skip(!enabled, "chyba lokalny Supabase (scripts/test-local-e2e.sh)");

const EMAIL = "personalistka@test.local";
async function passwordLogin(page) {
  const [, password] = fs.readFileSync(path.resolve("supabase/seed.sql"), "utf8").match(/personalistka@test\.local \/ (\S+)/);
  await page.goto("/");
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  await page.getByRole("button", { name: /Personalistika, kvalita a kontroly/ }).click();
  await page.getByLabel(/e-?mail/i).fill(EMAIL);
  await page.getByLabel(/heslo/i).fill(password);
  await page.getByRole("button", { name: /přihlásit/i }).click();
}

test("personalistka: bez kodu nic, zly kod odmietnuty, dalsie prihlasenie len kodom", async ({ page, browser }) => {
  await prepareMfa(EMAIL);
  await passwordLogin(page);
  await expect(page.getByTestId("mfa-gate")).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("button", { name: "Zaměstnanci", exact: true })).toHaveCount(0);
  await expect(page.getByAltText("QR kód pro ověřovací aplikaci")).toBeVisible();

  await page.getByLabel("Kód z aplikace").fill("000000");
  await page.getByRole("button", { name: "Ověřit" }).click();
  await expect(page.getByText(/Kód nesouhlasí/)).toBeVisible();

  const secret = await completeMfa(page);
  await expect(page.getByRole("button", { name: "Zaměstnanci", exact: true })).toBeVisible({ timeout: 30000 });

  // nove prihlasenie (iny prehliadac): uz bez QR, len kod
  const ctx = await browser.newContext();
  const page2 = await ctx.newPage();
  await passwordLogin(page2);
  await expect(page2.getByTestId("mfa-gate")).toBeVisible({ timeout: 30000 });
  await expect(page2.getByTestId("mfa-secret")).toHaveCount(0);
  await page2.getByLabel("Kód z aplikace").fill(totp(secret, Date.now() + 30000));
  await page2.getByRole("button", { name: "Ověřit" }).click();
  await expect(page2.getByRole("button", { name: "Zaměstnanci", exact: true })).toBeVisible({ timeout: 30000 });
  await ctx.close();
});
