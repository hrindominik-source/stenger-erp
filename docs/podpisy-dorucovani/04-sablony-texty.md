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

**Odporúčanie:** presunúť do `hr_document_templates` kvôli verzovaniu, schvaľovaniu a klasifikácii citlivosti. Návrh, bez zmeny existujúcich dokumentov:

1. Migrácia (len nové riadky):
   ```sql
   insert into hr_document_templates (id, name, doc_type, current_version_id) values
     ('tpl-ps', 'Pracovní smlouva (vzor Stenger)', 'pracovni_smlouva', null),
     ('tpl-ps-cizinec', 'Pracovní smlouva – cizinec (vzor Stenger)', 'pracovni_smlouva_cizinec', null);
   insert into hr_document_template_versions (id, template_id, version_number, file_path, mapping_status, required_permissions) values
     ('tpl-ps-v1', 'tpl-ps', 1, 'sablony/tpl-ps/v1.docx', 'SCHVALENA', array['HR_VIEW_SENSITIVE']),
     ('tpl-ps-cizinec-v1', 'tpl-ps-cizinec', 1, 'sablony/tpl-ps-cizinec/v1.docx', 'SCHVALENA', array['HR_VIEW_SENSITIVE']);
   update hr_document_templates set current_version_id = ... ;
   ```
2. Krok nasadenia (nie SQL): nahrať súčasné `.docx` do úložiska na `sablony/tpl-ps/v1.docx` a `sablony/tpl-ps-cizinec/v1.docx`, s rovnakými bajtmi a overením SHA-256.
3. Formulár „Pracovní smlouva“ načíta aktuálnu verziu šablóny z úložiska namiesto `public/` a nové dokumenty dostanú `template_id` a `template_version_id`.
4. Existujúce dokumenty sa nemenia. Zostávajú bez `template_version_id` a ich obsah je zachytený vo `variables_snapshot`, v súbore a vo finálnom PDF s hashom.
5. `public/hr/sablony/*.docx` ostanú ako záloha, kým nie je verzia v DB overená.

Neimplementované – čaká na rozhodnutie. Ide o zmenu postupu generovania zmluvy a o krok nasadenia s nahratím súborov.
