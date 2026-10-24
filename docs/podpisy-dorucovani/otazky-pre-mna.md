# Otázky pre používateľa (podpisy a doručovanie)

Otázky, pri ktorých som zvolil bezpečnejšiu možnosť a pokračoval. Odpovedzte, keď sa vám hodí.

| Dátum | Otázka | Čo som zvolil |
|---|---|---|
| 2026-10-23 | Testovacia plná moc „Mgr. Jana Zkušební“ (hr.admin) nemá nahratý sken plnej moci. Podpis za zamestnávateľa ho dnes nevyžaduje. Má byť sken povinný pred prvým podpisom? | Nič som nemenil; podpis funguje bez skenu ako doteraz. |
| 2026-10-23 | Server (service_role) môže zneplatniť podpísané vyhlásenie (len s dôvodom ≥ 10 znakov). Žiadna serverová funkcia to dnes nerobí. Zakázať úplne? | Ponechané; dôvod je povinný. |
| 2026-10-23 | Commit sa v povoleniach nedá obmedziť na vetvu – `git commit` je povolený všade, push len `origin feature/podpisy-dorucovani`. | Push na iné vetvy si vypýta súhlas; do main a force push je zakázaný. |
| 2026-10-24 | Migrácia 62: Plán směn je v aplikácii dostupný **bez prihlásenia** (App.jsx ho vykreslí pred prihlásením) a volá `plan_smien_*` PIN funkcie a číta `workers` (RLS volá `current_role()`). Zadanie bolo ponechať anon len kiosk. Má Plán směn ostať verejný? | Ponechané pre anon (`plan_smien_*`, `current_role`), inak by Plán směn prestal fungovať. Ak má byť len po prihlásení, treba zmeniť aj App.jsx. |
| 2026-10-24 | Po migrácii 62 dostane anonymné čítanie HR tabuliek a súborov v úložisku chybu „permission denied“ (RLS politiky volajú `hr_has_permission`), nie prázdny výsledok. Verejná časť tieto tabuľky nečíta. | Ponechané (bezpečnejšie – funkcie anon nevrátil); pgTAP testy berú zamietnutie ako „nevidí nič“. |
| 2026-10-24 | Samostatnú aplikáciu Dochádzka (Desktop) som nemohol prečítať (mimo povolených priečinkov). Predpokladám, že nepoužíva Stenger DB ako anon – `dochadzka_*` v Stengeri volajú len prihlásené Sklad / Výroba. | Anon odobraté; ak ju používa, treba doplniť povolenie. |
