-- DB testy migracie 77: povinny dovod zmeny vynuteny v DB (mzda, pozicia,
-- typ a doba zmluvy, nastup a skoncenie, RC, cislo uctu, ZP). Vynimka:
-- service_role a migracie. Iba lokalne. Vymyslene udaje.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'konatel.dv@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', 'personalistka.dv@test.local'),
  ('00000000-0000-0000-0000-0000000000d3', 'personalistka2.dv@test.local'),
  ('00000000-0000-0000-0000-0000000000d4', 'ucetni.dv@test.local');
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'Test Konatel DV', 'office'),
  ('00000000-0000-0000-0000-0000000000d2', 'Test Personalistka DV', 'personalistika'),
  ('00000000-0000-0000-0000-0000000000d3', 'Test Personalistka2 DV', 'personalistika'),
  ('00000000-0000-0000-0000-0000000000d4', 'Test Ucetni DV', 'office');
insert into public.hr_permissions (id, user_email, profile) values
  ('p-dv1', 'konatel.dv@test.local', 'KONATEL'),
  ('p-dv2', 'personalistka.dv@test.local', 'PERSONALISTA'),
  ('p-dv3', 'personalistka2.dv@test.local', 'PERSONALISTA'),
  ('p-dv4', 'ucetni.dv@test.local', 'UCTOVNIK_EXT');
insert into public.employees (id, first_name, last_name, health_insurance_company, phone) values
  ('emp-dv', 'David', 'Důvodný', '111', '+420 600 000 001'),
  ('emp-dv2', 'Dita', 'Druhá', '111', null);
insert into public.employee_sensitive_data (employee_id, birth_number, bank_account) values
  ('emp-dv', '000101/0001', '1/0100'), ('emp-dv2', '000202/0002', '2/0100');
insert into public.employee_payroll_data (employee_id, data) values
  ('emp-dv', '{"mzda_historie": [{"platnost_od": "2026-01-01", "mzda_castka": 30000}], "poznamka": "a"}');
insert into public.employment_relationships (id, employee_id, status, employment_type, start_date, weekly_hours) values
  ('er-dv', 'emp-dv', 'ACTIVE', 'doba_neurcita', '2026-01-01', 40);


-- ---------- bez dovodu: odmietnute ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d2", "email": "personalistka.dv@test.local", "role": "authenticated", "aal": "aal2"}';
select throws_like($$update public.employees set health_insurance_company = '205' where id = 'emp-dv'$$, '%zdravotní pojišťovna%vyžaduje důvod%', 'ZP bez dovodu nie');
select throws_like($$update public.employee_sensitive_data set birth_number = '000101/0002' where employee_id = 'emp-dv'$$, '%rodné číslo%', 'RC bez dovodu nie');
select throws_like($$update public.employee_sensitive_data set bank_account = '9/0100' where employee_id = 'emp-dv'$$, '%číslo účtu%', 'ucet bez dovodu nie');
select throws_like($$update public.employee_payroll_data set data = '{"mzda_historie": [{"platnost_od": "2026-01-01", "mzda_castka": 32000}], "poznamka": "a"}' where employee_id = 'emp-dv'$$,
  '%mzda%', 'mzda bez dovodu nie');
select throws_like($$update public.employment_relationships set start_date = '2026-02-01' where id = 'er-dv'$$, '%datum nástupu%', 'nastup bez dovodu nie');
select throws_like($$update public.employment_relationships set termination_date = '2026-12-31' where id = 'er-dv'$$, '%datum skončení%', 'skoncenie bez dovodu nie');
select throws_like($$update public.employment_relationships set employment_type = 'doba_urcita', fixed_term_end_date = '2027-01-01' where id = 'er-dv'$$, '%typ a doba smlouvy%', 'typ a doba bez dovodu nie');
select throws_like($$update public.employment_relationships set data = coalesce(data, '{}') || '{"pozice_kategorie": "HI-002"}' where id = 'er-dv'$$, '%pozice%', 'pozicia bez dovodu nie');

-- ---------- ostatne polia bez dovodu ----------
select lives_ok($$update public.employees set phone = '+420 600 000 002' where id = 'emp-dv'$$, 'telefon bez dovodu ide');
select lives_ok($$update public.employee_payroll_data set data = '{"mzda_historie": [{"platnost_od": "2026-01-01", "mzda_castka": 30000}], "poznamka": "b"}' where employee_id = 'emp-dv'$$, 'ine mzdove udaje bez dovodu');
select lives_ok($$update public.employment_relationships set weekly_hours = 30 where id = 'er-dv'$$, 'uvazok bez dovodu (nie je v zozname)');
select lives_ok($$insert into public.employees (id, first_name, last_name, health_insurance_company) values ('emp-dv-new', 'Nový', 'Zaměstnanec', '201')$$, 'novy zamestnanec nie je zmena');

-- ---------- s dovodom ----------
select throws_like($$select public.hr_change_reason_begin('emp-dv', 'ok', '{}')$$, '%alespoň 5 znaků%', 'kratky dovod nie');
create temp table r1 as select public.hr_change_reason_begin('emp-dv', 'Zaměstnanec změnil pojišťovnu a účet', array['zdravotní pojišťovna', 'číslo účtu']) as id;
select lives_ok($$update public.employees set health_insurance_company = '205' where id = 'emp-dv'$$, 'ZP s dovodom ide');
select lives_ok($$update public.employee_sensitive_data set bank_account = '9/0100' where employee_id = 'emp-dv'$$, 'ucet s dovodom ide');
select throws_like($$update public.employee_sensitive_data set bank_account = '8/0100' where employee_id = 'emp-dv2'$$, '%číslo účtu%', 'dovod plati len pre toho zamestnanca');
select lives_ok($$select public.hr_change_reason_finish((select id from r1))$$, 'naviazanie zmien');
select throws_like($$select public.hr_change_reason_finish((select id from r1))$$, '%nenalezen%', 'druhy raz nie');

-- dovod ineho pouzivatela sa nepocita
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d3", "email": "personalistka2.dv@test.local", "role": "authenticated", "aal": "aal2"}';
select throws_like($$update public.employees set health_insurance_company = '111' where id = 'emp-dv'$$, '%vyžaduje důvod%', 'cudzi dovod nestaci');
reset role;
select ok((select cardinality(audit_ids) from public.hr_corrections where id = (select id from r1)) >= 2, 'zmeny naviazane na dovod');
select is((select fields from public.hr_corrections where id = (select id from r1)), array['zdravotní pojišťovna', 'číslo účtu'], 'polia ulozene');

-- starsi dovod (> 5 min) neplati
update public.hr_corrections set created_at = now() - interval '6 minutes' where id = (select id from r1);
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d2", "email": "personalistka.dv@test.local", "role": "authenticated", "aal": "aal2"}';
select throws_like($$update public.employees set health_insurance_company = '111' where id = 'emp-dv'$$, '%vyžaduje důvod%', 'stary dovod neplati');

-- jednatel tiez s dovodom
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d1", "email": "konatel.dv@test.local", "role": "authenticated", "aal": "aal2"}';
select throws_like($$update public.employees set health_insurance_company = '111' where id = 'emp-dv'$$, '%vyžaduje důvod%', 'aj jednatel potrebuje dovod');

-- externa uctovnicka dovod nezapise (nema HR_EDIT)
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d4", "email": "ucetni.dv@test.local", "role": "authenticated", "aal": "aal2"}';
select throws_ok($$select public.hr_change_reason_begin('emp-dv', 'Oprava podle výplatnice', '{}')$$, '42501', null, 'uctovnicka dovod nezapise');
reset role;

-- ---------- vynimky: server a migracie ----------
set local role service_role;
select lives_ok($$update public.employees set health_insurance_company = '207' where id = 'emp-dv'$$, 'service_role bez dovodu');
reset role;
select lives_ok($$update public.employee_sensitive_data set birth_number = '000101/0003' where employee_id = 'emp-dv'$$, 'migracia (postgres) bez dovodu');

select * from finish();
rollback;
