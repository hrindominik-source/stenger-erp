# Podklady pro právničku – elektronické podpisy a doručování písemností

Stenger Czech s.r.o. · systém Stenger ONE (personalistika) · stav k 23. 10. 2026

Všechny texty níže jsou **koncepty** (v systému označené „KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU“). Nic z toho zatím neběží v ostrém provozu. Prosíme o úpravu nebo schválení textů (oddíly 2–4) a odpovědi na otázky (oddíl 6) – stačí odkázat číslem.

## 1. Co systém dělá (stručně)

- Dokument k podpisu je vždy **finální PDF** s otiskem SHA-256; po prvním podpisu se už nedá změnit. Změna = nová verze s novými podpisy (stará zůstává dohledatelná).
- Podpis zaměstnance na tabletu **jen za osobní přítomnosti** u personálního oddělení: HR ověří totožnost podle dokladu (ukládá se jen druh dokladu), zobrazí QR kód a jednorázový kód; zaměstnanec musí projít všechny strany. Ukládá se obrázek podpisu, text projevu vůle (verze), otisk dokumentu, zařízení, čas a kdo totožnost ověřil.
- Za zaměstnavatele podepisuje jen osoba s **platnou plnou mocí** evidovanou v systému a s oprávněním k tomu. Písemnosti podle § 334 (např. mzdový výměr) zaměstnavatel podepisuje **uznávaným elektronickým podpisem**; dokud není ověřena platnost certifikátu, systém je e-mailem nedoručí.
- Papírová cesta funguje vždy: tisk → podpis perem → sken (vázaný na konkrétní verzi) → záznam předání.
- Elektronické uzavření smlouvy (§ 21) je **vypnuté**, dokud ho nezapneme; i pak jen se zaměstnancem, který má platné oznámení elektronické adresy pro svůj aktuální e-mail. Po podpisu systém pošle vyhotovení na tuto adresu.
- Doručování podle § 335 je **vypnuté**; po zapnutí jen se samostatným souhlasem, kterému vždy předchází poučení (verze se ukládá).
- Odeslání e-mailu se nikdy nezobrazuje jako „doručeno“. Lhůty počítá systém automaticky (oddíl 5).
- Po změně e-mailu přestávají dosavadní oznámení i souhlas platit; je potřeba nové.

## 2. Texty prohlášení, poučení a projevů vůle

| # | Text | Verze | Kde se použije |
|---|---|---|---|
| T1 | Oznámení elektronické adresy (§ 21 zákoníku práce) | v1 | Samostatný dokument „Oznámení elektronické adresy“ (kiosk při nástupu nebo personální oddělení); zaměstnanec podepisuje. |
| T2 | Poučení o doručování písemností elektronicky (§ 335 zákoníku práce) | v1 | Celé znění je součástí dokumentu souhlasu § 335 (před textem souhlasu); lze vydat i jako samostatné poučení. |
| T3 | Souhlas s doručováním písemností elektronicky (§ 335 zákoníku práce) | v1 | Samostatný dokument „Souhlas s elektronickým doručováním“; zaměstnanec podepisuje, verze poučení se ukládá. |
| T4 | Odvolání souhlasu s doručováním písemností elektronicky (§ 335 zákoníku práce) | v1 | Dokument „Odvolání souhlasu“; po podpisu systém zablokuje další doručování podle § 335. |
| T5 | Potvrzení o převzetí písemnosti | v1 | Potvrzení o převzetí konkrétní písemnosti (s otiskem SHA-256 předaného vyhotovení); papír nebo tablet. |
| T6 | Projev vůle – smlouva | v1 | Zobrazí se nad podpisovým polem na tabletu u smluv (pracovní smlouva, dodatek, dohoda). |
| T7 | Projev vůle – prohlášení zaměstnance | v1 | Nad podpisem u prohlášení zaměstnance (oznámení § 21, souhlas a odvolání § 335, výpověď zaměstnance). |
| T8 | Projev vůle – za zaměstnavatele | v1 | Nad podpisem osoby s plnou mocí, která podepisuje za zaměstnavatele na tabletu. |
| T9 | Projev vůle – převzetí | v1 | Nad podpisem u dokumentů „k převzetí“ (náplň práce, poučení, potvrzení o převzetí). |
| T10 | Projev vůle – záznam o školení | v1 | Nad podpisem záznamu o školení (jen s evidencí školení a ověřením znalostí). |
| T11 | Prohlášení k osobnímu dotazníku | v1 | Nad podpisem osobního dotazníku v kiosku. |

### T1 · Oznámení elektronické adresy (§ 21 zákoníku práce) (v1)

Klíč `S21_ADDRESS_NOTICE` · otisk SHA-256 `9a06c9c46a16f204…`

> KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.
> Oznamuji zaměstnavateli Stenger Czech s.r.o., IČO 28501381, svou elektronickou adresu uvedenou v tomto oznámení pro účely § 21 zákoníku práce.
> Prohlašuji, že tato adresa není v dispozici zaměstnavatele (nejde o pracovní e-mailovou schránku přidělenou nebo spravovanou zaměstnavatelem).
> Na tuto adresu mi zaměstnavatel zašle vyhotovení pracovní smlouvy, dohody o provedení práce, dohody o pracovní činnosti, jejich změn a dalších dohod uvedených v § 21 odst. 1 zákoníku práce, budou-li uzavřeny elektronicky.
> Beru na vědomí, že od takto uzavřené smlouvy nebo dohody mohu písemně odstoupit nejpozději do 7 dnů ode dne, kdy mi bylo její vyhotovení dodáno na tuto adresu, pokud jsem dosud nezačal(a) plnit práva a povinnosti z ní vyplývající.
> Zavazuji se každou změnu této adresy zaměstnavateli bez zbytečného odkladu písemně oznámit. Toto oznámení se vztahuje pouze k adrese v něm uvedené.

### T2 · Poučení o doručování písemností elektronicky (§ 335 zákoníku práce) (v1)

Klíč `S335_NOTICE` · otisk SHA-256 `3cd2fe987261406f…`

> KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.
> 1. Písemnosti podle § 334 zákoníku práce (zejména výpověď, okamžité zrušení pracovního poměru, zrušení ve zkušební době, odvolání z vedoucího pracovního místa a mzdový výměr) vám zaměstnavatel doručuje do vlastních rukou. Elektronicky vám je smí doručovat pouze s vaším souhlasem uděleným v samostatném písemném prohlášení, ve kterém uvedete elektronickou adresu, jež není v dispozici zaměstnavatele.
> 2. Souhlas je dobrovolný. Pokud jej neudělíte, budou vám písemnosti doručovány osobně na pracovišti, v bytě nebo kdekoli budete zastižen(a), případně prostřednictvím provozovatele poštovních služeb. Neudělení souhlasu pro vás nemá žádné nepříznivé následky.
> 3. Elektronicky doručovaná písemnost musí být podepsána uznávaným elektronickým podpisem a musíte ji mít možnost uložit a vytisknout.
> 4. Písemnost je doručena dnem, kdy převzetí potvrdíte datovou zprávou nebo písemně. Nepotvrdíte-li převzetí do 15 dnů ode dne, kdy vám byla dodána na vaši elektronickou adresu, považuje se 15. dnem za doručenou. Vrátí-li se písemnost jako nedoručitelná, doručení je neúčinné.
> 5. Souhlas můžete kdykoli písemně odvolat; odvolání je účinné dnem, kdy jej zaměstnavatel obdrží. Změnu elektronické adresy je třeba oznámit; souhlas se vztahuje pouze k adrese v něm uvedené.

### T3 · Souhlas s doručováním písemností elektronicky (§ 335 zákoníku práce) (v1)

Klíč `S335_CONSENT` · otisk SHA-256 `f565532e69113e60…`

> KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.
> Na základě poučení, které mi bylo poskytnuto před udělením tohoto souhlasu (verze poučení je uvedena v tomto prohlášení), souhlasím s tím, aby mi zaměstnavatel Stenger Czech s.r.o., IČO 28501381, doručoval písemnosti podle § 334 zákoníku práce elektronicky na moji elektronickou adresu uvedenou v tomto prohlášení, která není v dispozici zaměstnavatele.
> Souhlas uděluji dobrovolně. Beru na vědomí, že jej mohu kdykoli písemně odvolat a že bez něj se mi písemnosti doručují osobně nebo prostřednictvím provozovatele poštovních služeb.

### T4 · Odvolání souhlasu s doručováním písemností elektronicky (§ 335 zákoníku práce) (v1)

Klíč `S335_REVOCATION` · otisk SHA-256 `2a5b213c4bbd6760…`

> KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.
> Odvolávám svůj souhlas s doručováním písemností zaměstnavatele Stenger Czech s.r.o., IČO 28501381, prostřednictvím sítě nebo služby elektronických komunikací na elektronickou adresu uvedenou v tomto odvolání (§ 335 zákoníku práce).
> Beru na vědomí, že odvolání je účinné dnem, kdy je zaměstnavatel obdrží. Písemnosti odeslané přede dnem účinnosti odvolání se doručují podle dosavadního souhlasu.

### T5 · Potvrzení o převzetí písemnosti (v1)

Klíč `RECEIPT_CONFIRMATION` · otisk SHA-256 `6c26ae8a0f8d9da4…`

> KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.
> Potvrzuji, že jsem dne uvedeného níže převzal(a) od zaměstnavatele Stenger Czech s.r.o., IČO 28501381, písemnost uvedenou v tomto potvrzení (vyhotovení s otiskem SHA-256 uvedeným níže).
> Podpisem potvrzuji pouze převzetí písemnosti, nikoli souhlas s jejím obsahem.

### T6 · Projev vůle – smlouva (v1)

Klíč `INTENT_BILATERAL_CONTRACT` · otisk SHA-256 `e857350efcfde4e3…`

> KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU. Seznámil/a jsem se s celým obsahem a uzavírám tuto smlouvu.

### T7 · Projev vůle – prohlášení zaměstnance (v1)

Klíč `INTENT_EMPLOYEE_DECLARATION` · otisk SHA-256 `851dc5af180c209f…`

> KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU. Činím toto prohlášení.

### T8 · Projev vůle – za zaměstnavatele (v1)

Klíč `INTENT_EMPLOYER_SIGNATURE` · otisk SHA-256 `7372e03d15e675ac…`

> KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU. Seznámil/a jsem se s celým obsahem dokumentu a podepisuji jej za zaměstnavatele Stenger Czech s.r.o. na základě plné moci.

### T9 · Projev vůle – převzetí (v1)

Klíč `INTENT_RECEIPT_ACKNOWLEDGEMENT` · otisk SHA-256 `72ba8c6f9930432c…`

> KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU. Potvrzuji převzetí dokumentu. Tímto podpisem nevyjadřuji souhlas s jeho obsahem.

### T10 · Projev vůle – záznam o školení (v1)

Klíč `INTENT_TRAINING_RECORD` · otisk SHA-256 `7aebc270966ee390…`

> KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU. Potvrzuji absolvování školení uvedeného v tomto záznamu a ověření svých znalostí ve dni uvedeném v záznamu.

### T11 · Prohlášení k osobnímu dotazníku (v1)

Klíč `INTENT_QUESTIONNAIRE` · otisk SHA-256 `02fa4e93ea9220b4…`

> KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU. Prohlašuji, že všechny údaje uvedené v tomto osobním dotazníku jsou pravdivé a úplné, a zavazuji se oznámit jejich změny bez zbytečného odkladu.

## 3. Texty e-mailů

Odesílá je systém s podepsaným PDF v příloze. ‹…› se doplňuje automaticky.

### E1 · Zaslání smlouvy uzavřené elektronicky (§ 21)

**Předmět:** ‹název dokumentu› – vyhotovení smlouvy uzavřené elektronicky

> Dobrý den,
>
> zasíláme Vám vyhotovení dokumentu „‹název dokumentu›“ uzavřeného elektronicky, na adresu, kterou jste nám k tomuto účelu písemně oznámil(a) (§ 21 zákoníku práce). Dokument je v příloze ve formátu PDF – uložte si jej a případně vytiskněte.
>
> Od smlouvy můžete písemně odstoupit do 7 dnů ode dne jejího dodání na tuto adresu, nejpozději však do doby, než začnete plnit.
>
> (Text: KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.)

### E2 · Doručení písemnosti se souhlasem (§ 335)

**Předmět:** ‹název dokumentu› – doručení písemnosti (§ 335 zákoníku práce)

> Dobrý den,
>
> na základě Vašeho souhlasu s elektronickým doručováním Vám doručujeme písemnost „‹název dokumentu›“. Dokument je v příloze ve formátu PDF – uložte si jej a případně vytiskněte.
>
> Prosíme, potvrďte převzetí odpovědí na tento e-mail. Nepotvrdíte-li převzetí do 15 dnů od dodání zprávy, považuje se písemnost za doručenou posledním dnem této lhůty.
>
> (Text: KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.)

### E3 · Mzdový výměr na jinou adresu (§ 335 odst. 3)

**Předmět:** ‹název dokumentu› – prosíme o potvrzení převzetí

> Dobrý den,
>
> zasíláme Vám mzdový výměr (odesláno ‹datum›). Dokument je v příloze ve formátu PDF – uložte si jej a případně vytiskněte.
>
> Prosíme o písemné potvrzení převzetí (odpovědí na tento e-mail). Bez potvrzení do 15 dnů od odeslání je doručení neúčinné a výměr Vám předáme osobně.
>
> (Text: KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.)

## 4. Vnitřní pokyn pro personální oddělení – podpis na tabletu

Celé znění (P1):

> **KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU** · verze 0.1 · 23. 10. 2026
>
> Platí pro personální oddělení při podpisu dokumentů zaměstnancem na tabletu (Stenger ONE → Personalistika → detail dokumentu → „Podepsat na tabletu“).
>
> ## 1. Podpis jen při osobní přítomnosti
> - Zaměstnanec podepisuje **jen osobně v kanceláři**, před pracovníkem personálního oddělení.
> - Podpis na dálku (doma, z vlastního telefonu bez vaší přítomnosti) **není dovolen** – systém ho ani neumožňuje.
>
> ## 2. Ověření totožnosti
> - Před vydáním odkazu ověřte totožnost **podle originálu dokladu** (občanský průkaz, pas, povolení k pobytu). Kopie ani fotografie dokladu nestačí.
> - V systému zvolte typ dokladu a potvrďte ověření. Číslo dokladu se neukládá.
> - Jméno na dokladu musí odpovídat jménu v dokumentu. Při nesouladu nepodepisujte a věc vyřešte (oprava karty, nová verze dokumentu).
>
> ## 3. QR kód a jednorázový kód
> - QR kód a šestimístný kód se zobrazí **jen na vaší obrazovce**. Zaměstnanec načte QR kód tabletem a opíše kód.
> - **Odkaz ani kód nikomu neposílejte** – ani e-mailem, ani SMS, chatem nebo fotografií. Nefoťte obrazovku.
> - Odkaz platí 10 minut, po 3 chybných kódech se zruší. Pokud se odhlásíte, odkaz přestane platit.
> - Po podpisu nebo při přerušení zavřete okno s QR kódem.
>
> ## 4. Průběh podpisu
> - Zaměstnanec si musí na tabletu projít **celý dokument** (všechny strany), teprve pak může podepsat.
> - Nepomáhejte s podpisem a neovládejte tablet za zaměstnance (kromě technické pomoci na jeho žádost).
> - Na dotazy k obsahu odpovězte; zaměstnanec má právo podpis odmítnout nebo odložit.
>
> ## 5. Po podpisu
> - U smlouvy podepsané elektronicky systém sám odešle podepsaný originál na e-mail oznámený podle § 21. Zkontrolujte v detailu dokumentu stav odeslání; při chybě předejte vyhotovení osobně.
> - Při jakékoli pochybnosti (podezření na cizí osobu, technická chyba, nátlak) podpis nedokončujte a informujte vedoucí personálního oddělení.

## 5. Pravidla a lhůty nastavené v systému (ke kontrole)

| Situace | Jak to systém počítá |
|---|---|
| § 21 – lhůta k odstoupení | 7 dnů od **dodání** do schránky (doklad poskytovatele e-mailů nebo potvrzení zaměstnance), nejpozději do nástupu. Bez dokladu o dodání: „lhůta neurčena – právo na odstoupení zaniká nástupem do práce“. Odstoupení se zaznamená se skenem; po lhůtě ho systém odmítne. |
| § 21 – podpis na tabletu při osobním setkání | Konzervativně jako uzavření elektronicky: vždy zaslat vyhotovení a sledovat lhůtu (otázka 1). |
| § 335 se souhlasem | Doručeno potvrzením zaměstnance; jinak fikce **15. den od dodání** do schránky. Bez dokladu o dodání fikce **nikdy** neběží (samotné odeslání nestačí). Vrácená zpráva = neúčinné. |
| § 335 odst. 3 – mzdový výměr na jinou adresu | Jen písemné potvrzení převzetí (sken nebo uložená odpověď e-mailem, otázka 8). Bez potvrzení do **15 dnů od odeslání** = neúčinné; HR je upozorněno 10. den a výměr předá osobně. |
| Písemnost § 334 osobně | Jen proti podpisu potvrzení o převzetí (sken nebo podpis na tabletu). |
| Selhání odeslání | Nejvýše 3 pokusy, pak osobní předání. Po změně e-mailu se zásilka na starou adresu neopakuje. |
| Odvolání souhlasu § 335 | Platí od zaznamenání; nové zásilky podle § 335 jsou zablokované, už odeslané se nemění. |

## 6. Otázky

V závorce je, jak se systém chová do Vaší odpovědi (konzervativně).

1. **§ 21 a podpis na tabletu zaměstnavatele při osobním setkání.** Jde o „uzavření prostřednictvím sítě nebo služby elektronických komunikací“? *(Ano – vždy zasíláme vyhotovení na adresu dle § 21 a sledujeme 7denní lhůtu.)*
2. **Druh podpisu zaměstnavatele u smluv dle § 21.** Stačí obrázek podpisu osoby s plnou mocí + důkazní záznam, nebo doporučujete uznávaný podpis / pečeť? *(Prostý elektronický podpis + důkazy; uznávaný podpis volitelně.)*
3. **Oznámení § 21 a souhlas § 335 před vznikem pracovního poměru.** Platí prohlášení podepsaná v kiosku při nástupu (před podpisem smlouvy), nebo je nutné je potvrdit po uzavření smlouvy? *(Platí, při schválení dotazníku se přenesou na zaměstnance beze změny.)*
4. **Texty.** Schválení nebo úprava textů T1–T11, E1–E3 a pokynu P1. *(Koncepty se používají jen v testovacím prostředí.)*
5. **Novela zákoníku práce 2025.** Vyžaduje elektronické uzavírání smluv výslovný souhlas zaměstnance? (Nemáme ověřeno v primárním zdroji.) *(Elektronické uzavírání smluv je vypnuté.)*
6. **Lhůty uchovávání.** Jak dlouho uchovávat smlouvy, mzdové výměry, osobní dotazník, záznamy o školení BOZP, doklady o doručení, obrázky podpisů a důkazní záznamy? *(Nic se nemaže; anonymizace po skončení poměru se připraví až podle Vaší odpovědi.)*
7. **Trvalé mazání.** Je přípustné smazat záznam označený jako testovací/duplicitní, i když obsahuje podepsané dokumenty? *(Jen u označení TEST/DUPLICITA, s důvodem v auditu, jen administrátor.)*
8. **Mzdový výměr – písemné potvrzení převzetí (§ 335 odst. 3).** Splňuje odpověď zaměstnance e-mailem (uložená jako .eml/PDF, neměnná, s otiskem) požadavek písemného potvrzení, nebo je nutné podepsané potvrzení? *(Systém přijme obojí, druh důkazu je zaznamenán; rozhoduje HR.)*
9. **Kiosk – odemykání personálním oddělením.** Je nutné, aby tablet s dotazníkem odemykal HR (aby dotazník nevyplnila cizí osoba)? *(Vypnuto, připraveno.)*
10. **Lhůta k odstoupení bez dokladu o dodání.** Je výklad „lhůta neurčena – právo zaniká nástupem do práce“ správný, když poskytovatel e-mailů dodání nepotvrdí? *(Ano, zobrazujeme tak.)*
11. **Vnitřní pokyn P1.** Schválení pokynu pro HR k podpisu na tabletu. *(—)*
12. **Odvolání souhlasu – účinnost.** Text T4 uvádí, že odvolání je účinné dnem, kdy je zaměstnavatel obdrží. Souhlasíte? *(Blokujeme nové zásilky od zaznamenání odvolání.)*
13. **Potvrzení o převzetí u papírově podepsaných dokumentů.** Otisk v potvrzení odkazuje na vytištěné finální PDF (u elektronického podpisu na podepsaný originál). Je to dostatečná identifikace písemnosti? *(Ano.)*
14. **Ověření certifikátu uznávaného podpisu.** Navrhujeme ruční ověření ve veřejné ověřovací službě s uložením protokolu. Můžeme do takové služby nahrát mzdové PDF (GDPR), případně kterou službu doporučujete? *(Elektronické doručení § 334 až po ověření certifikátu.)*

## 7. Otázky z auditu personalistiky (GDPR a kontrolní mechanismy)

Vyplývají z interního auditu (`docs/audit/`). Jde o pracovní hodnocení, ne o závěry.

- **Q-A1 · Nepřítomnosti jako údaj o zdraví.** Je rozlišení druhu nepřítomnosti (PN – nemoc / úraz / pracovní úraz, OČR) údajem o zdraví podle čl. 9 GDPR? Kdo ve firmě jej smí vidět (personalista, účetní, nadřízený)? Návrh: běžně jen „nepřítomen“.
- **Q-A2 · Lhůty uchovávání (doplňuje otázku 6).** Jaké lhůty platí pro:
  - osobní spis;
  - mzdové listy a podklady pro ČSSZ/ZP;
  - daňová prohlášení a doklady k dětem;
  - lékařské posudky;
  - doklady k exekucím;
  - zamítnuté nebo nepřevzaté dotazníky uchazečů z kiosku;
  - auditní log;
  - důkazy o podpisu (obrázek podpisu, údaje zařízení)?

  Systém žádné lhůty nemá a hodnoty nebudeme odhadovat.
- **Q-A3 · Auditní log po výmazu.** Smí auditní log uchovávat úplné kopie citlivých údajů i po výmazu nebo anonymizaci zaměstnance? Jak dlouho? Postačí maskování (jen které pole se změnilo)?
- **Q-A4 · Need-to-know.** Má personalista vidět mzdový výměr, údaje o dětech a zdravotní omezení, pokud je pro svou práci nepotřebuje? Nebo má být mzdová vrstva jen u jednatele a účetní?
- **Q-A5 · DPIA.** Je nutné posouzení vlivu (čl. 35) pro podpis na tabletu, uchovávání obrázků podpisu a údajů o zařízení, popř. pro záznam přístupů k citlivým údajům?
- **Q-A6 · Externí účetní.** Je zpracovatelem (smlouva podle čl. 28), nebo samostatným správcem? V jakém rozsahu jí smíme zpřístupnit údaje?
- **Q-A7 · E-mail.** Je přípustné posílat smlouvy a mzdové výměry jako nešifrovanou přílohu na soukromý e-mail (i při § 21 / § 335 ZP)? Je šifrování (heslo k PDF) nutné, nebo jen vhodné?
- **Q-A8 · Kiosk a uchazeči.** Které informace podle čl. 13 musí uchazeč dostat před vyplněním dotazníku? Smí dotazník sbírat rodná čísla dětí, zdravotní omezení a daňové údaje už před uzavřením pracovního poměru?
- **Q-A9 · Přenos mimo EU a nový server.** Stačí standardní smlouvy o zpracování u poskytovatelů (databáze, hosting, e-mail)? Co musí obsahovat smlouva se správcem vlastního serveru?
- **Q-A10 · Porušení zabezpečení.** Kdo rozhoduje o ohlášení ÚOOÚ a v jaké lhůtě? Kdy se informují zaměstnanci? Prosíme o šablonu záznamu incidentu.
- **Q-A11 · MFA.** Je dvoufaktorové přihlášení pro uživatele s přístupem k HR údajům „vhodným technickým opatřením“ podle čl. 32, které bychom měli zavést povinně?
- **Q-A12 · Záznam přístupů.** Smíme zaznamenávat, kdo a kdy si prohlížel rodné číslo, mzdu nebo zdravotní údaje zaměstnance? Jak dlouho takový záznam uchovávat? Je třeba o něm informovat uživatele HR?
- **Q-A13 · Podpis za zaměstnavatele.** Které dokumenty smí personalista s plnou mocí podepsat sám a které by měl podepisovat jednatel? Například výpověď, dohoda o rozvázání, okamžité zrušení, zrušení ve zkušební době, změna mzdy. Je vhodné to promítnout do textu plné moci?
- **Q-A14 · Šablony a revize.** Doporučujete interval pravidelné revize šablon a textů (např. pololetně a k 1. 1.)? Jakou formou chcete potvrzovat „právně ověřeno k datu“?
- **Q-A15 · Kopie plné moci u dokumentů (KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU).** Za zaměstnavatele podepisují zmocněnci na základě plné moci jednatele. Systém nově připojí ke každému dokumentu, který zmocněnec podepisuje, jako poslední stranu **kopii plné moci se začerněným datem narození a bydlištěm zmocněnců** (originál zůstává ve firmě). Na papíře se tiskne celý dokument i s touto stranou, elektronicky ji pokrývá podpis i otisk (hash). Prosíme o potvrzení: (a) je přiložení kopie vhodné či nutné, nebo stačí odkaz ve smlouvě a předložení na požádání; (b) je začerněná kopie dostatečná; (c) máme do šablon doplnit větu „Kopie plné moci ze dne 1. 7. 2025 tvoří přílohu této smlouvy.“; (d) platí totéž pro DPP/DPČ, dodatky, mzdové výměry a výpovědi.

Děkujeme. Odpovědi stačí poslat s čísly textů (T, E, P) a otázek.
