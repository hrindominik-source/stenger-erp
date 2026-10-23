-- DB testy migracie 54 (faza F): podpisove tokeny, podpis zamestnavatela
-- pri pisomnosti § 334. Iba lokalne: npx supabase test db. Vymyslene udaje.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a7', 'hr.g@test.local');
insert into public.profiles (id, full_name, role) values ('00000000-0000-0000-0000-0000000000a7', 'Test Personalista G', 'office');
insert into public.hr_permissions (id, user_email, permissions) values
  ('p-g1', 'hr.g@test.local', array['HR_VIEW_BASIC', 'HR_VIEW_SENSITIVE', 'HR_VIEW_PAYROLL', 'HR_DOCUMENT_SIGN']);
insert into public.employees (id, first_name, last_name) values ('emp-g1', 'Olga', 'Tabletova');
insert into public.hr_documents (id, employee_id, doc_type, origin, status, final_pdf_path, final_pdf_sha256, final_pdf_text_check, finalized_at) values
  ('g-ps', 'emp-g1', 'pracovni_smlouva', 'GENERATED', 'READY_FOR_SIGNATURE', 'zamestnanci/emp-g1/g-ps/f.pdf', repeat('1', 64), '{"ok": true, "server_verified": true}', now()),
  ('g-mv', 'emp-g1', 'mzdovy_vymer', 'GENERATED', 'READY_FOR_SIGNATURE', 'zamestnanci/emp-g1/g-mv/f.pdf', repeat('2', 64), '{"ok": true, "server_verified": true}', now());
insert into public.hr_signature_images (id, png, png_sha256) values
  ('g-img-1', decode(repeat('ab', 200), 'hex'), 'x'), ('g-img-2', decode(repeat('ac', 200), 'hex'), 'x');

-- ---------- tokeny ----------
insert into public.hr_signing_tokens (id, token_sha256, hr_document_id, final_pdf_sha256, signer_type, signer_name, identity_verification, created_by, expires_at)
  values ('g-t1', repeat('a', 64), 'g-ps', repeat('1', 64), 'EMPLOYEE', 'Olga Tabletova', '{"method": "ID_DOCUMENT_CHECKED_BY_HR"}', '00000000-0000-0000-0000-0000000000a7', now() + interval '30 minutes');
select throws_ok($$insert into public.hr_signing_tokens (token_sha256, hr_document_id, final_pdf_sha256, signer_type, signer_name, identity_verification, created_by, expires_at)
  values (repeat('b', 64), 'g-ps', repeat('1', 64), 'EMPLOYEE', 'x', '{}', '00000000-0000-0000-0000-0000000000a7', now() + interval '1 day')$$,
  '23514', null, 'token nesmie platit dlhsie nez 2 hodiny');
select throws_ok($$insert into public.hr_signing_tokens (token_sha256, hr_document_id, final_pdf_sha256, signer_type, signer_name, identity_verification, created_by, expires_at)
  values ('plaintext-token', 'g-ps', repeat('1', 64), 'EMPLOYEE', 'x', '{}', '00000000-0000-0000-0000-0000000000a7', now() + interval '5 minutes')$$,
  '23514', null, 'v DB sa uklada len hash tokenu');
select lives_ok($$update public.hr_signing_tokens set used_at = now() where id = 'g-t1'$$, 'token sa raz pouzije');
select throws_ok($$update public.hr_signing_tokens set used_at = now() + interval '1 minute' where id = 'g-t1'$$, 'P0001', null, 'pouzitie tokenu sa neprepisuje');
select throws_ok($$update public.hr_signing_tokens set expires_at = now() + interval '1 hour' where id = 'g-t1'$$, 'P0001', null, 'platnost tokenu sa nepredlzuje');
select throws_ok($$delete from public.hr_signing_tokens where id = 'g-t1'$$, 'P0001', null, 'token sa nemaze');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a7", "email": "hr.g@test.local", "role": "authenticated"}';
select is((select count(*) from public.hr_signing_tokens)::int, 0, 'HR tokeny nevidi (len server)');
select throws_ok($$insert into public.hr_signing_tokens (token_sha256, hr_document_id, final_pdf_sha256, signer_type, signer_name, identity_verification, created_by, expires_at)
  values (repeat('c', 64), 'g-ps', repeat('1', 64), 'EMPLOYEE', 'x', '{}', '00000000-0000-0000-0000-0000000000a7', now() + interval '5 minutes')$$,
  '42501', null, 'HR token nevytvori priamo (len server)');
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select is((select count(*) from public.hr_signing_tokens)::int, 0, 'anon tokeny nevidi');
reset role;

-- ---------- podpis zamestnavatela pri § 334 ----------
select throws_ok($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, signed_content_sha256, signature_image_id, intent_text_version_id, intent_text_sha256)
  values ('g-s1', 'g-mv', 'ELECTRONIC_TABLET', 'EMPLOYER', 'JUDr. Zastupce', repeat('2', 64), 'g-img-1', 'lt-intent-employer-v1', 'h')$$,
  'P0001', null, 'mzdovy vymer: obrazok podpisu zamestnavatela odmietnuty (aj server)');
select lives_ok($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, signed_content_sha256, document_hash, file_path)
  values ('g-s2', 'g-mv', 'ELECTRONIC_QUALIFIED', 'EMPLOYER', 'JUDr. Zastupce', repeat('2', 64), repeat('3', 64), 'zamestnanci/emp-g1/g-mv/uznavany-podpis.pdf')$$,
  'mzdovy vymer: uznavany el. podpis prijaty');
select lives_ok($$insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, signed_content_sha256, signature_image_id, intent_text_version_id, intent_text_sha256)
  values ('g-s3', 'g-ps', 'ELECTRONIC_TABLET', 'EMPLOYER', 'JUDr. Zastupce', repeat('1', 64), 'g-img-2', 'lt-intent-employer-v1', 'h')$$,
  'zmluva: podpis zamestnavatela na tablete povoleny');
select is((select body like 'KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.%' from public.hr_current_legal_text('INTENT_EMPLOYER_SIGNATURE')), true, 'text za zamestnavatela je koncept');

select * from finish();
rollback;
