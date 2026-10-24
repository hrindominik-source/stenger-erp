-- Rollback migracie 63 (opravy vysokych nalezov auditu). Pozor:
--   - rozpracovane kioskove relacie prestanu platit (token sa z hashu neda
--     obnovit) - uchadzac zacne dotaznik znova;
--   - kiosk sa vrati do rezimu bez odomknutia (S-03 opat otvorene);
--   - plan_smien bude opat zapisovatelny bez PIN.
begin;

-- S-01
create or replace function public.hr_object_path_visible(p_path text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_doc_id text;
  v_sens text;
begin
  if p_path like 'exekuce/%' then
    return public.hr_has_permission('HR_EXEKUCE');
  end if;
  -- sken plnej moci: citlivost zaznamu; neznamy subor len HR_ADMIN
  if p_path like 'plne-moci/%' then
    select sensitivity into v_sens from public.hr_signatories where poa_scan_path = p_path;
    return public.hr_has_permission(coalesce(v_sens, 'HR_ADMIN'));
  end if;
  select id into v_doc_id from public.hr_documents
    where file_path = p_path or final_pdf_path = p_path or signed_pdf_path = p_path
    limit 1;
  if v_doc_id is null then
    select hr_document_id into v_doc_id from public.hr_document_signatures where file_path = p_path limit 1;
  end if;
  if v_doc_id is null then
    select hr_document_id into v_doc_id from public.hr_document_deliveries where receipt_scan_path = p_path limit 1;
  end if;
  if v_doc_id is null then
    select s.hr_document_id into v_doc_id from public.hr_signature_verifications v
      join public.hr_document_signatures s on s.id = v.signature_id where v.protocol_path = p_path limit 1;
  end if;
  if v_doc_id is null and p_path like 'prevzeti/%' then
    v_doc_id := split_part(p_path, '/', 2);
    if not exists (select 1 from public.hr_documents where id = v_doc_id) then
      return false;
    end if;
  end if;
  if v_doc_id is null then
    return true; -- subor sablony a pod. - baseline HR_VIEW_BASIC uz je vynuteny v policy
  end if;
  return not exists (
    select 1 from unnest(public.hr_document_required_permissions(v_doc_id)) as perm
    where not public.hr_has_permission(perm)
  );
end;
$$;

-- S-02: stlpec s tokenom (nove nahodne hodnoty - stare relacie neplatia)
alter table public.onboarding_sessions add column if not exists session_token text;
update public.onboarding_sessions
  set session_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
  where session_token is null;
alter table public.onboarding_sessions alter column session_token set not null;
alter table public.onboarding_sessions add constraint onboarding_sessions_session_token_key unique (session_token);

create or replace function public.hr_onboarding_start_session(p_unlock_code text default null)
returns table(id text, session_token text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_cfg jsonb := coalesce(public.hr_setting('kiosk'), '{}'::jsonb);
  v_id text := 'onb-' || replace(gen_random_uuid()::text, '-', '');
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_expires timestamptz := now() + make_interval(hours => coalesce((v_cfg->>'session_ttl_hours')::int, 8));
  v_unlock_id text;
begin
  perform public.hr_onboarding_cleanup();
  -- Globalny limit (anon nema identitu) - ochrana pred zahltenim.
  perform pg_advisory_xact_lock(hashtext('hr_onboarding_start_session'));
  if (select count(*) from public.onboarding_sessions s where s.created_at > now() - interval '1 hour')
     >= coalesce((v_cfg->>'max_new_sessions_per_hour')::int, 30) then
    raise exception 'Prilis mnoho novych dotazniku za posledni hodinu. Zkuste to pozdeji nebo kontaktujte personalni oddeleni.';
  end if;
  if coalesce((v_cfg->>'device_unlock_required')::boolean, false) then
    update public.hr_kiosk_unlocks u set used_at = now()
      where u.code_sha256 = encode(extensions.digest(upper(trim(coalesce(p_unlock_code, ''))), 'sha256'), 'hex')
        and u.used_at is null and u.expires_at > now()
      returning u.id into v_unlock_id;
    if v_unlock_id is null then
      raise exception 'Zarizeni neni odemceno - pozadejte personalni oddeleni o kod.';
    end if;
  end if;
  insert into public.onboarding_sessions (id, session_token, status, draft_data, expires_at, last_activity_at, unlock_id)
  values (v_id, v_token, 'IN_PROGRESS', '{}'::jsonb, v_expires, now(), v_unlock_id);
  return query select v_id, v_token, v_expires;
end;
$$;

create or replace function public.hr_onboarding_save_draft(p_session_token text, p_draft_data jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if pg_column_size(p_draft_data) > 262144 then
    raise exception 'Dotazník je příliš velký.';
  end if;
  update public.onboarding_sessions s
    set draft_data = p_draft_data, last_activity_at = now()
    where s.session_token = p_session_token and s.status = 'IN_PROGRESS'
      and (s.expires_at is null or s.expires_at > now())
      and not exists (select 1 from public.hr_documents d where d.onboarding_session_id = s.id and d.locked_at is not null);
  return found;
end;
$$;

create or replace function public.hr_onboarding_submit(p_session_token text, p_signing_mode text default 'PAPER')
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_id text;
  v_with_signature int;
  v_not_signed int;
begin
  if p_signing_mode not in ('ELECTRONIC', 'PAPER') then
    raise exception 'Neplatny rezim podpisu.';
  end if;
  select s.id into v_id from public.onboarding_sessions s
    where s.session_token = p_session_token and s.status = 'IN_PROGRESS'
      and (s.expires_at is null or s.expires_at > now())
    for update;
  if v_id is null then
    return false;
  end if;
  select count(*) filter (where d.locked_at is not null),
         count(*) filter (where d.status not in ('SIGNED', 'VOIDED', 'SUPERSEDED'))
    into v_with_signature, v_not_signed
    from public.hr_documents d where d.onboarding_session_id = v_id;

  if p_signing_mode = 'ELECTRONIC' then
    if not exists (select 1 from public.hr_documents d where d.onboarding_session_id = v_id
                   and d.doc_type = 'osobni_dotaznik' and d.status = 'SIGNED') or v_not_signed > 0 then
      raise exception 'Nejsou podepsany vsechny dokumenty dotazniku.';
    end if;
  else
    if v_with_signature > 0 then
      raise exception 'Cast dokumentu uz je podepsana elektronicky - dokoncete podpis na tabletu.';
    end if;
    update public.hr_documents set status = 'VOIDED', void_reason = 'Zvolen podpis na papíře', updated_at = now()
      where onboarding_session_id = v_id and locked_at is null and status not in ('SIGNED', 'VOIDED', 'SUPERSEDED');
  end if;

  update public.onboarding_sessions
    set status = 'SUBMITTED', submitted_at = now(), last_activity_at = now(), signing_mode = p_signing_mode
    where id = v_id;
  return true;
end;
$$;

alter table public.onboarding_sessions drop column session_token_sha256;
drop function if exists public.hr_onboarding_token_hash(text);

-- S-03
update public.hr_settings
  set value = jsonb_set(value, '{device_unlock_required}', 'false'::jsonb, true)
  where key = 'kiosk';

-- plan_smien
drop function if exists public.plan_smien_save(text, jsonb);
drop function if exists public.plan_smien_add_request(text, text, jsonb);

create or replace function public.plan_smien_set_admin_pin(p_current_pin text, p_new_pin text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.plan_smien_pins where id = 1 and admin_pin = p_current_pin) then
    return false;
  end if;
  update public.plan_smien_pins set admin_pin = p_new_pin where id = 1;
  return true;
end;
$$;

create or replace function public.plan_smien_reset_employee_pin(p_admin_pin text, p_employee_id text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.plan_smien_pins where id = 1 and admin_pin = p_admin_pin) then
    return false;
  end if;
  update public.plan_smien_pins set employee_pins = employee_pins - p_employee_id where id = 1;
  return true;
end;
$$;

drop function if exists public.plan_smien_verify_admin_pin(text);
create function public.plan_smien_verify_admin_pin(p_pin text)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.plan_smien_pins where id = 1 and admin_pin = p_pin);
$$;
drop function if exists public.plan_smien_verify_employee_pin(text, text);
create function public.plan_smien_verify_employee_pin(p_employee_id text, p_pin text)
returns boolean language sql security definer set search_path = public as $$
  select coalesce((select (employee_pins ->> p_employee_id) = p_pin from public.plan_smien_pins where id = 1), false);
$$;
revoke execute on function public.plan_smien_verify_admin_pin(text) from public;
revoke execute on function public.plan_smien_verify_employee_pin(text, text) from public;
grant execute on function public.plan_smien_verify_admin_pin(text) to anon, authenticated, service_role;
grant execute on function public.plan_smien_verify_employee_pin(text, text) to anon, authenticated, service_role;

drop function if exists public.plan_smien_admin_pin_ok(text);
drop function if exists public.plan_smien_employee_pin_ok(text, text);
drop function if exists public.plan_smien_pin_attempt(text, boolean);
drop table if exists public.plan_smien_pin_failures;

drop policy if exists plan_smien_read on public.plan_smien;
create policy plan_smien_public on public.plan_smien for all using (true) with check (true);
grant insert, update, delete on public.plan_smien to anon, authenticated;

commit;
