# Objednavky Stenger Czech - mini ERP

Lokalna verzia, zhodna s appkou vyvijanou v Claude.ai chate (vratane vsetkych
dnesnych oprav: presne 1:1 paletovy listok, spravne cislovanie, vlastne
potvrdzovacie okna namiesto blokovanych prehliadacovych dialogov,
porovnanie formulara s povodnym PDF, farebne rozlisenie riadkov a i.).

## Prve spustenie

1. Nainstalujte [Node.js](https://nodejs.org) (LTS verzia), ak ho este nemate.
2. V tomto priecinku spustite v termináli:

   ```
   npm install
   npm run dev
   ```

3. Otvorte v prehliadaci adresu, ktoru vypise terminal (zvycajne `http://localhost:5173`).

## AI extrakcia z PDF (nepovinne)

Aby fungovalo automaticke vytiahnutie udajov z nahranej PDF objednavky,
potrebujete vlastny Anthropic API kluc:

1. Zalozte si ho na [console.anthropic.com](https://console.anthropic.com) (zalozka API Keys).
   Je to samostatna platba od Claude Pro/Code predplatneho (ale spracovanie
   objednavok stoji len halierove sumy za kazde spracovanie).
2. Vlozte ho v appke do "Nastavenia firmy" -> "Anthropic API kluc".
3. Kluc sa uklada len lokalne vo vasom prehliadaci, nikam inam sa neposiela.

Bez kluca appka funguje normalne, len tlacidlo "Spracovat udaje" (AI extrakcia)
vrati chybu - objednavku vtedy zadate rucne cez formular.

## Data

Vsetky data (register objednavok, dopravcovia, zakaznici, nastavenia firmy)
sa ukladaju lokalne v prehliadaci (localStorage). Ak vymazete udaje
prehliadaca alebo pouzijete iny prehliadac/pocitac, data tam nebudu.

## Dalsi vyvoj v Claude Code

Odteraz mozete v Claude Code pisat rovnako ako v chate ("pridaj pole X",
"toto mi nefunguje") - Claude Code uvidi skutocne chyby v konzole a appku
naozaj spustenu, takze bude vediet ladit rychlejsie a presnejsie.

