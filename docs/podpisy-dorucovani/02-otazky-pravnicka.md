# Otázky pre právničku (priebežný zoznam)

Stav: KONCEPT. Do odpovedí sa správanie systému drží konzervatívne (v zátvorke).

1. **§ 21 ZP – podpis na tablete zamestnávateľa pri osobnom stretnutí.** Je to „uzavření prostřednictvím sítě nebo služby elektronických komunikací“? (Predvolene áno: vždy zaslať vyhotovenie na § 21 adresu a sledovať 7-dňovú lehotu – `hr_settings.s21_tablet_in_person_conservative = true`.)
2. **Typ elektronického podpisu zamestnávateľa pri zmluvách podľa § 21.** Stačí obrázok podpisu + dôkazný záznam, alebo odporúčate uznávaný podpis / pečať? (Predvolene: jednoduchý podpis + dôkazy; PAdES pečať voliteľne.)
3. **Zber § 21 oznámenia a § 335 súhlasu pred vznikom pomeru** (v kiosku pred založením zamestnanca) – je platný, alebo ho treba potvrdiť po uzavretí zmluvy? (Predvolene: zbierať v kiosku, pri schválení preniesť na zamestnanca bez zmeny.)
4. **Texty** – schváliť: oznámenie adresy (§ 21), poučenie (§ 335 odst. 1), súhlas (§ 335), odvolanie súhlasu, potvrdenie prevzatia, prejavy vôle pri podpise (zmluva / prevzatie / školenie / prohlášení). Všetky sú zatiaľ `KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU`.
5. **Novela 2025** – overiť, či elektronické uzatváranie zmlúv po novom vyžaduje výslovný súhlas zamestnanca (neoverené v primárnom zdroji).
6. **Lehoty uchovávania** jednotlivých typov dokumentov (zmluvy, mzdové výmery, osobný dotazník, záznamy o školení BOZP, doklady o doručení, obrázky podpisov a dôkazné záznamy) – podklad pre anonymizáciu po skončení pomeru.
7. **Trvalé mazanie** – je prípustné aj pri záznamoch označených ako testovacie/duplicitné, ak obsahujú podpísané dokumenty? (Predvolene: áno len pri označení `TEST`/`DUPLICATE`, s dôvodom v audite.)
8. **Mzdový výmer (§ 335 odst. 3)** – postačí ako „písemné potvrzení převzetí“ odpoveď zamestnanca e-mailom, alebo len podpísané potvrdenie? (Predvolene: dôvod `EMPLOYEE_CONFIRMATION` s uloženým dôkazom, rozhoduje HR.)
9. **Kiosk** – je potrebné, aby zariadenie odomykal HR (prevencia vyplnenia dotazníka cudzou osobou)? (Predvolene vypnuté, pripravené za feature flagom.)
