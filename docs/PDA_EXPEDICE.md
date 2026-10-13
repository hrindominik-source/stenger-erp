# PDA / Expedice – prevádzka, testovanie a nasadenie

Modul na skenovanie paliet na Zebra TC25BJ (Chrome) a prehľad výdajok v Stenger ONE.
PDA výdajky sú **úplne oddelené** od existujúcej Expedice (SkladView / `expedicia_zaznamy`)
a **nemenia skladové zásoby** – vlastné tabuľky `pda_vydajky` a `pda_palety`.

## Adresy

| Účel | URL | Prihlásenie | Dáta |
|---|---|---|---|
| Kancelária | `…/stenger-erp/` → Stenger ONE → **PDA / Expedice** | office | Supabase |
| PDA (ostro) | `…/stenger-erp/?pda=1` | účet Sklad | Supabase |
| **Testovací režim** | `…/stenger-erp/?pda=test` | žiadne | **len v prehliadači** |

Produkcia: `https://hrindominik-source.github.io/stenger-erp/` (GitHub Pages, deploy pri pushi do `main`).

## Testovací režim (`?pda=test`)

Simulácia na PC bez Zebry a bez databázy. Nič sa neukladá do Supabase, žiadne skladové pohyby.

- vľavo PDA (rovnaké obrazovky ako ostro), vpravo simulátor skenera, dole kancelársky prehľad + Excel,
- **Nová paleta: SSCC → produkt / produkt → SSCC** – vygeneruje platné GS1 kódy a „napíše“ ich do
  skenovacieho poľa presne ako DataWedge (znak po znaku, GS, Enter),
- **klávesnica PC**: kliknúť do PDA, napísať kód a Enter; oddeľovač GS = `Ctrl+]` alebo znak `|`,
- **Vlastný kód** – vloženie textu, `<GS>` alebo `|` = FNC1,
- **Chybné kódy** – zlá kontrolná číslica, EAN-13, chýbajúci GS, neplatný dátum, deň 00,
- **Sieť** – Normálna / Bez siete / Stratená odpoveď / Pomalá – test neuložených paliet a opakovania,
- „Smazat testovací data“ vymaže simuláciu (localStorage tohto prehliadača).

Lokálne: `npm run dev` → `http://localhost:5173/?pda=test`.
Testovací režim funguje aj na samotnej Zebre (po nasadení) – vhodné na skúšku skenera bez zápisu do DB.

## Automatické testy

```
npm test          # unit + migrácia v skutočnom Postgrese (PGlite) + celý postup nad simuláciou aj Postgresom
npm run e2e:pda   # Chrome E2E testovacieho režimu (16 krokov), build s falošnou adresou Supabase
COMPAT_BUILD=true npm run e2e:pda   # to isté nad záložným buildom pre starý Chrome
```

| Súbor | Čo overuje |
|---|---|
| `src/lib/gs1.test.js` | GS1 parser: FNC1/GS, `]C1`, AI 37 premenlivá dĺžka, kontrolné číslice SSCC/GTIN, AI 15/17 (storočie GS1 7.12, deň 00), chýbajúci GS |
| `src/lib/pdaScan.test.js` | párovanie SSCC + produkt v ľubovoľnom poradí, ochrany, chybové hlášky |
| `src/pda/pdaMigration.test.js` | SQL migrácia v Postgrese: RLS podľa rolí, anon bez prístupu, triggre, duplicity, zamknutie dokončenej, serverové hodnoty, idempotencia, rollback |
| `src/pda/pdaFlow.test.js` | celý postup 2× (simulácia aj Postgres): výpadok siete, stratená odpoveď, opakované skenovanie, neúplné palety, dokončenie, Excel |
| `scripts/e2e-pda.mjs` | skutočný Chrome: obrazovky, klávesnica, sieť, dokončenie, kancelária, stiahnutie a obsah Excelu, žiadny request na Supabase, hláška pre starý Chrome |

## Bezpečnosť (vynútené v DB, nie len v UI)

- prístup len `office` a `sklad` (RLS cez `current_role()`); `anon` nemá ani granty; `vyroba` nič nevidí,
- SSCC max. raz vo výdajke (unique) a nikdy v dvoch **dokončených** výdajkách (trigger pri vložení
  aj pri dokončení, súbežné dokončovanie serializované advisory lockom),
- dokončená výdajka: paletu nejde pridať / zmazať / presunúť; znovu otvoriť / upraviť / zmazať smie len office,
- sklad zmaže len **prázdnu** rozpracovanú výdajku,
- `created_by`, `created_at`, `stav` pri vložení, `dokoncena_at` nastavuje server (nedajú sa podvrhnúť),
- `order_id` (budúce prepojenie s objednávkou) smie nastaviť len office,
- limity dĺžky textov a JSON (`pg_column_size ≤ 10 kB`).
- Repozitár je verejný – ochrana dát stojí na RLS (anon kľúč je v každej Supabase appke verejný).

## Kompatibilita so starším Chrome (Zebra TC25BJ)

- Bežný build: **Chrome 85+** (Vite cieľ chrome87; PDA kód sám potrebuje ~Chrome 66).
- Zebra TC25 s Androidom 8.1 a aktualizovaným Chrome z Obchodu Play je v poriadku.
- Ak je Chrome starší, `index.html` namiesto bielej obrazovky ukáže **„Prohlížeč je příliš starý – Chrome XX“**.
- Verziu ukazuje aj PDA → **Test skeneru** (hore „Chrome XX“).

Postup, ak by bol Chrome < 85 a nedá sa aktualizovať:
1. Skúsiť aktualizovať Chrome (Obchod Play) alebo Android System WebView / Chrome cez Zebra StageNow.
2. Inak zapnúť záložný build: v `.github/workflows/deploy-pages.yml` pri kroku `npm run build`
   pridať `COMPAT_BUILD: "true"` do `env`. Syntax sa zníži na Chrome 64, pridajú sa polyfilly (~49 kB gzip).
   Týka sa celej appky – moderné prehliadače fungujú ďalej, len sťahujú trochu viac. Overené `COMPAT_BUILD=true npm run e2e:pda`.
3. Kozmetika pod Chrome 84: chýbajú medzery `gap` vo flexboxe (funkčnosť bez zmeny).

## Bezpečný postup nasadenia

Poradie: **najprv SQL, potom kód.** Kód bez tabuliek = chyba len v sekcii PDA; tabuľky bez kódu = nič sa nedeje.

1. **Kontrola** na `feature/pda`: `npm test` a `npm run e2e:pda` – všetko zelené.
2. **SQL** (Supabase → SQL Editor):
   - spustiť `supabase/2026-10-13_pda.sql` (iba pridáva objekty, idempotentný),
   - spustiť `supabase/2026-10-13_pda_verify.sql` a porovnať s očakávaním v komentároch
     (RLS true, 10 politík, 3 triggre, anon 0 práv, realtime 2 tabuľky, počty starých tabuliek nezmenené).
3. **Kód** – len fast-forward na `origin/main` (lokálna vetva `main` je stará VPS odbočka – nepoužívať):
   ```
   git fetch origin
   git merge-base --is-ancestor origin/main feature/pda && echo OK   # musí vypísať OK
   git push origin feature/pda:main                                   # odmietne sa, ak sa main medzitým zmenil
   ```
4. **Počkať na GitHub Actions** „Deploy to GitHub Pages“ (zelené, ~2–3 min).
5. **Smoke test**:
   - `…/stenger-erp/` – launcher so 4 appkami bez zmeny, Stenger ONE → všetky záložky ako predtým,
   - Stenger ONE → **PDA / Expedice** – prázdny zoznam bez chyby,
   - `…/?pda=test` – testovací režim,
   - `…/?pda=1` – prihlásenie účtom Sklad → výber pracovníka.

### Rollback

- **Kód**: v GitHub → Actions → posledný úspešný beh pred PDA (commit `944a5b6`) → *Re-run all jobs*
  (nasadí starú verziu), alebo `git revert` PDA commitov a push do `main`.
- **DB** (nevratné, len ak je to nutné): najprv Excel export všetkých výdajok (filter „Od“ prázdny),
  potom `supabase/2026-10-13_pda_rollback.sql`. Ostatné tabuľky sa nemenia.

## Nastavenie DataWedge (Zebra TC25BJ)

Profil priradený aplikácii **Chrome** (`com.android.chrome`, všetky aktivity):

1. **Barcode input**: zapnuté; dekodéry **GS1-128** (Code 128 → *Enable GS1-128*) a ak treba **GS1 DataMatrix**.
2. **Keystroke output**: zapnuté
   - *Action key character*: none,
   - *Send control characters as events* (*Key event options*): **zapnuté** (FNC1 → GS),
   - *Basic data formatting*: *Send data* ✓, **Send ENTER key ✓**, prefix/suffix prázdne.
3. Ak „Test skeneru“ neukáže `⟨GS⟩` medzi poľami: *Advanced data formatting* → pravidlo
   **Replace string**: `\x1D` → `|` (parser `|` akceptuje ako oddeľovač).
4. **Neinštalovať / nemeniť** ZebraDesigner ani tlačiareň ZT231 – etikety sa nemenia.

## Čo otestovať fyzicky na Zebre

1. **Chrome verzia** – PDA → Test skeneru (alebo hláška „příliš starý“). Cieľ: 85+, inak viď záložný build.
2. **Test skeneru** (nič neukladá): naskenovať SSCC etiketu → `(00)` 18 číslic bez chyby.
3. Naskenovať **produktový kód** → `(02)/(01)`, `(15)/(17)`, `(37)`, prípadne `(10)`; medzi premenlivými poľami **⟨GS⟩**.
4. Overiť dátum BBD a množstvo na displeji oproti etikete (2–3 rôzne palety, ideálne aj s dňom 00).
5. **Fokus**: po ťuknutí na tlačidlá, po návrate z inej appky a po zhasnutí displeja skenovať bez ťukania do poľa.
6. Neobjaví sa **softvérová klávesnica** pri skenovaní.
7. **Reálne uloženie**: `?pda=1`, účet Sklad → nová výdajka s LS → 2 palety (oboje poradie) → „Uloženo“.
8. Opakovaný sken tej istej palety → červená chyba, pípnutie/vibrácia.
9. Vypnúť Wi-Fi → sken → „Neuloženo“; zapnúť → „Zkusit znovu“ → „Uloženo“.
10. Dokončiť → v kancelárii sa výdajka objaví bez obnovenia stránky; Excel export.
11. Testovacie výdajky v kancelárii zmazať.
12. Pridať `…/?pda=1` na plochu Zebry (Chrome ⋮ → *Pridať na plochu*).

## Otvorené body

- **Excel MAXIM** – zatiaľ pracovná verzia (`src/lib/pdaExport.js`); po dodaní vzoru upraviť len túto funkciu.
- **Prepojenie s objednávkou** – stĺpec `pda_vydajky.order_id` pripravený, bez UI.
