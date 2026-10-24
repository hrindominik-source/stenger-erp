# Porovnanie štruktúry stagingu a produkcie

Bez `pg_dump` a bez hesla k databáze – len `scripts/schema-catalog.sql` v Supabase SQL Editore (iba čítanie katalógu, žiadne riadky z tabuliek).

Katalóg obsahuje: stĺpce, obmedzenia, indexy, RLS a politiky (public + storage), funkcie (telo len ako SHA-256), pohľady (SHA-256), triggre, práva `anon` / `authenticated` (schémy, tabuľky, stĺpce, funkcie, sekvencie), nastavenie bucketov, rozšírenia, históriu migrácií (obsah len ako SHA-256; ak tabuľka chýba, riadok „(chyba)“) a cron úlohy (názov, rozvrh, stav – bez príkazu).

CSV súbory ukladať **mimo repozitára**: `C:\Users\Hrin\Documents\stenger-porovnanie\`.

## Postup

1. **SQL Editor stagingu** – https://supabase.com/dashboard/project/gzbrniotozvrhjuuqrdm/sql/new (ľavé menu projektu → *SQL Editor* → *New query*).
2. **Vložiť a spustiť** – celý obsah `scripts/schema-catalog.sql` vložiť do editora → *Run*. Ak má editor obmedzenie počtu riadkov výsledku, nastaviť ho na *No limit* (lokálne vychádza okolo 1 500 riadkov). Dotaz nič nemení.
3. **Stiahnuť CSV** – nad tabuľkou výsledku *Export* → *Download CSV* (príp. *Results* → *Download CSV*) → uložiť ako `C:\Users\Hrin\Documents\stenger-porovnanie\staging.csv`.
4. **To isté pre produkciu** – https://supabase.com/dashboard/project/zvvlxrfghkizflfbqfrk/sql/new → ten istý obsah → *Run* → uložiť ako `C:\Users\Hrin\Documents\stenger-porovnanie\produkcia.csv`.
5. **Porovnať lokálne** – v priečinku `stenger-erp-hr`:
   ```
   node scripts/compare-schema-catalog.mjs C:\Users\Hrin\Documents\stenger-porovnanie\staging.csv C:\Users\Hrin\Documents\stenger-porovnanie\produkcia.csv --out C:\Users\Hrin\Documents\stenger-porovnanie\porovnanie.md
   ```
   Správa: čo je len na stagingu, len v produkcii a čo sa líši (podľa druhu). Návratový kód 0 = zhoda, 1 = rozdiely.

Rovnako sa dá porovnať s lokálnou DB: `docker exec -i supabase_db_stenger-erp-hr psql -U postgres --csv < scripts/schema-catalog.sql > C:\Users\Hrin\Documents\stenger-porovnanie\lokalne.csv`.

Poznámka: lokálne majú `anon` a `authenticated` plné práva na tabuľky `public` (predvolené granty Supabase) – prístup chráni RLS. Porovnanie ukáže, či je to na stagingu a v produkcii rovnako.
