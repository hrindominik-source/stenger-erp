// Podpis zamestnanca na tablete v skutocnom prehliadaci: § 21 oznamenie
// vytvori server (hr-declarations), HR vyda podpisovy odkaz (hr-signing
// issue), tablet zada kod, PDF sa vykresli, strany sa prezru posuvanim
// a podpis sa spristupni. Ziadne obchadzanie UI. Vymyslene udaje.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { approveTextsForTest } from "../src/lib/hr/itApprovedTexts.js";

const URL_ = process.env.LOCAL_SUPABASE_URL;
const ANON = process.env.LOCAL_SUPABASE_ANON_KEY;
const SERVICE = process.env.LOCAL_SUPABASE_SERVICE_KEY;
const enabled = !!(URL_ && ANON && SERVICE && /^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_ || ""));
const run = Date.now().toString(36);

let service, hr, approved;

async function invoke(client, fn, body, retry = 1) {
  const { data, error } = await client.functions.invoke(fn, { body });
  // 546 WORKER_LIMIT = limit CPU lokalneho edge runtime (generovanie PDF), nie chyba testovaneho UI
  if (error?.context?.status === 546 && retry > 0) return invoke(client, fn, body, retry - 1);
  if (error) throw new Error(`${fn} ${body.action}: ${error.context?.status} ${await error.context?.text?.()}`);
  return data;
}

async function issueS21(suffix) {
  const empId = `emp-e2e-${run}-${suffix}`;
  await service.from("employees").insert({ id: empId, first_name: "Eva", last_name: "Tabletová", record_flag: "TEST", private_email: `eva.${run}.${suffix}@example.test` });
  const d = await invoke(hr, "hr-declarations", { action: "create", employee_id: empId, kind: "S21" });
  return invoke(hr, "hr-signing", { action: "issue", document_id: d.document_id, identity: { document_type: "OP", confirmed: true } });
}

// pomer bielych a tmavych pixelov vsetkych platien strany (citanie pixelov, nie snimka)
const canvasStats = (page) => page.evaluate(() => [...document.querySelectorAll("[data-page] canvas")].map((c) => {
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let white = 0, dark = 0;
  for (let i = 0; i < d.length; i += 4) {
    const opaque = d[i + 3] === 255;
    if (opaque && d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) white++;
    else if (opaque && d[i] < 100 && d[i + 1] < 100 && d[i + 2] < 100) dark++;
  }
  const n = d.length / 4;
  return { white: white / n, dark: dark / n };
}));

test.describe("podpis na tablete – vykreslenie a prezretie stran", () => {
  test.skip(!enabled, "chyba lokalny Supabase (scripts/test-local-e2e.sh)");

  test.beforeAll(async () => {
    service = createClient(URL_, SERVICE, { auth: { persistSession: false } });
    const seed = fs.readFileSync(path.resolve("supabase/seed.sql"), "utf8");
    const [, email, password] = seed.match(/(personalista@test\.local) \/ (\S+)/);
    hr = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { error } = await hr.auth.signInWithPassword({ email, password });
    if (error) throw error;
    // § 21 je od migracie 66 neschvaleny - docasne schvalenie len pre test
    approved = await approveTextsForTest(service, ["S21_ADDRESS_NOTICE"], run);
  });
  test.afterAll(async () => { await approved?.cleanup(); });

  // 1024x700 = notebook, 820x1180 = tablet na vysku, 1280x415 = nizke okno z rucneho testu
  for (const vp of [{ width: 1024, height: 700 }, { width: 820, height: 1180 }, { width: 1280, height: 415 }]) {
    test(`okno ${vp.width}×${vp.height}: strana je citatelna, po posunuti na koniec sa podpis spristupni`, async ({ page }) => {
      await page.setViewportSize(vp);
      const { token, code } = await issueS21(`${vp.width}`);
      await page.goto(`/?podpis=${token}`);
      await page.getByLabel("Kód").fill(code);
      await page.getByRole("button", { name: "Pokračovat" }).click();

      const counter = page.getByText(/Zobrazeno \d+ z \d+ stran/);
      await expect(counter).toBeVisible({ timeout: 30000 });
      await expect(page.locator("[data-page] canvas").first()).toBeVisible();
      await expect(page.locator("[data-rendered=true]")).toHaveCount(await page.locator("[data-page]").count());

      // strana je biela s citatelnym textom
      for (const s of await canvasStats(page)) {
        expect(s.white).toBeGreaterThan(0.6);
        expect(s.dark).toBeGreaterThan(0.002);
      }
      // bez vodorovneho posuvnika (prehliadac ani prehliadac PDF)
      const overflow = await page.evaluate(() => {
        const box = document.querySelector("[data-pdf-scroll]");
        return { doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, box: box.scrollWidth - box.clientWidth };
      });
      expect(overflow.doc).toBeLessThanOrEqual(0);
      expect(overflow.box).toBeLessThanOrEqual(0);

      // pred posunutim nie je podpis mozny - a je napisane preco
      const signBtn = page.getByRole("button", { name: "Podepsat" });
      const blocked = page.getByTestId("sign-blocked");
      await expect(signBtn).toBeDisabled();
      await expect(blocked).toHaveText(/Projděte prosím celý dokument až na konec \(zobrazeno 0 z \d+ stran\)/);

      // posuvanie koleckom v prehliadaci PDF az na koniec, potom stranka
      const box = page.locator("[data-pdf-scroll]");
      await box.scrollIntoViewIfNeeded();
      const bb = await box.boundingBox();
      await page.mouse.move(bb.x + bb.width / 2, bb.y + Math.min(bb.height, vp.height - bb.y) / 2);
      for (let i = 0; i < 40; i++) {
        await page.mouse.wheel(0, 300);
        await page.waitForTimeout(50);
      }
      await expect(counter).toHaveText(/Zobrazeno (\d+) z \1 stran/);

      await expect(blocked).toHaveText("Potvrďte prosím jméno zaškrtnutím nahoře.");
      await page.getByRole("checkbox").check();
      await expect(blocked).toHaveText("Podepište se prosím do podpisového pole.");

      // prilis kratky podpis (ciarka), potom cely podpis prstom (mys)
      const pad = page.getByLabel("Podpisové pole");
      await pad.scrollIntoViewIfNeeded();
      const pb = await pad.boundingBox();
      await page.mouse.move(pb.x + 30, pb.y + 30);
      await page.mouse.down();
      await page.mouse.move(pb.x + 34, pb.y + 32);
      await page.mouse.up();
      await expect(blocked).toHaveText("Podpis je příliš krátký – podepište se prosím celým podpisem.");
      await expect(signBtn).toBeDisabled();
      await page.mouse.move(pb.x + 20, pb.y + 20);
      await page.mouse.down();
      for (let i = 1; i <= 15; i++) await page.mouse.move(pb.x + 20 + i * 12, pb.y + 20 + (i % 5) * 8);
      await page.mouse.up();
      await expect(signBtn).toBeEnabled();
      await expect(blocked).toHaveCount(0);
    });
  }
});
