-- DB testy migracie 63: opravy vysokych nalezov auditu Personalistiky
-- (S-01 subory, S-02 token kiosku, S-03 odomknutie kiosku) a zapis do
-- plan_smien len cez PIN. Iba lokalne: npx supabase test db. Vymyslene udaje.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'personalista.v@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', 'mzdy.v@test.local'),
  ('00000000-0000-0000-0000-0000000000d3', 'admin.v@test.local');
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'Test Personalista V', 'office'),
  ('00000000-0000-0000-0000-0000000000d2', 'Test Mzdy V', 'office'),
  ('00000000-0000-0000-0000-0000000000d3', 'Test Admin V', 'office');
insert into public.hr_permissions (id, user_email, permissions) values
  ('p-v1', 'personalista.v@test.local', array['HR_VIEW_BASIC', 'HR_VIEW_SENSITIVE', 'HR_EDIT', 'HR_DOCUMENT_GENERATE']),
  ('p-v2', 'mzdy.v@test.local', array['HR_VIEW_BASIC', 'HR_VIEW_PAYROLL']),
  ('p-v3', 'admin.v@test.local', array['HR_ADMIN']);

-- ---------- S-01 subory ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d1", "email": "personalista.v@test.local", "role": "authenticated"}';
select ok(not public.hr_object_path_visible('zamestnanci/emp-v/prilohy/abc.pdf'), 'S-01: priloha zamestnanca bez HR_VIEW_PAYROLL neviditelna');
select ok(not public.hr_object_path_visible('zamestnanci/emp-v/nenaviazany.pdf'), 'S-01: nenaviazany subor bez HR_ADMIN neviditelny');
select ok(not public.hr_object_path_visible('zamestnanci-podpisy/zmazany-dokument.pdf'), 'S-01/S-08: sken po vymazani dokumentu neviditelny');
select ok(public.hr_object_path_visible('sablony/tpl-ps/v1.docx'), 'S-01: sablony ostavaju pre HR');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d2", "email": "mzdy.v@test.local", "role": "authenticated"}';
select ok(public.hr_object_path_visible('zamestnanci/emp-v/prilohy/abc.pdf'), 'S-01: priloha s HR_VIEW_PAYROLL viditelna');
select ok(not public.hr_object_path_visible('zamestnanci/emp-v/nenaviazany.pdf'), 'S-01: nenaviazany subor ani s PAYROLL');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d3", "email": "admin.v@test.local", "role": "authenticated"}';
select ok(public.hr_object_path_visible('zamestnanci/emp-v/nenaviazany.pdf'), 'S-01: nenaviazany subor vidi HR_ADMIN');
reset role;

-- ---------- S-02 token kiosku ----------
select hasnt_column('public', 'onboarding_sessions', 'session_token', 'S-02: token relacie sa neuklada v citatelnej podobe');
select has_column('public', 'onboarding_sessions', 'session_token_sha256', 'S-02: v DB je len hash tokenu');
select ok(not has_function_privilege('authenticated', 'public.hr_onboarding_token_hash(text)', 'EXECUTE'), 'S-02: hashovacia funkcia nie je verejna');

-- ---------- S-03 odomknutie kiosku ----------
select is((select value->>'device_unlock_required' from public.hr_settings where key = 'kiosk'), 'true', 'S-03: kiosk predvolene vyzaduje odomknutie');
insert into public.hr_kiosk_unlocks (id, code_sha256, issued_by, expires_at) values
  ('unl-v1', encode(extensions.digest('ABCD1234', 'sha256'), 'hex'), '00000000-0000-0000-0000-0000000000d1', now() + interval '15 minutes'),
  ('unl-v2', encode(extensions.digest('STARY999', 'sha256'), 'hex'), '00000000-0000-0000-0000-0000000000d1', now() - interval '1 minute');
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select throws_ok($$select * from public.hr_onboarding_start_session()$$, 'P0001', null, 'S-03: bez kodu sa relacia nezalozi');
select throws_ok($$select * from public.hr_onboarding_start_session('STARY999')$$, 'P0001', null, 'S-03: expirovany kod neplati');
create temp table v_sess as select * from public.hr_onboarding_start_session('abcd1234');
grant select on v_sess to authenticated, postgres;
select is((select count(*) from v_sess)::int, 1, 'S-03: platny kod (bez ohladu na velkost pismen) zalozi relaciu');
select throws_ok($$select * from public.hr_onboarding_start_session('ABCD1234')$$, 'P0001', null, 'S-03: kod plati len raz');
select is(public.hr_onboarding_save_draft((select session_token from v_sess), '{"first_name": "Vera"}'), true, 'kiosk s tokenom uklada koncept');
select is(public.hr_onboarding_save_draft('zly-token', '{"first_name": "X"}'), false, 'zly token neulozi nic');
reset role;
select is((select session_token_sha256 from public.onboarding_sessions where id = (select id from v_sess)),
  public.hr_onboarding_token_hash((select session_token from v_sess)), 'S-02: v DB je SHA-256 vrateneho tokenu');

-- HR vidi relaciu, ale nie token
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d1", "email": "personalista.v@test.local", "role": "authenticated"}';
select is((select draft_data->>'first_name' from public.onboarding_sessions where id = (select id from v_sess)), 'Vera', 'HR vidi koncept relacie');
select ok(not exists (select 1 from public.onboarding_sessions s
  where s.session_token_sha256 = (select session_token from v_sess)), 'S-02: HR nema k dispozicii token, len hash');
reset role;

-- ---------- plan_smien ----------
insert into public.plan_smien (id, data) values (1, '{"weeks": [], "requests": [{"id": "r-old", "employeeId": "w1", "status": "pending"}]}')
  on conflict (id) do update set data = excluded.data;
insert into public.plan_smien_pins (id, admin_pin, employee_pins) values (1, '4321', '{"w1": "1111"}')
  on conflict (id) do update set admin_pin = excluded.admin_pin, employee_pins = excluded.employee_pins;
delete from public.plan_smien_pin_failures;
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select ok((select count(*) from public.plan_smien) = 1, 'plan_smien: anon cita rozpis');
select throws_ok($$update public.plan_smien set data = '{}' where id = 1$$, '42501', null, 'plan_smien: anon nezapise priamo');
select throws_ok($$insert into public.plan_smien (id, data) values (2, '{}')$$, '42501', null, 'plan_smien: anon nevlozi priamo');
select is(public.plan_smien_save('0000', '{"weeks": [1]}'), false, 'plan_smien_save: zly admin PIN neulozi');
select is(public.plan_smien_save('4321', '{"weeks": [1], "requests": []}'), true, 'plan_smien_save: spravny admin PIN ulozi');
select is((select data->'weeks' from public.plan_smien where id = 1), '[1]'::jsonb, 'rozpis ulozeny');
select is((select jsonb_array_length(data->'requests') from public.plan_smien where id = 1), 1, 'ulozenie admina nezmaze ziadost zamestnanca');
select is(public.plan_smien_add_request('w1', '9999', '{"id": "r-new"}'), false, 'ziadost so zlym PIN zamestnanca sa neprida');
select is(public.plan_smien_add_request('w1', '1111', '{"id": "r-new", "employeeId": "w2", "status": "approved", "from": "2026-11-02"}'), true, 'zamestnanec prida vlastnu ziadost');
select is((select r->>'employeeId' || '/' || (r->>'status') from public.plan_smien, jsonb_array_elements(data->'requests') r where r->>'id' = 'r-new'),
  'w1/pending', 'ziadost je vzdy na vlastne meno a cakajuca');
-- obmedzenie pokusov: po 10 chybach je PIN 5 minut zablokovany aj pre spravnu hodnotu
select public.plan_smien_verify_admin_pin('0000') from generate_series(1, 9);
select is(public.plan_smien_verify_admin_pin('4321'), true, 'po 9 chybach spravny PIN plati a pocitadlo sa vynuluje');
select public.plan_smien_verify_admin_pin('0000') from generate_series(1, 10);
select is(public.plan_smien_verify_admin_pin('4321'), false, 'po 10 chybach je admin PIN docasne zablokovany');
select is(public.plan_smien_verify_employee_pin('w1', '1111'), true, 'blokacia admina neblokuje zamestnanca');
reset role;
select ok((select locked_until > now() from public.plan_smien_pin_failures where target = 'admin'), 'blokacia je zaznamenana');

select * from finish();
rollback;
