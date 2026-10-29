-- Migracia 76: rozhodnutia 2026-10-29.
-- 1. Dodatocne zamietnuty nudzovy krok (REJECTED_AFTER): dokument ostava
--    platny (nezneplatnuje sa), dostane vyrazne oznacenie "Zamítnuto
--    jednatelem – vyžaduje nápravu" a vznikne otvorena uloha s terminom v
--    prehlade jednatela, kym ju jednatel neuzavrie s popisom napravy.
-- 2. Dovod zmeny v Karte: k zaznamu opravy sa ukladaju aj zmenene polia
--    (povinnost dovodu pri vybranych poliach kontroluje aplikacia).

-- ---------- 1. uloha napravy ----------
create table if not exists public.hr_remediation_tasks (
  id text primary key default gen_random_uuid()::text,
  approval_id text not null unique references public.hr_approval_requests(id),
  kind text not null,
  entity text not null,
  entity_id text not null,
  employee_id text references public.employees(id) on delete set null,
  document_id text references public.hr_documents(id) on delete set null,
  title text not null,
  rejection_reason text,
  due_date date not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  resolution text,
  check (status = 'OPEN' or length(trim(coalesce(resolution, ''))) >= 5)
);
create index if not exists hr_remediation_tasks_document on public.hr_remediation_tasks (document_id);
alter table public.hr_remediation_tasks enable row level security;
revoke all on public.hr_remediation_tasks from anon, authenticated;
grant select on public.hr_remediation_tasks to authenticated;
-- oznacenie dokumentu vidi aj personalistka (napravu pripravuje ona)
create policy hr_remediation_tasks_select on public.hr_remediation_tasks for select
  using (public.hr_role_ok() and (public.hr_has_permission('HR_ADMIN') or public.hr_has_permission('HR_EDIT')));
drop trigger if exists audit_hr_remediation_tasks on public.hr_remediation_tasks;
create trigger audit_hr_remediation_tasks after insert or update on public.hr_remediation_tasks
  for each row execute function public.audit_trigger();

drop function if exists public.hr_decide_approval(text, boolean, text);
create or replace function public.hr_decide_approval(p_id text, p_approve boolean, p_note text default null, p_remedy_due date default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare r public.hr_approval_requests; v_task text; v_due date;
begin
  if not public.hr_has_permission('HR_ADMIN') then raise exception 'Schvaluje jen jednatel.' using errcode = '42501'; end if;
  select * into r from public.hr_approval_requests where id = p_id for update;
  if not found then raise exception 'Žádost nenalezena.'; end if;
  if r.requested_by = auth.uid() then raise exception 'Vlastní žádost nelze schválit (čtyři oči).'; end if;
  if r.status not in ('PENDING', 'EMERGENCY') then raise exception 'Žádost už je vyřízena.'; end if;
  if not p_approve and length(trim(coalesce(p_note, ''))) < 3 then raise exception 'Uveďte důvod zamítnutí.'; end if;
  if p_remedy_due is not null and p_remedy_due < current_date then raise exception 'Termín nápravy nemůže být v minulosti.'; end if;
  update public.hr_approval_requests set
    status = case when r.status = 'PENDING' then (case when p_approve then 'APPROVED' else 'REJECTED' end)
                  else (case when p_approve then 'CONFIRMED' else 'REJECTED_AFTER' end) end,
    decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_id;
  update public.hr_notifications set resolved_at = now(), read_at = coalesce(read_at, now())
  where entity = 'hr_approval_requests' and entity_id = p_id and kind = 'KE_SCHVALENI' and resolved_at is null;

  -- nudzovy krok uz prebehol: nic sa nevracia, vznikne uloha napravy
  if r.status = 'EMERGENCY' and not p_approve then
    v_due := coalesce(p_remedy_due, current_date + 14);
    insert into public.hr_remediation_tasks (approval_id, kind, entity, entity_id, employee_id, document_id, title, rejection_reason, due_date, created_by)
    values (r.id, r.kind, r.entity, r.entity_id, r.employee_id, case when r.entity = 'hr_documents' then r.entity_id end,
      public.hr_approval_kind_label(r.kind) || ' – zamítnuto jednatelem, vyžaduje nápravu', trim(p_note), v_due, auth.uid())
    returning id into v_task;
    perform public.hr_notify('REMEDIATION_REQUIRED', 'KE_SCHVALENI',
      'Náprava do ' || to_char(v_due, 'DD.MM.YYYY') || ': ' || public.hr_approval_kind_label(r.kind) || ' (nouzový postup zamítnut)',
      'hr_remediation_tasks', v_task, r.employee_id, jsonb_build_object('approval_id', r.id, 'due_date', v_due, 'reason', trim(p_note)));
  end if;
end $$;
revoke all on function public.hr_decide_approval(text, boolean, text, date) from public, anon;
grant execute on function public.hr_decide_approval(text, boolean, text, date) to authenticated;

create or replace function public.hr_remediation_close(p_id text, p_resolution text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.hr_has_permission('HR_ADMIN') then raise exception 'Nápravu uzavírá jednatel.' using errcode = '42501'; end if;
  if length(trim(coalesce(p_resolution, ''))) < 5 then raise exception 'Popište, jak byla náprava provedena (alespoň 5 znaků).'; end if;
  update public.hr_remediation_tasks set status = 'CLOSED', closed_by = auth.uid(), closed_at = now(), resolution = trim(p_resolution)
  where id = p_id and status = 'OPEN';
  if not found then raise exception 'Úkol nenalezen nebo už je uzavřen.'; end if;
  update public.hr_notifications set resolved_at = now(), read_at = coalesce(read_at, now())
  where entity = 'hr_remediation_tasks' and entity_id = p_id and resolved_at is null;
end $$;
revoke all on function public.hr_remediation_close(text, text) from public, anon;
grant execute on function public.hr_remediation_close(text, text) to authenticated;

-- ---------- 2. dovod zmeny - zmenene polia ----------
alter table public.hr_corrections add column if not exists fields text[] not null default '{}';

drop function if exists public.hr_record_correction(text, text);
create or replace function public.hr_record_correction(p_employee_id text, p_reason text, p_fields text[] default '{}')
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
  insert into public.hr_corrections (employee_id, reason, audit_ids, created_by, fields)
  values (p_employee_id, trim(p_reason), v_ids, auth.uid(), coalesce(p_fields, '{}')) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.hr_record_correction(text, text, text[]) from public, anon;
grant execute on function public.hr_record_correction(text, text, text[]) to authenticated;
