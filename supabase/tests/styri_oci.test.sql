-- DB testy migracie 71 (balik E): princip styroch oci - podpis za
-- zamestnavatela, zneplatnenie podpisaneho, vynimka zo zakonneho limitu;
-- nudzovy postup. Iba lokalne. Vymyslene udaje.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'konatel.oci@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'personalistka.oci@test.local');
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Test Konatel Oci', 'office'),
  ('00000000-0000-0000-0000-0000000000a2', 'Test Personalistka Oci', 'personalistika');
insert into public.hr_permissions (id, user_email, profile) values
  ('p-o1', 'konatel.oci@test.local', 'KONATEL'),
  ('p-o2', 'personalistka.oci@test.local', 'PERSONALISTA');
insert into public.employees (id, first_name, last_name) values ('emp-o', 'Oto', 'Ocisty');
insert into public.employment_relationships (id, employee_id, status, employment_type, start_date, weekly_hours, data)
  values ('er-o-ok', 'emp-o', 'PLANNED', 'doba_neurcita', '2026-12-01', 40, '{"zkusebni_doba_mesice": "3"}');
-- schvaluje sa konkretne znenie -> dokumenty maju finalne PDF
insert into public.hr_documents (id, employee_id, employment_id, doc_type, origin, status, template_version_id, final_pdf_sha256, final_pdf_text_check, final_pdf_path, finalized_at) values
  ('o-mv', 'emp-o', null, 'mzdovy_vymer', 'GENERATED', 'READY_FOR_SIGNATURE', null, repeat('1', 64), '{"ok": true, "server_verified": true}', 'zamestnanci/emp-o/o-mv.pdf', now()),
  ('o-mv2', 'emp-o', null, 'mzdovy_vymer', 'GENERATED', 'READY_FOR_SIGNATURE', null, repeat('2', 64), '{"ok": true, "server_verified": true}', 'zamestnanci/emp-o/o-mv2.pdf', now()),
  ('o-ps', 'emp-o', 'er-o-ok', 'pracovni_smlouva', 'GENERATED', 'READY_FOR_SIGNATURE', (select current_version_id from public.hr_document_templates where id = 'tpl-ps'), repeat('3', 64), '{"ok": true, "server_verified": true}', 'zamestnanci/emp-o/o-ps.pdf', now()),
  ('o-up', 'emp-o', null, 'pracovni_smlouva', 'UPLOADED', 'READY_FOR_SIGNATURE', null, repeat('4', 64), '{"ok": true, "server_verified": true}', 'zamestnanci/emp-o/o-up.pdf', now()),
  ('o-vyp', 'emp-o', null, 'vypoved_zamestnavatele', 'GENERATED', 'READY_FOR_SIGNATURE', null, repeat('5', 64), '{"ok": true, "server_verified": true}', 'zamestnanci/emp-o/o-vyp.pdf', now()),
  ('o-void', 'emp-o', null, 'other', 'GENERATED', 'READY_FOR_SIGNATURE', null, repeat('6', 64), '{"ok": true, "server_verified": true}', 'zamestnanci/emp-o/o-void.pdf', now()),
  ('o-void2', 'emp-o', null, 'other', 'GENERATED', 'READY_FOR_SIGNATURE', null, repeat('7', 64), '{"ok": true, "server_verified": true}', 'zamestnanci/emp-o/o-void2.pdf', now()),
  ('o-rej', 'emp-o', null, 'dodatek', 'GENERATED', 'READY_FOR_SIGNATURE', null, repeat('8', 64), '{"ok": true, "server_verified": true}', 'zamestnanci/emp-o/o-rej.pdf', now());

-- podpis za zamestnavatela (papier) nahraty pouzivatelom p_user
create function pg_temp.employer_sign(p_doc text, p_user uuid) returns void language sql as $$
  insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, document_hash, file_path, uploaded_by)
  values (gen_random_uuid()::text, p_doc, 'PAPER', 'EMPLOYER', 'Test Zastupce', repeat('a', 64), 'zamestnanci-podpisy/' || p_doc || '.pdf', p_user);
$$;

-- ---------- podpis za zamestnavatela ----------
select ok(public.hr_doc_self_signable((select d from public.hr_documents d where id = 'o-ps')), 'PS zo schvalenej sablony podpise personalistka sama');
select lives_ok($$select pg_temp.employer_sign('o-ps', '00000000-0000-0000-0000-0000000000a2')$$, 'PS: personalistka bez schvalenia');
select ok(public.hr_doc_self_signable(jsonb_populate_record(null::public.hr_documents, '{"origin": "GENERATED", "doc_type": "potvrzeni_prevzeti"}')),
  'potvrdenie o prevzati: sama');
select ok(not public.hr_doc_self_signable(jsonb_populate_record(null::public.hr_documents, '{"origin": "GENERATED", "doc_type": "pracovni_smlouva", "version_no": 2, "template_version_id": "x"}')),
  'PS vo verzii 2 (upravena): schvaluje jednatel');
select throws_like($$select pg_temp.employer_sign('o-mv', '00000000-0000-0000-0000-0000000000a2')$$, '%schvaluje jednatel%', 'mzdovy vymer (zmena mzdy): bez schvalenia nie');
select throws_like($$select pg_temp.employer_sign('o-up', '00000000-0000-0000-0000-0000000000a2')$$, '%schvaluje jednatel%', 'nahraty dokument (odchylka od sablony): nie');
select throws_like($$select pg_temp.employer_sign('o-vyp', '00000000-0000-0000-0000-0000000000a2')$$, '%schvaluje jednatel%', 'vypoved: nie');
select lives_ok($$select pg_temp.employer_sign('o-vyp', '00000000-0000-0000-0000-0000000000a1')$$, 'jednatel podpise sam bez ziadosti');

-- ziadost personalistky
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a2", "email": "personalistka.oci@test.local", "role": "authenticated", "aal": "aal2"}';
select throws_like($$select public.hr_request_approval('EMPLOYER_SIGN', 'o-mv', 'ok')$$, '%alespoň 5 znaků%', 'bez dovodu nie');
select is((public.hr_approval_state('EMPLOYER_SIGN', 'o-mv')->>'needed')::boolean, true, 'UI: schvalenie treba');
create temp table req as select public.hr_request_approval('EMPLOYER_SIGN', 'o-mv', 'Zvýšení mzdy od 1. 12.') as id;
select throws_like($$select public.hr_request_approval('EMPLOYER_SIGN', 'o-mv', 'Druhá žádost')$$, '%už čeká%', 'druha cakajuca ziadost nie');
select throws_ok($$select public.hr_decide_approval((select id from req), true)$$, '42501', null, 'personalistka neschvaluje');
select throws_ok($$select * from public.hr_open_approvals()$$, '42501', null, 'zoznam na schvalenie len pre jednatela');
reset role;
select ok(exists (select 1 from public.hr_notifications where event_type = 'APPROVAL_REQUESTED' and entity_id = (select id from req) and kind = 'KE_SCHVALENI' and resolved_at is null),
  'jednatel ma ziadost v prehlade');
select throws_like($$select pg_temp.employer_sign('o-mv', '00000000-0000-0000-0000-0000000000a2')$$, '%schvaluje jednatel%', 'cakajuca ziadost nestaci');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a1", "email": "konatel.oci@test.local", "role": "authenticated", "aal": "aal2"}';
select is((select count(*) from public.hr_open_approvals())::int, 1, 'jednatel vidi cakajucu ziadost');
select lives_ok($$select public.hr_decide_approval((select id from req), true, 'Souhlasím')$$, 'jednatel schvali');
select throws_like($$select public.hr_decide_approval((select id from req), true)$$, '%vyřízena%', 'druhy raz nie');
reset role;
select lives_ok($$select pg_temp.employer_sign('o-mv', '00000000-0000-0000-0000-0000000000a2')$$, 'po schvaleni personalistka podpise');
select ok((select consumed_at is not null from public.hr_approval_requests where id = (select id from req)), 'schvalenie spotrebovane');
select ok((select resolved_at is not null from public.hr_notifications where entity_id = (select id from req)), 'upozornenie vyriesene');
select ok(exists (select 1 from public.audit_log where entity = 'hr_approval_requests' and entity_id = (select id from req) and new_value->>'status' = 'APPROVED'), 'v audite');

-- zamietnutie
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a2", "email": "personalistka.oci@test.local", "role": "authenticated", "aal": "aal2"}';
create temp table req2 as select public.hr_request_approval('EMPLOYER_SIGN', 'o-rej', 'Upravená smlouva podle dohody') as id;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a1", "email": "konatel.oci@test.local", "role": "authenticated", "aal": "aal2"}';
select throws_like($$select public.hr_decide_approval((select id from req2), false, '')$$, '%důvod zamítnutí%', 'zamietnutie s dovodom');
select lives_ok($$select public.hr_decide_approval((select id from req2), false, 'Nesouhlasím se změnou čl. 3')$$, 'jednatel zamietne');
reset role;
select throws_like($$select pg_temp.employer_sign('o-rej', '00000000-0000-0000-0000-0000000000a2')$$, '%schvaluje jednatel%', 'zamietnute -> podpis nie');

-- jednatel vlastnu ziadost neschvali
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a1", "email": "konatel.oci@test.local", "role": "authenticated", "aal": "aal2"}';
create temp table req3 as select public.hr_request_approval('EMPLOYER_SIGN', 'o-mv2', 'Jednatel rozhoduje sám') as id;
select is((select array[status, decision_note] from public.hr_approval_requests where id = (select id from req3)), array['APPROVED', 'Rozhodnutí jednatele'],
  'rozhodnutie jednatela sa zapise ako schvalene');
select throws_like($$select public.hr_decide_approval((select id from req3), true)$$, '%Vlastní žádost%', 'vlastnu ziadost znova neschvaluje');
-- stiahnut moze len navrhovatel cakajucej ziadosti
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a2", "email": "personalistka.oci@test.local", "role": "authenticated", "aal": "aal2"}';
create temp table req4 as select public.hr_request_approval('EMPLOYER_SIGN', 'o-mv2', 'Druhý výměr') as id;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a1", "email": "konatel.oci@test.local", "role": "authenticated", "aal": "aal2"}';
select throws_like($$select public.hr_cancel_approval((select id from req4))$$, '%vlastní%', 'cudziu ziadost jednatel nestiahne (rozhodne)');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a2", "email": "personalistka.oci@test.local", "role": "authenticated", "aal": "aal2"}';
select lives_ok($$select public.hr_cancel_approval((select id from req4))$$, 'navrhovatel svoju stiahne');
reset role;

-- ---------- nudzovy postup ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a2", "email": "personalistka.oci@test.local", "role": "authenticated", "aal": "aal2"}';
select throws_like($$select public.hr_request_approval('VOID_DOCUMENT', 'o-void', 'Chybný dokument', '{}', true, '')$$, '%jak a kdy%', 'nudzovy bez informacie o jednatelovi nie');
create temp table em as select public.hr_request_approval('VOID_DOCUMENT', 'o-void', 'Chybný dokument, nutno hned', '{}', true, 'Telefonát s jednatelem 28. 10. v 9:10') as id;
reset role;
select is((select status from public.hr_approval_requests where id = (select id from em)), 'EMERGENCY', 'nudzovy krok povoleny hned');
select ok(exists (select 1 from public.hr_notifications where event_type = 'EMERGENCY_STEP' and entity_id = (select id from em) and resolved_at is null), 'jednatel ma nudzovy krok otvoreny');

-- ---------- zneplatnenie podpisaneho ----------
select pg_temp.employer_sign('o-void', '00000000-0000-0000-0000-0000000000a1');
select pg_temp.employer_sign('o-void2', '00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a2", "email": "personalistka.oci@test.local", "role": "authenticated", "aal": "aal2"}';
select throws_like($$update public.hr_documents set status = 'VOIDED', void_reason = 'chyba' where id = 'o-void2'$$, '%schvaluje jednatel%', 'podpisany bez schvalenia nezneplatni');
select lives_ok($$update public.hr_documents set status = 'VOIDED', void_reason = 'chyba' where id = 'o-void'$$, 'v nudzovom postupe zneplatni');
select lives_ok($$update public.hr_documents set status = 'VOIDED', void_reason = 'koncept' where id = 'o-mv2'$$, 'nepodpisany zneplatni bez schvalenia');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a1", "email": "konatel.oci@test.local", "role": "authenticated", "aal": "aal2"}';
select lives_ok($$select public.hr_decide_approval((select id from em), true, 'Potvrzuji dodatečně')$$, 'jednatel dodatocne potvrdi');
reset role;
select is((select status from public.hr_approval_requests where id = (select id from em)), 'CONFIRMED', 'nudzovy -> potvrdeny');

-- ---------- vynimka zo zakonneho limitu ----------
insert into public.employment_relationships (id, employee_id, status, employment_type, start_date, weekly_hours, data)
  values ('er-o', 'emp-o', 'PLANNED', 'doba_neurcita', '2026-12-01', 40, '{"zkusebni_doba_mesice": "6"}');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a2", "email": "personalistka.oci@test.local", "role": "authenticated", "aal": "aal2"}';
select ok((public.hr_check_employment('er-o')->'issues')::text like '%"BLOCK"%', 'blok skusobnej doby');
select throws_like($$select public.hr_request_approval('LEGAL_EXCEPTION', 'er-o', 'Výjimka nutná', '{}')$$, '%ze kterých limitů%', 'vynimka bez kodov nie');
create temp table ex as select public.hr_request_approval('LEGAL_EXCEPTION', 'er-o', 'Dohoda s jednatelem – ověří právnička', '{"codes": ["PROBATION_MAX"]}') as id;
select ok((public.hr_check_employment('er-o')->'issues')::text like '%"BLOCK"%', 'kym nie je schvalena, blok plati');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a1", "email": "konatel.oci@test.local", "role": "authenticated", "aal": "aal2"}';
select lives_ok($$select public.hr_decide_approval((select id from ex), true, 'Výjimka schválena')$$, 'jednatel schvali vynimku');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a2", "email": "personalistka.oci@test.local", "role": "authenticated", "aal": "aal2"}';
select ok(not ((public.hr_check_employment('er-o')->'issues')::text like '%"BLOCK"%'), 'po schvaleni vynimky uz nie je blok');
select ok((public.hr_check_employment('er-o')->'issues')::text like '%VÝJIMKA schválená jednatelem%', 'zobrazi sa ako vynimka');
reset role;
select lives_ok($$insert into public.hr_documents (id, employee_id, employment_id, doc_type, origin, status)
  values ('o-ps-ex', 'emp-o', 'er-o', 'pracovni_smlouva', 'GENERATED', 'DRAFT')$$, 'dokument s vynimkou vznikne');
select is((select jsonb_array_length(legal_check->'exceptions') from public.hr_documents where id = 'o-ps-ex'), 1, 'vynimka zapisana k dokumentu');

select * from finish();
rollback;
