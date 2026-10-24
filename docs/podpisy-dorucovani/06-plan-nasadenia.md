# Plán nasadenia – podpisy, nemenné dokumenty a doručovanie (fázy A–I)

Stav k 23. 10. 2026. **Nič z tohto sa nespúšťa bez výslovného súhlasu pri každom kroku na stagingu a v produkcii.** Podrobnosti k jednotlivým fázam sú v `nasadenie.md`.

- Staging: `gzbrniotozvrhjuuqrdm`.
- Produkcia: `zvvlxrfghkizflfbqfrk`.
- Vetva: `feature/podpisy-dorucovani`.

## 0. Predpoklady (rozhodnúť pred generálkou)

1. Vetva `fix/check-import` je zlúčená do `main` a prenesená do feature vetvy.
2. Spôsob spúšťania migrácií:
   - **SQL Editor** (odporúčané, spúšťa používateľ, každá migrácia v transakcii);
   - alebo Supabase CLI (vyžaduje `supabase link` → zapíše `supabase/.temp/project-ref`; pri CLI prihlásení vzniká rola `cli_login_postgres`).
3. Prepínače ostávajú **vypnuté**: `electronic_contract_enabled = false`, `s335_consent_enabled = false`, `email_mode = "mock"`. Systém bez nich funguje (papierová cesta, tablet pri osobnej prítomnosti, osobné odovzdanie).
4. Texty sú koncepty. Nasadiť sa dajú, ale § 21/§ 335 sa nezapínajú, kým ich právnička neschváli (`05-pro-pravnicku.md`).

## 1. Čo sa nasadzuje

### Migrácie (presne v tomto poradí)

| # | Súbor | Obsah | Dátová zmena |
|---|---|---|---|
| 48 | `20261022130000_podpisy_dorucovani.sql` | dátový model podpisov, vyhlásení, doručenia, texty | backfill `locked_at` pre SIGNED/ARCHIVED; mení RPC kiosku a trvalého mazania |
| 49 | `20261022140000_finalne_pdf.sql` | finálne a podpísané PDF zapisuje len server | – |
| 50 | `20261022150000_kiosk_podpisy.sql` | kiosk: podpisy, koncepty textov | nové texty |
| 51 | `20261022160000_uplny_podpis.sql` | podpísaný ≠ zamknutý, typ úkonu | doplnenie `legal_act_type` nezamknutým |
| 52 | `20261022170000_dokumenty_detail.sql` | udalosti tlače, sken viazaný na verziu | – |
| 53 | `20261023100000_verzie_dodatky_prevzatie.sql` | nová verzia, dodatky, sken prevzatia, školenia | – |
| 54 | `20261023110000_tablet_podpis_hr.sql` | podpisové tokeny, § 334 zamestnávateľ | text prejavu vôle |
| 55 | `20261023120000_pritomnost_overenie_plne_moci.sql` | QR + kód, overenie certifikátu, osoby s plnou mocou, **storage politiky** | – |
| 56 | `20261023130000_dorucovani_email.sql` | e-mailové doručovanie, lehoty | – |
| 57 | `20261023140000_opravnenia.sql` | `HR_DOCUMENT_VOID`, `HR_SIGN_FOR_EMPLOYER`, citlivosť pri podpisoch | – (pozor: zneplatnenie od teraz len s novým oprávnením) |
| 58 | `20261023150000_sablony_texty.sql` | vyhlásenia z textov, potvrdenie o prevzatí | nové texty |
| 59 | `20261023160000_sablona_pracovnej_zmluvy.sql` | vzor pracovnej zmluvy ako šablóna v1, nemenné verzie šablón | nové riadky šablón (dokumenty bez zmeny) |
| 60 | `20261023170000_bezpecnostne_opravy.sql` | opravy z nezávislej kontroly (`07-nezavisla-kontrola.md`): podpisy a doručenia len zo servera, zmrazenie po finalizácii, … | – (pozor: frontend a `hr-signing`/`hr-kiosk` nasadiť spolu) |
| 61 | `20261023180000_zneplatnenie_vyhlaseni.sql` | podpísané vyhlásenie zamestnanca (§ 21 / § 335) zneplatní len HR_ADMIN s dôvodom ≥ 10 znakov | – |
| 62 | `20261024100000_anon_execute.sql` | `anon` a `PUBLIC` smú spúšťať len funkcie kiosku, plánovania smien a `current_role()`; ostatným (aj `hr_admin_delete_employee`) EXECUTE odobraté; nové funkcie bez `anon` / `PUBLIC` | – (pozor: anonymné čítanie HR tabuliek vráti zamietnutie namiesto prázdneho výsledku) |
| 63 | `20261025100000_audit_vysoke_nalezy.sql` | Audit S-01: neznámy súbor v `hr-dokumenty` vidí len HR_ADMIN, prílohy zamestnanca len `HR_VIEW_PAYROLL`; S-02: token kiosku len ako SHA-256 (stĺpec `session_token` zrušený); S-03: `kiosk.device_unlock_required = true`; `plan_smien` zápis len cez `plan_smien_save` / `plan_smien_add_request` s PIN, obmedzenie chybných PIN | **Po nasadení:** kiosk vyžaduje kód (Nástupy → Odemknout tablet) – informovať personalistku; zmeniť predvolený admin PIN Plánu smien, ak je stále `1234`; nasadiť zároveň frontend a Edge Function `hr-kiosk` (hľadá reláciu podľa hashu) |

Baseline `20261022120000_baseline.sql` sa v produkcii **nespúšťa** (produkcia ju má). Pri CLI by sa označila ako aplikovaná (`migration repair`), čo je zápis do produkcie a vyžaduje súhlas.

### Edge Functions (všetky `verify_jwt = true`, len štandardné premenné, žiadne nové secrets)

| Funkcia | Od fázy | `static_files` |
|---|---|---|
| `hr-finalize-pdf` | C | – |
| `hr-signed-original` | C | písma |
| `hr-kiosk` | D | písma, vzor dotazníka, logo |
| `hr-signing` | F | písma |
| `hr-delivery` | G | – |
| `hr-declarations` | I | písma |

Deploy: `supabase functions deploy <názov> --project-ref <ref>` (sekcie z `config.toml`).

### Frontend

Zlúčenie do `main` → CI nasadí. Nová závislosť je `qrcode@1.5.4`. Frontend musí ísť spolu s migráciami 48 a 55 (zmenené RPC a tok QR).

## 2. Generálka na stagingu

1. **Súhlas** na prácu so stagingom.
2. Porovnať schému stagingu s baseline (`scripts/schema-catalog.sql`, len čítanie). Ak sa líši, najprv zosúladiť.
3. Záloha stagingu (Dashboard → Backups) a zapísať čas.
4. Nasadiť Edge Functions (všetkých 6).
5. Migrácie 48 → 61 v poradí, každú zvlášť. Po každej skontrolovať chyby.
6. Frontend na staging (preview build so staging URL).
7. Testovacie dáta: vymyslený zamestnanec a testovacie účty. Oprávnenia a osobu s plnou mocou zadá HR_ADMIN v UI.
8. **Kontrolný zoznam (smoke test):**
   - [ ] Kiosk: dotazník s e-mailom aj bez neho, podpis, schválenie HR.
   - [ ] Pracovná zmluva: finálne PDF → tablet (QR + kód, 3 zlé kódy zrušia odkaz) → podpis za zamestnávateľa (osoba s plnou mocou) → podpísaný originál.
   - [ ] Papierová cesta: tlač → sken → osobné odovzdanie so skenom potvrdenia.
   - [ ] Mzdový výmer: PDF s uznávaným podpisom → „certifikát neověřen“ → ručné overenie s protokolom.
   - [ ] „Odeslat e-mailem“ → očakávaná chyba „není nakonfigurováno“ (staging nemá poskytovateľa).
   - [ ] Prohlášení § 21 → podpis → platné oznámenie. Potvrdenie o prevzatí k podpísanému dokumentu.
   - [ ] Oprávnenia: používateľ bez `HR_DOCUMENT_VOID` nezneplatní, bez `HR_VIEW_SENSITIVE` nevidí citlivé dokumenty ani ich podpisy.
   - [ ] Reálny tablet: QR, kód, prechod všetkými stranami, podpis.
   - [ ] Kiosk `prepare` s dotazníkom + § 21 (+ § 335) neprekročí limit CPU Edge Function (lokálne občas `WORKER_LIMIT`, pozri `07-nezavisla-kontrola.md`).
   - [ ] Papierový sken podpisu sa nahrá cez server (stav „Podepsáno“ po oboch stranách); priamy zápis z prehliadača je odmietnutý.
9. **Skúška rollbacku:** 61 → 48 v opačnom poradí (pozri kap. 5) na stagingu, potom znova 48 → 61. Rollbacky so zastavovacou podmienkou spustiť na stagingu **pred** vytvorením testovacích podpisov, alebo po vrátení zálohy.
10. Výsledky zapísať (čo prešlo, čo nie) a rozhodnúť o produkcii.

## 3. Overenie zálohy produkcie (pred nasadením)

1. **Súhlas** na čítanie produkcie (prihlásenie cez prehliadač, po skončení `supabase logout`).
2. Overiť, že existuje denná záloha alebo PITR a zapísať čas poslednej zálohy.
3. **Test obnovy:** obnoviť zálohu do stagingu (alebo do novej dočasnej inštancie) a porovnať počty riadkov kľúčových tabuliek a schému. Obnova do stagingu prepíše staging, takže je to samostatný súhlas.
4. **Súbory v úložisku** (`hr-dokumenty`, skeny, podpísané PDF) **nie sú súčasťou databázovej zálohy**. Pred nasadením urobiť samostatnú kópiu bucketu a overiť počet a hashe súborov. Ide o čítanie produkcie a vyžaduje súhlas.
5. Export schémy produkcie (len štruktúra) na porovnanie po nasadení.

## 4. Produkcia

1. **Súhlas**, termín mimo pracovnej doby HR a oznámenie HR (krátka odstávka personalistiky).
2. Čerstvá záloha (kap. 3, body 2 a 4).
3. Edge Functions (6).
4. Migrácie 48 → 61 v SQL Editore, každá v transakcii, v poradí. Pri chybe stop: zvyšok nespúšťať a rozhodnúť (rollback alebo oprava).
5. Frontend: merge `feature/podpisy-dorucovani` → `main` (CI nasadí).
6. Prvé vygenerovanie (alebo náhľad) pracovnej zmluvy uloží overený vzor v1 do úložiska – skontrolovať, že sa zmluva vygeneruje.
7. Smoke test (skrátený zoznam z kap. 2), len na vymyslenom testovacom zázname. Ten sa potom označí ako TEST a zmaže.
8. Porovnať schému s lokálnou (`scripts/schema-catalog.sql`).
9. `supabase logout`.

## 5. Rollback

Poradie je vždy opačné: **frontend → Edge Functions (vypnúť) → rollbacky 61 → 48**. Rollback skripty sa samy zastavia, ak by zahodili dôkazy:

| Rollback | Zastaví sa, ak existujú |
|---|---|
| 62 `…anon_execute_rollback.sql` | – |
| 63 `…audit_vysoke_nalezy_rollback.sql` | rozpracované kioskové relácie prestanú platiť; S-01–S-03 a zápis do `plan_smien` opäť otvorené |
| 61 `…zneplatnenie_vyhlaseni_rollback.sql` | – |
| 60 `…bezpecnostne_opravy_rollback.sql` | – (vrátiť spolu frontend a funkcie) |
| 59 `…sablona_pracovnej_zmluvy_rollback.sql` | zmluvy vygenerované zo šablóny `tpl-ps*` |
| 58 `…sablony_texty_rollback.sql` | – (texty sa len vyradia, vzniknuté vyhlásenia ostávajú) |
| 57 `…opravnenia_rollback.sql` | – (oprávnenia ostanú uložené bez účinku) |
| 56 `…dorucovani_email_rollback.sql` | e-mailové zásielky |
| 55 `…pritomnost_overenie_plne_moci_rollback.sql` | osoby s plnou mocou, overenia certifikátov, použité tokeny |
| 54 `…tablet_podpis_hr_rollback.sql` | podpisy z tabletu HR / za zamestnávateľa |
| 53 `…verzie_dodatky_prevzatie_rollback.sql` | dodatky, skeny potvrdenia, evidencia školení |
| 52 `…dokumenty_detail_rollback.sql` | udalosti tlače dokumentov |
| 51, 49 | – |
| 50 `…kiosk_podpisy_rollback.sql` | dotazníky podpísané elektronicky |
| 48 `…podpisy_dorucovani_rollback.sql` | elektronické podpisy, vyhlásenia, doručenia, dokumenty z dotazníka, zneplatnené/nahradené alebo finalizované dokumenty, upravené texty |

Ak sa rollback zastaví, ostrý systém už má právne relevantné dáta. Vtedy sa nevracia: opraví sa dopredu novou migráciou, prípadne sa vypne funkcia (Edge Function / tlačidlo vo frontende). Krajné riešenie je obnova zo zálohy z kap. 4.2, ktorá stratí všetko po nej (vyžaduje rozhodnutie).

## 6. Čo musí HR nastaviť po nasadení

1. **Oprávnenia** (HR_ADMIN, Personalistika → Nastavení): podľa rolí priradiť
   - `HR_DOCUMENT_SIGN` (podpisy, tablet zamestnanca),
   - `HR_SIGN_FOR_EMPLOYER` (len osoby s plnou mocou),
   - `HR_DOCUMENT_SEND` (odovzdanie, e-mail),
   - `HR_DOCUMENT_VOID` (zneplatnenie – predtým stačilo GENERATE/APPROVE),
   - `HR_LEGAL_TEXTS_ADMIN` (texty).
   Bez toho niektoré tlačidlá zostanú neaktívne s vysvetlením.
2. **Osoby s plnou mocou** (Nastavení → Osoby s plnou mocí):
   - meno a 7. pád;
   - účet, ak podpisuje na tablete;
   - platnosť od–do;
   - sken plnej moci;
   - citlivosť.
   Bez nich sa v pracovnej zmluve nedá vybrať podpisujúci. Reálne mená nie sú v migrácii ani v seede.
3. **Texty** (Šablony → Texty prohlášení a poučení):
   - po schválení právničkou zapísať schválenú verziu ako novú verziu (bez „KONCEPT“) a označiť „schválené“;
   - neschválené ponechať.
4. **Prepínače** (`hr_settings`, mení HR_ADMIN; v produkcii len po rozhodnutí):
   - `electronic_contract_enabled`: zapnúť až po odpovediach na otázky 1, 2, 5 a po zapojení poskytovateľa e-mailov;
   - `s335_consent_enabled`: zapnúť až po schválení textov poučenia a súhlasu, po zapojení poskytovateľa a po zavedení postupu overenia certifikátu;
   - `s21_tablet_in_person_conservative`: ponechať `true`;
   - `email_mode`: ponechať `mock` (v produkcii = nič sa neodošle), kým nie je poskytovateľ.
5. **Poskytovateľ e-mailov** – samostatný projekt, **zatiaľ neimplementovaný**:
   - výber poskytovateľa v EÚ so zmluvou o spracovaní (DPA);
   - vlastná doména s SPF/DKIM/DMARC;
   - adaptér v `_shared/hrMail.ts` (dnes len Mailpit);
   - secrets cez `supabase secrets set` (zápis do produkcie, súhlas);
   - webhook poskytovateľa → `hr-delivery` `provider_event` (doplniť overenie podpisu webhooku);
   - pravidelné `hr_document_deliveries_sweep()` (pg_cron alebo plánovaná funkcia, zmena nastavenia produkcie, súhlas).
6. **Overenie certifikátov:** HR zvolí verejnú overovaciu službu (po vyjadrení právničky alebo DPO k nahrávaniu mzdových PDF).
7. **Školenie HR:** vnútorný pokyn `pokyn-hr-podpis-na-tabletu.md` (po schválení) a krátka ukážka toku na tablete.

## 7. Známe otvorené body

- Skutočný poskytovateľ e-mailov, webhook a pravidelné vyhodnocovanie lehôt (kap. 6.5).
- Automatické overenie certifikátu (vlastná inštancia EU DSS) – zatiaľ ručne.
- Presun vzoru pracovnej zmluvy do `hr_document_templates` (návrh v `04-sablony-texty.md`).
- Word šablóna dodatku – dodatok sa zatiaľ pripravuje mimo systému.
- Anonymizácia po lehotách uchovávania – čaká na odpoveď právničky.
- Ručný test na reálnom tablete.
