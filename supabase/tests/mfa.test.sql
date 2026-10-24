-- DB testy migracie 67: dvojfazove prihlasenie povinne pre profily Jednatel a
-- Personalista; bez aal2 ziadne HR opravnenia. Iba lokalne. Vymyslene udaje.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'konatel.f@test.local'),
  ('00000000-0000-0000-0000-0000000000f2', 'personalistka.f@test.local'),
  ('00000000-0000-0000-0000-0000000000f3', 'ucetni.f@test.local');
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000f1', 'Test Konatel F', 'office'),
  ('00000000-0000-0000-0000-0000000000f2', 'Test Personalistka F', 'personalistika'),
  ('00000000-0000-0000-0000-0000000000f3', 'Test Ucetni F', 'ucetni_ext');
insert into public.hr_permissions (id, user_email, profile, valid_until) values
  ('p-f1', 'konatel.f@test.local', 'KONATEL', null),
  ('p-f2', 'personalistka.f@test.local', 'PERSONALISTA', null),
  ('p-f3', 'ucetni.f@test.local', 'UCTOVNIK_EXT', current_date + 30);
insert into public.employees (id, first_name, last_name) values ('emp-f1', 'Filip', 'Faktorovy');
insert into public.employee_sensitive_data (employee_id, birth_number) values ('emp-f1', '900101/0000');

-- ---------- personalistka bez druheho faktora ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000f2", "email": "personalistka.f@test.local", "role": "authenticated", "aal": "aal1"}';
select is(public.hr_mfa_status(), '{"required": true, "aal": "aal1", "ok": false}'::jsonb, 'personalistka: druhy faktor je povinny');
select is(public.hr_get_permissions(), '{}'::text[], 'bez druheho faktora ziadne opravnenia');
select is((select count(*) from public.employee_sensitive_data where employee_id = 'emp-f1')::int, 0, 'bez druheho faktora nevidi citlive udaje');
select throws_ok($$select public.hr_kiosk_issue_unlock()$$, 'P0001', null, 'bez druheho faktora nevyda kod kiosku');
-- s druhym faktorom
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000f2", "email": "personalistka.f@test.local", "role": "authenticated", "aal": "aal2"}';
select ok((public.hr_mfa_status()->>'ok')::boolean, 'po overeni kodom je stav OK');
select ok('HR_VIEW_SENSITIVE' = any(public.hr_get_permissions()), 's druhym faktorom ma opravnenia profilu');
select is((select birth_number from public.employee_sensitive_data where employee_id = 'emp-f1'), '900101/0000', 's druhym faktorom vidi citlive udaje');

-- ---------- jednatel ----------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000f1", "email": "konatel.f@test.local", "role": "authenticated", "aal": "aal1"}';
select ok(not public.hr_has_permission('HR_ADMIN'), 'jednatel bez druheho faktora nema HR_ADMIN');
select throws_like($$select public.hr_konatel_summary(7)$$, '%Neopravneno%', 'jednatel bez druheho faktora nedostane suhrn');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000f1", "email": "konatel.f@test.local", "role": "authenticated", "aal": "aal2"}';
select ok(public.hr_has_permission('HR_ADMIN'), 'jednatel s druhym faktorom ma HR_ADMIN');

-- ---------- externa uctovnicka: podla rozhodnutia nepovinne ----------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000f3", "email": "ucetni.f@test.local", "role": "authenticated", "aal": "aal1"}';
select is(public.hr_mfa_status()->>'required', 'false', 'uctovnicka: druhy faktor nie je povinny');
select ok('HR_VIEW_PAYROLL' = any(public.hr_get_permissions()), 'uctovnicka ma opravnenia aj bez druheho faktora');
reset role;

-- ---------- zoznam profilov sa da zmenit nastavenim ----------
update public.hr_settings set value = '{"required_profiles": ["KONATEL", "PERSONALISTA", "UCTOVNIK_EXT"]}' where key = 'mfa';
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000f3", "email": "ucetni.f@test.local", "role": "authenticated", "aal": "aal1"}';
select is(public.hr_get_permissions(), '{}'::text[], 'po zapnuti pre uctovnicku bez druheho faktora nic');
reset role;

select * from finish();
rollback;
