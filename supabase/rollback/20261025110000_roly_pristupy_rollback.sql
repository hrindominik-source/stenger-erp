-- Rollback migracie 64 (balik B: roly a pristupy). Pozor:
--   - ucty s rolou personalistika / ucetni_ext treba pred rollbackom rucne
--     prestavit (inak sa rollback zastavi) - po nom by stratili pristup;
--   - opravnenia ostanu take, ake su (podla profilu), stlpce profilu,
--     platnosti a uctu sa zmazu; prava budu opat viazane na e-mail;
--   - sablony bude opat menit HR_DOCUMENT_APPROVE, HR_EDIT bude moct mazat.
begin;

do $$
begin
  if exists (select 1 from public.profiles where role in ('personalistika', 'ucetni_ext')) then
    raise exception 'Existuji ucty s rolou personalistika/ucetni_ext - nejprve jim nastavte jinou roli.';
  end if;
end $$;

-- trvale mazanie
do $$
declare
  r record;
begin
  for r in select tablename, policyname from pg_policies where schemaname = 'public' and policyname like '%\_delete\_admin' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;
drop policy if exists profiles_hr_select on public.profiles;

-- sablony
alter policy hr_document_templates_edit on public.hr_document_templates
  using (public.hr_role_ok() and public.hr_has_permission('HR_DOCUMENT_APPROVE'))
  with check (public.hr_role_ok() and public.hr_has_permission('HR_DOCUMENT_APPROVE'));
alter policy hr_document_template_versions_edit on public.hr_document_template_versions
  using (public.hr_role_ok() and public.hr_has_permission('HR_DOCUMENT_APPROVE'))
  with check (public.hr_role_ok() and public.hr_has_permission('HR_DOCUMENT_APPROVE'));
alter policy hr_dokumenty_files_write on storage.objects
  with check (bucket_id = 'hr-dokumenty' and public.hr_role_ok() and public.hr_has_permission('HR_EDIT')
    and name not like 'prevzeti/%' and name not like 'plne-moci/%' and name not like '%/overeni-podpisu-%'
    and name not like 'zamestnanci-podpisy/%');

-- hr_role_ok() -> office (politiky aj funkcie)
do $$
declare
  r record;
  v_using text;
  v_check text;
  v_sql text;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check from pg_policies
    where coalesce(qual, '') || coalesce(with_check, '') like '%hr_role_ok()%'
  loop
    v_using := replace(r.qual, 'hr_role_ok()', '("current_role"() = ''office''::text)');
    v_check := replace(r.with_check, 'hr_role_ok()', '("current_role"() = ''office''::text)');
    v_sql := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if v_using is not null then v_sql := v_sql || ' using (' || v_using || ')'; end if;
    if v_check is not null then v_sql := v_sql || ' with check (' || v_check || ')'; end if;
    execute v_sql;
  end loop;

  for r in
    select p.oid from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname like 'hr\_%' and p.proname <> 'hr_role_ok'
      and p.prosrc like '%public.hr_role_ok()%'
  loop
    execute replace(pg_get_functiondef(r.oid), 'public.hr_role_ok()', 'public.current_role() = ''office''');
  end loop;
end $$;

create or replace function public.hr_has_permission(p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.hr_permissions
    where user_email = auth.email()
      and (p_permission = any(permissions) or 'HR_ADMIN' = any(permissions))
  );
$$;

create or replace function public.hr_get_permissions()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(
    (select permissions from public.hr_permissions where user_email = auth.email()),
    '{}'::text[]
  );
$$;

drop function if exists public.hr_my_permissions();
drop trigger if exists hr_permissions_guard on public.hr_permissions;
drop trigger if exists hr_permissions_a_link_user on public.hr_permissions;
drop function if exists public.hr_permissions_guard();
drop function if exists public.hr_permissions_link_user();
drop function if exists public.hr_profile_permissions(text);
drop index if exists public.hr_permissions_user_id_key;
alter table public.hr_permissions drop constraint if exists hr_permissions_profile_check;
alter table public.hr_permissions drop constraint if exists hr_permissions_validity_check;
alter table public.hr_permissions
  drop column if exists user_id, drop column if exists profile, drop column if exists valid_from,
  drop column if exists valid_until, drop column if exists note, drop column if exists granted_by,
  drop column if exists granted_at;

drop function if exists public.hr_role_ok();
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role = any (array['office', 'sklad', 'vyroba']));

commit;
