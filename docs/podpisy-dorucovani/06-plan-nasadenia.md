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
| 64 | `20261025110000_roly_pristupy.sql` | Balík B: roly účtu `personalistika` a `ucetni_ext` (len Personalistika, nie zvyšok ERP), HR politiky/funkcie cez `hr_role_ok()`; `hr_permissions` s profilom, väzbou na účet (`user_id`) a platnosťou od–do; `HR_TEMPLATE_APPROVE` pre šablóny; trvalé mazanie HR riadkov len HR_ADMIN | **Po nasadení (konateľ):** v Nastavení → Oprávnenia skontrolovať riadky s profilom „Vlastní nastavení (převzato…)“ a priradiť profil; personalistke a účtovníčke nastaviť rolu účtu (`profiles.role`) – SQL v Editore, kým nie je správa účtov v aplikácii; účtovníčke dátum konca prístupu |
| 65 | `20261025120000_dohlad_konatela.sql` | Balík A: audit nemenný (UPDATE/DELETE/TRUNCATE zakázané), autor aj pri zápisoch servera, audit oprávnení/účtov/kódov (bez hašov) a stavu nástupov; `hr_notifications` + záložka „Pro jednatele“ a `hr_konatel_summary()`; Audit log v ERP podľa HR_ADMIN namiesto pevného e-mailu | Nasadiť spolu s frontendom (App.jsx, KonatelPrehled.jsx). Po nasadení jednatel uvidí ako nové udalosti aj historické pridelenia z migrácie 64 – „Vše přečteno“. E-mailový súhrn ostáva vypnutý (`konatel_summary.email_enabled = false`) |
| 66 | `20261025130000_schvalovanie_sablon_textov.sql` | Balík C: šablóny a právne texty schvaľuje len jednatel (`hr_approve_template_version`, `hr_approve_legal_text`), DB zapisuje kto/kedy; metadáta (právny základ, revízia, poznámka); dokument len z aktuálnej schválenej verzie šablóny, text len schválený a nie po revízii; jednorazové schválenie používaných šablón a textu potvrdenia o prevzatí; § 21, § 335 a texty prejavu vôle (`INTENT_*`) ostávajú koncept (audit `hr_approval_bootstrap`); elektronický podpis (`ELECTRONIC_TABLET`) DB prijme len so schváleným textom prejavu vôle | **Pred nasadením:** jednatel musí mať v `hr_permissions` profil KONATEL naviazaný na účet (inak sa jednorazové schválenie zapíše bez mena, s poznámkou). **Po nasadení: podpis na tablete (HR aj kiosk) je vypnutý** – zapne sa až schválením textov prejavu vôle jednatelom (Šablony dokumentů → Texty) **po ich schválení právničkou**; dovtedy len papierový postup (UI: „Elektronický podpis čeká na schválení textů – použijte papírový postup“). § 21 oznámenie, § 335 poučenie/súhlas/odvolanie sa nedajú vytvoriť a kiosk ich neponúka, kým ich jednatel neschváli. Nasadiť spolu s frontendom a funkciami `hr-kiosk`, `hr-declarations`, `hr-signing` |
| 67 | `20261025140000_mfa.sql` | Dvojfázové prihlásenie (TOTP z autentifikačnej aplikácie, zadarmo) povinné pre profily Jednatel a Personalista (`hr_settings.mfa`); bez overenia kódom (aal2) DB nevráti žiadne HR oprávnenia | **Pred nasadením:** v Supabase → Authentication → Multi-Factor overiť, že TOTP (App Authenticator) je zapnuté (lokálne `config.toml [auth.mfa.totp]`). **Po nasadení:** jednatel a personalistka si pri prvom vstupe do Personalistiky zaregistrujú aplikáciu (QR kód). **Strata telefónu:** správca zmaže faktor v Supabase → Authentication → Users → používateľ → MFA factors; pri ďalšom prihlásení nová registrácia. Nasadiť spolu s frontendom (MfaGate) |
| – | (len frontend, bez migrácie) | Odhlásenie pri nečinnosti: Personalistika 15 min (odhlásenie, na prihlasovacej obrazovke vysvetlenie), kiosk 5 min (údaje zmiznú z obrazovky, tablet sa zamkne, ďalej len s novým kódom od HR), podpis na tablete 5 min (odkaz sa ukončí). Minútu vopred upozornenie | Nasadiť s frontendom; žiadny krok v Supabase |
| 68 | `20261025150000_citanie_citlivych.sql` | Záznam o čítaní citlivých a mzdových údajov: priame čítanie `employee_sensitive_data` / `employee_payroll_data` prihláseným používateľom zakázané, čítanie len cez `hr_read_sensitive` / `hr_read_payroll` / `hr_read_payroll_overview`, každé sa zapíše do nemenného `audit_log` (akcia `read`: kto, koho, účel). Zápis cez update/insert (bez upsertu) | **Nasadiť súčasne s frontendom** – starý frontend by po migrácii nevedel načítať kartu zamestnanca. Po nasadení: otvoriť kartu zamestnanca a v Historii zmien overiť riadok „Zobrazeno“ |
| 69 | `20261025160000_mfa_obnova.sql` + Edge Function `hr-mfa` | MFA povinné aj pre externú účtovníčku. Záložné kódy (10, jednorazové, zobrazia sa raz pri registrácii; v DB len otlačky). Reset MFA personalistky a účtovníčky robí jednatel v „Pro jednatele“ (s dôvodom); MFA jednatela len serverovo (IT). Každý reset ide do auditu (`auth_mfa`) a do upozornení jednatelovi | Nasadiť migráciu, funkciu `hr-mfa` (`verify_jwt = true`) a frontend naraz. **Po nasadení:** externá účtovníčka si pri ďalšom vstupe zaregistruje aplikáciu. Kto sa už zaregistroval pred migráciou 69, záložné kódy nemá – vygeneruje ich až nová registrácia (jednatel mu zruší overenie, jednatelovi IT podľa postupu nižšie) |
| 70 | `20261025170000_zakonne_parametre.sql` | Balík D: tabuľka `hr_legal_parameters` (hodnota, platnosť od, zdroj, zadal/schválil; mení len jednatel, audit + upozornenie). Hodnoty zadané jednatelom 2026-10-28 (min. mzda od 1. 1. 2026, § 35, § 39, § 75, § 76 ZP), ostatné prázdne. Kontrola `hr_check_employment`: zákonné limity (skúšobná doba, doba určitá, min. mzda, DPČ) **blokujú** vznik generovanej PS / mzdového výmeru / dodatku a podpis; ostatné upozorňujú. K dokumentu sa ukladá `legal_check` (použité parametre) | **Pred nasadením** spustiť na kópii dát kontrolu všetkých aktívnych pomerov (`select id, hr_check_employment_core(id) from employment_relationships where status <> 'ENDED'`) – existujúce pomery s blokom by nešli podpísať ani doplniť dodatkom. Nasadiť s frontendom (panel kontroly, parametre v „Pro jednatele“) |
| 71 | `20261025180000_styri_oci.sql` | Balík E – štyri oči: tabuľka `hr_approval_requests` (žiadosť, dôvod, kto/kedy, rozhodnutie jednatela, núdzový postup s informáciou, ako bol jednatel informovaný). DB vynúti schválenie jednatelom pri podpise za zamestnávateľa (okrem PS/náplne/vstupného školenia zo schválenej šablóny), pri zneplatnení dokumentu s podpisom a pri výnimke zo zákonného limitu (balík D). Jednatel tieto kroky robí sám; vlastnú žiadosť neschváli | **Pred nasadením** skontrolovať rozpracované dokumenty: personalistka po nasadení nepodpíše za zamestnávateľa výpoveď, výmer, dodatok ani upravený dokument bez schválenia. Nasadiť s frontendom (žiadosť v detaile dokumentu a v kontrole pomeru, rozhodovanie v „Pro jednatele“) |
| 72 | `20261025190000_gdpr.sql` | Balík F – GDPR: lehoty uchovávania (`hr_retention_rules`, kategórie bez hodnôt, mení len jednatel, audit + upozornenie) a pripomienka; anonymizácia zamestnanca až po uplynutí všetkých lehôt a so schválením jednatela (štyri oči, bez núdzového postupu); export údajov zamestnanca (`hr_export_employee`, záznam v audite + upozornenie); dôvod opravy (`hr_corrections`); zoznam spracovateľov (`hr_processors`) | Po nasadení jednatel doplní lehoty a spracovateľov podľa právničky. Nasadiť s frontendom (export a anonymizácia v karte, dôvod zmeny pri uložení karty, lehoty a spracovatelia v „Pro jednatele“) |
| 73 | `20261025200000_ucty.sql` | Balík G – účty: neúspešné prihlásenia (heslo, dvojfázový kód) zapisuje Auth hook do `hr_login_failures` (len účty HR; 5 za 15 min = upozornenie jednatelovi); prehľad relácií a zariadení pre jednatela (`hr_account_security_overview`); upozornenie jednatelovi pri prvom prihlásení účtu HR z nového zariadenia (trigger na `auth.sessions`, `hr_known_devices`); dve akcie pri odchode (`hr_offboard_user` + edge funkcia `hr-ucty`): „Ukončit přístup do HR“ (účet v ERP ostáva) a „Zablokovat účet – odchod z firmy“ (koniec HR, zrušenie relácií, blokácia účtu); obe audit + upozornenie | **Auth hooky sa zapínajú až na vlastnom serveri (self-hosted)** – rozhodnutie 2026-10-29: v konfigurácii Auth (`GOTRUE_HOOK_PASSWORD_VERIFICATION_ATTEMPT_*`, `GOTRUE_HOOK_MFA_VERIFICATION_ATTEMPT_*`, URI `pg-functions://postgres/public/hook_password_verification_attempt` a `…/hook_mfa_verification_attempt`). Na hostovanom Supabase sa **nezapínajú** – migrácia funguje aj bez nich, len sa neúspešné prihlásenia nezapisujú. Trigger na `auth.sessions` je v schéme `auth` – po aktualizácii Auth overiť, že existuje. Nasadiť funkciu `hr-ucty` (verify_jwt) a frontend |
| 74 | `20261025210000_revizie_legislativa.sql` | Balík H – revízie: polročná revízia šablón, textov a zákonných parametrov k 1. 1. a 1. 7. (pripomienka 30 dní vopred, potvrdzuje jednatel, audit), revízia šablóny/textu k `next_review_date`; strážca zmien zákona č. 262/2006 Sb. (`hr_legislation_watch`, edge funkcia `hr-legislativa`) – **predvolene vypnutý, bez zdroja**; zdroj len https na e-Sbírke; pri zmene len upozornenie, nič sa nemení automaticky (docs/audit/05-legislativa.md) | Nasadiť funkciu `hr-legislativa` (verify_jwt). **Na vlastnom serveri** nastaviť denný plánovač (cron), ktorý zavolá `POST /functions/v1/hr-legislativa` s `{"action":"check"}` a `Authorization: Bearer <service role>` – kľúč len v prostredí servera, nie v repozitári. Zdroj e-Sbírky zapnúť až po overení rozhrania IT |
| 75 | `20261025220000_kontrola_d_h.sql` | Opravy z nezávislej kontroly D–H: typ/pôvod/šablónu/verziu/ručnú históriu/pomer dokumentu mení po vložení len server alebo jednatel; potvrdenie o prevzatí, § 21, § 335 a dotazník vkladá len server; samopodpis PS len so šablónou toho istého typu a s pracovným pomerom; schválenie sa viaže na odtlačok finálneho PDF (žiadosť až k finálnemu PDF) a čerpá sa so zámkom; výnimka zo zákonného limitu len pre konkrétne hodnoty a bez núdzového postupu; žiadosti nevidí externá účtovníčka; anonymizáciu neblokujú lehoty „od vzniku záznamu“; príznak anonymizácie mení len anonymizácia; odchod len účtov s HR, chránený každý HR_ADMIN; `hr_legal_parameters` bez TRUNCATE/DELETE | Pred nasadením skontrolovať, či na serveri nie sú ručné historické záznamy založené personalistkou (po nasadení ich podpis za zamestnávateľa schvaľuje jednatel) a čakajúce žiadosti EMPLOYER_SIGN bez finálneho PDF (po nasadení ich treba podať znova) |
| 76 | `20261025230000_naprava_dovod.sql` | Rozhodnutia 2026-10-29: dodatočne zamietnutý núdzový krok – dokument ostáva platný, dostane označenie „Zamítnuto jednatelem – vyžaduje nápravu“, vznikne úloha nápravy s termínom (`hr_remediation_tasks`, predvolene 14 dní, jednatel ho môže zmeniť) v prehľade jednatela, kým ju neuzavrie s popisom nápravy (audit); `hr_decide_approval` má nový voliteľný parameter termínu; k dôvodu zmeny v Karte sa ukladajú zmenené polia (`hr_corrections.fields`) | Frontend spolu s migráciou (zmenená signatúra `hr_decide_approval` a `hr_record_correction`) |
| 77 | `20261025240000_dovod_v_db.sql` | Povinný dôvod zmeny vynucuje DB: zmena mzdy (`mzda_historie`), pozície, typu a doby zmluvy, nástupu a skončenia, rodného čísla, čísla účtu a ZP bez dôvodu sa odmietne (trigger na `employees`, `employee_sensitive_data`, `employee_payroll_data`, `employment_relationships`). Dôvod sa zapíše pred uložením (`hr_change_reason_begin`, platí 5 min pre daného používateľa a zamestnanca), po uložení sa naviažu zmeny z auditu (`hr_change_reason_finish`). Výnimka: service_role a migrácie/funkcie vlastníka. Vloženie nového záznamu nie je zmena | Frontend **musí ísť spolu** – starý frontend by zmeny týchto polí nevedel uložiť. Ukončenie pomeru zapíše ako dôvod zvolený spôsob ukončenia, import z dotazníka JMHZ zdroj údajov |
| 78 | `20261025250000_zmena_uctu.sql` | Zmena čísla bankového účtu (aj prvé zadanie, aj zo servera/kiosku): upozornenie jednatelovi len s poslednými 4 číslicami a tým, kto zmenil (`BANK_ACCOUNT_CHANGED`); označenie „Účet změněn od poslední výplaty – ověřte“ v Mzdových podmínkách a v upozorneniach (`hr_bank_account_checks`), kým ho nepotvrdí jednatel alebo účtovníčka (mzdový prístup bez práva upravovať); vlastnú zmenu nikto nepotvrdí; potvrdenie v audite | Pri nasadení vznikne označenie len pri ďalšej zmene (existujúce účty sa neoznačia) |

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
| 64 `…roly_pristupy_rollback.sql` | najprv prestaviť účty s rolou `personalistika` / `ucetni_ext` (inak sa zastaví); práva opäť podľa e-mailu, profil a platnosť sa stratia |
| 65 `…dohlad_konatela_rollback.sql` | upozornenia sa zmažú; auditné záznamy ostanú; audit opäť meniteľný |
| 66 `…schvalovanie_sablon_textov_rollback.sql` | koncepty (aj § 21 / § 335) sa opäť používajú; jednorazové schválenie ostane zapísané |
| 67 `…mfa_rollback.sql` | HR opäť len s heslom; zaregistrované faktory ostanú |
| 68 `…citanie_citlivych_rollback.sql` | priame čítanie späť (len authenticated), záznamy `read` ostanú; vrátiť aj frontend |
| 69 `…mfa_obnova_rollback.sql` | účtovníčka opäť bez MFA, záložné kódy zmazané; vrátiť aj `hr-mfa` a frontend |
| 70 `…zakonne_parametre_rollback.sql` | kontroly a parametre preč, `legal_check` pri dokumentoch ostáva; vrátiť aj frontend |
| 71 `…styri_oci_rollback.sql` | vynútenie a žiadosti preč (záznam ostáva v `audit_log`), kontrola pomeru bez výnimiek; vrátiť aj frontend |
| 72 `…gdpr_rollback.sql` | lehoty, dôvody opráv a spracovatelia preč (záznam v `audit_log`); **anonymizované údaje sa nevracajú**; vrátiť aj frontend |
| 73 `…ucty_rollback.sql` | **najprv vypnúť Auth hooky**; záznamy neúspechov preč; ukončené prístupy a blokácie ostávajú (odblokovanie IT); vrátiť frontend a `hr-ucty` |
| 74 `…revizie_legislativa_rollback.sql` | potvrdenia revízií a stav strážcu preč (záznam v `audit_log`); vypnúť plánovač; vrátiť frontend a `hr-legislativa` |
| 75 `…kontrola_d_h_rollback.sql` | vráti definície z migrácií 71–73 **vrátane zraniteľností z kontroly** – len pri nutnosti a hneď opraviť; práva na `hr_legal_parameters` ostávajú zúžené |
| 76 `…naprava_dovod_rollback.sql` | úlohy nápravy preč (záznam v `audit_log`), pôvodné `hr_decide_approval` a `hr_record_correction`; vrátiť frontend |
| 77 `…dovod_v_db_rollback.sql` | triggery a funkcie preč, záznamy dôvodov ostávajú; vrátiť frontend |
| 78 `…zmena_uctu_rollback.sql` | označenia preč (záznam v `audit_log` a v upozorneniach); vrátiť frontend |
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

## Postup pre IT: zrušenie dvojfázového overenia jednatela (migrácia 69)

Jednatelovi sa overenie v aplikácii zrušiť nedá (ani sám sebe). Keď stratí telefón aj záložné kódy:

1. Totožnosť jednatela overiť osobne alebo telefonicky na známom čísle. Nikdy len podľa e-mailu.
2. V Supabase → SQL Editor (rola postgres) spustiť:
   `select public.hr_mfa_server_reset('<e-mail jednatela>', '<dôvod a spôsob overenia totožnosti>');`
   Funkcia zmaže faktory a záložné kódy, zapíše audit (`auth_mfa`, spôsob SERVER) a upozornenie. Vráti počet zmazaných faktorov.
3. Ak SQL Editor zmazanie faktora odmietne (práva na schému `auth`), zmazať faktor v Authentication → Users → používateľ → MFA factors. Potom spustiť
   `select public.hr_mfa_server_reset('<e-mail>', '<dôvod>', true);` – funkcia už len zapíše audit a upozornenie.
4. Jednatel sa prihlási heslom, zaregistruje novú aplikáciu a uloží si nové záložné kódy.

