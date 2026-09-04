import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves projekt-stranky z podadresara (/stenger-erp/), zatial
// co Netlify z korena (/) - GH_PAGES=true nastavuje iba GitHub Actions
// workflow pri buildovani pre Pages, Netlify build o tejto premennej nevie
// a pouzije default "/".
export default defineConfig({
  base: process.env.GH_PAGES === "true" ? "/stenger-erp/" : "/",
  plugins: [react()],
});
