-- DB testy migracie 69: zalozne kody, zaznam resetu MFA, serverovy reset
-- jednatela. Iba lokalne. Vymyslene udaje.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'konatel.e@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', 'personalistka.e@test.local');
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000e1', 'Test Konatel E', 'office'),
  ('00000000-0000-0000-0000-0000000000e2', 'Test Personalistka E', 'personalistika');
insert into public.hr_permissions (id, user_email, profile) values
  ('p-e1', 'konatel.e@test.local', 'KONATEL'),
  ('p-e2', 'personalistka.e@test.local', 'PERSONALISTA');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000fe01', '00000000-0000-0000-0000-0000000000e1', 'test', 'totp', 'verified', now(), now()),
  ('00000000-0000-0000-0000-00000000fe02', '00000000-0000-0000-0000-0000000000e2', 'test', 'totp', 'verified', now(), now());

select is((select value->'required_profiles' from public.hr_settings where key = 'mfa'), '["KONATEL", "PERSONALISTA", "UCTOVNIK_EXT"]'::jsonb,
  'MFA povinne aj pre externu uctovnicku');

-- ---------- zalozne kody ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000e2", "email": "personalistka.e@test.local", "role": "authenticated", "aal": "aal1"}';
select throws_ok($$select public.hr_mfa_generate_recovery_codes()$$, '42501', null, 'bez overenia kodom zalozne kody nevzniknu');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000e2", "email": "personalistka.e@test.local", "role": "authenticated", "aal": "aal2"}';
create temp table codes1 as select public.hr_mfa_generate_recovery_codes() as c;
select is((select cardinality(c) from codes1), 10, '10 zaloznych kodov');
select ok((select bool_and(x ~ '^[0-9A-F]{5}-[0-9A-F]{5}$') from codes1, unnest(c) x), 'format XXXXX-XXXXX');
select is(public.hr_mfa_recovery_remaining(), 10, 'zostava 10 nepouzitych');
select throws_ok($$select * from public.hr_mfa_recovery_codes$$, '42501', null, 'otlacky kodov pouzivatel necita');
select throws_ok($$select public.hr_mfa_consume_recovery_code('00000000-0000-0000-0000-0000000000e2', 'X')$$, '42501', null, 'kod spotrebuje len server');
select throws_ok($$select public.hr_mfa_log_reset('00000000-0000-0000-0000-0000000000e2', null, 'JEDNATEL', 'x')$$, '42501', null, 'reset zapise len server');
select throws_ok($$select public.hr_mfa_server_reset('konatel.e@test.local', 'x')$$, '42501', null, 'serverovy reset nespusti prihlaseny pouzivatel');
select throws_ok($$select * from public.hr_mfa_overview()$$, '42501', null, 'prehlad MFA len pre jednatela');
reset role;

select is((select count(*) from public.hr_mfa_recovery_codes where user_id = '00000000-0000-0000-0000-0000000000e2')::int, 10, 'ulozenych 10 otlackov');
select ok(not exists (select 1 from codes1, unnest(c) x join public.hr_mfa_recovery_codes r on r.code_sha256 = x), 'v DB nie su kody v citatelnej podobe');

-- spotrebovanie (ako server): platny raz, maly zapis aj s pomlckou/malymi pismenami
select ok(public.hr_mfa_consume_recovery_code('00000000-0000-0000-0000-0000000000e2', lower(replace((select c[1] from codes1), '-', ''))), 'platny kod prejde');
select ok(not public.hr_mfa_consume_recovery_code('00000000-0000-0000-0000-0000000000e2', (select c[1] from codes1)), 'pouzity kod druhy raz neprejde');
select ok(not public.hr_mfa_consume_recovery_code('00000000-0000-0000-0000-0000000000e1', (select c[2] from codes1)), 'kod ineho pouzivatela neprejde');
select ok(not public.hr_mfa_consume_recovery_code('00000000-0000-0000-0000-0000000000e2', 'AAAAA-AAAAA'), 'zly kod 2');
select ok(not public.hr_mfa_consume_recovery_code('00000000-0000-0000-0000-0000000000e2', 'AAAAA-AAAAB'), 'zly kod 3');
select ok(not public.hr_mfa_consume_recovery_code('00000000-0000-0000-0000-0000000000e2', 'AAAAA-AAAAC'), 'zly kod 4');
select ok(not public.hr_mfa_consume_recovery_code('00000000-0000-0000-0000-0000000000e2', 'AAAAA-AAAAD'), 'zly kod 5');
select throws_like($$select public.hr_mfa_consume_recovery_code('00000000-0000-0000-0000-0000000000e2', (select c[3] from codes1))$$,
  '%Prilis mnoho pokusu%', 'po 5 zlych pokusoch za hodinu aj platny kod caka');

-- nove kody zrusia stare
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000e2", "email": "personalistka.e@test.local", "role": "authenticated", "aal": "aal2"}';
select is(cardinality(public.hr_mfa_generate_recovery_codes()), 10, 'nova sada');
reset role;
select is((select count(*) from public.hr_mfa_recovery_codes where user_id = '00000000-0000-0000-0000-0000000000e2')::int, 10, 'stare kody zmazane');
delete from public.hr_mfa_recovery_failures;
select ok(not public.hr_mfa_consume_recovery_code('00000000-0000-0000-0000-0000000000e2', (select c[3] from codes1)), 'kod zo starej sady neplati');

-- ---------- zaznam resetu ----------
select lives_ok($$select public.hr_mfa_log_reset('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e1', 'JEDNATEL', 'Ztracený telefon')$$, 'reset jednatelom zapisany');
select ok(exists (select 1 from public.audit_log where entity = 'auth_mfa' and entity_id = '00000000-0000-0000-0000-0000000000e2' and action = 'delete'
  and new_value->>'method' = 'JEDNATEL' and new_value->>'reason' = 'Ztracený telefon' and changed_by = '00000000-0000-0000-0000-0000000000e1'), 'audit: kto, komu, preco');
select ok(exists (select 1 from public.hr_notifications where event_type = 'MFA_RESET' and entity_id = '00000000-0000-0000-0000-0000000000e2'
  and data->>'email' = 'personalistka.e@test.local'), 'upozornenie jednatelovi');
select is((select count(*) from public.hr_mfa_recovery_codes where user_id = '00000000-0000-0000-0000-0000000000e2')::int, 0, 'reset zrusi aj zalozne kody');

-- ---------- serverovy reset jednatela (IT) ----------
select throws_like($$select public.hr_mfa_server_reset('konatel.e@test.local', ' ')$$, '%dovod%', 'bez dovodu nie');
select is(public.hr_mfa_server_reset('konatel.e@test.local', 'Ztracený telefon, overeno osobne'), 1, 'server zmaze faktor jednatela');
select is((select count(*) from auth.mfa_factors where user_id = '00000000-0000-0000-0000-0000000000e1')::int, 0, 'faktor jednatela zmazany');
select ok(exists (select 1 from public.audit_log where entity = 'auth_mfa' and entity_id = '00000000-0000-0000-0000-0000000000e1'
  and new_value->>'method' = 'SERVER' and source = 'server'), 'audit serveroveho resetu');
select ok(exists (select 1 from public.hr_notifications where event_type = 'MFA_RESET' and entity_id = '00000000-0000-0000-0000-0000000000e1'), 'upozornenie aj o resete jednatela');
select is(public.hr_mfa_server_reset('konatel.e@test.local', 'faktor zmazany v Dashboarde', true), 0, 'len zapis, ked IT zmazalo faktor v Dashboarde');

-- ---------- prehlad pre jednatela ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000e1", "email": "konatel.e@test.local", "role": "authenticated", "aal": "aal2"}';
select is((select mfa_active from public.hr_mfa_overview() where email = 'personalistka.e@test.local'), true, 'jednatel vidi, kto ma overenie');
select is((select mfa_active from public.hr_mfa_overview() where email = 'konatel.e@test.local'), false, 'po resete neregistrovane');
reset role;

select * from finish();
rollback;
