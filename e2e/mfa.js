// Pomocnik pre e2e: dvojfazove prihlasenie (migracia 67) bez telefonu -
// pred prihlasenim zmaze faktory pouzivatela, kod z aplikacie vypocita test.
import { expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { resetMfa, totp } from "../src/lib/hr/itTotp.js";

export async function prepareMfa(email) {
  await resetMfa(createClient(process.env.LOCAL_SUPABASE_URL, process.env.LOCAL_SUPABASE_SERVICE_KEY, { auth: { persistSession: false } }), email);
}

// Registracia aplikacie na obrazovke MFA; vrati tajny kluc (pre dalsie prihlasenie).
export async function completeMfa(page) {
  const secretEl = page.getByTestId("mfa-secret");
  await expect(secretEl).toBeVisible({ timeout: 30000 });
  const secret = (await secretEl.textContent()).trim();
  await page.getByLabel("Kód z aplikace").fill(totp(secret));
  await page.getByRole("button", { name: "Ověřit" }).click();
  await expect(page.getByTestId("mfa-gate")).toBeHidden({ timeout: 30000 });
  return secret;
}
