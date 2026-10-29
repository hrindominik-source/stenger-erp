-- DB testy migracie 76: dodatocne zamietnuty nudzovy krok -> dokument platny,
-- uloha napravy s terminom; dovod zmeny so zmenenymi polami. Iba lokalne.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'konatel.n@test.local'),
  ('00000000-0000-0000-0000-0000000000c2', 'personalistka.n@test.local');
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000c1', 'Test Konatel N', 'office'),
  ('00000000-0000-0000-0000-0000000000c2', 'Test Personalistka N', 'personalistika');
insert into public.hr_permissions (id, user_email, profile) values
  ('p-n1', 'konatel.n@test.local', 'KONATEL'),
  ('p-n2', 'personalistka.n@test.local', 'PERSONALISTA');
insert into public.employees (id, first_name, last_name) values ('emp-n', 'Norbert', 'Nápravný');
insert into public.hr_documents (id, employee_id, doc_type, origin, status, final_pdf_sha256, final_pdf_text_check, final_pdf_path, finalized_at) values
  ('n-vyp', 'emp-n', 'vypoved_zamestnavatele', 'GENERATED', 'READY_FOR_SIGNATURE', repeat('d', 64), '{"ok": true, "server_verified": true}', 'zamestnanci/emp-n/n-vyp.pdf', now()),
  ('n-mv', 'emp-n', 'mzdovy_vymer', 'GENERATED', 'READY_FOR_SIGNATURE', repeat('e', 64), '{"ok": true, "server_verified": true}', 'zamestnanci/emp-n/n-mv.pdf', now());

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000c2", "email": "personalistka.n@test.local", "role": "authenticated", "aal": "aal2"}';
create temp table em as select public.hr_request_approval('EMPLOYER_SIGN', 'n-vyp', 'Výpověď nesnese odklad', '{}', true, 'Telefonát s jednatelem 29. 10.') as id;
create temp table pe as select public.hr_request_approval('EMPLOYER_SIGN', 'n-mv', 'Zvýšení mzdy') as id;
reset role;
insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, document_hash, file_path, uploaded_by)
  values ('n-sig', 'n-vyp', 'PAPER', 'EMPLOYER', 'Test', repeat('d', 64), 'x.pdf', '00000000-0000-0000-0000-0000000000c2');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000c1", "email": "konatel.n@test.local", "role": "authenticated", "aal": "aal2"}';
select throws_like($$select public.hr_decide_approval((select id from em), false, 'Nesouhlasím', current_date - 1)$$, '%v minulosti%', 'termin nie v minulosti');
select lives_ok($$select public.hr_decide_approval((select id from em), false, 'Nesouhlasím s výpovědí', current_date + 7)$$, 'jednatel dodatocne zamietne');
select lives_ok($$select public.hr_decide_approval((select id from pe), false, 'Ne, nesouhlasím')$$, 'bezne zamietnutie');
reset role;
select is((select status from public.hr_documents where id = 'n-vyp'), 'READY_FOR_SIGNATURE', 'dokument ostava platny (nezneplatneny)');
select is((select array[status, document_id, due_date::text, rejection_reason] from public.hr_remediation_tasks where approval_id = (select id from em)),
  array['OPEN', 'n-vyp', (current_date + 7)::text, 'Nesouhlasím s výpovědí'], 'uloha napravy s terminom');
select ok(not exists (select 1 from public.hr_remediation_tasks where approval_id = (select id from pe)), 'bezne zamietnutie bez ulohy');
select ok(exists (select 1 from public.hr_notifications where event_type = 'REMEDIATION_REQUIRED' and kind = 'KE_SCHVALENI' and resolved_at is null), 'jednatel ma otvorenu ulohu');
select ok(exists (select 1 from public.audit_log where entity = 'hr_remediation_tasks' and action = 'insert'), 'uloha v audite');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000c2", "email": "personalistka.n@test.local", "role": "authenticated", "aal": "aal2"}';
select is((select count(*) from public.hr_remediation_tasks where document_id = 'n-vyp')::int, 1, 'personalistka vidi oznacenie');
select throws_ok($$select public.hr_remediation_close((select id from public.hr_remediation_tasks where document_id = 'n-vyp'), 'Nová výpověď podepsána')$$, '42501', null, 'uzatvara len jednatel');
select throws_ok($$update public.hr_remediation_tasks set status = 'CLOSED', resolution = 'hotovo hotovo'$$, '42501', null, 'priamy zapis nie');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000c1", "email": "konatel.n@test.local", "role": "authenticated", "aal": "aal2"}';
select throws_like($$select public.hr_remediation_close((select id from public.hr_remediation_tasks where document_id = 'n-vyp'), 'ok')$$, '%jak byla náprava%', 'uzavretie s popisom');
select lives_ok($$select public.hr_remediation_close((select id from public.hr_remediation_tasks where document_id = 'n-vyp'), 'Výpověď vzata zpět dohodou, nový dokument')$$, 'jednatel uzavrie');
reset role;
select is((select status from public.hr_remediation_tasks where document_id = 'n-vyp'), 'CLOSED', 'uzavreta');
select ok(not exists (select 1 from public.hr_notifications n join public.hr_remediation_tasks t on t.id = n.entity_id
  where n.event_type = 'REMEDIATION_REQUIRED' and n.resolved_at is null and t.document_id = 'n-vyp'), 'upozornenie vyriesene');

-- ---------- dovod zmeny so zmenenymi polami ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000c2", "email": "personalistka.n@test.local", "role": "authenticated", "aal": "aal2"}';
update public.employees set phone = '+420 600 111 222' where id = 'emp-n';
select lives_ok($$select public.hr_record_correction('emp-n', 'Oprava podle dokladu', array['Číslo bankovního účtu pro výplatu mzdy'])$$, 'dovod s polami');
reset role;
select is((select fields from public.hr_corrections where employee_id = 'emp-n'), array['Číslo bankovního účtu pro výplatu mzdy'], 'polia ulozene');

select * from finish();
rollback;
