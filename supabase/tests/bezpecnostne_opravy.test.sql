-- DB testy migracie 60: opravy z nezavislej kontroly vetvy.
-- Iba lokalne: npx supabase test db.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'hr.z@test.local');
insert into public.profiles (id, full_name, role) values ('00000000-0000-0000-0000-0000000000d1', 'Test Personalista Z', 'office');
insert into public.hr_permissions (id, user_email, permissions) values
  ('p-z1', 'hr.z@test.local', array['HR_VIEW_BASIC', 'HR_VIEW_SENSITIVE', 'HR_VIEW_PAYROLL', 'HR_EDIT', 'HR_DOCUMENT_GENERATE',
    'HR_DOCUMENT_APPROVE', 'HR_DOCUMENT_SIGN', 'HR_DOCUMENT_SEND']);
insert into public.employees (id, first_name, last_name, private_email) values ('emp-z1', 'Zora', 'Opravena', 'zora@example.test');
insert into public.hr_documents (id, employee_id, doc_type, origin, status, final_pdf_path, final_pdf_sha256, final_pdf_text_check, finalized_at, variables_snapshot) values
  ('z-21', 'emp-z1', 's21_oznameni_adresy', 'GENERATED', 'READY_FOR_SIGNATURE', 'zamestnanci/emp-z1/z-21/f.pdf', repeat('1', 64),
   '{"ok": true, "server_verified": true, "method": "server-generated-v1"}', now(), '{"declaration_kind": "S21_ADDRESS_NOTICE", "email": "zora@example.test"}'),
  ('z-vp', 'emp-z1', 'vypoved_zamestnavatele', 'GENERATED', 'READY_FOR_SIGNATURE', 'zamestnanci/emp-z1/z-vp/f.pdf', repeat('2', 64),
   '{"ok": true, "server_verified": true}', now(), '{}'),
  ('z-ps', 'emp-z1', 'pracovni_smlouva', 'GENERATED', 'READY_FOR_SIGNATURE', 'zamestnanci/emp-z1/z-ps/f.pdf', repeat('3', 64),
   '{"ok": true, "server_verified": true}', now(), '{}'),
  ('z-dr', 'emp-z1', 'pracovni_smlouva', 'GENERATED', 'DRAFT', null, null, null, null, '{}');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d1", "email": "hr.z@test.local", "role": "authenticated"}';

-- ---------- H1/M4: podpisy len zo servera ----------
select throws_like($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, signed_content_sha256, document_hash, file_path)
  values ('z-fake', 'z-ps', 'ELECTRONIC_QUALIFIED', 'EMPLOYEE', 'Zora Opravena', repeat('3', 64), repeat('3', 64), 'any/path.pdf')$$,
  '%jen server%', 'HR nepodvrhne uznavany podpis priamym zapisom');
select throws_like($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, document_hash, file_path, scan_matches_original_confirmed_by)
  values ('z-fake2', 'z-ps', 'PAPER', 'EMPLOYEE', 'Zora Opravena', repeat('9', 64), 'zamestnanci-podpisy/z-ps-x.pdf', '00000000-0000-0000-0000-0000000000d1')$$,
  '%jen server%', 'ani papierovy sken s vlastnym otiskom');

-- ---------- H2: po finalizacii len nova verzia ----------
select throws_like($$update public.hr_documents set variables_snapshot = '{"declaration_kind": "S21_ADDRESS_NOTICE", "email": "utocnik@evil.test"}' where id = 'z-21'$$,
  '%finální PDF%', 'e-mail vo finalizovanom vyhlaseni sa nezmeni');
select throws_like($$update public.hr_documents set legal_act_type = 'EMPLOYEE_DECLARATION' where id = 'z-vp'$$, '%finální PDF%', 'typ pravneho ukonu sa nezmeni');
select throws_like($$update public.hr_documents set doc_type = 'other' where id = 'z-vp'$$, '%finální PDF%', 'druh dokumentu sa nezmeni');
select throws_like($$update public.hr_documents set employee_id = 'emp-z1', template_version_id = 'tpl-ps-v1' where id = 'z-ps'$$, '%finální PDF%', 'verzia sablony (citlivost) sa nezmeni');
select lives_ok($$update public.hr_documents set variables_snapshot = '{"x": 1}' where id = 'z-dr'$$, 'koncept bez finalneho PDF sa upravovat da');
select lives_ok($$update public.hr_documents set status = 'READY_FOR_REVIEW' where id = 'z-dr'$$, 'stav sa meni dalej');
reset role;
select lives_ok($$update public.hr_documents set variables_snapshot = variables_snapshot || '{"pages": 1}' where id = 'z-ps'$$, 'server (napr. generovanie) moze');

-- ---------- H3: dorucenia len zo servera, skutocne potvrdenie, datum ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d1", "email": "hr.z@test.local", "role": "authenticated"}';
select throws_like($$insert into public.hr_document_deliveries (id, hr_document_id, channel, delivered_at, delivery_basis, confirmation_evidence)
  values ('zd-1', 'z-vp', 'IN_PERSON_PAPER', now(), 'SIGNED_RECEIPT', '{"receipt_signature_id": "made-up"}')$$, '%jen server%', 'HR nezapise predanie priamo');
reset role;
insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, document_hash, file_path) values
  ('z-vp-r', 'z-vp', 'PAPER', 'EMPLOYER', 'Mgr. Jana Zkusebni', repeat('c', 64), 'zamestnanci-podpisy/z-vp.pdf');
update public.hr_documents set status = 'SIGNED' where id = 'z-vp';
select throws_like($$insert into public.hr_document_deliveries (id, hr_document_id, channel, delivered_at, delivery_basis, confirmation_evidence)
  values ('zd-1', 'z-vp', 'IN_PERSON_PAPER', now(), 'SIGNED_RECEIPT', '{"receipt_signature_id": "made-up"}')$$, '%podepsaný doklad%', 'vymyslene potvrdenie odmietnute (aj server)');
insert into public.hr_documents (id, employee_id, doc_type, origin, status, final_pdf_path, final_pdf_sha256, final_pdf_text_check, finalized_at, variables_snapshot) values
  ('z-pr', 'emp-z1', 'potvrzeni_prevzeti', 'GENERATED', 'READY_FOR_SIGNATURE', 'zamestnanci/emp-z1/z-pr/f.pdf', repeat('4', 64),
   '{"ok": true, "server_verified": true}', now(), '{"target_document_id": "z-ps"}');
insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, document_hash, file_path) values
  ('z-pr-e', 'z-pr', 'PAPER', 'EMPLOYEE', 'Zora Opravena', repeat('d', 64), 'zamestnanci-podpisy/z-pr.pdf');
update public.hr_documents set status = 'SIGNED' where id = 'z-pr';
select throws_like($$insert into public.hr_document_deliveries (id, hr_document_id, channel, delivered_at, delivery_basis, confirmation_evidence)
  values ('zd-1', 'z-vp', 'IN_PERSON_PAPER', now(), 'SIGNED_RECEIPT', '{"receipt_signature_id": "z-pr-e"}')$$, '%podepsaný doklad%', 'potvrdenie k inemu dokumentu odmietnute');
insert into public.hr_documents (id, employee_id, doc_type, origin, status, final_pdf_path, final_pdf_sha256, final_pdf_text_check, finalized_at, variables_snapshot) values
  ('z-pr2', 'emp-z1', 'potvrzeni_prevzeti', 'GENERATED', 'READY_FOR_SIGNATURE', 'zamestnanci/emp-z1/z-pr2/f.pdf', repeat('5', 64),
   '{"ok": true, "server_verified": true}', now(), '{"target_document_id": "z-vp"}');
insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, document_hash, file_path) values
  ('z-pr2-e', 'z-pr2', 'PAPER', 'EMPLOYEE', 'Zora Opravena', repeat('e', 64), 'zamestnanci-podpisy/z-pr2.pdf');
update public.hr_documents set status = 'SIGNED' where id = 'z-pr2';
select throws_like($$insert into public.hr_document_deliveries (id, hr_document_id, channel, delivered_at, delivery_basis, confirmation_evidence)
  values ('zd-1', 'z-vp', 'IN_PERSON_PAPER', now() - interval '400 days', 'SIGNED_RECEIPT', '{"receipt_signature_id": "z-pr2-e"}')$$,
  '%před podpisem%', 'predanie pred podpisom dokumentu odmietnute');
select lives_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, delivered_at, delivery_basis, confirmation_evidence)
  values ('zd-1', 'z-vp', 'IN_PERSON_PAPER', now(), 'SIGNED_RECEIPT', '{"receipt_signature_id": "z-pr2-e"}')$$, 'skutocne podpisane potvrdenie k dokumentu prijate');

-- ---------- M2: uznavany podpis zamestnanca az s overenym certifikatom ----------
insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, signed_content_sha256, document_hash, file_path) values
  ('z-q-e', 'z-ps', 'ELECTRONIC_QUALIFIED', 'EMPLOYEE', 'Zora Opravena', repeat('3', 64), repeat('6', 64), 'zamestnanci/emp-z1/z-ps/pades.pdf');
select is(public.hr_document_missing_signers('z-ps'), array['EMPLOYEE', 'EMPLOYER'], 'neovereny uznavany podpis zamestnanca sa nepocita');
insert into public.hr_signature_verifications (signature_id, result, method, service_name) values ('z-q-e', 'VALID', 'AUTOMATIC', 'test');
select is(public.hr_document_missing_signers('z-ps'), array['EMPLOYER'], 'po overeni certifikatu (VALID) sa pocita');

-- ---------- M3: verzia sablony ----------
select throws_ok($$update public.hr_document_template_versions set required_permissions = array['HR_VIEW_BASIC'] where id = 'tpl-ps-v1'$$,
  'P0001', null, 'citlivost verzie sablony sa nemeni (ani postgres)');

-- ---------- L1, L2, L4 ----------
select ok(not has_function_privilege('authenticated', 'public.hr_signing_token_check_code(text, boolean, text)', 'execute'), 'kontrolu kodu vola len server');
select ok(not has_function_privilege('anon', 'public.hr_training_ok(text, text)', 'execute'), 'anon nevola hr_training_ok');
select ok(not has_function_privilege('anon', 'public.hr_signature_certificate_status(text)', 'execute'), 'anon nevola hr_signature_certificate_status');
select ok(not has_function_privilege('anon', 'public.hr_document_employer_signature_verified(text)', 'execute'), 'anon nevola hr_document_employer_signature_verified');
select throws_like($$select public.hr_onboarding_save_draft('x', jsonb_build_object('pad', repeat('x', 300000)))$$, '%příliš velký%', 'prilis velky koncept dotaznika odmietnuty');

select * from finish();
rollback;
