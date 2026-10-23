-- DB testy fazy E (detail dokumentu: udalosti, sken k verzii, osobne
-- odovzdanie, nova verzia). Iba lokalne: npx supabase test db
-- Vsetky udaje su vymyslene.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ---------- pripravne data (ako postgres) ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'hr.e@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', 'citatel.e@test.local');
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000e1', 'Test Personalista E', 'office'),
  ('00000000-0000-0000-0000-0000000000e2', 'Test Ctenar E', 'office');
insert into public.hr_permissions (id, user_email, permissions) values
  ('p-e1', 'hr.e@test.local', array['HR_VIEW_BASIC', 'HR_VIEW_SENSITIVE', 'HR_VIEW_PAYROLL', 'HR_EDIT', 'HR_DOCUMENT_GENERATE', 'HR_DOCUMENT_SIGN', 'HR_DOCUMENT_SEND']),
  ('p-e2', 'citatel.e@test.local', array['HR_VIEW_BASIC']);
insert into public.employees (id, first_name, last_name) values ('emp-e', 'Petr', 'Pokusny');
insert into public.hr_documents (id, employee_id, doc_type, origin, status, file_path, final_pdf_path, final_pdf_sha256, final_pdf_text_check, finalized_at) values
  ('e-ps', 'emp-e', 'pracovni_smlouva', 'GENERATED', 'READY_FOR_SIGNATURE', 'zamestnanci/emp-e/e-ps.docx',
    'zamestnanci/emp-e/e-ps/final.pdf', repeat('1', 64), '{"ok": true, "server_verified": true}', now()),
  ('e-napln', 'emp-e', 'popis_pracovniho_mista', 'GENERATED', 'READY_FOR_SIGNATURE', 'zamestnanci/emp-e/e-napln.docx', null, null, null, null),
  ('e-mv', 'emp-e', 'mzdovy_vymer', 'GENERATED', 'READY_FOR_SIGNATURE', 'zamestnanci/emp-e/e-mv.docx', null, null, null, null);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000e1", "email": "hr.e@test.local", "role": "authenticated"}';

-- ---------- 1. stiahnutie k tlaci ----------
select lives_ok($$insert into public.hr_document_events (hr_document_id, event_type) values ('e-ps', 'PRINT_DOWNLOADED')$$, 'HR zaznamena stiahnutie k tlaci');
select is((select document_sha256 from public.hr_document_events where hr_document_id = 'e-ps'), repeat('1', 64), 'udalost nesie otisk stiahnutej verzie (doplni DB)');
select is((select status from public.hr_documents where id = 'e-ps'), 'READY_FOR_SIGNATURE', 'stiahnutie k tlaci nemeni stav');
select throws_ok($$insert into public.hr_document_events (hr_document_id, event_type, created_by) values ('e-ps', 'PRINT_DOWNLOADED', '00000000-0000-0000-0000-0000000000e2')$$,
  '42501', null, 'udalost nejde zapisat za ineho pouzivatela');
select is((select count(*) from (select 1 from public.hr_document_events where hr_document_id = 'e-ps') x)::int, 1, 'udalost sa da precitat');
update public.hr_document_events set event_type = 'PRINT_DOWNLOADED' where hr_document_id = 'e-ps'; -- ziadna update policy -> 0 riadkov
reset role;
select throws_ok($$update public.hr_document_events set created_at = now() - interval '1 day'$$, 'P0001', null, 'udalost je nemenna (ani postgres)');
select throws_ok($$delete from public.hr_document_events$$, 'P0001', null, 'udalost nejde zmazat (ani postgres)');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000e1", "email": "hr.e@test.local", "role": "authenticated"}';

-- ---------- 2. sken patri k verzii + potvrdenie HR ----------
-- od migracie 60 sken zapisuje len server (hr-signing paper_upload)
select throws_like($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, document_hash, file_path, scan_matches_original_confirmed_by)
  values ('es-1', 'e-ps', 'PAPER', 'EMPLOYEE', 'Petr Pokusny', repeat('9', 64), 'zamestnanci-podpisy/e-ps/sken.pdf', '00000000-0000-0000-0000-0000000000e1')$$,
  '%jen server%', 'prehliadac sken podpisu nezapise (len server)');
reset role;
select throws_ok($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, document_hash, file_path, signed_content_sha256, scan_matches_original_confirmed_by)
  values ('es-1', 'e-ps', 'PAPER', 'EMPLOYEE', 'Petr Pokusny', repeat('9', 64), 'zamestnanci-podpisy/e-ps/sken.pdf', repeat('2', 64), '00000000-0000-0000-0000-0000000000e1')$$,
  'P0001', null, 'sken k inej verzii (iny otisk) odmietnuty');
select lives_ok($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, document_hash, file_path, scan_matches_original_confirmed_by)
  values ('es-1', 'e-ps', 'PAPER', 'EMPLOYEE', 'Petr Pokusny', repeat('9', 64), 'zamestnanci-podpisy/e-ps/sken.pdf', '00000000-0000-0000-0000-0000000000e1')$$,
  'server zapise sken s potvrdenim HR');
select is((select signed_content_sha256 from public.hr_document_signatures where id = 'es-1'), repeat('1', 64), 'sken je naviazany na otisk finalneho PDF');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000e1", "email": "hr.e@test.local", "role": "authenticated"}';

-- ---------- 3. osobne odovzdanie ----------
-- zaznamy podpisu a dorucenia zapisuje len server (migracia 60); pravidla plati aj pre neho
set local role service_role;
select throws_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, delivered_at, delivery_basis)
  values ('ed-0', 'e-ps', 'IN_PERSON_PAPER', now(), 'HANDED_OVER')$$, 'P0001', null, 'zmluvu len so zamestnancom nejde odovzdat');
insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, document_hash, file_path, scan_matches_original_confirmed_by)
  values ('es-2', 'e-ps', 'PAPER', 'EMPLOYER', 'JUDr. Zastupce', repeat('9', 64), 'zamestnanci-podpisy/e-ps/sken.pdf', '00000000-0000-0000-0000-0000000000e1');
update public.hr_documents set status = 'SIGNED' where id = 'e-ps';
select lives_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, delivered_at, delivery_basis)
  values ('ed-1', 'e-ps', 'IN_PERSON_PAPER', now(), 'HANDED_OVER')$$, 'podpisanu zmluvu HR osobne odovzda');
select is((select handed_over_by from public.hr_document_deliveries where id = 'ed-1'), '00000000-0000-0000-0000-0000000000e1'::uuid, 'kto odovzdal sa zapise');
select throws_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, delivered_at, delivery_basis)
  values ('ed-f', 'e-ps', 'IN_PERSON_PAPER', now() + interval '2 days', 'HANDED_OVER')$$, 'P0001', null, 'odovzdanie v buducnosti odmietnute');
select throws_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, delivered_at, delivery_basis)
  values ('ed-x', 'e-ps', 'IN_PERSON_PAPER', now(), 'FICTION_15_DAYS')$$, 'P0001', null, 'osobne odovzdanie nemoze mat dovod fikcie');

insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, document_hash, file_path, scan_matches_original_confirmed_by)
  values ('es-3', 'e-mv', 'PAPER', 'EMPLOYER', 'JUDr. Zastupce', repeat('8', 64), 'zamestnanci-podpisy/e-mv/sken.pdf', '00000000-0000-0000-0000-0000000000e1');
update public.hr_documents set status = 'SIGNED' where id = 'e-mv';
select throws_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, delivered_at, delivery_basis)
  values ('ed-2', 'e-mv', 'IN_PERSON_PAPER', now(), 'HANDED_OVER')$$, 'P0001', null, 'mzdovy vymer (§ 334): odovzdanie bez potvrdenia prevzatia odmietnute');
select throws_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, delivered_at, delivery_basis)
  values ('ed-2', 'e-mv', 'IN_PERSON_PAPER', now(), 'SIGNED_RECEIPT')$$, 'P0001', null, 'potvrdenie prevzatia bez zaznamu odmietnute');
select throws_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, delivered_at, delivery_basis, confirmation_evidence)
  values ('ed-2', 'e-mv', 'IN_PERSON_PAPER', now(), 'SIGNED_RECEIPT', '{"receipt": "PAPER_SIGNATURE"}')$$, 'P0001', null, 'potvrdenie prevzatia bez skenu odmietnute (migracia 53)');
set local role authenticated;
select throws_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, delivered_at, delivery_basis, receipt_scan_path, receipt_scan_sha256)
  values ('ed-2', 'e-mv', 'IN_PERSON_PAPER', now(), 'SIGNED_RECEIPT', 'prevzeti/e-mv/ed-2-' || repeat('7', 16) || '.pdf', repeat('7', 64))$$,
  'P0001', null, 'HR sken potvrdenia s vlastnym otiskom nezapise (migracia 55 - otisk pocita server)');
set local role service_role;
select lives_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, delivered_at, delivery_basis, receipt_scan_path, receipt_scan_sha256, handed_over_by)
  values ('ed-2', 'e-mv', 'IN_PERSON_PAPER', now(), 'SIGNED_RECEIPT', 'prevzeti/e-mv/ed-2-' || repeat('7', 16) || '.pdf', repeat('7', 64), '00000000-0000-0000-0000-0000000000e1')$$, 'mzdovy vymer odovzdany proti skenu potvrdenia (server)');
set local role authenticated;

-- ---------- 4. nova verzia ----------
select throws_ok($$select public.hr_document_new_version('e-napln', ' ')$$, 'P0001', null, 'nova verzia vyzaduje dovod');
select throws_ok($$select public.hr_document_new_version('e-ps', 'oprava')$$, 'P0001', null, 'podpisany dokument sa novou verziou nenahradza');
select lives_ok($$select public.hr_document_new_version('e-napln', 'preklep v nazvu pozice')$$, 'nova verzia nepodpisaneho dokumentu');
select is((select array[status, void_reason] from public.hr_documents where id = 'e-napln'), array['SUPERSEDED', 'preklep v nazvu pozice'], 'povodna verzia je nahradena s dovodom');
select is((select array[n.status, n.version_no::text, n.supersedes_document_id, n.legal_act_type] from public.hr_documents n where n.supersedes_document_id = 'e-napln'),
  array['DRAFT', '2', 'e-napln', 'RECEIPT_ACKNOWLEDGEMENT'], 'nova verzia: DRAFT, v2, odkaz na povodnu');
select is((select superseded_by from public.hr_documents where id = 'e-napln'), (select id from public.hr_documents where supersedes_document_id = 'e-napln'), 'povodna odkazuje na novu');
select throws_ok($$select public.hr_document_new_version('e-napln', 'znova')$$, 'P0001', null, 'nahradenu verziu nejde nahradit znova');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000e2", "email": "citatel.e@test.local", "role": "authenticated"}';
select throws_ok($$select public.hr_document_new_version((select id from public.hr_documents where supersedes_document_id = 'e-napln'), 'x')$$,
  'P0001', null, 'bez HR_DOCUMENT_GENERATE nova verzia nejde');
select is((select count(*) from public.hr_document_events where hr_document_id = 'e-ps')::int, 0, 'citatel nevidi udalosti citliveho dokumentu');
select throws_ok($$insert into public.hr_document_events (hr_document_id, event_type) values ('e-ps', 'PRINT_DOWNLOADED')$$, '42501', null, 'citatel nezapise udalost k dokumentu, ktory nevidi');

set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select is((select count(*) from public.hr_document_events)::int, 0, 'anon nevidi ziadne udalosti');
select throws_ok($$insert into public.hr_document_events (hr_document_id, event_type) values ('e-ps', 'PRINT_DOWNLOADED')$$, '42501', null, 'anon nezapise udalost');
reset role;

-- trvale vymazanie testovacieho zamestnanca zmaze aj udalosti
update public.employees set record_flag = 'TEST' where id = 'emp-e';
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000e1", "email": "hr.e@test.local", "role": "authenticated"}';
reset role;
insert into public.hr_permissions (id, user_email, permissions) values ('p-e3', 'hr.e.admin@test.local', array['HR_ADMIN']);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e3', 'hr.e.admin@test.local');
insert into public.profiles (id, full_name, role) values ('00000000-0000-0000-0000-0000000000e3', 'Test Admin E', 'office');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000e3", "email": "hr.e.admin@test.local", "role": "authenticated"}';
select lives_ok($$select public.hr_admin_delete_employee('emp-e', 'testovaci zaznam')$$, 'trvale vymazanie testovacieho zamestnanca s udalostami');
reset role;
select is((select count(*) from public.hr_document_events where hr_document_id like 'e-%')::int, 0, 'udalosti zmazane spolu s dokumentmi');

select * from finish();
rollback;
