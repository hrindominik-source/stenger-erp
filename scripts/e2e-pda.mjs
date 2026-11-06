// E2E test testovacieho rezimu PDA (?pda=test) v skutocnom Chrome.
//
//   npm run e2e:pda            (Chrome sa hlada automaticky, inak CHROME_PATH=...)
//   HEADED=1 npm run e2e:pda   (s viditelnym oknom)
//
// Bezpecnost: build sa robi s FALOSNOU adresou Supabase (127.0.0.1:9) a kazda
// poziadavka na *.supabase.co sa zablokuje a spocita - test nemoze zapisat do
// produkcie. Testovaci rezim aj tak pracuje len so simulovanou DB v prehliadaci.

import { build, preview } from "vite";
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as XLSX from "xlsx";

const OUT = join(tmpdir(), "stenger-pda-e2e");
const DIST = join(OUT, "dist");
mkdirSync(OUT, { recursive: true });

function findChrome() {
  const c = [
    process.env.CHROME_PATH,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  const found = c.find((p) => existsSync(p));
  if (!found) throw new Error("Chrome nenájdený - nastavte CHROME_PATH.");
  return found;
}

let passed = 0;
const fails = [];
async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log("  ✓ " + name);
  } catch (e) {
    fails.push(name);
    console.log("  ✗ " + name + "\n      " + String(e.message || e).split("\n")[0]);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

process.env.GH_PAGES = "true";
process.env.VITE_SUPABASE_URL = "http://127.0.0.1:9";
process.env.VITE_SUPABASE_ANON_KEY = "e2e-dummy-key";

console.log("Build (falošný Supabase)…");
await build({ logLevel: "error", build: { outDir: DIST, emptyOutDir: true } });
const server = await preview({ logLevel: "error", build: { outDir: DIST }, preview: { port: 4188, strictPort: true } });
const URL = "http://localhost:4188/stenger-erp/?pda=test";

const browser = await chromium.launch({ executablePath: findChrome(), headless: !process.env.HEADED });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
let supabaseRequests = 0;
await context.route(/supabase\.co|127\.0\.0\.1:9/, (route) => {
  supabaseRequests++;
  route.abort();
});
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

const phone = page.locator("div[style*='translateZ']");
const banner = () => phone.locator("div.rounded-xl.text-lg").first().innerText();
const ulozenych = async () => phone.getByText("Uloženo", { exact: true }).count();
const db = () => page.evaluate(() => JSON.parse(localStorage.getItem("stenger_pda_demo_db") || '{"vydajky":[],"palety":[]}'));
async function waitSaved(n) {
  await page.waitForFunction((n) => document.querySelectorAll("div[style*='translateZ'] span").length && [...document.querySelectorAll("div[style*='translateZ'] span")].filter((s) => s.textContent.trim() === "Uloženo").length === n, n, { timeout: 8000 });
}
const shot = (name) => page.screenshot({ path: join(OUT, name + ".png") });

console.log("Chrome E2E – " + URL);
try {
  await page.goto(URL);
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();

  await step("testovací režim: banner, bez přihlášení", async () => {
    await page.getByText("TESTOVACÍ REŽIM PDA").waitFor();
    await phone.getByText("Kdo skenuje?").waitFor();
  });

  await step("výběr pracovníka a nová výdejka s LS", async () => {
    await phone.getByRole("button", { name: "Martin Dostál" }).click();
    await phone.getByRole("button", { name: /Nová výdejka/ }).click();
    await phone.locator("input").first().fill("LS-4711");
    await page.keyboard.press("Enter");
    // Hned skenovat (pred dokoncenim nacitania) - test subehu.
    await page.getByRole("button", { name: /Nová paleta: SSCC → produkt/ }).click();
    await phone.getByText("LS LS-4711").waitFor();
  });

  await step("paleta 1: SSCC → produkt = Uloženo", async () => {
    await waitSaved(1);
  });

  await step("paleta 2: produkt → SSCC = Uloženo", async () => {
    await page.getByRole("button", { name: /Nová paleta: produkt → SSCC/ }).click();
    await waitSaved(2);
  });

  const prveSscc = (await db()).palety[0].sscc;

  // Kody konkretnej vygenerovanej palety v simulatore: [0] = SSCC, [1] = produkt.
  const kodyPalety = (sscc) => page.locator("div.border-l-4", { hasText: "SSCC …" + sscc.slice(-6) }).getByRole("button", { name: "Skenovat" });

  await step("duplicita SSCC ve stejné výdejce = chyba, nic se neuloží", async () => {
    await kodyPalety(prveSscc).nth(0).click();
    await page.waitForFunction(() => /už je v této výdejce/.test(document.querySelector("div[style*='translateZ']").innerText), null, { timeout: 4000 });
    assert((await db()).palety.length === 2, "v DB musí zůstat 2 palety");
  });

  await step("klávesnice PC: skutečné stisky kláves, GS = Ctrl+], Enter", async () => {
    const sscc = "306141410000004242".slice(0, 17);
    const { gs1CheckDigit } = await import("../src/lib/gs1.js");
    const full = sscc + gs1CheckDigit(sscc);
    await phone.click({ position: { x: 150, y: 400 } });
    await page.keyboard.type("00" + full, { delay: 5 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("0214001234000012" + "15270315" + "3748", { delay: 5 });
    await page.keyboard.press("Control+BracketRight");
    await page.keyboard.type("10KLAV1", { delay: 5 });
    await page.keyboard.press("Enter");
    try {
      await waitSaved(3);
    } catch (e) {
      throw new Error("PDA: " + JSON.stringify(await phone.innerText()).slice(0, 400) + " | DB: " + JSON.stringify((await db()).palety.map((x) => [x.sscc, x.sarza, x.mnozstvo])));
    }
    const p = (await db()).palety.find((x) => x.sscc === full);
    assert(p && p.sarza === "KLAV1" && p.mnozstvo === 48 && p.bbd === "2027-03-15", "paleta z klávesnice: " + JSON.stringify(p));
  });

  await step("bez sítě: Neuloženo, Dokončit zakázáno; po obnovení Zkusit znovu = Uloženo", async () => {
    await page.getByRole("button", { name: "Bez sítě" }).click();
    await page.getByRole("button", { name: /Nová paleta: SSCC → produkt/ }).click();
    await phone.getByText("Neuloženo", { exact: true }).waitFor({ timeout: 6000 });
    assert(/NEULOŽENA/.test(await banner()), "banner NEULOŽENA");
    assert(await phone.getByRole("button", { name: /Dokončit výdejku/ }).isDisabled(), "Dokončit musí být zakázané");
    assert((await db()).palety.length === 3, "offline nesmí nic zapsat");
    await shot("1-bez-site");
    await page.getByRole("button", { name: "Normální síť" }).click();
    await phone.getByRole("button", { name: /Zkusit znovu/ }).click();
    await waitSaved(4);
  });

  await step("ztracená odpověď: po opakování bez duplicity", async () => {
    await page.getByRole("button", { name: "Ztracená odpověď" }).click();
    await page.getByRole("button", { name: /Nová paleta: SSCC → produkt/ }).click();
    await phone.getByText("Neuloženo", { exact: true }).waitFor({ timeout: 6000 });
    assert((await db()).palety.length === 5, "zápis proběhl i přes ztracenou odpověď");
    await page.getByRole("button", { name: "Normální síť" }).click();
    await phone.getByRole("button", { name: /Zkusit znovu/ }).click();
    await waitSaved(5);
    const pal = (await db()).palety;
    assert(pal.length === 5 && new Set(pal.map((p) => p.sscc)).size === 5, "žádná duplicita");
  });

  await step("neúplná paleta: jen SSCC → Dokončit zakázáno, zrušení → povoleno", async () => {
    await page.getByRole("button", { name: "Jen vygenerovat kódy" }).click();
    await page.getByRole("button", { name: "Skenovat" }).first().click();
    await phone.getByText("SSCC načteno – naskenujte produktový kód.").waitFor();
    assert(await phone.getByRole("button", { name: /Dokončit výdejku/ }).isDisabled(), "Dokončit zakázáno");
    await phone.getByText("Dokončete nebo zrušte rozpracovanou paletu.").waitFor();
    await phone.getByRole("button", { name: "Zrušit rozpracovanou paletu" }).click();
    assert(!(await phone.getByRole("button", { name: /Dokončit výdejku/ }).isDisabled()), "Dokončit povoleno");
  });

  await step("chybné kódy: kontrolní číslice, EAN-13, chybějící GS", async () => {
    await page.getByRole("button", { name: "Chybná kontrolní číslice SSCC" }).click();
    await page.waitForFunction(() => /kontrolní číslici/.test(document.querySelector("div[style*='translateZ']").innerText));
    await page.getByRole("button", { name: "Běžný EAN-13" }).click();
    await page.waitForFunction(() => /EAN/.test(document.querySelector("div[style*='translateZ']").innerText));
    await page.getByRole("button", { name: /Chybí GS za AI 37/ }).click();
    await page.waitForFunction(() => /oddělovač FNC1/.test(document.querySelector("div[style*='translateZ']").innerText));
    assert((await db()).palety.length === 5, "chybné kódy nic neuloží");
  });

  await step("dokončení: souhrn → Potvrdit → Výdejka dokončena", async () => {
    try {
      await phone.getByRole("button", { name: /Dokončit výdejku \(5\)/ }).click({ timeout: 5000 });
    } catch (e) {
      throw new Error("PDA: " + JSON.stringify(await phone.innerText()).slice(0, 300));
    }
    await phone.getByText(/Potvrdit dokončení/).waitFor();
    await shot("2-souhrn");
    await phone.getByRole("button", { name: /Potvrdit dokončení/ }).click();
    await phone.getByText("Výdejka dokončena").waitFor();
    assert((await db()).vydajky[0].stav === "dokoncena", "stav dokoncena");
    await phone.getByRole("button", { name: "Hotovo" }).click();
  });

  await step("SSCC z dokončené výdejky v nové výdejce = odmítnuto", async () => {
    await phone.getByRole("button", { name: /Nová výdejka/ }).click();
    await phone.locator("input").first().fill("LS-4712");
    await page.keyboard.press("Enter");
    await phone.getByText("LS LS-4712").waitFor();
    await kodyPalety(prveSscc).nth(0).click();
    await kodyPalety(prveSscc).nth(1).click();
    await page.waitForFunction(() => /dokončené výdejce LS LS-4711/.test(document.querySelector("div[style*='translateZ']").innerText), null, { timeout: 6000 });
    assert((await db()).palety.filter((p) => p.sscc === prveSscc).length === 1, "SSCC jen jednou v DB");
    await shot("3-duplicita-dokoncena");
  });

  await step("kancelář: výdejka LS-4711 dokončená, 5 palet", async () => {
    const office = page.locator("text=Kancelář (Stenger ONE").locator("xpath=..");
    await office.getByText("LS-4711").waitFor();
    const row = office.locator("tr", { hasText: "LS-4711" });
    assert(/Dokončená/.test(await row.innerText()), "stav v kanceláři");
    assert(/\b5\b/.test(await row.innerText()), "počet palet 5");
  });

  await step("NVE list (MAXIM): LS-4711.xlsx, list NVE List, 5 SSCC jako text, součty", async () => {
    const office = page.locator("text=Kancelář (Stenger ONE").locator("xpath=..");
    await office.locator("tr", { hasText: "LS-4711" }).first().click();
    const [download] = await Promise.all([page.waitForEvent("download"), office.getByRole("button", { name: /NVE list \(MAXIM\)/ }).click()]);
    assert(download.suggestedFilename() === "LS-4711.xlsx", "název souboru: " + download.suggestedFilename());
    const file = join(OUT, download.suggestedFilename());
    await download.saveAs(file);
    const ws = XLSX.read(readFileSync(file), { cellFormula: true }).Sheets["NVE List"];
    assert(ws && ws.A1.v === "NVE LIST Nr: LS-4711", "nadpis: " + (ws && ws.A1 && ws.A1.v));
    const sscc = Object.keys(ws).filter((k) => /^D\d+$/.test(k) && /^\d{18}$/.test(String(ws[k].v)));
    assert(sscc.length === 5 && sscc.every((k) => ws[k].t === "s"), "SSCC: " + sscc.length);
    assert(ws.D7.v === (await db()).palety.slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1))[0].sscc, "pořadí skenování");
    assert(ws.E12.f === "SUM(E7:E11)" && ws.D14.v === "TOTAL" && ws.E14.v === 5, "součty");
    assert(/TEST POPCORN 200g/.test(ws.C7.v) && ws.B7.v === "62 99901", "produkt: " + ws.B7.v + " / " + ws.C7.v);
    console.log("      → " + file);
  });

  await step("Přehled výdejek (Excel): 3 listy, 5 palet LS-4711", async () => {
    const office = page.locator("text=Kancelář (Stenger ONE").locator("xpath=..");
    const [download] = await Promise.all([page.waitForEvent("download"), office.getByRole("button", { name: /Přehled výdejek/ }).click()]);
    const file = join(OUT, download.suggestedFilename());
    await download.saveAs(file);
    const wb = XLSX.read(readFileSync(file));
    assert(wb.SheetNames.join(",") === "Palety,Souhrn,Výdejky", "listy: " + wb.SheetNames);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets.Palety).filter((r) => r.Lieferschein === "LS-4711");
    assert(rows.length === 5, "palet v exportu: " + rows.length);
    assert(rows.every((r) => /^\d{18}$/.test(String(r.SSCC)) && r.GTIN), "SSCC/GTIN vyplněné");
    console.log("      → " + file);
  });

  await step("žádný požadavek na Supabase, žádná chyba JS", async () => {
    assert(supabaseRequests === 0, "požadavků na Supabase: " + supabaseRequests);
    assert(pageErrors.length === 0, "chyby JS: " + pageErrors.join(" | "));
  });
  await shot("4-konec");

  await step("starý Chrome: místo bílé obrazovky hláška s verzí", async () => {
    // Emulacia: nova syntax neprejde (Function hodi SyntaxError) a JS balik sa nespusti.
    const old = await context.newPage();
    await old.addInitScript(() => {
      const F = window.Function;
      window.Function = function (...a) {
        if (/\?\?=|\?\./.test(a.join(" "))) throw new SyntaxError("Unexpected token");
        return F(...a);
      };
    });
    await old.route(/\/assets\/.*\.js$/, (r) => r.abort());
    await old.goto(URL.replace("?pda=test", "?pda=1"));
    await old.getByText("Prohlížeč je příliš starý").waitFor({ timeout: 5000 });
    assert(/Chrome \d+/.test(await old.locator("#root").innerText()), "verze Chrome v hlášce");
    await old.close();
  });
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}

console.log(`\n${passed} OK, ${fails.length} chyb. Screenshoty: ${OUT}`);
process.exit(fails.length ? 1 : 0);
