import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves projekt-stranky z podadresara (/stenger-erp/), zatial
// co Netlify z korena (/) - GH_PAGES=true nastavuje iba GitHub Actions
// workflow pri buildovani pre Pages, Netlify build o tejto premennej nevie
// a pouzije default "/".
export default defineConfig({
  base: process.env.GH_PAGES === "true" ? "/stenger-erp/" : "/",
  plugins: [react()],
  // dev server nesleduje vystup buildu a testov - `npm run build` pri bezacom
  // serveri inak na Windows zhodi watcher (EBUSY v dist/)
  server: { watch: { ignored: ["**/dist/**", "**/test-results/**", "**/playwright-report/**"] } },
});
