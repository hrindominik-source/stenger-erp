-- DB testy migracie 80: personalistka nahra existujuci podpisany dokument
-- (len povoleny typ a cesta), jednatel dostane upozornenie, pristup podla typu.
-- Iba lokalne. Vymyslene udaje.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'konatel.nahr@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', 'personalistka.nahr@test.local'),
  ('00000000-0000-0000-0000-0000000000d3', 'ucetni.nahr@test.local');
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'Test Konatel Nahr', 'office'),
  ('00000000-0000-0000-0000-0000000000d2', 'Test Personalistka Nahr', 'personalistika'),
  ('00000000-0000-0000-0000-0000000000d3', 'Test Ucetni Nahr', 'ucetni_ext');
insert into public.hr_permissions (id, user_email, profile, valid_until) values
  ('p-d1', 'konatel.nahr@test.local', 'KONATEL', null),
  ('p-d2', 'personalistka.nahr@test.local', 'PERSONALISTA', null),
  ('p-d3', 'ucetni.nahr@test.local', 'UCTOVNIK_EXT', current_date + 30);
insert into public.employees (id, first_name, last_name) values ('emp-d', 'Dana', 'Dokladová');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d2", "email": "personalistka.nahr@test.local", "role": "authenticated", "aal": "aal2"}';
select lives_ok($$insert into public.hr_documents (id, employee_id, doc_type, origin, status, is_manual_history_entry, file_path, variables_snapshot)
  values ('doc-d1', 'emp-d', 'pracovni_smlouva', 'UPLOADED', 'SIGNED', true, 'zamestnanci/emp-d/historie/doc-d1.pdf',
    '{"doc_label": "Pracovní smlouva", "datum_podpisu": "2024-03-01"}')$$, 'personalistka nahra podpisanu zmluvu');
select lives_ok($$insert into public.hr_documents (id, employee_id, doc_type, origin, status, is_manual_history_entry, file_path)
  values ('doc-d2', 'emp-d', 'mzdovy_vymer', 'UPLOADED', 'SIGNED', true, 'zamestnanci/emp-d/historie/doc-d2.pdf')$$, 'personalistka nahra mzdovy vymer');
select is((select count(*)::int from public.hr_documents where employee_id = 'emp-d'), 2, 'personalistka vidi oba nahrane');
select ok((select locked_at is not null from public.hr_documents where id = 'doc-d1'), 'nahrany dokument je zamknuty');
select throws_ok($$insert into public.hr_documents (id, employee_id, doc_type, origin, status, is_manual_history_entry, file_path)
  values ('doc-d3', 'emp-d', 'pracovni_smlouva', 'UPLOADED', 'SIGNED', true, 'zamestnanci/ine/historie/x.pdf')$$, '42501', null, 'cudzia cesta suboru zamietnuta');
select throws_ok($$insert into public.hr_documents (id, employee_id, doc_type, origin, status, is_manual_history_entry, file_path)
  values ('doc-d4', 'emp-d', 's335_souhlas', 'UPLOADED', 'SIGNED', true, 'zamestnanci/emp-d/historie/x.pdf')$$, '42501', null, 'nepovoleny typ zamietnuty');
select throws_ok($$insert into public.hr_documents (id, employee_id, doc_type, origin, status, is_manual_history_entry, file_path)
  values ('doc-d5', 'emp-d', 'pracovni_smlouva', 'GENERATED', 'SIGNED', true, 'zamestnanci/emp-d/historie/x.pdf')$$, '42501', null, 'vygenerovany ako historicky zamietnuty');
select throws_ok($$update public.hr_documents set doc_type = 'dodatek' where id = 'doc-d1'$$, null, null, 'typ nahraneho nelze menit');

-- uctovnicka: vymer (mzdovy pristup) vidi, zmluvu tiez (HR_VIEW_SENSITIVE ma)
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d3", "email": "ucetni.nahr@test.local", "role": "authenticated", "aal": "aal2"}';
select is((select count(*)::int from public.hr_documents where employee_id = 'emp-d'), 2, 'uctovnicka vidi zmluvu aj vymer');
reset role;

select is(public.hr_document_required_permissions('doc-d2'), array['HR_VIEW_PAYROLL'], 'vymer vyzaduje mzdovy pristup');
select is(public.hr_document_required_permissions('doc-d1'), array['HR_VIEW_SENSITIVE'], 'zmluva vyzaduje citlive udaje');
insert into public.hr_documents (id, employee_id, doc_type, origin, status) values ('doc-d6', 'emp-d', 'pracovni_smlouva', 'UPLOADED', 'DRAFT');
select is(public.hr_document_required_permissions('doc-d6'), array['HR_ADMIN'], 'iny nahrany dokument ostava len jednatel');

select is((select count(*)::int from public.hr_notifications where event_type = 'DOCUMENT_UPLOADED' and employee_id = 'emp-d'), 2, 'jednatel ma 2 upozornenia');
select ok((select title like '%Pracovní smlouva – Dana Dokladová (nahrál: Test Personalistka Nahr)%' from public.hr_notifications
  where event_type = 'DOCUMENT_UPLOADED' and entity_id = 'doc-d1'), 'upozornenie: co, komu, kto');

select * from finish();
rollback;
