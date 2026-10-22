# Podpisy, nemenné dokumenty a doručovanie – Fáza A: analýza

Vetva: `feature/podpisy-dorucovani` (z `hr-merge-tmp` @ 5435378). Stav k 22. 10. 2026. Iba čítanie, žiadna zmena kódu ani DB.

## 1. Pokyny repozitára

- `CLAUDE.md`, `AGENTS.md`, `docs/` neexistujú. `README.md` je zastaraný (hovorí o localStorage verzii).
- Testy: `vitest` (`npm test`), 382 testov zelených. Lint: ESLint bez configu v repozitári (používa sa lokálny config mimo repa). Žiadne E2E (Playwright nie je v závislostiach).
- CI: `.github/workflows` → GitHub Pages iba pri pushi do `main` (build s produkčnými secrets). Vetva `feature/*` sa nenasadzuje.
- Konvencie: komentáre v kóde slovensky bez diakritiky, UI česky, ID sú textové (`uid()`), žiadne mazanie riadkov z UI.

## 2. Zásadné rozdiely oproti zadaniu (dôvod zastavenia po fáze A)

### 2.1 Neexistuje migračný systém ani lokálna/staging DB  ⚠️ BLOKUJE FÁZU B

- Celá schéma je **jeden kumulatívny idempotentný súbor** `supabase/schema.sql` (2517 riadkov, sekcie 1–47) + ad-hoc `supabase/2026-10-08_exekuce_doklady.sql`. Nie je `supabase/migrations/`, `config.toml` ani `supabase init`.
- Zmeny sa aplikovali ručne do **jediného produkčného projektu** (`zvvlx…`). `.env.local` (má prednosť pred `.env.development`) ukazuje na produkciu → `npm run dev` pracuje s produkčnou DB.
- `.env.development` ukazuje na iný projekt (`gzbrni…`) – nevedno, či je to živý staging, alebo starý projekt. **Treba potvrdiť.**
- Supabase CLI nie je nainštalované. Docker Desktop je nainštalovaný, ale **daemon nebeží**.
- Zadanie vyžaduje „migrácie aplikované iba lokálne“ a testy RLS/triggrov proti lokálnej DB → bez rozhodnutia o prostredí (bod 6, otázka 1) fázu B nemám kde overiť.

### 2.2 „PDF náhled“ nie je použiteľný ako finálny podpisovaný dokument  ⚠️ BLOKUJE FÁZU C

- `src/lib/hr/docxToPdf.js`: DOCX → `mammoth` → HTML → `html2canvas` → `jsPDF` (`textPdf.js renderContainerToPdf`). Výsledok je **rastrový obrázok** (nie text), stránkovanie sa **líši od Wordu** (Vstupní školení: 2 strany namiesto 1), a výstup **nie je deterministický** (závisí od fontov/prehliadača) → rovnaký dokument dá na inom zariadení iný hash.
- Komentár v kóde to výslovne uvádza: PDF „NIE JE a nesmie byt povazovany za … archivovany podpisany vystup“.
- Uloženým artefaktom je dnes `.docx` (`zamestnanci/{employee_id}/{doc_id}.docx`), ktorý tablet nevie verne zobraziť.
- Zadanie (fáza C) predpokladá „finálne PDF, rovnaké aké sa zobrazí podpisujúcemu“ → treba rozhodnúť, **ako vznikne verné PDF** (bod 6, otázka 2).

### 2.3 Menšie rozdiely (nie blokujúce)

| Zadanie tvrdí | Skutočnosť v repozitári |
|---|---|
| `hr_document_signatures.method` iba `PAPER` | CHECK povoľuje `PAPER`, `TABLET_SIMPLE`, `ELECTRONIC_SIGNATURE_PROVIDER`, `OTHER`; UI používa iba `PAPER`. Existujú aj stĺpce `signing_session_id`, `provider_reference_id`, `device_metadata`. → rozšíriť CHECK o `ELECTRONIC_TABLET`/`ELECTRONIC_QUALIFIED` alebo namapovať na existujúce hodnoty. |
| verzie dokumentov treba doplniť | `hr_documents.superseded_by` už existuje (smer opačný než navrhované `supersedes_document_id`). |
| úložisko treba chrániť | bucket `hr-dokumenty` už **nemá UPDATE/DELETE policy** (sekcia 45.6) → prepis/mazanie bežným účtom nemožné. Service role/dashboard to obíde (priznané v komentári). Signed URL a `upload` bez `upsert` → prepis zlyhá. |
| — | `hr_documents` má UPDATE policy bez obmedzenia stavu → **podpísaný dokument sa dá na úrovni DB zmeniť** (nemennosť je len konvencia v UI). Treba trigger. |
| — | `hr_admin_delete_employee` (HR_ADMIN) natvrdo maže aj podpisy a dokumenty. Pri nemenných podpisoch treba rozhodnúť, či ho zachovať (oprava duplicít) – trigger proti DELETE by ho rozbil. |
| e-mail | iba `employees.private_email` (sekcia „Kontakt, doklad a účet“), v kiosku cez rovnaký `EmployeeFieldsForm` → sedí. |
| odosielanie e-mailov | potvrdené: **neexistuje** (žiadne `functions.invoke` na mail, žiadny SMTP/poskytovateľ). Edge Functions sa ale už používajú (`supabase/functions/cnb-rate`) → infra pre Edge Function je k dispozícii. |

## 3. Overenie zistení z kap. 1.1 zadania

**Sedí:** kiosk `?kiosk=nastup` (`src/hr/OnboardingKiosk.jsx`, 209 r.) bez podpisu/vyhlásení; RPC `hr_onboarding_start_session/save_draft/submit/review`; stavy `onboarding_sessions`; zamestnanec sa nezakladá automaticky (HR „Nový zaměstnanec“ z dát session → `hr_onboarding_review(REVIEWED, employee_id)`); stavy a `origin` v `hr_documents`; cesta `.docx`; `variables_snapshot`; vstavaný vzor pracovnej zmluvy; šablóny Náplň v7, Mzdový výměr v4, Vstupní školení v2; `SignDocumentForm` (sken → SHA-256 skenu → `SIGNED`); `hr_permissions` / `hr_get_permissions` / `hr_has_permission` (HR_ADMIN = wildcard).

**Doplnenie k 1.2 (neoverené body):**

- **RPC kiosku:** všetky `SECURITY DEFINER`, `grant … to anon`. `save_draft`/`submit` vyžadujú token a stav `IN_PROGRESS` → odoslanú session nejde prepísať; nevracajú cudzie dáta. Anon nemá SELECT na žiadnu HR tabuľku ani na bucket (`current_role()='office'`).
- **Riziká kiosku:** token **neexpiruje** a nie je jednorazový (platí do odoslania); `start_session` môže anon volať neobmedzene (spam relácií). Koncept sa na zariadení neukladá (žiadny `localStorage` v kiosku) – sedí s UI.
- **Prenos po review:** dáta sa z `draft_data` skopírujú do formulára „Nový zaměstnanec“, HR ich môže upraviť, potom insert do `employees` atď. Väzba session → zamestnanec je iba `onboarding_sessions.resulting_employee_id`. Pre podpísané dokumenty z kiosku treba nový krok: pri REVIEWED „preniesť“ (nastaviť `employee_id`) dokumenty a vyhlásenia viazané na `onboarding_session_id`. **Pozor:** `hr_documents.employee_id` je `NOT NULL` → dokument z kiosku nemôže vzniknúť pred založením zamestnanca, potrebná zmena (nullable + CHECK `employee_id or onboarding_session_id`).
- **Audit:** `audit_trigger` (sekcia 39) je na všetkých HR tabuľkách vrátane `hr_documents` a `hr_document_signatures`; `employee_timeline_events` sa zapisuje z klienta (append-only, bez UPDATE/DELETE policy).
- **Storage:** jediný bucket `hr-dokumenty` (+ cesty `zamestnanci/…`, `zamestnanci-podpisy/…`, šablóny). Viditeľnosť súboru dedí klasifikáciu dokumentu (`hr_object_path_visible`).

## 4. Znovupoužiteľné časti

- `EmployeeFieldsForm` (režim `kiosk`) – pridať krok „Elektronická komunikace“ a voľbu „Nemám e-mail“.
- `documentHash.js` (`sha256Hex`, `buildSignedScanPath`), `fileNames.js` (čitateľné názvy), `openHrFile` (sťahovanie blobom).
- `SignDocumentForm` – papierový postup, doplniť väzbu na verziu + hash originálu.
- `GenerateDocumentForm` – výber „Za zaměstnavatele podepisuje (plná moc)“ (`PS_PODEPISUJICI`).
- `pdf-lib` je už v závislostiach → vloženie obrázka podpisu a dôkaznej strany do PDF bez novej knižnice. Na zobrazenie PDF na tablete (všetky strany, kontrola doscrollovania) treba pridať `pdfjs-dist` – v repozitári zatiaľ nie je.
- `nastupniBalicek.js` – rozšíriť stavy o `podepsáno – nepředáno` / `hotovo`.
- Edge Function vzor `supabase/functions/cnb-rate` → odosielanie e-mailov.

## 5. Návrh migrácií (po rozhodnutí o prostredí)

Nový súbor `supabase/2026-10-xx_podpisy_dorucovani.sql` (rovnaký štýl ako exekuce: idempotentný, iba aditívny) + zapísanie do `schema.sql` ako sekcia 48, a `…_rollback.sql`:

1. `employee_contact_declarations` (podľa zadania 4.2), RLS: SELECT HR_VIEW_BASIC, INSERT HR_EDIT, bez UPDATE okrem `revoked_at/revocation_received_at/superseded_at` cez RPC.
2. `hr_documents`: `legal_act_type`, `version_no`, `final_pdf_path`, `final_pdf_sha256`, `finalized_at/by`, `locked_at`, `signing_channel`, `voided_at`, `void_reason`, `onboarding_session_id`; `employee_id` nullable; stavy `VOIDED`, `SUPERSEDED`; trigger zámku po `locked_at`.
3. `hr_document_signatures`: rozšírenie CHECK `method`, `signed_content_sha256`, `signature_image_path`, `signature_strokes`, `intent_text_version/sha256`, `identity_verification`, `evidence`, `evidence_sha256`; trigger proti UPDATE/DELETE (s výnimkou pre `hr_admin_delete_employee` cez `set_config` príznak – na rozhodnutie).
4. `hr_document_deliveries` (podľa zadania 4.5).
5. RPC: `hr_sign_document` (overí hash = `final_pdf_sha256`, zapíše podpis, serverový čas), kiosk RPC pre vyhlásenia/podpis s tokenom, `hr_onboarding_review` rozšíriť o prenos dokumentov.

## 6. Otázky na rozhodnutie (pred fázou B)

1. **Prostredie DB.** Odporúčam: zapnúť Docker Desktop, nainštalovať Supabase CLI (`npx supabase`), `supabase start` lokálne a naň aplikovať `schema.sql` + novú migráciu. Alternatíva: použiť projekt z `.env.development` (`gzbrni…`), ak je to staging – potvrdiť.
2. **Finálne PDF.** Možnosti:
   - **(a) Odporúčam na začiatok:** HR uloží dokument z Wordu ako PDF („Uložit jako PDF“) a nahrá ho ako finálny; systém spočíta hash, tablet zobrazí presne tento súbor, podpis sa vloží cez `pdf-lib`. Verné, deterministické, bez servera. Nevýhoda: jeden ručný krok.
   - (b) Server DOCX→PDF (LibreOffice/Gotenberg) – automatické, ale potrebuje vlastný server (Supabase Edge Function LibreOffice nespustí); personálne dáta by išli na ďalší server.
   - (c) Prepísať dokumenty do priameho generovania PDF (pdf-lib) – stratí sa úprava šablón vo Worde.
3. **`hr_admin_delete_employee`** – zachovať výnimku pre mazanie testovacích duplicít aj pri nemenných podpisoch? (odporúčam áno, iba HR_ADMIN, zapísané v audite).
4. **Poskytovateľ e-mailov** (fáza G) – stačí rozhodnúť neskôr; dovtedy mock outbox.
