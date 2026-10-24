# Návrh kontrolných mechanizmov – balíky a poradie

Iba návrh, nič sa neimplementuje bez schválenia. Odhady náročnosti sú hrubé, v dňoch práce vývoja vrátane testov, bez času konateľa a právničky. Poradie je zoradené podľa toho, koľko rizika balík odstráni na jednotku práce. Nadväzuje na zistenia v `01-audit-personalistika.md` a maticu v `02-matica-opravneni.md`.

## Prehľad

| # | Balík | Hlavné riziko, ktoré rieši | Odhad | Kedy |
|---|---|---|---|---|
| A | Stopa a prehľad pre konateľa | zmeny oprávnení a rizikové kroky bez vedomia konateľa | 3–4 d | pred presunom |
| B | Roly a oddelenie prístupov | personalistka a účtovníčka majú viac, než potrebujú (aj celé ERP) | 3–5 d | pred presunom |
| C | Schvaľovanie šablón a právnych textov | neschválená alebo zastaraná šablóna/text v podpísanom dokumente | 3–4 d | pred presunom |
| D | Zákonné parametre a kontroly pri generovaní | chybná zmluva (skúšobná doba, mzda, doba určitá) | 4–6 d + vyplnenie parametrov konateľom | po C |
| E | Princíp štyroch očí pre rizikové kroky | jedna osoba sama podpíše / zneplatní / zmení mzdu | 4–6 d | po A–C |
| F | GDPR: záznam prístupu, uchovávanie, export | únik alebo nadbytočné uchovávanie citlivých údajov | 3–5 d (+ lehoty od právničky) | prístup pred presunom, zvyšok po |
| G | Bezpečnosť účtov | prevzatý účet HR_ADMIN alebo personalistky | 1–3 d | pred presunom (MFA), odchody po |
| H | Sledovanie legislatívy | zastaralé šablóny a parametre po novele | 0,5–1 d | po D |

Bezpečnostné zistenia nezávislého agenta (časť S v 01) majú prednosť pred balíkmi, ak sú KRITICKÉ alebo VYSOKÉ. Patria do „opráv pred presunom“ samostatne.

---

## A. Stopa a prehľad pre konateľa

**Čo:**
1. **Audit doplniť** tam, kde chýba, najmä pri oprávneniach a rolách:
   - `hr_permissions` a `profiles` (oprávnenia a roly);
   - `hr_signing_tokens` (vydanie a zrušenie kódu);
   - `onboarding_sessions` (stav, nie obsah dotazníka);
   - `hr_kiosk_unlocks`.
2. **Centrum upozornení v aplikácii:** tabuľka `hr_notifications` (udalosť, závažnosť, objekt, kto, kedy, „na vedomie“ / „vyžaduje schválenie“, prečítané kým a kedy). Plnia ju triggre a server.
3. **Udalosti** podľa zadania 3.5:
   - podpísaná zmluva, dodatok alebo ukončenie;
   - zneplatnenie dokumentu;
   - zmena mzdy;
   - zmena šablóny alebo textu (čaká na schválenie);
   - zmena oprávnení alebo plnej moci;
   - mazanie alebo anonymizácia;
   - zlyhané alebo neúčinné doručenie;
   - uplynuté lehoty (zmluvy, prehliadky, školenia, revízie šablón);
   - nezvyčajná aktivita (hromadný export, prístup mimo pracovného času, neúspešné prihlásenia – posledné závisí od Auth logov, pozri G).
4. **Stránka „Prehľad pre konateľa“:**
   - čaká na schválenie;
   - posledné rizikové kroky;
   - lehoty;
   - kto má aké oprávnenia (s dátumom poslednej zmeny).
5. **Týždenný súhrn:** v aplikácii hneď, e-mailom až po výbere poskytovateľa. Pripraviť funkciu, ktorá súhrn zostaví; odoslanie sa zapne nastavením.

**Prečo prvé:** konateľ hneď vidí, čo sa deje, aj bez ďalších obmedzení. Je to lacné a nič neblokuje bežnú prácu.

## B. Roly a oddelenie prístupov

**Čo:**
1. **Profily oprávnení** KONATEL, PERSONALISTA, UCTOVNIK_EXT a VLASTNÝ (len s dôvodom). Nastavenie oprávnení ponúkne profil, nie zoznam kódov.
2. **`HR_DOCUMENT_APPROVE` rozdeliť:**
   - `HR_TEMPLATE_APPROVE` (šablóny, iba KONATEL);
   - posun stavu dokumentu.
3. **`HR_VIEW_SENSITIVE` rozdeliť:**
   - údaje pre mzdy (RČ, účet, ZP);
   - doklady totožnosti a údaje cudzinca.
4. **UCTOVNIK_EXT:**
   - vlastná rola v `profiles` (nie `office`), aby nevidel objednávky, cenníky ani firmu;
   - vidí len časť „Mzdy“ v Personalistike;
   - stĺpce `valid_from` / `valid_to` v `hr_permissions` a kontrola v `hr_has_permission`;
   - po vypršaní automaticky bez prístupu a upozornenie konateľovi.
5. **Viazanie `hr_permissions` na `auth.users.id`** namiesto e-mailu (zmena e-mailu nesmie preniesť oprávnenia). Potvrdí sa podľa nálezov časti S.
6. **Jediný HR_ADMIN:** kontrola a upozornenie, ak by HR_ADMIN mal viac ako jeden účet; núdzový postup pozri E.

**Rozhodnutia konateľa:**
- Má personalistka mať prístup do zvyšku ERP?
- Má účtovníčka vidieť exekúcie (doklady) a lekárske prehliadky? Návrh: exekúcie áno, prehliadky nie.

## C. Schvaľovanie šablón a právnych textov

**Dnes:**
- Šablónu nahrá a schváli ten istý človek s `HR_DOCUMENT_APPROVE`.
- `approved_by` zapisuje prehliadač, nie server.
- Generovanie len zo schválenej šablóny kontroluje iba UI.
- Právne texty vytvorí aj schváli ten istý človek s `HR_LEGAL_TEXTS_ADMIN`.
- Platí aj verzia v stave KONCEPT (`hr_current_legal_text` berie najvyššiu nevyradenú) a v dokumente sa označí „koncept“.

**Návrh:**
1. **Životný cyklus:** NÁVRH → KE_SCHVÁLENÍ → SCHVÁLENÁ → VYRADENÁ, pre šablóny aj texty.
   - Schvaľuje iba KONATEL a nesmie to byť ten, kto návrh vytvoril.
   - `approved_by` a `approved_at` nastavuje DB.
   - Voliteľná poznámka „overené právničkou“ s dátumom.
2. **Metadáta** pri šablóne a texte: právny základ (paragrafy), „právne overené k“, kto overil, dátum ďalšej revízie.
3. **DB pravidlo:** dokument (`hr_documents` insert, finalizácia) sa dá vytvoriť len zo šablóny, ktorá:
   - bola v deň generovania SCHVÁLENÁ;
   - nie je po termíne revízie.

   Ten istý princíp platí pre text prejavu vôle pri podpise.
4. **Upozornenie** 30 dní pred revíziou a po jej uplynutí (napojené na A).
5. **Prechodné obdobie:** kým právnička texty neschváli, dnešné KONCEPT texty zostanú použiteľné len s výslovným nastavením konateľa „povoliť koncepty“. Inak ide o tvrdý blok.

## D. Zákonné parametre a kontroly pri generovaní

**Dnes:**
- Upozornenie pri skúšobnej dobe (> 4 mesiace bez vedúceho, > ½ doby určitej) je natvrdo v kóde (`supabase/functions/_shared/hr/employeeFields.js:236`). Je to len upozornenie, nie blok.
- Kontrola minimálnej mzdy ani limitov doby určitej / DPP / DPČ neexistuje.
- Pred generovaním sa kontroluje len vyplnenosť povinných polí (`psMissing`).

**Návrh:**
1. **Tabuľka `hr_legal_parameters`:** kľúč, hodnota, jednotka, platnosť od–do, zdroj (predpis, paragraf), zadal, schválil. Mení ju iba KONATEL a každá zmena ide do auditu a upozornení.
   - **Hodnoty sa nevymýšľajú.** Systém dodá len zoznam kľúčov a konateľ ich vyplní.
2. **Zoznam parametrov na vyplnenie:**
   - minimálna mzda (mesačná, hodinová);
   - zaručená mzda (ak sa bude používať);
   - max. skúšobná doba (bežný / vedúci zamestnanec);
   - max. dĺžka a počet opakovaní doby určitej;
   - limity DPP (hodiny za rok, príjem pre odvody);
   - limity DPČ (rozsah, príjem pre odvody);
   - týždenná pracovná doba (max.);
   - lehoty lekárskej prehliadky podľa kategórie práce (ak budú v systéme);
   - lehoty školenia BOZP.

   Presný zoznam overí konateľ s právničkou a mzdovou účtovníčkou.
3. **Kontroly** (pri uložení karty, pred generovaním, pred podpisom):
   - skúšobná doba ≤ maximum a ≤ ½ doby určitej;
   - doba určitá: dĺžka a počet opakovaní za sebou u toho istého zamestnanca (z histórie pomerov);
   - mzda ≥ minimálna mzda platná k dátumu nástupu alebo účinnosti zmeny, prepočítaná na úväzok;
   - povinné náležitosti podľa druhu dokumentu (druh práce, miesto výkonu, deň nástupu…);
   - dátum podpisu ≤ deň nástupu;
   - pred nástupom vstupná lekárska prehliadka a vstupné školenie BOZP (upozornenie; blok podľa rozhodnutia).
4. **Blok verzus upozornenie:** zákonné limity blokujú. Výnimka je možná len so schválením konateľom (balík E) a zapíše sa do dokumentu aj auditu. Ostatné kontroly sú upozornenia.
5. **Zhoda so šablónou:** pri finalizácii zaznamenať verziu šablóny a parametrov použitých v deň generovania, aby sa dalo dodatočne overiť, čo platilo.

## E. Princíp štyroch očí

**Spoločný mechanizmus `hr_approval_requests`:**
- obsahuje typ, objekt, navrhovanú zmenu, navrhovateľa, dôvod, stav, schvaľovateľa a čas;
- rizikový krok sa najprv zapíše ako žiadosť;
- vykoná sa až po schválení inou osobou (DB alebo server, nie len UI).

**Kroky, ktoré schvaľuje konateľ (návrh):**
- zmena šablóny alebo právneho textu (C);
- zákonné parametre (D);
- oprávnenia a plné moci;
- trvalé mazanie a anonymizácia;
- zneplatnenie podpísaného dokumentu;
- ručné overenie uznávaného podpisu;
- výnimka z kontroly v D;
- vybrané typy dokumentov pred podpisom za zamestnávateľa (výpoveď, dohoda o skončení, okamžité skončenie, zrušenie v skúšobnej dobe, zmena mzdy nad limit – rozhodnutie konateľa).

**Keď konateľ nie je dostupný (núdzový postup):**
- Navrhovateľ uvedie dôvod a spôsob, akým konateľa informoval (napr. telefonát), krok vykoná ako „núdzový“.
- Konateľ dostane upozornenie a krok musí dodatočne potvrdiť alebo odmietnuť do X dní (lehotu určí konateľ).
- Neschválené núdzové kroky sa zobrazujú v prehľade, kým ich niekto nevyrieši.
- Núdzový postup nie je dostupný pre zmenu oprávnení a pre trvalé mazanie.
- Druhá možnosť: zástupca konateľa ako druhý schvaľovateľ. Rozhodnutie konateľa.

## F. GDPR (podrobne v `04-gdpr.md`)

1. **Záznam prístupu k citlivým údajom:**
   - RČ, doklad, účet, zdravotné údaje, exekúcie, mzdy;
   - čítanie ide cez RPC alebo pohľad, ktorý zapíše `hr_access_log` (kto, kedy, ktorý zamestnanec, aká kategória);
   - hromadné čítanie (export, zoznam) sa zapíše jedným záznamom s počtom.
2. **Lehoty uchovávania** podľa druhu dokumentu a údajov:
   - tabuľka lehôt vyplní konateľ podľa právničky a mzdovej účtovníčky;
   - upozornenie na archiváciu alebo anonymizáciu;
   - anonymizácia ako proces so schválením (E).
3. **Export údajov zamestnanca** (ZIP: údaje + dokumenty) so záznamom, kto ho vytvoril.
4. **Oprava údajov:** už dnes sa zapisuje cez `audit_log`. Doplniť dôvod opravy a zobrazenie histórie v karte.
5. **Zoznam spracovateľov** pre záznam o činnostiach spracovania (04).

## G. Bezpečnosť účtov

1. **MFA (TOTP)** povinné pre HR_ADMIN a personalistku. Supabase Auth TOTP podporuje; aplikácia vyžaduje `aal2` pre HR (RLS kontrola `auth.jwt()->>'aal'`). Na vlastnom serveri platí rovnako pri self-hosted Supabase.
2. **Žiadne zdieľané účty:** pravidlo a kontrola, že jeden e-mail patrí jednej osobe. Prihlásenie z viacerých zariadení naraz ukázať v prehľade.
3. **Vypršanie relácie:** odhlásenie po nečinnosti v HR (napr. 30 min – rozhodnutie). Nastavenie platnosti tokenov v Auth.
4. **Odchod používateľa:** postup „odobrať prístup“ (oprávnenia, rola, zablokovanie účtu, zrušenie relácií), záznam a upozornenie.
5. **Neúspešné prihlásenia:** zdroj sú Auth logy. Na vlastnom serveri ich treba sprístupniť pre upozornenia z A.

## H. Sledovanie legislatívy

**Spoľahlivé:**
- pripomienka revízie dvakrát ročne a k 1. 1.;
- zoznam šablón, textov a parametrov s dátumom posledného overenia;
- potvrdenie konateľa „skontrolované“ do auditu.

**Automatické sledovanie novel zákona č. 262/2006 Sb.:** e-Sbírka (Sbírka zákonů v elektronickej podobe) zverejňuje znenia a novely. Či má stabilné API alebo otvorené dáta vhodné na strojové sledovanie, **som neoveroval** (bez prístupu na internet).
- Ak áno: denná kontrola, či k zákonu pribudla novela, a upozornenie konateľovi „novela – skontrolovať šablóny“.
- Obmedzenia: nebude rozlišovať, či sa novela týka našich šablón. Zachytí len vyhlásené predpisy, nie pripravované. Pri zmene rozhrania prestane fungovať; preto upozorniť aj na zlyhanie kontroly.
- Nenahrádza právničku ani odber noviniek od nej alebo z MPSV.

## Poradie a vzťah k presunu na server

**Pred presunom** (nezávisí od hostingu, zníži riziko pri migrácii):
- opravy KRITICKÝCH a VYSOKÝCH zistení zo `01` (časť S);
- balík A (stopa, prehľad);
- balík B (roly; najmä účtovníčka mimo ERP);
- balík C (schvaľovanie šablón a textov);
- z balíka G MFA;
- z balíka F záznam prístupu.

**Po presune:**
- D (parametre + kontroly);
- E (4 oči pre zvyšok krokov);
- F (lehoty, export, anonymizácia);
- G (odchody, Auth logy z nového servera);
- H;
- e-mailové upozornenia po výbere poskytovateľa.

**Čo potrebuje rozhodnutie konateľa pred začatím:**
- poradie balíkov;
- limit pre zmenu mzdy;
- typy dokumentov len s konateľom;
- prístup personalistky do zvyšku ERP;
- núdzový postup alebo zástupca;
- dĺžka nečinnosti pre odhlásenie;
- či povoliť dočasne KONCEPT texty.
