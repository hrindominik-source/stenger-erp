// ESLint (flat config). Spustenie: npm run lint
// Chyby = skutocne chyby (nedefinovane premenne, porusenie pravidiel hookov,
// nedosiahnutelny kod); styl a nepouzite premenne len ako varovania, aby lint
// nebrzdil pracu na velkych suboroch (App.jsx, PersonalistikaModule.jsx).
// TypeScript Edge Functions (*.ts) kontroluje Deno, nie ESLint.
import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["dist/**", "node_modules/**", "test-results/**", "playwright-report/**", "public/**", "supabase/.temp/**", "**/*.ts"] },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "detect" } },
    rules: {
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "error",
      "react/jsx-no-undef": "error",
      "react/jsx-key": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      // NBSP a ine medzery v regexoch / retazcoch su umyselne (cisla v PDF, Kc)
      "no-irregular-whitespace": ["error", { skipStrings: true, skipRegExps: true, skipTemplates: true }],
    },
  },
  // Node: konfiguracia, skripty, testy (vitest, Playwright)
  {
    files: ["*.config.js", "scripts/**/*.{js,mjs}", "e2e/**/*.js", "**/*.test.js", "**/*.it.test.js", "src/lib/hr/__fixtures__/**/*.{js,mjs}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  // zdielany kod Edge Functions (bezi v Deno aj v prehliadaci / testoch)
  {
    files: ["supabase/functions/**/*.js"],
    languageOptions: { globals: { ...globals.browser, Deno: "readonly" } },
  },
];
