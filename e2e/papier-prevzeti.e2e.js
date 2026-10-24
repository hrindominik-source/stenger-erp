// Casti K a L rucneho testu cez UI v skutocnom prehliadaci (vymyslene udaje):
//  K: papierovy podpis zmluvy - sken nahra a zahashuje server; subor ineho
//     typu (.txt premenovany na .pdf) server odmietne;
//  L: k podpisanej zmluve „Vytvořit potvrzení o převzetí“ -> novy dokument
//     s otlackom -> podpis skenom; mzdovy vymer (§ 334) podpisany zamestna-
//     vatelom skenom -> „Zaznamenat předání“ len proti skenu potvrdenia.
// Pripravene su len dokumenty s overenym finalnym PDF (ako v IT testoch),
// vsetko ostatne ide cez UI a skutocne serverove funkcie.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { prepareMfa, completeMfa } from "./mfa.js";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts } from "pdf-lib";

const URL_ = process.env.LOCAL_SUPABASE_URL;
const SERVICE = process.env.LOCAL_SUPABASE_SERVICE_KEY;
const enabled = !!(URL_ && SERVICE && /^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_ || ""));
const run = Date.now().toString(36);
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

test.skip(!enabled, "chyba lokalny Supabase (scripts/test-local-e2e.sh)");
test.use({ actionTimeout: 20000 });

async function pdf(lines) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const t of lines) doc.addPage([595, 842]).drawText(t, { x: 60, y: 760, size: 14, font });
  return Buffer.from(await doc.save());
}

test("K + L: papierovy sken, potvrdenie o prevzati a predanie mzdoveho vymeru", async ({ page }) => {
  test.setTimeout(240000);
  const service = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  const seed = fs.readFileSync(path.resolve("supabase/seed.sql"), "utf8");
  const [, email, password] = seed.match(/(hr\.admin@test\.local) \/ (\S+)/);
  const last = `Papírová${run}`;
  const empId = `emp-e2e-pp-${run}`;
  await service.from("employees").insert({ id: empId, first_name: "Pavla", last_name: last, record_flag: "TEST" });

  // dokumenty k podpisu s overenym finalnym PDF
  async function readyDoc(suffix, docType, title) {
    const id = `doc-e2e-pp-${run}-${suffix}`;
    const bytes = await pdf([`${title} (test)`, "Strana 2"]);
    const p = `zamestnanci/${empId}/${id}/finalni.pdf`;
    await service.storage.from("hr-dokumenty").upload(p, new Blob([bytes], { type: "application/pdf" }), { contentType: "application/pdf" });
    const { error } = await service.from("hr_documents").insert({
      id, employee_id: empId, doc_type: docType, origin: "GENERATED", status: "READY_FOR_SIGNATURE",
      final_pdf_path: p, final_pdf_sha256: sha(bytes), finalized_at: new Date().toISOString(),
      final_pdf_text_check: { ok: true, server_verified: true, method: "e2e-test", pages: 2 },
    });
    if (error) throw error;
    return { id, finalSha: sha(bytes) };
  }
  const contract = await readyDoc("ps", "pracovni_smlouva", "Pracovni smlouva");
  const vymer = await readyDoc("mv", "mzdovy_vymer", "Mzdovy vymer");
  const doc = (id) => service.from("hr_documents").select("*").eq("id", id).single().then((r) => r.data);
  const sigs = (id) => service.from("hr_document_signatures").select("*").eq("hr_document_id", id).then((r) => r.data);

  const scan = await pdf(["Naskenovany podepsany dokument (test)"]);
  const scanFile = { name: "sken.pdf", mimeType: "application/pdf", buffer: scan };
  const fakePdf = { name: "sken.pdf", mimeType: "application/pdf", buffer: Buffer.from("toto je textovy soubor, ne sken") };

  await page.setViewportSize({ width: 1280, height: 900 });
  await prepareMfa(email); // jednatel: povinne dvojfazove prihlasenie (migracia 67)
  await page.goto("/");
  await page.getByRole("button", { name: /Personalistika, kvalita a kontroly/ }).click();
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/heslo/i).fill(password);
  await page.getByRole("button", { name: /přihlásit/i }).click();
  await page.locator("nav button", { hasText: "Personalistika" }).click();
  await completeMfa(page);
  await page.getByRole("row", { name: new RegExp(last) }).click();
  await page.getByRole("button", { name: "Dokumenty", exact: true }).click();
  const card = (id) => page.locator(`[data-doc-id="${id}"]`);

  // papierovy sken v karte dokumentu: kto podpisal, subor, potvrdenie zhody
  async function uploadScan(id, names, file) {
    const c = card(id);
    // formular moze byt otvoreny z predosleho pokusu
    if (!(await c.getByRole("button", { name: "Uložit podpis" }).count())) await c.getByRole("button", { name: "Nahrát podepsaný sken" }).click();
    const nameFields = c.getByLabel("Jméno podepsaného");
    await expect(nameFields).toHaveCount(names.length);
    for (const [i, n] of names.entries()) await nameFields.nth(i).fill(n);
    await c.locator("input[type=file]").setInputFiles(file);
    await c.getByRole("checkbox", { name: /Potvrzuji, že sken je podepsané vyhotovení/ }).check();
    await c.getByRole("button", { name: "Uložit podpis" }).click();
  }

  // ---- K: papierovy podpis zmluvy -------------------------------------
  await uploadScan(contract.id, [`Pavla ${last}`, "Mgr. Jana Zkušební"], fakePdf);
  await expect(card(contract.id).getByText("Sken musí být PDF, PNG nebo JPG.")).toBeVisible();
  expect(await sigs(contract.id)).toHaveLength(0);
  await uploadScan(contract.id, [`Pavla ${last}`, "Mgr. Jana Zkušební"], scanFile);
  await expect(card(contract.id).getByRole("button", { name: "Uložit podpis" })).toHaveCount(0, { timeout: 30000 });
  await expect.poll(async () => (await doc(contract.id)).status, { timeout: 30000 }).toBe("SIGNED");
  const cs = await sigs(contract.id);
  expect(cs.map((s) => s.signer_type).sort()).toEqual(["EMPLOYEE", "EMPLOYER"]);
  for (const s of cs) expect(s).toMatchObject({ method: "PAPER", document_hash: sha(scan), signed_content_sha256: contract.finalSha });
  // ulozeny sken = nahraty subor (otisk spocital server)
  const { data: storedScan } = await service.storage.from("hr-dokumenty").download(cs[0].file_path);
  expect(sha(Buffer.from(await storedScan.arrayBuffer()))).toBe(sha(scan));
  // detail ukazuje sposob podpisu „papír (sken)“
  await card(contract.id).getByRole("button", { name: /Detail – vytvoření, podpis/ }).click();
  await expect(card(contract.id).getByText(/papír \(sken\)/).first()).toBeVisible();

  // ---- L1: potvrdenie o prevzati k podpisanej zmluve -------------------
  await card(contract.id).getByRole("button", { name: "Vytvořit potvrzení o převzetí" }).click();
  let receiptId = null;
  await expect.poll(async () => {
    const { data } = await service.from("hr_documents").select("id, variables_snapshot, status").eq("employee_id", empId).eq("doc_type", "potvrzeni_prevzeti");
    receiptId = data?.[0]?.id || null;
    return data?.length || 0;
  }, { timeout: 60000 }).toBe(1);
  const receipt = await doc(receiptId);
  expect(receipt).toMatchObject({ status: "READY_FOR_SIGNATURE", legal_act_type: "RECEIPT_ACKNOWLEDGEMENT" });
  expect(receipt.variables_snapshot.target_document_id).toBe(contract.id);
  await expect(card(receiptId)).toBeVisible({ timeout: 30000 });
  await uploadScan(receiptId, [`Pavla ${last}`], scanFile);
  await expect.poll(async () => (await doc(receiptId)).status, { timeout: 30000 }).toBe("SIGNED");
  expect(await sigs(receiptId)).toMatchObject([{ method: "PAPER", signer_type: "EMPLOYEE", signed_content_sha256: receipt.final_pdf_sha256 }]);

  // ---- L2: mzdovy vymer - podpis zamestnavatela skenom, predanie (§ 334) --
  await uploadScan(vymer.id, ["Mgr. Jana Zkušební"], scanFile);
  await expect.poll(async () => (await doc(vymer.id)).status, { timeout: 30000 }).toBe("SIGNED");
  await card(vymer.id).getByRole("button", { name: /Detail – vytvoření, podpis/ }).click();
  await card(vymer.id).getByRole("button", { name: "Zaznamenat předání" }).click();
  const form = card(vymer.id).locator("div.bg-slate-50").filter({ hasText: "Zaznamenat osobní předání vyhotovení" }).last();
  // pisomnost § 334 len proti podpisu potvrdenia o prevzati
  const receiptBox = form.getByRole("checkbox", { name: /Zaměstnanec převzetí potvrdil podpisem/ });
  await expect(receiptBox).toBeChecked();
  await receiptBox.uncheck();
  await form.getByRole("button", { name: "Zaznamenat předání" }).click();
  await expect(form.getByText("Písemnost § 334 lze předat jen proti podpisu potvrzení o převzetí.")).toBeVisible();
  await receiptBox.check();
  await form.getByRole("button", { name: "Zaznamenat předání" }).click();
  await expect(form.getByText("Nahrajte sken podepsaného potvrzení o převzetí.")).toBeVisible();
  const receiptScan = await pdf(["Potvrzeni o prevzeti mzdoveho vymeru - podpis zamestnance (test)"]);
  await form.locator("input[type=file]").setInputFiles({ name: "potvrzeni.pdf", mimeType: "application/pdf", buffer: receiptScan });
  await form.getByRole("button", { name: "Zaznamenat předání" }).click();
  await expect.poll(async () => (await service.from("hr_document_deliveries").select("*").eq("hr_document_id", vymer.id)).data.length, { timeout: 30000 }).toBe(1);
  const { data: [dl] } = await service.from("hr_document_deliveries").select("*").eq("hr_document_id", vymer.id);
  expect(dl).toMatchObject({ channel: "IN_PERSON_PAPER", receipt_scan_sha256: sha(receiptScan) });
  expect(dl.delivered_at).toBeTruthy();
  const { data: storedReceipt } = await service.storage.from("hr-dokumenty").download(dl.receipt_scan_path);
  expect(sha(Buffer.from(await storedReceipt.arrayBuffer()))).toBe(sha(receiptScan));
  await expect(card(vymer.id).getByRole("button", { name: "Zaznamenat předání" })).toBeDisabled({ timeout: 30000 });
});
