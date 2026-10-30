-- DB testy migracie 79: hr_nastaveni cita HR_VIEW_BASIC, meni HR_EDIT
-- (aj rola 'personalistika'), ostatni nic. Iba lokalne. Vymyslene udaje.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'personalistka.nast@test.local'),
  ('00000000-0000-0000-0000-0000000000c2', 'sklad.nast@test.local');
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000c1', 'Test Personalistka Nast', 'personalistika'),
  ('00000000-0000-0000-0000-0000000000c2', 'Test Sklad Nast', 'sklad');
insert into public.hr_permissions (id, user_email, profile) values ('p-n1', 'personalistka.nast@test.local', 'PERSONALISTA');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000c1", "email": "personalistka.nast@test.local", "role": "authenticated", "aal": "aal2"}';
insert into public.hr_nastaveni (key, value) values ('lekar_kontakt', '{"volat": "paní MUDr. Testové", "telefon": "000", "ordinace": "ordinace X"}');
update public.hr_nastaveni set value = value || '{"telefon": "111"}' where key = 'lekar_kontakt';
select is((select value->>'telefon' from public.hr_nastaveni where key = 'lekar_kontakt'), '111', 'personalistka zapise a upravi kontakt');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000c2", "email": "sklad.nast@test.local", "role": "authenticated", "aal": "aal2"}';
select is((select count(*)::int from public.hr_nastaveni), 0, 'sklad nevidi nastavenia');
select throws_ok($$insert into public.hr_nastaveni (key, value) values ('x', '{}')$$, '42501', null, 'sklad nezapise');
reset role;

select ok(exists (select 1 from public.audit_log where entity = 'hr_nastaveni'), 'zmena je v audit_log');
select * from finish();
rollback;
