# Fáza I – šablóny a texty (migrácia 58)

## Nové typy dokumentov

| Typ (`doc_type`) | Názov | Právny úkon | Text (`text_key`) | Po úplnom podpise |
|---|---|---|---|---|
| `s21_oznameni_adresy` | Oznámení elektronické adresy (§ 21 ZP) | prohlášení zaměstnance | `S21_ADDRESS_NOTICE` | § 21 oznámenie (staré sa nahradí) |
| `s335_pouceni` | Poučení o elektronickém doručování (§ 335 ZP) | potvrzení převzetí | `S335_NOTICE` | – |
| `s335_souhlas` | Souhlas s elektronickým doručováním (§ 335 ZP) | prohlášení zaměstnance | `S335_CONSENT` + celé `S335_NOTICE` | § 335 súhlas s verziou poučenia |
| `s335_odvolani` | Odvolání souhlasu (§ 335 ZP) | prohlášení zaměstnance | `S335_REVOCATION` (nový) | súhlas odvolaný, nové § 335 zásielky blokované |
| `potvrzeni_prevzeti` | Potvrzení o převzetí písemnosti | potvrzení převzetí | `RECEIPT_CONFIRMATION` (nový) | – (dôkaz k odovzdaniu) |

- Dokumenty generuje **server** (Edge Function `hr-declarations`) z aktuálnej verzie textu. PDF je hneď „finálne, overené serverom“ a podpisuje sa bežným postupom: tablet za prítomnosti HR (QR + kód) alebo papier so skenom.
- Vyhlásenie vznikne až po **úplnom podpise** (trigger `hr_documents_declaration_signed`). Pre dokument, ktorý negeneroval server, nevznikne.
- § 21 a § 335 vyžadujú platný súkromný e-mail. § 335 (poučenie a súhlas) je dostupný len pri `hr_settings.s335_consent_enabled = true`.
- Potvrdenie o prevzatí nesie otlačok SHA-256 odovzdaného vyhotovenia: pri elektronickom podpise podpísaného originálu, pri papierovom podpise vytlačeného finálneho PDF.
- UI:
  - **Detail zamestnanca → Dokumenty → „Prohlášení (§ 21 / § 335)“**;
  - **detail dokumentu → „Vytvořit potvrzení o převzetí“**;
  - **Šablony → Texty prohlášení a poučení** (správa verzií, `HR_LEGAL_TEXTS_ADMIN`).

## Verzovanie textov

- `hr_legal_text_versions`: text verzie je nemenný (`hr_legal_texts_guard`). Zmena textu = nová verzia, otlačok počíta DB.
- Aktuálna verzia je najnovšia nevyradená (`hr_current_legal_text`). Vyradením sa vráti predchádzajúca.
- Podpísané dokumenty ostávajú viazané na starý text:
  - PDF obsahuje text aj jeho verziu a otlačok;
  - `variables_snapshot.text_version_id` a `notice_version_id` odkazujú na verziu;
  - podpisový záznam má `intent_text_version_id`.
- Stav `SCHVALENO` nastaví HR až po písomnom schválení právničkou. Systém pracuje aj s konceptmi, PDF však nesie označenie „KONCEPT“.

## Pracovná zmluva – vstavaný vzor

**Zistenie:**
- Vzory `public/hr/sablony/pracovni_smlouva.docx` a `pracovni_smlouva_cizinec.docx` sú súčasťou frontendu (formulár „Pracovní smlouva“).
- Vygenerovaná zmluva nemá `template_version_id`. Neukladá sa, z ktorej verzie vzoru vznikla, a pri zmene súboru v repozitári to nejde spätne zistiť.
- Citlivosť sa preto berie z predvoleného `HR_VIEW_SENSITIVE`.

**Implementované (migrácia 59 `20261023160000_sablona_pracovnej_zmluvy.sql`):**

- Šablóny `tpl-ps` a `tpl-ps-cizinec` (schválené), verzia 1 = dnešný vzor. `content_hash` je SHA-256 súborov `public/hr/sablony/*.docx`, citlivosť `HR_VIEW_SENSITIVE` (ako doteraz).
- Formulár „Pracovní smlouva“ načíta aktuálnu verziu šablóny (`src/lib/hr/psTemplates.js`). Súbor použije len pri zhodnom otlačku: z úložiska (`sablony/tpl-ps*/v1.docx`), pri prvom použití z dodaného vzoru, ktorý potom uloží do úložiska (bez prepisu). Nový dokument má `template_id` a `template_version_id`.
- Verzia šablóny je nemenná (súbor, otlačok, číslo); použitá verzia sa nedá zmazať. Zmena vzoru = nová verzia: Šablony → nahrať s typom „Pracovní smlouva“ a **rovnakým názvom** „Pracovní smlouva (vzor Stenger)“. Značky sa kontrolujú podľa generátora zmluvy. Po schválení sa verzia stane aktuálnou.
- Šablóny zmluvy sa neponúkajú v generickom „Vytvořit dokument“ (plní ich len formulár zmluvy).
- Existujúce dokumenty sa nemenia: migrácia nemení `hr_documents` (overené otlačkom celej tabuľky pred a po), staré zmluvy ostávajú bez `template_version_id`.
- Testy: zmluva z pôvodného vzoru a zo šablóny z tých istých vymyslených údajov je obsahovo zhodná (obidva varianty), dokument má verziu (`psTemplate.server.it.test.js`). Odmietnutie súboru s iným otlačkom a nemennosť sú pokryté (`psTemplates.test.js`, `sablona_ps.test.sql`).
- Rollback `supabase/rollback/20261023160000_sablona_pracovnej_zmluvy_rollback.sql` sa zastaví, ak už existujú zmluvy zo šablóny.
- Zostatkové riziko: kto má `HR_EDIT`, môže pred prvým použitím nahrať na `sablony/tpl-ps/v1.docx` iný súbor. Ten sa pre nezhodný otlačok nepoužije, ale generovanie zmluvy sa zablokuje. Preto pri nasadení súbor nahrá HR hneď prvým vygenerovaním (alebo náhľadom) zmluvy a skontroluje, že funguje.
