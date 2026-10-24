// Zalozka Personalistika: prve kliknutie hned po nacitani stranky (pomala
// siet - opravnenia a data sa este nacitavaju) otvori personalistiku a
// zvolena zalozka prezije obnovenie stranky (napr. obnovu z dev servera).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { prepareMfa, completeMfa } from "./mfa.js";

const enabled = !!process.env.LOCAL_SUPABASE_URL;
test.skip(!enabled, "chyba lokalny Supabase (scripts/test-local-e2e.sh)");

test("prve kliknutie na Personalistiku pocas nacitania sa nestrati", async ({ page }) => {
  const seed = fs.readFileSync(path.resolve("supabase/seed.sql"), "utf8");
  const [, email, password] = seed.match(/(hr\.admin@test\.local) \/ (\S+)/);
  await prepareMfa(email); // jednatel: povinne dvojfazove prihlasenie (migracia 67)
  await page.goto("/");
  await page.getByRole("button", { name: /Personalistika, kvalita a kontroly/ }).click();
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/heslo/i).fill(password);
  await page.getByRole("button", { name: /přihlásit/i }).click();
  const tab = page.locator("nav button", { hasText: "Personalistika" });
  await tab.waitFor();
  // overenie kodom raz; relacia aal2 ostava aj po obnoveni stranky
  await tab.click();
  await completeMfa(page);

  // pomala siet: kazda poziadavka na data / prihlasenie trva 1,2 s
  await page.route("**/{rest,auth}/v1/**", async (r) => { await new Promise((ok) => setTimeout(ok, 1200)); return r.continue().catch(() => {}); });
  await page.reload();
  await tab.waitFor();
  const bb = await tab.boundingBox();
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); // jedno kliknutie, ziadne cakanie na stabilitu
  await expect(page.getByRole("button", { name: "Zaměstnanci", exact: true })).toBeVisible({ timeout: 30000 });

  // po obnoveni stranky ostava Personalistika
  await page.reload();
  await expect(page.getByRole("button", { name: "Zaměstnanci", exact: true })).toBeVisible({ timeout: 30000 });
});
