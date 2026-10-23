# Otázky pre používateľa (podpisy a doručovanie)

Otázky, pri ktorých som zvolil bezpečnejšiu možnosť a pokračoval. Odpovedzte, keď sa vám hodí.

| Dátum | Otázka | Čo som zvolil |
|---|---|---|
| 2026-10-23 | Testovacia plná moc „Mgr. Jana Zkušební“ (hr.admin) nemá nahratý sken plnej moci. Podpis za zamestnávateľa ho dnes nevyžaduje. Má byť sken povinný pred prvým podpisom? | Nič som nemenil; podpis funguje bez skenu ako doteraz. |
| 2026-10-23 | Server (service_role) môže zneplatniť podpísané vyhlásenie (len s dôvodom ≥ 10 znakov). Žiadna serverová funkcia to dnes nerobí. Zakázať úplne? | Ponechané; dôvod je povinný. |
| 2026-10-23 | Commit sa v povoleniach nedá obmedziť na vetvu – `git commit` je povolený všade, push len `origin feature/podpisy-dorucovani`. | Push na iné vetvy si vypýta súhlas; do main a force push je zakázaný. |
