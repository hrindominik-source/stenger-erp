// Migracia 76 (rozhodnutia 2026-10-29): dodatocne zamietnuty nudzovy krok ->
// dokument platny s oznacenim a uloha napravy s terminom, kym ju jednatel
// neuzavrie; povinny dovod zmeny v Karte pri vybranych poliach.
// Vymyslene udaje.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { prepareMfa, completeMfa } from "./mfa.js";

const URL_ = process.env.LOCAL_SUPABASE_URL;
const SERVICE = process.env.LOCAL_SUPABASE_SERVICE_KEY;
const enabled = !!(URL_ && SERVICE && /^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_ || ""));
const run = Date.now().toString(36);
const service = () => createClient(URL_, SERVICE, { auth: { persistSession: false } });
const password = () => fs.readFileSync(path.resolve("supabase/seed.sql"), "utf8").match(/hr\.admin@test\.local \/ (\S+)/)[1];

test.skip(!enabled, "chyba lokalny Supabase (scripts/test-local-e2e.sh)");
test.use({ actionTimeout: 20000 });

async function login(page, email) {
  await prepareMfa(email);
  await page.goto("/");
  await page.getByRole("button", { name: /Personalistika, kvalita a kontroly/ }).click();
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/heslo/i).fill(password());
  await page.getByRole("button", { name: /přihlásit/i }).click();
  await page.locator("nav button", { hasText: "Personalistika" }).click();
  await completeMfa(page);
}

test("zamietnuty nudzovy postup: oznacenie dokumentu a uloha napravy", async ({ page }) => {
  test.setTimeout(150000);
  const s = service();
  const last = `Nápravný${run}`;
  const empId = `emp-e2e-nap-${run}`;
  const docId = `doc-e2e-nap-${run}`;
  await s.from("employees").insert({ id: empId, first_name: "Norbert", last_name: last, record_flag: "TEST" });
  const { error: dErr } = await s.from("hr_documents").insert({ id: docId, employee_id: empId, doc_type: "vypoved_zamestnavatele", origin: "GENERATED",
    status: "READY_FOR_SIGNATURE", final_pdf_sha256: "d".repeat(64), final_pdf_text_check: { ok: true, server_verified: true },
    final_pdf_path: `zamestnanci/${empId}/${docId}.pdf`, finalized_at: new Date().toISOString() });
  if (dErr) throw dErr;
  const { data: users } = await s.auth.admin.listUsers({ perPage: 1000 });
  const requester = users.users.find((u) => u.email === "personalistka@test.local");
  const { error: aErr } = await s.from("hr_approval_requests").insert({ kind: "EMPLOYER_SIGN", entity: "hr_documents", entity_id: docId, employee_id: empId,
    reason: "Výpověď nesnese odklad", emergency: true, emergency_info: "Telefonát s jednatelem", status: "EMERGENCY", requested_by: requester.id,
    payload: { doc: { final_pdf_sha256: "d".repeat(64), doc_type: "vypoved_zamestnavatele", version_no: 1 } } });
  if (aErr) throw aErr;

  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page, "hr.admin@test.local");
  await page.getByRole("button", { name: "Pro jednatele" }).click();
  const row = page.getByTestId("konatel-approval-row").filter({ hasText: last });
  await row.getByRole("button", { name: "Odmítnout" }).click();
  await row.getByLabel("Poznámka k rozhodnutí").fill("Nesouhlasím s výpovědí");
  await expect(row.getByLabel("Termín nápravy")).toHaveValue(/\d{4}-\d{2}-\d{2}/);
  await row.getByRole("button", { name: "Potvrdit zamítnutí" }).click();

  const remedy = page.getByTestId("konatel-remedy-row").filter({ hasText: last });
  await expect(remedy).toContainText("vyžaduje nápravu", { timeout: 15000 });
  await expect(remedy).toContainText("Nesouhlasím s výpovědí");
  const { data: doc } = await s.from("hr_documents").select("status").eq("id", docId).single();
  expect(doc.status).toBe("READY_FOR_SIGNATURE"); // dokument ostava platny

  // oznacenie pri dokumente zamestnanca
  await page.getByRole("button", { name: "Zaměstnanci", exact: true }).click();
  await page.getByRole("row", { name: new RegExp(last) }).click();
  await page.getByRole("button", { name: "Dokumenty", exact: true }).click();
  await expect(page.getByTestId("doc-remediation")).toContainText("Zamítnuto jednatelem – vyžaduje nápravu");

  await page.getByRole("button", { name: "Zpět na seznam" }).click();
  await page.getByRole("button", { name: "Pro jednatele" }).click();
  const remedy2 = page.getByTestId("konatel-remedy-row").filter({ hasText: last });
  await remedy2.getByRole("button", { name: "Uzavřít nápravu" }).click();
  await remedy2.getByLabel("Popis nápravy").fill("Výpověď vzata zpět dohodou");
  await remedy2.getByRole("button", { name: "Uzavřít", exact: true }).click();
  await expect(page.getByTestId("konatel-remedy-row").filter({ hasText: last })).toHaveCount(0, { timeout: 15000 });
});

test("Karta: dovod povinny pri cisle uctu, pri telefone nie", async ({ page }) => {
  test.setTimeout(120000);
  const s = service();
  const last = `Důvodová${run}`;
  await s.from("employees").insert({ id: `emp-e2e-dov-${run}`, first_name: "Dana", last_name: last, record_flag: "TEST" });

  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page, "hr.admin@test.local");
  await page.getByRole("row", { name: new RegExp(last) }).click();
  await page.getByRole("button", { name: "Karta zaměstnance", exact: true }).click();
  await page.getByRole("button", { name: "Upravit / doplnit" }).click();
  await page.getByLabel(/^Telefon/).first().fill("+420 600 333 444");
  await expect(page.getByTestId("reason-required")).toHaveCount(0);
  await page.getByLabel(/^Číslo bankovního účtu/).first().fill("123456789/0100");
  await expect(page.getByTestId("reason-required")).toContainText("Číslo bankovního účtu");
  await page.getByRole("button", { name: "Uložit", exact: true }).click();
  await expect(page.getByText(/Uveďte důvod změny/)).toBeVisible();
  await page.getByLabel("Důvod změny").fill("Nový účet podle žádosti zaměstnankyně");
  await page.getByRole("button", { name: "Uložit", exact: true }).click();
  await expect(page.getByRole("button", { name: "Upravit / doplnit" })).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Historie", exact: true }).click();
  await expect(page.getByTestId("corrections")).toContainText("Změněno: Číslo bankovního účtu");
});
