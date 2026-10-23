# Ručný test kiosku (vstupný dotazník) bez tabletu

Všetko beží **lokálne** (lokálny Supabase v Dockeri, vymyslené údaje). Produkcia ani staging sa nepoužívajú.

## 1. Spustenie na PC

V PowerShelli v priečinku `stenger-erp-hr`:

```powershell
# Docker Desktop musí bežať
npx.cmd supabase start          # lokálny Supabase + Edge Functions (hr-kiosk, ...)
npx.cmd supabase db reset       # čistá DB + testovacie účty zo supabase/seed.sql
npm run dev -- --port 5180 --strictPort   # aplikácia (vite) – VŽDY http://localhost:5180
```

- Kiosk: `http://localhost:5180/?kiosk=nastup`
- HR (Personalistika): `http://localhost:5180/`

**Pozor:** na `localhost:5173` a `5174` na tomto PC beží iná aplikácia („Dochádzka – administrácia“). Stenger spúšťajte vždy s `--port 5180 --strictPort` – ak je port obsadený, Vite skončí chybou namiesto tichého prechodu na iný port. Správna stránka má v karte prehliadača titulok **„Stenger ONE“**.
- Lokálne Supabase Studio (DB, nastavenia): `http://127.0.0.1:54323`

`npm run dev` číta `.env.development.local`, ktorý ukazuje na lokálny Supabase (`http://127.0.0.1:54321`).
Na prvý pohľad to overíte tak, že sa v HR dá prihlásiť testovacím účtom; produkčný účet lokálne nefunguje.

### Simulácia tabletu v Chrome
1. Otvorte kiosk, stlačte **F12** a potom **Ctrl+Shift+M** (Toggle device toolbar).
2. Hore vyberte zariadenie, napr. **iPad Air** alebo **iPad Pro**. Režim **Responsive** + šírka 820 tiež stačí.
3. V režime zariadenia Chrome simuluje dotyk: kurzor je krúžok a ťahanie myšou je ťahanie prstom.
   Podpis v podpisovom poli teda skúšate ťahaním myši.
4. Po prepnutí zariadenia stránku obnovte (F5), aby sa načítala s dotykovým režimom.
5. Skúste aj otočenie (ikona rotácie v lište) – na výšku aj na šírku.

## 2. Voliteľne: mobil v tej istej Wi-Fi

1. IP adresa PC v sieti: `ipconfig` → „IPv4 Address“, napr. `192.168.1.50`.
2. Spustite aplikáciu tak, aby počúvala v sieti a volala Supabase na adrese PC (nič sa neukladá do súborov):
   ```powershell
   $env:VITE_SUPABASE_URL = "http://192.168.1.50:54321"
   npm run dev -- --host --port 5180 --strictPort
   ```
   Vite vypíše aj „Network: http://192.168.1.50:5180“.
3. Na mobile otvorte `http://192.168.1.50:5180/?kiosk=nastup`.
4. Windows sa môže opýtať na povolenie vo firewalle (Node.js / Docker) – povoľte **len pre súkromnú sieť**.
5. Bezpečnosť:
   - lokálny Supabase je počas behu dostupný z celej lokálnej siete (port 54321) a používa verejne známe testové kľúče – len doma/v kancelárii na súkromnej Wi-Fi, nie na verejnej;
   - v DB sú iba vymyslené údaje;
   - po teste: `Ctrl+C` v termináli s `npm run dev` a `npx.cmd supabase stop`;
   - premennú `$env:VITE_SUPABASE_URL` zrušíte zatvorením okna PowerShellu.
6. Obmedzenie: cez `http://` (nie https) prehliadač v mobile nepovolí niektoré funkcie (napr. `crypto.randomUUID`) –
   **prílohy (súbory) v dotazníku na mobile nemusia fungovať**. Podpis a dokumenty fungujú. Ak treba,
   v Chrome na Androide: `chrome://flags/#unsafely-treat-insecure-origin-as-secure` → pridať `http://192.168.1.50:5180`.

## 3. Prihlásenie pre HR (lokálne, testovacie)

Účty sú v hlavičke `supabase/seed.sql` (meno aj heslo):
- `personalista@test.local` – bežný personalista (zobrazenie, úpravy, generovanie a podpis dokumentov),
- `hr.admin@test.local` – HR_ADMIN (všetko vrátane trvalého mazania).

Platia len pre lokálnu DB po `db reset`.

## 4. Zapnutie § 335 (predvolene vypnutý)

V Studiu `http://127.0.0.1:54323` → SQL Editor:
```sql
update public.hr_settings set value = 'true' where key = 's335_consent_enabled';   -- zapnúť
update public.hr_settings set value = 'false' where key = 's335_consent_enabled';  -- vypnúť
```
Po zmene otvorte kiosk znova (nový dotazník).

## 5. Kontrolný zoznam

Každý scenár = nový dotazník (na konci „Začít nový dotazník“ alebo F5).

**A. Bez e-mailu**
- [ ] „Bydliště a kontakt“: bez e-mailu a bez zaškrtnutia „Nemám…“ → „Další“ ukáže chybu.
- [ ] Zaškrtnúť „Nemám / nechci uvést soukromý e-mail“ → dá sa pokračovať.
- [ ] „Elektronická komunikace“: len informácia, žiadna voľba.
- [ ] „Dokumenty a podpis“: iba **Osobní dotazník**.

**B. S e-mailom a § 21**
- [ ] Zlý formát e-mailu → chyba; nezhodný e-mail pre kontrolu → chyba; vloženie (Ctrl+V) do kontrolného poľa nefunguje.
- [ ] „Elektronická komunikace“: celý text oznámenia s označením KONCEPT, **žiadna voľba nie je predvybraná**, bez voľby nejde pokračovať.
- [ ] Zvoliť „Ano“ → v podpise sú **dva** dokumenty (dotazník + oznámenie § 21).
- [ ] Vrátiť sa a zmeniť e-mail → voľba § 21 sa zruší a treba ju dať znova.

**C. § 335 zapnutý** (pozri bod 4)
- [ ] Blok B je oddelený od bloku A; „Přečetl(a) jsem“ sa dá zaškrtnúť až po posunutí poučenia na koniec.
- [ ] Voľba súhlasu sa zobrazí až po potvrdení poučenia; nie je predvybraná.
- [ ] Pri „Souhlasím“ sú v podpise tri dokumenty; v PDF súhlasu je celé poučenie pred textom súhlasu.

**D. Prehliadanie a podpis**
- [ ] Zobrazia sa všetky strany PDF (dotazník má 8 strán); počítadlo „Zobrazeno X z N“.
- [ ] Kým nie sú zobrazené všetky strany, podpisové pole je sivé a „Podepsat“ neaktívne.
- [ ] Podpis myšou (bez režimu zariadenia) aj ťahaním v simulácii dotyku; „Smazat podpis“ funguje.
- [ ] Po podpise sa podpisové pole vyčistí – každý dokument sa podpisuje znova (podpis sa neprenáša).
- [ ] Po prvom podpise zmizne „Zpět“ a „Raději podepíšu na papíře“.
- [ ] Po podpise všetkých dokumentov → „Odeslat dotazník“ → poďakovanie.

**E. Papierová alternatíva**
- [ ] V kroku podpisu zvoliť „Podepíšu na papíře“ → „Odeslat dotazník“ → poďakovanie s textom o vytlačení.

**F. Schválenie v HR** (prihlásiť sa ako `personalista@test.local`)
- [ ] Personalistika → Nástupy: pri dotazníku z D je „Podepsáno na tabletu: …“, pri E „Podpis na papíře – …“.
- [ ] „Zkontrolovat a založit“ → formulár je predvyplnený; po uložení sa otvorí karta zamestnanca.
- [ ] Karta → Dokumenty: podpísané dokumenty z kiosku sú tam (stav „Podepsáno“, tlačidlo „Podepsaný originál“).
- [ ] Otvoriť „Podepsaný originál“ → posledná strana je dôkazný list (meno, čas, hash, obrázok podpisu).
- [ ] „Zamítnout“ iný dotazník → zmizne zo zoznamu, nič sa nezmaže.

**G. Zmluva – úplný podpis**
- [ ] Vygenerovať pracovnú zmluvu → „Nahrát podepsaný sken“ → zaškrtnúť len Zaměstnanec → uložiť.
- [ ] Stav ukazuje „Čeká na podpis: zaměstnavatel“ (nie „Podepsáno“).
- [ ] Znova „Nahrát podepsaný sken“ so Zaměstnavatelem → stav „Podepsáno“.

**H. Príprava pre podpis na tablete a e-mail** (raz po `db reset`)
- [ ] Studio → SQL Editor: `update public.hr_settings set value = 'true' where key = 'electronic_contract_enabled';`
- [ ] Prihlásiť sa ako `hr.admin@test.local` (je zároveň vymyslená osoba s plnou mocou „Mgr. Jana Zkušební“).
- [ ] Zamestnanec (napr. Eva Ukázková) → Karta: doplniť **soukromý e-mail** (napr. `eva@example.test`) a uložiť.

**I. Podpis zamestnanca cez QR kód a kód (simulácia tabletu)**
- [ ] Dokumenty → „Prohlášení (§ 21 / § 335)“ → „Oznámení elektronické adresy (§ 21)“ → otvorí sa detail dokumentu (PDF vytvoril server).
- [ ] „Podepsat na tabletu“ → druh dokladu (OP) → zaškrtnúť „osobně přítomen…“ → „Připravit podpis“ → zobrazí sa **QR kód a 6-miestny kód**; odkaz nie je nikde ako text.
- [ ] Na PC: F12 → Ctrl+Shift+M (iPad) → „Podepsat na tomto zařízení“. Tablet si vypýta kód:
  - [ ] 2× zlý kód → „Zbývající pokusy“; 3. zlý kód → „podpis byl zrušen“ → v HR „Podepsat na tabletu“ znova;
  - [ ] správny kód → prejsť všetky strany → podpis → „Podepsat“.
- [ ] Voliteľne skutočný tablet/mobil v tej istej Wi-Fi (bod 2): HR otvoriť cez `http://<IP-PC>:5180`, QR kód potom obsahuje adresu PC a dá sa naskenovať. Na mobile zadať kód.
- [ ] Odhlásiť HR počas otvoreného podpisu → tablet odmietne („Pracovník HR … už není přihlášen“).
- [ ] Po podpise: Dokumenty → panel Prohlášení ukazuje platné § 21 oznámenie.

**J. Pracovná zmluva – zamestnanec na tablete, zamestnávateľ, e-mail do Mailpitu**
- [ ] Dokumenty → „Pracovní smlouva“ → podepisuje „Mgr. Jana Zkušební“ → „Vygenerovat a uložit k podpisu“ (vzor je šablóna v1 – v Šablonách je „Pracovní smlouva (vzor Stenger)“).
- [ ] Stiahnuť .docx → otvoriť vo Worde (alebo LibreOffice) → uložiť ako PDF → „Nahrát finální PDF (uložené z Wordu)“ → kontrola servera OK.
- [ ] „Podepsat na tabletu“ (ako v I).
- [ ] „Podepsat za zaměstnavatele“ → prejsť strany → podpis. Stav „Podepsáno“, „Podepsaný originál“ má dôkazný list pre oba podpisy.
- [ ] Mailpit `http://127.0.0.1:54324`: prišiel e-mail „… – vyhotovení smlouvy uzavřené elektronicky“ s PDF v prílohe a textom KONCEPT.
- [ ] Detail dokumentu → doručenie: „Odesláno“ (nie „Doručeno“), lehota: „Lhůta k odstoupení neurčena (chybí doklad o dodání) – … nástupem do práce“.
- [ ] Voliteľne: v Mailpite stiahnuť správu ako `.eml` → v detaile pri zásielke „Zaznamenat písemné potvrzení“ nahrať `.eml` → stav doručené potvrdením, lehota 7 dní.
- [ ] Odhlásiť sa, prihlásiť ako `personalista@test.local` → „Podepsat za zaměstnavatele“ je neaktívne s vysvetlením (nie je osoba s plnou mocou).

**K. Papierový podpis (sken nahrá server)**
- [ ] Iný dokument → „Nahrát podepsaný sken“ → PDF/JPG → označiť strany a mená → potvrdiť zhodu s originálom → uložiť.
- [ ] Súbor iného typu (napr. .txt premenovaný na .pdf) → chyba „Sken musí být PDF, PNG nebo JPG“.

**L. Potvrdenie o prevzatí a vzor zmluvy**
- [ ] Pri podpísanom dokumente „Vytvořit potvrzení o převzetí“ → nový dokument s otlačkom → podpis na tablete alebo papierom.
- [ ] Šablony → „Pracovní smlouva (vzor Stenger)“ v1 je schválená; staré zmluvy (vytvorené pred presunom) sa nezmenili.

Ak niečo nesedí: F12 → Console (červené chyby) a poslať snímku obrazovky + popis kroku.
