// Obrazovka HR s QR kodom: po 3 zlych kodoch na tablete musi ukazat, ze kod
// bol zruseny, a ponuknut novy. Skutocny prehliadac, prihlasenie cez UI.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { approveTextsForTest, ESIGN_TEXT_KEYS } from "../src/lib/hr/itApprovedTexts.js";

const URL_ = process.env.LOCAL_SUPABASE_URL;
const SERVICE = process.env.LOCAL_SUPABASE_SERVICE_KEY;
const enabled = !!(URL_ && SERVICE && /^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_ || ""));
const run = Date.now().toString(36);

test.skip(!enabled, "chyba lokalny Supabase (scripts/test-local-e2e.sh)");

// § 21 je od migracie 66 neschvaleny - docasne schvalenie len pre test
let approved;
test.beforeAll(async () => {
  if (enabled) approved = await approveTextsForTest(createClient(URL_, SERVICE, { auth: { persistSession: false } }), ["S21_ADDRESS_NOTICE", ...ESIGN_TEXT_KEYS], run);
});
test.afterAll(async () => { await approved?.cleanup(); });
test.use({ actionTimeout: 15000 });

test("3 zle kody na tablete: HR vidi zruseny kod a moze pripravit novy", async ({ page, browser }) => {
  const service = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  const seed = fs.readFileSync(path.resolve("supabase/seed.sql"), "utf8");
  const [, email, password] = seed.match(/(personalista@test\.local) \/ (\S+)/);
  const last = `Kódová${run}`;
  await service.from("employees").insert({ id: `emp-e2e-kod-${run}`, first_name: "Ivana", last_name: last, record_flag: "TEST", private_email: `ivana.${run}@example.test` });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: /Personalistika, kvalita a kontroly/ }).click();
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/heslo/i).fill(password);
  await page.getByRole("button", { name: /přihlásit/i }).click();
  await page.locator("nav button", { hasText: "Personalistika" }).click();
  await page.getByRole("row", { name: new RegExp(last) }).click();
  await page.getByRole("button", { name: "Dokumenty", exact: true }).click();
  await page.getByRole("button", { name: /Prohlášení \(§ 21 \/ § 335\)/ }).click();
  await page.getByRole("button", { name: /Oznámení elektronické adresy \(§ 21\)/ }).click();

  // detail vyhlasenia: verzia textu namiesto „—“, podpis zamestnavatela sa nevyzaduje
  await expect(page.getByText(/text „Oznámení elektronické adresy.*“, verze \d+/)).toBeVisible();
  await expect(page.getByText("Podpis zaměstnavatele se u tohoto dokumentu nevyžaduje.")).toBeVisible();

  // HR vyda kod; token je len v QR kode - test ho vezme z odpovede servera
  await page.getByRole("button", { name: "Podepsat na tabletu" }).click();
  await page.getByRole("checkbox", { name: /osobně přítomen/ }).check();
  const issued = page.waitForResponse((r) => r.url().includes("/functions/v1/hr-signing") && r.request().postDataJSON()?.action === "issue");
  await page.getByRole("button", { name: "Připravit podpis" }).click();
  const { token, code } = await (await issued).json();
  await expect(page.getByTestId("pairing-code")).toHaveText(code);

  // tablet (iny prehliadacovy kontext) zada 3x zly kod
  const tabletCtx = await browser.newContext({ viewport: { width: 820, height: 1180 } });
  const tablet = await tabletCtx.newPage();
  await tablet.goto(`/?podpis=${token}`);
  const wrong = String((Number(code) + 1) % 1000000).padStart(6, "0");
  for (let i = 0; i < 2; i++) {
    await tablet.getByLabel("Kód").fill(wrong);
    await tablet.getByRole("button", { name: "Pokračovat" }).click();
    await expect(tablet.getByText(/Chybný kód\. Zbývající pokusy: /)).toBeVisible();
  }
  await expect(page.getByText(/chybný kód – zbývající pokusy: 1/)).toBeVisible({ timeout: 10000 });
  await tablet.getByLabel("Kód").fill(wrong);
  await tablet.getByRole("button", { name: "Pokračovat" }).click();
  await expect(tablet.getByText(/podpis byl zrušen/)).toBeVisible();
  await tabletCtx.close();

  // obrazovka HR: kod uz nie je ukazany ako platny, ponuka novy
  await expect(page.getByTestId("pairing-closed")).toContainText("Kód byl zrušen", { timeout: 10000 });
  await expect(page.getByTestId("pairing-code")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Podepsat na tomto zařízení" })).toHaveCount(0);
  await page.getByRole("button", { name: "Připravit nový kód" }).click();
  await page.getByRole("checkbox", { name: /osobně přítomen/ }).check();
  await page.getByRole("button", { name: "Připravit podpis" }).click();
  await expect(page.getByTestId("pairing-code")).toHaveText(/^\d{6}$/);
  await expect(page.getByTestId("pairing-code")).not.toHaveText(code);
});
