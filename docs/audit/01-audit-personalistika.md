# Audit Personalistiky – zistenia

**Rozsah a metóda**
- Audit z 24. 10. 2026 na vetve `feature/podpisy-dorucovani`, len lokálne. Zahŕňa produkčnú baseline a nenasadené migrácie 48–62.
- Iba čítanie: kód, katalóg lokálnej DB a simulácia RLS v transakcii s `ROLLBACK`. Nič nebolo zmenené.
- Na staging ani produkciu som sa nepripájal. Produkčné nastavenia Auth, zálohy, región ani skutočné sady oprávnení **nie sú overené**.

**Zdroje zistení**
- **S-xx, G-xx** (bezpečnosť, GDPR): samostatný agent, ktorý kód nepísal. Kľúčové body som overil v DB (S-01, S-02, S-03, S-05, G-03).
- **P-xx** (procesy, oddelenie povinností, prevencia chýb): vlastné mapovanie.
- Súvisiace dokumenty: matica oprávnení v `02`, návrhy riešení v `03`, GDPR v `04`.

Právne hodnotenia sú len pracovné. Otázky sú v `docs/podpisy-dorucovani/05-pro-pravnicku.md`, sekcia 7.

## Súhrn

| Závažnosť | ID |
|---|---|
| KRITICKÉ | – (žiadne nezistené) |
| VYSOKÉ | S-01, S-02, S-03, S-04, G-01, P-01, P-02 |
| STREDNÉ | S-05, S-06, S-07, S-08, G-02, G-03, G-04, G-05, G-06, P-03, P-04, P-05, P-06 |
| NÍZKE | S-09 … S-15, P-07 |

**Overené ako v poriadku**
- RLS je zapnuté na všetkých HR tabuľkách a anonym ich nevidí. Anonym smie volať len kioskové RPC (migr. 62).
- Podpisy, doručenia a overenia zapisuje iba server. Podpísaný dokument je zamknutý a HR dokumenty sa nemažú (`hr_documents_guard`).
- Podpisový odkaz na tablet: 256-bit token, platnosť 10 min, 3 pokusy, väzba na zariadenie a na reláciu HR.
- Text právnych textov sa nedá meniť, vždy vzniká nová verzia (`hr_legal_texts_guard`).
- Trvalé mazanie vyžaduje `HR_ADMIN` a dôvod. Zamestnanca s podpísanými alebo doručenými dokumentmi nezmaže, ak nie je označený ako test alebo duplicita.
- Podpis za zamestnávateľa kontroluje platnú plnú moc k dátumu podpisu.
- Všetky SECURITY DEFINER funkcie majú `search_path`. Súbory `.env` nie sú v gite.

---

## VYSOKÉ

### S-01 Prílohy zamestnanca v úložisku vidí každý s `HR_VIEW_BASIC`
- **Čo sa ukladá:** prílohy pod `zamestnanci/<id>/prilohy/…`:
  - rozhodnutia o invalidite a ZTP/P, doklady k PN;
  - sken pasu;
  - rodné listy a potvrdenia o štúdiu detí;
  - prohlášení poplatníka.
- **Dôkaz:**
  - Ukladanie je v `src/hr/PersonalistikaModule.jsx:643-650`. Komentár na riadkoch 639–641 tvrdí, že prílohy vidí len PAYROLL.
  - Storage policy `hr_dokumenty_files_select` kontroluje `HR_VIEW_BASIC` a `hr_object_path_visible(name)`.
  - Funkcia `hr_object_path_visible` vráti pre cestu, ktorá nie je naviazaná na žiaden dokument, `return true; -- subor sablony a pod.`
  - Listovanie úložiska je SECURITY INVOKER, takže súbory sa dajú nielen stiahnuť, ale aj vylistovať.
  - Chyba je už v produkčnej baseline.
- **Dopad:** zdravotné doklady (čl. 9 GDPR) a doklady detí vidí okruh ľudí širší, než je potrebné. Týka sa to aj budúcej účtovníčky s BASIC.
- **Návrh:**
  - Neznáma cesta nebude viditeľná (allowlist).
  - Prílohy dostanú evidenciu s potrebným oprávnením podľa druhu (PAYROLL, zdravotné).
  - Opravu nasadiť pred presunom.

### S-02 Personalistka vidí token kioskovej relácie, a tak môže vyplniť a podpísať dotazník za uchádzača
- **Dôkaz:**
  - Politika `onboarding_sessions_office_view` (SELECT pre `HR_EDIT`) nemá obmedzenie stĺpcov.
  - `has_column_privilege('authenticated', …, 'session_token')` vráti `t`.
  - UI načítava `select("*")` (`PersonalistikaModule.jsx:533`).
  - Token je jediná identita kiosku: `hr_onboarding_save_draft`, `hr_onboarding_submit` a `hr-kiosk` (`prepare`/`sign`/`complete`).
- **Dopad:** používateľ s `HR_EDIT` môže zmeniť súkromný e-mail a podpísať vyhlásenia za uchádzača, vrátane § 21 a § 335. Dôkazy o podpise to neodlíšia (`KIOSK_SELF_DECLARED`).
- **Návrh:**
  - V DB ukladať len hash tokenu, ako pri `hr_signing_tokens`, alebo odobrať SELECT na stĺpec.
  - UI bez `select("*")`.

### S-03 Verejný kiosk bez odomknutia
- **Dôkaz:**
  - `hr_settings.kiosk.device_unlock_required = false` (predvolené, migr. `20261022130000`).
  - Globálny limit 30 relácií za hodinu.
  - `prepare` vytvorí až 40 PDF na reláciu, bucket nemá mazanie.
  - RPC kiosku sú pre `anon` (migr. 62 ich zámerne ponechala).
- **Dopad:** ktokoľvek s URL môže kiosk na hodinu zablokovať pre skutočných nástupcov, posielať falošné podpísané dotazníky a plniť úložisko. Osobné údaje iných ľudí nezíska (overené).
- **Návrh:**
  - V produkcii zapnúť `device_unlock_required` (mechanizmus `hr_kiosk_issue_unlock` už existuje).
  - Limit viazať na odomknutie a upratovať PDF zamietnutých relácií.
  - Produkčnú hodnotu nastavenia treba overiť.

### S-04 Externá účtovníčka nemá vhodnú rolu; HR prístup = takmer celé ERP; bez platnosti
- **Dôkaz:**
  - Každá HR politika vyžaduje `current_role()='office'`.
  - 29 politík mimo HR povoľuje všetko pre `office` (`orders`, `customers`, `pricelist`, `company`…).
  - `hr_permissions` má len `user_email` a `permissions[]`, bez platnosti a bez údaja, kto oprávnenie pridelil.
- **Dopad:**
  - Účtovníčka by dostala čítanie aj zápis do objednávok, cenníkov a firmy, k tomu základnú vrstvu HR (kontakty, PN – G-02, prílohy – S-01).
  - Časovo obmedzený prístup technicky neexistuje.
  - To isté platí pre personalistku: s HR dostáva aj celé ERP.
- **Návrh:** balík B v `03` (vlastná rola, úzky pohľad na mzdy, `valid_until`).

### G-01 Dokumenty a koncepty dotazníka obchádzajú vrstvy PAYROLL a zdravotných údajov
- **Dôkaz:**
  - `hr_document_required_permissions()` vráti bez nastavenia šablóny `{HR_VIEW_SENSITIVE}`. Mzdový výměr, osobný dotazník aj zmluvy majú teda len SENSITIVE.
  - Simulácia: personalista bez PAYROLL vidí 392 z 392 dokumentov (aj `variables_snapshot`), ale 0 riadkov `employee_payroll_data`.
  - Dotazník obsahuje RČ, účet, deti s RČ a zdravotné obmedzenie (`_shared/hr/jmhzFill.js`).
  - `onboarding_sessions.draft_data` vidí každý s `HR_EDIT`.
- **Dopad:** rozdelenie na citlivé, mzdové a zdravotné údaje platí len v tabuľkách, nie v dokumentoch.
- **Návrh:**
  - `required_permissions` nastaviť podľa typu dokumentu (výměr → PAYROLL, dotazník → SENSITIVE+PAYROLL).
  - Koncept mazať po prevzatí do karty.

### P-01 Šablóny dokumentov: návrh aj schválenie urobí jedna osoba, kontrola len v prehliadači
- **Dôkaz:**
  - `hr_document_templates` a `hr_document_template_versions`: politika ALL pre `HR_DOCUMENT_APPROVE`. Ten istý človek nahrá verziu aj ju schváli.
  - Schválenie robí klient (`PersonalistikaModule.jsx:4960-4963`) a `approved_by` aj `approved_at` posiela prehliadač.
  - Generovanie len zo `status='SCHVALENA'` filtruje UI (`:3656`). DB pri `hr_documents` insert ani pri finalizácii nekontroluje, či bola šablóna v deň generovania schválená.
  - Chýba právny základ, dátum právneho overenia a termín revízie.
- **Dopad:**
  - Zastaraná alebo neoverená šablóna sa dostane do podpísaných zmlúv.
  - Kód `HR_DOCUMENT_APPROVE` súčasne posúva stav dokumentu. Kto ho dostane kvôli dokumentom, môže meniť aj šablóny, čo je v rozpore s cieľom „personalistka nemení šablóny“.
- **Návrh:** balík C (oddelené oprávnenie, schvaľuje konateľ, iný než autor, kontrola v DB, metadáta revízie).

### P-02 Žiadny rizikový krok nevyžaduje druhú osobu
- **Dôkaz:**
  - V schéme nie je mechanizmus schvaľovania (žiadna tabuľka žiadostí, žiadna kontrola „schvaľovateľ ≠ autor“).
  - Jedna osoba sama môže:
    - zmeniť mzdu (`HR_EDIT`+`PAYROLL`, zápis do `employee_payroll_data.data.mzda_historie`);
    - podpísať za zamestnávateľa ľubovoľný typ dokumentu vrátane výpovede (`HR_SIGN_FOR_EMPLOYER` + plná moc);
    - zneplatniť dokument (`HR_DOCUMENT_VOID`);
    - meniť šablóny (P-01) a texty (P-03).
  - `HR_ADMIN` zahŕňa všetky oprávnenia a mení oprávnenia aj plné moci bez auditu (S-06).
- **Dopad:** chyba alebo zneužitie jednej osoby nemá druhú kontrolu. Konateľ sa o kroku nedozvie (P-05).
- **Návrh:** balík E (žiadosti so schválením konateľom, núdzový postup s dodatočným potvrdením).

## STREDNÉ

### S-05 `HR_EDIT` môže natvrdo mazať citlivé, mzdové a zdravotné údaje
- **Dôkaz:** politiky `employees_edit`, `employee_sensitive_data_edit`, `employee_payroll_data_edit`, `medical_examinations_edit` a `employment_relationships_edit` majú `cmd = ALL`, teda aj DELETE. Nijaký trigger to neblokuje (overené v `pg_policies`).
- **Dopad:** personalistka môže cez API zmazať RČ, mzdové údaje či prehliadky. Ostane len `audit_log`, ktorý sama nevidí, a obnova je ručná.
- **Návrh:** politiky rozdeliť na SELECT, INSERT a UPDATE. DELETE povoliť len cez riadený výmaz.

### S-06 Audit: oprávnenia sa nelogujú, serverové zápisy bez autora, log sa dá upraviť, prístup na pevný e-mail
- **Dôkaz:**
  - Bez audit triggera sú `hr_permissions`, `profiles`, `onboarding_sessions`, `employee_timeline_events`, `hr_kiosk_unlocks`, `hr_signing_tokens`.
  - Zápisy Edge Functions majú `changed_by = NULL` (service role).
  - `audit_log` nemá ochranu proti UPDATE a DELETE zo strany vlastníka alebo servera.
  - Celý audit vidí natvrdo zadaný e-mail jednej osoby v politike `audit_log` a v `src/App.jsx:736`, nie rola.
- **Dopad:** nedá sa preukázať, kto pridelil `HR_ADMIN` alebo PAYROLL. Pri odchode tejto osoby sa stratí dohľad nad auditom.
- **Návrh:** balík A (audit oprávnení, autor zo servera, ochrana logu, export mimo DB, právo namiesto e-mailu).

### S-07 Prihlásenie: bez MFA, bez vypršania relácie, slabé heslá
- **Dôkaz:** lokálny `supabase/config.toml` má MFA vypnuté, `[auth.sessions]` nenastavené, heslo min. 6 znakov a zapnutú registráciu. Frontend nepozná MFA ani `aal`.
- **Dopad:** jedno uniknuté heslo HR_ADMIN znamená prístup ku všetkému. Relácia na zdieľanom PC sa sama neukončí.
- **Návrh:**
  - Overiť nastavenia produkcie.
  - Balík G: MFA, vynútené `aal2` v HR, časový limit relácie, vypnutá registrácia, heslo ≥ 12 znakov.

### S-08 Trvalé mazanie nechá súbory v úložisku
- **Dôkaz:** `hr_admin_delete_employee` maže riadky, nie objekty v úložisku. Po výmaze cesty nie sú naviazané, takže ich podľa S-01 uvidí každý s BASIC.
- **Návrh:** pri výmaze mazať aj súbory (server, s logom) a opraviť S-01.

### G-02 Druh PN/úrazu a fakt exekúcie na úrovni `HR_VIEW_BASIC`
- **Dôkaz:**
  - `src/lib/hr/absences.js:1-4` (`employees.data.nepritomnosti`).
  - Texty na časovej osi (`PersonalistikaModule.jsx:2290-2297`, `:702-705`).
  - `hr_garnishment_doc_count()` je bez kontroly `HR_EXEKUCE`.
- **Návrh:**
  - Na základnej úrovni zobraziť len „nepřítomen“, detail pod vlastným oprávnením.
  - Texty udalostí neutralizovať.
  - Rozsah je otázka pre právničku (05, Q-A1).

### G-03 `HR_AUDIT_VIEW` odhalí celú históriu citlivých údajov
- **Dôkaz:**
  - `audit_trigger` ukladá celé `OLD` a `NEW`.
  - Politika `audit_log` povoľuje entity `employee_sensitive_data`, `employee_payroll_data` a `medical_examinations` bez zodpovedajúceho VIEW oprávnenia.
- **Návrh:** pre každú entitu kontrolovať príslušné oprávnenie, alebo citlivé polia v audite maskovať.

### G-04 Chýbajú lehoty uchovávania, anonymizácia a export
- **Dôkaz:**
  - Žiadna logika retencie ani anonymizácie.
  - `draft_data` odoslaných a zamietnutých relácií ostáva natrvalo (lokálne 39 zo 44).
  - `audit_log` sa nikdy nečistí.
  - Export údajov jedného zamestnanca neexistuje.
- **Návrh:** balík F. Lehoty určí právnička a mzdová účtovníčka.

### G-05 Čítanie citlivých údajov sa nezaznamenáva
- **Dôkaz:**
  - Audit zachytáva len zápisy.
  - `hr_document_events` má len `PRINT_DOWNLOADED`, ktoré zapisuje klient dobrovoľne.
  - Stiahnutie z úložiska sa nezaznamenáva.
- **Návrh:** balík F (čítanie cez RPC alebo server so zápisom do `hr_access_log`).

### G-06 Citlivé identifikátory v čitateľnej podobe; plánovaný e-mail bez šifrovania
- **Dôkaz:**
  - `employee_sensitive_data.birth_number`, `bank_account` a `id_document_number` sú `text`.
  - Heslo k výplatnej páske je v JSON v čitateľnej podobe (`employeeFields.js:409`).
  - `hrMail.ts` pripravuje PDF prílohy na súkromný e-mail.
- **Návrh:**
  - Zvážiť šifrovanie stĺpcov a heslo k páske neukladať v čitateľnej podobe.
  - Pred zapnutím e-mailu rozhodnúť o šifrovaní PDF (otázka pre právničku).

### P-03 Platí aj neschválený právny text
- **Dôkaz:**
  - `hr_current_legal_text(p_key)` vyberie najvyššiu verziu so `status <> 'VYRAZENO'`, teda aj `KONCEPT`.
  - Novú verziu vytvorí aj schváli ten istý človek s `HR_LEGAL_TEXTS_ADMIN` (politiky INSERT a UPDATE). Guard síce nastaví `approved_by`, ale nekontroluje, že schvaľovateľ nie je autor.
- **Dopad:** nová, neoverená verzia sa okamžite použije pri podpise. Dnes je to zámer, kým právnička texty neschváli, ale bez rozlíšenia pre budúce zmeny.
- **Návrh:** balík C (pri podpise povoliť len SCHVÁLENÉ, výnimka len cez nastavenie konateľa).

### P-04 Zákonné limity sú v kóde a slúžia len ako upozornenie; viaceré kontroly chýbajú
- **Dôkaz:**
  - `probationWarning` (`supabase/functions/_shared/hr/employeeFields.js:237`) iba upozorní: skúšobná doba nad 4 mesiace bez vedúceho, nad ½ doby určitej. Hodnoty sú natvrdo v kóde.
  - Pred generovaním sa kontroluje len vyplnenosť polí (`src/lib/hr/pracovniSmlouva.js:154 psMissing`).
  - **Nekontroluje sa:**
    - minimálna mzda;
    - dĺžka a opakovanie doby určitej;
    - limity DPP a DPČ;
    - dátum podpisu oproti dátumu nástupu;
    - vstupná lekárska prehliadka a školenie BOZP pred nástupom.
- **Dopad:** chybná zmluva sa dá vygenerovať aj podpísať. Po novele treba meniť kód.
- **Návrh:** balík D (tabuľka parametrov s platnosťou od–do, hodnoty zadá konateľ, kontroly ako blok alebo upozornenie).

### P-05 Konateľ nemá prehľad o rizikových krokoch
- **Dôkaz:**
  - Neexistuje centrum upozornení, prehľad udalostí ani súhrn.
  - Dashboard „Přehled“ ukazuje počty a lehoty, nie kto čo podpísal, zneplatnil či zmenil.
  - E-mail je len lokálny Mailpit.
- **Dopad:** konateľ, ktorý nie je vo firme denne, sa o zmene mzdy, výpovedi či zmene oprávnení nedozvie.
- **Návrh:** balík A.

### P-06 Zmena mzdy je nemenná len podľa zvyklosti UI
- **Dôkaz:**
  - Komentár `PersonalistikaModule.jsx:3352-3355` hovorí, že každá zmena je nový záznam a nič sa neprepisuje.
  - `mzda_historie` je však JSON v `employee_payroll_data.data` a politika ALL dovoľuje prepísať alebo vymazať históriu. Stopa ostane len v `audit_log`.
- **Návrh:**
  - Históriu mzdy viesť v samostatnej tabuľke bez UPDATE a DELETE (podobne ako `employment_terms_versions`).
  - Zmenu mzdy naviazať na balík E.

## NÍZKE

| ID | Zistenie | Návrh |
|---|---|---|
| S-09 | Oprávnenia sú viazané na e-mail, bez platnosti a autora pridelenia. Odchod používateľa je ručný. UI upsert oprávnení nekontroluje chybu (`PersonalistikaModule.jsx:5220`). | väzba na `user_id`, `valid_until`, `granted_by`, postup pri odchode (G) |
| S-10 | `authorize()` v Edge Functions nekontroluje rolu `office`. CORS je `*`. Klient vrátane anonymného dostáva surové chyby DB (`hr-kiosk/index.ts:93,97`). | kontrola roly, všeobecné hlášky, CORS na doménu |
| S-11 | `anon` a `authenticated` majú na HR tabuľkách granty TRUNCATE a TRIGGER. Cez API nie sú využiteľné. | revoke (obrana do hĺbky) |
| S-12 | Kiosk na zdieľanom tablete sa po nečinnosti neodhlási, relácia trvá 8 h. | vyčistenie po N min nečinnosti |
| S-13 | Podpisový token je v URL (`?podpis=`). `netlify.toml` nemá bezpečnostné hlavičky (CSP, `frame-ancestors`, `Referrer-Policy`). | hlavičky, prípadne token vo fragmente |
| S-14 | Zápis do úložiska je denylist: `HR_EDIT` nahrá súbor aj pod `exekuce/`. | allowlist prefixov podľa oprávnenia |
| S-15 | Pomocné SECURITY DEFINER funkcie (`hr_setting`, `hr_training_ok`, …) môže volať každý prihlásený, aj sklad a výroba. | kontrola oprávnenia alebo revoke |
| P-07 | Nastavenia `s21_tablet_in_person_conservative` a `s335_consent_enabled` (právny režim) mení HR_ADMIN jedným klikom bez schválenia a bez upozornenia. Audit má. | zaradiť do balíka E a upozornení A |

## Mimo rozsahu (na vedomie)

- Tabuľka `plan_smien` má politiku `ALL using (true)` pre anonyma a mená z `workers` (výroba) sú verejne čitateľné.
  - Že je Plán smien prístupný bez prihlásenia cez PIN, je vaše rozhodnutie.
  - Zápis bez overenia PIN priamo cez API je však iná vec. Odporúčam samostatnú kontrolu, nie je súčasťou tohto auditu.

## Čo neoverené

- Produkčné nastavenia Auth (MFA, signup, relácie), región, zálohy a PITR, šifrovanie diskov.
- Skutočné sady `hr_permissions` a `profiles` v produkcii, existencia zdieľaných účtov, produkčná hodnota `hr_settings.kiosk`.
- Zneužitie S-02, S-03 a S-05 som prakticky neskúšal (len definície a simulácia SELECT).
- Netlify: prístupové logy a nastavenia náhľadov.
