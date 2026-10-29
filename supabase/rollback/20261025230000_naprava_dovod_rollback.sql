-- Rollback migracie 76 (ulohy napravy, polia k dovodu zmeny). Ulohy napravy
-- sa zmazu (zaznam ostava v audit_log). Vratit aj frontend.
begin;
drop function if exists public.hr_remediation_close(text, text);
drop function if exists public.hr_decide_approval(text, boolean, text, date);
create or replace function public.hr_decide_approval(p_id text, p_approve boolean, p_note text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare r public.hr_approval_requests;
begin
  if not public.hr_has_permission('HR_ADMIN') then raise exception 'Schvaluje jen jednatel.' using errcode = '42501'; end if;
  select * into r from public.hr_approval_requests where id = p_id for update;
  if not found then raise exception 'Žádost nenalezena.'; end if;
  if r.requested_by = auth.uid() then raise exception 'Vlastní žádost nelze schválit (čtyři oči).'; end if;
  if r.status not in ('PENDING', 'EMERGENCY') then raise exception 'Žádost už je vyřízena.'; end if;
  if not p_approve and length(trim(coalesce(p_note, ''))) < 3 then raise exception 'Uveďte důvod zamítnutí.'; end if;
  update public.hr_approval_requests set
    status = case when r.status = 'PENDING' then (case when p_approve then 'APPROVED' else 'REJECTED' end)
                  else (case when p_approve then 'CONFIRMED' else 'REJECTED_AFTER' end) end,
    decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_id;
  update public.hr_notifications set resolved_at = now(), read_at = coalesce(read_at, now())
  where entity = 'hr_approval_requests' and entity_id = p_id and kind = 'KE_SCHVALENI' and resolved_at is null;
end $$;
revoke all on function public.hr_decide_approval(text, boolean, text) from public, anon;
grant execute on function public.hr_decide_approval(text, boolean, text) to authenticated;
drop table if exists public.hr_remediation_tasks;

drop function if exists public.hr_record_correction(text, text, text[]);
create or replace function public.hr_record_correction(p_employee_id text, p_reason text)
returns text language plpgsql volatile security definer set search_path = public as $$
declare v_id text; v_ids bigint[];
begin
  if not (public.hr_role_ok() and public.hr_has_permission('HR_EDIT')) then
    raise exception 'Neopravneno.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Uveďte důvod změny.'; end if;
  select coalesce(array_agg(a.id order by a.id), '{}') into v_ids
  from public.audit_log a
  where a.changed_by = auth.uid() and a.action in ('insert', 'update', 'delete') and a.created_at > now() - interval '5 minutes'
    and ((a.entity in ('employees', 'employee_sensitive_data', 'employee_payroll_data') and a.entity_id = p_employee_id)
      or (a.entity = 'employment_relationships' and a.entity_id in (select id from public.employment_relationships where employee_id = p_employee_id)))
    and not exists (select 1 from public.hr_corrections c where c.employee_id = p_employee_id and a.id = any (c.audit_ids));
  insert into public.hr_corrections (employee_id, reason, audit_ids, created_by)
  values (p_employee_id, trim(p_reason), v_ids, auth.uid()) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.hr_record_correction(text, text) from public, anon;
grant execute on function public.hr_record_correction(text, text) to authenticated;
alter table public.hr_corrections drop column if exists fields;
commit;
