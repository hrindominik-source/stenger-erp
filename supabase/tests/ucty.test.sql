-- DB testy migracie 73 (balik G): neuspesne prihlasenia (Auth hooky),
-- prehlad relacii, odchod pouzivatela. Iba lokalne. Vymyslene udaje.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'konatel.ucty@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', 'personalistka.ucty@test.local'),
  ('00000000-0000-0000-0000-0000000000d3', 'mimo.hr@test.local');
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'Test Konatel Ucty', 'office'),
  ('00000000-0000-0000-0000-0000000000d2', 'Test Personalistka Ucty', 'personalistika');
insert into public.hr_permissions (id, user_email, profile) values
  ('p-d1', 'konatel.ucty@test.local', 'KONATEL'),
  ('p-d2', 'personalistka.ucty@test.local', 'PERSONALISTA');
insert into auth.sessions (id, user_id, created_at, updated_at, refreshed_at, user_agent) values
  ('00000000-0000-0000-0000-00000000d201', '00000000-0000-0000-0000-0000000000d2', now(), now(), now(), 'Prehliadac A'),
  ('00000000-0000-0000-0000-00000000d202', '00000000-0000-0000-0000-0000000000d2', now(), now(), now(), 'Prehliadac B'),
  ('00000000-0000-0000-0000-00000000d203', '00000000-0000-0000-0000-0000000000d2', now() - interval '3 hours', now() - interval '3 hours', now() - interval '3 hours', 'Stary');

-- ---------- hooky ----------
select ok(not has_function_privilege('anon', 'public.hook_password_verification_attempt(jsonb)', 'EXECUTE'), 'anon hook nespusti');
select ok(not has_function_privilege('authenticated', 'public.hook_password_verification_attempt(jsonb)', 'EXECUTE'), 'pouzivatel hook nespusti');
select ok(has_function_privilege('supabase_auth_admin', 'public.hook_password_verification_attempt(jsonb)', 'EXECUTE'), 'Auth hook spusti');
select ok(has_function_privilege('supabase_auth_admin', 'public.hook_mfa_verification_attempt(jsonb)', 'EXECUTE'), 'Auth MFA hook spusti');
select is(public.hook_password_verification_attempt('{"user_id": "00000000-0000-0000-0000-0000000000d2", "valid": false}'), '{"decision": "continue"}'::jsonb,
  'hook prihlasenie neblokuje');
select is(public.hook_password_verification_attempt('{"user_id": "00000000-0000-0000-0000-0000000000d2", "valid": true}'), '{"decision": "continue"}'::jsonb, 'uspech');
select is(public.hook_password_verification_attempt('{"user_id": "zle", "valid": false}'), '{"decision": "continue"}'::jsonb, 'chybny vstup neblokuje');
select is((select count(*) from public.hr_login_failures where user_id = '00000000-0000-0000-0000-0000000000d2')::int, 1, 'zapisany len neuspech');
select public.hook_password_verification_attempt('{"user_id": "00000000-0000-0000-0000-0000000000d3", "valid": false}');
select is((select count(*) from public.hr_login_failures where user_id = '00000000-0000-0000-0000-0000000000d3')::int, 0, 'ucet mimo HR sa nezapisuje');
select public.hook_mfa_verification_attempt('{"user_id": "00000000-0000-0000-0000-0000000000d2", "valid": false}');
select is((select kind from public.hr_login_failures where user_id = '00000000-0000-0000-0000-0000000000d2' order by id desc limit 1), 'MFA', 'neuspesny kod MFA');
select ok(not exists (select 1 from public.hr_notifications where event_type = 'LOGIN_FAILURES'), 'pod 5 bez upozornenia');
select public.hook_password_verification_attempt('{"user_id": "00000000-0000-0000-0000-0000000000d2", "valid": false}') from generate_series(1, 4);
select is((select count(*) from public.hr_notifications where event_type = 'LOGIN_FAILURES' and entity_id = '00000000-0000-0000-0000-0000000000d2')::int, 1,
  '5 za 15 min -> jedno upozornenie jednatelovi (nie pri kazdom dalsom)');

-- ---------- prehlad ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d2", "email": "personalistka.ucty@test.local", "role": "authenticated", "aal": "aal2"}';
select throws_ok($$select * from public.hr_account_security_overview()$$, '42501', null, 'personalistka prehlad nevidi');
select throws_ok($$select count(*) from public.hr_login_failures$$, '42501', null, 'tabulku neuspechov priamo necita');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d1", "email": "konatel.ucty@test.local", "role": "authenticated", "aal": "aal2"}';
select is((select array[active_sessions, failed_7d, jsonb_array_length(devices)] from public.hr_account_security_overview() where email = 'personalistka.ucty@test.local'),
  array[2, 6, 3], 'aktivne relacie 2 (viac zariadeni), neuspechy 6, zariadenia za 24 h (aj stara relacia)');

-- ---------- odchod ----------
reset role;
select ok(not has_function_privilege('authenticated', 'public.hr_offboard_user(uuid, uuid, text, text)', 'EXECUTE'), 'odchod len server');
-- ukoncenie pristupu do HR: ucet a relacie ostavaju
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d4', 'ucetni.ucty@test.local');
insert into public.hr_permissions (id, user_email, profile, valid_until) values ('p-d4', 'ucetni.ucty@test.local', 'UCTOVNIK_EXT', current_date + 30);
insert into auth.sessions (id, user_id, created_at, updated_at) values ('00000000-0000-0000-0000-00000000d401', '00000000-0000-0000-0000-0000000000d4', now(), now());
select lives_ok($$select public.hr_offboard_user('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000d1', 'Konec spolupráce v HR', 'HR')$$, 'koniec pristupu do HR');
select is((select valid_until from public.hr_permissions where id = 'p-d4'), current_date - 1, 'HR skoncilo');
select is((select count(*) from auth.sessions where user_id = '00000000-0000-0000-0000-0000000000d4')::int, 1, 'relacie v ERP ostavaju');
select ok(exists (select 1 from public.hr_notifications where event_type = 'HR_ACCESS_ENDED'), 'upozornenie: koniec HR');
select ok(exists (select 1 from public.audit_log where entity = 'auth_user' and entity_id = '00000000-0000-0000-0000-0000000000d4' and new_value->>'hr_access_ended' = 'true'), 'audit: koniec HR');
select throws_like($$select public.hr_offboard_user('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000d1', 'Neznama akce', 'X')$$, '%Neznámá%', 'neznama akcia nie');
select throws_like($$select public.hr_offboard_user('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1', 'x')$$, '%důvod%', 'bez dovodu nie');
select throws_like($$select public.hr_offboard_user('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2', 'Odchod jednatele')$$, '%IT serverově%', 'jednatela nie');
select throws_like($$select public.hr_offboard_user('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d2', 'Sám sebe')$$, '%Vlastní%', 'seba nie');
select lives_ok($$select public.hr_offboard_user('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1', 'Skončení pracovního poměru')$$, 'odchod personalistky');
select is((select valid_until from public.hr_permissions where id = 'p-d2'), current_date - 1, 'pristup do HR skoncil vcera');
select ok((select note like 'Odchod:%' from public.hr_permissions where id = 'p-d2'), 'dovod pri pristupe');
select is((select count(*) from auth.sessions where user_id = '00000000-0000-0000-0000-0000000000d2')::int, 0, 'relacie zrusene');
select ok(exists (select 1 from public.audit_log where entity = 'auth_user' and entity_id = '00000000-0000-0000-0000-0000000000d2'
  and new_value->>'offboarded' = 'true' and changed_by = '00000000-0000-0000-0000-0000000000d1'), 'zaznam v audite (kto)');
select ok(exists (select 1 from public.audit_log where entity = 'hr_permissions' and entity_id = 'p-d2' and action = 'update'), 'zmena pristupu v audite');
select ok(exists (select 1 from public.hr_notifications where event_type = 'USER_OFFBOARDED'), 'upozornenie jednatelovi');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d2", "email": "personalistka.ucty@test.local", "role": "authenticated", "aal": "aal2"}';
select ok(not public.hr_has_permission('HR_VIEW_BASIC'), 'po odchode ziadne opravnenie v HR');


-- ---------- nove zariadenie ----------
reset role;
delete from public.hr_known_devices where user_id = '00000000-0000-0000-0000-0000000000d1';
insert into auth.sessions (id, user_id, created_at, updated_at, user_agent) values
  ('00000000-0000-0000-0000-00000000d101', '00000000-0000-0000-0000-0000000000d1', now(), now(), 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0.1');
select ok(not exists (select 1 from public.hr_notifications where event_type = 'NEW_DEVICE' and entity_id = '00000000-0000-0000-0000-0000000000d1'),
  'prve zariadenie sa len zapise');
insert into auth.sessions (id, user_id, created_at, updated_at, user_agent) values
  ('00000000-0000-0000-0000-00000000d102', '00000000-0000-0000-0000-0000000000d1', now(), now(), 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.5.2');
select ok(not exists (select 1 from public.hr_notifications where event_type = 'NEW_DEVICE' and entity_id = '00000000-0000-0000-0000-0000000000d1'),
  'nova verzia prehliadaca nie je nove zariadenie');
insert into auth.sessions (id, user_id, created_at, updated_at, user_agent) values
  ('00000000-0000-0000-0000-00000000d103', '00000000-0000-0000-0000-0000000000d1', now(), now(), 'Mozilla/5.0 (iPad; CPU OS 17_0) Safari/604.1');
select is((select count(*) from public.hr_notifications where event_type = 'NEW_DEVICE' and entity_id = '00000000-0000-0000-0000-0000000000d1')::int, 1,
  'nove zariadenie -> upozornenie jednatelovi');
insert into auth.sessions (id, user_id, created_at, updated_at, user_agent) values
  ('00000000-0000-0000-0000-00000000d301', '00000000-0000-0000-0000-0000000000d3', now(), now(), 'Iny');
select ok(not exists (select 1 from public.hr_known_devices where user_id = '00000000-0000-0000-0000-0000000000d3'), 'ucet mimo HR sa nesleduje');

select * from finish();
rollback;
