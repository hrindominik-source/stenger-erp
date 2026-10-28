-- Migracia 68: zaznam o citani citlivych udajov (audit Personalistiky).
-- Citlive udaje (rodne cislo, doklad, ucet, cudzinec) a mzdove udaje uz
-- prihlaseny pouzivatel nema priamo citat z tabuliek - len cez funkcie nizsie,
-- ktore kazde citanie zapisu do nemenneho audit_log (action = 'read': kto,
-- koho, ucel). Zapis (insert/upsert) ostava ako doteraz, s povodnymi pravami.
-- Citania serverom (service role, generovanie PDF) sa nezapisuju - nie je to
-- citanie clovekom.

-- ---------- audit: nova akcia 'read' ----------
alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action = any (array['insert', 'update', 'delete', 'read']));

-- ---------- priame citanie zakazane, okrem kluca (potrebny pre upsert) ----------
revoke select on public.employee_sensitive_data from authenticated, anon;
revoke select on public.employee_payroll_data from authenticated, anon;
grant select (employee_id, created_at, updated_at) on public.employee_sensitive_data to authenticated;
grant select (employee_id, created_at, updated_at) on public.employee_payroll_data to authenticated;

-- To iste citanie toho isteho pouzivatela do 10 s (dvojite nacitanie jednej
-- obrazovky) sa zapise raz; subezne volania zoradi zamok.
create or replace function public.hr_log_read(p_entity text, p_entity_id text, p_purpose text, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('hr_log_read|' || coalesce(auth.uid()::text, '') || '|' || p_entity || '|' || p_entity_id || '|' || p_purpose));
  if exists (select 1 from public.audit_log a where a.action = 'read' and a.changed_by is not distinct from auth.uid()
      and a.entity = p_entity and a.entity_id = p_entity_id and a.new_value->>'purpose' = p_purpose
      and a.created_at > clock_timestamp() - interval '10 seconds') then
    return;
  end if;
  insert into public.audit_log (entity, entity_id, action, new_value, changed_by, changed_by_role, source, created_at)
  values (p_entity, p_entity_id, 'read', jsonb_build_object('purpose', p_purpose) || coalesce(p_detail, '{}'::jsonb),
    auth.uid(), public.current_role(), 'user', clock_timestamp());
end $$;
revoke all on function public.hr_log_read(text, text, text, jsonb) from public, anon, authenticated;

-- ucel: 'detail' (karta zamestnanca), 'edit' (nacitanie pred ulozenim zmeny)
create or replace function public.hr_read_sensitive(p_employee_id text, p_purpose text default 'detail')
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v jsonb;
begin
  if not (public.hr_role_ok() and public.hr_has_permission('HR_VIEW_SENSITIVE')) then
    raise exception 'Neopravneno: citlive udaje.' using errcode = '42501';
  end if;
  if p_purpose not in ('detail', 'edit') then raise exception 'Neznamy ucel citania.'; end if;
  select to_jsonb(s) into v from public.employee_sensitive_data s where s.employee_id = p_employee_id;
  perform public.hr_log_read('employee_sensitive_data', p_employee_id, p_purpose, jsonb_build_object('found', v is not null));
  return v;
end $$;

create or replace function public.hr_read_payroll(p_employee_id text, p_purpose text default 'detail')
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v jsonb;
begin
  if not (public.hr_role_ok() and public.hr_has_permission('HR_VIEW_PAYROLL')) then
    raise exception 'Neopravneno: mzdove udaje.' using errcode = '42501';
  end if;
  if p_purpose not in ('detail', 'edit') then raise exception 'Neznamy ucel citania.'; end if;
  select to_jsonb(p) into v from public.employee_payroll_data p where p.employee_id = p_employee_id;
  perform public.hr_log_read('employee_payroll_data', p_employee_id, p_purpose, jsonb_build_object('found', v is not null));
  return v;
end $$;

-- Prehled (danove upozornenia): viac zamestnancov naraz, jeden zaznam so zoznamom.
create or replace function public.hr_read_payroll_overview(p_employee_ids text[])
returns table (employee_id text, dependents jsonb, tax_declaration jsonb, data jsonb)
language plpgsql volatile security definer set search_path = public as $$
begin
  if not (public.hr_role_ok() and public.hr_has_permission('HR_VIEW_PAYROLL')) then
    raise exception 'Neopravneno: mzdove udaje.' using errcode = '42501';
  end if;
  perform public.hr_log_read('employee_payroll_data', '*', 'overview',
    jsonb_build_object('employee_ids', to_jsonb(coalesce(p_employee_ids, '{}'::text[]))));
  return query select p.employee_id, to_jsonb(p.dependents), to_jsonb(p.tax_declaration), p.data
    from public.employee_payroll_data p where p.employee_id = any (p_employee_ids);
end $$;

revoke all on function public.hr_read_sensitive(text, text) from public, anon;
revoke all on function public.hr_read_payroll(text, text) from public, anon;
revoke all on function public.hr_read_payroll_overview(text[]) from public, anon;
grant execute on function public.hr_read_sensitive(text, text) to authenticated;
grant execute on function public.hr_read_payroll(text, text) to authenticated;
grant execute on function public.hr_read_payroll_overview(text[]) to authenticated;
