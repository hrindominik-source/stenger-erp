# Otázky pre právničku (priebežný zoznam)

Stav: KONCEPT. Do odpovedí sa správanie systému drží konzervatívne (v zátvorke).

1. **§ 21 ZP – podpis na tablete zamestnávateľa pri osobnom stretnutí.** Je to „uzavření prostřednictvím sítě nebo služby elektronických komunikací“? (Predvolene áno: vždy zaslať vyhotovenie na § 21 adresu a sledovať 7-dňovú lehotu – `hr_settings.s21_tablet_in_person_conservative = true`.)
2. **Typ elektronického podpisu zamestnávateľa pri zmluvách podľa § 21.** Stačí obrázok podpisu + dôkazný záznam, alebo odporúčate uznávaný podpis / pečať? (Predvolene: jednoduchý podpis + dôkazy; PAdES pečať voliteľne.)
3. **Zber § 21 oznámenia a § 335 súhlasu pred vznikom pomeru** (v kiosku pred založením zamestnanca) – je platný, alebo ho treba potvrdiť po uzavretí zmluvy? (Predvolene: zbierať v kiosku, pri schválení preniesť na zamestnanca bez zmeny.)
4. **Texty** – schváliť: oznámenie adresy (§ 21), poučenie (§ 335 odst. 1), súhlas (§ 335), odvolanie súhlasu, potvrdenie prevzatia, prejavy vôle pri podpise (zmluva / prevzatie / školenie / prohlášení). Všetky sú zatiaľ `KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU`.
5. **Novela 2025** – overiť, či elektronické uzatváranie zmlúv po novom vyžaduje výslovný súhlas zamestnanca (neoverené v primárnom zdroji).
6. **Lehoty uchovávania** jednotlivých typov dokumentov (zmluvy, mzdové výmery, osobný dotazník, záznamy o školení BOZP, doklady o doručení, obrázky podpisov a dôkazné záznamy) – podklad pre anonymizáciu po skončení pomeru.
7. **Trvalé mazanie** – je prípustné aj pri záznamoch označených ako testovacie/duplicitné, ak obsahujú podpísané dokumenty? (Predvolene: áno len pri označení `TEST`/`DUPLICATE`, s dôvodom v audite.)
8. **Mzdový výměr (§ 335 odst. 3) – písemné potvrzení převzetí.** Splňuje odpověď zaměstnance e-mailem (uložená jako .eml nebo PDF, nemenná, otisk počítá server) požadavek „písemného potvrzení“ podle § 335 odst. 3, nebo je nutné podepsané potvrzení (sken)? (Zatím systém přijímá obojí s důvodem `EMPLOYEE_CONFIRMATION`, druh důkazu `EMAIL_REPLY` / `WRITTEN_SCAN` je v záznamu; rozhoduje HR.)
9. **Kiosk** – je potrebné, aby zariadenie odomykal HR (prevencia vyplnenia dotazníka cudzou osobou)? (Predvolene vypnuté, pripravené za feature flagom.)
10. **Lhůta k odstoupení (§ 21) bez dokladu o dodání.** Když poskytovatel e-mailů nepotvrdí dodání, systém lhůtu nepočítá a ukazuje „lhůta neurčena – právo na odstoupení zaniká nástupem do práce“. Je to správný výklad?
11. **Vnitřní pokyn pro HR k podpisu na tabletu** (`pokyn-hr-podpis-na-tabletu.md`) – schválit text.
12. **Odvolanie súhlasu § 335 – účinnosť** (text `S335_REVOCATION`: „účinné dnem, kdy je zaměstnavatel obdrží“). (Predvolene: nové § 335 zásielky sa blokujú od zaznamenania odvolania.)
13. **Potvrdenie o prevzatí pri papierovom podpise** – otlačok odkazuje na vytlačené finálne PDF (pri elektronickom podpise na podpísaný originál). Stačí ako identifikácia písomnosti?
14. **Verejná overovacia služba pre certifikát** – smie sa do nej nahrať mzdové PDF (GDPR/DPA)? Ktorú odporúčate?

Súhrn pre právničku (texty s verziami a otázky v češtine): `05-pro-pravnicku.md`.
