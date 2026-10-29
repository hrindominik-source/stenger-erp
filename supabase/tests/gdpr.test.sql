-- DB testy migracie 72 (balik F): lehoty uchovavania, anonymizacia so
-- schvalenim, export so zaznamom, dovod opravy, spracovatelia.
-- Iba lokalne. Vymyslene udaje.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'konatel.gdpr@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'personalistka.gdpr@test.local'),
  ('00000000-0000-0000-0000-0000000000b3', 'ucetni.gdpr@test.local');
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000b1', 'Test Konatel Gdpr', 'office'),
  ('00000000-0000-0000-0000-0000000000b2', 'Test Personalistka Gdpr', 'personalistika'),
  ('00000000-0000-0000-0000-0000000000b3', 'Test Ucetni Gdpr', 'office');
insert into public.hr_permissions (id, user_email, profile) values
  ('p-g1', 'konatel.gdpr@test.local', 'KONATEL'),
  ('p-g2', 'personalistka.gdpr@test.local', 'PERSONALISTA'),
  ('p-g3', 'ucetni.gdpr@test.local', 'UCTOVNIK_EXT');
insert into public.employees (id, first_name, last_name, phone, private_email, data) values
  ('emp-g-old', 'Gustav', 'Dávnovský', '+420 600 000 001', 'gustav@example.test', '{"nepritomnosti": [1]}'),
  ('emp-g-act', 'Gita', 'Aktivní', null, null, '{}');
insert into public.employee_sensitive_data (employee_id, birth_number) values ('emp-g-old', '000101/0001'), ('emp-g-act', '000202/0002');
insert into public.employee_payroll_data (employee_id, data) values ('emp-g-old', '{"mzda_historie": []}');
insert into public.employment_relationships (id, employee_id, status, employment_type, start_date, termination_date) values
  ('er-g-old', 'emp-g-old', 'ENDED', 'doba_neurcita', '2001-01-01', '2005-06-30'),
  ('er-g-act', 'emp-g-act', 'ACTIVE', 'doba_neurcita', '2025-01-01', null);
insert into public.hr_documents (id, employee_id, doc_type, origin, status) values ('g-doc', 'emp-g-old', 'other', 'GENERATED', 'DRAFT');

-- ---------- lehoty ----------
select is((select count(*) from public.hr_retention_rules where period_years is null)::int, 10, 'vsetky kategorie bez hodnot (nevymyslat)');
select throws_ok($$update public.hr_retention_rules set period_years = 5 where key = 'BOZP'$$, '23514', null, 'lehota bez zdroja a akcie nejde');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000b2", "email": "personalistka.gdpr@test.local", "role": "authenticated", "aal": "aal2"}';
select is((select count(*) from public.hr_retention_rules)::int, 10, 'personalistka lehoty vidi');
update public.hr_retention_rules set period_years = 1, period_from = 'KONEC_POMERU', action = 'SKARTOVAT', source = 'x' where key = 'BOZP';
select is((select period_years from public.hr_retention_rules where key = 'BOZP'), null::numeric, 'personalistka lehoty nemeni');
select is((public.hr_anonymization_ready('emp-g-old')->>'ready')::boolean, false, 'bez lehot anonymizacia nejde');
select ok(public.hr_anonymization_ready('emp-g-old')->>'reason' like '%nejsou vyplněny%', 'dovod: nevyplnene lehoty');
select throws_like($$select public.hr_request_approval('ANONYMIZE', 'emp-g-old', 'Uplynuly lhůty')$$, '%nejsou vyplněny%', 'ziadost bez lehot nejde');
select is((select count(*) from public.hr_retention_due())::int, 0, 'bez lehot ziadna pripomienka');

-- jednatel vyplni lehoty (testovacie hodnoty, nie skutocne)
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000b1", "email": "konatel.gdpr@test.local", "role": "authenticated", "aal": "aal2"}';
update public.hr_retention_rules set period_years = 10, period_from = 'KONEC_POMERU', action = 'ANONYMIZOVAT', source = 'TEST – nie skutočná lehota';
reset role;
select ok((select bool_and(entered_by = '00000000-0000-0000-0000-0000000000b1') from public.hr_retention_rules), 'kto zadal');
select ok(exists (select 1 from public.hr_notifications where event_type = 'RETENTION_CHANGED'), 'upozornenie jednatelovi');
select ok(exists (select 1 from public.audit_log where entity = 'hr_retention_rules' and action = 'update'), 'audit');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000b2", "email": "personalistka.gdpr@test.local", "role": "authenticated", "aal": "aal2"}';
select ok((select count(*) from public.hr_retention_due() where employee_id = 'emp-g-old') = 10, 'pripomienka pre byvaleho (lehota uplynula)');
select is((select count(*) from public.hr_retention_due() where employee_id = 'emp-g-act')::int, 0, 'aktivny bez pripomienky');
select is((public.hr_anonymization_ready('emp-g-act')->>'ready')::boolean, false, 'aktivny pomer: nie');
select is((public.hr_anonymization_ready('emp-g-old')->>'ready')::boolean, true, 'po uplynuti lehot pripraveny');

-- ---------- anonymizacia so schvalenim ----------
select throws_like($$select public.hr_anonymize_employee('emp-g-old', 'Uplynuly lhůty')$$, '%schvaluje jednatel%', 'bez schvalenia nie');
select throws_like($$select public.hr_request_approval('ANONYMIZE', 'emp-g-old', 'Uplynuly lhůty', '{}', true, 'telefonicky')$$, '%nemá nouzový postup%', 'nudzovy postup nie');
create temp table an as select public.hr_request_approval('ANONYMIZE', 'emp-g-old', 'Uplynuly všechny lhůty') as id;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000b1", "email": "konatel.gdpr@test.local", "role": "authenticated", "aal": "aal2"}';
select lives_ok($$select public.hr_decide_approval((select id from an), true)$$, 'jednatel schvali');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000b2", "email": "personalistka.gdpr@test.local", "role": "authenticated", "aal": "aal2"}';
select lives_ok($$select public.hr_anonymize_employee('emp-g-old', 'Uplynuly všechny lhůty')$$, 'po schvaleni anonymizuje');
reset role;
select is((select array[first_name, phone, private_email] from public.employees where id = 'emp-g-old'), array['Anonymizováno', null, null], 'osobne udaje prec');
select ok((select data ? 'anonymized_at' and not data ? 'nepritomnosti' from public.employees where id = 'emp-g-old'), 'data vycistene, cas anonymizacie');
select is((select count(*) from public.employee_sensitive_data where employee_id = 'emp-g-old')::int, 0, 'citlive udaje prec');
select is((select count(*) from public.employee_payroll_data where employee_id = 'emp-g-old')::int, 0, 'mzdove udaje prec');
select is((select count(*) from public.employment_relationships where employee_id = 'emp-g-old')::int, 1, 'pomer (datumy) ostava');
select is((select count(*) from public.hr_documents where employee_id = 'emp-g-old')::int, 1, 'dokumenty ostavaju (rozhodne pravnicka)');
select ok(exists (select 1 from public.hr_notifications where event_type = 'EMPLOYEE_ANONYMIZED' and entity_id = 'emp-g-old'), 'upozornenie jednatelovi');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000b2", "email": "personalistka.gdpr@test.local", "role": "authenticated", "aal": "aal2"}';
select ok(public.hr_anonymization_ready('emp-g-old')->>'reason' like '%už je anonymizován%', 'druhy raz nie');

-- ---------- export ----------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000b2", "email": "personalistka.gdpr@test.local", "role": "authenticated", "aal": "aal2"}';
create temp table ex as select public.hr_export_employee('emp-g-act') as v;
select is((select v->'sensitive'->>'birth_number' from ex), '000202/0002', 'export obsahuje citlive udaje');
select is((select jsonb_array_length(v->'employments') from ex), 1, 'export obsahuje pomery');
reset role;
select ok(exists (select 1 from public.audit_log where action = 'read' and entity = 'employees' and entity_id = 'emp-g-act'
  and new_value->>'purpose' = 'export' and changed_by = '00000000-0000-0000-0000-0000000000b2'), 'export zapisany (kto, koho)');
select ok(exists (select 1 from public.hr_notifications where event_type = 'EMPLOYEE_EXPORTED' and entity_id = 'emp-g-act'), 'jednatel upozorneny');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000b3", "email": "ucetni.gdpr@test.local", "role": "authenticated", "aal": "aal2"}';
select lives_ok($$select public.hr_export_employee('emp-g-act')$$, 'ucetna (citlive + mzdy) exportuje');
select throws_ok($$select public.hr_record_correction('emp-g-act', 'oprava')$$, '42501', null, 'ucetna bez HR_EDIT dovod nezapisuje');

-- ---------- dovod opravy ----------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000b2", "email": "personalistka.gdpr@test.local", "role": "authenticated", "aal": "aal2"}';
update public.employees set phone = '+420 600 000 002' where id = 'emp-g-act';
select throws_like($$select public.hr_record_correction('emp-g-act', ' ')$$, '%důvod%', 'prazdny dovod nie');
create temp table co as select public.hr_record_correction('emp-g-act', 'Zaměstnanec nahlásil nové číslo') as id;
select is((select cardinality(audit_ids) from public.hr_corrections where id = (select id from co)), 1, 'dovod naviazany na zmenu');
create temp table co2 as select public.hr_record_correction('emp-g-act', 'Bez další změny') as id;
select is((select cardinality(audit_ids) from public.hr_corrections where id = (select id from co2)), 0, 'ta ista zmena sa druhy raz nenaviaze');

-- ---------- spracovatelia ----------
select is((select count(*) from public.hr_processors)::int, 0, 'personalistka spracovatelov nevidi');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000b1", "email": "konatel.gdpr@test.local", "role": "authenticated", "aal": "aal2"}';
select is((select count(*) from public.hr_processors where dpa_status = 'NEOVERENO')::int, 6, 'jednatel vidi 6 spracovatelov, zmluvy neoverene');
select lives_ok($$update public.hr_processors set dpa_status = 'UZAVRENA', note = 'test' where id = 'proc-netlify'$$, 'jednatel upravi');
select is((select updated_by from public.hr_processors where id = 'proc-netlify'), '00000000-0000-0000-0000-0000000000b1'::uuid, 'kto upravil');

select * from finish();
rollback;
