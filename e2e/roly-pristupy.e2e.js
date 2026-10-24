// Balik B auditu: personalistka a externa uctovnicka vidia len Personalistiku
// (ziadne checklisty, terminy ani zvysok ERP), personalistka nema Sablony ani
// Nastaveni; jednatel prideluje pristupy profilom s platnostou.
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
  const mfa = ["personalistka@test.local", "hr.admin@test.local"].includes(email);
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

test("personalistka: len Personalistika, bez sablon a nastaveni", async ({ page }) => {
  await login(page, "personalistka@test.local");
  await expect(page.getByRole("button", { name: "Zaměstnanci", exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.locator("nav button", { hasText: "Checklisty" })).toHaveCount(0);
  await expect(page.locator("nav button", { hasText: "Termíny" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Nástupy", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Šablony dokumentů", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Nastavení", exact: true })).toHaveCount(0);
});

test("externa uctovnicka: len Personalistika, bez nastupov a uprav", async ({ page }) => {
  await login(page, "ucetni@test.local");
  await expect(page.getByRole("button", { name: "Zaměstnanci", exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.locator("nav button", { hasText: "Checklisty" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Nástupy", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Nastavení", exact: true })).toHaveCount(0);
});

test("jednatel: pristup externej uctovnicky len s datumom konca", async ({ page }) => {
  await login(page, "hr.admin@test.local");
  await page.getByRole("button", { name: "Nastavení", exact: true }).click();
  await expect(page.getByTestId("permission-row").filter({ hasText: "ucetni@test.local" })).toContainText("Externí účetní");
  await page.getByRole("button", { name: /Přidat osobu/ }).first().click();
  const email = `e2e-ucetni-${Date.now()}@test.local`;
  await page.getByLabel("E-mail uživatele").fill(email);
  await page.getByLabel("Profil").selectOption("UCTOVNIK_EXT");
  await page.getByRole("button", { name: "Uložit" }).click();
  await expect(page.getByText("Externí účetní musí mít datum konce přístupu.")).toBeVisible();
  const until = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  await page.getByLabel("Platí do (povinné)").fill(until);
  await page.getByRole("button", { name: "Uložit" }).click();
  const row = page.getByTestId("permission-row").filter({ hasText: email });
  await expect(row).toContainText("HR_VIEW_PAYROLL");
  await expect(row).toContainText("účet zatím neexistuje");
  await expect(row).not.toContainText("HR_EDIT");
});
