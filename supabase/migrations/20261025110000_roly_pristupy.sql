-- ============================================================
-- 64. Balik B z auditu Personalistiky (docs/audit/03): roly a oddelenie
--     pristupov.
--   - Nove roly uctu (profiles.role): 'personalistika' (personalistka) a
--     'ucetni_ext' (externa uctovnicka). Obe vidia len Personalistiku -
--     politiky zvysku ERP ostavaju na 'office', takze objednavky, cenniky,
--     zakaznikov ani firmu nevidia. HR politiky a funkcie prijimaju
--     public.hr_role_ok() = office | personalistika | ucetni_ext.
--   - hr_permissions: profil (KONATEL / PERSONALISTA / UCTOVNIK_EXT / VLASTNI),
--     vazba na ucet (user_id - zmena e-mailu neprenesie prava), platnost
--     od-do (UCTOVNIK_EXT povinne "do"), kto a kedy pridelil. Opravnenia
--     profilu nastavuje DB, nie prehliadac. VLASTNI = vynimka s dovodom,
--     bez HR_ADMIN.
--   - HR_TEMPLATE_APPROVE: sablony dokumentov (aj subory sablony/) uz nie su
--     pod HR_DOCUMENT_APPROVE (to ostava len pre posun stavu dokumentu).
--   - Trvale mazanie riadkov HR tabuliek len HR_ADMIN (audit S-05) -
--     restriktivna politika DELETE; bezna praca nic nemaze.
-- ============================================================

-- ---------- roly uctu ----------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role = any (array['office', 'sklad', 'vyroba', 'personalistika', 'ucetni_ext']));

create or replace function public.hr_role_ok()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role() in ('office', 'personalistika', 'ucetni_ext'), false);
$$;
revoke execute on function public.hr_role_ok() from public, anon;
grant execute on function public.hr_role_ok() to authenticated, service_role;

-- ---------- hr_permissions: profil, ucet, platnost ----------
alter table public.hr_permissions
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists profile text,
  add column if not exists valid_from date,
  add column if not exists valid_until date,
  add column if not exists note text,
  add column if not exists granted_by uuid,
  add column if not exists granted_at timestamptz;

update public.hr_permissions p set user_id = u.id
  from auth.users u where p.user_id is null and lower(u.email) = lower(p.user_email);
update public.hr_permissions
  set profile = case when 'HR_ADMIN' = any(permissions) then 'KONATEL' else 'VLASTNI' end,
      note = case when 'HR_ADMIN' = any(permissions) then note else coalesce(note, 'Převzato z předchozího nastavení – zkontrolovat a přiřadit profil.') end
  where profile is null;
alter table public.hr_permissions alter column profile set default 'VLASTNI';
alter table public.hr_permissions alter column profile set not null;
alter table public.hr_permissions add constraint hr_permissions_profile_check
  check (profile in ('KONATEL', 'PERSONALISTA', 'UCTOVNIK_EXT', 'VLASTNI'));
alter table public.hr_permissions add constraint hr_permissions_validity_check
  check (valid_until is null or valid_from is null or valid_until >= valid_from);
create unique index if not exists hr_permissions_user_id_key on public.hr_permissions (user_id) where user_id is not null;

-- Opravnenia profilov (jedine miesto pravdy - UI ich len zobrazuje).
create or replace function public.hr_profile_permissions(p_profile text)
returns text[] language sql immutable set search_path = public as $$
  select case p_profile
    when 'KONATEL' then array['HR_ADMIN']
    when 'PERSONALISTA' then array['HR_VIEW_BASIC', 'HR_VIEW_SENSITIVE', 'HR_VIEW_PAYROLL', 'HR_VIEW_MEDICAL_ADMIN',
      'HR_EDIT', 'HR_DOCUMENT_GENERATE', 'HR_DOCUMENT_APPROVE', 'HR_DOCUMENT_SIGN', 'HR_SIGN_FOR_EMPLOYER',
      'HR_DOCUMENT_SEND', 'HR_DOCUMENT_VOID']
    when 'UCTOVNIK_EXT' then array['HR_VIEW_BASIC', 'HR_VIEW_SENSITIVE', 'HR_VIEW_PAYROLL', 'HR_EXEKUCE']
  end;
$$;
grant execute on function public.hr_profile_permissions(text) to authenticated, service_role;

-- Naviazanie na ucet podla e-mailu (SECURITY DEFINER - auth.users nie je
-- citatelna pre pouzivatelov); spusta sa pred hr_permissions_guard (abeceda).
create or replace function public.hr_permissions_link_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.user_email := lower(trim(new.user_email));
  if new.user_id is null then
    select id into new.user_id from auth.users where lower(email) = new.user_email limit 1;
  end if;
  return new;
end;
$$;
revoke execute on function public.hr_permissions_link_user() from public, anon, authenticated;
drop trigger if exists hr_permissions_a_link_user on public.hr_permissions;
create trigger hr_permissions_a_link_user before insert or update on public.hr_permissions
  for each row execute function public.hr_permissions_link_user();

-- SECURITY INVOKER: current_user = 'authenticated' znamena zmenu z aplikacie
create or replace function public.hr_permissions_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  new.profile := coalesce(new.profile, 'VLASTNI');
  if new.profile <> 'VLASTNI' then
    new.permissions := public.hr_profile_permissions(new.profile);
  end if;
  -- pravidla pre zmeny z aplikacie (migracie a testy ako postgres ich obchadzaju)
  if current_user = 'authenticated' then
    if new.profile = 'VLASTNI' and 'HR_ADMIN' = any(new.permissions) then
      raise exception 'HR_ADMIN lze přidělit jen profilem Jednatel.';
    end if;
    if new.profile = 'VLASTNI' and coalesce(trim(new.note), '') = '' then
      raise exception 'U vlastního nastavení oprávnění uveďte důvod.';
    end if;
    if new.profile = 'UCTOVNIK_EXT' and new.valid_until is null then
      raise exception 'Externí účetní musí mít datum konce přístupu.';
    end if;
  end if;
  if TG_OP = 'INSERT' or new.permissions is distinct from old.permissions or new.profile is distinct from old.profile
     or new.valid_from is distinct from old.valid_from or new.valid_until is distinct from old.valid_until
     or new.user_id is distinct from old.user_id or new.user_email is distinct from old.user_email then
    new.granted_by := auth.uid();
    new.granted_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists hr_permissions_guard on public.hr_permissions;
create trigger hr_permissions_guard before insert or update on public.hr_permissions
  for each row execute function public.hr_permissions_guard();

-- Riadok opravneni aktualneho pouzivatela: podla uctu; podla e-mailu len
-- kym riadok nie je naviazany na ucet. Mimo platnosti = ziadne prava.
create or replace function public.hr_my_permissions()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.permissions from public.hr_permissions p
    where (p.user_id = auth.uid() or (p.user_id is null and p.user_email = lower(auth.email())))
      and (p.valid_from is null or p.valid_from <= current_date)
      and (p.valid_until is null or p.valid_until >= current_date)
    order by (p.user_id = auth.uid()) desc nulls last
    limit 1), '{}'::text[]);
$$;
revoke execute on function public.hr_my_permissions() from public, anon;
grant execute on function public.hr_my_permissions() to authenticated, service_role;

create or replace function public.hr_has_permission(p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_permission = any(public.hr_my_permissions()) or 'HR_ADMIN' = any(public.hr_my_permissions());
$$;

create or replace function public.hr_get_permissions()
returns text[] language sql stable security definer set search_path = public as $$
  select public.hr_my_permissions();
$$;

-- ---------- HR politiky a funkcie: office -> hr_role_ok() ----------
do $$
declare
  r record;
  v_using text;
  v_check text;
  v_sql text;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check from pg_policies
    where coalesce(qual, '') || coalesce(with_check, '') like '%hr_has_permission%'
      and coalesce(qual, '') || coalesce(with_check, '') like '%"current_role"() = ''office''::text%'
  loop
    v_using := replace(r.qual, '("current_role"() = ''office''::text)', 'public.hr_role_ok()');
    v_check := replace(r.with_check, '("current_role"() = ''office''::text)', 'public.hr_role_ok()');
    v_sql := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if v_using is not null then v_sql := v_sql || ' using (' || v_using || ')'; end if;
    if v_check is not null then v_sql := v_sql || ' with check (' || v_check || ')'; end if;
    execute v_sql;
  end loop;

  for r in
    select p.oid from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname like 'hr\_%'
      and p.prosrc like '%public.current_role() = ''office''%'
  loop
    execute replace(pg_get_functiondef(r.oid), 'public.current_role() = ''office''', 'public.hr_role_ok()');
  end loop;
end $$;

-- zoznam uctov (mena v historii podpisov, vyber osoby s plnou mocou)
drop policy if exists profiles_hr_select on public.profiles;
create policy profiles_hr_select on public.profiles for select
  using (public.hr_role_ok() and public.hr_has_permission('HR_VIEW_BASIC'));

-- ---------- sablony: HR_TEMPLATE_APPROVE ----------
alter policy hr_document_templates_edit on public.hr_document_templates
  using (public.hr_role_ok() and public.hr_has_permission('HR_TEMPLATE_APPROVE'))
  with check (public.hr_role_ok() and public.hr_has_permission('HR_TEMPLATE_APPROVE'));
alter policy hr_document_template_versions_edit on public.hr_document_template_versions
  using (public.hr_role_ok() and public.hr_has_permission('HR_TEMPLATE_APPROVE'))
  with check (public.hr_role_ok() and public.hr_has_permission('HR_TEMPLATE_APPROVE'));
alter policy hr_dokumenty_files_write on storage.objects
  with check (bucket_id = 'hr-dokumenty' and public.hr_role_ok() and public.hr_has_permission('HR_EDIT')
    and name not like 'prevzeti/%' and name not like 'plne-moci/%' and name not like '%/overeni-podpisu-%'
    and name not like 'zamestnanci-podpisy/%'
    and (name not like 'sablony/%' or public.hr_has_permission('HR_TEMPLATE_APPROVE')
      -- doplnenie suboru aktualnej schvalenej verzie pri prvom pouziti (psTemplates.js);
      -- obsah sa pri kazdom nacitani overuje otlackom verzie, prepis nie je mozny
      or exists (select 1 from public.hr_document_templates t
        join public.hr_document_template_versions v on v.id = t.current_version_id
        where t.status = 'SCHVALENA' and v.file_path = objects.name)));

-- ---------- trvale mazanie len HR_ADMIN (S-05) ----------
do $$
declare
  t text;
begin
  foreach t in array array['employees', 'employee_sensitive_data', 'employee_payroll_data', 'medical_examinations',
    'employment_relationships', 'employment_terms_versions', 'employment_contract_events', 'employee_timeline_events',
    'employee_contact_declarations', 'employee_garnishment_documents', 'hr_training_records', 'positions',
    'hr_permissions', 'hr_signatories']
  loop
    -- len tam, kde nejaka politika mazanie povoluje (ALL/DELETE)
    if to_regclass('public.' || t) is not null and exists (select 1 from pg_policies
        where schemaname = 'public' and tablename = t and cmd in ('ALL', 'DELETE') and permissive = 'PERMISSIVE') then
      execute format('drop policy if exists %I on public.%I', t || '_delete_admin', t);
      execute format('create policy %I on public.%I as restrictive for delete using (public.hr_has_permission(''HR_ADMIN''))',
        t || '_delete_admin', t);
    end if;
  end loop;
end $$;
