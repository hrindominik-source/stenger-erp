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

## Doplnky pred fázou F (migrácia 53)

- `20261023100000_verzie_dodatky_prevzatie.sql`:
  - zamknutý, ale neúplne podpísaný dokument: „Zneplatnit a vytvořit novou verzi“ – pôvodná verzia VOIDED s dôvodom, podpisy ostávajú ako záznam, nová verzia potrebuje všetky podpisy znova;
  - úplne podpísaná zmluva: „Vytvořit dodatek“ (`hr_document_create_amendment`) – nový dokument `dodatek`, BILATERAL_CONTRACT, `amends_document_id`; pôvodná zmluva sa nemení;
  - sken potvrdenia o prevzatí: `hr_document_deliveries.receipt_scan_path/_sha256`, cesta `prevzeti/<dokument>/…<hash16>…`, nemenný, viditeľnosť podľa klasifikácie dokumentu (aj pred vložením záznamu); pri § 334 osobne povinný (alebo podpis potvrdenia na tablete – `confirmation_evidence.receipt_signature_id`, fáza F);
  - evidencia školení `hr_training_records` (školiteľ, rozsah, overenie znalostí – spôsob, výsledok, kto, kedy), len pridávanie; záznam o školení sa dá podpísať a je SIGNED len s evidenciou s výsledkom PASSED.
- Rollback: `supabase/rollback/20261023100000_verzie_dodatky_prevzatie_rollback.sql` (pred 52; zastaví sa, ak existujú dodatky, skeny potvrdenia alebo evidencia školení). Reťazec 53 → 48 otestovaný.
- Otvorené úlohy: šablóna dodatku (Word) chýba – dodatok sa zatiaľ pripraví mimo systému a nahrá sa podpísaný sken; hash skenu počíta prehliadač (rovnako ako pri doterajšom skene podpisu).

## Fáza F – podpisový režim na tablete pre HR (migrácia 54)

- Migrácia `20261023110000_tablet_podpis_hr.sql`: tabuľka `hr_signing_tokens` (len hash tokenu, max. 2 h, jednorazové použitie, bez RLS politík – iba server), text `INTENT_EMPLOYER_SIGNATURE` (KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU), trigger: písomnosť § 334 zamestnávateľ nepodpisuje obrázkom podpisu.
- Nová Edge Function `hr-signing` (sekcia v `config.toml`, `deno.json`): `issue` (HR overí totožnosť podľa dokladu – ukladá sa len druh dokladu a kto overil), `load`/`sign` (tablet s tokenom), `employer_load`/`employer_sign` (osoba s plnou mocou podľa `PS_PODEPISUJICI`), `qualified_upload` (PDF s uznávaným podpisom PAdES – overí sa väzba na finálne PDF a štruktúra podpisu).
- UI: v detaile dokumentu „Podepsat na tabletu“, „Podepsat za zaměstnavatele“, „Nahrát PDF s uznávaným podpisem“; samostatná stránka `?podpis=<token>` pre iný tablet.
- Poradie nasadenia: migrácia 54 → deploy `hr-signing` → frontend. Rollback: `supabase/rollback/20261023110000_tablet_podpis_hr_rollback.sql` (pred rollbackom 53; zastaví sa, ak už existujú podpisy z tabletu HR alebo za zamestnávateľa; funkciu `hr-signing` najprv vypnúť).
- Otvorené: overenie platnosti kvalifikovaného certifikátu (`certificate_validation: NOT_PERFORMED`); osoby s plnou mocou sú zatiaľ v kóde (`_shared/hr/podepisujici.js`).

## Doplnky pred fázou G (migrácia 55)

- Migrácia `20261023120000_pritomnost_overenie_plne_moci.sql` (+ rollback `supabase/rollback/20261023120000_pritomnost_overenie_plne_moci_rollback.sql`, spúšťa sa pred rollbackom 54; spolu s DB vrátiť aj frontend a funkcie `hr-signing`, `hr-delivery`).
- **Podpis len pri osobnej prítomnosti:** odkaz existuje len ako QR kód na obrazovke HR (nezobrazuje sa ako text, nedá sa kopírovať ani poslať). Tablet po otvorení vyžiada 6-miestny kód z obrazovky HR; 3 zlé kódy = token zrušený. Token platí 10 min, jednorazovo, len na zariadení, ktoré kód zadalo, a len kým je prihlásená relácia HR, ktorá overila doklad (`hr_auth_session_active`, len pre server). Dôkazy: `device_id`, `hr_session_id`, kto overil doklad, čas overenia kódu, počet pokusov. Zostatkové riziko: HR by mohol QR aj kód odfotiť a poslať – technicky to bráni krátka platnosť a väzba na prihlásenie HR, nie úplne; je to porušenie postupu.
- **Sken potvrdenia o prevzatí** nahráva nová Edge Function `hr-delivery` (`in_person`): typ súboru podľa obsahu, otisk počíta server; DB odmietne sken zapísaný klientom a úložisko odmietne priamy zápis do `prevzeti/`, `plne-moci/` a protokolov overenia.
- **Uznávaný podpis:** kým sa neoverí certifikát, stav je „podpis přítomen, certifikát neověřen“ (`hr_signature_certificate_status` = `NOT_VERIFIED`). Elektronické doručenie písomnosti § 334 (kanály `EMAIL%`) DB povolí len pri uznávanom podpise zamestnávateľa s overením `VALID`.
- **Osoby s plnou mocou** sú v tabuľke `hr_signatories` (meno, 7. pád, účet, platnosť od–do, sken plnej moci s otiskom zo servera, citlivosť skenu). Spravuje HR_ADMIN v Personalistika → Nastavení, zmeny idú do auditu, nemaže sa (ukončí sa dátumom). Mená sú z kódu odstránené. **Po nasadení na produkciu ich musí HR_ADMIN zadať** (inak sa v zmluvách nedá vybrať podpisujúci) – reálne mená nie sú v migrácii ani v seede.
- Nová funkcia `hr-delivery` (sekcia v `config.toml`). Nová závislosť `qrcode@1.5.4` (čistý JS).
- Integračné testy bežia postupne (`--pool=forks --no-file-parallelism`) – test finálneho PDF zakladá novú verziu textu prejavu vôle, ktorá by paralelne bežiacim podpisovým testom zmenila text. Lokálny Edge runtime občas vráti `WORKER_LIMIT` pri generovaní PDF v kiosku (limit prostredia; opakovanie prejde).

### Návrh: overenie platnosti certifikátu uznávaného podpisu

| | Ručne – verejná overovacia služba (pripravené) | Automaticky – vlastná validačná služba |
|---|---|---|
| Postup | HR nahrá podpísané PDF do verejnej overovacej služby (napr. demo validácia EU DSS alebo štátna služba na overenie podpisu), stiahne protokol, v detaile dokumentu „Zaznamenat ověření certifikátu“: výsledok, služba, protokol. Server protokol uloží a zahashuje, zapíše kto a kedy. | Pri nahratí PAdES server pošle PDF do **vlastnej** inštancie EU DSS (open source, Java) – výsledok a validačná správa sa uložia ako overenie s `method = AUTOMATIC`. |
| Plusy | Funguje hneď, bez infraštruktúry; protokol je dôkaz. | Bez ručného kroku, jednotné, kontrola dôveryhodných zoznamov (EU TSL). |
| Mínusy | Ručný krok; mzdové PDF sa nahráva do služby tretej strany (vyžaduje posúdenie GDPR/DPA). | Treba hostovať a udržiavať Java službu mimo Supabase; vlastná prevádzka. |

Odporúčanie: zatiaľ ručne (počet elektronicky doručovaných písomností § 334 je malý), pred ostrým použitím nechať právničku/DPO odsúhlasiť zvolenú verejnú službu. Automatiku doplniť neskôr do tej istej tabuľky `hr_signature_verifications` (bez zmeny schémy). Komerčné validačné API bez zmluvy o spracovaní neodporúčam.

## Fáza G – doručovanie e-mailom (migrácia 56)

- Migrácia `20261023130000_dorucovani_email.sql`, rollback `supabase/rollback/20261023130000_dorucovani_email_rollback.sql` (zastaví sa, ak existujú e-mailové zásielky).
- E-mail posiela **len server** (Edge Function `hr-delivery`: `send_email`, `retry`, `confirm_receipt`, `record_withdrawal`, `provider_event`, `sweep`). HR v DB nezaloží e-mailovú zásielku ani nezapíše stav odoslania, doklad o dodaní či odstúpenie.
- Režim odosielania: `hr_settings.email_mode = "mock"` + lokálny stack (`SUPABASE_URL=http://kong:8000`) → len lokálny Mailpit (`http://127.0.0.1:54324`). Inde funkcia odmietne odoslať (503 „není nakonfigurováno“) – **na staging/prod sa nič neodošle**, kým sa po schválení nedoplní skutočný poskytovateľ (secrets + webhook pre `provider_event` DELIVERED/BOUNCED). Testovacia adresa `*@fail.invalid` simuluje chybu poskytovateľa.
- Pravidlá: odoslané ≠ doručené; § 21 dodané len dokladom poskytovateľa alebo potvrdením, potom 7 dní na odstúpenie (zaznamená sa so skenom, po lehote odmietnuté); § 335 súhlas → fikcia 15. deň od dodania; § 335 ods. 3 → bez písomného potvrdenia do 15 dní od odoslania neúčinné; vrátená správa = neúčinné; max. 3 pokusy; po zmene e-mailu sa zlyhaná zásielka na starú adresu neopakuje.
- `electronic_contract_enabled` (default false) + platné § 21 oznámenie sú podmienkou podpisu zmluvy zamestnancom na tablete; po podpise server hneď zašle podpísaný originál na § 21 adresu.
- Lehoty vyhodnocuje `hr_document_deliveries_sweep()` (spúšťa detail dokumentu); **cron sa nenastavuje** – na prod až po schválení.
- Texty e-mailov: KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU (`supabase/functions/_shared/hrMail.ts`).

## Fáza H – oprávnenia (migrácia 57)

- `20261023140000_opravnenia.sql`, rollback `…_opravnenia_rollback.sql`. Matica oprávnení a rozhodnutia: `01-datovy-model.md`.
- Nové `HR_DOCUMENT_VOID` a `HR_SIGN_FOR_EMPLOYER`. Podpis za zamestnávateľa DB overí aj pre server (plná moc, meno, používateľ, oprávnenie). Podpisy, dôkazy a doručenia rešpektujú citlivosť dokumentu.
- **Po nasadení musí HR_ADMIN priradiť nové oprávnenia** – zneplatnenie predtým stačilo s GENERATE/APPROVE.

## Fáza I – šablóny a texty (migrácia 58)

- `20261023150000_sablony_texty.sql`, rollback `…_sablony_texty_rollback.sql`. Nová Edge Function `hr-declarations`. Popis: `04-sablony-texty.md`.

## Kompletný plán nasadenia

`06-plan-nasadenia.md` – poradie migrácií a funkcií, generálka na stagingu, overenie zálohy, produkcia, rollback, nastavenia HR po nasadení.

## Vzor pracovnej zmluvy ako šablóna (migrácia 59)

`20261023160000_sablona_pracovnej_zmluvy.sql` + rollback. Popis a testy: `04-sablony-texty.md`.

## Opravy z nezávislej kontroly (migrácia 60)

`20261023170000_bezpecnostne_opravy.sql` + rollback, zmeny v `hr-signing` (`paper_upload`, atomický kód, uznávaný podpis zamestnanca) a `hr-kiosk` (väzba podpisu na koncept, limity). Nálezy a stav: `07-nezavisla-kontrola.md`. Frontend, funkcie a migrácia idú spolu: starý frontend by papierový sken zapisoval priamo, čo DB po migrácii 60 odmietne.

