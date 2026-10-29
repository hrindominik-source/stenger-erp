-- DB testy migracie 78: zmena cisla uctu -> upozornenie jednatelovi (len
-- posledne 4 cislice a kto zmenil) a oznacenie na overenie, kym nepotvrdi
-- jednatel alebo uctovnicka. Iba lokalne. Vymyslene udaje.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b5', 'konatel.ucet@test.local'),
  ('00000000-0000-0000-0000-0000000000b6', 'personalistka.ucet@test.local'),
  ('00000000-0000-0000-0000-0000000000b7', 'ucetni.ucet@test.local');
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000b5', 'Test Konatel Ucet', 'office'),
  ('00000000-0000-0000-0000-0000000000b6', 'Test Personalistka Ucet', 'personalistika'),
  ('00000000-0000-0000-0000-0000000000b7', 'Test Ucetni Ucet', 'office');
insert into public.hr_permissions (id, user_email, profile) values
  ('p-u5', 'konatel.ucet@test.local', 'KONATEL'),
  ('p-u6', 'personalistka.ucet@test.local', 'PERSONALISTA'),
  ('p-u7', 'ucetni.ucet@test.local', 'UCTOVNIK_EXT');
insert into public.employees (id, first_name, last_name) values ('emp-u', 'Uršula', 'Účtová'), ('emp-u2', 'Ugo', 'Nový');
insert into public.employee_sensitive_data (employee_id, birth_number, bank_account) values ('emp-u', '000101/0001', null);
select ok(not exists (select 1 from public.hr_bank_account_checks where employee_id = 'emp-u'), 'zaznam bez uctu - nic');

-- ---------- zmena personalistkou (s dovodom) ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000b6", "email": "personalistka.ucet@test.local", "role": "authenticated", "aal": "aal2"}';
select public.hr_change_reason_begin('emp-u', 'Zaměstnankyně předala nové číslo účtu');
update public.employee_sensitive_data set bank_account = '123456789/0100' where employee_id = 'emp-u';
reset role;
select is((select array[last4, changed_by_name, coalesce(confirmed_at::text, 'NEPOTVRZENO')] from public.hr_bank_account_checks where employee_id = 'emp-u'),
  array['6789', 'Test Personalistka Ucet', 'NEPOTVRZENO'], 'oznacenie na overenie: posledne 4 cislice, kto zmenil');
select ok(exists (select 1 from public.hr_notifications where event_type = 'BANK_ACCOUNT_CHANGED' and entity_id = 'emp-u'
  and title like '%končí …6789%' and title like '%změnil: Test Personalistka Ucet%'), 'jednatel upozorneny');
select ok(not exists (select 1 from public.hr_notifications where event_type = 'BANK_ACCOUNT_CHANGED'
  and (title || data::text) like '%12345%'), 'upozornenie bez celeho cisla');
select ok(not exists (select 1 from public.hr_bank_account_checks where (last4 || changed_by_name) like '%12345%'), 'oznacenie bez celeho cisla');

-- personalistka (ma pravo upravovat) zmenu nepotvrdi
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000b6", "email": "personalistka.ucet@test.local", "role": "authenticated", "aal": "aal2"}';
select is((select count(*) from public.hr_bank_account_checks where employee_id = 'emp-u')::int, 1, 'personalistka oznacenie vidi');
select throws_ok($$select public.hr_bank_account_confirm('emp-u')$$, '42501', null, 'personalistka nepotvrdi');
select throws_ok($$update public.hr_bank_account_checks set confirmed_at = now()$$, '42501', null, 'priamy zapis nie');

-- uctovnicka potvrdi
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000b7", "email": "ucetni.ucet@test.local", "role": "authenticated", "aal": "aal2"}';
select is((select last4 from public.hr_bank_account_checks where employee_id = 'emp-u' and confirmed_at is null), '6789', 'uctovnicka vidi oznacenie');
select lives_ok($$select public.hr_bank_account_confirm('emp-u')$$, 'uctovnicka potvrdi');
select throws_like($$select public.hr_bank_account_confirm('emp-u')$$, '%Žádná nepotvrzená%', 'druhy raz nie');
reset role;
select ok((select confirmed_at is not null and confirmed_by = '00000000-0000-0000-0000-0000000000b7' from public.hr_bank_account_checks where employee_id = 'emp-u'), 'potvrdene, kto');
select ok(exists (select 1 from public.audit_log where entity = 'hr_bank_account_checks' and action = 'update'), 'potvrdenie v audite');

-- ---------- dalsia zmena jednatelom: znovu na overenie, vlastnu nepotvrdi ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000b5", "email": "konatel.ucet@test.local", "role": "authenticated", "aal": "aal2"}';
select public.hr_change_reason_begin('emp-u', 'Oprava překlepu v čísle účtu');
update public.employee_sensitive_data set bank_account = '987654321/0300' where employee_id = 'emp-u';
select is((select array[last4, coalesce(confirmed_at::text, 'NEPOTVRZENO')] from public.hr_bank_account_checks where employee_id = 'emp-u'),
  array['4321', 'NEPOTVRZENO'], 'nova zmena - znovu na overenie');
select throws_like($$select public.hr_bank_account_confirm('emp-u')$$, '%Vlastní změnu%', 'jednatel vlastnu zmenu nepotvrdi');
-- ina zmena v citlivych udajoch (nie ucet) nic nevytvori
select public.hr_change_reason_begin('emp-u', 'Oprava rodného čísla podle dokladu');
update public.employee_sensitive_data set birth_number = '000101/0002' where employee_id = 'emp-u';
reset role;
select is((select count(*) from public.hr_notifications where event_type = 'BANK_ACCOUNT_CHANGED' and entity_id = 'emp-u')::int, 2, 'len zmeny uctu');

-- jednatel potvrdi zmenu, ktoru urobil niekto iny
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000b7", "email": "ucetni.ucet@test.local", "role": "authenticated", "aal": "aal2"}';
select lives_ok($$select public.hr_bank_account_confirm('emp-u')$$, 'uctovnicka potvrdi zmenu jednatela');
reset role;

-- ---------- zo servera (kiosk) ----------
set local role service_role;
insert into public.employee_sensitive_data (employee_id, bank_account) values ('emp-u2', '19-2000145399/0800');
reset role;
select is((select array[last4, changed_by_name] from public.hr_bank_account_checks where employee_id = 'emp-u2'),
  array['5399', 'server (např. kiosk)'], 'zmena zo servera tiez na overenie');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000b5", "email": "konatel.ucet@test.local", "role": "authenticated", "aal": "aal2"}';
select lives_ok($$select public.hr_bank_account_confirm('emp-u2')$$, 'jednatel potvrdi zmenu zo servera');
reset role;

select * from finish();
rollback;
