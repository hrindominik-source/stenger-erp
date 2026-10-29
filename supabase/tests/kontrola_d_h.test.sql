-- DB testy migracie 75: opravy z nezavislej kontroly balikov D-H.
-- Iba lokalne. Vymyslene udaje.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'konatel.k@test.local'),
  ('00000000-0000-0000-0000-0000000000f2', 'personalistka.k@test.local'),
  ('00000000-0000-0000-0000-0000000000f3', 'ucetni.k@test.local'),
  ('00000000-0000-0000-0000-0000000000f4', 'bez.hr.k@test.local');
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000f1', 'Test Konatel K', 'office'),
  ('00000000-0000-0000-0000-0000000000f2', 'Test Personalistka K', 'personalistika'),
  ('00000000-0000-0000-0000-0000000000f3', 'Test Ucetni K', 'office'),
  ('00000000-0000-0000-0000-0000000000f4', 'Test Bez HR K', 'office');
insert into public.hr_permissions (id, user_email, profile) values
  ('p-k1', 'konatel.k@test.local', 'KONATEL'),
  ('p-k2', 'personalistka.k@test.local', 'PERSONALISTA'),
  ('p-k3', 'ucetni.k@test.local', 'UCTOVNIK_EXT');
insert into public.employees (id, first_name, last_name) values ('emp-k', 'Karel', 'Kontrolní');
insert into public.employment_relationships (id, employee_id, status, employment_type, start_date, weekly_hours, data) values
  ('er-k-ok', 'emp-k', 'PLANNED', 'doba_neurcita', '2026-12-01', 40, '{"zkusebni_doba_mesice": "3"}'),
  ('er-k-6', 'emp-k', 'PLANNED', 'doba_neurcita', '2026-12-01', 40, '{"zkusebni_doba_mesice": "6"}');
insert into public.hr_documents (id, employee_id, employment_id, doc_type, origin, status, template_version_id, final_pdf_sha256, final_pdf_text_check, final_pdf_path, finalized_at) values
  ('k-ps', 'emp-k', 'er-k-ok', 'pracovni_smlouva', 'GENERATED', 'DRAFT', (select current_version_id from public.hr_document_templates where id = 'tpl-ps'),
    repeat('a', 64), '{"ok": true, "server_verified": true}', 'zamestnanci/emp-k/k-ps.pdf', now()),
  ('k-mv', 'emp-k', null, 'mzdovy_vymer', 'GENERATED', 'READY_FOR_SIGNATURE', null,
    repeat('b', 64), '{"ok": true, "server_verified": true}', 'zamestnanci/emp-k/k-mv.pdf', now()),
  ('k-draft', 'emp-k', null, 'mzdovy_vymer', 'GENERATED', 'DRAFT', null, null, null, null, null),
  ('k-ps-draft', 'emp-k', 'er-k-ok', 'pracovni_smlouva', 'GENERATED', 'DRAFT', (select current_version_id from public.hr_document_templates where id = 'tpl-ps'), null, null, null, null);

create function pg_temp.self_signable(p_doc text) returns boolean language sql as $$
  select public.hr_doc_self_signable(d) from public.hr_documents d where id = p_doc;
$$;

-- ---------- H1/H2: klasifikacia dokumentu ----------
select ok(pg_temp.self_signable('k-ps'), 'PS zo sablony PS s pomerom: personalistka sama');
select ok(not public.hr_doc_self_signable(jsonb_populate_record(null::public.hr_documents,
  format('{"origin": "GENERATED", "doc_type": "pracovni_smlouva", "template_version_id": "%s"}', (select current_version_id from public.hr_document_templates where id = 'tpl-ps'))::jsonb)),
  'PS bez pracovneho pomeru (bez kontroly limitov): schvaluje jednatel');
select ok(not public.hr_doc_self_signable(jsonb_populate_record(null::public.hr_documents,
  format('{"origin": "GENERATED", "doc_type": "vstupni_skoleni", "template_version_id": "%s"}', (select current_version_id from public.hr_document_templates where id = 'tpl-ps'))::jsonb)),
  'sablona ineho typu nestaci');
select ok(not public.hr_doc_self_signable(jsonb_populate_record(null::public.hr_documents,
  '{"origin": "GENERATED", "doc_type": "potvrzeni_prevzeti", "is_manual_history_entry": true}')), 'rucna historia: nikdy sama');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000f2", "email": "personalistka.k@test.local", "role": "authenticated", "aal": "aal2"}';
select throws_ok($$update public.hr_documents set doc_type = 'potvrzeni_prevzeti' where id = 'k-draft'$$, '42501', null, 'typ konceptu po vlozeni nezmeni');
select throws_ok($$update public.hr_documents set is_manual_history_entry = true where id = 'k-draft'$$, '42501', null, 'na rucnu historiu nezmeni');
select throws_ok($$update public.hr_documents set employment_id = 'er-k-6' where id = 'k-ps-draft'$$, '42501', null, 'pomer PS nezmeni');
select throws_ok($$insert into public.hr_documents (id, employee_id, doc_type, origin, status) values ('k-fake', 'emp-k', 'potvrzeni_prevzeti', 'GENERATED', 'DRAFT')$$,
  '42501', null, 'potvrdenie o prevzati nevytvori (len server)');
select throws_ok($$insert into public.hr_documents (id, employee_id, employment_id, doc_type, origin, status, is_manual_history_entry)
  values ('k-hist', 'emp-k', 'er-k-6', 'pracovni_smlouva', 'GENERATED', 'DRAFT', true)$$, '42501', null, 'rucnu historiu (obchadzka limitov) nezalozi');
select lives_ok($$update public.hr_documents set status = 'READY_FOR_SIGNATURE' where id = 'k-ps'$$, 'bezne zmeny stavu idu');

-- ---------- M1: schvalenie viazane na znenie ----------
select throws_like($$select public.hr_request_approval('EMPLOYER_SIGN', 'k-draft', 'Zvýšení mzdy')$$, '%finálnímu PDF%', 'ziadost az k finalnemu PDF');
create temp table rq as select public.hr_request_approval('EMPLOYER_SIGN', 'k-mv', 'Zvýšení mzdy od 1. 1.') as id;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000f1", "email": "konatel.k@test.local", "role": "authenticated", "aal": "aal2"}';
select lives_ok($$select public.hr_decide_approval((select id from rq), true, 'OK')$$, 'jednatel schvali');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000f2", "email": "personalistka.k@test.local", "role": "authenticated", "aal": "aal2"}';
select is((public.hr_approval_state('EMPLOYER_SIGN', 'k-mv')->>'usable')::boolean, true, 'schvalene znenie plati');
reset role;
-- nove finalne PDF (iny obsah) - schvalenie uz neplati
update public.hr_documents set final_pdf_sha256 = repeat('c', 64) where id = 'k-mv';
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000f2", "email": "personalistka.k@test.local", "role": "authenticated", "aal": "aal2"}';
select is((public.hr_approval_state('EMPLOYER_SIGN', 'k-mv')->'last'->>'outdated')::boolean, true, 'UI: dokument sa zmenil');
select is((public.hr_approval_state('EMPLOYER_SIGN', 'k-mv')->>'usable')::boolean, false, 'po zmene znenia neplati');
reset role;
select throws_like($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, document_hash, file_path, uploaded_by)
  values ('k-sig', 'k-mv', 'PAPER', 'EMPLOYER', 'Test', repeat('c', 64), 'x.pdf', '00000000-0000-0000-0000-0000000000f2')$$, '%schvaluje jednatel%', 'podpis zmeneneho znenia nie');

-- ---------- M2: vynimka viazana na hodnoty, bez nudze ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000f2", "email": "personalistka.k@test.local", "role": "authenticated", "aal": "aal2"}';
select throws_like($$select public.hr_request_approval('LEGAL_EXCEPTION', 'er-k-6', 'Výjimka nutná hned', '{"codes": ["PROBATION_MAX"]}', true, 'Telefonát s jednatelem')$$,
  '%nemá nouzový postup%', 'vynimka bez nudzoveho postupu');
create temp table ex as select public.hr_request_approval('LEGAL_EXCEPTION', 'er-k-6', 'Dohoda – ověří právnička', '{"codes": ["PROBATION_MAX"]}') as id;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000f1", "email": "konatel.k@test.local", "role": "authenticated", "aal": "aal2"}';
select lives_ok($$select public.hr_decide_approval((select id from ex), true, 'Výjimka pro 6 měsíců')$$, 'jednatel schvali vynimku');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000f2", "email": "personalistka.k@test.local", "role": "authenticated", "aal": "aal2"}';
select ok(not ((public.hr_check_employment('er-k-6')->'issues')::text like '%"BLOCK"%'), 'vynimka pre 6 mesiacov plati');
reset role;
update public.employment_relationships set data = '{"zkusebni_doba_mesice": "12"}' where id = 'er-k-6';
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000f2", "email": "personalistka.k@test.local", "role": "authenticated", "aal": "aal2"}';
select ok((public.hr_check_employment('er-k-6')->'issues')::text like '%"BLOCK"%', 'pri 12 mesiacoch vynimka neplati');

-- ---------- L2: ziadosti nevidi externa uctovnicka ----------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000f3", "email": "ucetni.k@test.local", "role": "authenticated", "aal": "aal2"}';
select is((select count(*) from public.hr_approval_requests)::int, 0, 'uctovnicka ziadosti nevidi');
select throws_ok($$select public.hr_approval_state('EMPLOYER_SIGN', 'k-mv')$$, '42501', null, 'ani stav ziadosti');

-- ---------- N4: priznak anonymizacie ----------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000f2", "email": "personalistka.k@test.local", "role": "authenticated", "aal": "aal2"}';
select throws_ok($$update public.employees set data = data || '{"anonymized_at": "2026-01-01"}' where id = 'emp-k'$$, '42501', null, 'priznak anonymizacie rucne nie');
reset role;

-- ---------- L1: lehoty od vzniku zaznamu neblokuju anonymizaciu ----------
insert into public.employees (id, first_name, last_name) values ('emp-k-old', 'Olga', 'Stará');
insert into public.employment_relationships (id, employee_id, status, employment_type, start_date, termination_date)
  values ('er-k-old', 'emp-k-old', 'ENDED', 'doba_neurcita', '2001-01-01', '2015-06-30');
update public.hr_retention_rules set period_years = 1, period_from = 'KONEC_POMERU', action = 'ANONYMIZOVAT', source = 'test';
update public.hr_retention_rules set period_from = 'VZNIK_ZAZNAMU' where key = 'AUDIT';
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000f1", "email": "konatel.k@test.local", "role": "authenticated", "aal": "aal2"}';
select is((public.hr_anonymization_ready('emp-k-old')->>'ready')::boolean, true, 'audit od vzniku zaznamu neblokuje');
reset role;

-- ---------- L3: odchod ----------
select throws_like($$select public.hr_offboard_user('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000f1', 'Odchod z firmy')$$,
  '%nemá přístup do HR%', 'ucet bez HR v aplikacii neukonci');
select throws_like($$select public.hr_offboard_user('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2', 'Odchod z firmy')$$,
  '%IT serverově%', 'jednatela nie');

-- ---------- L4 ----------
select ok(not has_table_privilege('authenticated', 'public.hr_legal_parameters', 'TRUNCATE'), 'bez TRUNCATE');
select ok(not has_table_privilege('anon', 'public.hr_legal_parameters', 'SELECT'), 'anon nic');

select * from finish();
rollback;
