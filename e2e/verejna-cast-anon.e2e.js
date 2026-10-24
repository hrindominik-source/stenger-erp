// Verejna cast bez prihlasenia po migracii 62 (anon smie len funkcie kiosku,
// planovania smien a current_role): vyber aplikacie, prihlasovacia stranka,
// Plan smien a nastupny kiosk nesmu dostat zamietnutie (401/403, 42501).
import { test, expect } from "@playwright/test";

const enabled = !!process.env.LOCAL_SUPABASE_URL;
test.skip(!enabled, "chyba lokalny Supabase (scripts/test-local-e2e.sh)");

function watchDenied(page) {
  const denied = [];
  page.on("response", async (r) => {
    if (!/\/(rest|functions)\/v1\//.test(r.url()) || ![401, 403].includes(r.status())) return;
    denied.push(`${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, "")} ${(await r.text().catch(() => "")).slice(0, 120)}`);
  });
  return denied;
}

test("anon: vyber aplikacie, prihlasenie a Plan smien bez zamietnutia", async ({ page }) => {
  const denied = watchDenied(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Personalistika, kvalita a kontroly/ }).click();
  await expect(page.getByLabel(/heslo/i)).toBeVisible();
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: /Plán směn/ }).click();
  // planovanie nacita plan aj pracovnikov (RLS tabulky workers vola current_role)
  const workers = page.waitForResponse((r) => r.url().includes("/rest/v1/workers"));
  const plan = page.waitForResponse((r) => r.url().includes("/rest/v1/plan_smien"));
  expect((await workers).status()).toBe(200);
  expect((await plan).status()).toBe(200);
  await page.waitForTimeout(1500);
  expect(denied).toEqual([]);
});

test("anon: nastupny kiosk sa nacita a overi kod bez zamietnutia prav", async ({ page }) => {
  const denied = watchDenied(page);
  const rpcs = [];
  page.on("response", (r) => { if (r.url().includes("/rest/v1/rpc/hr_onboarding_")) rpcs.push(`${r.url().split("/rpc/")[1]} ${r.status()}`); });
  await page.goto("/?kiosk=nastup");
  await expect.poll(() => rpcs.some((x) => x.startsWith("hr_onboarding_config 200")), { timeout: 30000 }).toBe(true);
  await page.waitForTimeout(1500);
  // zamietnutie prav (42501) by bolo 401/403; chybny / chybajuci odomykaci kod je 400 (P0001)
  expect(denied).toEqual([]);
});
