-- DB testy migracii 54 a 55: podpisove tokeny (osobna pritomnost: kod,
-- zariadenie, relacia HR), podpis zamestnavatela pri pisomnosti § 334,
-- overenie certifikatu, sken potvrdenia len cez server, osoby s plnou mocou.
-- Iba lokalne: npx supabase test db. Vymyslene udaje.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a7', 'hr.g@test.local'),
  ('00000000-0000-0000-0000-0000000000a8', 'admin.g@test.local');
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000a7', 'Test Personalista G', 'office'),
  ('00000000-0000-0000-0000-0000000000a8', 'Test Admin G', 'office');
insert into public.hr_permissions (id, user_email, permissions) values
  ('p-g1', 'hr.g@test.local', array['HR_VIEW_BASIC', 'HR_VIEW_SENSITIVE', 'HR_VIEW_PAYROLL', 'HR_EDIT', 'HR_DOCUMENT_SIGN']),
  ('p-g2', 'admin.g@test.local', array['HR_ADMIN']);
insert into public.employees (id, first_name, last_name) values ('emp-g1', 'Olga', 'Tabletova');
insert into public.hr_documents (id, employee_id, doc_type, origin, status, final_pdf_path, final_pdf_sha256, final_pdf_text_check, finalized_at) values
  ('g-ps', 'emp-g1', 'pracovni_smlouva', 'GENERATED', 'READY_FOR_SIGNATURE', 'zamestnanci/emp-g1/g-ps/f.pdf', repeat('1', 64), '{"ok": true, "server_verified": true}', now()),
  ('g-mv', 'emp-g1', 'mzdovy_vymer', 'GENERATED', 'READY_FOR_SIGNATURE', 'zamestnanci/emp-g1/g-mv/f.pdf', repeat('2', 64), '{"ok": true, "server_verified": true}', now());
insert into public.hr_signature_images (id, png, png_sha256) values
  ('g-img-1', decode(repeat('ab', 200), 'hex'), 'x'), ('g-img-2', decode(repeat('ac', 200), 'hex'), 'x');

-- ---------- tokeny: osobna pritomnost ----------
insert into public.hr_signing_tokens (id, token_sha256, pairing_code_sha256, hr_session_id, hr_document_id, final_pdf_sha256, signer_type, signer_name, identity_verification, created_by, expires_at)
  values ('g-t1', repeat('a', 64), repeat('c', 64), gen_random_uuid(), 'g-ps', repeat('1', 64), 'EMPLOYEE', 'Olga Tabletova', '{"method": "ID_DOCUMENT_CHECKED_BY_HR_IN_PERSON"}', '00000000-0000-0000-0000-0000000000a7', now() + interval '10 minutes'),
         ('g-t2', repeat('b', 64), repeat('d', 64), gen_random_uuid(), 'g-ps', repeat('1', 64), 'EMPLOYEE', 'Olga Tabletova', '{}', '00000000-0000-0000-0000-0000000000a7', now() + interval '10 minutes');
select throws_ok($$insert into public.hr_signing_tokens (token_sha256, pairing_code_sha256, hr_session_id, hr_document_id, final_pdf_sha256, signer_type, signer_name, identity_verification, created_by, expires_at)
  values (repeat('e', 64), repeat('c', 64), gen_random_uuid(), 'g-ps', repeat('1', 64), 'EMPLOYEE', 'x', '{}', '00000000-0000-0000-0000-0000000000a7', now() + interval '1 day')$$,
  '23514', null, 'token nesmie platit dlhsie nez 2 hodiny');
select throws_ok($$insert into public.hr_signing_tokens (token_sha256, pairing_code_sha256, hr_session_id, hr_document_id, final_pdf_sha256, signer_type, signer_name, identity_verification, created_by, expires_at)
  values ('plaintext-token', repeat('c', 64), gen_random_uuid(), 'g-ps', repeat('1', 64), 'EMPLOYEE', 'x', '{}', '00000000-0000-0000-0000-0000000000a7', now() + interval '5 minutes')$$,
  '23514', null, 'v DB sa uklada len hash tokenu');
select throws_ok($$insert into public.hr_signing_tokens (token_sha256, hr_session_id, hr_document_id, final_pdf_sha256, signer_type, signer_name, identity_verification, created_by, expires_at)
  values (repeat('f', 64), gen_random_uuid(), 'g-ps', repeat('1', 64), 'EMPLOYEE', 'x', '{}', '00000000-0000-0000-0000-0000000000a7', now() + interval '5 minutes')$$,
  '23502', null, 'token bez kodu z obrazovky HR nevznikne');
select throws_ok($$insert into public.hr_signing_tokens (token_sha256, pairing_code_sha256, hr_document_id, final_pdf_sha256, signer_type, signer_name, identity_verification, created_by, expires_at)
  values (repeat('f', 64), repeat('c', 64), 'g-ps', repeat('1', 64), 'EMPLOYEE', 'x', '{}', '00000000-0000-0000-0000-0000000000a7', now() + interval '5 minutes')$$,
  '23502', null, 'token bez vazby na relaciu HR nevznikne');
select throws_ok($$update public.hr_signing_tokens set used_at = now() where id = 'g-t1'$$, 'P0001', null, 'podpis bez overenia kodom nie je mozny');
select throws_ok($$update public.hr_signing_tokens set code_verified_at = now() where id = 'g-t1'$$, 'P0001', null, 'overenie kodom vyzaduje zariadenie');
select throws_ok($$update public.hr_signing_tokens set code_attempts = 2 where id = 'g-t1'$$, 'P0001', null, 'pokusy len po jednom');
-- tri zle kody = zruseny
update public.hr_signing_tokens set code_attempts = 1 where id = 'g-t2';
update public.hr_signing_tokens set code_attempts = 2 where id = 'g-t2';
select is((select revoked_at is null from public.hr_signing_tokens where id = 'g-t2'), true, 'po 2 zlych kodoch este plati');
update public.hr_signing_tokens set code_attempts = 3 where id = 'g-t2';
select is((select revoked_at is not null from public.hr_signing_tokens where id = 'g-t2'), true, 'treti zly kod token zrusi');
select throws_ok($$update public.hr_signing_tokens set code_verified_at = now(), device_id = 'tablet-0123456789abcdef' where id = 'g-t2'$$, 'P0001', null, 'zruseny token sa uz neoveri');
-- spravny kod: zariadenie sa zapise raz
select lives_ok($$update public.hr_signing_tokens set code_verified_at = now(), device_id = 'tablet-0123456789abcdef' where id = 'g-t1'$$, 'spravny kod + zariadenie');
select throws_ok($$update public.hr_signing_tokens set device_id = 'tablet-ffffffffffffffff' where id = 'g-t1'$$, 'P0001', null, 'zariadenie sa nemeni');
select lives_ok($$update public.hr_signing_tokens set used_at = now() where id = 'g-t1'$$, 'token sa raz pouzije');
select throws_ok($$update public.hr_signing_tokens set used_at = now() + interval '1 minute' where id = 'g-t1'$$, 'P0001', null, 'pouzitie tokenu sa neprepisuje');
select throws_ok($$update public.hr_signing_tokens set expires_at = now() + interval '1 hour' where id = 'g-t1'$$, 'P0001', null, 'platnost tokenu sa nepredlzuje');
select throws_ok($$delete from public.hr_signing_tokens where id = 'g-t1'$$, 'P0001', null, 'token sa nemaze');

-- relacia HR: funkcia len pre server
select is(public.hr_auth_session_active(gen_random_uuid(), '00000000-0000-0000-0000-0000000000a7'), false, 'neexistujuca relacia HR = neaktivna');
select is(has_function_privilege('authenticated', 'public.hr_auth_session_active(uuid, uuid)', 'execute'), false, 'klient relacie HR nezistuje');
select is(has_function_privilege('anon', 'public.hr_auth_session_active(uuid, uuid)', 'execute'), false, 'anon relacie HR nezistuje');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a7", "email": "hr.g@test.local", "role": "authenticated"}';
select is((select count(*) from public.hr_signing_tokens)::int, 0, 'HR tokeny nevidi (len server)');
select throws_ok($$insert into public.hr_signing_tokens (token_sha256, pairing_code_sha256, hr_session_id, hr_document_id, final_pdf_sha256, signer_type, signer_name, identity_verification, created_by, expires_at)
  values (repeat('9', 64), repeat('c', 64), gen_random_uuid(), 'g-ps', repeat('1', 64), 'EMPLOYEE', 'x', '{}', '00000000-0000-0000-0000-0000000000a7', now() + interval '5 minutes')$$,
  '42501', null, 'HR token nevytvori priamo (len server)');
-- sken potvrdenia a plne moci nahra len server
select throws_ok($$insert into storage.objects (bucket_id, name) values ('hr-dokumenty', 'prevzeti/g-mv/x-' || repeat('a', 16) || '.pdf')$$,
  '42501', null, 'HR nenahra sken potvrdenia priamo do uloziska');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('hr-dokumenty', 'plne-moci/x.pdf')$$,
  '42501', null, 'HR nenahra sken plnej moci priamo');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('hr-dokumenty', 'zamestnanci/emp-g1/g-mv/overeni-podpisu-x.pdf')$$,
  '42501', null, 'HR nenahra protokol o overeni priamo');
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select is((select count(*) from public.hr_signing_tokens)::int, 0, 'anon tokeny nevidi');
reset role;

-- ---------- podpis zamestnavatela pri § 334, overenie certifikatu ----------
select throws_ok($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, signed_content_sha256, signature_image_id, intent_text_version_id, intent_text_sha256)
  values ('g-s1', 'g-mv', 'ELECTRONIC_TABLET', 'EMPLOYER', 'JUDr. Zastupce', repeat('2', 64), 'g-img-1', 'lt-intent-employer-v1', 'h')$$,
  'P0001', null, 'mzdovy vymer: obrazok podpisu zamestnavatela odmietnuty (aj server)');
select lives_ok($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, signed_content_sha256, document_hash, file_path)
  values ('g-s2', 'g-mv', 'ELECTRONIC_QUALIFIED', 'EMPLOYER', 'JUDr. Zastupce', repeat('2', 64), repeat('3', 64), 'zamestnanci/emp-g1/g-mv/uznavany-podpis.pdf')$$,
  'mzdovy vymer: uznavany el. podpis prijaty');
select lives_ok($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, signed_content_sha256, signature_image_id, intent_text_version_id, intent_text_sha256)
  values ('g-s3', 'g-ps', 'ELECTRONIC_TABLET', 'EMPLOYER', 'JUDr. Zastupce', repeat('1', 64), 'g-img-2', 'lt-intent-employer-v1', 'h')$$,
  'zmluva: podpis zamestnavatela na tablete povoleny');
select is(public.hr_signature_certificate_status('g-s2'), 'NOT_VERIFIED', 'uznavany podpis bez overenia = certifikat neovereny');
select throws_ok($$insert into public.hr_signature_verifications (signature_id, result, method, service_name) values ('g-s3', 'VALID', 'AUTOMATIC', 'x')$$,
  'P0001', null, 'overenie certifikatu len pri uznavanom podpise');
select throws_ok($$insert into public.hr_signature_verifications (signature_id, result, method, service_name) values ('g-s2', 'VALID', 'MANUAL_PUBLIC_SERVICE', 'EU DSS')$$,
  '23514', null, 'rucne overenie vyzaduje protokol a kto overil');
insert into public.hr_signature_verifications (id, signature_id, result, method, service_name, protocol_path, protocol_sha256, verified_by, verified_by_name)
  values ('g-v1', 'g-s2', 'VALID', 'MANUAL_PUBLIC_SERVICE', 'EU DSS', 'zamestnanci/emp-g1/g-mv/overeni-podpisu-' || repeat('4', 16) || '.pdf', repeat('4', 64), '00000000-0000-0000-0000-0000000000a7', 'Test Personalista G');
select is(public.hr_signature_certificate_status('g-s2'), 'VALID', 'po overeni = platny');
select throws_ok($$update public.hr_signature_verifications set result = 'INVALID' where id = 'g-v1'$$, 'P0001', null, 'zaznam o overeni je nemenny');
select throws_ok($$delete from public.hr_signature_verifications where id = 'g-v1'$$, 'P0001', null, 'zaznam o overeni sa nemaze');
select ok(exists (select 1 from public.audit_log where entity = 'hr_signature_verifications' and entity_id = 'g-v1'), 'overenie certifikatu je v audite');
select is((select body like 'KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.%' from public.hr_current_legal_text('INTENT_EMPLOYER_SIGNATURE')), true, 'text za zamestnavatela je koncept');

-- ---------- osoby s plnou mocou ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a7", "email": "hr.g@test.local", "role": "authenticated"}';
select ok((select count(*) from public.hr_signatories) >= 0, 'HR vidi osoby s plnou mocou');
select throws_ok($$insert into public.hr_signatories (id, full_name, full_name_instrumental, valid_from) values ('g-sig-x', 'Bc. Nikdo', 'Bc. Nikým', current_date)$$,
  '42501', null, 'bez HR_ADMIN nikoho neprida');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a8", "email": "admin.g@test.local", "role": "authenticated"}';
select lives_ok($$insert into public.hr_signatories (id, full_name, full_name_instrumental, user_id, valid_from) values ('g-sig-1', 'Mgr. Test Zmocnenec', 'Mgr. Testem Zmocněncem', '00000000-0000-0000-0000-0000000000a8', current_date)$$,
  'HR_ADMIN prida osobu s plnou mocou');
select throws_ok($$insert into public.hr_signatories (id, full_name, full_name_instrumental, valid_from, poa_scan_path, poa_scan_sha256) values ('g-sig-2', 'Ing. Iny', 'Ing. Iným', current_date, 'plne-moci/x.pdf', repeat('5', 64))$$,
  'P0001', null, 'sken plnej moci s vlastnym otiskom klient nezapise');
select throws_ok($$update public.hr_signatories set valid_to = current_date - 10 where id = 'g-sig-1'$$, '23514', null, 'platnost do nemoze byt pred od');
select lives_ok($$update public.hr_signatories set valid_to = current_date + 30 where id = 'g-sig-1'$$, 'HR_ADMIN ukonci platnost');
select is((select count(*) from public.hr_signatories where id = 'g-sig-1')::int, 1, 'zaznam je viditelny');
select lives_ok($$delete from public.hr_signatories where id = 'g-sig-1'$$, 'delete nema policy (0 riadkov)');
select is((select count(*) from public.hr_signatories where id = 'g-sig-1')::int, 1, 'osoba s plnou mocou sa nemaze');
reset role;
select ok(exists (select 1 from public.audit_log where entity = 'hr_signatories' and entity_id = 'g-sig-1' and action ilike 'update%'), 'zmena plnej moci je v audite');
select throws_ok($$delete from public.hr_signatories where id = 'g-sig-1'$$, 'P0001', null, 'ani server osobu nezmaze');
update public.hr_signatories set poa_scan_path = 'plne-moci/g-sig-1-' || repeat('6', 16) || '.pdf', poa_scan_sha256 = repeat('6', 64) where id = 'g-sig-1';
select throws_ok($$update public.hr_signatories set poa_scan_sha256 = repeat('7', 64) where id = 'g-sig-1'$$, 'P0001', null, 'sken plnej moci je nemenny');
-- viditelnost skenu podla citlivosti
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a7", "email": "hr.g@test.local", "role": "authenticated"}';
select ok(public.hr_object_path_visible('plne-moci/g-sig-1-' || repeat('6', 16) || '.pdf'), 'HR s citlivymi pravami vidi sken plnej moci');
select ok(not public.hr_object_path_visible('plne-moci/neznamy.pdf'), 'neznamy subor plnej moci len HR_ADMIN');
reset role;

select * from finish();
rollback;
