-- DB testy migracie 65 (balik A auditu): nemenny audit, autor pri zapisoch
-- servera, audit bez hasov kodov, upozornenia pre jednatela, pristup k
-- auditu podla opravneni. Iba lokalne: npx supabase test db. Vymyslene udaje.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'konatel.a@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'personalistka.a@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', 'auditor.a@test.local');
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Test Konatel A', 'office'),
  ('00000000-0000-0000-0000-0000000000a2', 'Test Personalistka A', 'personalistika'),
  ('00000000-0000-0000-0000-0000000000a3', 'Test Auditor A', 'personalistika');
insert into public.hr_permissions (id, user_email, profile, permissions, note) values
  ('p-a1', 'konatel.a@test.local', 'KONATEL', '{}', null),
  ('p-a2', 'personalistka.a@test.local', 'PERSONALISTA', '{}', null),
  ('p-a3', 'auditor.a@test.local', 'VLASTNI', array['HR_VIEW_BASIC', 'HR_AUDIT_VIEW'], 'test auditu');
insert into public.employees (id, first_name, last_name) values ('emp-a1', 'Adam', 'Dohledovy');
insert into public.employee_payroll_data (employee_id, data) values ('emp-a1', '{"mzda_castka": "30000"}');

-- ---------- nemenny audit ----------
select throws_like($$update public.audit_log set action = 'x' where entity = 'employees'$$, '%nelze menit%', 'audit sa neda menit (ani postgres)');
select throws_like($$delete from public.audit_log where entity = 'employees'$$, '%nelze menit%', 'audit sa neda mazat');
select throws_like($$truncate public.audit_log$$, '%nelze menit%', 'audit sa neda vyprazdnit');

-- ---------- autor pri zapise servera, bez hasov kodov ----------
insert into public.hr_kiosk_unlocks (id, code_sha256, issued_by, expires_at) values
  ('unl-a1', repeat('a', 64), '00000000-0000-0000-0000-0000000000a2', now() + interval '1 hour');
select is((select changed_by from public.audit_log where entity = 'hr_kiosk_unlocks' and entity_id = 'unl-a1'),
  '00000000-0000-0000-0000-0000000000a2'::uuid, 'zapis bez prihlasenia: autor z issued_by');
select is((select source from public.audit_log where entity = 'hr_kiosk_unlocks' and entity_id = 'unl-a1'), 'server', 'zdroj = server');
select ok((select not (new_value ? 'code_sha256') from public.audit_log where entity = 'hr_kiosk_unlocks' and entity_id = 'unl-a1'),
  'haš kodu sa do auditu nezapise');
select ok((select count(*) from public.audit_log where entity = 'hr_permissions' and entity_id = 'p-a2') > 0, 'zmeny opravneni su v audite');
select ok((select count(*) from public.audit_log where entity = 'profiles' and entity_id = '00000000-0000-0000-0000-0000000000a2') > 0, 'zmeny uctov su v audite');

-- ---------- upozornenia ----------
select ok((select count(*) from public.hr_notifications where event_type = 'PERMISSIONS_CHANGED' and entity_id = 'p-a2') > 0, 'novy pristup -> upozornenie');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a2", "email": "personalistka.a@test.local", "role": "authenticated"}';
update public.employee_payroll_data set data = data || '{"mzda_castka": "32000", "mzda_platnost_od": "2026-11-01"}' where employee_id = 'emp-a1';
select is((select count(*) from public.hr_notifications)::int, 0, 'personalistka upozornenia nevidi');
select throws_like($$select public.hr_konatel_summary(7)$$, '%Neopravneno%', 'personalistka nedostane suhrn');
reset role;
select is((select data->>'z' from public.hr_notifications where event_type = 'WAGE_CHANGED' and data->>'na' = '32000'), '30000', 'zmena mzdy personalistkou -> upozornenie s novou mzdou');
select ok((select read_at is null and actor_id = '00000000-0000-0000-0000-0000000000a2' from public.hr_notifications where event_type = 'WAGE_CHANGED' and data->>'na' = '32000'),
  'upozornenie je neprecitane, autor personalistka');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a1", "email": "konatel.a@test.local", "role": "authenticated"}';
update public.employee_payroll_data set data = data || '{"mzda_castka": "33000"}' where employee_id = 'emp-a1';
select ok((select read_at is not null from public.hr_notifications where event_type = 'WAGE_CHANGED' and data->>'na' = '33000'),
  'krok samotneho jednatela je rovno precitany');
select ok((select count(*) from public.hr_notifications) > 0, 'jednatel upozornenia vidi');
select throws_like($$update public.hr_notifications set title = 'iny' where event_type = 'WAGE_CHANGED'$$, '%nelze menit%', 'obsah upozornenia sa neda zmenit');
update public.hr_notifications set read_at = now() where event_type = 'WAGE_CHANGED' and data->>'na' = '32000';
select is((select read_by from public.hr_notifications where event_type = 'WAGE_CHANGED' and data->>'na' = '32000'),
  '00000000-0000-0000-0000-0000000000a1'::uuid, 'precitane - kto');
select throws_ok($$delete from public.hr_notifications$$, '42501', null, 'upozornenia sa nedaju zmazat');
select ok((public.hr_konatel_summary(7)->>'neprectene') is not null, 'jednatel dostane suhrn');
select ok((select count(*) from public.audit_log where entity = 'hr_permissions') > 0, 'jednatel vidi cely audit (aj opravnenia)');
reset role;

-- sablona ke schvaleniu -> vyriesene po schvaleni
insert into public.hr_document_templates (id, name, doc_type) values ('t-a1', 'Sablona A', 'dodatek');
insert into public.hr_document_template_versions (id, template_id, version_number, file_path, mapping_status)
  values ('tv-a1', 't-a1', 1, 'sablony/t-a1/v1.docx', 'K_MAPOVANI');
select is((select count(*) from public.hr_notifications where kind = 'KE_SCHVALENI' and entity_id = 'tv-a1' and resolved_at is null)::int, 1,
  'nova verzia sablony caka na schvalenie');
update public.hr_document_template_versions set mapping_status = 'SCHVALENA' where id = 'tv-a1';
select is((select count(*) from public.hr_notifications where kind = 'KE_SCHVALENI' and entity_id = 'tv-a1' and resolved_at is null)::int, 0,
  'po schvaleni uz necaka');

-- ---------- HR_AUDIT_VIEW len entity, ku ktorym ma pravo na udaje ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a3", "email": "auditor.a@test.local", "role": "authenticated"}';
select ok((select count(*) from public.audit_log where entity = 'employees' and entity_id = 'emp-a1') > 0, 'HR_AUDIT_VIEW vidi audit zamestnancov');
select is((select count(*) from public.audit_log where entity = 'employee_payroll_data')::int, 0, 'bez HR_VIEW_PAYROLL nevidi audit mzdy');
select is((select count(*) from public.audit_log where entity = 'hr_permissions')::int, 0, 'nevidi audit opravneni');
reset role;

select * from finish();
rollback;
