-- DB testy fazy B (podpisy, nemennost, dorucovanie, kiosk). Iba lokalne:
--   npx supabase test db
-- Vsetky udaje su vymyslene.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ---------- pripravne data (ako postgres) ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'hr@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', 'basic@test.local'),
  ('00000000-0000-0000-0000-0000000000d1', 'nobody@test.local');
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Test Admin', 'office'),
  ('00000000-0000-0000-0000-0000000000b1', 'Test Personalista', 'office'),
  ('00000000-0000-0000-0000-0000000000c1', 'Test Ctenar', 'office'),
  ('00000000-0000-0000-0000-0000000000d1', 'Test Bez Prav', 'office');
insert into public.hr_permissions (id, user_email, permissions) values
  ('p-a', 'admin@test.local', array['HR_ADMIN']),
  ('p-b', 'hr@test.local', array['HR_VIEW_BASIC', 'HR_VIEW_SENSITIVE', 'HR_EDIT', 'HR_DOCUMENT_GENERATE', 'HR_DOCUMENT_SIGN', 'HR_DOCUMENT_SEND']),
  ('p-c', 'basic@test.local', array['HR_VIEW_BASIC']);

insert into public.employees (id, first_name, last_name, private_email) values
  ('emp-1', 'Jan', 'Testovaci', 'jan.testovaci@example.com'),
  ('emp-2', 'Eva', 'Duplicitni', 'eva@example.com');
insert into public.hr_legal_text_versions (id, text_key, version_no, title, body, body_sha256) values
  ('lt-intent', 'INTENT_BILATERAL_CONTRACT', 91, 'Prejav vule', 'KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU. Seznámil/a jsem se s celým obsahem a uzavírám tuto smlouvu.', 'x'),
  ('lt-335', 'S335_NOTICE', 91, 'Pouceni § 335', 'KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU. Poučení…', 'x');
insert into public.hr_documents (id, employee_id, doc_type, origin, status, legal_act_type, file_path,
    final_pdf_path, final_pdf_sha256, final_pdf_text_check, finalized_at) values
  ('doc-ps', 'emp-1', 'pracovni_smlouva', 'GENERATED', 'READY_FOR_SIGNATURE', 'BILATERAL_CONTRACT', 'zamestnanci/emp-1/doc-ps.docx',
    'zamestnanci/emp-1/doc-ps.final.pdf', repeat('a', 64), '{"ok": true, "server_verified": true}', now()),
  ('doc-noPdf', 'emp-1', 'pracovni_smlouva', 'GENERATED', 'READY_FOR_SIGNATURE', 'BILATERAL_CONTRACT', null,
    null, null, null, null),
  ('doc-mv', 'emp-1', 'platovy_vymer', 'GENERATED', 'READY_FOR_SIGNATURE', 'EMPLOYER_UNILATERAL', null,
    null, null, null, null);
-- historicky papierovy dokument (rucny zaznam) - jedina vynimka pre vlozenie rovno ako SIGNED
insert into public.hr_documents (id, employee_id, doc_type, origin, status, legal_act_type, is_manual_history_entry)
  values ('doc-2', 'emp-2', 'pracovni_smlouva', 'GENERATED', 'SIGNED', 'BILATERAL_CONTRACT', true);
insert into public.hr_signature_images (id, png, png_sha256) values ('img-1', decode(repeat('ab', 200), 'hex'), 'x');

-- ---------- 1. obrazok podpisu / pravne texty ----------
select is((select png_sha256 from public.hr_signature_images where id = 'img-1'),
  encode(extensions.digest(decode(repeat('ab', 200), 'hex'), 'sha256'), 'hex'), 'hash obrazku podpisu pocita DB');
select throws_ok($$update public.hr_signature_images set strokes = '[]' where id = 'img-1'$$, 'P0001', null, 'obrazok podpisu je nemenny');
select throws_ok($$update public.hr_legal_text_versions set body = 'zmena' where id = 'lt-intent'$$, 'P0001', null, 'text pravnej verzie je nemenny');
select is((select body_sha256 from public.hr_legal_text_versions where id = 'lt-intent') <> 'x', true, 'hash textu pocita DB, nie klient');

-- ---------- 2. elektronicky podpis a zamknutie ----------
select throws_ok($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_content_sha256, signature_image_id, intent_text_version_id, intent_text_sha256)
  values ('s-x', 'doc-noPdf', 'ELECTRONIC_TABLET', 'EMPLOYEE', repeat('a',64), 'img-1', 'lt-intent', 'h')$$, 'P0001', null, 'bez finalneho PDF nejde elektronicky podpisat');
select throws_ok($$insert into public.hr_documents (id, employee_id, doc_type, origin, status, final_pdf_path, final_pdf_sha256, final_pdf_text_check, finalized_at)
  values ('doc-badText', 'emp-1', 'pracovni_smlouva', 'GENERATED', 'READY_FOR_SIGNATURE', 'zamestnanci/emp-1/bad.final.pdf', repeat('b', 64),
  '{"ok": false, "server_verified": true, "missing_keys": ["mzda"]}', now())$$, 'P0001', null, 'PDF s neuspesnou kontrolou textu sa nefinalizuje (podpis nemozny)');
select throws_ok($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_content_sha256, signature_image_id, intent_text_version_id, intent_text_sha256)
  values ('s-x', 'doc-ps', 'ELECTRONIC_TABLET', 'EMPLOYEE', repeat('c',64), 'img-1', 'lt-intent', 'h')$$, 'P0001', null, 'hash podpisaneho obsahu musi sediet s finalnym PDF');
select throws_ok($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_content_sha256)
  values ('s-x', 'doc-ps', 'ELECTRONIC_TABLET', 'EMPLOYEE', repeat('a',64))$$, '23514', null, 'tabletovy podpis bez obrazka/prejavu vule odmietnuty');
select lives_ok($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_at, signed_by_name, signed_content_sha256, signature_image_id, intent_text_version_id, intent_text_sha256, evidence)
  values ('s-1', 'doc-ps', 'ELECTRONIC_TABLET', 'EMPLOYEE', '2000-01-01', 'Jan Testovaci', repeat('a',64), 'img-1', 'lt-intent', 'h', '{"all_pages_viewed": true}')$$, 'platny tabletovy podpis');
select isnt((select signed_at from public.hr_document_signatures where id = 's-1'), '2000-01-01'::timestamptz, 'cas podpisu je serverovy, nie z klienta');
select is((select length(evidence_sha256) from public.hr_document_signatures where id = 's-1'), 64, 'hash dokazov sa ulozi');
select isnt((select locked_at from public.hr_documents where id = 'doc-ps'), null, 'prvy podpis zamkne dokument');
select is((select signing_channel from public.hr_documents where id = 'doc-ps'), 'ELECTRONIC', 'kanal podpisu sa zapise');
select throws_ok($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_content_sha256, signature_image_id, intent_text_version_id, intent_text_sha256)
  values ('s-2', 'doc-ps', 'ELECTRONIC_TABLET', 'EMPLOYER', repeat('a',64), 'img-1', 'lt-intent', 'h')$$, '23505', null, 'obrazok podpisu nejde pouzit druhykrat');
select throws_ok($$update public.hr_document_signatures set signed_by_name = 'Iny' where id = 's-1'$$, 'P0001', null, 'podpis nejde upravit (ani postgres)');
select throws_ok($$delete from public.hr_document_signatures where id = 's-1'$$, 'P0001', null, 'podpis nejde zmazat (ani postgres)');
select throws_ok($$update public.hr_documents set final_pdf_sha256 = repeat('d',64) where id = 'doc-ps'$$, 'P0001', null, 'zamknuty dokument: hash nejde zmenit');
select throws_ok($$update public.hr_documents set variables_snapshot = '{"mzda": 1}' where id = 'doc-ps'$$, 'P0001', null, 'zamknuty dokument: snapshot nejde zmenit');
select throws_ok($$update public.hr_documents set locked_at = null where id = 'doc-ps'$$, 'P0001', null, 'zamknutie nejde zrusit');
-- Podpisany != zamknuty: zmluva len s podpisom zamestnanca nie je podpisana.
select is(public.hr_document_missing_signers('doc-ps'), array['EMPLOYER'], 'zmluve chyba podpis zamestnavatela');
select throws_ok($$update public.hr_documents set status = 'SIGNED' where id = 'doc-ps'$$, 'P0001', null,
  'zmluva len s podpisom zamestnanca sa neda oznacit ako podpisana');
select is((select status from public.hr_documents where id = 'doc-ps'), 'READY_FOR_SIGNATURE', 'zamknuta zmluva ostava "k podpisu"');
select throws_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, recipient_snapshot)
  values ('dl-u', 'doc-ps', 'IN_PERSON_PAPER', null)$$, 'P0001', null, 'zmluvu len s podpisom zamestnanca nejde odovzdat ani odoslat');
insert into public.hr_signature_images (id, png, png_sha256) values ('img-2', decode(repeat('cd', 200), 'hex'), 'x');
insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, signed_content_sha256, signature_image_id, intent_text_version_id, intent_text_sha256)
  values ('s-2b', 'doc-ps', 'ELECTRONIC_TABLET', 'EMPLOYER', 'JUDr. Zastupce', repeat('a',64), 'img-2', 'lt-intent', 'h');
select is(public.hr_document_missing_signers('doc-ps'), '{}'::text[], 'po podpise zamestnavatela nechyba nikto');
select lives_ok($$update public.hr_documents set status = 'SIGNED' where id = 'doc-ps'$$, 'stav SIGNED po vsetkych podpisoch');
select throws_ok($$update public.hr_documents set status = 'DRAFT' where id = 'doc-ps'$$, 'P0001', null, 'podpisany dokument sa nevrati do DRAFT');
select throws_ok($$delete from public.hr_documents where id = 'doc-ps'$$, 'P0001', null, 'dokument nejde zmazat');
select throws_ok($$update public.hr_documents set status = 'VOIDED' where id = 'doc-ps'$$, '23514', null, 'zneplatnenie vyzaduje dovod');
select lives_ok($$update public.hr_documents set status = 'VOIDED', void_reason = 'chyba v mzde - nova verze' where id = 'doc-ps'$$, 'zneplatnenie s dovodom');
select throws_ok($$update public.hr_documents set status = 'SIGNED' where id = 'doc-ps'$$, 'P0001', null, 'zneplatneny dokument nejde obnovit');
select is((select locked_at is not null from public.hr_documents where id = 'doc-2'), true, 'rucny historicky zaznam vlozeny ako SIGNED je zamknuty');
select throws_ok($$insert into public.hr_documents (id, employee_id, doc_type, origin, status) values ('doc-s', 'emp-1', 'pracovni_smlouva', 'GENERATED', 'SIGNED')$$,
  'P0001', null, 'novy dokument nejde vlozit rovno ako podpisany');
insert into public.hr_documents (id, employee_id, doc_type, origin, status) values
  ('doc-t1', 'emp-1', 'pracovni_smlouva', 'GENERATED', 'DRAFT'), ('doc-t2', 'emp-1', 'mzdovy_vymer', 'GENERATED', 'DRAFT'), ('doc-t3', 'emp-1', 'other', 'UPLOADED', 'DRAFT');
select is((select array_agg(coalesce(legal_act_type, '-') order by id) from public.hr_documents where id in ('doc-t1', 'doc-t2', 'doc-t3')),
  array['BILATERAL_CONTRACT', 'EMPLOYER_UNILATERAL', '-'], 'typ pravneho ukonu sa doplni podla druhu dokumentu');

-- ---------- 3. vyhlasenia a dorucovanie ----------
insert into public.employee_contact_declarations (id, kind, employee_id, email_snapshot, declared_at, channel)
  values ('d-21', 'S21_ADDRESS_NOTICE', 'emp-1', ' Jan.Testovaci@Example.com ', now(), 'TABLET_HR');
select is((select email_snapshot from public.employee_contact_declarations where id = 'd-21'), 'jan.testovaci@example.com', 'e-mail vo vyhlaseni normalizovany');
select throws_ok($$insert into public.employee_contact_declarations (id, kind, employee_id, email_snapshot, declared_at, channel)
  values ('d-335', 'S335_CONSENT', 'emp-1', 'jan.testovaci@example.com', now(), 'TABLET_HR')$$, '23514', null, '§ 335 suhlas bez verzie poucenia odmietnuty');
select throws_ok($$update public.employee_contact_declarations set email_snapshot = 'iny@example.com' where id = 'd-21'$$, 'P0001', null, 'vyhlasenie je nemenne');

insert into public.hr_documents (id, employee_id, doc_type, origin, status, legal_act_type, final_pdf_path, final_pdf_sha256, final_pdf_text_check, finalized_at)
  values ('doc-ps2', 'emp-1', 'pracovni_smlouva', 'GENERATED', 'READY_FOR_SIGNATURE', 'BILATERAL_CONTRACT', 'zamestnanci/emp-1/ps2.final.pdf', repeat('e',64), '{"ok":true,"server_verified":true}', now());
-- papierovy postup: sken len so zamestnancom nestaci, so zamestnavatelom ano
insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, file_path)
  values ('p-ps2-e', 'doc-ps2', 'PAPER', 'EMPLOYEE', 'Jan Testovaci', 'zamestnanci/emp-1/ps2.scan.pdf');
select throws_ok($$update public.hr_documents set status = 'SIGNED' where id = 'doc-ps2'$$, 'P0001', null, 'papierovy sken len so zamestnancom: zmluva nie je podpisana');
insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, file_path)
  values ('p-ps2-r', 'doc-ps2', 'PAPER', 'EMPLOYER', 'JUDr. Zastupce', 'zamestnanci/emp-1/ps2.scan.pdf');
update public.hr_documents set status = 'SIGNED' where id = 'doc-ps2';
select throws_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, recipient_snapshot, declaration_id)
  values ('dl-x', 'doc-ps2', 'EMAIL_S21', 'iny@example.com', 'd-21')$$, 'P0001', null, '§ 21 zaslanie na inu adresu nez z vyhlasenia odmietnute');
select lives_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, recipient_snapshot, declaration_id, queued_at, send_status)
  values ('dl-21', 'doc-ps2', 'EMAIL_S21', 'jan.testovaci@example.com', 'd-21', now(), 'QUEUED')$$, '§ 21 zaslanie na oznamenu adresu');
select throws_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, recipient_snapshot)
  values ('dl-x', 'doc-ps2', 'EMAIL_S335_WAGE_OTHER_ADDRESS', 'x@example.com')$$, 'P0001', null, '§ 335 odst. 3 (ina adresa) len pre mzdovy vymer');
select throws_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, recipient_snapshot, queued_at)
  values ('dl-mv0', 'doc-mv', 'EMAIL_S335_WAGE_OTHER_ADDRESS', 'jina.adresa@example.com', now())$$, 'P0001', null, 'nepodpisany mzdovy vymer nejde odoslat');
insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, file_path)
  values ('p-mv', 'doc-mv', 'PAPER', 'EMPLOYER', 'JUDr. Zastupce', 'zamestnanci/emp-1/mv.scan.pdf');
update public.hr_documents set status = 'SIGNED' where id = 'doc-mv';
select throws_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, recipient_snapshot, queued_at)
  values ('dl-mv0', 'doc-mv', 'EMAIL_S335_WAGE_OTHER_ADDRESS', 'jina.adresa@example.com', now())$$, 'P0001', null,
  'mzdovy vymer podpisany na papieri: elektronicke dorucenie odmietnute (migracia 55)');
-- uznavany podpis zamestnavatela + overenie certifikatu
insert into public.hr_documents (id, employee_id, doc_type, origin, status, final_pdf_path, final_pdf_sha256, final_pdf_text_check, finalized_at)
  values ('doc-mv2', 'emp-1', 'mzdovy_vymer', 'GENERATED', 'READY_FOR_SIGNATURE', 'zamestnanci/emp-1/mv2.final.pdf', repeat('9', 64), '{"ok":true,"server_verified":true}', now());
insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, signed_content_sha256, document_hash, file_path)
  values ('q-mv2', 'doc-mv2', 'ELECTRONIC_QUALIFIED', 'EMPLOYER', 'JUDr. Zastupce', repeat('9', 64), repeat('8', 64), 'zamestnanci/emp-1/mv2.pades.pdf');
update public.hr_documents set status = 'SIGNED' where id = 'doc-mv2';
select throws_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, recipient_snapshot, queued_at)
  values ('dl-mv', 'doc-mv2', 'EMAIL_S335_WAGE_OTHER_ADDRESS', 'jina.adresa@example.com', now())$$, 'P0001', null,
  'uznavany podpis s neovereným certifikatom: elektronicke dorucenie § 334 odmietnute');
insert into public.hr_signature_verifications (signature_id, result, method, service_name) values ('q-mv2', 'INDETERMINATE', 'AUTOMATIC', 'test');
select is(public.hr_signature_certificate_status('q-mv2'), 'INDETERMINATE', 'stav certifikatu = posledne overenie');
select is(public.hr_document_employer_signature_verified('doc-mv2'), false, 'neprukazne overenie nestaci');
insert into public.hr_signature_verifications (signature_id, result, method, service_name) values ('q-mv2', 'VALID', 'AUTOMATIC', 'test');
select lives_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, recipient_snapshot, queued_at)
  values ('dl-mv', 'doc-mv2', 'EMAIL_S335_WAGE_OTHER_ADDRESS', 'jina.adresa@example.com', now())$$, 'mzdovy vymer s overenym uznavanym podpisom na inu adresu povoleny');
select throws_ok($$update public.hr_document_deliveries set delivered_at = now(), delivery_basis = 'FICTION_15_DAYS' where id = 'dl-mv'$$, 'P0001', null, 'mzdovy vymer na inu adresu: ziadna fikcia dorucenia');
select throws_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, recipient_snapshot, delivered_at, delivery_basis)
  values ('dl-y', 'doc-mv2', 'EMAIL_S335_WAGE_OTHER_ADDRESS', 'a@example.com', now(), 'EMPLOYEE_CONFIRMATION')$$, 'P0001', null, 'e-mail § 334 nie je doruceny uz pri vlozeni');
update public.hr_document_deliveries set sent_at = now(), send_status = 'SENT' where id = 'dl-21';
select throws_ok($$update public.hr_document_deliveries set sent_at = now() - interval '1 day' where id = 'dl-21'$$, 'P0001', null, 'cas odoslania sa neprepisuje');

update public.employees set private_email = 'novy@example.com' where id = 'emp-1';
select is(public.hr_valid_contact_declaration('emp-1', 'S21_ADDRESS_NOTICE'), null, 'po zmene e-mailu stare § 21 oznamenie neplati (postgres)');

-- ---------- 4. RLS a role ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d1", "email": "nobody@test.local", "role": "authenticated"}';
select is((select count(*) from public.hr_document_signatures)::int, 0, 'bez HR prav ziadne podpisy');
select is((select count(*) from public.employee_contact_declarations)::int, 0, 'bez HR prav ziadne vyhlasenia');
select throws_ok($$select public.hr_kiosk_issue_unlock()$$, 'P0001', null, 'odomknutie kiosku len HR');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000b1", "email": "hr@test.local", "role": "authenticated"}';
select isnt((select count(*) from public.hr_document_deliveries)::int, 0, 'HR vidi dorucovanie');
select throws_ok($$select public.hr_admin_delete_employee('emp-2', 'test')$$, 'P0001', null, 'trvale mazanie len HR_ADMIN');
select throws_ok($$update public.employees set record_flag = 'TEST' where id = 'emp-2'$$, 'P0001', null, 'oznacenie testovacieho zaznamu len HR_ADMIN');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a1", "email": "admin@test.local", "role": "authenticated"}';
select throws_ok($$select public.hr_admin_delete_employee('emp-2', 'duplicita')$$, 'P0001', null, 'podpisany dokument blokuje mazanie neoznaceneho zaznamu');
update public.employees set record_flag = 'DUPLICATE' where id = 'emp-2';
select lives_ok($$select public.hr_admin_delete_employee('emp-2', 'duplicitni zaznam')$$, 'oznaceny duplicitny zaznam sa da zmazat');
reset role;
select is((select count(*) from public.audit_log where entity = 'employees_hard_delete' and entity_id = 'emp-2')::int, 1, 'trvale mazanie je v audite s dovodom');

-- ---------- 5. kiosk (anon) ----------
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select is((select count(*) from public.onboarding_sessions)::int, 0, 'anon necita relacie');
select is((select count(*) from public.hr_signature_images)::int, 0, 'anon necita obrazky podpisov');
select is((select count(*) from public.hr_onboarding_start_session())::int, 1, 'anon zalozi relaciu kiosku');
select isnt((select expires_at from public.hr_onboarding_start_session()), null, 'relacia ma expiraciu');
select is((public.hr_onboarding_config()->>'s335_consent_enabled'), 'false', '§ 335 suhlas predvolene vypnuty');
reset role;
update public.hr_settings set value = '{"session_ttl_hours": 8, "max_new_sessions_per_hour": 2}' where key = 'kiosk';
set local role anon;
select throws_ok($$select * from public.hr_onboarding_start_session()$$, 'P0001', null, 'limit novych relacii za hodinu');
reset role;
update public.hr_settings set value = '{"session_ttl_hours": 8, "max_new_sessions_per_hour": 30, "device_unlock_required": true}' where key = 'kiosk';
set local role anon;
select throws_ok($$select * from public.hr_onboarding_start_session('ZLYKOD')$$, 'P0001', null, 'pri zapnutom odomknuti treba platny kod');
reset role;
-- Relacia po expiracii: ulozenie zlyha a upratovanie zmaze koncept.
insert into public.onboarding_sessions (id, session_token, status, draft_data, expires_at)
  values ('onb-old', 'tok-old', 'IN_PROGRESS', '{"first_name": "Stary"}', now() - interval '1 minute');
select is(public.hr_onboarding_save_draft('tok-old', '{"x": 1}'), false, 'expirovana relacia sa neda ulozit');
select ok(public.hr_onboarding_cleanup() >= 1, 'upratovanie oznaci expirovane relacie');
select is((select draft_data from public.onboarding_sessions where id = 'onb-old'), '{}'::jsonb, 'koncept expirovanej relacie je vymazany');

select * from finish();
rollback;
