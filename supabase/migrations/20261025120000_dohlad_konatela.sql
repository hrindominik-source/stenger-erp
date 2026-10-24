-- ============================================================
-- 65. Balik A z auditu Personalistiky (docs/audit/03): stopa a prehlad
--     pre konatela.
--   - audit_log: autor aj pri zapisoch servera (z doménových stlpcov
--     created_by / uploaded_by ...), nemenny (UPDATE/DELETE/TRUNCATE
--     zakazane), novo auditovane opravnenia, ucty, odomknutia kiosku a stav
--     nastupnych relacii (bez obsahu dotaznika).
--   - Pristup k auditu: cely log HR_ADMIN (namiesto pevne zadaneho e-mailu),
--     HR_AUDIT_VIEW len entity, ku ktorym ma aj pravo na udaje (audit G-03).
--   - hr_notifications: udalosti pre konatela, "na vedomie" / "vyzaduje
--     schvalenie"; plnia ich triggre, citat a oznacovat smie len HR_ADMIN.
--   - hr_konatel_summary(): podklad pre prehlad a tyzdenny suhrn (e-mail sa
--     zapne nastavenim konatel_summary.email_enabled po vybere poskytovatela).
-- ============================================================

-- ---------- autor zmeny aj pri zapisoch servera ----------
alter table public.audit_log drop constraint if exists audit_log_source_check;
alter table public.audit_log add constraint audit_log_source_check
  check (source = any (array['user', 'automation', 'ai', 'integration', 'server', 'kiosk']));
create or replace function public.audit_actor(p_row jsonb)
returns uuid language plpgsql immutable set search_path = public as $$
declare
  k text;
  v text;
begin
  foreach k in array array['created_by', 'uploaded_by', 'handed_over_by', 'finalized_by', 'generated_by',
    'issued_by', 'reviewed_by', 'approved_by', 'granted_by', 'signed_by_user_id', 'verified_by']
  loop
    v := p_row->>k;
    if v ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return v::uuid;
    end if;
  end loop;
  return null;
end;
$$;

create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rec record;
  rec_json jsonb;
  rec_id text;
  v_actor uuid;
  v_skip text[];
begin
  rec := coalesce(NEW, OLD);
  rec_json := to_jsonb(rec);
  -- argumenty triggera = stlpce, ktore sa do auditu nezapisuju (haše kodov)
  v_skip := coalesce(TG_ARGV::text[], '{}');
  -- Vacsina auditovanych tabuliek ma "id" ako primarny kluc, ale
  -- employee_sensitive_data (Personalistika) ma primarny kluc "employee_id".
  rec_id := coalesce(rec_json->>'id', rec_json->>'employee_id', 'unknown');
  -- Zapis servera (service role) nema auth.uid() - autor sa vezme z riadku.
  v_actor := coalesce(auth.uid(), public.audit_actor(rec_json));
  insert into public.audit_log (entity, entity_id, action, old_value, new_value, changed_by, changed_by_role, source)
  values (
    TG_TABLE_NAME,
    rec_id,
    lower(TG_OP),
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(OLD) - v_skip else null end,
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(NEW) - v_skip else null end,
    v_actor,
    public.current_role(),
    case when auth.uid() is not null then 'user' when v_actor is not null then 'server' else 'automation' end
  );
  return rec;
end;
$$;

-- ---------- nemenny audit ----------
create or replace function public.audit_log_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Auditni zaznam nelze menit ani mazat.';
end;
$$;
drop trigger if exists audit_log_immutable on public.audit_log;
create trigger audit_log_immutable before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();
drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_immutable();
revoke update, delete, truncate on public.audit_log from anon, authenticated, service_role;

-- ---------- nove auditovane tabulky ----------
do $$
declare
  t text;
begin
  foreach t in array array['hr_permissions', 'profiles'] loop
    execute format('drop trigger if exists %I on public.%I', 'audit_' || t, t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_trigger()', 'audit_' || t, t);
  end loop;
end $$;
-- vydanie / pouzitie / zrusenie kodov - bez hašov kodov
drop trigger if exists audit_hr_kiosk_unlocks on public.hr_kiosk_unlocks;
create trigger audit_hr_kiosk_unlocks after insert or update or delete on public.hr_kiosk_unlocks
  for each row execute function public.audit_trigger('code_sha256');
drop trigger if exists audit_hr_signing_tokens on public.hr_signing_tokens;
create trigger audit_hr_signing_tokens after insert or update or delete on public.hr_signing_tokens
  for each row execute function public.audit_trigger('token_sha256', 'pairing_code_sha256');

-- nastupna relacia: len stav, nie obsah dotaznika (citlive udaje)
create or replace function public.audit_onboarding_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' or new.status is distinct from old.status then
    insert into public.audit_log (entity, entity_id, action, old_value, new_value, changed_by, changed_by_role, source)
    values ('onboarding_sessions', new.id, lower(TG_OP),
      case when TG_OP = 'UPDATE' then jsonb_build_object('status', old.status) end,
      jsonb_build_object('status', new.status, 'signing_mode', new.signing_mode, 'resulting_employee_id', new.resulting_employee_id,
        'unlock_id', new.unlock_id),
      auth.uid(), public.current_role(), case when auth.uid() is null then 'kiosk' else 'user' end);
  end if;
  return new;
end;
$$;
drop trigger if exists audit_onboarding_status on public.onboarding_sessions;
create trigger audit_onboarding_status after insert or update on public.onboarding_sessions
  for each row execute function public.audit_onboarding_status();

-- ---------- pristup k auditu ----------
drop policy if exists audit_log_office_select on public.audit_log;
create policy audit_log_office_select on public.audit_log for select using (
  public.hr_role_ok() and (
    (public.current_role() = 'office' and public.hr_has_permission('HR_ADMIN'))
    or (public.hr_has_permission('HR_AUDIT_VIEW') and (
      entity = any (array['employees', 'positions', 'employment_relationships', 'employment_terms_versions',
        'employment_contract_events', 'hr_document_templates', 'hr_document_template_versions', 'hr_documents',
        'hr_document_signatures'])
      or (entity = 'employee_sensitive_data' and public.hr_has_permission('HR_VIEW_SENSITIVE'))
      or (entity = 'employee_payroll_data' and public.hr_has_permission('HR_VIEW_PAYROLL'))
      or (entity = 'medical_examinations' and public.hr_has_permission('HR_VIEW_MEDICAL_ADMIN'))))));

-- ---------- upozornenia pre konatela ----------
create table if not exists public.hr_notifications (
  id text primary key default 'ntf-' || replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  event_type text not null,
  kind text not null check (kind in ('NA_VEDOMI', 'KE_SCHVALENI')),
  title text not null,
  entity text,
  entity_id text,
  employee_id text,
  actor_id uuid,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  read_by uuid,
  resolved_at timestamptz,
  resolved_by uuid
);
create index if not exists hr_notifications_open_idx on public.hr_notifications (created_at desc) where read_at is null or (kind = 'KE_SCHVALENI' and resolved_at is null);
alter table public.hr_notifications enable row level security;
revoke all on public.hr_notifications from anon;
revoke insert, delete, truncate on public.hr_notifications from authenticated;
drop policy if exists hr_notifications_admin_select on public.hr_notifications;
create policy hr_notifications_admin_select on public.hr_notifications for select
  using (public.hr_role_ok() and public.hr_has_permission('HR_ADMIN'));
drop policy if exists hr_notifications_admin_update on public.hr_notifications;
create policy hr_notifications_admin_update on public.hr_notifications for update
  using (public.hr_role_ok() and public.hr_has_permission('HR_ADMIN'))
  with check (public.hr_role_ok() and public.hr_has_permission('HR_ADMIN'));

-- Konatel smie len oznacit precitane / vyriesene; obsah upozornenia je nemenny.
create or replace function public.hr_notifications_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'Upozorneni se nemazou.';
  end if;
  if (to_jsonb(new) - array['read_at', 'read_by', 'resolved_at', 'resolved_by'])
     is distinct from (to_jsonb(old) - array['read_at', 'read_by', 'resolved_at', 'resolved_by']) then
    raise exception 'Obsah upozorneni nelze menit.';
  end if;
  if new.read_at is not null and old.read_at is null then
    new.read_by := auth.uid();
    new.read_at := now();
  end if;
  if new.resolved_at is not null and old.resolved_at is null then
    new.resolved_by := auth.uid();
    new.resolved_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists hr_notifications_guard on public.hr_notifications;
create trigger hr_notifications_guard before update or delete on public.hr_notifications
  for each row execute function public.hr_notifications_guard();
alter table public.hr_notifications add constraint hr_notifications_resolve_check
  check (resolved_at is null or kind = 'KE_SCHVALENI');

-- Zapis upozornenia. Krok, ktory urobil sam konatel (HR_ADMIN), sa zapise
-- ako uz precitany - v historii je, ale nepripomina sa.
create or replace function public.hr_notify(p_event text, p_kind text, p_title text, p_entity text, p_entity_id text,
  p_employee_id text, p_data jsonb default '{}'::jsonb, p_actor uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := coalesce(auth.uid(), p_actor);
  v_self boolean := auth.uid() is not null and public.hr_has_permission('HR_ADMIN') and p_kind = 'NA_VEDOMI';
begin
  insert into public.hr_notifications (event_type, kind, title, entity, entity_id, employee_id, actor_id, data, read_at, read_by)
  values (p_event, p_kind, p_title, p_entity, p_entity_id, p_employee_id, v_actor, coalesce(p_data, '{}'::jsonb),
    case when v_self then now() end, case when v_self then auth.uid() end);
end;
$$;
revoke execute on function public.hr_notify(text, text, text, text, text, text, jsonb, uuid) from public, anon, authenticated;

create or replace function public.hr_employee_name(p_employee_id text)
returns text language sql stable security definer set search_path = public as $$
  select nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '') from public.employees where id = p_employee_id;
$$;
revoke execute on function public.hr_employee_name(text) from public, anon, authenticated;

-- dokumenty: podpisana zmluva / jednostranny ukon, zneplatnenie
create or replace function public.hr_notify_documents()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_who text := coalesce(public.hr_employee_name(new.employee_id), 'nástup z kiosku');
begin
  if new.status = 'SIGNED' and old.status is distinct from 'SIGNED'
     and coalesce(new.legal_act_type, '') in ('BILATERAL_CONTRACT', 'EMPLOYER_UNILATERAL') then
    perform public.hr_notify('DOC_SIGNED', 'NA_VEDOMI', 'Podepsáno: ' || new.doc_type || ' – ' || v_who,
      'hr_documents', new.id, new.employee_id, jsonb_build_object('doc_type', new.doc_type, 'legal_act_type', new.legal_act_type));
  end if;
  if new.status = 'VOIDED' and old.status is distinct from 'VOIDED' then
    perform public.hr_notify('DOC_VOIDED', 'NA_VEDOMI', 'Zneplatněno: ' || new.doc_type || ' – ' || v_who,
      'hr_documents', new.id, new.employee_id,
      jsonb_build_object('doc_type', new.doc_type, 'was_signed', old.locked_at is not null, 'reason', new.void_reason));
  end if;
  return new;
end;
$$;
drop trigger if exists hr_notify_documents on public.hr_documents;
create trigger hr_notify_documents after update on public.hr_documents
  for each row execute function public.hr_notify_documents();

-- zmena mzdy (aktualna mzda alebo historia)
create or replace function public.hr_notify_wage()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when TG_OP = 'UPDATE' then old.data else '{}'::jsonb end;
begin
  if (new.data->'mzda_historie') is distinct from (v_old->'mzda_historie')
     or (new.data->>'mzda_castka') is distinct from (v_old->>'mzda_castka')
     or (new.data->>'mzda_typ') is distinct from (v_old->>'mzda_typ') then
    if coalesce(new.data->>'mzda_castka', '') = '' and coalesce(v_old->>'mzda_castka', '') = ''
       and coalesce(jsonb_array_length(new.data->'mzda_historie'), 0) = coalesce(jsonb_array_length(v_old->'mzda_historie'), 0) then
      return new;
    end if;
    perform public.hr_notify('WAGE_CHANGED', 'NA_VEDOMI', 'Změna mzdy – ' || coalesce(public.hr_employee_name(new.employee_id), new.employee_id),
      'employee_payroll_data', new.employee_id, new.employee_id,
      jsonb_build_object('z', v_old->>'mzda_castka', 'na', new.data->>'mzda_castka', 'typ', new.data->>'mzda_typ',
        'platnost_od', new.data->>'mzda_platnost_od'));
  end if;
  return new;
end;
$$;
drop trigger if exists hr_notify_wage on public.employee_payroll_data;
create trigger hr_notify_wage after insert or update on public.employee_payroll_data
  for each row execute function public.hr_notify_wage();

-- sablony a pravne texty: nova verzia caka na schvalenie
create or replace function public.hr_notify_templates()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_TABLE_NAME = 'hr_document_template_versions' then
    if TG_OP = 'INSERT' and coalesce(new.mapping_status, '') <> 'SCHVALENA' then
      perform public.hr_notify('TEMPLATE_PENDING', 'KE_SCHVALENI',
        'Nová verze šablony čeká na schválení (v' || new.version_number || ')', 'hr_document_template_versions', new.id, null,
        jsonb_build_object('template_id', new.template_id), new.uploaded_by);
    elsif TG_OP = 'UPDATE' and new.mapping_status = 'SCHVALENA' and old.mapping_status is distinct from 'SCHVALENA' then
      update public.hr_notifications set resolved_at = now(), resolved_by = auth.uid()
        where entity = 'hr_document_template_versions' and entity_id = new.id and kind = 'KE_SCHVALENI' and resolved_at is null;
      perform public.hr_notify('TEMPLATE_APPROVED', 'NA_VEDOMI', 'Šablona schválena (v' || new.version_number || ')',
        'hr_document_template_versions', new.id, null, jsonb_build_object('template_id', new.template_id));
    end if;
  else
    if TG_OP = 'INSERT' and new.status = 'KONCEPT' then
      perform public.hr_notify('LEGAL_TEXT_PENDING', 'KE_SCHVALENI', 'Nová verze textu čeká na schválení: ' || new.title,
        'hr_legal_text_versions', new.id, null, jsonb_build_object('text_key', new.text_key, 'version_no', new.version_no), new.created_by);
    elsif TG_OP = 'UPDATE' and new.status <> 'KONCEPT' and old.status = 'KONCEPT' then
      update public.hr_notifications set resolved_at = now(), resolved_by = auth.uid()
        where entity = 'hr_legal_text_versions' and entity_id = new.id and kind = 'KE_SCHVALENI' and resolved_at is null;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists hr_notify_template_versions on public.hr_document_template_versions;
create trigger hr_notify_template_versions after insert or update on public.hr_document_template_versions
  for each row execute function public.hr_notify_templates();
drop trigger if exists hr_notify_legal_texts on public.hr_legal_text_versions;
create trigger hr_notify_legal_texts after insert or update on public.hr_legal_text_versions
  for each row execute function public.hr_notify_templates();

-- opravnenia, ucty, plne moci, nastavenia, trvale vymazanie, dorucenie
create or replace function public.hr_notify_admin_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
  o jsonb := case when TG_OP <> 'INSERT' then to_jsonb(old) end;
begin
  if TG_TABLE_NAME = 'hr_permissions' then
    perform public.hr_notify('PERMISSIONS_CHANGED', 'NA_VEDOMI',
      case TG_OP when 'INSERT' then 'Nový přístup: ' when 'DELETE' then 'Odebrán přístup: ' else 'Změna přístupu: ' end || (r->>'user_email'),
      'hr_permissions', r->>'id', null,
      jsonb_build_object('profile', r->>'profile', 'permissions', r->'permissions', 'valid_until', r->>'valid_until',
        'before', o->'permissions'));
  elsif TG_TABLE_NAME = 'profiles' then
    if TG_OP = 'INSERT' or (r->>'role') is distinct from (o->>'role') then
      perform public.hr_notify('ACCOUNT_ROLE_CHANGED', 'NA_VEDOMI', 'Role účtu: ' || coalesce(r->>'full_name', r->>'id') || ' → ' || coalesce(r->>'role', '—'),
        'profiles', r->>'id', null, jsonb_build_object('role', r->>'role', 'before', o->>'role'));
    end if;
  elsif TG_TABLE_NAME = 'hr_signatories' then
    perform public.hr_notify('SIGNATORY_CHANGED', 'NA_VEDOMI', 'Osoba s plnou mocí: ' || (r->>'full_name'),
      'hr_signatories', r->>'id', null, jsonb_build_object('valid_from', r->>'valid_from', 'valid_to', r->>'valid_to', 'op', lower(TG_OP)));
  elsif TG_TABLE_NAME = 'hr_settings' then
    perform public.hr_notify('SETTINGS_CHANGED', 'NA_VEDOMI', 'Změna nastavení HR: ' || (r->>'key'),
      'hr_settings', r->>'key', null, jsonb_build_object('value', r->'value', 'before', o->'value'));
  elsif TG_TABLE_NAME = 'employees' then
    perform public.hr_notify('EMPLOYEE_DELETED', 'NA_VEDOMI',
      'Trvale vymazán zaměstnanec: ' || trim(coalesce(o->>'first_name', '') || ' ' || coalesce(o->>'last_name', '')),
      'employees', o->>'id', null, jsonb_build_object('record_flag', o->>'record_flag'));
  elsif TG_TABLE_NAME = 'hr_document_deliveries' then
    if (r->>'send_status') in ('FAILED', 'BOUNCED') and (o->>'send_status') is distinct from (r->>'send_status') then
      perform public.hr_notify('DELIVERY_FAILED', 'NA_VEDOMI', 'Doručení se nezdařilo (' || (r->>'channel') || ')',
        'hr_document_deliveries', r->>'id', null, jsonb_build_object('document_id', r->>'hr_document_id', 'error', r->>'send_error'));
    elsif (r->>'ineffective_at') is not null and (o->>'ineffective_at') is null then
      perform public.hr_notify('DELIVERY_INEFFECTIVE', 'NA_VEDOMI', 'Doručení je neúčinné (' || (r->>'channel') || ')',
        'hr_document_deliveries', r->>'id', null, jsonb_build_object('document_id', r->>'hr_document_id', 'reason', r->>'ineffective_reason'));
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists hr_notify_permissions on public.hr_permissions;
create trigger hr_notify_permissions after insert or update or delete on public.hr_permissions
  for each row execute function public.hr_notify_admin_changes();
drop trigger if exists hr_notify_profiles on public.profiles;
create trigger hr_notify_profiles after insert or update on public.profiles
  for each row execute function public.hr_notify_admin_changes();
drop trigger if exists hr_notify_signatories on public.hr_signatories;
create trigger hr_notify_signatories after insert or update or delete on public.hr_signatories
  for each row execute function public.hr_notify_admin_changes();
drop trigger if exists hr_notify_settings on public.hr_settings;
create trigger hr_notify_settings after insert or update on public.hr_settings
  for each row execute function public.hr_notify_admin_changes();
drop trigger if exists hr_notify_employee_deleted on public.employees;
create trigger hr_notify_employee_deleted after delete on public.employees
  for each row execute function public.hr_notify_admin_changes();
drop trigger if exists hr_notify_deliveries on public.hr_document_deliveries;
create trigger hr_notify_deliveries after update on public.hr_document_deliveries
  for each row execute function public.hr_notify_admin_changes();

-- ---------- prehlad a tyzdenny suhrn ----------
insert into public.hr_settings (key, value, description) values
  ('konatel_summary', '{"email_enabled": false, "recipients": []}',
   'Týdenní souhrn pro jednatele e-mailem – zapnout až po výběru poskytovatele e-mailů.')
on conflict (key) do nothing;

create or replace function public.hr_konatel_summary(p_days int default 7)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_from timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 7), 1));
begin
  if not (coalesce(auth.role(), '') = 'service_role'
          or (public.current_role() = 'office' and public.hr_has_permission('HR_ADMIN'))) then
    raise exception 'Neopravneno.';
  end if;
  return jsonb_build_object(
    'od', v_from,
    'do', now(),
    'udalosti', coalesce((select jsonb_object_agg(event_type, n) from (
        select event_type, count(*) n from public.hr_notifications where created_at >= v_from group by event_type) x), '{}'::jsonb),
    'ke_schvaleni', (select count(*) from public.hr_notifications where kind = 'KE_SCHVALENI' and resolved_at is null),
    'neprectene', (select count(*) from public.hr_notifications where read_at is null and kind = 'NA_VEDOMI'),
    'smlouvy_konci_30_dni', (select count(*) from public.employment_relationships
        where status in ('ACTIVE', 'NOTICE_PERIOD') and fixed_term_end_date between current_date and current_date + 30),
    'smlouvy_po_konci', (select count(*) from public.employment_relationships
        where status = 'ACTIVE' and fixed_term_end_date < current_date),
    'prohlidky_po_platnosti', (select count(*) from (
        select distinct on (m.employee_id) m.valid_until from public.medical_examinations m
        join public.employees e on e.id = m.employee_id and e.active
        order by m.employee_id, m.valid_until desc nulls last) x where valid_until < current_date),
    'prohlidky_do_30_dni', (select count(*) from (
        select distinct on (m.employee_id) m.valid_until from public.medical_examinations m
        join public.employees e on e.id = m.employee_id and e.active
        order by m.employee_id, m.valid_until desc nulls last) x where valid_until between current_date and current_date + 30),
    'pristupy', (select count(*) from public.hr_permissions
        where (valid_until is null or valid_until >= current_date) and (valid_from is null or valid_from <= current_date)),
    'pristupy_konci_14_dni', (select count(*) from public.hr_permissions where valid_until between current_date and current_date + 14)
  );
end;
$$;
revoke execute on function public.hr_konatel_summary(int) from public, anon;
grant execute on function public.hr_konatel_summary(int) to authenticated, service_role;
