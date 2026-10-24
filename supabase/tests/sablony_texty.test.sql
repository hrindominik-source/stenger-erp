-- DB testy migracie 58 (faza I): nove typy dokumentov a texty, verzovanie
-- textov, vznik vyhlasenia / odvolania po uplnom podpise serverom
-- vygenerovaneho dokumentu. Iba lokalne: npx supabase test db.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ---------- texty a typy ----------
select is((select count(*) from public.hr_legal_text_versions where text_key in ('S335_REVOCATION', 'RECEIPT_CONFIRMATION') and body like 'KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.%')::int, 2,
  'nove texty su koncepty ke schvaleni pravnickou');
select is((select body_sha256 from public.hr_legal_text_versions where id = 'lt-s335-revocation-v1'),
  encode(extensions.digest(convert_to((select body from public.hr_legal_text_versions where id = 'lt-s335-revocation-v1'), 'UTF8'), 'sha256'), 'hex'), 'otisk textu pocita DB');
select is(public.hr_default_legal_act_type('s335_odvolani'), 'EMPLOYEE_DECLARATION', 'odvolanie = prohlaseni zamestnance');
select is(public.hr_default_legal_act_type('s335_pouceni'), 'RECEIPT_ACKNOWLEDGEMENT', 'poucenie = potvrdenie prevzatia');
select is(public.hr_default_legal_act_type('potvrzeni_prevzeti'), 'RECEIPT_ACKNOWLEDGEMENT', 'potvrdenie o prevzati');
select is(public.hr_default_legal_act_type('pracovni_smlouva'), 'BILATERAL_CONTRACT', 'povodne typy bez zmeny');
select is(public.hr_required_signers(public.hr_default_legal_act_type('potvrzeni_prevzeti')), array['EMPLOYEE'], 'potvrdenie podpisuje len zamestnanec');

-- ---------- verzovanie: zmena textu = nova verzia, stare podpisy ostavaju ----------
select throws_ok($$update public.hr_legal_text_versions set body = 'zmena' where id = 'lt-s335-revocation-v1'$$, 'P0001', null, 'text verzie je nemenny');
select is(public.hr_current_legal_text('S335_REVOCATION'), null, 'neschvaleny koncept sa nepouzije');
update public.hr_legal_text_versions set status = 'SCHVALENO' where id = 'lt-s335-revocation-v1';
insert into public.hr_legal_text_versions (id, text_key, version_no, title, body, body_sha256, status)
  values ('lt-s335-revocation-v2', 'S335_REVOCATION', 2, 'Odvolání souhlasu', 'KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU. Upravený text.', 'x', 'SCHVALENO');
select is((public.hr_current_legal_text('S335_REVOCATION')).id, 'lt-s335-revocation-v2', 'aktualna je nova verzia');
update public.hr_legal_text_versions set status = 'VYRAZENO' where id = 'lt-s335-revocation-v2';
select is((public.hr_current_legal_text('S335_REVOCATION')).id, 'lt-s335-revocation-v1', 'vyradenim sa vrati predchadzajuca verzia');

-- ---------- vyhlasenie po uplnom podpise ----------
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e9', 'hr.i@test.local');
insert into public.employees (id, first_name, last_name, private_email) values ('emp-i1', 'Iva', 'Textova', 'iva@example.test');
insert into public.employee_contact_declarations (id, kind, employee_id, email_snapshot, declared_at, channel)
  values ('d-i-old', 'S21_ADDRESS_NOTICE', 'emp-i1', 'iva@example.test', now() - interval '1 year', 'PAPER_SCAN');
insert into public.employee_contact_declarations (id, kind, employee_id, email_snapshot, declared_at, channel, notice_version_id)
  values ('d-i-335', 'S335_CONSENT', 'emp-i1', 'iva@example.test', now() - interval '1 year', 'PAPER_SCAN', 'lt-s335-notice-v1');

create function pg_temp.declaration_doc(p_id text, p_type text, p_snapshot jsonb, p_method text) returns void language plpgsql as $$
begin
  insert into public.hr_documents (id, employee_id, doc_type, origin, status, variables_snapshot)
    values (p_id, 'emp-i1', p_type, 'GENERATED', 'READY_FOR_SIGNATURE', p_snapshot);
  update public.hr_documents set final_pdf_path = 'zamestnanci/emp-i1/' || p_id || '/f.pdf', final_pdf_sha256 = repeat('7', 64), finalized_at = now(),
    final_pdf_text_check = jsonb_build_object('ok', true, 'server_verified', true, 'method', p_method) where id = p_id;
  insert into public.hr_document_signatures (id, hr_document_id, method, signer_type, signed_by_name, document_hash, file_path)
    values ('s-' || p_id, p_id, 'PAPER', 'EMPLOYEE', 'Iva Textova', repeat('c', 64), 'zamestnanci/emp-i1/' || p_id || '/sken.pdf');
  update public.hr_documents set status = 'SIGNED' where id = p_id;
end $$;

select pg_temp.declaration_doc('i-21', 's21_oznameni_adresy', '{"declaration_kind": "S21_ADDRESS_NOTICE", "email": "iva@example.test"}', 'server-generated-v1');
select is((select count(*) from public.employee_contact_declarations where hr_document_id = 'i-21' and kind = 'S21_ADDRESS_NOTICE' and channel = 'PAPER_SCAN')::int, 1,
  'po podpise vznikne § 21 oznamenie (papier)');
select isnt((select superseded_at from public.employee_contact_declarations where id = 'd-i-old'), null, 'stare § 21 oznamenie je nahradene');
select is(public.hr_valid_contact_declaration_server('emp-i1', 'S21_ADDRESS_NOTICE'),
  (select id from public.employee_contact_declarations where hr_document_id = 'i-21'), 'platne je nove oznamenie');

select pg_temp.declaration_doc('i-forged', 's21_oznameni_adresy', '{"declaration_kind": "S21_ADDRESS_NOTICE", "email": "cudzi@example.test"}', 'client');
select is((select count(*) from public.employee_contact_declarations where hr_document_id = 'i-forged')::int, 0,
  'dokument, ktory negeneroval server, vyhlasenie nevytvori');

select pg_temp.declaration_doc('i-odv', 's335_odvolani', '{"declaration_kind": "S335_REVOCATION", "email": "iva@example.test", "consent_id": "d-i-335"}', 'server-generated-v1');
select isnt((select revoked_at from public.employee_contact_declarations where id = 'd-i-335'), null, 'podpisane odvolanie zrusi suhlas § 335');
select is((select revokes_declaration_id from public.employee_contact_declarations where hr_document_id = 'i-odv'), 'd-i-335', 'zaznam odvolania odkazuje na suhlas');
select is(public.hr_valid_contact_declaration_server('emp-i1', 'S335_CONSENT'), null, 'po odvolani nie je platny suhlas');

select pg_temp.declaration_doc('i-pp', 'potvrzeni_prevzeti', '{"declaration_kind": null, "target_document_id": "i-21"}', 'server-generated-v1');
select is((select count(*) from public.employee_contact_declarations where hr_document_id = 'i-pp')::int, 0, 'potvrdenie o prevzati nevytvara vyhlasenie');

select * from finish();
rollback;
