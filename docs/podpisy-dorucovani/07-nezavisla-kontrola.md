# Nezávislá kontrola vetvy `feature/podpisy-dorucovani` (23. 10. 2026)

Kontrolu robil samostatný agent, ktorý kód nepísal. Kontroloval len čítaním a lokálnymi pokusmi v transakcii s vymyslenými údajmi. Rozsah: RLS a oprávnenia, Edge Functions, kiosk a podpisový odkaz, nemennosť a pravidlá doručovania. Opravy sú v migrácii 60 (`20261023170000_bezpecnostne_opravy.sql`), v Edge Functions `hr-signing` a `hr-kiosk` a v UI. Všetko je len lokálne.

| # | Závažnosť | Nález | Stav |
|---|---|---|---|
| H1 | vysoká | HR s `HR_DOCUMENT_SIGN` vedel priamym zápisom podvrhnúť elektronický podpis (aj uznávaný) a dokument tak podpísať bez zamestnanca | **opravené** – podpisy zapisuje len server (trigger + zrušená politika insert) |
| H2 | vysoká | finalizovaný, nepodpísaný dokument mal meniteľné právne údaje (e-mail vo vyhlásení § 21, typ úkonu, druh, zamestnanec, verzia šablóny) | **opravené** – po finálnom PDF sa nemenia; zmena = nová verzia |
| H3 | vysoká | písomnosť § 334 sa dala označiť „doručené proti potvrdeniu“ s vymysleným potvrdením a dátumom spred roka | **opravené** – záznamy doručenia zapisuje len server; potvrdenie musí byť podpísaný doklad o prevzatí práve k tomuto dokumentu; osobné odovzdanie nie pred podpisom dokumentu |
| M1 | stredná | kiosk: po príprave PDF sa dal zmeniť koncept (e-mail) a vyhlásenie by uložilo inú adresu, než je v podpísanom PDF | **opravené** – podpis len pri zhodnom otlačku konceptu |
| M2 | stredná | neoverený uznávaný podpis sa započítal ako podpis zamestnanca (HR mohlo „podpísať“ za zamestnanca vlastným certifikátom) | **opravené** – uznávaný podpis zamestnanca sa započíta až po overení certifikátu (VALID), meno zamestnanca berie server z karty |
| M3 | stredná | citlivosť verzie šablóny sa dala zmeniť (napr. všetky zmluvy sprístupniť pre HR_VIEW_BASIC) | **opravené** – citlivosť verzie sa po vložení nemení, mapovanie a schéma sa po použití nemenia |
| M4 | stredná | otlačok a cestu papierového skenu posielal prehliadač, nikto ich neoveroval | **opravené** – sken nahrá a zahashuje server (`hr-signing` `paper_upload`), prehliadač do `zamestnanci-podpisy/` nezapíše |
| L1 | nízka | limit 3 pokusov na kód sa dal obísť paralelnými požiadavkami | **opravené** – pokus sa vyhodnocuje pod zámkom riadku v DB |
| L2 | nízka | kiosk: zahltenie (neobmedzená veľkosť konceptu, neobmedzené generovanie PDF v relácii) | **čiastočne** – limit konceptu 256 KB a max. 40 dokumentov na reláciu; globálny limit 30 relácií za hodinu ostáva (môže zablokovať nástupy, riešenie: odomykanie kiosku HR – otázka 9 pre právničku) |
| L3 | nízka | rollback skripty potichu menili alebo mazali dôkazy (VOIDED → ARCHIVED, finálne PDF, udalosti tlače) | **opravené** – rollback 48 a 52 sa v takom prípade zastavia |
| L4 | nízka | tri pomocné DEFINER funkcie boli dostupné pre anon | **opravené** – odobraté |
| I1 | info | vyhlásenia (e-maily) a evidenciu školení vidí každý s HR_VIEW_BASIC bez ohľadu na citlivosť dokumentu | ponechané – e-mail je kontaktný údaj, rovnaký ako v karte zamestnanca (HR_VIEW_BASIC); rozhodnúť pri revízii oprávnení |
| I2 | info | HR_EDIT mohol nahrať „návnadové“ súbory do priečinkov dokumentov | čiastočne – zakázané pre `zamestnanci-podpisy/`; ostatné súbory bez záznamu v DB sa nikde nezobrazia |
| I3 | info | ručné overenie certifikátu robí tá istá rola (HR_DOCUMENT_SIGN) a protokol je ľubovoľný súbor | ponechané – postup čaká na vyjadrenie právničky (otázka 14); zvážiť overenie inou osobou (štyri oči) |

Čo kontrola potvrdila ako v poriadku:
- podpisové tokeny: hash, 10 min, jednorazové, väzba na zariadenie a reláciu HR;
- stĺpce, ktoré zapisuje len server: finálne PDF, podpísaný originál, stav odoslania, skeny;
- pravidlá lehôt a doručovania (§ 21, § 335, § 335 ods. 3, vrátená správa, 3 pokusy);
- nemennosť textov a dôkazných tabuliek;
- žiadny prístup k cudzím dokumentom cez Edge Functions;
- cesty v úložisku skladá server;
- kiosk vidí len svoju reláciu.

Testy:
- pgTAP `bezpecnostne_opravy.test.sql`;
- IT: papierový sken cez server, uznávaný podpis zamestnanca až po overení, kiosk a zmena konceptu, odovzdanie pred podpisom.
- Upravené staré testy: priamy zápis podpisu alebo doručenia teraz robí server.

Rollback: `supabase/rollback/20261023170000_bezpecnostne_opravy_rollback.sql` spúšťať pred rollbackom 59, spolu s vrátením frontendu a funkcií `hr-signing` a `hr-kiosk`.

**Zistenie z testov:** generovanie PDF dotazníka v kiosku (`prepare`) lokálne občas narazí na limit CPU času edge runtime (`WORKER_LIMIT`). Hostovaný Supabase má limit CPU na požiadavku tiež. **Na generálke na stagingu treba overiť**, či `prepare` s dotazníkom a § 21/§ 335 prejde. Ak nie, generovanie treba rozdeliť po dokumentoch.

## Doplnok 23. 10. 2026 – polovičný podpis pri limite CPU (ručný test)

Pri podpise za zamestnávateľa sa podpis uložil, ale tvorba podpísaného originálu v tej istej požiadavke prekročila limit CPU Edge Function (WORKER_LIMIT). Dokument ostal „K podpisu“ bez originálu a klient ukázal chybu spojenia.

Oprava:
- podpis (`sign`, `employer_sign`, kiosk `sign`) len uloží podpis;
- `complete` (podpísaný originál + „Podepsáno“) a `deliver_after_signing` (e-mail § 21) sú samostatné, idempotentné kroky;
- `signing_status` po strate spojenia overí, či sa podpis uložil;
- detail dokumentu berie chýbajúce podpisy zo servera (ten istý údaj ako kontrola „už podepsal“) a ponúkne „Dokončit podpis“;
- počet strán sa berie z overenia finálneho PDF, nie z opätovnej extrakcie textu.

Testy: IT (idempotencia, jeden e-mail) a e2e (strata spojenia pred serverom a po uložení podpisu).

## Doplnok 24. 10. 2026 – nálezy z ručného testu zmluvy

- Rýchly posun: strana sa počíta ako prezretá, keď ju posun prešiel (spodný okraj nad spodkom viditeľnej časti), aj bez zastavenia. E2e `rychly-posun.e2e.js` (veľké kroky kolieskom – so starým kódom zlyhá na „1 z 4“; švihnutie prstom).
- Spôsob podpisu podľa kanála v dôkazoch: „tablet (zaměstnanec)“, „tablet – nástupní kiosk (zaměstnanec)“, „elektronicky – přihlášený uživatel“; rovnako na dôkaznom liste podpísaného originálu (nové originály).
- Záložka Personalistika: chybu sa nepodarilo zopakovať (ani pri pomalej sieti); pravdepodobná príčina je obnovenie stránky dev serverom počas úprav kódu. Zvolená záložka sa teraz pamätá (sessionStorage), test `personalistika-zalozka.e2e.js`.
- Príloha e-mailu § 21: IT overuje, že príloha = uložený podpísaný originál (rovnaký SHA-256), obsahuje dôkazný list s otlačkom finálneho PDF a oboma podpismi.
- Časti K a L ručného testu: e2e `papier-prevzeti.e2e.js` cez UI (sken, chybný typ súboru, potvrdenie o prevzatí + sken, mzdový výmer § 334 – predanie len proti skenu potvrdenia).
