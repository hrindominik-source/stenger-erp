# Pred nasadením – podklad pre stretnutie s IT

Stav 29. 10. 2026, vetva `feature/podpisy-dorucovani`. Všetko je zatiaľ len lokálne. Na staging ani do produkcie sa nič nenasadilo. Podrobnosti sú v `docs/podpisy-dorucovani/06-plan-nasadenia.md` (poradie, rollbacky) a v `otazky-pre-mna.md`.

## 1. Čo vyžaduje server (vlastný, self-hosted)

- **Supabase stack:**
  - Postgres;
  - Auth (GoTrue) s podporou Auth hookov;
  - PostgREST;
  - Storage;
  - Edge Runtime (Deno).
- **Doména s HTTPS.**
- **Kľúče a premenné:**
  - `SUPABASE_URL`, `SUPABASE_ANON_KEY` a `SUPABASE_SERVICE_ROLE_KEY` sú len v prostredí servera, nikdy nie v repozitári.
  - Frontend potrebuje `VITE_SUPABASE_URL` a `VITE_SUPABASE_ANON_KEY` nového servera.
- **Presun dát z dnešného Supabase:** databáza vrátane schémy `auth` (účty, MFA faktory) a súbory v úložisku (bucket `hr-dokumenty`). Súbory nie sú súčasťou zálohy DB. Pred presunom a po ňom porovnať počty súborov a ich hashe.
- **Plánovač (systémový cron),** keďže pg_cron v projekte nie je. Dve úlohy:
  - denne `POST /functions/v1/hr-legislativa` s telom `{"action":"check"}` a hlavičkou `Authorization: Bearer <service role>`. Posiela pripomienky revízií a kontroluje zákon.
  - `hr_document_deliveries_sweep()` (lehoty doručenia) až po zapojení poskytovateľa e-mailov.

## 2. Poradie nasadenia

1. **Záloha** DB a samostatná kópia úložiska. Overiť obnovu.
2. **Migrácie** v poradí podľa čísla. Tabuľka v `06-plan-nasadenia.md`, kap. 1, obsahuje čísla 48–76.
   - Baseline `20261022120000` sa na existujúcej databáze **nespúšťa**.
   - Každá migrácia beží v transakcii. Ku každej je rollback v `supabase/rollback/`.
3. **Edge Functions**, všetky s `verify_jwt = true`:
   - `hr-finalize-pdf`, `hr-signed-original`, `hr-kiosk`, `hr-signing`, `hr-delivery`, `hr-declarations`;
   - `hr-mfa` (od migrácie 69), `hr-ucty` (73), `hr-legislativa` (74).
4. **Frontend** z tej istej vetvy, spolu s migráciami. Niektoré migrácie menia volania (48, 55, 75, 76).
5. **Kontrola po nasadení:**
   - prihlásenie s MFA;
   - kiosk;
   - podpis na papieri;
   - prehľad jednatela.

Pred migráciou 75 skontrolovať:
- čakajúce žiadosti o podpis bez finálneho PDF (po nasadení ich treba podať znova);
- ručné historické záznamy, ktoré založila personalistka.

## 3. Nastavenia servera

| Oblasť | Čo nastaviť |
|---|---|
| **TOTP (MFA)** | Zapnúť registráciu aj overenie TOTP. Povinné je pre profily Jednatel, Personalista a Externí účetní. Telefonické (SMS) MFA vypnúť. |
| **Auth hooky** | `password_verification_attempt` → `pg-functions://postgres/public/hook_password_verification_attempt` a `mfa_verification_attempt` → `pg-functions://postgres/public/hook_mfa_verification_attempt`. Na self-hosted cez `GOTRUE_HOOK_PASSWORD_VERIFICATION_ATTEMPT_*` a `GOTRUE_HOOK_MFA_VERIFICATION_ATTEMPT_*`. Hooky zapisujú neúspešné prihlásenia. Prihlásenie nikdy neblokujú. |
| **Cron** | Pozri kap. 1. Service role kľúč patrí len do konfigurácie plánovača. |
| **SMTP pre Auth** | Reset hesla a pozvánky (Auth e-maily). Odosielateľ na vlastnej doméne so SPF, DKIM a DMARC. Doručovanie HR dokumentov e-mailom je **samostatný projekt**, dnes je `email_mode = "mock"` a nič sa neodosiela. |
| **Zálohy** | Denná záloha DB, ideálne s obnovou k časovému bodu (PITR). Zálohovať aj úložisko. Aspoň raz skúsiť obnovu. Určiť, kto má prístup k zálohám, pretože obsahujú citlivé údaje (rodné čísla, mzdy). |
| **Prístup IT** | Postup pri strate MFA jednatela: `06-plan-nasadenia.md`, posledná kapitola. Jednatelovi sa MFA v aplikácii zrušiť nedá. |

## 4. Čo nastaví jednatel po nasadení

1. **Profil KONATEL** (HR_ADMIN) na vlastný účet. Dáva IT pri prvom nastavení, ostatné profily potom prideľuje jednatel v aplikácii. Prvé prihlásenie: registrácia TOTP a uloženie záložných kódov.
2. **Ďalšie prístupy:** personalistka (Personalista) a externá účtovníčka (Externí účetní, s dátumom platnosti).
3. **Osoby s plnou mocou** (meno, 7. pád, platnosť, sken plnej moci). Bez nich nie je koho vybrať ako podpisujúceho za zamestnávateľa.
4. **Zákonné parametre** (Pro jednatele → Zákonné parametry) podľa zdrojov. Hodnoty nie sú predvyplnené.
5. **Lehoty uchovávania** (10 kategórií) – až podľa právničky. Dovtedy sa anonymizácia nedá spustiť.
6. **Schválenie textov a šablón** – po právničke. Neschválené texty sa nepoužijú.
7. **Polročná revízia** k 1. 7. 2026 sa po nasadení ukáže ako zmeškaná. Potvrdiť ju po kontrole.
8. **Zoznam spracovateľov** (stav zmlúv, „neověřeno“) – doplniť.
9. **Strážca zmien zákona** (e-Sbírka) ostáva vypnutý, kým IT neoverí strojovo čitateľné rozhranie (`docs/audit/05-legislativa.md`).

## 5. Čaká na právničku

Všetky právne texty sú označené „KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU“.
- Texty prejavu vôle pri elektronickom podpise. Dovtedy je podpis na tablete a v kiosku vypnutý, papierová cesta funguje.
- Vyhlásenia § 21 a § 335 (poučenie a súhlas).
- Lehoty uchovávania a postup anonymizácie.
- Výklad zákonných limitov:
  - minimálna mzda pri kratšom úväzku;
  - výnimky z doby určitej podľa § 39;
  - DPP a DPČ.
- Podmienky elektronického uzavretia zmluvy (prepínač `electronic_contract_enabled` je vypnutý) a spôsob overovania certifikátov.

## 6. Otvorené otázky (výber, plný zoznam je v `otazky-pre-mna.md`)

- **E-mail:** poskytovateľ v EÚ so zmluvou o spracovaní (DPA), doména a webhook. Dovtedy nefunguje e-mailové doručovanie ani okamžité e-mailové upozornenia jednatelovi.
- **e-Sbírka:** má oficiálne API na novely zákona č. 262/2006 Sb.? Za akých podmienok?
- **Plán směn:** PINy sú v DB čitateľné a predvolený admin PIN je 1234. Hashovanie PINov odporúčam.
- **MFA:** kto sa zaregistroval pred migráciou 69, nemá záložné kódy. Rozhodnúť, či vynútiť novú registráciu.
- **Ručný test:** test na reálnom tablete ešte chýba.
- **Povinný dôvod zmeny v Karte** kontroluje aplikácia, nie databáza. Zmena cez priame API bez dôvodu je však v audite.
