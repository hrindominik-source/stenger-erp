// Nahrane dokumenty: personalistka nahra existujucu podpisanu zmluvu (vznikla
// mimo systemu), dokument je podpisany a zamknuty, jednatel ma upozornenie.
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

test("nahrani existujici podepsane smlouvy", async ({ page }) => {
  test.setTimeout(150000);
  const s = service();
  const last = `Nahraná${run}`;
  const empId = `emp-e2e-nahr-${run}`;
  await s.from("employees").insert({ id: empId, first_name: "Nela", last_name: last, record_flag: "TEST", active: true });
  await s.from("employment_relationships").insert({ id: `er-e2e-nahr-${run}`, employee_id: empId, status: "ACTIVE",
    employment_type: "doba_neurcita", start_date: "2023-03-01", weekly_hours: 40 });

  const email = "personalistka@test.local";
  await prepareMfa(email);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: /Personalistika, kvalita a kontroly/ }).click();
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/heslo/i).fill(password());
  await page.getByRole("button", { name: /přihlásit/i }).click();
  await page.locator("nav button", { hasText: "Personalistika" }).click();
  await completeMfa(page);
  await page.getByRole("button", { name: "Zaměstnanci" }).first().click();
  await page.getByRole("row", { name: new RegExp(last) }).click();
  await page.getByRole("button", { name: "Dokumenty", exact: true }).click();

  await page.getByRole("button", { name: "Nahrát podepsaný dokument" }).click();
  await page.getByLabel("Datum podpisu").fill("2023-03-01");
  await page.getByLabel("Soubor dokumentu").setInputFiles({ name: "smlouva.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% test\n") });
  await page.getByRole("button", { name: "Nahrát", exact: true }).click();
  await expect(page.getByText(/Nahráno ručně .* podepsáno/)).toBeVisible();

  const { data: docs } = await s.from("hr_documents").select("*").eq("employee_id", empId);
  expect(docs).toHaveLength(1);
  expect(docs[0]).toMatchObject({ doc_type: "pracovni_smlouva", origin: "UPLOADED", status: "SIGNED", is_manual_history_entry: true });
  expect(docs[0].locked_at).not.toBeNull();
  expect(docs[0].variables_snapshot.sha256).toMatch(/^[0-9a-f]{64}$/);
  const { data: notes } = await s.from("hr_notifications").select("title").eq("event_type", "DOCUMENT_UPLOADED").eq("entity_id", docs[0].id);
  expect(notes).toHaveLength(1);
});
