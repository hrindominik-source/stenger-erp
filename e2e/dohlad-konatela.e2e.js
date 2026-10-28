// Balik A auditu: prehlad pre jednatela - zmena mzdy personalistkou sa
// jednatelovi zobrazi ako nova udalost, da sa oznacit ako precitana;
// personalistka prehlad nema.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { prepareMfa, completeMfa } from "./mfa.js";

const enabled = !!process.env.LOCAL_SUPABASE_URL;
test.skip(!enabled, "chyba lokalny Supabase (scripts/test-local-e2e.sh)");

const seed = () => fs.readFileSync(path.resolve("supabase/seed.sql"), "utf8");
async function login(page, email) {
  const [, password] = seed().match(new RegExp(`${email.replace(".", "\\.")} / (\\S+)`));
  // jednatel a personalistka maju povinne dvojfazove prihlasenie (migracia 67)
  const mfa = ["personalistka@test.local", "hr.admin@test.local", "ucetni@test.local"].includes(email);
  if (mfa) await prepareMfa(email);
  await page.goto("/");
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  await page.getByRole("button", { name: /Personalistika, kvalita a kontroly/ }).click();
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/heslo/i).fill(password);
  await page.getByRole("button", { name: /přihlásit/i }).click();
  if (email === "hr.admin@test.local") await page.locator("nav button", { hasText: "Personalistika" }).click();
  if (mfa) await completeMfa(page);
}

test("personalistka nema prehlad pre jednatela", async ({ page }) => {
  await login(page, "personalistka@test.local");
  await expect(page.getByRole("button", { name: "Zaměstnanci", exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("button", { name: "Pro jednatele", exact: true })).toHaveCount(0);
});

test("jednatel: udalosti, vsetko precitane, pristupy", async ({ page }) => {
  await login(page, "hr.admin@test.local");
  await page.getByRole("button", { name: "Pro jednatele", exact: true }).click();
  await expect(page.getByText("Čeká na schválení", { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("konatel-access-row").filter({ hasText: "Externí účetní" }).first()).toBeVisible();
  // seed (pridelenie pristupov) vytvoril nove udalosti
  await expect(page.getByTestId("konatel-notification").first()).toBeVisible();
  await page.getByRole("button", { name: /Vše přečteno/ }).click();
  await expect(page.getByText("Žádné nové události.")).toBeVisible();
  await expect(page.getByText(/Změny přístupů/)).toBeVisible();
});
