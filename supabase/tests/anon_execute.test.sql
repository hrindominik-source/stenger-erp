-- DB testy migracie 62: anon smie spustat len funkcie verejnej casti
-- (kiosk, planovanie smien, current_role pre RLS tabulky workers).
-- Iba lokalne: npx supabase test db.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- presny zoznam funkcii v public, ktore anon smie spustat
select set_eq(
  $$select p.oid::regprocedure::text from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and has_function_privilege('anon', p.oid, 'EXECUTE')$$,
  $$values ('hr_onboarding_config()'), ('hr_onboarding_start_session(text)'), ('hr_onboarding_save_draft(text,jsonb)'),
           ('hr_onboarding_submit(text,text)'), ('plan_smien_has_employee_pin(text)'), ('plan_smien_set_employee_pin(text,text)'),
           ('plan_smien_verify_employee_pin(text,text)'), ('plan_smien_verify_admin_pin(text)'),
           ('plan_smien_reset_employee_pin(text,text)'), ('plan_smien_set_admin_pin(text,text)'),
           ('plan_smien_save(text,jsonb)'), ('plan_smien_add_request(text,text,jsonb)'), ('"current_role"()')$$,
  'anon smie spustat len kiosk, planovanie smien a current_role');

-- ziadna funkcia v public nie je spustitelna cez PUBLIC
select is_empty(
  $$select p.oid::regprocedure::text from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and a.grantee = 0 and a.privilege_type = 'EXECUTE'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')$$,
  'PUBLIC nema EXECUTE na funkcie v public');

-- anon: konkretne nebezpecne funkcie
select ok(not has_function_privilege('anon', 'public.hr_admin_delete_employee(text, text)', 'EXECUTE'), 'anon nesmie hr_admin_delete_employee');
select ok(not has_function_privilege('anon', 'public.approve_order_draft(text)', 'EXECUTE'), 'anon nesmie approve_order_draft');
select ok(not has_function_privilege('anon', 'public.set_expedovana(text, text)', 'EXECUTE'), 'anon nesmie set_expedovana');
select ok(not has_function_privilege('anon', 'public.next_order_numbers()', 'EXECUTE'), 'anon nesmie next_order_numbers');
select ok(not has_function_privilege('anon', 'public.hr_get_permissions()', 'EXECUTE'), 'anon nesmie hr_get_permissions');
select ok(not has_function_privilege('anon', 'public.dochadzka_reset_worker_pin(text)', 'EXECUTE'), 'anon nesmie dochadzka_reset_worker_pin');

-- prihlaseny pouzivatel a server si prava ponechali
select ok(has_function_privilege('authenticated', p, 'EXECUTE'), 'authenticated smie ' || p)
from unnest(array['public.hr_admin_delete_employee(text, text)', 'public.hr_get_permissions()', 'public.hr_has_permission(text)',
  'public.hr_object_path_visible(text)', 'public.hr_garnishment_doc_count(text)', 'public.approve_order_draft(text)',
  'public.set_expedovana(text, text)', 'public.next_order_numbers()', 'public.next_material_order_number()',
  'public.get_orders_for_sklad()', 'public.dochadzka_verify_worker_pin(text, text)', 'public.dochadzka_set_worker_pin(text, text)',
  'public.hr_document_missing_signers(text)', 'public.hr_valid_contact_declaration(text, text)', 'public."current_role"()',
  'public.hr_onboarding_review(text, text, text)', 'public.hr_onboarding_config()']::regprocedure[]) p;
select ok(has_function_privilege('service_role', p, 'EXECUTE'), 'service_role smie ' || p)
from unnest(array['public.hr_current_legal_text(text)', 'public.hr_document_missing_signers(text)', 'public.hr_get_permissions()',
  'public.hr_has_permission(text)', 'public.hr_onboarding_config()']::regprocedure[]) p;
-- zamerne obmedzene funkcie ostali obmedzene
select ok(not has_function_privilege('authenticated', 'public.hr_onboarding_cleanup()', 'EXECUTE'), 'hr_onboarding_cleanup ostava len pre server');

-- nove funkcie: anon ani PUBLIC predvolene nedostanu, authenticated ano
create function public.tmp_anon_test() returns int language sql as 'select 1';
select ok(not has_function_privilege('anon', 'public.tmp_anon_test()', 'EXECUTE'), 'nova funkcia: anon bez EXECUTE');
select ok(has_function_privilege('authenticated', 'public.tmp_anon_test()', 'EXECUTE'), 'nova funkcia: authenticated ma EXECUTE');

-- spravanie v roli anon: verejna cast funguje, zvysok je odmietnuty
insert into public.workers (id, data) values ('w-anon-test', '{"meno": "Test", "typ": "vyroba"}');
set local role anon;
select is((select count(*)::int from public.workers where id = 'w-anon-test'), 1, 'anon cita pracovnikov vyroby (RLS volá current_role)');
select lives_ok($$select public.plan_smien_verify_admin_pin('0000')$$, 'anon overi PIN planovania');
select lives_ok($$select public.hr_onboarding_config()$$, 'anon nacita konfiguraciu kiosku');
select throws_ok($$select public.next_order_numbers()$$, '42501', null, 'anon nesmie cislovat objednavky');
select throws_ok($$select public.hr_admin_delete_employee('emp-x', 'x')$$, '42501', null, 'anon nesmie mazat zamestnanca');
reset role;

select * from finish();
rollback;
