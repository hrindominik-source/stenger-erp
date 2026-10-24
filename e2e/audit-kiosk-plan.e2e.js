// Opravy z auditu Personalistiky (migr. 63): nastupny kiosk sa odomyka kodom,
// ktory vyda personalistka v zalozke Nastupy (S-03); Plan smien uklada len
// vedouci s PIN cez plan_smien_save, priamy zapis do tabulky neexistuje.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const enabled = !!process.env.LOCAL_SUPABASE_URL;
test.skip(!enabled, "chyba lokalny Supabase (scripts/test-local-e2e.sh)");

test("kiosk: bez kodu zamknuty, kod od personalistky ho odomkne (raz)", async ({ page, browser }) => {
  const seed = fs.readFileSync(path.resolve("supabase/seed.sql"), "utf8");
  const [, email, password] = seed.match(/(personalista@test\.local) \/ (\S+)/);

  const kioskCtx = await browser.newContext();
  const kiosk = await kioskCtx.newPage();
  await kiosk.goto("/?kiosk=nastup");
  await expect(kiosk.getByText("Tablet je zamčený")).toBeVisible({ timeout: 30000 });

  await page.goto("/");
  await page.getByRole("button", { name: /Personalistika, kvalita a kontroly/ }).click();
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/heslo/i).fill(password);
  await page.getByRole("button", { name: /přihlásit/i }).click();
  await page.locator("nav button", { hasText: "Personalistika" }).click();
  await page.getByRole("button", { name: "Nástupy", exact: true }).click();
  await page.getByRole("button", { name: "Odemknout tablet" }).click();
  const code = (await page.getByTestId("kiosk-unlock-code").textContent()).trim();
  expect(code).toMatch(/^[0-9A-F]{8}$/);

  // zly kod -> ostava zamknuty
  await kiosk.getByLabel("Kód pro odemčení").fill("ZLYKOD00");
  await kiosk.getByRole("button", { name: /Odemknout a začít/ }).click();
  await expect(kiosk.getByText(/Kód je neplatný/)).toBeVisible();
  // spravny kod (malymi pismenami) -> dotaznik
  await kiosk.getByLabel("Kód pro odemčení").fill(code.toLowerCase());
  await kiosk.getByRole("button", { name: /Odemknout a začít/ }).click();
  await expect(kiosk.getByText("Tablet je zamčený")).toBeHidden({ timeout: 30000 });
  await expect(kiosk.getByRole("button", { name: /Další|Pokračovat/ }).first()).toBeVisible();

  // ten isty kod v druhom tablete uz neplati
  const kiosk2 = await kioskCtx.newPage();
  await kiosk2.goto("/?kiosk=nastup");
  await kiosk2.getByLabel("Kód pro odemčení").fill(code);
  await kiosk2.getByRole("button", { name: /Odemknout a začít/ }).click();
  await expect(kiosk2.getByText(/Kód je neplatný/)).toBeVisible();
  await kioskCtx.close();
});

test("plan smien: vedouci s PIN uklada cez server, bez prihlasenia sa nezapisuje", async ({ page }) => {
  const writes = [];
  page.on("request", (r) => {
    if (/\/rest\/v1\/plan_smien(\?|$)/.test(r.url()) && r.method() !== "GET") writes.push(`${r.method()} ${r.url()}`);
    if (r.url().includes("/rpc/plan_smien_save")) writes.push("save");
  });
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: /Plán směn/ }).click();
  await page.getByRole("button", { name: "Vedoucí výroby" }).click();
  await page.waitForTimeout(2500); // nacitany rozpis bez prihlasenia sa neuklada
  expect(writes).toEqual([]);

  await page.getByPlaceholder("PIN", { exact: true }).fill("1234");
  const saved = page.waitForResponse((r) => r.url().includes("/rpc/plan_smien_save"), { timeout: 30000 });
  await page.getByRole("button", { name: "Přihlásit se" }).click();
  const res = await saved;
  expect(res.status()).toBe(200);
  expect(await res.json()).toBe(true);
  expect(writes.filter((w) => w !== "save")).toEqual([]);
  await expect(page.getByText(/nepodařilo uložit/i)).toHaveCount(0);
});
