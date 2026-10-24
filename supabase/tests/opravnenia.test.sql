-- DB testy migracie 57 (faza H): opravnenia - zneplatnenie, podpis za
-- zamestnavatela, citlivost dokumentu pri podpisoch a doruceni, RLS
-- vsetkych novych tabuliek, anon (kiosk) len cez RPC.
-- Iba lokalne: npx supabase test db. Vymyslene udaje.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- texty prejavu vole su od migracie 66 koncept; elektronicky podpis len po schvaleni (tu v ramci testu)
update public.hr_legal_text_versions set status = 'SCHVALENO' where text_key like 'INTENT\_%' and status = 'KONCEPT';

-- Kolko riadkov tabulky vidi aktualna rola; zamietnutie (42501 - napr. RLS
-- politika vola funkciu, ktoru anon nesmie spustit, migracia 62) = 0.
create function pg_temp.anon_vidi(t regclass) returns int language plpgsql as $f$
declare n int;
begin
  execute format('select count(*) from %s', t) into n;
  return n;
exception when insufficient_privilege then
  return 0;
end $f$;
grant execute on function pg_temp.anon_vidi(regclass) to anon;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'zakladni.h@test.local'),
  ('00000000-0000-0000-0000-0000000000c2', 'zneplatnuje.h@test.local'),
  ('00000000-0000-0000-0000-0000000000c3', 'jednatel.h@test.local'),
  ('00000000-0000-0000-0000-0000000000c4', 'bezprava.h@test.local');
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000c1', 'Test Zakladni H', 'office'),
  ('00000000-0000-0000-0000-0000000000c2', 'Test Zneplatnuje H', 'office'),
  ('00000000-0000-0000-0000-0000000000c3', 'Test Jednatel H', 'office'),
  ('00000000-0000-0000-0000-0000000000c4', 'Test Bezprava H', 'office');
insert into public.hr_permissions (id, user_email, permissions) values
  ('p-h1', 'zakladni.h@test.local', array['HR_VIEW_BASIC', 'HR_EDIT', 'HR_DOCUMENT_GENERATE', 'HR_DOCUMENT_APPROVE', 'HR_DOCUMENT_SIGN', 'HR_DOCUMENT_SEND']),
  ('p-h2', 'zneplatnuje.h@test.local', array['HR_VIEW_BASIC', 'HR_VIEW_SENSITIVE', 'HR_DOCUMENT_VOID']),
  ('p-h3', 'jednatel.h@test.local', array['HR_VIEW_BASIC', 'HR_VIEW_SENSITIVE', 'HR_DOCUMENT_SIGN', 'HR_SIGN_FOR_EMPLOYER']),
  ('p-h4', 'bezprava.h@test.local', array['HR_VIEW_BASIC', 'HR_VIEW_SENSITIVE', 'HR_DOCUMENT_SIGN']);
insert into public.employees (id, first_name, last_name) values ('emp-h1', 'Hana', 'Opravnena');
-- bez klasifikacie sablony = HR_VIEW_SENSITIVE (hr_document_required_permissions)
insert into public.hr_documents (id, employee_id, doc_type, origin, status, final_pdf_path, final_pdf_sha256, final_pdf_text_check, finalized_at) values
  ('h-ps', 'emp-h1', 'pracovni_smlouva', 'GENERATED', 'READY_FOR_SIGNATURE', 'zamestnanci/emp-h1/h-ps/f.pdf', repeat('1', 64), '{"ok": true, "server_verified": true}', now()),
  ('h-ps2', 'emp-h1', 'pracovni_smlouva', 'GENERATED', 'READY_FOR_SIGNATURE', 'zamestnanci/emp-h1/h-ps2/f.pdf', repeat('2', 64), '{"ok": true, "server_verified": true}', now()),
  ('h-dr', 'emp-h1', 'pracovni_smlouva', 'GENERATED', 'DRAFT', null, null, null, null);
insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, document_hash, file_path)
  values ('h-p1', 'h-ps', 'PAPER', 'EMPLOYEE', 'Hana Opravnena', repeat('c', 64), 'zamestnanci/emp-h1/h-ps/sken.pdf');
insert into public.hr_signature_images (id, png, png_sha256) values
  ('h-img-1', decode(repeat('ab', 200), 'hex'), 'x'), ('h-img-2', decode(repeat('ac', 200), 'hex'), 'x'),
  ('h-img-3', decode(repeat('ad', 200), 'hex'), 'x'), ('h-img-4', decode(repeat('ae', 200), 'hex'), 'x');
insert into public.hr_documents (id, employee_id, doc_type, origin, status) values ('h-sg', 'emp-h1', 'pracovni_smlouva', 'GENERATED', 'READY_FOR_SIGNATURE');
insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, document_hash, file_path) values
  ('h-sg1', 'h-sg', 'PAPER', 'EMPLOYEE', 'Hana Opravnena', repeat('c', 64), 'zamestnanci/emp-h1/h-sg/s.pdf'),
  ('h-sg2', 'h-sg', 'PAPER', 'EMPLOYER', 'Ing. Test Jednatel', repeat('c', 64), 'zamestnanci/emp-h1/h-sg/s.pdf');
update public.hr_documents set status = 'SIGNED' where id = 'h-sg';
insert into public.hr_signatories (id, full_name, full_name_instrumental, user_id, valid_from, valid_to, note) values
  ('sig-h-ok', 'Ing. Test Jednatel', 'Ing. Testem Jednatelem', '00000000-0000-0000-0000-0000000000c3', '2026-01-01', null, 'test'),
  ('sig-h-old', 'Ing. Test Jednatel', 'Ing. Testem Jednatelem', '00000000-0000-0000-0000-0000000000c3', '2025-01-01', '2025-12-31', 'test'),
  ('sig-h-np', 'Mgr. Bez Prava', 'Mgr. Bez Prava', '00000000-0000-0000-0000-0000000000c4', '2026-01-01', null, 'test');

-- ---------- podpis za zamestnavatela (DB kontrola aj pre server) ----------
create function pg_temp.emp_sig(p_id text, p_sig text, p_user uuid, p_name text, p_img text) returns void language sql as $$
  insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, signer_user_id, evidence, signed_content_sha256, signature_image_id, intent_text_version_id, intent_text_sha256)
  values (p_id, 'h-ps2', 'ELECTRONIC_TABLET', 'EMPLOYER', p_name, p_user, jsonb_build_object('signatory_id', p_sig), repeat('2', 64), p_img, 'lt-intent-employer-v1', 'h');
$$;
select throws_like($$select pg_temp.emp_sig('h-e1', null, '00000000-0000-0000-0000-0000000000c3', 'Ing. Test Jednatel', 'h-img-1')$$, '%plnou moci%', 'bez osoby s plnou mocou nie');
select throws_like($$select pg_temp.emp_sig('h-e1', 'sig-h-ok', '00000000-0000-0000-0000-0000000000c4', 'Ing. Test Jednatel', 'h-img-1')$$, '%prihlaseny uzivatel%', 'podpisuje len pouzivatel uvedeny pri plnej moci');
select throws_like($$select pg_temp.emp_sig('h-e1', 'sig-h-old', '00000000-0000-0000-0000-0000000000c3', 'Ing. Test Jednatel', 'h-img-1')$$, '%neplati%', 'neplatna (skoncena) plna moc');
select throws_like($$select pg_temp.emp_sig('h-e1', 'sig-h-ok', '00000000-0000-0000-0000-0000000000c3', 'Ing. Iny Clovek', 'h-img-1')$$, '%neodpovida%', 'meno musi sedet s osobou s plnou mocou');
select throws_like($$select pg_temp.emp_sig('h-e1', 'sig-h-np', '00000000-0000-0000-0000-0000000000c4', 'Mgr. Bez Prava', 'h-img-1')$$, '%HR_SIGN_FOR_EMPLOYER%', 'plna moc bez opravnenia HR_SIGN_FOR_EMPLOYER nestaci');
select lives_ok($$select pg_temp.emp_sig('h-e1', 'sig-h-ok', '00000000-0000-0000-0000-0000000000c3', 'Ing. Test Jednatel', 'h-img-2')$$, 'platna plna moc + opravnenie');
set local role authenticated;
select throws_ok($$select public.hr_user_has_permission('00000000-0000-0000-0000-0000000000c3', 'HR_ADMIN')$$, '42501', null, 'kontrola opravnenia ineho pouzivatela je len pre server');
reset role;

-- ---------- zneplatnenie ----------
-- zakladni.h nevidi citlive dokumenty -> pre test viditelny koncept: klasifikacia BASIC
insert into public.hr_document_templates (id, name, doc_type) values ('h-tpl', 'Test H', 'pracovni_smlouva') on conflict do nothing;
insert into public.hr_document_template_versions (id, template_id, version_number, file_path, required_permissions, approved_at) values ('h-tv', 'h-tpl', 1, 'sablony/h.docx', array['HR_VIEW_BASIC'], now()) on conflict do nothing;
update public.hr_document_templates set status = 'SCHVALENA', current_version_id = 'h-tv' where id = 'h-tpl';
insert into public.hr_documents (id, employee_id, doc_type, origin, status, template_id, template_version_id) values
  ('h-basic', 'emp-h1', 'pracovni_smlouva', 'GENERATED', 'DRAFT', 'h-tpl', 'h-tv');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000c1", "email": "zakladni.h@test.local", "role": "authenticated"}';
select throws_like($$update public.hr_documents set status = 'VOIDED', void_reason = 'test' where id = 'h-basic'$$, '%HR_DOCUMENT_VOID%',
  'GENERATE/APPROVE/SIGN bez HR_DOCUMENT_VOID nezneplatni ani koncept');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000c2", "email": "zneplatnuje.h@test.local", "role": "authenticated"}';
select lives_ok($$update public.hr_documents set status = 'VOIDED', void_reason = 'chyba' where id = 'h-ps'$$, 'HR_DOCUMENT_VOID zneplatni aj zamknuty dokument');
reset role;
select lives_ok($$update public.hr_documents set status = 'VOIDED', void_reason = 'server' where id = 'h-dr'$$, 'server (napr. kiosk) zneplatni nepodpisany koncept');

-- ---------- citlivost dokumentu pri podpisoch a doruceni ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000c1", "email": "zakladni.h@test.local", "role": "authenticated"}';
select is((select count(*) from public.hr_documents where id = 'h-ps2')::int, 0, 'bez HR_VIEW_SENSITIVE citlivy dokument nevidi');
select is((select count(*) from public.hr_document_signatures where hr_document_id in ('h-ps', 'h-ps2'))::int, 0, 'ani jeho podpisy a dokazy');
select throws_ok($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, document_hash, file_path, scan_matches_original_confirmed_by)
  values ('h-x', 'h-ps2', 'PAPER', 'EMPLOYEE', 'x', repeat('c', 64), 'zamestnanci/emp-h1/h-ps2/x.pdf', '00000000-0000-0000-0000-0000000000c1')$$, 'P0001', null, 'ani nezapise sken podpisu (len server)');
select throws_ok($$insert into public.hr_document_deliveries (id, hr_document_id, channel, delivered_at, delivery_basis, handed_over_by, created_by)
  values ('h-dl', 'h-sg', 'IN_PERSON_PAPER', now(), 'HANDED_OVER', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1')$$, 'P0001', null, 'ani nezapise predanie (len server)');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000c3", "email": "jednatel.h@test.local", "role": "authenticated"}';
select is((select count(*) from public.hr_document_signatures where hr_document_id = 'h-ps2')::int, 1, 's HR_VIEW_SENSITIVE podpis vidi');
reset role;

-- ---------- RLS a anon (kiosk len cez RPC s tokenom) ----------
select is((select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity and relname in (
  'employee_contact_declarations', 'hr_document_deliveries', 'hr_document_events', 'hr_kiosk_unlocks', 'hr_legal_text_versions', 'hr_settings',
  'hr_signatories', 'hr_signature_images', 'hr_signature_verifications', 'hr_signing_tokens', 'hr_training_records', 'hr_document_signatures',
  'hr_documents', 'onboarding_sessions'))::int, 0, 'RLS zapnute na vsetkych novych tabulkach');
select is((select count(*) from pg_policy where polcmd in ('w', 'd', '*') and polrelid in (
  'public.hr_document_signatures'::regclass, 'public.hr_signature_images'::regclass, 'public.hr_signature_verifications'::regclass,
  'public.hr_document_events'::regclass, 'public.employee_contact_declarations'::regclass, 'public.hr_training_records'::regclass,
  'public.hr_kiosk_unlocks'::regclass, 'public.hr_signing_tokens'::regclass))::int, 0, 'podpisy, dokazy, vyhlasenia, tokeny: ziadna UPDATE/DELETE politika');
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select is(pg_temp.anon_vidi('public.hr_documents') + pg_temp.anon_vidi('public.hr_document_signatures')
  + pg_temp.anon_vidi('public.hr_signature_images') + pg_temp.anon_vidi('public.employee_contact_declarations')
  + pg_temp.anon_vidi('public.hr_document_deliveries') + pg_temp.anon_vidi('public.hr_signatories')
  + pg_temp.anon_vidi('public.hr_signature_verifications') + pg_temp.anon_vidi('public.hr_signing_tokens')
  + pg_temp.anon_vidi('public.hr_legal_text_versions') + pg_temp.anon_vidi('public.onboarding_sessions'), 0,
  'anon nevidi ziadne riadky novych tabuliek');
select throws_ok($$insert into public.hr_signature_images (id, png, png_sha256) values ('anon-img', decode('ab', 'hex'), 'x')$$, '42501', null, 'anon nezapise obrazok podpisu');
select throws_ok($$select public.hr_document_deliveries_sweep()$$, '42501', null, 'anon nespusti sweep');
select throws_ok($$select public.hr_auth_session_active(gen_random_uuid(), gen_random_uuid())$$, '42501', null, 'anon nevola serverove funkcie');
reset role;

select * from finish();
rollback;
