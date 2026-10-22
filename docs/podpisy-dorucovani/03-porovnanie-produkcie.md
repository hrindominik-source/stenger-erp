# Porovnanie produkčnej schémy so schema.sql (22. 10. 2026)

Metóda: `scripts/schema-catalog.sql` (jeden SELECT nad katalógom – stĺpce, obmedzenia, indexy, RLS, politiky public+storage, funkcie, granty funkcií, triggre, rozšírenia) spustený cez Supabase CLI `db query --linked --project-ref` (Management API, bez hesla k DB, bez čítania riadkov). Výsledok uložený mimo repozitára. Rovnaký dotaz na lokálnej DB po aplikovaní `schema.sql`.

## Rozdiely

| Oblasť | Rozdiel | Dôsledok |
|---|---|---|
| Tabuľky | `dochadzka_nastavenia` (sekcia 36) je v `schema.sql`, **v produkcii chýba** (tabuľka, PK, RLS, politika) | aplikácia ju používa (`src/App.jsx`, nastavenia Dochádzky) → v produkcii zlyháva; presunuté do samostatnej migrácie `20261022120500`, nasadenie po schválení |
| Funkcie | `audit_trigger()`, `get_orders_for_sklad()` – líšia sa len komentármi | žiadny |
| Storage | trigger `storage.buckets.enforce_versioning_status_transition` len lokálne | interná súčasť novšej verzie Storage API, nie naša schéma |
| Server | produkcia Postgres 17.6, lokálne 17.11 | žiadny |
| Ostatné | stĺpce, obmedzenia, indexy, RLS, politiky (public + storage), granty, triggre HR | zhoda |

Rozdiely nemenia nič vo fáze B.

## Tajné údaje

V kóde funkcií produkcie sa nenašli kľúče, tokeny, heslá ani volania externých URL (`http`, `pg_net`, `vault`). Do repozitára sa z produkcie nič neprevzalo – baseline vychádza zo `schema.sql`.

## Vedľajší efekt prístupu cez CLI

`db query --linked` si v produkcii automaticky inicializuje dočasnú prihlasovaciu rolu **`cli_login_postgres`** (člen `postgres`, `rolvaliduntil` 22. 10. 2026 17:18 UTC – heslo po tejto dobe neplatí). Ide o štandardný mechanizmus Supabase CLI, ale je to zmena v produkcii (rola). Nebola odstránená – rozhodnutie je na vlastníkovi projektu. CLI bolo po porovnaní odhlásené (`supabase logout`), lokálny `supabase/.temp/linked-project.json` zmazaný.
