-- DB testy migracie 53: zneplatnenie + nova verzia zamknuteho dokumentu,
-- dodatok k podpisanej zmluve, sken potvrdenia o prevzati, evidencia
-- skolenia. Iba lokalne: npx supabase test db. Vymyslene udaje.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- balik E (migracia 71): krok, ktory schvaluje jednatel, ma schvalenu ziadost
-- (samotne pravidlo styroch oci testuje styri_oci.test.sql)
insert into public.hr_approval_requests (kind, entity, entity_id, reason, status) values ('VOID_DOCUMENT', 'hr_documents', 'f-ps', 'test – schváleno jednatelem', 'APPROVED');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'hr.f@test.local'),
  ('00000000-0000-0000-0000-0000000000f2', 'zaklad.f@test.local');
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000f1', 'Test Personalista F', 'office'),
  ('00000000-0000-0000-0000-0000000000f2', 'Test Zaklad F', 'office');
insert into public.hr_permissions (id, user_email, permissions) values
  ('p-f1', 'hr.f@test.local', array['HR_VIEW_BASIC', 'HR_VIEW_SENSITIVE', 'HR_VIEW_PAYROLL', 'HR_EDIT', 'HR_DOCUMENT_GENERATE', 'HR_DOCUMENT_SIGN', 'HR_DOCUMENT_SEND']),
  ('p-f2', 'zaklad.f@test.local', array['HR_VIEW_BASIC', 'HR_EDIT']);
insert into public.employees (id, first_name, last_name) values ('emp-f', 'Karel', 'Zkusebni'), ('emp-g', 'Iva', 'Jina');
insert into public.hr_documents (id, employee_id, doc_type, origin, status, file_path) values
  ('f-ps', 'emp-f', 'pracovni_smlouva', 'GENERATED', 'READY_FOR_SIGNATURE', 'zamestnanci/emp-f/f-ps.docx'),
  ('f-ok', 'emp-f', 'pracovni_smlouva', 'GENERATED', 'READY_FOR_SIGNATURE', 'zamestnanci/emp-f/f-ok.docx'),
  ('f-mv', 'emp-f', 'mzdovy_vymer', 'GENERATED', 'READY_FOR_SIGNATURE', null),
  ('f-sk', 'emp-f', 'vstupni_skoleni', 'GENERATED', 'READY_FOR_SIGNATURE', null);
-- f-ok a f-mv: uplne podpisane (ako postgres)
insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, document_hash, file_path) values
  ('fs-ok-e', 'f-ok', 'PAPER', 'EMPLOYEE', 'Karel Zkusebni', repeat('3', 64), 'zamestnanci-podpisy/f-ok/s.pdf'),
  ('fs-ok-r', 'f-ok', 'PAPER', 'EMPLOYER', 'JUDr. Zastupce', repeat('3', 64), 'zamestnanci-podpisy/f-ok/s.pdf'),
  ('fs-mv', 'f-mv', 'PAPER', 'EMPLOYER', 'JUDr. Zastupce', repeat('4', 64), 'zamestnanci-podpisy/f-mv/s.pdf');
update public.hr_documents set status = 'SIGNED' where id in ('f-ok', 'f-mv');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000f1", "email": "hr.f@test.local", "role": "authenticated"}';

-- ---------- 1. zamknuty, neuplne podpisany -> zneplatnit a nova verzia ----------
reset role; -- sken zapisuje server (migracia 60)
insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, document_hash, file_path, scan_matches_original_confirmed_by)
  values ('fs-ps-e', 'f-ps', 'PAPER', 'EMPLOYEE', 'Karel Zkusebni', repeat('5', 64), 'zamestnanci-podpisy/f-ps/s.pdf', '00000000-0000-0000-0000-0000000000f1');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000f1", "email": "hr.f@test.local", "role": "authenticated"}';
select isnt((select locked_at from public.hr_documents where id = 'f-ps'), null, 'zmluva je po podpise zamestnanca zamknuta');
select throws_like($$select public.hr_document_new_version('f-ps', 'chyba v mzde')$$, '%HR_DOCUMENT_VOID%', 'zamknuty dokument bez HR_DOCUMENT_VOID nezneplatni ani cez novu verziu (faza H)');
reset role;
update public.hr_permissions set permissions = permissions || array['HR_DOCUMENT_VOID'] where id = 'p-f1';
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000f1", "email": "hr.f@test.local", "role": "authenticated"}';
select lives_ok($$select public.hr_document_new_version('f-ps', 'chyba v mzde')$$, 'zamknutu neuplne podpisanu zmluvu ide zneplatnit a nahradit');
select is((select array[status, void_reason] from public.hr_documents where id = 'f-ps'), array['VOIDED', 'chyba v mzde'], 'povodna verzia je ZNEPLATNENA s dovodom');
select isnt((select voided_at from public.hr_documents where id = 'f-ps'), null, 'cas zneplatnenia zapisany');
select is((select count(*) from public.hr_document_signatures where hr_document_id = 'f-ps')::int, 1, 'podpis povodnej verzie ostal zachovany');
select is((select array[status, version_no::text] from public.hr_documents where supersedes_document_id = 'f-ps'), array['DRAFT', '2'], 'nova verzia v2 je koncept');
select is(public.hr_document_missing_signers((select id from public.hr_documents where supersedes_document_id = 'f-ps')), array['EMPLOYEE', 'EMPLOYER'],
  'nova verzia vyzaduje vsetky podpisy znova (stary podpis sa nepocita)');
select throws_ok($$update public.hr_documents set status = 'SIGNED' where supersedes_document_id = 'f-ps'$$, 'P0001', null, 'nova verzia nie je podpisana starym podpisom');
reset role;
select throws_ok($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, document_hash, file_path, scan_matches_original_confirmed_by)
  values ('fs-ps-r', 'f-ps', 'PAPER', 'EMPLOYER', 'JUDr. Zastupce', repeat('5', 64), 'zamestnanci-podpisy/f-ps/s2.pdf', '00000000-0000-0000-0000-0000000000f1')$$,
  'P0001', null, 'zneplatnenu verziu uz nejde dopodpisat (ani server)');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000f1", "email": "hr.f@test.local", "role": "authenticated"}';

-- ---------- 2. dodatok k podpisanej zmluve ----------
select throws_ok($$select public.hr_document_new_version('f-ok', 'zmena mzdy')$$, 'P0001', null, 'podpisana zmluva sa nenahradza novou verziou');
select lives_ok($$select public.hr_document_create_amendment('f-ok', 'zvyseni mzdy od 1. 1.')$$, 'k podpisanej zmluve ide vytvorit dodatok');
select is((select array[doc_type, legal_act_type, status, amends_document_id] from public.hr_documents where amends_document_id = 'f-ok'),
  array['dodatek', 'BILATERAL_CONTRACT', 'DRAFT', 'f-ok'], 'dodatok: dvojstranny, koncept, vazba na zmluvu');
select is(public.hr_document_missing_signers((select id from public.hr_documents where amends_document_id = 'f-ok')), array['EMPLOYEE', 'EMPLOYER'], 'dodatok podpisuju obe strany');
select is((select array[status, coalesce(void_reason, '-')] from public.hr_documents where id = 'f-ok'), array['SIGNED', '-'], 'povodna zmluva sa nemeni ani nezneplatnuje');
select throws_ok($$select public.hr_document_create_amendment('f-mv', null)$$, 'P0001', null, 'dodatok len k dvojstrannej zmluve');
select throws_ok($$select public.hr_document_create_amendment((select id from public.hr_documents where supersedes_document_id = 'f-ps'), null)$$, 'P0001', null,
  'dodatok len k podpisanej zmluve');
select throws_ok($$insert into public.hr_documents (id, employee_id, doc_type, origin, status, amends_document_id) values ('f-x', 'emp-g', 'dodatek', 'GENERATED', 'DRAFT', 'f-ok')$$,
  'P0001', null, 'dodatok nemoze patrit inemu zamestnancovi');
select throws_ok($$update public.hr_documents set amends_document_id = 'f-ps' where amends_document_id = 'f-ok'$$, 'P0001', null, 'vazbu dodatku nejde zmenit');

-- ---------- 3. sken potvrdenia o prevzati ----------
select throws_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, delivered_at, delivery_basis)
  values ('fd-1', 'f-mv', 'IN_PERSON_PAPER', now(), 'HANDED_OVER')$$, 'P0001', null, '§ 334: osobne odovzdanie bez potvrdenia odmietnute');
select throws_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, delivered_at, delivery_basis)
  values ('fd-1', 'f-mv', 'IN_PERSON_PAPER', now(), 'SIGNED_RECEIPT')$$, 'P0001', null, '§ 334: potvrdenie bez skenu odmietnute');
select throws_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, delivered_at, delivery_basis, receipt_scan_path, receipt_scan_sha256)
  values ('fd-1', 'f-mv', 'IN_PERSON_PAPER', now(), 'SIGNED_RECEIPT', 'prevzeti/f-mv/fd-1-' || repeat('a', 16) || '.pdf', repeat('a', 64))$$,
  'P0001', null, 'HR sken potvrdenia priamo nezapise - otisk pocita server');
-- dalej ako server (Edge Function hr-delivery)
set local role service_role;
select throws_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, delivered_at, delivery_basis, receipt_scan_path, receipt_scan_sha256)
  values ('fd-1', 'f-mv', 'IN_PERSON_PAPER', now(), 'SIGNED_RECEIPT', 'prevzeti/f-ok/fd-1-' || repeat('a', 16) || '.pdf', repeat('a', 64))$$,
  'P0001', null, 'sken mimo priecinka dokumentu odmietnuty');
select throws_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, delivered_at, delivery_basis, receipt_scan_path, receipt_scan_sha256)
  values ('fd-1', 'f-mv', 'IN_PERSON_PAPER', now(), 'SIGNED_RECEIPT', 'prevzeti/f-mv/fd-1.pdf', repeat('a', 64))$$,
  'P0001', null, 'sken bez otisku v nazve odmietnuty');
select throws_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, delivered_at, delivery_basis, receipt_scan_path, receipt_scan_sha256)
  values ('fd-1', 'f-mv', 'IN_PERSON_PAPER', now(), 'SIGNED_RECEIPT', 'prevzeti/f-mv/fd-1-XYZ.pdf', 'XYZ')$$,
  '23514', null, 'neplatny hash odmietnuty');
select lives_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, delivered_at, delivery_basis, receipt_scan_path, receipt_scan_sha256)
  values ('fd-1', 'f-mv', 'IN_PERSON_PAPER', now(), 'SIGNED_RECEIPT', 'prevzeti/f-mv/fd-1-' || repeat('a', 16) || '.pdf', repeat('a', 64))$$,
  '§ 334: odovzdanie so skenom potvrdenia');
select throws_ok($$update public.hr_document_deliveries set receipt_scan_sha256 = repeat('b', 64) where id = 'fd-1'$$, 'P0001', null, 'sken potvrdenia je nemenny');
select lives_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, delivered_at, delivery_basis)
  values ('fd-2', 'f-ok', 'IN_PERSON_PAPER', now(), 'HANDED_OVER')$$, 'zmluva (nie § 334): odovzdanie bez potvrdenia povolene');
set local role authenticated;
select ok(public.hr_object_path_visible('prevzeti/f-mv/fd-1-' || repeat('a', 16) || '.pdf'), 'HR s mzdovymi pravami vidi sken potvrdenia');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000f2", "email": "zaklad.f@test.local", "role": "authenticated"}';
select ok(not public.hr_object_path_visible('prevzeti/f-mv/fd-1-' || repeat('a', 16) || '.pdf'), 'bez citlivych prav sken potvrdenia nevidno (dedi klasifikaciu)');
select ok(not public.hr_object_path_visible('prevzeti/f-mv/este-nevlozene.pdf'), 'subor v priecinku dokumentu je chraneny uz pred vlozenim zaznamu');
select ok(not public.hr_object_path_visible('prevzeti/neexistuje/x.pdf'), 'subor k neznamemu dokumentu nevidno');

-- ---------- 4. zaznam o skoleni ----------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000f1", "email": "hr.f@test.local", "role": "authenticated"}';
select throws_ok($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, document_hash, file_path, scan_matches_original_confirmed_by)
  values ('fs-sk', 'f-sk', 'PAPER', 'EMPLOYEE', 'Karel Zkusebni', repeat('6', 64), 'zamestnanci-podpisy/f-sk/s.pdf', '00000000-0000-0000-0000-0000000000f1')$$,
  'P0001', null, 'zaznam o skoleni bez evidencie nejde podpisat');
insert into public.hr_training_records (id, employee_id, trained_at, trainer_name, scope, knowledge_check_method, knowledge_check_result, knowledge_checked_at, knowledge_checked_by_name)
  values ('tr-fail', 'emp-f', '2026-10-01', 'Ing. Skolitel', 'Vstupni BOZP', 'TEST', 'FAILED', '2026-10-01', 'Ing. Skolitel'),
         ('tr-ok', 'emp-f', '2026-10-02', 'Ing. Skolitel', 'Vstupni BOZP', 'TEST', 'PASSED', '2026-10-02', 'Ing. Skolitel'),
         ('tr-g', 'emp-g', '2026-10-02', 'Ing. Skolitel', 'Vstupni BOZP', 'ORAL', 'PASSED', '2026-10-02', 'Ing. Skolitel');
update public.hr_training_records set knowledge_check_result = 'PASSED' where id = 'tr-fail'; -- RLS: ziadna update policy -> 0 riadkov
select is((select knowledge_check_result from public.hr_training_records where id = 'tr-fail'), 'FAILED', 'HR evidenciu skolenia neprepise (RLS)');
reset role;
select throws_ok($$update public.hr_training_records set knowledge_check_result = 'PASSED' where id = 'tr-fail'$$, 'P0001', null, 'evidencia skolenia sa neprepisuje (ani postgres)');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000f1", "email": "hr.f@test.local", "role": "authenticated"}';
select throws_ok($$update public.hr_documents set training_record_id = 'tr-g' where id = 'f-sk'$$, 'P0001', null, 'evidencia ineho zamestnanca odmietnuta');
update public.hr_documents set training_record_id = 'tr-fail' where id = 'f-sk';
set local role service_role; -- podpis zapisuje server (migracia 60)
select throws_ok($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, document_hash, file_path, scan_matches_original_confirmed_by)
  values ('fs-sk', 'f-sk', 'PAPER', 'EMPLOYEE', 'Karel Zkusebni', repeat('6', 64), 'zamestnanci-podpisy/f-sk/s.pdf', '00000000-0000-0000-0000-0000000000f1')$$,
  'P0001', null, 'neuspesne overenie znalosti: podpis nejde');
set local role authenticated;
update public.hr_documents set training_record_id = 'tr-ok' where id = 'f-sk';
set local role service_role;
select lives_ok($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, document_hash, file_path, scan_matches_original_confirmed_by)
  values ('fs-sk', 'f-sk', 'PAPER', 'EMPLOYEE', 'Karel Zkusebni', repeat('6', 64), 'zamestnanci-podpisy/f-sk/s.pdf', '00000000-0000-0000-0000-0000000000f1')$$,
  's evidenciou a uspesnym overenim sa da podpisat');
set local role authenticated;
select lives_ok($$update public.hr_documents set status = 'SIGNED' where id = 'f-sk'$$, 'zaznam o skoleni je podpisany');
select throws_ok($$update public.hr_documents set training_record_id = 'tr-fail' where id = 'f-sk'$$, 'P0001', null, 'po podpise evidenciu nejde vymenit');
reset role;
-- aj server: SIGNED bez evidencie nejde
insert into public.hr_documents (id, employee_id, doc_type, origin, status) values ('f-sk2', 'emp-f', 'vstupni_skoleni', 'GENERATED', 'READY_FOR_SIGNATURE');
select throws_ok($$update public.hr_documents set status = 'SIGNED' where id = 'f-sk2'$$, 'P0001', null, 'SIGNED zaznamu o skoleni bez evidencie odmietnute (aj postgres)');

select * from finish();
rollback;
