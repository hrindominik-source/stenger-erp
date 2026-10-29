-- Migracia 77 (rozhodnutie 2026-10-29): povinny dovod zmeny vynucuje aj DB.
-- Zmena mzdy, pozicie/druhu prace, typu a doby zmluvy, nastupu a skoncenia,
-- rodneho cisla, cisla uctu a zdravotnej poistovne bez dovodu sa odmietne.
-- Vynimka: server (service_role) a migracie / funkcie vlastnika (postgres).
--
-- Postup: aplikacia PRED ulozenim zapise dovod (hr_change_reason_begin) -
-- vznikne zaznam v hr_corrections; triggery pri zmene sledovanych poli
-- overia, ze pouzivatel zapisal dovod k tomuto zamestnancovi za poslednych
-- 5 min. Po ulozeni hr_change_reason_finish naviaze zmeny z auditu.
-- Vlozenie noveho zaznamu (novy zamestnanec / pomer) nie je zmena.

alter table public.hr_corrections add column if not exists finished_at timestamptz;

create or replace function public.hr_change_reason_begin(p_employee_id text, p_reason text, p_fields text[] default '{}')
returns text language plpgsql volatile security definer set search_path = public as $$
declare v_id text;
begin
  if not (public.hr_role_ok() and public.hr_has_permission('HR_EDIT')) then
    raise exception 'Neopravneno.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Uveďte důvod změny (alespoň 5 znaků).'; end if;
  if not exists (select 1 from public.employees where id = p_employee_id) then raise exception 'Zaměstnanec nenalezen.'; end if;
  insert into public.hr_corrections (employee_id, reason, audit_ids, created_by, fields)
  values (p_employee_id, trim(p_reason), '{}', auth.uid(), coalesce(p_fields, '{}')) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.hr_change_reason_begin(text, text, text[]) from public, anon;
grant execute on function public.hr_change_reason_begin(text, text, text[]) to authenticated;

-- Naviaze zmeny pouzivatela od zapisu dovodu (audit) k zaznamu opravy.
create or replace function public.hr_change_reason_finish(p_id text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare c public.hr_corrections; v_ids bigint[];
begin
  select * into c from public.hr_corrections where id = p_id and created_by = auth.uid() and finished_at is null for update;
  if not found then raise exception 'Záznam důvodu nenalezen.'; end if;
  select coalesce(array_agg(a.id order by a.id), '{}') into v_ids
  from public.audit_log a
  where a.changed_by = auth.uid() and a.action in ('insert', 'update', 'delete') and a.created_at >= c.created_at
    and ((a.entity in ('employees', 'employee_sensitive_data', 'employee_payroll_data') and a.entity_id = c.employee_id)
      or (a.entity = 'employment_relationships' and a.entity_id in (select id from public.employment_relationships where employee_id = c.employee_id)))
    and not exists (select 1 from public.hr_corrections x where x.employee_id = c.employee_id and a.id = any (x.audit_ids));
  update public.hr_corrections set audit_ids = v_ids, finished_at = now() where id = p_id;
end $$;
revoke all on function public.hr_change_reason_finish(text) from public, anon;
grant execute on function public.hr_change_reason_finish(text) to authenticated;

-- Je k zamestnancovi zapisany dovod tohto pouzivatela (poslednych 5 min)?
create or replace function public.hr_change_reason_present(p_employee_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.hr_corrections c
    where c.employee_id = p_employee_id and c.created_by = auth.uid() and c.created_at > now() - interval '5 minutes');
$$;
revoke all on function public.hr_change_reason_present(text) from public, anon;
-- volana z triggera v mene pouzivatela; vracia len ano/nie o jeho vlastnych dovodoch
grant execute on function public.hr_change_reason_present(text) to authenticated;

-- SECURITY INVOKER: current_user = volajuci (server/migracia = vynimka).
create or replace function public.hr_require_change_reason()
returns trigger language plpgsql set search_path = public as $$
declare v_emp text; v_changed text[] := '{}';
begin
  if public.hr_is_server_role() then return new; end if;
  if TG_TABLE_NAME = 'employees' then
    v_emp := new.id;
    if new.health_insurance_company is distinct from old.health_insurance_company then v_changed := array_append(v_changed, 'zdravotní pojišťovna'); end if;
  elsif TG_TABLE_NAME = 'employee_sensitive_data' then
    v_emp := new.employee_id;
    if new.birth_number is distinct from old.birth_number then v_changed := array_append(v_changed, 'rodné číslo'); end if;
    if new.bank_account is distinct from old.bank_account then v_changed := array_append(v_changed, 'číslo účtu'); end if;
  elsif TG_TABLE_NAME = 'employee_payroll_data' then
    v_emp := new.employee_id;
    if (new.data->'mzda_historie') is distinct from (old.data->'mzda_historie') then v_changed := array_append(v_changed, 'mzda'); end if;
  elsif TG_TABLE_NAME = 'employment_relationships' then
    v_emp := new.employee_id;
    if new.position_id is distinct from old.position_id
       or (new.data->'pozice_kategorie') is distinct from (old.data->'pozice_kategorie')
       or (new.data->'nazev_pozice') is distinct from (old.data->'nazev_pozice') then v_changed := array_append(v_changed, 'pozice'); end if;
    if new.employment_type is distinct from old.employment_type or new.fixed_term_end_date is distinct from old.fixed_term_end_date then
      v_changed := array_append(v_changed, 'typ a doba smlouvy'); end if;
    if new.start_date is distinct from old.start_date then v_changed := array_append(v_changed, 'datum nástupu'); end if;
    if new.termination_date is distinct from old.termination_date then v_changed := array_append(v_changed, 'datum skončení'); end if;
  end if;
  if cardinality(v_changed) > 0 and not public.hr_change_reason_present(v_emp) then
    raise exception 'Změna (%) vyžaduje důvod změny.', array_to_string(v_changed, ', ') using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists hr_require_change_reason on public.employees;
create trigger hr_require_change_reason before update on public.employees
  for each row execute function public.hr_require_change_reason();
drop trigger if exists hr_require_change_reason on public.employee_sensitive_data;
create trigger hr_require_change_reason before update on public.employee_sensitive_data
  for each row execute function public.hr_require_change_reason();
drop trigger if exists hr_require_change_reason on public.employee_payroll_data;
create trigger hr_require_change_reason before update on public.employee_payroll_data
  for each row execute function public.hr_require_change_reason();
drop trigger if exists hr_require_change_reason on public.employment_relationships;
create trigger hr_require_change_reason before update on public.employment_relationships
  for each row execute function public.hr_require_change_reason();
