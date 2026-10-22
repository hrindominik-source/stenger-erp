-- DB testy fazy C (finalne PDF, podpisany original) - zapisuje len server.
-- Vymyslene udaje.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'hr2@test.local');
insert into public.profiles (id, full_name, role) values ('00000000-0000-0000-0000-0000000000e1', 'Test HR', 'office');
insert into public.hr_permissions (id, user_email, permissions)
  values ('p-e', 'hr2@test.local', array['HR_VIEW_BASIC', 'HR_VIEW_SENSITIVE', 'HR_EDIT', 'HR_DOCUMENT_GENERATE', 'HR_DOCUMENT_SIGN']);
insert into public.employees (id, first_name, last_name) values ('emp-c', 'Petr', 'Pokusný');
insert into public.hr_documents (id, employee_id, doc_type, origin, status, legal_act_type, file_path)
  values ('doc-c', 'emp-c', 'pracovni_smlouva', 'GENERATED', 'READY_FOR_SIGNATURE', 'BILATERAL_CONTRACT', 'zamestnanci/emp-c/doc-c.docx');

-- ---------- klient (authenticated) nesmie zapisat hash ani vysledok kontroly ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000e1", "email": "hr2@test.local", "role": "authenticated"}';
select throws_ok($$update public.hr_documents set final_pdf_path = 'zamestnanci/emp-c/doc-c/f.pdf', final_pdf_sha256 = repeat('a', 64), finalized_at = now(),
  final_pdf_text_check = '{"method":"pdftext-docx-snapshot-v2","ok":true,"server_verified":true}' where id = 'doc-c'$$,
  'P0001', null, 'podvrhnuty hash a vysledok kontroly z klienta odmietnuty');
select throws_ok($$update public.hr_documents set final_pdf_text_check = '{"ok":true,"server_verified":true}' where id = 'doc-c'$$,
  'P0001', null, 'podvrhnuty len vysledok kontroly odmietnuty');
select throws_ok($$insert into public.hr_documents (id, employee_id, doc_type, origin, status, final_pdf_path, final_pdf_sha256, final_pdf_text_check, finalized_at)
  values ('doc-c2', 'emp-c', 'x', 'GENERATED', 'DRAFT', 'p.pdf', repeat('a', 64), '{"ok":true,"server_verified":true}', now())$$,
  'P0001', null, 'ani pri vlozeni dokumentu nejde podvrhnut finalne PDF');
select lives_ok($$update public.hr_documents set notes = 'poznamka', updated_at = now() where id = 'doc-c'$$, 'bezne upravy dokumentu ostavaju povolene');
reset role;

-- ---------- server (service_role) ----------
set local role service_role;
select throws_ok($$update public.hr_documents set final_pdf_path = 'zamestnanci/emp-c/doc-c/f.pdf', final_pdf_sha256 = 'neplatny', finalized_at = now(),
  final_pdf_text_check = '{"ok":true,"server_verified":true}' where id = 'doc-c'$$, 'P0001', null, 'neplatny hash odmietnuty');
select throws_ok($$update public.hr_documents set final_pdf_path = 'zamestnanci/emp-c/doc-c/f.pdf', final_pdf_sha256 = repeat('a', 64), finalized_at = now(),
  final_pdf_text_check = '{"ok":false,"server_verified":true,"missing_keys":["mzda"]}' where id = 'doc-c'$$, 'P0001', null, 'neuspesna kontrola sa nefinalizuje');
select throws_ok($$update public.hr_documents set final_pdf_path = 'zamestnanci/emp-c/doc-c/f.pdf', final_pdf_sha256 = repeat('a', 64), finalized_at = now(),
  final_pdf_text_check = '{"ok":true}' where id = 'doc-c'$$, 'P0001', null, 'kontrola bez priznaku servera odmietnuta');
select lives_ok($$update public.hr_documents set final_pdf_path = 'zamestnanci/emp-c/doc-c/f1.pdf', final_pdf_sha256 = repeat('a', 64),
  finalized_at = '2000-01-01', finalized_by = '00000000-0000-0000-0000-0000000000e1',
  final_pdf_text_check = '{"method":"pdftext-docx-snapshot-v2","ok":true,"server_verified":true}' where id = 'doc-c'$$, 'server finalizuje');
select isnt((select finalized_at from public.hr_documents where id = 'doc-c'), '2000-01-01'::timestamptz, 'cas finalizacie je serverovy');
select lives_ok($$update public.hr_documents set final_pdf_path = 'zamestnanci/emp-c/doc-c/f2.pdf', final_pdf_sha256 = repeat('b', 64),
  final_pdf_text_check = '{"method":"pdftext-docx-snapshot-v2","ok":true,"server_verified":true}' where id = 'doc-c'$$, 'nova finalizacia pred podpisom');
select throws_ok($$update public.hr_documents set final_pdf_path = null, final_pdf_sha256 = null, finalized_at = null, final_pdf_text_check = null where id = 'doc-c'$$,
  'P0001', null, 'finalne PDF nejde odobrat');
reset role;

insert into public.hr_signature_images (id, png, png_sha256) values ('img-c', decode(repeat('ab', 200), 'hex'), 'x');
insert into public.hr_legal_text_versions (id, text_key, version_no, title, body, body_sha256)
  values ('lt-c', 'INTENT_BILATERAL_CONTRACT', 9, 'x', 'KONCEPT', 'x');
select throws_ok($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_content_sha256, signature_image_id, intent_text_version_id, intent_text_sha256)
  values ('s-c', 'doc-c', 'ELECTRONIC_TABLET', 'EMPLOYEE', repeat('a',64), 'img-c', 'lt-c', 'h')$$, 'P0001', null, 'podpis starej verzie finalneho PDF odmietnuty');
select lives_ok($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_content_sha256, signature_image_id, intent_text_version_id, intent_text_sha256)
  values ('s-c', 'doc-c', 'ELECTRONIC_TABLET', 'EMPLOYEE', repeat('b',64), 'img-c', 'lt-c', 'h')$$, 'podpis aktualneho finalneho PDF');

set local role service_role;
select throws_ok($$update public.hr_documents set final_pdf_path = 'zamestnanci/emp-c/doc-c/f3.pdf', final_pdf_sha256 = repeat('c', 64),
  final_pdf_text_check = '{"method":"pdftext-docx-snapshot-v2","ok":true,"server_verified":true}' where id = 'doc-c'$$, 'P0001', null, 'po podpise nova finalizacia nejde ani serveru');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000e1", "email": "hr2@test.local", "role": "authenticated"}';
select throws_ok($$update public.hr_documents set signed_pdf_path = 'zamestnanci/emp-c/doc-c/podvrh.pdf', signed_pdf_sha256 = repeat('d', 64) where id = 'doc-c'$$,
  'P0001', null, 'podpisany original z klienta odmietnuty');
select is(public.hr_object_path_visible('zamestnanci/emp-c/doc-c/f2.pdf'), true, 'finalne PDF vidi HR s pravom na citlive dokumenty');
reset role;

set local role service_role;
select lives_ok($$update public.hr_documents set signed_pdf_path = 'zamestnanci/emp-c/doc-c/podepsany-original.pdf', signed_pdf_sha256 = repeat('d', 64) where id = 'doc-c'$$,
  'server zapise podpisany original');
select throws_ok($$update public.hr_documents set signed_pdf_path = 'iny.pdf', signed_pdf_sha256 = repeat('e', 64) where id = 'doc-c'$$,
  'P0001', null, 'podpisany original sa neprepise ani serverom');
reset role;

select * from finish();
rollback;
