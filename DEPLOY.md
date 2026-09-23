# Nasazeni na VPS (Netcup) s automatickym CI/CD a HTTPS

Appka je cista klientska SPA (Vite + React) - kontejner ji jen builduje a
servuje jako staticke soubory pres nginx, zadny Node.js v produkci nebezi.
DB zatim zustava hostovana Supabase (mimo VPS) - VPS tak potrebuje jen
minimalni vykon.

**Cilovy VPS**: netcup VPS nano G11.5s (2 vCore, 2 GB RAM, 60 GB SSD,
Norimberk) - staci na bezici produkcni i vyvojovy kontejner soucasne.

**Domeny**: `erp.stenger.cz` -> produkce, `test-erp.stenger.cz` -> vyvoj.
HTTPS zajistuje Caddy s automatickym Let's Encrypt certifikatem (zadna
rucni prace s certbotem).

## Oddelene DB pro produkci a vyvoj

Produkce a develop pouzivaji **dva oddelene Supabase projekty** - zadna
sdilena databaze mezi prostredimi. Protoze Vite zapeka
`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` uz behem buildu, kazde
prostredi ma svuj vlastni Docker image.

## Jak to funguje (automaticky deploy)

```
push do main    -> GitHub Actions zbuilduje "production" image (VITE_APP_ENV=production)
                 -> pushne do ghcr.io/stenger-cz/stenger-erp:production
                 -> SSH na VPS, stahne image, restartuje kontejner app-production
                 -> Caddy (bezi porad) presmeruje erp.stenger.cz na tento kontejner

push do develop -> stejne, ale "development" image (VITE_APP_ENV=development)
                 -> kontejner app-develop, Caddy presmeruje test-erp.stenger.cz
```

Build vzdy probiha v GitHub Actions, ne na VPS. Kazdy build je navic
otagovany i commit hashem (`production-<sha>`), takze rollback na
predchozi verzi je jen zmena tagu v `docker-compose.deploy.production.yml`
a rucne `docker compose up -d`.

## Vizualni odliseni vyvojove verze

`test-erp.stenger.cz` (develop) ma automaticky na uplnem vrchu appky tenky
pruhovany oranzovo-hnedy pruh (viz `EnvironmentBanner` v `src/App.jsx`) -
objevi se na UPLNE KAZDE obrazovce appky (prihlasovani, vsechny moduly),
protoze se vykresluje v jedinem spolecnem root komponentu, ne v kazdem
view souboru zvlast. Rizeno build-time promennou `VITE_APP_ENV` - na
produkci se tato promenna vubec nenastavuje, takze se tam nic nezobrazi.

## Jednorazove nastaveni

### 1. VPS (netcup)

- Objednat **VPS nano G11.5s** (nebo vykonnejsi, pokud uz je jasne, ze
  bude potreba - viz sekce o self-hosted DB nize), lokalita Norimberk.
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
- Na VPS pod uzivatelem `deploy` naklonovat repozitar do `~/stenger-erp`:
  ```bash
  git clone https://github.com/Stenger-cz/stenger-erp.git ~/stenger-erp
  cd ~/stenger-erp
  ```

### 2. DNS zaznamy

Tam, kde se spravuje DNS pro domenu `stenger.cz` (registrator domeny,
pripadne vlastni DNS sluzba - **ne u netcupu**, pokud tam domenu
nemate presunutou), pridat dva **A zaznamy** smerujici na verejnou IP
adresu VPS (zjistite ji v netcup rozhrani po vytvoreni serveru):

| Typ | Nazev/Host | Hodnota |
|---|---|---|
| A | `erp` | `<verejna IP VPS>` |
| A | `test-erp` | `<verejna IP VPS>` |

Vysledek: `erp.stenger.cz` a `test-erp.stenger.cz` musi po propagaci DNS
(muze trvat par minut az par hodin) ukazovat na VPS - overte pomoci
`nslookup erp.stenger.cz` nebo `nslookup test-erp.stenger.cz`.
**DNS musi fungovat DRIVE, nez poprve nastartujete Caddy** (krok 5) - jinak
selze ziskani Let's Encrypt certifikatu.

### 3. GitHub Container Registry (GHCR) viditelnost

Po prvnim buildu (az probehne CI/CD, krok 6) jit do GitHub -> repozitar ->
**Packages** -> `stenger-erp` -> Package settings -> nastavit viditelnost
na **Public**. Duvod: `VITE_SUPABASE_ANON_KEY` neni skutecne tajny udaj -
je soucasti kazdeho JS bundlu, ktery appka posila do prohlizece, takze je
videt komukoli stejne (skutecna bezpecnost stoji na Supabase RLS
pravidlech, ne na skryvani tohoto klice). Verejny package znamena, ze VPS
nemusi mit zadne prihlasovaci udaje k GHCR pro `docker compose pull`.

### 4. GitHub Actions secrets

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

### 5. Spusteni Caddy (reverzni proxy + HTTPS) - JEDNORAZOVE

Na VPS, az DNS zaznamy z kroku 2 uz ukazuji na tento server:

```bash
cd ~/stenger-erp
docker network create web
docker compose -f docker-compose.proxy.yml up -d
```

Caddy si pri prvnim startu sam vyzada Let's Encrypt certifikaty pro obe
domeny (par sekund az minut). Tento kontejner pak bezi dlouhodobe a dalsi
deploy appky (krok 6) se ho netyka.

### 6. Prvni deploy appky

Push do `main` (nebo `develop`) automaticky spusti
`.github/workflows/deploy-vps.yml`. Prubeh lze sledovat v repozitari pod
zalozkou **Actions**. Po uspesnem behu by melo byt dostupne
`https://erp.stenger.cz` (po push do main) a/nebo `https://test-erp.stenger.cz`
(po push do develop, s viditelnym oranzovym pruhem nahore).

## Rucni build/test lokalne (bez CI, bez domeny)

Pro lokalni testovani beze zmeny na VPS pouzijte puvodni
`docker-compose.production.yml` / `docker-compose.development.yml` (ty
builduji lokalne, ne z GHCR, a stale publikuji porty primo na
8080/8081 - bez Caddy, bez HTTPS):

```bash
cp .env.production.example .env.production   # doplnit realne udaje
docker compose -f docker-compose.production.yml --env-file .env.production up -d --build
```

## Budouci self-hosted DB (zatim NEimplementovano)

Az bude potreba presunout DB (Postgres + Auth + Storage) primo na VPS misto
hostovane Supabase:
- pouzit oficialni Supabase self-host `docker-compose.yml`
  (github.com/supabase/supabase/tree/master/docker), ne psat vlastni
- upgradnout VPS minimalne na 4 vCPU / 8 GB RAM (VPS nano ma jen 2 GB -
  na soucasny self-host stack Supabase nestaci)
- Postgres data adresar na samostatnem persistentnim disku, ne na root disku
- nastavit automaticke zalohy (napr. nocni `pg_dump` mimo VPS) - toto
  Supabase Cloud dnes resi za vas, po self-hostu je to VASE odpovednost
- CI/CD pipeline a Caddy reverzni proxy pro appku samotnou (tento soubor)
  se nemeni, jen pribude dalsi sluzba na sdilene siti "web"

## Poznamka k testovani

Docker neni dostupny v tomto vyvojovem prostredi, takze `docker build`,
Caddy ani cely CI/CD flow nebyly overeny primo zde. Po nastaveni vseho
vyse proverte prvni push do `main`/`develop` v zalozce Actions a
nahlaste, pokud nejaky krok selze (ktery, jaka chybova hlaska).
