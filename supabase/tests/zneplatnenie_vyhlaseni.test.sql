-- DB testy migracie 61: podpisane vyhlasenie zamestnanca (§ 21 / § 335)
-- zneplatni len HR_ADMIN s dovodom. Iba lokalne: npx supabase test db.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'hr.void@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', 'hr.adm@test.local');
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000e1', 'Test Zneplatnovac', 'office'),
  ('00000000-0000-0000-0000-0000000000e2', 'Test Admin', 'office');
insert into public.hr_permissions (id, user_email, permissions) values
  ('p-e1', 'hr.void@test.local', array['HR_VIEW_BASIC', 'HR_VIEW_SENSITIVE', 'HR_EDIT', 'HR_DOCUMENT_VOID', 'HR_DOCUMENT_GENERATE']),
  ('p-e2', 'hr.adm@test.local', array['HR_ADMIN']);
insert into public.employees (id, first_name, last_name, private_email) values ('emp-e1', 'Edita', 'Prohlášená', 'edita@example.test');
insert into public.hr_documents (id, employee_id, doc_type, origin, status, final_pdf_path, final_pdf_sha256, final_pdf_text_check, finalized_at, variables_snapshot) values
  ('e-21', 'emp-e1', 's21_oznameni_adresy', 'GENERATED', 'READY_FOR_SIGNATURE', 'zamestnanci/emp-e1/e-21/f.pdf', repeat('1', 64),
   '{"ok": true, "server_verified": true}', now(), '{"declaration_kind": "S21_ADDRESS_NOTICE", "email": "edita@example.test"}'),
  ('e-335', 'emp-e1', 's335_souhlas', 'GENERATED', 'READY_FOR_SIGNATURE', 'zamestnanci/emp-e1/e-335/f.pdf', repeat('2', 64),
   '{"ok": true, "server_verified": true}', now(), '{"declaration_kind": "S335_CONSENT", "email": "edita@example.test"}'),
  ('e-ps', 'emp-e1', 'pracovni_smlouva', 'GENERATED', 'READY_FOR_SIGNATURE', 'zamestnanci/emp-e1/e-ps/f.pdf', repeat('3', 64),
   '{"ok": true, "server_verified": true}', now(), '{}'),
  ('e-21n', 'emp-e1', 's21_oznameni_adresy', 'GENERATED', 'READY_FOR_SIGNATURE', 'zamestnanci/emp-e1/e-21n/f.pdf', repeat('4', 64),
   '{"ok": true, "server_verified": true}', now(), '{"declaration_kind": "S21_ADDRESS_NOTICE", "email": "edita@example.test"}');
insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, document_hash, file_path) values
  ('e-21-s', 'e-21', 'PAPER', 'EMPLOYEE', 'Edita Prohlášená', repeat('a', 64), 'zamestnanci-podpisy/e-21.pdf'),
  ('e-335-s', 'e-335', 'PAPER', 'EMPLOYEE', 'Edita Prohlášená', repeat('b', 64), 'zamestnanci-podpisy/e-335.pdf'),
  ('e-ps-e', 'e-ps', 'PAPER', 'EMPLOYEE', 'Edita Prohlášená', repeat('c', 64), 'zamestnanci-podpisy/e-ps-e.pdf'),
  ('e-ps-r', 'e-ps', 'PAPER', 'EMPLOYER', 'Mgr. Jana Zkušební', repeat('d', 64), 'zamestnanci-podpisy/e-ps-r.pdf');
update public.hr_documents set status = 'SIGNED' where id in ('e-21', 'e-335', 'e-ps');

-- HR s HR_DOCUMENT_VOID, ale bez HR_ADMIN
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000e1", "email": "hr.void@test.local", "role": "authenticated"}';
select throws_like($$update public.hr_documents set status = 'VOIDED', void_reason = 'Chybně pořízený záznam' where id = 'e-21'$$,
  '%jen HR_ADMIN%', 'podpisane § 21 oznamenie nezneplatni bez HR_ADMIN');
select throws_like($$update public.hr_documents set status = 'VOIDED', void_reason = 'Chybně pořízený záznam' where id = 'e-335'$$,
  '%jen HR_ADMIN%', 'podpisany § 335 suhlas nezneplatni bez HR_ADMIN');
select lives_ok($$update public.hr_documents set status = 'VOIDED', void_reason = 'Chybná mzda' where id = 'e-ps'$$,
  'podpisanu zmluvu zneplatni HR_DOCUMENT_VOID ako doteraz');
select lives_ok($$update public.hr_documents set status = 'VOIDED', void_reason = 'nový e-mail' where id = 'e-21n'$$,
  'nepodpisane oznamenie zneplatni HR_DOCUMENT_VOID ako doteraz');
reset role;

-- HR_ADMIN: len s dovodom aspon 10 znakov
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000e2", "email": "hr.adm@test.local", "role": "authenticated"}';
select throws_like($$update public.hr_documents set status = 'VOIDED', void_reason = 'chyba' where id = 'e-21'$$,
  '%alespoň 10 znaků%', 'HR_ADMIN s prilis kratkym dovodom neprejde');
select lives_ok($$update public.hr_documents set status = 'VOIDED', void_reason = 'Chybně pořízený záznam – jiný zaměstnanec' where id = 'e-21'$$,
  'HR_ADMIN s dovodom zneplatni');
reset role;
select is((select status from public.hr_documents where id = 'e-21'), 'VOIDED', 'stav VOIDED');
select is((select status from public.hr_documents where id = 'e-335'), 'SIGNED', 'suhlas § 335 ostal podpisany');

-- server (hr_has_permission = true) - dovod je povinny aj tu
set local role service_role;
select throws_like($$update public.hr_documents set status = 'VOIDED', void_reason = 'auto' where id = 'e-335'$$,
  '%alespoň 10 znaků%', 'aj server musi uviest dovod');
reset role;

select * from finish();
rollback;
