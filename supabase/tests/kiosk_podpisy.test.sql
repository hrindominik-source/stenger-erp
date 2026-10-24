-- DB testy fazy D (kiosk: § 21 / § 335, podpis dotaznika a vyhlaseni,
-- papierova alternativa, prenos pri kontrole). Vymyslene udaje.
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

-- ---------- pravne texty (koncepty) ----------
select is((select count(*)::int from public.hr_legal_text_versions
  where text_key in ('S21_ADDRESS_NOTICE', 'S335_NOTICE', 'S335_CONSENT', 'INTENT_QUESTIONNAIRE', 'INTENT_EMPLOYEE_DECLARATION')
    and body like 'KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.%'), 5, 'texty kiosku nesu oznacenie konceptu pre pravnicku');
select is((select count(*)::int from public.hr_legal_text_versions
  where text_key in ('S21_ADDRESS_NOTICE', 'S335_NOTICE', 'S335_CONSENT') and status = 'KONCEPT'), 3,
  'migracia 66: § 21 a § 335 ostavaju neschvalene');
select is((select count(*)::int from public.hr_legal_text_versions where body_sha256 = 'x'), 0, 'hash textov pocita DB');

-- ---------- konfiguracia pre kiosk (anon) ----------
set local role anon;
select ok(not ((public.hr_onboarding_config()->'texts') ? 'S21_ADDRESS_NOTICE'), 'neschvaleny text § 21 kiosk nedostane');
reset role;
-- dalej ako po schvaleni jednatelom (len v tomto teste)
update public.hr_legal_text_versions set status = 'SCHVALENO' where text_key in ('S21_ADDRESS_NOTICE', 'S335_NOTICE', 'S335_CONSENT') and status = 'KONCEPT';
set local role anon;
select ok((public.hr_onboarding_config()->'texts') ? 'S21_ADDRESS_NOTICE', 'kiosk dostane schvaleny text § 21 oznamenia');
select ok(not ((public.hr_onboarding_config()->'texts') ? 'S335_NOTICE'), '§ 335 vypnuty: poucenie ani suhlas sa kiosku neposiela');
select throws_ok($$select public.hr_current_legal_text('S21_ADDRESS_NOTICE')$$, '42501', null, 'anon nevola interne funkcie');
reset role;
update public.hr_settings set value = 'true'::jsonb where key = 's335_consent_enabled';
set local role anon;
select ok((public.hr_onboarding_config()->'texts') ?& array['S335_NOTICE', 'S335_CONSENT'], '§ 335 zapnuty: kiosk dostane poucenie aj text suhlasu');
reset role;
update public.hr_settings set value = 'false'::jsonb where key = 's335_consent_enabled';

-- ---------- priprava: relacie a dokumenty (server) ----------
insert into public.onboarding_sessions (id, session_token_sha256, status, draft_data, expires_at) values
  ('onb-a', public.hr_onboarding_token_hash(repeat('a', 64)), 'IN_PROGRESS', '{"first_name":"Jana","last_name":"Testová","private_email":"jana@example.test"}', now() + interval '1 hour'),
  ('onb-b', public.hr_onboarding_token_hash(repeat('b', 64)), 'IN_PROGRESS', '{"first_name":"Petr","last_name":"Vzorek"}', now() + interval '1 hour'),
  ('onb-c', public.hr_onboarding_token_hash(repeat('c', 64)), 'IN_PROGRESS', '{"first_name":"Eva","last_name":"Pokusná"}', now() + interval '1 hour');
insert into public.hr_documents (id, onboarding_session_id, doc_type, origin, status, legal_act_type,
    final_pdf_path, final_pdf_sha256, final_pdf_text_check, finalized_at) values
  ('kd-a-q', 'onb-a', 'osobni_dotaznik', 'GENERATED', 'READY_FOR_SIGNATURE', 'EMPLOYEE_DECLARATION',
    'dotaznik/onb-a/kd-a-q/f.pdf', repeat('1', 64), '{"ok":true,"server_verified":true,"method":"server-generated-v1"}', now()),
  ('kd-a-21', 'onb-a', 's21_oznameni_adresy', 'GENERATED', 'READY_FOR_SIGNATURE', 'EMPLOYEE_DECLARATION',
    'dotaznik/onb-a/kd-a-21/f.pdf', repeat('2', 64), '{"ok":true,"server_verified":true,"method":"server-generated-v1"}', now()),
  ('kd-b-q', 'onb-b', 'osobni_dotaznik', 'GENERATED', 'READY_FOR_SIGNATURE', 'EMPLOYEE_DECLARATION',
    'dotaznik/onb-b/kd-b-q/f.pdf', repeat('3', 64), '{"ok":true,"server_verified":true,"method":"server-generated-v1"}', now());
insert into public.hr_signature_images (id, png, png_sha256) values
  ('ki-1', decode(repeat('ab', 200), 'hex'), 'x'), ('ki-2', decode(repeat('cd', 200), 'hex'), 'x'), ('ki-3', decode(repeat('ef', 200), 'hex'), 'x');

-- ---------- anon nevidi nic okrem RPC ----------
set local role anon;
select is(pg_temp.anon_vidi('public.hr_documents'), 0, 'anon necita HR dokumenty');
select is(pg_temp.anon_vidi('public.hr_signature_images'), 0, 'anon necita obrazky podpisov');
select is(pg_temp.anon_vidi('public.hr_document_signatures'), 0, 'anon necita podpisy');
select is(pg_temp.anon_vidi('public.employee_contact_declarations'), 0, 'anon necita vyhlasenia');
select is(pg_temp.anon_vidi('public.onboarding_sessions'), 0, 'anon necita relacie (ani svoju)');
select is(pg_temp.anon_vidi('storage.objects'), 0, 'anon necita subory v ulozisku');
select throws_ok($$insert into public.hr_signature_images (id, png, png_sha256) values ('ki-x', decode(repeat('ab', 200), 'hex'), 'x')$$,
  '42501', null, 'anon nevlozi obrazok podpisu priamo');
select throws_ok($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type) values ('ks-x', 'kd-b-q', 'PAPER', 'EMPLOYEE')$$,
  null, null, 'anon nevlozi podpis priamo (RLS alebo kontrola skenu)');
select throws_ok($$select public.hr_onboarding_review('onb-a', 'REVIEWED', 'emp-x')$$, '42501', null, 'anon nevola kontrolu HR');
select is(public.hr_onboarding_save_draft(repeat('z', 64), '{"first_name":"X"}'), false, 'cudzi/neplatny token: koncept sa neulozi');
select is(public.hr_onboarding_submit(repeat('z', 64), 'PAPER'), false, 'neplatny token: neodosle sa');
reset role;

-- ---------- podpis dotaznika relacie A (server) ----------
insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, signed_content_sha256,
    signature_image_id, intent_text_version_id, intent_text_sha256)
  values ('ks-a-q', 'kd-a-q', 'ELECTRONIC_TABLET', 'EMPLOYEE', 'Jana Testová', repeat('1', 64), 'ki-1', 'lt-intent-questionnaire-v1', 'h');
select throws_ok($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_content_sha256,
    signature_image_id, intent_text_version_id, intent_text_sha256)
  values ('ks-a-21', 'kd-a-21', 'ELECTRONIC_TABLET', 'EMPLOYEE', repeat('2', 64), 'ki-1', 'lt-intent-employee-declaration-v1', 'h')$$,
  '23505', null, 'obrazok podpisu z dotaznika sa neda pouzit na inom dokumente');

set local role anon;
select is(public.hr_onboarding_save_draft(repeat('a', 64), '{"first_name":"Zmenena"}'), false, 'po prvom podpise sa udaje dotaznika nemenia');
select throws_ok($$select public.hr_onboarding_submit(repeat('a', 64), 'PAPER')$$, 'P0001', null, 'po elektronickom podpise nejde prejst na papier');
select throws_ok($$select public.hr_onboarding_submit(repeat('a', 64), 'ELECTRONIC')$$, 'P0001', null, 'elektronicke odoslanie vyzaduje podpis vsetkych dokumentov');
reset role;
select is((select draft_data->>'first_name' from public.onboarding_sessions where id = 'onb-a'), 'Jana', 'koncept ostal nezmeneny');

update public.hr_documents set status = 'SIGNED' where id = 'kd-a-q';
insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, signed_content_sha256,
    signature_image_id, intent_text_version_id, intent_text_sha256)
  values ('ks-a-21', 'kd-a-21', 'ELECTRONIC_TABLET', 'EMPLOYEE', 'Jana Testová', repeat('2', 64), 'ki-2', 'lt-intent-employee-declaration-v1', 'h');
update public.hr_documents set status = 'SIGNED' where id = 'kd-a-21';
insert into public.employee_contact_declarations (id, kind, onboarding_session_id, email_snapshot, declared_at, channel, hr_document_id, notice_version_id)
  values ('kdecl-a', 'S21_ADDRESS_NOTICE', 'onb-a', 'Jana@Example.test', now(), 'KIOSK_TABLET', 'kd-a-21', 'lt-s21-address-notice-v1');

set local role anon;
select is(public.hr_onboarding_submit(repeat('a', 64), 'ELECTRONIC'), true, 'vsetko podpisane: elektronicke odoslanie');
select is(public.hr_onboarding_save_draft(repeat('a', 64), '{"first_name":"X"}'), false, 'odoslanu relaciu nejde prepisat');
select is(public.hr_onboarding_submit(repeat('a', 64), 'ELECTRONIC'), false, 'odoslanu relaciu nejde odoslat znova');
-- ---------- papierova alternativa (relacia B) ----------
select is(public.hr_onboarding_submit(repeat('b', 64), 'PAPER'), true, 'papierovy podpis: odoslanie bez elektronickeho podpisu');
-- ---------- bez dokumentov (relacia C, stary kiosk) ----------
select is(public.hr_onboarding_submit(repeat('c', 64)), true, 'predvolene papierovy rezim (spatna kompatibilita)');
reset role;
select is((select signing_mode from public.onboarding_sessions where id = 'onb-a'), 'ELECTRONIC', 'rezim podpisu ulozeny');
select is((select status || '|' || void_reason from public.hr_documents where id = 'kd-b-q'), 'VOIDED|Zvolen podpis na papíře',
  'pri papieri sa pripravene PDF zneplatni (nemaze)');

-- ---------- kontrola HR ----------
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'hr-d@test.local');
insert into public.profiles (id, full_name, role) values ('00000000-0000-0000-0000-0000000000f1', 'Test HR D', 'office');
insert into public.hr_permissions (id, user_email, permissions)
  values ('p-d', 'hr-d@test.local', array['HR_VIEW_BASIC', 'HR_VIEW_SENSITIVE', 'HR_EDIT', 'HR_DOCUMENT_GENERATE']);
insert into public.employees (id, first_name, last_name) values ('emp-d', 'Jana', 'Testová');
create temp table before_hash as select id, final_pdf_sha256, signed_pdf_sha256, locked_at from public.hr_documents where onboarding_session_id = 'onb-a';
grant select on before_hash to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000f1", "email": "hr-d@test.local", "role": "authenticated"}';
select is((select count(*)::int from public.hr_documents where onboarding_session_id = 'onb-a'), 2, 'HR vidi podpisane dokumenty dotaznika pred zalozenim');
select is(public.hr_onboarding_review('onb-a', 'REVIEWED', 'emp-d'), true, 'schvalenie dotaznika');
select is((select count(*)::int from public.hr_documents where onboarding_session_id = 'onb-a' and employee_id = 'emp-d'), 2, 'dokumenty prenesene na zamestnanca');
select is((select count(*)::int from public.hr_documents d join before_hash b using (id)
  where d.final_pdf_sha256 = b.final_pdf_sha256 and d.locked_at = b.locked_at and d.status = 'SIGNED'), 2, 'prenos bez zmeny obsahu, hashov a zamknutia');
select is((select employee_id from public.employee_contact_declarations where id = 'kdecl-a'), 'emp-d', '§ 21 oznamenie prenesene na zamestnanca');
select is((select email_snapshot from public.employee_contact_declarations where id = 'kdecl-a'), 'jana@example.test', 'adresa vo vyhlaseni normalizovana a nemenna');
select throws_ok($$update public.hr_documents set employee_id = 'emp-iny' where id = 'kd-a-q'$$, 'P0001', null, 'zamknuty dokument nejde presunut inemu zamestnancovi');
select is(public.hr_onboarding_review('onb-b', 'DISCARDED', null), true, 'zamietnutie dotaznika');
reset role;
select is((select count(*)::int from public.hr_documents where onboarding_session_id = 'onb-b'), 1, 'pri zamietnuti sa dokumenty nemazu');

-- § 21 oznamenie plati len pre adresu, ktoru zamestnanec oznamil
update public.employees set private_email = 'jana@example.test' where id = 'emp-d';
set local role authenticated;
select isnt(public.hr_valid_contact_declaration('emp-d', 'S21_ADDRESS_NOTICE'), null, 'oznamenie plati pre oznamenu adresu');
reset role;
update public.employees set private_email = 'ina@example.test' where id = 'emp-d';
set local role authenticated;
select is(public.hr_valid_contact_declaration('emp-d', 'S21_ADDRESS_NOTICE'), null, 'po zmene e-mailu sa oznamenie neprenasa');
reset role;

select * from finish();
rollback;
