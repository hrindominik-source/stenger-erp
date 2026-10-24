-- ============================================================
-- 62. Neprihlaseny pouzivatel (anon) smie spustat len funkcie, ktore
--     verejna cast aplikacie naozaj vola.
--   Predvolene Supabase dava EXECUTE na kazdu novu funkciu v public roli
--   anon aj PUBLIC - preto mohol anon volat napr. hr_admin_delete_employee,
--   approve_order_draft, next_order_numbers (overene porovnanim katalogu
--   produkcie 24.10.2026).
--
--   Pre anon ostava (verejna cast bez prihlasenia):
--   - nastupny kiosk (?kiosk=nastup, OnboardingKiosk.jsx):
--       hr_onboarding_config, hr_onboarding_start_session,
--       hr_onboarding_save_draft, hr_onboarding_submit;
--   - planovanie smien (App.jsx vykresli PlanSmienView PRED prihlasenim):
--       plan_smien_has_employee_pin, plan_smien_set_employee_pin,
--       plan_smien_verify_employee_pin, plan_smien_verify_admin_pin,
--       plan_smien_reset_employee_pin, plan_smien_set_admin_pin;
--   - current_role(): volaju ho RLS politiky tabulky workers, ktoru
--     planovanie cita bez prihlasenia (pre anon vracia NULL).
--   Podpisovy odkaz (?podpis=) ani kiosk dokumentov nevolaju RPC priamo -
--   len Edge Functions hr-signing / hr-kiosk (service_role).
--
--   Vsetkym ostatnym funkciam v public sa odoberie EXECUTE pre anon a PUBLIC;
--   authenticated a service_role si ponechaju presne to, co mali (explicitny
--   grant tam, kde pravo plynulo z PUBLIC). Spustanie triggrov sa nemeni
--   (EXECUTE sa pri spusteni triggra nekontroluje).
--   Nove funkcie (vytvara ich rola postgres) uz anon ani PUBLIC predvolene
--   nedostanu - verejnu funkciu treba odteraz povolit explicitne.
-- ============================================================

do $$
declare
  keep oid[] := array_remove(array[
    to_regprocedure('public.hr_onboarding_config()'),
    to_regprocedure('public.hr_onboarding_start_session(text)'),
    to_regprocedure('public.hr_onboarding_save_draft(text, jsonb)'),
    to_regprocedure('public.hr_onboarding_submit(text, text)'),
    to_regprocedure('public.plan_smien_has_employee_pin(text)'),
    to_regprocedure('public.plan_smien_set_employee_pin(text, text)'),
    to_regprocedure('public.plan_smien_verify_employee_pin(text, text)'),
    to_regprocedure('public.plan_smien_verify_admin_pin(text)'),
    to_regprocedure('public.plan_smien_reset_employee_pin(text, text)'),
    to_regprocedure('public.plan_smien_set_admin_pin(text, text)'),
    to_regprocedure('public."current_role"()')
  ]::oid[], null);
  f record;
begin
  for f in
    select p.oid, p.oid::regprocedure as sig,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_ok,
           has_function_privilege('service_role', p.oid, 'EXECUTE') as svc_ok
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
           or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0))
  loop
    if f.oid = any(keep) then
      -- verejna funkcia: anon explicitne, PUBLIC nie
      execute format('grant execute on function %s to anon', f.sig);
    else
      execute format('revoke execute on function %s from anon', f.sig);
    end if;
    if f.auth_ok then execute format('grant execute on function %s to authenticated', f.sig); end if;
    if f.svc_ok then execute format('grant execute on function %s to service_role', f.sig); end if;
    execute format('revoke execute on function %s from public', f.sig);
  end loop;
end $$;

-- nove funkcie: bez anon a PUBLIC (authenticated a service_role ostavaju z
-- predvolenych prav Supabase pre public)
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres revoke execute on functions from public;
