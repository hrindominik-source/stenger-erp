-- DB testy migracie 74 (balik H): polrocna revizia, revizia sablony,
-- strazca zmien zakona (bez automatickych zmien). Iba lokalne.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'konatel.rev@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', 'personalistka.rev@test.local');
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000e1', 'Test Konatel Rev', 'office'),
  ('00000000-0000-0000-0000-0000000000e2', 'Test Personalistka Rev', 'personalistika');
insert into public.hr_permissions (id, user_email, profile) values
  ('p-e1', 'konatel.rev@test.local', 'KONATEL'),
  ('p-e2', 'personalistka.rev@test.local', 'PERSONALISTA');

-- ---------- terminy ----------
select is(public.hr_revision_period('2026-05-15'), '2026-01-01'::date, 'v maji plati 1. 1.');
select is(public.hr_revision_period('2026-06-05'), '2026-07-01'::date, '30 dni pred 1. 7.');
select is(public.hr_revision_period('2026-12-05'), '2027-01-01'::date, '30 dni pred 1. 1. dalsieho roka');
select is(public.hr_revision_period('2026-10-29'), '2026-07-01'::date, 'v oktobri plati 1. 7.');

-- ---------- pripomienky ----------
update public.hr_document_templates set next_review_date = null;
update public.hr_legal_text_versions set next_review_date = null;
delete from public.hr_revision_reviews;
update public.hr_document_templates set next_review_date = current_date + 10 where id = (select id from public.hr_document_templates order by id limit 1);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000e2", "email": "personalistka.rev@test.local", "role": "authenticated", "aal": "aal2"}';
select throws_ok($$select public.hr_revision_notify()$$, '42501', null, 'personalistka pripomienky nespusti');
select throws_ok($$select * from public.hr_revision_due_list()$$, '42501', null, 'zoznam len jednatel');
select throws_ok($$select public.hr_revision_confirm(public.hr_revision_period(), 'ok ok')$$, '42501', null, 'potvrdzuje len jednatel');
select is((select count(*) from public.hr_legislation_watch)::int, 0, 'strazcu nevidi');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000e1", "email": "konatel.rev@test.local", "role": "authenticated", "aal": "aal2"}';
select is((select count(*) from public.hr_revision_due_list())::int, 2, 'polrocna revizia + sablona');
select is(public.hr_revision_notify(), 2, 'dve upozornenia');
select is(public.hr_revision_notify(), 0, 'opakovane spustenie nic nepridava');
select throws_like($$select public.hr_revision_confirm(public.hr_revision_period(), ' ')$$, '%zkontrolováno%', 'potvrdenie s poznamkou');
select lives_ok($$select public.hr_revision_confirm(public.hr_revision_period(), 'Šablony, texty a parametry zkontrolovány')$$, 'jednatel potvrdi revizu');
select throws_like($$select public.hr_revision_confirm(public.hr_revision_period(), 'znova')$$, '%už je potvrzena%', 'druhy raz nie');
reset role;
select is((select count(*) from public.hr_notifications where event_type = 'REVISION_DUE' and resolved_at is null)::int, 1, 'polrocna vyriesena, sablona ostava');
update public.hr_document_templates set next_review_date = current_date + 365 where next_review_date = current_date + 10;
select public.hr_revision_notify();
select is((select count(*) from public.hr_notifications where event_type = 'REVISION_DUE' and resolved_at is null)::int, 0, 'po posunuti datumu revizie vyriesene');
select ok(exists (select 1 from public.audit_log where entity = 'hr_revision_reviews' and action = 'insert'), 'potvrdenie v audite');

-- ---------- strazca legislativy ----------
select is((select array[enabled::text, coalesce(source_url, '-')] from public.hr_legislation_watch where id = 'ZP_262_2006'), array['false', '-'], 'predvolene vypnuty, bez zdroja');
select throws_ok($$update public.hr_legislation_watch set enabled = true where id = 'ZP_262_2006'$$, '23514', null, 'zapnut bez zdroja nejde');
select throws_ok($$update public.hr_legislation_watch set source_url = 'https://evil.example/x' where id = 'ZP_262_2006'$$, '23514', null, 'zdroj len e-Sbirka');
select throws_ok($$update public.hr_legislation_watch set source_url = 'http://e-sbirka.gov.cz/x' where id = 'ZP_262_2006'$$, '23514', null, 'len https');
select throws_ok($$update public.hr_legislation_watch set source_url = 'https://e-sbirka.gov.cz.evil.example/x' where id = 'ZP_262_2006'$$, '23514', null, 'podvrhnuta domena nie');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000e1", "email": "konatel.rev@test.local", "role": "authenticated", "aal": "aal2"}';
select lives_ok($$update public.hr_legislation_watch set source_url = 'https://e-sbirka.gov.cz/test/262', enabled = true where id = 'ZP_262_2006'$$, 'jednatel nastavi zdroj');
select throws_ok($$update public.hr_legislation_watch set last_fingerprint = 'x' where id = 'ZP_262_2006'$$, '42501', null, 'odtlacok meni len server');
select throws_ok($$select public.hr_legislation_record('ZP_262_2006', 'a', 'a', null)$$, '42501', null, 'zapis vysledku len server');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000e2", "email": "personalistka.rev@test.local", "role": "authenticated", "aal": "aal2"}';
update public.hr_legislation_watch set enabled = false where id = 'ZP_262_2006';
reset role;
select is((select enabled from public.hr_legislation_watch where id = 'ZP_262_2006'), true, 'personalistka nevypne');
select ok(exists (select 1 from public.audit_log where entity = 'hr_legislation_watch' and action = 'update'), 'zmena zdroja v audite');

select is(public.hr_legislation_record('ZP_262_2006', 'odtlacok-1', 'v1', null), 'FIRST', 'prvy odtlacok sa len ulozi');
select is(public.hr_legislation_record('ZP_262_2006', 'odtlacok-1', 'v1', null), 'SAME', 'bez zmeny');
select ok(not exists (select 1 from public.hr_notifications where event_type = 'LEGISLATION_CHANGED'), 'bez upozornenia');
select is(public.hr_legislation_record('ZP_262_2006', 'odtlacok-2', 'v2', null), 'CHANGED', 'zmena');
select ok(exists (select 1 from public.hr_notifications where event_type = 'LEGISLATION_CHANGED' and kind = 'KE_SCHVALENI' and title like '%nic se nezměnilo automaticky%'),
  'jednatel upozorneny, nic sa nemeni');
select is((select count(*) from public.hr_legal_parameters where entered_at > now() - interval '1 minute')::int, 0, 'parametre sa nezmenili');
select public.hr_legislation_record('ZP_262_2006', null, null, 'HTTP 503') from generate_series(1, 2);
select ok(not exists (select 1 from public.hr_notifications where event_type = 'LEGISLATION_CHECK_FAILED'), '2 chyby bez upozornenia');
select public.hr_legislation_record('ZP_262_2006', null, null, 'HTTP 503') from generate_series(1, 2);
select is((select count(*) from public.hr_notifications where event_type = 'LEGISLATION_CHECK_FAILED')::int, 1, '3+ chyby -> jedno upozornenie za den');
select is((select last_fingerprint from public.hr_legislation_watch where id = 'ZP_262_2006'), 'odtlacok-2', 'chyba neprepise posledny odtlacok');

select * from finish();
rollback;
