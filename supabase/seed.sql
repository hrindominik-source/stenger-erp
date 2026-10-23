-- Lokalne testovacie data (npx supabase db reset). VYMYSLENE udaje, iba pre
-- lokalny Supabase - nikdy nespustat proti produkcii.
-- Prihlasenie v `npm run dev`: hr.admin@test.local / test-heslo-lokal
--                              personalista@test.local / test-heslo-lokal

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
  email_change, email_change_token_new)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
   'hr.admin@test.local', extensions.crypt('test-heslo-lokal', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated',
   'personalista@test.local', extensions.crypt('test-heslo-lokal', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   '{"sub":"11111111-1111-1111-1111-111111111111","email":"hr.admin@test.local"}', 'email', now(), now(), now()),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222',
   '{"sub":"22222222-2222-2222-2222-222222222222","email":"personalista@test.local"}', 'email', now(), now(), now())
on conflict do nothing;

insert into public.profiles (id, full_name, role) values
  ('11111111-1111-1111-1111-111111111111', 'Test HR Admin', 'office'),
  ('22222222-2222-2222-2222-222222222222', 'Test Personalista', 'office')
on conflict (id) do nothing;

insert into public.hr_permissions (id, user_email, permissions) values
  ('seed-test-admin', 'hr.admin@test.local', array['HR_ADMIN']),
  ('seed-test-hr', 'personalista@test.local', array['HR_VIEW_BASIC', 'HR_VIEW_SENSITIVE', 'HR_EDIT',
    'HR_DOCUMENT_GENERATE', 'HR_DOCUMENT_SIGN', 'HR_DOCUMENT_SEND'])
on conflict (user_email) do nothing;

insert into public.positions (id, code, name) values
  ('pos-test-hi001', 'HI-001', 'Dělník/dělnice výroby')
on conflict (id) do nothing;

insert into public.employees (id, first_name, last_name, gender, date_of_birth, private_email, permanent_address, record_flag)
values
  ('emp-test-1', 'Jan', 'Vzorový', 'muz', '1990-05-01', 'jan.vzorovy@example.com',
   '{"ulice": "Testovací", "cislo_popisne": "1", "mesto": "Příbram", "psc": "26101"}', 'TEST'),
  ('emp-test-2', 'Eva', 'Ukázková', 'zena', '1995-09-12', null,
   '{"ulice": "Zkušební", "cislo_popisne": "2", "mesto": "Příbram", "psc": "26101"}', 'TEST')
on conflict (id) do nothing;

insert into public.employment_relationships (id, employee_id, status, employment_type, start_date, weekly_hours, workplace, position_id)
values
  ('er-test-1', 'emp-test-1', 'ACTIVE', 'doba_urcita', current_date + 7, 40, 'Příbram', 'pos-test-hi001'),
  ('er-test-2', 'emp-test-2', 'ACTIVE', 'doba_neurcita', current_date - 30, 40, 'Příbram', 'pos-test-hi001')
on conflict (id) do nothing;

-- Osoby s plnou mocou (vymyslene, len lokalne). Mgr. Jana Zkusebni podpisuje
-- uctom hr.admin@test.local; Ing. Petr Vzorovy nema ucet (jen papier).
insert into public.hr_signatories (id, full_name, full_name_instrumental, user_id, valid_from, note) values
  ('seed-sig-1', 'Mgr. Jana Zkušební', 'Mgr. Janou Zkušební', '11111111-1111-1111-1111-111111111111', '2026-01-01', 'vymyšlená osoba – lokální test'),
  ('seed-sig-2', 'Ing. Petr Vzorový', 'Ing. Petrem Vzorovým', null, '2026-01-01', 'vymyšlená osoba – lokální test')
on conflict (id) do nothing;
