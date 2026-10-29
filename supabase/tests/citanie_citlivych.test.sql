-- DB testy migracie 68: citlive a mzdove udaje sa citaju len cez funkcie,
-- ktore kazde citanie zapisu do nemenneho auditu. Iba lokalne. Vymyslene udaje.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'konatel.c@test.local'),
  ('00000000-0000-0000-0000-0000000000c2', 'personalistka.c@test.local'),
  ('00000000-0000-0000-0000-0000000000c3', 'ucetni.c@test.local');
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000c1', 'Test Konatel C', 'office'),
  ('00000000-0000-0000-0000-0000000000c2', 'Test Personalistka C', 'personalistika'),
  ('00000000-0000-0000-0000-0000000000c3', 'Test Ucetni C', 'ucetni_ext');
insert into public.hr_permissions (id, user_email, profile, valid_until) values
  ('p-c1', 'konatel.c@test.local', 'KONATEL', null),
  ('p-c2', 'personalistka.c@test.local', 'PERSONALISTA', null),
  ('p-c3', 'ucetni.c@test.local', 'UCTOVNIK_EXT', current_date + 30);
-- vlastny profil len so mzdami (bez HR_VIEW_SENSITIVE)
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c4', 'mzdy.c@test.local');
insert into public.profiles (id, full_name, role) values ('00000000-0000-0000-0000-0000000000c4', 'Test Mzdy C', 'ucetni_ext');
insert into public.hr_permissions (id, user_email, profile, permissions, valid_until) values
  ('p-c4', 'mzdy.c@test.local', 'VLASTNI', array['HR_VIEW_BASIC', 'HR_VIEW_PAYROLL'], current_date + 30);
insert into public.employees (id, first_name, last_name) values
  ('emp-c1', 'Cyril', 'Citany'), ('emp-c2', 'Cecilie', 'Citana');
insert into public.employee_sensitive_data (employee_id, birth_number, bank_account) values ('emp-c1', '850505/1234', '123/0100');
insert into public.employee_payroll_data (employee_id, data) values ('emp-c1', '{"mzda_castka": "41000"}'), ('emp-c2', '{}');

-- ---------- personalistka ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000c2", "email": "personalistka.c@test.local", "role": "authenticated", "aal": "aal2"}';
select throws_ok($$select birth_number from public.employee_sensitive_data$$, '42501', null, 'priame citanie rodneho cisla zakazane');
select throws_ok($$select bank_account from public.employee_sensitive_data$$, '42501', null, 'priame citanie uctu zakazane');
select throws_ok($$select data from public.employee_payroll_data$$, '42501', null, 'priame citanie mzdovych udajov zakazane');
select is((select count(*) from public.employee_sensitive_data where employee_id = 'emp-c1')::int, 1, 'existenciu zaznamu (kluc) vidi');
select is(public.hr_read_sensitive('emp-c1')->>'birth_number', '850505/1234', 'cez funkciu udaje dostane');
select is(public.hr_read_payroll('emp-c1', 'edit')->'data'->>'mzda_castka', '41000', 'mzdove udaje cez funkciu');
select is(public.hr_read_sensitive('emp-c2'), null, 'zamestnanec bez citlivych udajov -> null');
select is(public.hr_read_sensitive('emp-c1')->>'birth_number', '850505/1234', 'opakovane citanie hned po sebe');
select is((select count(*) from public.hr_read_payroll_overview(array['emp-c1', 'emp-c2']))::int, 2, 'prehlad viacerych zamestnancov');
select throws_ok($$select public.hr_read_sensitive('emp-c1', 'export')$$, 'P0001', 'Neznamy ucel citania.', 'neznamy ucel odmietnuty');
select throws_ok($$select public.hr_log_read('employee_sensitive_data', 'emp-c1', 'detail')$$, '42501', null, 'zaznam o citani sa neda vlozit priamo');
-- zapis ostava (update podla kluca / insert noveho), len upsert by potreboval pravo citat
select lives_ok($$update public.employee_sensitive_data set birth_number = '850505/9999', updated_at = now() where employee_id = 'emp-c1'$$, 'zmena citlivych udajov funguje');
select lives_ok($$update public.employee_payroll_data set data = '{"mzda_castka": "42000"}' where employee_id = 'emp-c1'$$, 'zmena mzdovych udajov funguje');
select lives_ok($$insert into public.employee_sensitive_data (employee_id, birth_number) values ('emp-c2', '860606/0000')$$, 'novy zaznam citlivych udajov funguje');
reset role;
select is((select birth_number from public.employee_sensitive_data where employee_id = 'emp-c1'), '850505/9999', 'zmena zapisana');

-- zaznamy o citani
select is((select count(*) from public.audit_log where action = 'read' and changed_by = '00000000-0000-0000-0000-0000000000c2' and entity = 'employee_sensitive_data')::int, 2,
  'citanie ma zaznam (aj ked zaznam neexistoval); opakovanie do 10 s len raz');
select ok(exists (select 1 from public.audit_log where action = 'read' and entity = 'employee_sensitive_data' and entity_id = 'emp-c1'
  and new_value = '{"purpose": "detail", "found": true}' and changed_by_role = 'personalistika' and source = 'user'), 'zaznam: kto, koho, ucel');
select ok(exists (select 1 from public.audit_log where action = 'read' and entity = 'employee_payroll_data' and entity_id = 'emp-c1' and new_value->>'purpose' = 'edit'),
  'citanie pred upravou ma ucel edit');
select is((select new_value->'employee_ids' from public.audit_log where action = 'read' and entity_id = '*' and changed_by = '00000000-0000-0000-0000-0000000000c2'), '["emp-c1", "emp-c2"]'::jsonb, 'prehlad: jeden zaznam so zoznamom');
select is((select count(*) from public.audit_log where action = 'read' and entity_id = 'emp-c1' and new_value->>'purpose' = 'export')::int, 0, 'odmietnute citanie sa nezapise');

-- ---------- profil len so mzdami: mzdy ano, citlive nie ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000c4", "email": "mzdy.c@test.local", "role": "authenticated", "aal": "aal1"}';
select throws_ok($$select public.hr_read_sensitive('emp-c1')$$, '42501', null, 'bez HR_VIEW_SENSITIVE citlive udaje nedostane');
select is(public.hr_read_payroll('emp-c1')->'data'->>'mzda_castka', '42000', 'mzdu cez funkciu vidi');
select is((select count(*) from public.audit_log where action = 'read')::int, 0, 'zaznamy o citani nevidi (nema HR_AUDIT_VIEW)');
reset role;
select ok(exists (select 1 from public.audit_log where action = 'read' and changed_by = '00000000-0000-0000-0000-0000000000c4' and entity = 'employee_payroll_data'),
  'citanie mzdovych udajov zapisane');
select is((select count(*) from public.audit_log where action = 'read' and changed_by = '00000000-0000-0000-0000-0000000000c4' and entity = 'employee_sensitive_data')::int, 0,
  'odmietnute citanie sa nezapise');

-- ---------- jednatel vidi zaznamy, nikto ich nezmeni ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000c1", "email": "konatel.c@test.local", "role": "authenticated", "aal": "aal2"}';
select ok((select count(*) from public.audit_log where action = 'read') >= 5, 'jednatel vidi zaznamy o citani');
reset role;
select throws_ok($$update public.audit_log set changed_by = null where action = 'read'$$, null, null, 'zaznam o citani sa neda zmenit');
select throws_ok($$delete from public.audit_log where action = 'read'$$, null, null, 'zaznam o citani sa neda zmazat');

-- bez prihlasenia nic
set local role anon;
select throws_ok($$select public.hr_read_payroll('emp-c1')$$, '42501', null, 'anonym funkciu nespusti');
reset role;

select * from finish();
rollback;
