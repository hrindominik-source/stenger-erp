# Nasadenie a rollback (na neskoršie schválenie)

**Nič z tohto sa zatiaľ nespúšťa v produkcii.**

## Lokálny vývoj

1. Docker Desktop beží.
2. `npx supabase start` (prvé spustenie sťahuje obrazy).
3. `npx supabase db reset` – aplikuje `supabase/migrations/*` + `supabase/seed.sql` (vymyslené dáta).
4. `npx supabase test db` – pgTAP testy.
5. `npm run dev` – `.env.development.local` (necommituje sa) ukazuje na `http://127.0.0.1:54321`; má prednosť pred `.env.local` (produkcia). Overenie: `node -e "import('vite').then(v=>console.log(v.loadEnv('development',process.cwd(),'VITE_').VITE_SUPABASE_URL))"`.
6. Testovacie prihlásenie: viď hlavička `supabase/seed.sql`. E-maily: Mailpit `http://127.0.0.1:54324`.

`.env.development.local` vytvoríte príkazom (bash):
```
npx supabase status -o env | grep -E '^(API_URL|ANON_KEY)=' | sed -e 's/^API_URL=/VITE_SUPABASE_URL=/' -e 's/^ANON_KEY=/VITE_SUPABASE_ANON_KEY=/' > .env.development.local
```

## Baseline

`20261022120000_baseline.sql` je zatiaľ **dočasná** kópia `supabase/schema.sql`. Po porovnaní s katalógom produkcie (`scripts/schema-catalog.sql`) sa opraví podľa skutočného stavu. V produkcii sa baseline **nespúšťa** – produkcia ju už má; pri prípadnom zavedení migrácií do produkcie by sa označila ako aplikovaná (`supabase migration repair --status applied 20261022120000`) – to je zápis do produkcie a vyžaduje samostatný súhlas.

## Produkčné nasadenie migrácie 48 (po schválení)

1. Záloha (Supabase → Database → Backups) a export schémy.
2. Kontrola, že v produkcii nie sú `hr_documents` v stave, ktorý by porušil nové CHECK (napr. `SIGNED` bez dôvodu nie je problém; `VOIDED` neexistuje).
3. Spustenie `20261022130000_podpisy_dorucovani.sql` v SQL Editore (v transakcii) **alebo** cez migrácie – podľa rozhodnutia.
   - Backfill 48.11 nastaví `locked_at` existujúcim `SIGNED/ARCHIVED` dokumentom (dátová zmena).
   - Mení signatúry RPC `hr_onboarding_start_session` a `hr_admin_delete_employee` → frontend sa musí nasadiť **spolu** (starý frontend: kiosk funguje, trvalé mazanie bez dôvodu zlyhá).
4. Nasadenie frontendu (`hr-merge-tmp` → `main`).
5. Overenie: `scripts/schema-catalog.sql` na produkcii vs. lokálne.

## Rollback

`supabase/rollback/20261022130000_podpisy_dorucovani_rollback.sql` – sám sa zastaví, ak už existujú elektronické podpisy, vyhlásenia, doručenia alebo dokumenty z dotazníka. Potom znovu spustiť sekcie 45.6/47, 45.7, 45.8 zo `schema.sql`. Lokálne otestované (reset → rollback → schema.sql → pôvodný stav).

## Pravidelné upratovanie kiosku

`hr_onboarding_cleanup()` sa volá pri každom štarte relácie. Voliteľne v produkcii pg_cron (vyžaduje súhlas – zmena nastavenia produkcie).
