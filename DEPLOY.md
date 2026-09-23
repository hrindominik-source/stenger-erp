# Nasazeni pres Docker (VPS / vlastni HW)

Appka je cista klientska SPA (Vite + React) - kontejner ji jen builduje a
servuje jako staticke soubory pres nginx, zadny Node.js v produkci nebezi.

## Oddelene DB pro produkci a vyvoj

Produkce a develop pouzivaji **dva oddelene Supabase projekty** (stejny
princip jako uz existujici staging/produkce pouzivane pro GitHub Pages
deploy) - zadna sdilena databaze mezi prostredimi. Protoze Vite zapeka
`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` uz behem `npm run build`, kazde
prostredi ma **svuj vlastni Docker image** (ne jeden image s promennymi
menenymi az pri startu kontejneru).

## Prvni nastaveni na serveru

1. Nainstalovat Docker + Docker Compose plugin.
2. Naklonovat repozitar.
3. Vytvorit dva env soubory (nejsou v gitu, obsahuji tajemstvi):
   ```
   cp .env.production.example .env.production
   cp .env.development.example .env.development
   ```
   a doplnit do nich realne `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
   z prislusneho Supabase projektu (Project Settings -> API v Supabase
   dashboardu). **Nikdy nepouzivat stejny projekt v obou souborech.**

## Spusteni

```bash
# Produkce (port 8080)
docker compose -f docker-compose.production.yml --env-file .env.production up -d --build

# Vyvoj/staging (port 8081)
docker compose -f docker-compose.development.yml --env-file .env.development up -d --build
```

Oba kontejnery mohou bezet soucasne na stejnem stroji (ruzne porty).

## Nasazeni nove verze kodu

`git pull` novy kod a **znovu spustit stejny prikaz s `--build`** - bez
rebuildu se nova verze neprojevi, protoze JS bundle uz je jednou zabuildeny
a nemeni se za behu kontejneru:

```bash
git pull
docker compose -f docker-compose.production.yml --env-file .env.production up -d --build
```

## Pripojeni domeny / HTTPS

Kontejnery samy o sobe servuji jen cisty HTTP na portu 80 uvnitr (namapovanem
na 8080/8081 navenek). Pro verejnou domenu a TLS certifikat doporucuji
reverzni proxy (napr. Caddy nebo nginx s certbot / Traefik) pred temito
kontejnery - to zde zamerne neni soucasti tohoto setupu, protoze zavisi na
konkretni domene a DNS, ktere je potreba nastavit rucne.

## Poznamka k testovani

Docker neni dostupny v tomto vyvojovem prostredi, takze samotny `docker
build` nebyl overen zde primo - overte prosim prvni build na serveru/VPS a
dejte vedet, pokud build selze (ktery krok, jaka chybova hlaska).
