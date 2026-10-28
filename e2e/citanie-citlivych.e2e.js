// Zaznam o citani citlivych udajov (migracia 68): otvorenie karty zamestnanca
// v aplikacii zapise do auditu, kto a koho udaje zobrazil.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const enabled = !!process.env.LOCAL_SUPABASE_URL;
test.skip(!enabled, "chyba lokalny Supabase (scripts/test-local-e2e.sh)");

test("otvorenie karty zamestnanca zapise citanie citlivych udajov (mzdy bez opravnenia necita)", async ({ page }) => {
  const service = createClient(process.env.LOCAL_SUPABASE_URL, process.env.LOCAL_SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const since = new Date(Date.now() - 1000).toISOString();
  const [, email, password] = fs.readFileSync(path.resolve("supabase/seed.sql"), "utf8").match(/(personalista@test\.local) \/ (\S+)/);

  await page.goto("/");
  await page.getByRole("button", { name: /Personalistika, kvalita a kontroly/ }).click();
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/heslo/i).fill(password);
  await page.getByRole("button", { name: /přihlásit/i }).click();
  await page.locator("nav button", { hasText: "Personalistika" }).click();
  await page.getByRole("button", { name: "Zaměstnanci", exact: true }).click();
  await page.locator("tr", { hasText: "Vzorový" }).first().click();
  await expect(page.getByText("Vzorový").first()).toBeVisible({ timeout: 30000 });

  await expect.poll(async () => {
    const { data } = await service.from("audit_log").select("entity, new_value")
      .eq("action", "read").eq("entity_id", "emp-test-1").gte("created_at", since);
    return (data || []).filter((r) => r.new_value?.purpose === "detail").map((r) => r.entity).sort();
  }, { timeout: 15000 }).toEqual(["employee_sensitive_data"]); // mzdy tento profil nevidi -> ani necita
});
