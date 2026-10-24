# Matica oprávnení – súčasný stav a návrh

Audit z 24. 10. 2026 (ID zistení odkazujú na `01-audit-personalistika.md`), vetva `feature/podpisy-dorucovani` (baseline = produkcia + migrácie 48–62, ktoré ešte nie sú nasadené). Iba čítanie kódu a lokálnej DB, nič nebolo zmenené.

## 1. Ako oprávnenia fungujú dnes

- **Vstup do Personalistiky:**
  - Treba rolu `office` v `profiles.role`. `current_role()` ju číta podľa `auth.uid()`.
  - K tomu treba aspoň `HR_VIEW_BASIC` v `hr_permissions` (`src/hr/PersonalistikaModule.jsx:192`).
- **Ako sa oprávnenia ukladajú:**
  - `hr_permissions` je zoznam kódov pre e-mail používateľa (`user_email = auth.email()`).
  - `hr_has_permission(p)` vráti true, ak má používateľ kód `p` **alebo `HR_ADMIN`**. HR_ADMIN má teda automaticky všetko.
- **Kde sa oprávnenia vynucujú:**
  - RLS politiky v DB (pravý zdroj).
  - Edge Functions (`authorize(req, [...])` v `_shared/hrServer.ts`).
  - UI (`hasPerm`), čo slúži len na skrývanie tlačidiel.
- **Kto oprávnenia mení:** iba HR_ADMIN (politika `hr_permissions_admin_all`). Rolu `office` v `profiles` nastavuje správca mimo aplikácie.
- **Rola `office` mimo HR:** rovnakú rolu potrebuje každý používateľ kancelárie. Politiky ostatných modulov (`orders`, `customers`, `pricelist`, `company`…) majú `ALL using (current_role() = 'office')`. Kto má prístup do HR, má teda aj plný zápis do celého ERP.

### Kódy oprávnení (UI: `PersonalistikaModule.jsx:82`)

| Kód | Čo v skutočnosti povoľuje (DB / server) |
|---|---|
| `HR_VIEW_BASIC` | čítanie zamestnancov, pomerov, pozícií, šablón, dokumentov (s citlivosťou dokumentu), podpisov, doručení, právnych textov, osôb s plnou mocou, nastavení |
| `HR_VIEW_SENSITIVE` | čítanie `employee_sensitive_data` (RČ, číslo dokladu, účet, údaje cudzinca); dokumenty s citlivosťou `HR_VIEW_SENSITIVE` (aj pracovné zmluvy zo vzoru) |
| `HR_VIEW_PAYROLL` | čítanie `employee_payroll_data` (prehlásenie k dani, deti, súbeh, exekúcie – údaj, **mzdy a história mziet**) |
| `HR_VIEW_MEDICAL_ADMIN` | lekárske prehliadky |
| `HR_EDIT` | zápis do zamestnancov, pomerov, pozícií, udalostí; **s príslušným VIEW aj citlivé, mzdové a zdravotné údaje**; kontrola nástupov z kiosku; kódy kiosku |
| `HR_DOCUMENT_GENERATE` | vytvorenie dokumentu, finalizácia PDF, potvrdenie o prevzatí, záznamy o školení |
| `HR_DOCUMENT_APPROVE` | **úprava a schválenie šablón dokumentov** + posun stavu dokumentu |
| `HR_DOCUMENT_SIGN` | zaznamenanie podpisu zamestnanca (sken, tablet, uznávaný podpis) |
| `HR_SIGN_FOR_EMPLOYER` | podpis za zamestnávateľa – len ak je používateľ v `hr_signatories` s platnou plnou mocou |
| `HR_DOCUMENT_SEND` | osobné odovzdanie, e-mailové doručenie, opakovanie odoslania |
| `HR_DOCUMENT_VOID` | zneplatnenie dokumentu (podpísané vyhlásenia § 21 / § 335 len HR_ADMIN – migr. 61) |
| `HR_LEGAL_TEXTS_ADMIN` | nové verzie a schválenie textov prejavu vôle, poučení, vyhlásení |
| `HR_AUDIT_VIEW` | čítanie `audit_log` |
| `HR_EXEKUCE` | doklady k exekúciám (súbory `exekuce/…`) |
| `HR_ADMIN` | všetko vyššie + oprávnenia, osoby s plnou mocou, nastavenia HR, trvalé mazanie, označenie test/duplicita |

## 2. Súčasný stav: rola × akcia

Roly KONATEL a PERSONALISTA zatiaľ v systéme neexistujú, sú to len sady kódov.
- Pre KONATELA predpokladám `HR_ADMIN`.
- Pre PERSONALISTU predpokladám testovaciu sadu zo `supabase/seed.sql` (`BASIC, SENSITIVE, EDIT, GENERATE, SIGN, SEND`) a k tomu `HR_SIGN_FOR_EMPLOYER` (plná moc).
- **Skutočné sady v produkcii som nevidel.** Overí ich konateľ v *Nastavení → Oprávnenia*.

✅ = môže, ❌ = nemôže, ⚠️ = môže, ale nemal by (alebo len čiastočne).

| Akcia | KONATEL (HR_ADMIN) | PERSONALISTA (dnes) | UCTOVNIK_EXT (dnes – nemá rolu) | Kiosk / anon | Kontrola |
|---|---|---|---|---|---|
| Vstup do celého ERP (objednávky, cenníky, firma) | ✅ | ⚠️ áno – rola `office` | ⚠️ áno, ak dostane `office` | ❌ | RLS `current_role()='office'` |
| Zamestnanci – čítanie základných údajov | ✅ | ✅ | ⚠️ áno (ak `HR_VIEW_BASIC`) | ❌ | RLS |
| RČ, číslo dokladu, účet | ✅ | ✅ | ⚠️ len celý balík `SENSITIVE` (aj číslo dokladu) | ❌ | RLS |
| Mzdy, dane, deti, exekúcie (údaj) | ✅ | ❌ bez `PAYROLL` | ✅ s `PAYROLL` | ❌ | RLS |
| Lekárske prehliadky | ✅ | ❌ bez `MEDICAL` | ❌ | ❌ | RLS |
| Úprava karty zamestnanca | ✅ | ✅ | ⚠️ ak `HR_EDIT`, potom všetko, čo vidí | ❌ | RLS |
| Zmena mzdy (história mziet) | ✅ | ⚠️ len s `EDIT+PAYROLL` – bez schválenia | ⚠️ s `EDIT+PAYROLL` | ❌ | RLS, bez 4 očí |
| Nástupy z kiosku – kontrola a prevzatie | ✅ | ✅ | ⚠️ ak `HR_EDIT` | ❌ | RLS/RPC |
| Kiosk – vyplnenie dotazníka a podpis | – | – | – | ✅ (token relácie) | RPC + `hr-kiosk` |
| Generovanie dokumentu | ✅ | ✅ | ❌ | ❌ | RLS `GENERATE`; šablóna „schválená“ len v UI |
| Úprava / schválenie šablóny | ✅ | ❌ bez `APPROVE` | ❌ | ❌ | RLS; **ten istý človek nahrá aj schváli** |
| Právne texty (prejav vôle, poučenia) | ✅ | ❌ | ❌ | ❌ | RLS; **ten istý človek vytvorí aj schváli** |
| Zákonné parametre (min. mzda, limity) | – neexistujú | – | – | – | konštanty v kóde |
| Nastavenia HR (§ 21 elektronicky, § 335, kiosk) | ✅ | ❌ | ❌ | ❌ | RLS HR_ADMIN |
| Podpis zamestnanca (sken / tablet) | ✅ | ✅ | ❌ | tablet cez odkaz+kód | server `hr-signing` |
| Podpis za zamestnávateľa | ✅ ak je v `hr_signatories` | ✅ ak má plnú moc – **každý typ dokumentu** | ❌ | ❌ | server: plná moc platná k dátumu |
| Osoby s plnou mocou – správa | ✅ | ❌ | ❌ | ❌ | RLS HR_ADMIN |
| Doručenie / odovzdanie | ✅ | ✅ | ❌ | ❌ | server `hr-delivery` |
| Zneplatnenie dokumentu | ✅ | ❌ bez `VOID`; podpísané vyhlásenie len HR_ADMIN | ❌ | ❌ | trigger + oprávnenie |
| Trvalé mazanie zamestnanca | ✅ (s dôvodom; podpísané len pri test/duplicite) | ❌ | ❌ | ❌ | RPC `hr_admin_delete_employee` |
| Označenie test / duplicita | ✅ | ❌ | ❌ | ❌ | trigger |
| Archivácia (bývalý zamestnanec) | ✅ | ✅ (`HR_EDIT`) | ⚠️ ak `HR_EDIT` | ❌ | RLS |
| Oprávnenia používateľov | ✅ | ❌ | ❌ | ❌ | RLS HR_ADMIN; **bez auditu** |
| Audit log – čítanie | ⚠️ celý log len natvrdo zadaný e-mail jednej osoby; `HR_AUDIT_VIEW` vybrané entity (aj RČ, mzdy – G-03) | ❌ bez `AUDIT_VIEW` | ❌ | ❌ | RLS |
| Prílohy zamestnanca (invalidita, PN, pas, rodné listy detí) – súbory | ✅ | ⚠️ áno, stačí `HR_VIEW_BASIC` (S-01) | ⚠️ áno s BASIC | ❌ | storage RLS – neznáma cesta = viditeľná |
| Dokumenty (mzdový výměr, dotazník) | ✅ | ⚠️ áno so `SENSITIVE`, aj bez `PAYROLL` (G-01) | ❌ | ❌ | `hr_document_required_permissions` |
| Koncept kioskového dotazníka + token relácie | ✅ | ⚠️ áno s `HR_EDIT` – môže podpísať za uchádzača (S-02) | ⚠️ ak `HR_EDIT` | držiteľ tokenu | RLS bez obmedzenia stĺpcov |
| Natvrdo zmazať RČ, mzdové údaje, prehliadky, pomery | ✅ | ⚠️ áno cez API (politiky `ALL`, S-05) | ⚠️ ak `HR_EDIT` | ❌ | žiadny guard |
| Exekúcie – doklady | ✅ | ❌ bez `EXEKUCE` (nahrať môže s `EDIT`) | ✅ s `EXEKUCE` | ❌ | RLS + storage |
| Časové obmedzenie prístupu | – | – | ❌ neexistuje | – | – |

## 3. Navrhovaný stav

Návrh bez implementácie. Doplní sa po schválení balíkov v `03-navrh-kontrolnych-mechanizmov.md`.

**Zmeny v modeli:**
1. **Pevné roly namiesto ručného skladania kódov.**
   - Profil HR bude KONATEL, PERSONALISTA, UCTOVNIK_EXT, prípadne VLASTNÝ (len pre výnimky so zdôvodnením).
   - Zmena profilu sa zapíše do auditu a konateľ dostane upozornenie.
2. **Rola v ERP oddelená od HR:**
   - UCTOVNIK_EXT dostane vlastnú rolu, napr. `ucetni_ext`, nie `office`. Uvidí len Personalistiku v rozsahu miezd.
   - Platnosť jeho prístupu bude od–do.
3. **Rozdelenie `HR_DOCUMENT_APPROVE`** na schvaľovanie šablón (iba KONATEL) a posun stavu dokumentu (PERSONALISTA).
4. **Rozdelenie `HR_VIEW_SENSITIVE`:**
   - údaje pre mzdy (RČ, účet, ZP);
   - doklady totožnosti a údaje cudzinca.
5. **4 oči:** pri rizikových krokoch návrh pripraví jeden človek a schváli ho iný (pozri 03, balík B).

| Akcia | KONATEL | PERSONALISTA | UCTOVNIK_EXT | ZAMESTNANEC |
|---|---|---|---|---|
| Vstup do ERP mimo HR | podľa svojej roly | podľa pracovnej náplne (zvlášť od HR) | ❌ | ❌ |
| Základné údaje zamestnancov | ✅ | ✅ | ✅ len meno, osobné číslo, pomer, pozícia | ❌ |
| RČ, ZP, účet (pre mzdy) | ✅ | ✅ | ✅ | ❌ |
| Číslo dokladu, údaje cudzinca | ✅ | ✅ | ❌ | ❌ |
| Mzdy, dane, deti, exekúcie | ✅ | ✅ čítanie; zmena mzdy = návrh | ✅ čítanie | ❌ |
| Zmena mzdy | schvaľuje (nad limit alebo vždy – rozhodnutie) | navrhuje | ❌ | ❌ |
| Lekárske prehliadky | ✅ | ✅ (len termíny a výsledok spôsobilosti) | ❌ | ❌ |
| Karta zamestnanca – úprava | ✅ | ✅ | ❌ (opravu nahlási) | ❌ |
| Kiosk – kódy, kontrola nástupov | ✅ | ✅ | ❌ | dotazník + podpis |
| Generovanie dokumentov | ✅ | ✅ len zo schválenej a nerevidovanej šablóny | ❌ | ❌ |
| Šablóny, právne texty, zákonné parametre | schvaľuje | ❌ (môže navrhnúť) | ❌ | ❌ |
| Podpis za zamestnávateľa | ✅ | ✅ bežné dokumenty; výpoveď, dohoda o skončení, okamžité skončenie a zmena mzdy nad limit len po schválení konateľom | ❌ | ❌ |
| Osoby s plnou mocou, oprávnenia, nastavenia | ✅ (zmena = upozornenie, audit) | ❌ | ❌ | ❌ |
| Zneplatnenie podpísaného dokumentu | ✅ (alebo schvaľuje) | návrh s dôvodom | ❌ | ❌ |
| Trvalé mazanie / anonymizácia | ✅ len so záznamom; mazanie mimo test/duplicita nie | ❌ | ❌ | ❌ |
| Audit, prehľad pre konateľa | ✅ | len vlastné kroky | ❌ | ❌ |
| Export údajov zamestnanca (GDPR) | ✅ | pripraví, konateľ potvrdí | ❌ | ❌ |
| Časové obmedzenie prístupu | – | – | ✅ povinné | – |

**Otvorené rozhodnutia pre konateľa** (zhrnuté aj v 03):
- Má zmena mzdy vyžadovať schválenie vždy, alebo len nad určitý limit?
- Ktoré typy dokumentov smie personalista podpísať sama?
- Má účtovníčka vidieť lekárske prehliadky? Navrhujem nie.
