// Balik G (migracia 73): jednatel vidi neuspesne prihlasenia a ukonci pristup
// odchadzajucemu pouzivatelovi. Docasny pouzivatel s vymyslenymi udajmi.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { prepareMfa, completeMfa } from "./mfa.js";

const URL_ = process.env.LOCAL_SUPABASE_URL;
const ANON = process.env.LOCAL_SUPABASE_ANON_KEY;
const SERVICE = process.env.LOCAL_SUPABASE_SERVICE_KEY;
const enabled = !!(URL_ && SERVICE && /^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_ || ""));
const run = Date.now().toString(36);
const password = () => fs.readFileSync(path.resolve("supabase/seed.sql"), "utf8").match(/hr\.admin@test\.local \/ (\S+)/)[1];

test.skip(!enabled, "chyba lokalny Supabase (scripts/test-local-e2e.sh)");
test.use({ actionTimeout: 20000 });

test("jednatel vidi neuspesne prihlasenia a zablokuje ucet pri odchode", async ({ page }) => {
  test.setTimeout(120000);
  const s = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  const email = `odchod.e2e.${run}@test.local`;
  const { data: created, error } = await s.auth.admin.createUser({ email, password: `heslo-${run}-lokal`, email_confirm: true });
  if (error) throw error;
  await s.from("hr_permissions").insert({ id: `p-e2e-odchod-${run}`, user_email: email, profile: "VLASTNI", permissions: ["HR_VIEW_BASIC"], note: "e2e test odchodu" });
  // neuspesne prihlasenie zapise Auth hook
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  await anon.auth.signInWithPassword({ email, password: "zle-heslo" });

  try {
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

    const row = page.getByTestId("konatel-access-row").filter({ hasText: email });
    await expect(row.getByTestId("konatel-login-cell")).toContainText("neúspěšná přihlášení (7 dní): 1");
    await row.getByRole("button", { name: "Zablokovat účet – odchod z firmy" }).click();
    const form = page.getByTestId("konatel-offboard-form");
    await form.getByLabel("Důvod ukončení přístupu").fill("Skončení spolupráce – e2e");
    await form.getByRole("button", { name: "Zablokovat účet" }).click();
    await expect(row.getByTestId("konatel-login-cell")).toContainText("účet zablokován", { timeout: 15000 });
    await expect(row).toContainText("(neplatí)");
    // vlastny riadok jednatela tlacidlo nema
    await expect(page.getByTestId("konatel-access-row").filter({ hasText: "hr.admin@test.local" }).getByRole("button", { name: "Zablokovat účet – odchod z firmy" })).toHaveCount(0);
  } finally {
    await s.auth.admin.updateUserById(created.user.id, { ban_duration: "none" });
  }
});
