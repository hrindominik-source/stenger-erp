// E2E testy v skutocnom prehliadaci proti LOKALNEMU Supabase.
// Spustenie: scripts/test-local-e2e.sh (vlastny Vite na porte 5190, dev
// server na 5180 ostava nedotknuty). Prehliadac: nainstalovany Chrome.
import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const localChrome = path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe");

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.js", // nie *.test.js - vitest ich nezbiera
  timeout: 120000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5190",
    headless: process.env.E2E_HEADED !== "1", // E2E_HEADED=1 = viditelne okno (GPU vykreslovanie ako pri rucnom teste)
    ...(fs.existsSync(localChrome) ? { launchOptions: { executablePath: localChrome } } : { channel: "chrome" }),
  },
  webServer: {
    command: "npx vite --port 5190 --strictPort",
    url: "http://localhost:5190",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
