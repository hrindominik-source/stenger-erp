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

`20261022120000_baseline.sql` = stav produkcie overený 22. 10. 2026 (viď `03-porovnanie-produkcie.md`). Tabuľka `dochadzka_nastavenia`, ktorá v produkcii chýba, sa rieši oddelene na vetve `fix/dochadzka-nastavenia` (lokálne preto nastavenia Dochádzky zlyhávajú rovnako ako v produkcii). V produkcii sa baseline **nespúšťa** – produkcia ju už má; pri prípadnom zavedení migrácií do produkcie by sa označila ako aplikovaná (`supabase migration repair --status applied 20261022120000`) – to je zápis do produkcie a vyžaduje samostatný súhlas.

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

## Fáza C – finálne PDF a podpísaný originál (overenie na serveri)

- Migrácia `20261022140000_finalne_pdf.sql`: `final_pdf_*` a `signed_pdf_*` zapisuje len server (service role); hash ani výsledok kontroly z prehliadača DB neprijme.
- Edge Functions `hr-finalize-pdf` a `hr-signed-original` (deploy až po schválení; potrebujú len štandardné `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, žiadne nové secrets).
- Poradie nasadenia: najprv Edge Functions, potom migrácia 49 (inak by HR nemohlo finalizovať PDF).
- Rollback: najprv `supabase/rollback/20261022140000_finalne_pdf_rollback.sql`, potom rollback 48. Lokálne otestované.
- Lokálne testy: `npx supabase test db` (pgTAP), `bash scripts/test-local-it.sh` (Edge Functions proti lokálnemu Supabase; skript odmietne nelokálnu URL).
- Lokálne je v `supabase/config.toml` vypnuté `[analytics]` (vector/analytics na tomto PC padali a blokovali `supabase start`); na produkciu to nemá vplyv.

## Fáza D – vstupný dotazník (kiosk)

- Migrácia `20261022150000_kiosk_podpisy.sql`:
  - koncepty textov § 21, § 335 (poučenie aj súhlas) a prejavov vôle, všetky so stavom KONCEPT a s označením „KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU“ v texte;
  - `onboarding_sessions.signing_mode`;
  - po prvom podpise sa dotazník už nedá upraviť;
  - `hr_onboarding_submit(token, 'ELECTRONIC'|'PAPER')`;
  - pri zamietnutí dotazníka sa nepodpísané dokumenty iba zneplatnia.
- Edge Function `hr-kiosk`: PDF na podpis generuje a ukladá iba server z údajov relácie. Kiosk (anon) ich dostane len so svojím tokenom, podpis sa ukladá cez server.
- Spoločné moduly `employeeFields`, `jmhzPdf` a `jmhzFill` sú teraz v `supabase/functions/_shared/hr`; v `src/lib/hr` ostali re-exporty. Vzor dotazníka, písmo a logo sú na serveri skopírované, zhodu s `public/` stráži unit test.
- Rollback: `supabase/rollback/20261022150000_kiosk_podpisy_rollback.sql` (pred 49 a 48). Lokálne otestovaný celý reťazec 50 → 49 → 48.
- Poradie nasadenia: najprv Edge Functions (`hr-kiosk`, `hr-finalize-pdf`, `hr-signed-original`), potom migrácie 48, 49, 50, nakoniec frontend.
- Známe obmedzenie testu: v skrytom okne prehliadača (automatizácia) pdf.js ani sledovanie zobrazených strán nebežia, na viditeľnom tablete áno. Treba ešte ručný test na reálnom tablete.

## Oprava: podpísaný ≠ zamknutý (migrácia 51)

- `20261022160000_uplny_podpis.sql`:
  - zamknutie nastane prvým podpisom, ale stav SIGNED DB povolí, až keď nechýba žiadny podpis podľa `legal_act_type` (zmluva: zamestnanec aj zamestnávateľ);
  - elektronický podpis sa počíta len pre aktuálnu finálnu verziu (hash), papierový sken za každú stranu, ktorú HR označí;
  - odovzdanie alebo odoslanie vyhotovenia je možné len pre úplne podpísaný dokument;
  - typ úkonu sa doplní podľa druhu dokumentu (UI ho doteraz nevypĺňalo); zamknuté historické dokumenty sa nemenia.
- Rollback: `supabase/rollback/20261022160000_uplny_podpis_rollback.sql` (pred 50). Reťazec 51 → 48 je otestovaný lokálne.
- Ručný test kiosku: `rucny-test-kiosku.md`.

## Fáza E – detail dokumentu (migrácia 52)

- `20261022170000_dokumenty_detail.sql`:
  - `hr_document_events`: záznam „staženo k tisku“ s otiskom verzie; len pridávanie, RLS ako pri dokumente;
  - papierový sken sa viaže na otisk finálneho PDF a vyžaduje potvrdenie HR, že sken zodpovedá originálu (`scan_matches_original_confirmed_by`);
  - osobné odovzdanie: kto/kedy sa zapíše; písomnosť § 334 len proti podpisu potvrdenia prevzatia (KONCEPT);
  - `hr_document_new_version`: nepodpísaný dokument → kópia DRAFT v+1, pôvodný SUPERSEDED s dôvodom.
- Rollback: `supabase/rollback/20261022170000_dokumenty_detail_rollback.sql` (pred 51). Reťazec 52 → 48 otestovaný.
- UI: súčasný zoznam a tlačidlá ostali; pod každým dokumentom rozbaľovací „Detail“ (vytvorenie, podpis, odovzdanie, lehoty, akcie). Nástupní balíček: chybí / k podpisu / podepsáno – nepředáno / hotovo.
- Otvorené (F/G): podpis na tablete, odoslanie e-mailom; sken potvrdenia prevzatia sa zatiaľ neukladá (len záznam + poznámka).
