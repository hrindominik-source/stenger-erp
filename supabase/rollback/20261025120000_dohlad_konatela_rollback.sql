-- Rollback migracie 65 (balik A: stopa a prehlad pre jednatela). Pozor:
--   - upozornenia (hr_notifications) sa zmazu;
--   - auditne zaznamy ostanu (aj so zdrojom server/kiosk - kontrola zdroja
--     sa vrati ako NOT VALID, existujuce riadky sa nemenia);
--   - cely audit bude opat vidiet len HR_ADMIN (povodny pevny e-mail sa
--     nevracia - aplikacia ho uz nepouziva).
begin;

drop trigger if exists hr_notify_documents on public.hr_documents;
drop trigger if exists hr_notify_wage on public.employee_payroll_data;
drop trigger if exists hr_notify_template_versions on public.hr_document_template_versions;
drop trigger if exists hr_notify_legal_texts on public.hr_legal_text_versions;
drop trigger if exists hr_notify_permissions on public.hr_permissions;
drop trigger if exists hr_notify_profiles on public.profiles;
drop trigger if exists hr_notify_signatories on public.hr_signatories;
drop trigger if exists hr_notify_settings on public.hr_settings;
drop trigger if exists hr_notify_employee_deleted on public.employees;
drop trigger if exists hr_notify_deliveries on public.hr_document_deliveries;
drop function if exists public.hr_notify_documents();
drop function if exists public.hr_notify_wage();
drop function if exists public.hr_notify_templates();
drop function if exists public.hr_notify_admin_changes();
drop function if exists public.hr_notify(text, text, text, text, text, text, jsonb, uuid);
drop function if exists public.hr_employee_name(text);
drop function if exists public.hr_konatel_summary(int);
drop table if exists public.hr_notifications;
drop function if exists public.hr_notifications_guard();
delete from public.hr_settings where key = 'konatel_summary';

drop trigger if exists audit_onboarding_status on public.onboarding_sessions;
drop function if exists public.audit_onboarding_status();
drop trigger if exists audit_hr_permissions on public.hr_permissions;
drop trigger if exists audit_profiles on public.profiles;
drop trigger if exists audit_hr_kiosk_unlocks on public.hr_kiosk_unlocks;
drop trigger if exists audit_hr_signing_tokens on public.hr_signing_tokens;

drop trigger if exists audit_log_immutable on public.audit_log;
drop trigger if exists audit_log_no_truncate on public.audit_log;
drop function if exists public.audit_log_immutable();
grant update, delete, truncate on public.audit_log to service_role;

create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rec record;
  rec_json jsonb;
  rec_id text;
begin
  rec := coalesce(NEW, OLD);
  rec_json := to_jsonb(rec);
  rec_id := coalesce(rec_json->>'id', rec_json->>'employee_id', 'unknown');
  insert into public.audit_log (entity, entity_id, action, old_value, new_value, changed_by, changed_by_role, source)
  values (
    TG_TABLE_NAME,
    rec_id,
    lower(TG_OP),
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(OLD) else null end,
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(NEW) else null end,
    auth.uid(),
    public.current_role(),
    case when auth.uid() is null then 'automation' else 'user' end
  );
  return rec;
end;
$$;
drop function if exists public.audit_actor(jsonb);

alter table public.audit_log drop constraint if exists audit_log_source_check;
alter table public.audit_log add constraint audit_log_source_check
  check (source = any (array['user', 'automation', 'ai', 'integration'])) not valid;

drop policy if exists audit_log_office_select on public.audit_log;
create policy audit_log_office_select on public.audit_log for select using (
  public.hr_role_ok() and (
    (public.current_role() = 'office' and public.hr_has_permission('HR_ADMIN'))
    or (public.hr_has_permission('HR_AUDIT_VIEW') and entity = any (array['employees', 'employee_sensitive_data',
      'employee_payroll_data', 'positions', 'employment_relationships', 'employment_terms_versions',
      'employment_contract_events', 'medical_examinations', 'hr_document_templates', 'hr_document_template_versions',
      'hr_documents', 'hr_document_signatures']))));

commit;
