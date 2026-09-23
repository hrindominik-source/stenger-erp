# Nasazeni na VPS (Hetzner) s automatickym CI/CD

Appka je cista klientska SPA (Vite + React) - kontejner ji jen builduje a
servuje jako staticke soubory pres nginx, zadny Node.js v produkci nebezi.
DB zatim zustava hostovana Supabase (mimo VPS) - VPS tak potrebuje jen
minimalni vykon.

## Oddelene DB pro produkci a vyvoj

Produkce a develop pouzivaji **dva oddelene Supabase projekty** - zadna
sdilena databaze mezi prostredimi. Protoze Vite zapeka
`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` uz behem buildu, kazde
prostredi ma svuj vlastni Docker image.

## Jak to funguje (automaticky deploy)

```
push do main    -> GitHub Actions zbuilduje "production" image
                 -> pushne do ghcr.io/stenger-cz/stenger-erp:production
                 -> SSH na VPS, stahne image, restartuje produkcni kontejner (port 8080)

push do develop -> stejne, ale "development" image -> port 8081
```

Build vzdy probiha v GitHub Actions, ne na VPS - VPS jen `docker compose
pull` + `up -d`. Kazdy build je navic otagovany i commit hashem
(`production-<sha>`), takze rollback na predchozi verzi je jen zmena tagu v
`docker-compose.deploy.production.yml` a rucne `docker compose up -d`.

## Jednorazove nastaveni

### 1. VPS (Hetzner Cloud)

- Vytvorit VPS, doporuceny plan **CX22** (2 vCPU / 4 GB RAM) - pro cistou
  statickou appku s externi Supabase bohate staci.
- Nainstalovat Docker + Docker Compose plugin.
- Vytvorit dedikovaneho uzivatele pro deploy (ne root):
  ```bash
  adduser deploy
  usermod -aG docker deploy
  ```
- Vygenerovat SSH klic pro GitHub Actions (na SVEM pocitaci, ne na VPS):
  ```bash
  ssh-keygen -t ed25519 -f deploy_key -N ""
  ```
  Verejny klic (`deploy_key.pub`) pridat na VPS do
  `/home/deploy/.ssh/authorized_keys`. Privatni klic (`deploy_key`, cely
  obsah vcetne `-----BEGIN...`/`-----END...` radku) jde do GitHub secretu
  `VPS_SSH_KEY` (viz nize) - nikam jinam ho neukladat.
- Na VPS pod uzivatelem `deploy` naklonovat repozitar do `~/stenger-erp`
  (staci shallow clone, potrebujeme jen `docker-compose.deploy.*.yml`
  soubory - ale plny clone je jednodussi na udrzbu):
  ```bash
  git clone https://github.com/Stenger-cz/stenger-erp.git ~/stenger-erp
  ```

### 2. GitHub Container Registry (GHCR) viditelnost

Po prvnim buildu (viz nize) jit do GitHub -> repozitar -> **Packages** ->
`stenger-erp` -> Package settings -> nastavit viditelnost na **Public**.
Duvod: `VITE_SUPABASE_ANON_KEY` neni skutecne tajny udaj - je soucasti
kazdeho JS bundlu, ktery appka posila do prohlizece, takze je videt
komukoli stejne (skutecna bezpecnost stoji na Supabase RLS pravidlech, ne
na skryvani tohoto klice). Verejny package znamena, ze VPS nemusi mit zadne
prihlasovaci udaje k GHCR pro `docker compose pull`. (Pokud byste z
jakehokoli duvodu chteli package drzet privatni, VPS by pak potreboval
`docker login ghcr.io` s Personal Access Tokenem majicim `read:packages`.)

### 3. GitHub Actions secrets

V repozitari **Settings -> Secrets and variables -> Actions** pridat:

| Secret | Hodnota |
|---|---|
| `VITE_SUPABASE_URL_PRODUCTION` | URL produkcniho Supabase projektu |
| `VITE_SUPABASE_ANON_KEY_PRODUCTION` | anon key produkcniho Supabase projektu |
| `VITE_SUPABASE_URL_DEVELOPMENT` | URL staging/dev Supabase projektu |
| `VITE_SUPABASE_ANON_KEY_DEVELOPMENT` | anon key staging/dev Supabase projektu |
| `VPS_HOST` | IP adresa nebo hostname VPS |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | cely obsah privatniho SSH klice z kroku 1 |

`GITHUB_TOKEN` pro push do GHCR se nastavuje automaticky, nic delat netreba.

### 4. Prvni spusteni

Push do `main` (nebo `develop`) automaticky spusti `.github/workflows/deploy-vps.yml`.
Prubeh lze sledovat v repozitari pod zalozkou **Actions**.

## Rucni build/test lokalne (bez CI)

Pro lokalni testovani beze zmeny na VPS pouzijte puvodni
`docker-compose.production.yml` / `docker-compose.development.yml` (ty
builduji lokalne, ne z GHCR):

```bash
cp .env.production.example .env.production   # doplnit realne udaje
docker compose -f docker-compose.production.yml --env-file .env.production up -d --build
```

## Pripojeni domeny / HTTPS

Kontejnery samy o sobe servuji jen cisty HTTP na portu 80 uvnitr (namapovanem
na 8080/8081 navenek). Pro verejnou domenu a TLS certifikat doporucuji
reverzni proxy (napr. Caddy nebo nginx s certbot, nebo Traefik) pred temito
kontejnery - zamerne mimo tento setup, zavisi na konkretni domene a DNS.

## Budouci self-hosted DB (zatim NEimplementovano)

Az bude potreba presunout DB (Postgres + Auth + Storage) primo na VPS misto
hostovane Supabase:
- pouzit oficialni Supabase self-host `docker-compose.yml`
  (github.com/supabase/supabase/tree/master/docker), ne psat vlastni
- upgradnout VPS minimalne na CX32 (4 vCPU / 8 GB RAM)
- Postgres data adresar na samostatnem Hetzner Volume, ne na root disku
- nastavit automaticke zalohy (napr. nocni `pg_dump` mimo VPS) - toto
  Supabase Cloud dnes resi za vas, po self-hostu je to VASE odpovednost
- CI/CD pipeline pro appku samotnou (tento soubor) se nemeni

## Poznamka k testovani

Docker neni dostupny v tomto vyvojovem prostredi, takze `docker build` ani
cely CI/CD flow nebyly overeny primo zde. Prvni skutecny push do `main`
po nastaveni vsech secrets a VPS proverte v zalozce Actions a nahlaste,
pokud nejaky krok selze (ktery, jaka chybova hlaska).
