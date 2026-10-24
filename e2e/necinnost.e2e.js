// Odhlasenie pri necinnosti (rozhodnutie jednatela): Personalistika 15 min,
// kiosk a podpis na tablete 5 min; minutu pred koncom upozornenie. Cas sa
// posuva hodinami Playwrightu (page.clock), nie cakanim.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const enabled = !!process.env.LOCAL_SUPABASE_URL;
test.skip(!enabled, "chyba lokalny Supabase (scripts/test-local-e2e.sh)");

const seed = () => fs.readFileSync(path.resolve("supabase/seed.sql"), "utf8");

async function loginHr(page) {
  const [, email, password] = seed().match(/(personalista@test\.local) \/ (\S+)/);
  await page.goto("/");
  await page.getByRole("button", { name: /Personalistika, kvalita a kontroly/ }).click();
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/heslo/i).fill(password);
  await page.getByRole("button", { name: /přihlásit/i }).click();
  await page.locator("nav button", { hasText: "Personalistika" }).click();
  await expect(page.getByRole("button", { name: "Zaměstnanci", exact: true })).toBeVisible({ timeout: 30000 });
}

test("Personalistika: upozornenie po 14 min, odhlasenie po 15 min necinnosti; aktivita odklada", async ({ page }) => {
  await page.clock.install();
  await loginHr(page);

  await page.clock.fastForward("13:30");
  await expect(page.getByTestId("idle-warning")).toHaveCount(0);
  await page.mouse.move(10, 10); // aktivita -> odpocet od nuly
  await page.clock.fastForward("13:30");
  await expect(page.getByTestId("idle-warning")).toHaveCount(0);
  await page.clock.fastForward("01:00");
  await expect(page.getByTestId("idle-warning")).toBeVisible();
  await page.clock.fastForward("01:05");
  await expect(page.getByTestId("idle-logout")).toBeVisible({ timeout: 15000 });
  await expect(page.getByLabel(/heslo/i)).toBeVisible();
});

test("kiosk: po 5 min necinnosti udaje zmiznu a tablet sa zamkne", async ({ page, browser }) => {
  await loginHr(page);
  await page.getByRole("button", { name: "Nástupy", exact: true }).click();
  await page.getByRole("button", { name: "Odemknout tablet" }).click();
  const code = (await page.getByTestId("kiosk-unlock-code").textContent()).trim();

  const ctx = await browser.newContext();
  const kiosk = await ctx.newPage();
  await kiosk.clock.install();
  await kiosk.goto("/?kiosk=nastup");
  await kiosk.getByLabel("Kód pro odemčení").fill(code);
  await kiosk.getByRole("button", { name: /Odemknout a začít/ }).click();
  await expect(kiosk.getByText("Tablet je zamčený")).toBeHidden({ timeout: 30000 });
  await kiosk.getByLabel(/^Jméno/).first().fill("Necinny");

  await kiosk.clock.fastForward("04:05");
  await expect(kiosk.getByTestId("idle-warning")).toBeVisible();
  await kiosk.clock.fastForward("01:00");
  await expect(kiosk.getByText("Tablet je zamčený")).toBeVisible({ timeout: 15000 });
  await expect(kiosk.getByTestId("kiosk-idle-ended")).toBeVisible();
  // novy kod -> prazdny dotaznik, nic z predchadzajucej osoby
  await page.getByRole("button", { name: "Vydat nový kód" }).click();
  await expect(page.getByTestId("kiosk-unlock-code")).not.toHaveText(code);
  const code2 = (await page.getByTestId("kiosk-unlock-code").textContent()).trim();
  await kiosk.getByLabel("Kód pro odemčení").fill(code2);
  await kiosk.getByRole("button", { name: /Odemknout a začít/ }).click();
  await expect(kiosk.getByLabel(/^Jméno/).first()).toHaveValue("", { timeout: 30000 });
  await ctx.close();
});

test("tablet: podpisovy odkaz sa po 5 min necinnosti ukonci", async ({ page }) => {
  await page.clock.install();
  await page.goto("/?podpis=neplatny-test-token");
  await expect(page.getByText("Načítám dokument…")).toHaveCount(0, { timeout: 30000 });
  await expect(page.locator("body")).not.toHaveText(/^\s*$/);
  await page.clock.fastForward("05:05");
  await expect(page.getByText(/Podpis byl ukončen pro nečinnost/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "Zkusit znovu" })).toHaveCount(0);
});
