-- DB testy migracie 56 (faza G): e-mailove dorucovanie - prechody stavu
-- odoslania, doklad o dodani, § 21 lehota a odstupenie, § 335 fikcia a
-- neucinnost, zapis len serverom. Iba lokalne: npx supabase test db.
-- Vymyslene udaje.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'hr.e@test.local');
insert into public.profiles (id, full_name, role) values ('00000000-0000-0000-0000-0000000000e1', 'Test Personalista E', 'office');
insert into public.hr_permissions (id, user_email, permissions) values
  ('p-e1', 'hr.e@test.local', array['HR_VIEW_BASIC', 'HR_VIEW_SENSITIVE', 'HR_VIEW_PAYROLL', 'HR_EDIT', 'HR_DOCUMENT_SEND']);
insert into public.employees (id, first_name, last_name, private_email) values ('emp-e1', 'Eva', 'Emailova', 'eva@example.test');
insert into public.hr_documents (id, employee_id, doc_type, origin, status, final_pdf_path, final_pdf_sha256, final_pdf_text_check, finalized_at) values
  ('e-ps', 'emp-e1', 'pracovni_smlouva', 'GENERATED', 'READY_FOR_SIGNATURE', 'zamestnanci/emp-e1/e-ps/f.pdf', repeat('1', 64), '{"ok": true, "server_verified": true}', now()),
  ('e-mv', 'emp-e1', 'mzdovy_vymer', 'GENERATED', 'READY_FOR_SIGNATURE', 'zamestnanci/emp-e1/e-mv/f.pdf', repeat('2', 64), '{"ok": true, "server_verified": true}', now());
insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, document_hash, file_path) values
  ('e-p1', 'e-ps', 'PAPER', 'EMPLOYEE', 'Eva Emailova', repeat('c', 64), 'zamestnanci/emp-e1/e-ps/sken.pdf'),
  ('e-p2', 'e-ps', 'PAPER', 'EMPLOYER', 'Mgr. Jana Zkusebni', repeat('c', 64), 'zamestnanci/emp-e1/e-ps/sken.pdf');
insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, signed_content_sha256, document_hash, file_path)
  values ('e-q', 'e-mv', 'ELECTRONIC_QUALIFIED', 'EMPLOYER', 'Mgr. Jana Zkusebni', repeat('2', 64), repeat('3', 64), 'zamestnanci/emp-e1/e-mv/pades.pdf');
insert into public.hr_signature_verifications (signature_id, result, method, service_name) values ('e-q', 'VALID', 'AUTOMATIC', 'test');
update public.hr_documents set status = 'SIGNED' where id in ('e-ps', 'e-mv');
insert into public.employee_contact_declarations (id, kind, employee_id, email_snapshot, declared_at, channel, notice_version_id) values
  ('d-e21', 'S21_ADDRESS_NOTICE', 'emp-e1', 'eva@example.test', now(), 'TABLET_HR', null),
  ('d-e335', 'S335_CONSENT', 'emp-e1', 'eva@example.test', now(), 'TABLET_HR', 'lt-s335-notice-v1');

select is(public.hr_valid_contact_declaration_server('emp-e1', 'S21_ADDRESS_NOTICE'), 'd-e21', 'serverova kontrola § 21 oznamenia');

-- ---------- prechody stavu odoslania ----------
select lives_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, recipient_snapshot, declaration_id, send_status)
  values ('dl-e1', 'e-ps', 'EMAIL_S21', 'eva@example.test', 'd-e21', 'QUEUED')$$, 'server zalozi zasielku § 21 (QUEUED)');
select is((select queued_at is not null from public.hr_document_deliveries where id = 'dl-e1'), true, 'cas zaradenia doplneny');
select throws_ok($$update public.hr_document_deliveries set send_status = 'BOUNCED' where id = 'dl-e1'$$, 'P0001', null, 'QUEUED -> BOUNCED neplatny prechod');
select throws_ok($$update public.hr_document_deliveries set send_status = 'SENT' where id = 'dl-e1'$$, 'P0001', null, 'odoslane bez casu odoslania');
select throws_ok($$update public.hr_document_deliveries set provider_delivered_at = now() where id = 'dl-e1'$$, 'P0001', null, 'doklad o dodani len po odoslani');
update public.hr_document_deliveries set send_status = 'SENT', sent_at = now() - interval '3 days', attempts = 1 where id = 'dl-e1';
select is((select delivered_at from public.hr_document_deliveries where id = 'dl-e1'), null, 'odoslane != dorucene');
select throws_ok($$update public.hr_document_deliveries set delivered_at = now(), delivery_basis = 'EMPLOYEE_CONFIRMATION' where id = 'dl-e1'$$, 'P0001', null, 'potvrdenie zamestnanca len s ulozenym potvrdenim');
select throws_ok($$update public.hr_document_deliveries set delivered_at = now(), delivery_basis = 'FICTION_15_DAYS' where id = 'dl-e1'$$, 'P0001', null, '§ 21 nema fikciu dorucenia');
select throws_ok($$update public.hr_document_deliveries set delivered_at = now(), delivery_basis = 'PROVIDER_DELIVERED_S21' where id = 'dl-e1'$$, 'P0001', null, 'dodane do schranky len s dokladom poskytovatela');

-- ---------- § 21: dodanie, lehota 7 dni, odstupenie ----------
update public.hr_document_deliveries set provider_delivered_at = now() - interval '2 days', delivered_at = now() - interval '2 days', delivery_basis = 'PROVIDER_DELIVERED_S21' where id = 'dl-e1';
select is((select withdrawal_deadline from public.hr_document_deliveries where id = 'dl-e1'),
  ((now() - interval '2 days') at time zone 'Europe/Prague')::date + 7, 'lehota na odstupenie = 7 dni od dodania');
select throws_ok($$update public.hr_document_deliveries set provider_delivered_at = now() where id = 'dl-e1'$$, 'P0001', null, 'doklad o dodani sa nemeni');
select throws_ok($$update public.hr_document_deliveries set withdrawal_received_at = now() where id = 'dl-e1'$$, 'P0001', null, 'odstupenie len so skenom');
select throws_ok($$update public.hr_document_deliveries set withdrawal_received_at = now(), withdrawal_scan_path = 'prevzeti/ine/x.pdf', withdrawal_scan_sha256 = repeat('a', 64) where id = 'dl-e1'$$,
  'P0001', null, 'sken odstupenia len v zlozke dokumentu');
select lives_ok($$update public.hr_document_deliveries set withdrawal_received_at = now(), withdrawal_scan_path = 'prevzeti/e-ps/odst.pdf', withdrawal_scan_sha256 = repeat('a', 64) where id = 'dl-e1'$$,
  'odstupenie v lehote zaznamenane');
select throws_ok($$update public.hr_document_deliveries set withdrawal_scan_path = 'prevzeti/e-ps/ine.pdf' where id = 'dl-e1'$$, 'P0001', null, 'sken odstupenia je nemenny');

insert into public.hr_document_deliveries (id, hr_document_id, channel, recipient_snapshot, declaration_id, send_status)
  values ('dl-e2', 'e-ps', 'EMAIL_S21', 'eva@example.test', 'd-e21', 'QUEUED');
update public.hr_document_deliveries set send_status = 'SENT', sent_at = now() - interval '12 days', attempts = 1 where id = 'dl-e2';
update public.hr_document_deliveries set provider_delivered_at = now() - interval '10 days', delivered_at = now() - interval '10 days', delivery_basis = 'PROVIDER_DELIVERED_S21' where id = 'dl-e2';
select throws_like($$update public.hr_document_deliveries set withdrawal_received_at = now(), withdrawal_scan_path = 'prevzeti/e-ps/odst2.pdf', withdrawal_scan_sha256 = repeat('a', 64) where id = 'dl-e2'$$,
  '%po lhute%', 'odstupenie po lehote odmietnute');

-- ---------- zlyhanie: max. 3 pokusy; nedorucitelnost ----------
insert into public.hr_document_deliveries (id, hr_document_id, channel, recipient_snapshot, send_status)
  values ('dl-e3', 'e-mv', 'EMAIL_S335_WAGE_OTHER_ADDRESS', 'jina@example.test', 'QUEUED');
select throws_ok($$update public.hr_document_deliveries set send_status = 'FAILED' where id = 'dl-e3'$$, 'P0001', null, 'zlyhanie bez chyby');
update public.hr_document_deliveries set send_status = 'FAILED', send_error = 'x', attempts = 1 where id = 'dl-e3';
update public.hr_document_deliveries set send_status = 'QUEUED' where id = 'dl-e3';
select is((select send_error from public.hr_document_deliveries where id = 'dl-e3'), null, 'opakovanie vymaze chybu');
update public.hr_document_deliveries set send_status = 'FAILED', send_error = 'x', attempts = 2 where id = 'dl-e3';
update public.hr_document_deliveries set send_status = 'QUEUED' where id = 'dl-e3';
update public.hr_document_deliveries set send_status = 'FAILED', send_error = 'x', attempts = 3 where id = 'dl-e3';
select throws_ok($$update public.hr_document_deliveries set send_status = 'QUEUED' where id = 'dl-e3'$$, 'P0001', null, 'po 3 pokusoch uz nie');
select throws_ok($$update public.hr_document_deliveries set attempts = 4 where id = 'dl-e3'$$, '23514', null, 'najviac 3 pokusy');

insert into public.hr_document_deliveries (id, hr_document_id, channel, recipient_snapshot, send_status)
  values ('dl-e4', 'e-mv', 'EMAIL_S335_WAGE_OTHER_ADDRESS', 'bounce@example.test', 'QUEUED');
update public.hr_document_deliveries set send_status = 'SENT', sent_at = now(), attempts = 1 where id = 'dl-e4';
update public.hr_document_deliveries set send_status = 'BOUNCED', send_error = '550' where id = 'dl-e4';
select is((select ineffective_at is not null from public.hr_document_deliveries where id = 'dl-e4'), true, 'nedorucitelna sprava = neucinne');
select throws_ok($$update public.hr_document_deliveries set send_status = 'QUEUED' where id = 'dl-e4'$$, 'P0001', null, 'vratena sprava sa znovu neposiela');

-- ---------- sweep: § 335 odst. 3 neucinnost, § 335 fikcia ----------
insert into public.hr_document_deliveries (id, hr_document_id, channel, recipient_snapshot, send_status) values
  ('dl-e5', 'e-mv', 'EMAIL_S335_WAGE_OTHER_ADDRESS', 'stara@example.test', 'QUEUED'),
  ('dl-e6', 'e-mv', 'EMAIL_S335_WAGE_OTHER_ADDRESS', 'cerstva@example.test', 'QUEUED');
insert into public.hr_document_deliveries (id, hr_document_id, channel, recipient_snapshot, declaration_id, send_status) values
  ('dl-e7', 'e-mv', 'EMAIL_S335_CONSENT', 'eva@example.test', 'd-e335', 'QUEUED'),
  ('dl-e8', 'e-mv', 'EMAIL_S335_CONSENT', 'eva@example.test', 'd-e335', 'QUEUED');
update public.hr_document_deliveries set send_status = 'SENT', sent_at = now() - interval '16 days', attempts = 1 where id = 'dl-e5';
update public.hr_document_deliveries set send_status = 'SENT', sent_at = now() - interval '5 days', attempts = 1 where id = 'dl-e6';
update public.hr_document_deliveries set send_status = 'SENT', sent_at = now() - interval '17 days', attempts = 1 where id in ('dl-e7', 'dl-e8');
update public.hr_document_deliveries set provider_delivered_at = now() - interval '16 days' where id = 'dl-e7';
select throws_ok($$update public.hr_document_deliveries set delivered_at = now() - interval '3 days', delivery_basis = 'FICTION_15_DAYS' where id = 'dl-e7'$$,
  'P0001', null, 'fikcia len presne 15. den od dodania');
select cmp_ok(public.hr_document_deliveries_sweep(), '>=', 2, 'sweep vyhodnoti lehoty');
select is((select ineffective_at is not null from public.hr_document_deliveries where id = 'dl-e5'), true, 'bez potvrdenia do 15 dni od odoslania = neucinne');
select is((select ineffective_at is null and delivered_at is null from public.hr_document_deliveries where id = 'dl-e6'), true, 'v lehote este otvorene');
select is((select delivery_basis from public.hr_document_deliveries where id = 'dl-e7'), 'FICTION_15_DAYS', 'fikcia dorucenia 15. den od dodania');
select is(((select delivered_at from public.hr_document_deliveries where id = 'dl-e7') at time zone 'Europe/Prague')::date,
  ((now() - interval '16 days') at time zone 'Europe/Prague')::date + 15, 'datum fikcie = 15. den');
select is((select delivered_at from public.hr_document_deliveries where id = 'dl-e8'), null, 'bez dokladu o dodani fikcia nebezi');
-- fikcia nikdy bez dokladu o dodani: samotne odoslanie (ani po 40 dnoch) nestaci
select throws_ok($$update public.hr_document_deliveries set sent_at = now() - interval '40 days' where id = 'dl-e8'$$, 'P0001', null, 'cas odoslania sa neprepisuje (lehotu nejde posunut)');
select throws_ok($$update public.hr_document_deliveries set delivered_at = sent_at + interval '15 days', delivery_basis = 'FICTION_15_DAYS' where id = 'dl-e8'$$,
  'P0001', null, 'fikcia bez dokladu o dodani odmietnuta ani ked uplynulo 15 dni od odoslania');
select throws_ok($$update public.hr_document_deliveries set delivered_at = now(), delivery_basis = 'FICTION_15_DAYS' where id = 'dl-e5'$$,
  'P0001', null, 'mzdovy vymer na inu adresu: fikcia nikdy');
select is(public.hr_document_deliveries_sweep(), 0, 'sweep je idempotentny');

-- ---------- HR: len server zapisuje e-mail ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000e1", "email": "hr.e@test.local", "role": "authenticated"}';
select throws_like($$insert into public.hr_document_deliveries (id, hr_document_id, channel, recipient_snapshot, declaration_id, send_status)
  values ('dl-hr', 'e-ps', 'EMAIL_S21', 'eva@example.test', 'd-e21', 'QUEUED')$$, '%server%', 'HR nezalozi e-mailovu zasielku');
select throws_like($$update public.hr_document_deliveries set provider_delivered_at = now() where id = 'dl-e6'$$, '%server%', 'HR nezapise doklad o dodani');
select throws_like($$update public.hr_document_deliveries set send_status = 'QUEUED' where id = 'dl-e3'$$, '%server%', 'HR nemeni stav odoslania');
select lives_ok($$select public.hr_document_deliveries_sweep()$$, 'HR moze spustit vyhodnotenie lehot');
select throws_ok($$select public.hr_valid_contact_declaration_server('emp-e1', 'S21_ADDRESS_NOTICE')$$, '42501', null, 'serverova funkcia nie je pre klienta');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d9", "email": "nikto@test.local", "role": "authenticated"}';
select throws_ok($$select public.hr_document_deliveries_sweep()$$, 'P0001', null, 'bez HR prav sweep nie');
reset role;

select * from finish();
rollback;
