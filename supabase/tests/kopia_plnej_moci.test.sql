-- DB testy migracie 81: kopiu plnej moci uklada len server, je nemenna,
-- subor kopie vidi kazdy s HR_VIEW_BASIC, original ostava podla citlivosti.
-- Iba lokalne. Vymyslene udaje.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'konatel.pm@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', 'zaklad.pm@test.local');
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000e1', 'Test Konatel PM', 'office'),
  ('00000000-0000-0000-0000-0000000000e2', 'Test Zaklad PM', 'office');
insert into public.hr_permissions (id, user_email, profile, permissions) values
  ('p-e1', 'konatel.pm@test.local', 'KONATEL', '{}'),
  ('p-e2', 'zaklad.pm@test.local', 'VLASTNI', array['HR_VIEW_BASIC']);
insert into public.hr_signatories (id, full_name, full_name_instrumental, valid_from, valid_to, poa_scan_path, poa_scan_sha256, poa_copy_path, poa_copy_sha256)
  values ('sig-e', 'Bc. Testovací Zástupkyně', 'Bc. Testovací Zástupkyní', '2025-07-01', '2030-07-01',
    'plne-moci/sig-e-orig.pdf', repeat('a', 64), 'plne-moci/sig-e-kopie-x.pdf', repeat('b', 64));

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000e1", "email": "konatel.pm@test.local", "role": "authenticated", "aal": "aal2"}';
select throws_ok($$update public.hr_signatories set poa_copy_path = 'plne-moci/ina.pdf', poa_copy_sha256 = repeat('c', 64) where id = 'sig-e'$$,
  null, 'Kopie plne moci je nemenna - pro novou plnou moc zalozte novy zaznam.', 'kopia je nemenna');
select throws_ok($$insert into public.hr_signatories (full_name, full_name_instrumental, valid_from, poa_copy_path, poa_copy_sha256)
  values ('Nová Osoba', 'Novou Osobou', '2026-01-01', 'plne-moci/n.pdf', repeat('d', 64))$$, null, 'Sken plne moci uklada server.', 'kopiu uklada len server');
select lives_ok($$update public.hr_signatories set valid_to = '2030-06-30' where id = 'sig-e'$$, 'platnost sa da upravit');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000e2", "email": "zaklad.pm@test.local", "role": "authenticated", "aal": "aal2"}';
select ok(public.hr_object_path_visible('plne-moci/sig-e-kopie-x.pdf'), 'kopiu vidi HR_VIEW_BASIC');
select ok(not public.hr_object_path_visible('plne-moci/sig-e-orig.pdf'), 'original nie (HR_VIEW_SENSITIVE)');
select ok(not public.hr_object_path_visible('plne-moci/neznamy.pdf'), 'neznamy subor nie');
reset role;

select throws_ok($$insert into public.hr_signatories (full_name, full_name_instrumental, valid_from, poa_copy_path)
  values ('Bez Otlacku', 'Bez Otlacku', '2026-01-01', 'plne-moci/bez.pdf')$$,
  '23514', null, 'cesta a otlacok kopie idu spolu');

select * from finish();
rollback;
