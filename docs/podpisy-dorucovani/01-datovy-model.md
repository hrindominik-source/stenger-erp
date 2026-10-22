# Fáza B – dátový model

Migrácia: `supabase/migrations/20261022130000_podpisy_dorucovani.sql` (sekcia 48). Rollback: `supabase/rollback/20261022130000_podpisy_dorucovani_rollback.sql`. DB testy: `supabase/tests/podpisy_dorucovani.test.sql` (pgTAP, 56 testov, `npx supabase test db`). Aplikované **iba lokálne**.

## Rozhodnutia z fázy A, ktoré model premieta

| Rozhodnutie | Kde v modeli |
|---|---|
| Finálne PDF = PDF z Wordu nahraté HR, nemenné, s hashom | `hr_documents.final_pdf_path/_sha256/finalized_at` (CHECK: všetko alebo nič), unikátna cesta |
| Pred podpisom kontrola textu PDF voči `variables_snapshot`, pri nezhode blok | `hr_documents.final_pdf_text_check` (`{"ok": bool, "missing": [...]}`) – elektronický podpis bez `ok=true` odmietne DB trigger |
| PDF bez textovej vrstvy odmietnuť | kontrola vo fáze C (klient extrahuje text; prázdny text → `ok=false`, finalizácia sa nevykoná) |
| Do pôvodného PDF nezasahovať, podpísaný originál zvlášť | `signed_pdf_path/_sha256` (zapíše sa raz); `final_pdf_*` sa po zamknutí nemení |
| Trvalé mazanie len HR_ADMIN s auditom, blok pri podpísaných/doručených | `hr_admin_delete_employee(p_employee_id, p_reason)` + `employees.record_flag` (`TEST`/`DUPLICATE`, mení len HR_ADMIN), záznam `audit_log.entity = 'employees_hard_delete'` |
| Dokumenty z dotazníka | `hr_documents.employee_id` nullable + `onboarding_session_id`, CHECK aspoň jedno; `hr_onboarding_review(REVIEWED)` prenesie len `employee_id` |
| Kiosk: expirácia, limit, upratovanie, odomknutie cez HR | `onboarding_sessions.expires_at`, stav `EXPIRED`, `hr_onboarding_cleanup()`, limit v `hr_onboarding_start_session`, `hr_kiosk_unlocks` + `hr_settings.kiosk.device_unlock_required` (predvolene vypnuté) |
| E-maily len do testovacej schránky | `hr_settings.email_mode = "mock"`; lokálne Mailpit `http://127.0.0.1:54324` |

## Tabuľky

- **`hr_settings`** – feature flagy a konfigurácia: `s335_consent_enabled` (false), `electronic_contract_enabled` (false), `s21_tablet_in_person_conservative` (true), `email_mode` (mock), `kiosk`, `wage_notice_reminder_day` (10). Kiosk číta len bezpečnú časť cez `hr_onboarding_config()`.
- **`hr_legal_text_versions`** – verzované texty (vyhlásenia, poučenie § 335, prejavy vôle). Hash tela počíta DB, telo sa nedá zmeniť (nová verzia). Stav `KONCEPT → SCHVALENO → VYRAZENO`. Všetky texty zatiaľ `KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU`.
- **`hr_signature_images`** – PNG podpisu v DB (nie v storage: kiosk/anon do storage nesmie; nemennosť chráni trigger). Unikátna väzba na jeden podpisový záznam → podpis z dotazníka nejde použiť inde.
- **`employee_contact_declarations`** – `S21_ADDRESS_NOTICE`, `S335_CONSENT` (povinná verzia poučenia), `S335_REVOCATION`. Vždy samostatné záznamy. Platnosť: `hr_valid_contact_declaration(employee, kind)` – platí len pre `email_snapshot` = aktuálny `private_email`. Odvolanie: `hr_revoke_s335_consent()`.
- **`hr_document_deliveries`** – kanály podľa zadania + dôvod `HANDED_OVER` (osobné odovzdanie). `delivered_document_sha256` = hash presne toho súboru, ktorý odišiel. Pravidlá v triggri:
  - § 21 / § 335 e-mail len s platným vyhlásením toho istého zamestnanca a tej istej adresy;
  - § 21 len pre `BILATERAL_CONTRACT`; § 335 odst. 3 (iná adresa) len pre mzdový výmer;
  - e-mail § 334 nikdy „doručený“ pri vložení; mzdový výmer na inú adresu bez fikcie;
  - raz zapísané časy (`sent_at`, `delivered_at`, `ineffective_at`, `withdrawal_received_at`) sa neprepisujú.

## Rozšírenia existujúcich tabuliek

- **`hr_documents`**: `legal_act_type`, `version_no`, `supersedes_document_id` (existujúce `superseded_by` ostáva), `final_pdf_*`, `final_pdf_text_check`, `finalized_*`, `locked_at`, `signing_channel`, `signed_pdf_*`, `voided_at`, `void_reason`, `onboarding_session_id`; stavy `VOIDED`, `SUPERSEDED`.
  Trigger `hr_documents_guard`: `SIGNED` ⇒ zamknuté; po zamknutí sa nemení obsah, cesty, hashe, snapshot, šablóna; stav nejde vrátiť; zneplatnenie vyžaduje dôvod; DELETE zakázaný (aj pre service role, výnimka len `hr_admin_delete_employee`).
- **`hr_document_signatures`**: metódy `ELECTRONIC_TABLET`, `ELECTRONIC_QUALIFIED`; `signed_content_sha256`, `signature_image_id`, `intent_text_version_id/_sha256`, `identity_verification`, `evidence`, `evidence_sha256` (počíta DB), `signer_user_id`, `scan_matches_original_confirmed_by`.
  Trigger: elektronický podpis len pri finálnom PDF s `text_check.ok`, hash = `final_pdf_sha256`, čas podpisu serverový; prvý podpis zamkne dokument; UPDATE/DELETE zakázané.
  Papier: `document_hash` = hash skenu (ako doteraz), `signed_content_sha256` = hash finálneho/vygenerovaného originálu.
- **`onboarding_sessions`**: `expires_at`, `last_activity_at`, `draft_purged_at`, `unlock_id`, stav `EXPIRED`.
- **`employees`**: `record_flag`.

## Tri osi stavu

```
(a) Životný cyklus (hr_documents.status + časy)
    DRAFT ─► READY_FOR_SIGNATURE ─(finalizácia: final_pdf_*)─► [prvý podpis ⇒ locked_at] ─► SIGNED ─► ARCHIVED
                     │                                                                       │
                     └──────────────────────────► VOIDED (dôvod) ◄──────────────────────────┘
                                                  SUPERSEDED (nová verzia, supersedes_document_id)

(b) Podpisy (odvodené): požadovaní podpisujúci podľa legal_act_type
    BILATERAL_CONTRACT → EMPLOYEE + EMPLOYER;  EMPLOYER_UNILATERAL → EMPLOYER (+ potvrdenie prevzatia);
    EMPLOYEE_DECLARATION → EMPLOYEE;  RECEIPT_ACKNOWLEDGEMENT → EMPLOYEE;  TRAINING_RECORD → EMPLOYEE (+ školiteľ)

(c) Odovzdanie/doručenie (hr_document_deliveries)
    neodovzdané ─► QUEUED ─► SENT ─► dodané/doručené (delivery_basis) | FAILED (opakovať / papier) | BOUNCED ⇒ neúčinné
                 └► IN_PERSON_* ─► doručené (HANDED_OVER / SIGNED_RECEIPT)
```

Lehoty (vypočíta aplikácia, fáza E/G): § 21 – 7 dní od dodania, kým zamestnanec nezačal plniť (porovnať s nástupom); § 335 odst. 2 – fikcia 15. deň od dodania; § 335 odst. 3 – bez potvrdenia do 15 dní od odoslania neúčinné, upozornenie 10. deň.

## Oprávnenia (fáza H – návrh, v DB už použité)

| Oprávnenie | Účel | Stav |
|---|---|---|
| `HR_DOCUMENT_SIGN` (existuje) | papierový sken, podpis na tablete (spúšťa HR) | ponechané |
| `HR_DOCUMENT_SEND` (nové) | odovzdanie / odoslanie, záznam doručenia | použité v RLS `hr_document_deliveries` |
| `HR_LEGAL_TEXTS_ADMIN` (nové) | správa textov vyhlásení a poučení | použité v RLS `hr_legal_text_versions` |
| `HR_SIGN_FOR_EMPLOYER` (nové, fáza F) | podpis za zamestnávateľa (plná moc) | zatiaľ nepoužité |
| zneplatnenie | `HR_DOCUMENT_APPROVE` (existujúce) | namapované, bez nového oprávnenia |

`HR_ADMIN` má všetko. Do UI (`HR_PERMISSION_OPTIONS`) sa doplnia vo fáze H.

## Archivácia a anonymizácia (návrh – namiesto trvalého mazania)

- **Archivácia** (bežný stav po skončení pomeru): `employees.active = false`, pomer `ENDED`, dokumenty ostávajú zamknuté a čitateľné len HR; nič sa nemaže.
- **Anonymizácia po uplynutí lehôt uchovávania**: nová RPC (HR_ADMIN, s dôvodom a auditom) by nahradila osobné údaje v `employees`, `employee_sensitive_data`, `employee_payroll_data` zástupnými hodnotami, vymazala koncepty kiosku a súbory, ktorých lehota uplynula; dokumenty s ešte plynúcou lehotou (mzdové listy, ELDP…) ponechá. Vyžaduje tabuľku lehôt podľa typu dokumentu → **otázka pre právničku** (02-otazky-pravnicka.md).
- Do rozhodnutia právničky sa anonymizácia neimplementuje.
