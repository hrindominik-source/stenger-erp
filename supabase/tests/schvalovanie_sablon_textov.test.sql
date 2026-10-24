-- DB testy migracie 66 (balik C auditu): schvaluje len jednatel, dokument
-- len zo schvalenej sablony, pouzije sa len schvaleny text, jednorazove
-- schvalenie existujucich. Iba lokalne: npx supabase test db. Vymyslene udaje.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'konatel.c@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', 'spravce.c@test.local');
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'Test Konatel C', 'office'),
  ('00000000-0000-0000-0000-0000000000d2', 'Test Spravce C', 'office');
insert into public.hr_permissions (id, user_email, profile, permissions, note) values
  ('p-c1', 'konatel.c@test.local', 'KONATEL', '{}', null),
  ('p-c2', 'spravce.c@test.local', 'VLASTNI', array['HR_VIEW_BASIC', 'HR_EDIT', 'HR_TEMPLATE_APPROVE', 'HR_LEGAL_TEXTS_ADMIN', 'HR_DOCUMENT_GENERATE'], 'test');
insert into public.employees (id, first_name, last_name) values ('emp-c1', 'Cyril', 'Schvalovany');

-- ---------- jednorazove schvalenie (migracia 66) ----------
select ok((select approved_at is not null from public.hr_document_template_versions where id = 'tpl-ps-v1'), 'existujuca sablona PS jednorazovo schvalena');
select is((select status from public.hr_legal_text_versions where text_key = 'RECEIPT_CONFIRMATION' and version_no = 1), 'SCHVALENO', 'text potvrdenia o prevzati jednorazovo schvaleny');
select is((select count(*)::int from public.hr_legal_text_versions where text_key like 'INTENT\_%' and status <> 'KONCEPT' and version_no = 1), 0,
  'texty prejavu vule ostavaju koncept (rozhodnutie jednatela)');
select is(public.hr_esign_ready_keys(), '{}'::text[], 'ziadny text prejavu vule nie je pripraveny na elektronicky podpis');
select is((select count(*)::int from public.hr_legal_text_versions where text_key in ('S21_ADDRESS_NOTICE', 'S335_NOTICE', 'S335_CONSENT', 'S335_REVOCATION') and status = 'KONCEPT'), 4,
  '§ 21 a § 335 ostavaju koncept');
select is(public.hr_current_legal_text('S21_ADDRESS_NOTICE'), null, 'koncept § 21 sa nepouzije');
select ok(exists (select 1 from public.audit_log where entity = 'hr_approval_bootstrap'), 'jednorazove schvalenie je v audite');

-- ---------- sablona: spravca pripravi, schvali len jednatel ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d2", "email": "spravce.c@test.local", "role": "authenticated", "aal": "aal2"}';
select lives_ok($$insert into public.hr_document_templates (id, name, doc_type, status) values ('t-c1', 'Dodatek C', 'dodatek', 'KE_SCHVALENI')$$, 'spravca zalozi sablonu');
select lives_ok($$insert into public.hr_document_template_versions (id, template_id, version_number, file_path, mapping_status, uploaded_by)
  values ('tv-c1', 't-c1', 1, 'sablony/t-c1/v1.docx', 'SCHVALENA', '00000000-0000-0000-0000-0000000000d2')$$, 'spravca nahra verziu (tagy OK)');
select throws_like($$update public.hr_document_templates set status = 'SCHVALENA', current_version_id = 'tv-c1' where id = 't-c1'$$,
  '%jednatel%', 'spravca sablonu priamo neschvali');
select throws_like($$select public.hr_approve_template_version('tv-c1')$$, '%jednatel%', 'spravca nema schvalovaciu funkciu');
select throws_like($$insert into public.hr_documents (id, employee_id, doc_type, origin, status, template_id, template_version_id)
  values ('d-c1', 'emp-c1', 'dodatek', 'GENERATED', 'DRAFT', 't-c1', 'tv-c1')$$, '%není schválená%', 'dokument z neschvalenej sablony nie');
reset role;
select is((select count(*)::int from public.hr_notifications where entity_id = 'tv-c1' and kind = 'KE_SCHVALENI' and resolved_at is null), 1,
  'nova verzia caka u jednatela');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d1", "email": "konatel.c@test.local", "role": "authenticated", "aal": "aal2"}';
select lives_ok($$select public.hr_approve_template_version('tv-c1', 'overeno', current_date + 365, '§ 40 ZP')$$, 'jednatel schvali');
reset role;
select is((select approved_by from public.hr_document_template_versions where id = 'tv-c1'), '00000000-0000-0000-0000-0000000000d1'::uuid, 'kto schvalil zapisala DB');
select ok((select status = 'SCHVALENA' and current_version_id = 'tv-c1' and next_review_date = current_date + 365 from public.hr_document_templates where id = 't-c1'),
  'sablona schvalena s revizii');
select is((select count(*)::int from public.hr_notifications where entity_id = 'tv-c1' and kind = 'KE_SCHVALENI' and resolved_at is null), 0, 'po schvaleni uz necaka');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d2", "email": "spravce.c@test.local", "role": "authenticated", "aal": "aal2"}';
select lives_ok($$insert into public.hr_documents (id, employee_id, doc_type, origin, status, template_id, template_version_id)
  values ('d-c2', 'emp-c1', 'dodatek', 'GENERATED', 'DRAFT', 't-c1', 'tv-c1')$$, 'dokument zo schvalenej sablony ano');
select throws_like($$update public.hr_document_template_versions set approved_at = now() - interval '1 day' where id = 'tv-c1'$$,
  '%jednatel%', 'udaje o schvaleni sa nedaju menit');
reset role;
update public.hr_document_templates set next_review_date = current_date - 1 where id = 't-c1';
select throws_like($$insert into public.hr_documents (id, employee_id, doc_type, origin, status, template_id, template_version_id)
  values ('d-c3', 'emp-c1', 'dodatek', 'GENERATED', 'DRAFT', 't-c1', 'tv-c1')$$, '%revize%', 'po termine revizie nie');

-- ---------- pravne texty ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d2", "email": "spravce.c@test.local", "role": "authenticated", "aal": "aal2"}';
insert into public.hr_legal_text_versions (id, text_key, version_no, title, body, body_sha256, status)
  select 'lt-c2', 'INTENT_TRAINING_RECORD', max(version_no) + 1, 'Projev vůle – školení', 'KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU. Nový text.', 'x', 'SCHVALENO'
  from public.hr_legal_text_versions where text_key = 'INTENT_TRAINING_RECORD';
select throws_like($$update public.hr_legal_text_versions set status = 'SCHVALENO' where id = 'lt-c2'$$, '%jednatel%', 'spravca textov priamo neschvali');
select throws_like($$select public.hr_approve_legal_text('lt-c2')$$, '%jednatel%', 'spravca nema schvalovaciu funkciu textov');
reset role;
select is((select status from public.hr_legal_text_versions where id = 'lt-c2'), 'KONCEPT', 'novy text z aplikacie je vzdy koncept');
select isnt((public.hr_current_legal_text('INTENT_TRAINING_RECORD')).id, 'lt-c2', 'koncept sa nepouzije, plati predchadzajuci schvaleny');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d1", "email": "konatel.c@test.local", "role": "authenticated", "aal": "aal2"}';
select lives_ok($$select public.hr_approve_legal_text('lt-c2', 'po kontrole', null, '§ 103 ZP')$$, 'jednatel schvali text');
reset role;
select is((public.hr_current_legal_text('INTENT_TRAINING_RECORD')).id, 'lt-c2', 'pouzije sa novo schvaleny text');
select is((select status from public.hr_legal_text_versions where text_key = 'INTENT_TRAINING_RECORD' and version_no = 1), 'KONCEPT', 'starsi koncept ostava (nepouziva sa)');
select is(public.hr_esign_ready_keys(), array['INTENT_TRAINING_RECORD'], 'po schvaleni je text pripraveny na elektronicky podpis');
update public.hr_legal_text_versions set next_review_date = current_date - 1 where id = 'lt-c2';
select is(public.hr_current_legal_text('INTENT_TRAINING_RECORD'), null, 'text po termine revizie sa nepouzije');

-- ---------- bez schvaleneho textu prejavu vole: elektronicky podpis nie, papier ano ----------
insert into public.hr_documents (id, employee_id, doc_type, origin, status, legal_act_type, file_path,
    final_pdf_path, final_pdf_sha256, final_pdf_text_check, finalized_at) values
  ('d-c-sign', 'emp-c1', 'pracovni_smlouva', 'UPLOADED', 'READY_FOR_SIGNATURE', 'BILATERAL_CONTRACT', 'zamestnanci/emp-c1/d.docx',
   'zamestnanci/emp-c1/d.pdf', repeat('a', 64), '{"ok": true, "server_verified": true}', now());
select throws_like($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_content_sha256, signature_image_id, intent_text_version_id, intent_text_sha256)
  values ('s-c-e', 'd-c-sign', 'ELECTRONIC_TABLET', 'EMPLOYEE', repeat('a', 64), 'img-c', 'lt-intent-bilateral-contract-v1', 'h')$$,
  '%schválení textů%', 'neschvaleny text prejavu vule: elektronicky podpis sa neda vytvorit (ani serverom)');
select lives_ok($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, document_hash, file_path)
  values ('s-c-p', 'd-c-sign', 'PAPER', 'EMPLOYEE', 'Cyril Schvalovany', repeat('a', 64), 'zamestnanci/emp-c1/sken.pdf')$$,
  'papierovy podpis funguje aj bez schvalenych textov');

select * from finish();
rollback;
