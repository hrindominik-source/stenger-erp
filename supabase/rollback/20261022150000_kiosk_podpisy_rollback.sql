-- ROLLBACK migracie 20261022150000_kiosk_podpisy.sql (faza D) - spustit PRED
-- rollbackom 49/48. Vrati funkcie kiosku na verziu z migracie 48.
-- Zastavi sa, ak uz existuju elektronicky podpisane dokumenty z dotaznika.
-- Pravne texty (koncepty) sa nemazu - su nemenne a rollback 48 ich odstrani
-- spolu s tabulkou.
begin;
do $$
begin
  if exists (select 1 from public.onboarding_sessions where signing_mode = 'ELECTRONIC') then
    raise exception 'Existuji dotazniky podepsane elektronicky - rollback by ztratil rezim podpisu.';
  end if;
end $$;
drop function if exists public.hr_onboarding_submit(text, text);
create or replace function public.hr_onboarding_submit(p_session_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.onboarding_sessions
    set status = 'SUBMITTED', submitted_at = now(), last_activity_at = now()
    where session_token = p_session_token and status = 'IN_PROGRESS'
      and (expires_at is null or expires_at > now());
  return found;
end;
$$;

revoke execute on function public.hr_onboarding_submit(text) from public;
grant execute on function public.hr_onboarding_submit(text) to anon, authenticated;
create or replace function public.hr_onboarding_save_draft(p_session_token text, p_draft_data jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.onboarding_sessions
    set draft_data = p_draft_data, last_activity_at = now()
    where session_token = p_session_token and status = 'IN_PROGRESS'
      and (expires_at is null or expires_at > now());
  return found;
end;
$$;

drop function if exists public.hr_onboarding_config();
create or replace function public.hr_onboarding_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    's335_consent_enabled', coalesce(public.hr_setting('s335_consent_enabled'), 'false'::jsonb),
    'device_unlock_required', coalesce(public.hr_setting('kiosk')->'device_unlock_required', 'false'::jsonb)
  );
$$;

grant execute on function public.hr_onboarding_config() to anon, authenticated;
create or replace function public.hr_onboarding_review(p_session_id text, p_status text, p_resulting_employee_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.current_role() = 'office' and public.hr_has_permission('HR_EDIT')) then
    raise exception 'Neopravnene.';
  end if;
  if p_status not in ('REVIEWED', 'DISCARDED') then
    raise exception 'Neplatny stav.';
  end if;
  if p_status = 'REVIEWED' and p_resulting_employee_id is null then
    raise exception 'Chybi zamestnanec.';
  end if;
  update public.onboarding_sessions
    set status = p_status, reviewed_by = auth.uid(), reviewed_at = now(),
        resulting_employee_id = p_resulting_employee_id
    where id = p_session_id and status in ('SUBMITTED', 'IN_PROGRESS', 'EXPIRED');
  if not found then
    return false;
  end if;
  if p_status = 'REVIEWED' then
    update public.hr_documents set employee_id = p_resulting_employee_id, updated_at = now()
      where onboarding_session_id = p_session_id and employee_id is null;
    update public.employee_contact_declarations set employee_id = p_resulting_employee_id
      where onboarding_session_id = p_session_id and employee_id is null;
  end if;
  return true;
end;
$$;

grant execute on function public.hr_onboarding_review(text, text, text) to authenticated;
drop function if exists public.hr_current_legal_text(text);
alter table public.onboarding_sessions drop constraint if exists onboarding_sessions_signing_mode_check;
alter table public.onboarding_sessions drop column if exists signing_mode;
commit;
