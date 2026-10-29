-- DB testy migracie 70 (balik D): zakonne parametre a kontroly pri generovani
-- a podpise. Iba lokalne. Vymyslene udaje.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'konatel.d@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', 'personalistka.d@test.local');
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'Test Konatel D', 'office'),
  ('00000000-0000-0000-0000-0000000000d2', 'Test Personalistka D', 'personalistika');
insert into public.hr_permissions (id, user_email, profile) values
  ('p-d1', 'konatel.d@test.local', 'KONATEL'),
  ('p-d2', 'personalistka.d@test.local', 'PERSONALISTA');

-- ---------- hodnoty od jednatela ----------
select is((select value from public.hr_legal_parameters where key = 'MIN_WAGE_MONTH'), 22400::numeric, 'minimalna mzda 22 400 Kc');
select is((select value from public.hr_legal_parameters where key = 'MIN_WAGE_HOUR'), 134.40::numeric, 'hodinova 134,40 Kc');
select is((select valid_from from public.hr_legal_parameters where key = 'MIN_WAGE_MONTH'), '2026-01-01'::date, 'platnost od 1. 1. 2026');
select ok((select source like '%MPSV%' from public.hr_legal_parameters where key = 'MIN_WAGE_HOUR'), 'zdroj MPSV');
select is((select string_agg(key || '=' || value, ',' order by key) from public.hr_legal_parameters
  where key in ('PROBATION_MAX_MONTHS', 'PROBATION_MAX_MONTHS_MANAGER', 'FIXED_TERM_MAX_YEARS', 'FIXED_TERM_MAX_REPEATS', 'FIXED_TERM_MAX_TOTAL_YEARS', 'FIXED_TERM_GAP_RESET_YEARS', 'DPP_MAX_HOURS_YEAR')),
  'DPP_MAX_HOURS_YEAR=300,FIXED_TERM_GAP_RESET_YEARS=3,FIXED_TERM_MAX_REPEATS=2,FIXED_TERM_MAX_TOTAL_YEARS=9,FIXED_TERM_MAX_YEARS=3,PROBATION_MAX_MONTHS=4,PROBATION_MAX_MONTHS_MANAGER=8',
  'parametre ZP podla zadania');
select ok((select bool_and(source is not null) from public.hr_legal_parameters where value is not null or value_text is not null), 'kazda zadana hodnota ma zdroj');
select ok((select bool_and(value is null and source is null) from public.hr_legal_parameters
  where key in ('GUARANTEED_WAGE', 'DPP_CONTRIB_INCOME_LIMIT', 'DPC_CONTRIB_INCOME_LIMIT', 'WEEKLY_WORKING_TIME_FULL', 'MEDICAL_EXAM_INTERVALS', 'BOZP_TRAINING_INTERVAL')),
  'nezadane parametre ostavaju prazdne (nevymyslaju sa)');
select is((public.hr_legal_param('MIN_WAGE_MONTH', '2025-12-31')).value, null, 'pred 1. 1. 2026 minimalna mzda nie je zadana');
select is((public.hr_legal_param('MIN_WAGE_MONTH', '2026-06-01')).value, 22400::numeric, 'k 1. 6. 2026 plati 22 400');

-- ---------- meni len jednatel ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d2", "email": "personalistka.d@test.local", "role": "authenticated", "aal": "aal2"}';
select ok((select count(*) from public.hr_legal_parameters) > 0, 'personalistka parametre vidi');
select throws_ok($$insert into public.hr_legal_parameters (key, label, value) values ('MIN_WAGE_MONTH', 'x', 1000)$$, '42501', null, 'personalistka parameter neprida');
update public.hr_legal_parameters set value = 1000 where key = 'MIN_WAGE_MONTH';
reset role;
select is((select value from public.hr_legal_parameters where key = 'MIN_WAGE_MONTH'), 22400::numeric, 'personalistka hodnotu nezmenila');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d1", "email": "konatel.d@test.local", "role": "authenticated", "aal": "aal2"}';
select lives_ok($$insert into public.hr_legal_parameters (key, label, value, unit, valid_from, source)
  values ('MIN_WAGE_MONTH', 'Minimální mzda – měsíční', 23000, 'Kč/měsíc', '2027-01-01', 'Test – zdroj')$$, 'jednatel prida novu platnost');
select lives_ok($$update public.hr_legal_parameters set value = 40, source = 'Test – pracovní řád' where key = 'WEEKLY_WORKING_TIME_FULL'$$, 'jednatel doplni prazdny parameter');
reset role;
select is((select approved_by from public.hr_legal_parameters where key = 'MIN_WAGE_MONTH' and valid_from = '2027-01-01'), '00000000-0000-0000-0000-0000000000d1'::uuid, 'zadal a schvalil jednatel');
select is((public.hr_legal_param('MIN_WAGE_MONTH', '2027-03-01')).value, 23000::numeric, 'od 2027 nova hodnota');
select is((public.hr_legal_param('MIN_WAGE_MONTH', '2026-12-31')).value, 22400::numeric, 'do konca 2026 stara');
select ok(exists (select 1 from public.audit_log where entity = 'hr_legal_parameters' and action = 'insert' and new_value->>'value' = '23000'), 'zmena v audite');
select ok(exists (select 1 from public.hr_notifications where event_type = 'LEGAL_PARAM_CHANGED' and data->>'key' = 'WEEKLY_WORKING_TIME_FULL'), 'zmena v upozorneniach');

-- ---------- kontroly ----------
insert into public.employees (id, first_name, last_name) values ('emp-d1', 'David', 'Dobauricity'), ('emp-d2', 'Dana', 'Dohodova');
create temp table chk(id text, codes text) on commit drop;
create or replace function pg_temp.codes(p_id text) returns text language sql as $$
  select coalesce(string_agg(i->>'code' || ':' || (i->>'level'), ',' order by i->>'code'), '')
  from jsonb_array_elements(public.hr_check_employment_core(p_id)->'issues') i
  where i->>'code' not in ('NO_MEDICAL_EXAM', 'NO_BOZP_TRAINING');
$$;

insert into public.employment_relationships (id, employee_id, status, employment_type, start_date, fixed_term_end_date, weekly_hours, data) values
  ('er-p5', 'emp-d1', 'PLANNED', 'doba_neurcita', '2026-11-01', null, 40, '{"zkusebni_doba_mesice": "5"}'),
  ('er-p5v', 'emp-d1', 'PLANNED', 'doba_neurcita', '2026-11-01', null, 40, '{"zkusebni_doba_mesice": "5", "vedouci": true}'),
  ('er-p9v', 'emp-d1', 'PLANNED', 'doba_neurcita', '2026-11-01', null, 40, '{"zkusebni_doba_mesice": "9", "vedouci": true}'),
  ('er-ok', 'emp-d1', 'PLANNED', 'doba_neurcita', '2026-11-01', null, 40, '{"zkusebni_doba_mesice": "3"}');
select is(pg_temp.codes('er-p5'), 'PROBATION_MAX:BLOCK', 'skusobna 5 mes. bez vedouci -> blok');
select is(pg_temp.codes('er-p5v'), '', 'vedouci 5 mes. -> v poriadku');
select is(pg_temp.codes('er-p9v'), 'PROBATION_MAX:BLOCK', 'vedouci 9 mes. -> blok');
select is(pg_temp.codes('er-ok'), '', '3 mes. -> v poriadku');

-- doba urcita: polovica, dlzka
insert into public.employment_relationships (id, employee_id, status, employment_type, start_date, fixed_term_end_date, weekly_hours, data) values
  ('er-half', 'emp-d2', 'PLANNED', 'doba_urcita', '2026-11-01', '2027-04-30', 40, '{"zkusebni_doba_mesice": "4"}'),
  ('er-long', 'emp-d2', 'PLANNED', 'doba_urcita', '2026-11-01', '2029-11-01', 40, '{}');
select is(pg_temp.codes('er-half'), 'PROBATION_FIXED_TERM:BLOCK', '4 mes. pri 6 mes. dobe urcitej -> blok');
select is(pg_temp.codes('er-long'), 'FIXED_TERM_LENGTH:BLOCK', 'doba urcita nad 3 roky -> blok');
update public.employment_relationships set fixed_term_end_date = '2029-10-31' where id = 'er-long';
select is(pg_temp.codes('er-long'), '', 'presne 3 roky -> v poriadku');

-- opakovania: 3 pomery za sebou ok, stvrty blok; prestavka 3 roky retazec rusi
insert into public.employees (id, first_name, last_name) values ('emp-d3', 'Ota', 'Opakovany');
insert into public.employment_relationships (id, employee_id, status, employment_type, start_date, fixed_term_end_date, weekly_hours, data) values
  ('er-c1', 'emp-d3', 'ENDED', 'doba_urcita', '2020-01-01', '2020-12-31', 40, '{}'),
  ('er-c2', 'emp-d3', 'ENDED', 'doba_urcita', '2021-01-01', '2021-12-31', 40, '{}'),
  ('er-c3', 'emp-d3', 'ACTIVE', 'doba_urcita', '2022-01-01', '2022-12-31', 40, '{}'),
  ('er-c4', 'emp-d3', 'PLANNED', 'doba_urcita', '2023-01-01', '2023-12-31', 40, '{}');
select is(pg_temp.codes('er-c3'), '', 'tretia doba urcita (2 opakovania) -> v poriadku');
select is(pg_temp.codes('er-c4'), 'FIXED_TERM_REPEATS:BLOCK', 'stvrta (3. opakovanie) -> blok');
update public.employment_relationships set start_date = '2026-01-01', fixed_term_end_date = '2026-12-31' where id = 'er-c4';
select is(pg_temp.codes('er-c4'), '', 'po 3 rokoch prestavky sa predchadzajuce nezapocitavaju');
-- predlzenie (zmena konca v historii podmienok) sa pocita ako opakovanie
insert into public.employment_terms_versions (id, employment_id, valid_from, valid_to, fixed_term_end_date) values
  ('tv-c3a', 'er-c3', '2022-01-01', '2022-06-30', '2022-06-30'), ('tv-c3b', 'er-c3', '2022-07-01', null, '2022-12-31');
select is(pg_temp.codes('er-c3'), 'FIXED_TERM_REPEATS:BLOCK', 'predlzenie tretej doby urcitej = 3. opakovanie -> blok');

-- minimalna mzda
insert into public.employees (id, first_name, last_name) values ('emp-d4', 'Mira', 'Mzdova');
insert into public.employment_relationships (id, employee_id, status, employment_type, start_date, weekly_hours, data) values
  ('er-w', 'emp-d4', 'PLANNED', 'doba_neurcita', '2026-11-01', 40, '{}');
insert into public.employee_payroll_data (employee_id, data) values ('emp-d4', '{"mzda_historie": [{"platnost_od": "2026-11-01", "mzda_typ": "hodinova", "mzda_castka": "120"}]}');
select is(pg_temp.codes('er-w'), 'MIN_WAGE:BLOCK', 'hodinova 120 Kc < 134,40 -> blok');
update public.employee_payroll_data set data = '{"mzda_historie": [{"platnost_od": "2026-11-01", "mzda_typ": "hodinova", "mzda_castka": "134,40"}]}' where employee_id = 'emp-d4';
select is(pg_temp.codes('er-w'), '', 'presne minimum -> v poriadku');
update public.employee_payroll_data set data = '{"mzda_historie": [{"platnost_od": "2026-11-01", "mzda_typ": "smluvni", "mzda_castka": "20000"}]}' where employee_id = 'emp-d4';
select is(pg_temp.codes('er-w'), 'MIN_WAGE:BLOCK', 'mesacna 20 000 pri 40 h -> blok');
update public.employment_relationships set weekly_hours = 20 where id = 'er-w';
select is(pg_temp.codes('er-w'), '', 'mesacna 20 000 pri polovicnom uvazku -> v poriadku (krati sa)');
select ok(not (public.hr_check_employment_core('er-w')::text like '%20000%'), 'vysledok kontroly neobsahuje vysku mzdy');
-- neskorsia zmena mzdy sa kontroluje k datu svojej ucinnosti (2027: 23 000 od jednatela vyssie)
update public.employee_payroll_data set data = '{"mzda_historie": [{"platnost_od": "2026-11-01", "mzda_typ": "smluvni", "mzda_castka": "22400"}, {"platnost_od": "2027-02-01", "mzda_typ": "smluvni", "mzda_castka": "22500"}]}' where employee_id = 'emp-d4';
update public.employment_relationships set weekly_hours = 40 where id = 'er-w';
select is(pg_temp.codes('er-w'), 'MIN_WAGE:BLOCK', 'zmena mzdy od 2/2027 pod minimom platnym v 2027 -> blok');
select ok((public.hr_check_employment_core('er-w')->'issues')::text like '%01. 02. 2027%', 'hlasenie uvadza datum zmeny');

-- DPC rozsah (stanovena tyzdenna doba doplnena jednatelom vyssie = 40)
insert into public.employment_relationships (id, employee_id, status, employment_type, start_date, weekly_hours, data) values
  ('er-dpc', 'emp-d2', 'PLANNED', 'doba_neurcita', '2026-11-01', 25, '{"postaveni": "1211"}'),
  ('er-dpp', 'emp-d2', 'PLANNED', 'doba_neurcita', '2026-11-01', 5, '{"postaveni": "1221"}');
select is(pg_temp.codes('er-dpc'), 'DPC_SCOPE:BLOCK', 'DPC 25 h z 40 -> blok');
select is(pg_temp.codes('er-dpp'), 'DPP_HOURS:WARN', 'DPP -> upozornenie na 300 h');
select ok((public.hr_check_employment_core('er-ok')->'issues')::text like '%NO_MEDICAL_EXAM%', 'bez prehliadky pred nastupom -> upozornenie');

-- ---------- vynutenie pri generovani a podpise ----------
select throws_like($$insert into public.hr_documents (id, employee_id, employment_id, doc_type, origin, status)
  values ('doc-d-bad', 'emp-d1', 'er-p5', 'pracovni_smlouva', 'GENERATED', 'READY_FOR_SIGNATURE')$$,
  '%zákonný limit%Zkušební doba 5 měs.%', 'generovanie PS so skusobnou nad limit zablokovane');
select lives_ok($$insert into public.hr_documents (id, employee_id, employment_id, doc_type, origin, status)
  values ('doc-d-up', 'emp-d1', 'er-p5', 'pracovni_smlouva', 'UPLOADED', 'DRAFT')$$, 'nahraty historicky dokument sa neblokuje');
select lives_ok($$insert into public.hr_documents (id, employee_id, employment_id, doc_type, origin, status)
  values ('doc-d-ok', 'emp-d1', 'er-ok', 'pracovni_smlouva', 'GENERATED', 'READY_FOR_SIGNATURE')$$, 'v poriadku -> vznikne');
select ok((select legal_check->'params' ? 'PROBATION_MAX_MONTHS' from public.hr_documents where id = 'doc-d-ok'), 'k dokumentu ulozene pouzite parametre');
select is((select legal_check->'params'->'PROBATION_MAX_MONTHS'->>'value' from public.hr_documents where id = 'doc-d-ok'), '4', 'aj s hodnotou platnou v den generovania');
-- zmena karty po vygenerovani -> podpis zablokovany
update public.employment_relationships set data = '{"zkusebni_doba_mesice": "6"}' where id = 'er-ok';
select throws_like($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_at)
  values ('sig-d1', 'doc-d-ok', 'PAPER', 'EMPLOYEE', now())$$, '%nelze podepsat%', 'podpis po zmene nad limit zablokovany');

select * from finish();
rollback;
