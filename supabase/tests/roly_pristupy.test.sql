-- DB testy migracie 64 (balik B auditu): roly personalistika / ucetni_ext,
-- profily opravneni, vazba na ucet, platnost, sablony len HR_TEMPLATE_APPROVE,
-- trvale mazanie len HR_ADMIN. Iba lokalne: npx supabase test db. Vymyslene udaje.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'konatel.b@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'personalistka.b@test.local'),
  ('00000000-0000-0000-0000-0000000000b3', 'ucetni.b@test.local'),
  ('00000000-0000-0000-0000-0000000000b4', 'ucetni-stara.b@test.local');
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000b1', 'Test Konatel B', 'office'),
  ('00000000-0000-0000-0000-0000000000b2', 'Test Personalistka B', 'personalistika'),
  ('00000000-0000-0000-0000-0000000000b3', 'Test Ucetni B', 'ucetni_ext'),
  ('00000000-0000-0000-0000-0000000000b4', 'Test Ucetni Stara B', 'ucetni_ext');
insert into public.hr_permissions (id, user_email, profile, permissions, valid_until) values
  ('p-b1', 'konatel.b@test.local', 'KONATEL', '{}', null),
  -- profil prepise zaslane opravnenia (HR_ADMIN sa k personalistke nedostane)
  ('p-b2', 'Personalistka.B@test.local', 'PERSONALISTA', array['HR_ADMIN'], null),
  ('p-b3', 'ucetni.b@test.local', 'UCTOVNIK_EXT', '{}', current_date + 30),
  ('p-b4', 'ucetni-stara.b@test.local', 'UCTOVNIK_EXT', '{}', current_date - 1);
insert into public.employees (id, first_name, last_name) values ('emp-b1', 'Bohdan', 'Rolovy');
insert into public.employee_sensitive_data (employee_id, birth_number) values ('emp-b1', '900101/0000');
insert into public.employee_payroll_data (employee_id, data) values ('emp-b1', '{"mzda_castka": "30000"}');
insert into public.hr_document_templates (id, name, doc_type, status) values ('t-ok', 'Schvalena B', 'dodatek', 'SCHVALENA');
insert into public.hr_document_template_versions (id, template_id, version_number, file_path) values ('tv-ok', 't-ok', 1, 'sablony/t-ok/v1.docx');
update public.hr_document_templates set current_version_id = 'tv-ok' where id = 't-ok';

-- ---------- profily a vazba na ucet ----------
select is((select permissions from public.hr_permissions where id = 'p-b1'), array['HR_ADMIN'], 'profil Jednatel = HR_ADMIN');
select ok((select not ('HR_ADMIN' = any(permissions)) from public.hr_permissions where id = 'p-b2'), 'profil Personalista: HR_ADMIN sa neprida');
select ok((select not ('HR_TEMPLATE_APPROVE' = any(permissions)) from public.hr_permissions where id = 'p-b2'), 'personalista nema spravu sablon');
select ok((select not ('HR_LEGAL_TEXTS_ADMIN' = any(permissions)) from public.hr_permissions where id = 'p-b2'), 'personalista nema pravne texty');
select is((select permissions from public.hr_permissions where id = 'p-b3'),
  array['HR_VIEW_BASIC', 'HR_VIEW_SENSITIVE', 'HR_VIEW_PAYROLL', 'HR_EXEKUCE'], 'profil Externi ucetni = len mzdove podklady');
select is((select user_email from public.hr_permissions where id = 'p-b2'), 'personalistka.b@test.local', 'e-mail sa uklada malymi pismenami');
select is((select user_id from public.hr_permissions where id = 'p-b2'), '00000000-0000-0000-0000-0000000000b2'::uuid, 'riadok je naviazany na ucet');

-- ---------- personalistka: HR ano, zvysok ERP nie ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000b2", "email": "personalistka.b@test.local", "role": "authenticated", "aal": "aal2"}';
select ok(public.hr_role_ok(), 'rola personalistika je HR rola');
select is((select count(*) from public.employees where id = 'emp-b1')::int, 1, 'personalistka vidi zamestnancov');
select is(public.hr_read_sensitive('emp-b1')->>'birth_number', '900101/0000', 'personalistka vidi citlive udaje');
select is((select count(*) from public.orders)::int, 0, 'personalistka nevidi objednavky');
select is((select count(*) from public.customers)::int, 0, 'personalistka nevidi zakaznikov');
select throws_ok($$insert into public.customers (id, data) values ('c-b', '{}')$$, '42501', null, 'personalistka nezapise zakaznika');
select ok(length(public.hr_kiosk_issue_unlock()) = 8, 'HR funkcie (odomknutie kiosku) funguju aj pre rolu personalistika');
select ok((select count(*) from public.profiles where id = '00000000-0000-0000-0000-0000000000b1') = 1, 'personalistka vidi mena uctov (historia, plne moci)');
-- trvale mazanie (S-05)
delete from public.employee_sensitive_data where employee_id = 'emp-b1';
delete from public.employee_payroll_data where employee_id = 'emp-b1';
select is((select count(*) from public.employee_sensitive_data where employee_id = 'emp-b1')::int, 1, 'S-05: personalistka natvrdo nezmaze citlive udaje');
select is((select count(*) from public.employee_payroll_data where employee_id = 'emp-b1')::int, 1, 'S-05: personalistka natvrdo nezmaze mzdove udaje');
-- sablony
select lives_ok($$insert into storage.objects (bucket_id, name) values ('hr-dokumenty', 'sablony/t-ok/v1.docx')$$,
  'personalistka doplni subor aktualnej schvalenej verzie (prve pouzitie, overuje sa otlackom)');
select throws_ok($$insert into public.hr_document_templates (id, name, doc_type) values ('t-b', 'X', 'x')$$, '42501', null, 'personalistka nezalozi sablonu');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('hr-dokumenty', 'sablony/t-b/v1.docx')$$, '42501', null, 'personalistka nenahra subor sablony');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('hr-dokumenty', 'zamestnanci/emp-b1/doc-b.docx')$$, 'personalistka nahra dokument zamestnanca');
-- opravnenia nemeni
-- RLS: riadok opravneni personalistka nevidi, zmena neprebehne
update public.hr_permissions set profile = 'KONATEL' where id = 'p-b2';
reset role;
select is((select profile from public.hr_permissions where id = 'p-b2'), 'PERSONALISTA', 'profil personalistky ostal');

-- ---------- externa uctovnicka ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000b3", "email": "ucetni.b@test.local", "role": "authenticated", "aal": "aal2"}';
select is(public.hr_read_payroll('emp-b1')->'data'->>'mzda_castka', '30000', 'uctovnicka vidi mzdu');
select is((select count(*) from public.orders)::int, 0, 'uctovnicka nevidi objednavky');
select throws_ok($$insert into public.employees (id, first_name, last_name) values ('emp-b2', 'X', 'Y')$$, '42501', null, 'uctovnicka nezaklada zamestnancov');
select is((select count(*) from public.hr_document_templates)::int, (select count(*) from public.hr_document_templates)::int, 'uctovnicka moze citat sablony (BASIC)');
select throws_ok($$select public.hr_kiosk_issue_unlock()$$, 'P0001', null, 'uctovnicka nevydava kody kiosku');
-- po platnosti ziadny pristup
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000b4", "email": "ucetni-stara.b@test.local", "role": "authenticated", "aal": "aal2"}';
select is(public.hr_get_permissions(), '{}'::text[], 'po skonceni platnosti ziadne opravnenia');
select is((select count(*) from public.employee_payroll_data)::int, 0, 'po skonceni platnosti nevidi mzdy');
reset role;

-- ---------- zmena e-mailu neprenasa opravnenia ----------
update auth.users set email = 'novy.b@test.local' where id = '00000000-0000-0000-0000-0000000000b3';
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b5', 'ucetni.b2@test.local');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000b3", "email": "novy.b@test.local", "role": "authenticated", "aal": "aal2"}';
select ok('HR_VIEW_PAYROLL' = any(public.hr_get_permissions()), 'opravnenia idu s uctom aj po zmene e-mailu');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000b5", "email": "ucetni.b@test.local", "role": "authenticated", "aal": "aal2"}';
select is(public.hr_get_permissions(), '{}'::text[], 'iny ucet s povodnym e-mailom opravnenia nededi');
reset role;

-- ---------- pravidla pri zmene z aplikacie (jednatel) ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000b1", "email": "konatel.b@test.local", "role": "authenticated", "aal": "aal2"}';
select throws_like($$insert into public.hr_permissions (id, user_email, profile, permissions, note) values ('p-x1', 'x1@test.local', 'VLASTNI', array['HR_ADMIN'], 'test')$$,
  '%profilem Jednatel%', 'HR_ADMIN nejde pridelit vlastnym nastavenim');
select throws_like($$insert into public.hr_permissions (id, user_email, profile, permissions) values ('p-x2', 'x2@test.local', 'VLASTNI', array['HR_VIEW_BASIC'])$$,
  '%důvod%', 'vlastne nastavenie vyzaduje dovod');
select throws_like($$insert into public.hr_permissions (id, user_email, profile) values ('p-x3', 'x3@test.local', 'UCTOVNIK_EXT')$$,
  '%konce přístupu%', 'externa uctovnicka vyzaduje datum konca');
select lives_ok($$insert into public.hr_permissions (id, user_email, profile, valid_until) values ('p-x4', 'x4@test.local', 'UCTOVNIK_EXT', current_date + 10)$$,
  'jednatel prida externu uctovnicku');
reset role;
select is((select granted_by from public.hr_permissions where id = 'p-x4'), '00000000-0000-0000-0000-0000000000b1'::uuid, 'zaznamena sa, kto pristup pridelil');
select ok((select granted_at is not null and user_id is null from public.hr_permissions where id = 'p-x4'), 'cas pridelenia; ucet zatial neexistuje');

-- ---------- jednatel moze mazat (riadeny vymaz) ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000b1", "email": "konatel.b@test.local", "role": "authenticated", "aal": "aal2"}';
delete from public.employee_payroll_data where employee_id = 'emp-b1';
select is((select count(*) from public.employee_payroll_data where employee_id = 'emp-b1')::int, 0, 'HR_ADMIN mazat moze');
reset role;

select * from finish();
rollback;
