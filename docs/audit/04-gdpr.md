# GDPR – stav, medzery, podklady

- **Kontext:** audit z 24. 10. 2026. Vychádza zo zistení nezávislého agenta (G-xx, S-xx v `01`) a z vlastného mapovania.
- **Charakter:** pracovný podklad, nie právne stanovisko. Čo treba posúdiť právne, je v `docs/podpisy-dorucovani/05-pro-pravnicku.md`, sekcia 7.
- **Hodnoty:** lehoty ani iné hodnoty som nevymýšľal.

## 1. Stav podľa oblastí

| Oblasť | Stav | Medzera | Balík (`03`) |
|---|---|---|---|
| Minimalizácia | Kiosk zbiera aj RČ detí, zdravotné obmedzenie a daňové údaje už pred uzavretím pomeru | rozsah zberu pred nástupom nie je posúdený | otázka Q-A8 |
| Prístup podľa potreby | Tabuľky sú rozdelené na BASIC, SENSITIVE, PAYROLL a MEDICAL | prílohy (S-01), dokumenty a koncepty (G-01), PN a exekúcie (G-02), audit (G-03), účtovníčka = celé ERP (S-04) | F, B, opravy S |
| Záznam prístupu | Nezaznamenáva sa | kto čítal RČ, mzdy, zdravotné údaje (G-05) | F |
| Stopa zmien | `audit_log` zachytí zmeny auditovaných tabuliek (pred a po) | oprávnenia a profily bez auditu, zápisy servera bez autora, log nie je chránený (S-06) | A |
| Uchovávanie a výmaz | Trvalý výmaz len test/duplicita; archivácia „bývalý zamestnanec“ | žiadne lehoty, anonymizácia ani čistenie konceptov a auditu; výmaz nechá súbory (G-04, S-08) | F |
| Export (čl. 15, 20) | Neexistuje | export údajov jedného zamestnanca | F |
| Oprava (čl. 16) | Úprava karty, audit pred a po | chýba dôvod opravy a história v karte | F |
| Šifrovanie | Prenos HTTPS; disk podľa poskytovateľa (neoverené) | RČ, účet a heslo k páske sú v DB čitateľne; e-mail PDF bez šifrovania (G-06) | F, otázka Q-A7 |
| Zálohy | V repozitári nič; produkcia neoverená | postup a test obnovy, kde sú zálohy, kto k nim má prístup | pred presunom (IT) |
| Únik údajov | Postup neexistuje | kto rozhoduje, lehota ohlásenia, šablóna, záznam incidentu | otázka Q-A10 |
| Účty | Heslo; lokálne bez MFA a vypršania relácie | MFA, relácie, zdieľané účty, odchod (S-07, S-09) | G |

## 2. Inventár osobných údajov (kde sú a kto ich dnes vidí)

| Kategória | Kde | Kto vidí dnes |
|---|---|---|
| Identifikačné a kontaktné (meno, narodenie, adresy, telefón, súkromný e-mail, ZP, vzdelanie, rodinný stav) | `employees`, `employees.data` | `HR_VIEW_BASIC` |
| RČ, číslo dokladu, účet, údaje cudzinca, heslo k výplatnej páske | `employee_sensitive_data` | `HR_VIEW_SENSITIVE`; nepriamo `HR_AUDIT_VIEW`, `HR_EDIT` (koncept kiosku), dokumenty |
| Mzda a jej história, daňové prehlásenie, deti (RČ, ZTP/P), súbeh, exekúcie (údaj), dôchodok, zdravotné obmedzenie | `employee_payroll_data` | `HR_VIEW_PAYROLL`; nepriamo SENSITIVE (výměr, dotazník), `HR_EDIT`, `HR_AUDIT_VIEW` |
| Lekárske prehliadky | `medical_examinations` | `HR_VIEW_MEDICAL_ADMIN`; nepriamo `HR_AUDIT_VIEW` |
| PN, úraz, OČR, materská | `employees.data.nepritomnosti`, časová os | `HR_VIEW_BASIC` |
| Doklady: invalidita a ZTP, PN, pas, rodné listy detí, prohlášení poplatníka | úložisko `zamestnanci/<id>/prilohy/` | súbory `HR_VIEW_BASIC` (S-01), evidencia `HR_VIEW_PAYROLL` |
| Exekúcie – doklady | `employee_garnishment_documents`, `exekuce/` | `HR_EXEKUCE`; počet `HR_VIEW_BASIC` |
| Pracovný pomer, pozícia, skúšobná doba, ukončenie | `employment_*`, `positions` | `HR_VIEW_BASIC` |
| Dokumenty (zmluvy, výměry, dotazníky, vyhlásenia, výpovede) | `hr_documents`, úložisko | BASIC + oprávnenie zo šablóny (dnes vždy SENSITIVE) |
| Podpis: obrázok a ťahy (x, y bez času) | `hr_signature_images` | podľa dokumentu |
| Dôkazy o podpise: prehliadač, zariadenie, overenie totožnosti, relácia HR; **IP sa neukladá** | `hr_document_signatures` | podľa dokumentu |
| Doručovanie (adresa, stav, dôkazy) | `hr_document_deliveries`, `employee_contact_declarations` | BASIC + dokument |
| Plné moci | `hr_signatories`, `plne-moci/` | záznam BASIC, sken podľa citlivosti |
| Koncept kioskového dotazníka | `onboarding_sessions.draft_data` | `HR_EDIT` + držiteľ tokenu |
| Školenia | `hr_training_records` | BASIC |
| Kópie zmien | `audit_log` | jedna natvrdo zadaná osoba (všetko), `HR_AUDIT_VIEW` (vybrané HR entity) |
| Používateľské účty | `profiles`, Supabase Auth | každý `office` |

## 3. Podklady pre záznam o činnostiach spracovania

Návrh štruktúry. Účely a právne základy potvrdí právnička.

| Činnosť | Kategórie osôb | Kategórie údajov | Predpokladaný účel / základ (na overenie) | Príjemcovia / spracovatelia | Lehota |
|---|---|---|---|---|---|
| Personálna agenda a pracovné zmluvy | zamestnanci | identifikačné, kontaktné, pracovný pomer, dokumenty | plnenie zmluvy, povinnosti podľa ZP | Supabase, hosting, budúci server | **doplní právnička** |
| Mzdy, dane, odvody | zamestnanci, deti, druhý vyživovateľ | mzda, dane, deti s RČ, súbeh, exekúcie | právne povinnosti (dane, ČSSZ, ZP) | externá účtovníčka, ČSSZ, ZP, FÚ | **doplní** |
| Pracovnolekárske služby a BOZP | zamestnanci | prehliadky, spôsobilosť, školenia | právna povinnosť (čl. 9 ods. 2 písm. b?) | poskytovateľ PLS | **doplní** |
| Neprítomnosti | zamestnanci | PN, úraz, OČR | právna povinnosť / mzdy | účtovníčka | **doplní** |
| Exekúcie | zamestnanci | doklady exekúcií, zrážky | právna povinnosť | súd, exekútor, účtovníčka | **doplní** |
| Nástup cez kiosk | uchádzači, nastupujúci | dotazník, podpisy | predzmluvné vzťahy? | Supabase | **doplní** (vrátane zamietnutých) |
| Elektronický podpis a doručovanie | zamestnanci | podpis, údaje zariadenia, e-mail | ZP § 21, § 334–335 | e-mailový poskytovateľ (budúci) | **doplní** |
| Audit a bezpečnosť | používatelia HR, zamestnanci | logy zmien a prístupov | oprávnený záujem / čl. 32 | Supabase | **doplní** |

### Spracovatelia

| Spracovateľ | Čo dostáva | Treba overiť |
|---|---|---|
| Supabase (DB, úložisko, Auth, Edge Functions) | všetko vyššie vrátane zvláštnych kategórií; IP v logoch Auth | DPA, región, šifrovanie, zálohy, kto má prístup |
| Netlify (frontend) | IP, URL vrátane podpisového tokenu v logoch | DPA, región, retencia logov |
| Budúci vlastný server / hosting | kompletná DB a úložisko | zmluva, umiestnenie, šifrovanie diskov a záloh, správca s prístupom |
| E-mailový poskytovateľ (zatiaľ nevybraný) | meno, súkromný e-mail, PDF zmlúv a výměrov | DPA, región, šifrovanie |
| Externá účtovníčka | mzdové a daňové údaje | spracovateľ alebo samostatný prevádzkovateľ? (Q-A6) |
| Poskytovateľ PLS (mimo systému) | – | len evidencia v systéme |

## 4. Bezpečnostné minimum (návrh, balík G)

- MFA pre KONATELA a PERSONALISTU (pri self-hostingu overiť podporu TOTP vo verzii Supabase).
- Žiadne zdieľané účty v HR. Jeden e-mail patrí jednej osobe.
- Odhlásenie po nečinnosti (dĺžku určí konateľ) a obmedzená platnosť relácie.
- Pri odchode jeden postup: oprávnenia, rola, zablokovanie účtu, zrušenie relácií, záznam.
- Kiosk len s odomknutím zariadenia (S-03) a s vyčistením po nečinnosti (S-12).

## 5. Pred presunom na vlastný server (z pohľadu GDPR)

- Prenos zálohy šifrovane a so záznamom, kto a kedy ju preniesol. Po overení staré kópie zmazať.
- Overiť šifrovanie diskov a záloh na novom serveri. Doplniť zmluvu so správcom servera.
- Úložisko (súbory) migrovať spolu s DB. Najprv opraviť S-01 a S-08, aby sa nepreniesli nenaviazané súbory s voľným prístupom.
- Zapísať, kde budú logy Auth a prístupové logy webu a ako dlho sa uchovávajú.
