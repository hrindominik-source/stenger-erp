# Sledovanie legislatívy (balík H)

Stav 2026-10-29. Migrácia 74, edge funkcia `hr-legislativa`, sekcia „Revize a změny zákoníku práce“ v „Pro jednatele“.

## 1. Revízie (hotové)

- **Polročná revízia k 1. 1. a 1. 7.:** šablóny, právne texty a zákonné parametre.
  - Pripomienka začína 30 dní pred termínom a trvá, kým ju jednatel nepotvrdí s poznámkou, čo skontroloval.
  - Potvrdenie ide do auditu.
- **Revízia šablóny a textu** k ich dátumu `next_review_date` (zadáva sa pri schválení), 30 dní vopred.
  - Pripomienka zmizne, keď jednatel pri schválení zadá nový termín.
- **Upozornenia:** `hr_revision_notify` je idempotentná.
  - Spúšťa ju otvorenie prehľadu jednatela.
  - Na vlastnom serveri ju má spúšťať denný plánovač cez `hr-legislativa` (cron, `Authorization: Bearer <service role>`), aby pripomienka prišla aj bez otvorenia aplikácie. pg_cron v projekte nie je.

## 2. Zmeny zákona č. 262/2006 Sb. v e-Sbírke – návrh

**Dá sa to spoľahlivo?** Z tohto prostredia som to neoveril. Preto je strážca pripravený, ale **vypnutý a bez zdroja**.

Čo som zistil:
- Web e-Sbírky (`e-sbirka.gov.cz/sb/2006/262`) je aplikácia v prehliadači (SPA). Bežné stiahnutie stránky nevráti obsah, z ktorého by sa dali zistiť novely.
- e-Sbírka podľa MV ponúka otvorené dáta a API. Podľa článku na Lupa.cz (2024) však otvorené dáta neboli zdokumentované ani evidované v NKOD. Podmienky prístupu k API (registrácia, kľúč) som neoveril.
- Zdroje:
  - [MV – spustenie e-Sbírky](https://mv.gov.cz/bsmv/clanek/ministerstvo-vnitra-spustilo-elektronickou-sbirku-zakonu-a-mezinarodnich-smluv.aspx)
  - [Lupa.cz – e-Sbírka ukazuje, jak neotevírat data](https://www.lupa.cz/clanky/e-sbirka-ukazuje-jak-neotevirat-data/)

**Odporúčanie:**
1. IT overí oficiálne strojovo čitateľné rozhranie e-Sbírky, ideálne zoznam znení alebo noviel predpisu 262/2006 Sb. ako JSON, a podmienky jeho použitia.
2. Adresu zadá jednatel v „Nastavit zdroj“. Povolené sú len `https://` adresy na `e-sbirka.gov.cz` alebo `e-sbirka.cz`, kontroluje to DB.
3. Plánovač na vlastnom serveri raz denne zavolá `hr-legislativa` (`check`).
4. Pri zmene odtlačku zdroja dostane jednatel upozornenie „Možná změna … zkontrolujte s právničkou“. **Nič sa nemení automaticky.**

## 3. Obmedzenia

- **Odtlačok nerozlíši, čo sa zmenilo.**
  - Zmenu v novele, v metadátach aj vo formáte zdroja hlási rovnako.
  - Ak zdroj obsahuje meniace sa údaje (čas vygenerovania, počítadlá), budú chodiť falošné upozornenia. Preto treba zdroj so stabilným obsahom (zoznam znení/noviel).
  - JSON sa porovnáva v kanonickom tvare, takže na poradí kľúčov nezáleží.
- **Novela sa objaví až po jej publikovaní a spracovaní v e-Sbírke.**
  - Rozhoduje dátum účinnosti, nie publikácie.
  - Pripomienka k 1. 1. a 1. 7. ostáva hlavná poistka.
- **Sleduje sa len zákonník práce.**
  - Nesleduje sa nariadenie vlády o minimálnej mzde, zákony o dani, poistnom a ďalšie.
  - Zákonné parametre (balík D) preto treba kontrolovať pri polročnej revízii.
- **Pri zmene alebo nedostupnosti rozhrania e-Sbírky** kontrola zlyhá. Po 3 chybách za sebou príde upozornenie (najviac raz denne). Chyba neprepíše posledný známy odtlačok.
- **Po nastavení nového zdroja** sa prvý odtlačok len uloží. Upozornenia prídu až pri ďalšej zmene.
- **Presmerovania sa nenasledujú**, aby sa nedalo dostať mimo e-Sbírku. Zadať treba konečnú adresu.
- **Posúdenie, či novela mení šablóny, texty alebo parametre, je vždy na právničke.** Systém právne závery nerobí.
