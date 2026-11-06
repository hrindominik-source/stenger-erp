import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import legacy from "@vitejs/plugin-legacy";

// GitHub Pages serves projekt-stranky z podadresara (/stenger-erp/), zatial
// co Netlify z korena (/) - GH_PAGES=true nastavuje iba GitHub Actions
// workflow pri buildovani pre Pages, Netlify build o tejto premennej nevie
// a pouzije default "/".
//
// COMPAT_BUILD=true - ZALOZNY build pre stary Chrome (napr. Zebra TC25 bez
// aktualizacii): syntax znizena na Chrome 64 + polyfilly podla pouzitia.
// Predvolene VYPNUTY - bezny build (a teda cely Stenger ONE) sa nemeni.
// Zapina sa len ak "Test skeneru" / hlaska v index.html ukaze Chrome < 85.
const COMPAT = process.env.COMPAT_BUILD === "true";
const COMPAT_TARGETS = ["chrome64", "edge79", "firefox67", "safari12"];
// Pre kontrolu prehliadaca v index.html (%VITE_COMPAT_BUILD%).
process.env.VITE_COMPAT_BUILD = COMPAT ? "true" : "false";

export default defineConfig({
  base: process.env.GH_PAGES === "true" ? "/stenger-erp/" : "/",
  plugins: [
    react(),
    ...(COMPAT
      ? [legacy({ modernTargets: ["chrome >= 64", "edge >= 79", "firefox >= 67", "safari >= 12"], modernPolyfills: true, renderLegacyChunks: false })]
      : []),
  ],
  ...(COMPAT ? { build: { target: COMPAT_TARGETS } } : {}),
  // dev server nesleduje vystup buildu a testov - `npm run build` pri bezacom
  // serveri inak na Windows zhodi watcher (EBUSY v dist/)
  server: { watch: { ignored: ["**/dist/**", "**/test-results/**", "**/playwright-report/**"] } },
});
