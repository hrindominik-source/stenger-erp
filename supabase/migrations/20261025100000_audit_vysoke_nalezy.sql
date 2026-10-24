-- ============================================================
-- 63. Opravy vysokych nalezov z auditu Personalistiky (docs/audit/01):
--   S-01 subory v hr-dokumenty: neznama cesta uz nie je viditelna pre kazdeho
--        s HR_VIEW_BASIC. Prilohy zamestnanca (zamestnanci/<id>/prilohy/)
--        vyzaduju HR_VIEW_PAYROLL (rovnako ako ich evidencia), sablony ostavaju
--        pre HR_VIEW_BASIC, ostatne nenaviazane subory len HR_ADMIN.
--   S-02 token kioskovej relacie sa v DB uklada len ako SHA-256 - HR ho uz
--        nevidi a nemoze v mene uchadzaca menit dotaznik ani podpisovat.
--        Rozpracovane relacie pokracuju (hash sa dopocita z povodneho tokenu).
--   S-03 kiosk vyzaduje odomknutie zariadenia kodom od HR (hr_kiosk_issue_unlock);
--        bez kodu nevznikne relacia, teda ani limit relacii nejde vycerpat.
--   plan_smien: anon/authenticated uz nezapisuju priamo do tabulky; zapis ide
--        cez plan_smien_save (admin PIN) a plan_smien_add_request (PIN
--        zamestnanca). Overovanie PIN ma obmedzenie chybnych pokusov.
-- ============================================================

-- ---------- S-01 ----------
create or replace function public.hr_object_path_visible(p_path text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_doc_id text;
  v_sens text;
begin
  if p_path like 'exekuce/%' then
    return public.hr_has_permission('HR_EXEKUCE');
  end if;
  -- prilohy zamestnanca (zdravotne doklady, pas, rodne listy deti, PN ...) -
  -- evidencia je v employee_payroll_data, teda rovnake pravo ako metadata
  if p_path ~ '^zamestnanci/[^/]+/prilohy/' then
    return public.hr_has_permission('HR_VIEW_PAYROLL');
  end if;
  -- subory sablon (baseline HR_VIEW_BASIC je vynuteny v policy)
  if p_path like 'sablony/%' then
    return true;
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
    -- neznamy subor (napr. po trvalom vymazani zaznamu) - len HR_ADMIN
    return public.hr_has_permission('HR_ADMIN');
  end if;
  return not exists (
    select 1 from unnest(public.hr_document_required_permissions(v_doc_id)) as perm
    where not public.hr_has_permission(perm)
  );
end;
$$;

-- ---------- S-02 ----------
create or replace function public.hr_onboarding_token_hash(p_token text)
returns text language sql immutable set search_path = public as $$
  select encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;
revoke execute on function public.hr_onboarding_token_hash(text) from public, anon, authenticated;

alter table public.onboarding_sessions add column if not exists session_token_sha256 text;
update public.onboarding_sessions
  set session_token_sha256 = public.hr_onboarding_token_hash(session_token)
  where session_token_sha256 is null;
alter table public.onboarding_sessions alter column session_token_sha256 set not null;
create unique index if not exists onboarding_sessions_token_sha256_key on public.onboarding_sessions (session_token_sha256);
alter table public.onboarding_sessions drop column session_token;

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
  -- bez nastavenia plati bezpecnejsia volba (odomknutie povinne)
  if coalesce((v_cfg->>'device_unlock_required')::boolean, true) then
    update public.hr_kiosk_unlocks u set used_at = now()
      where u.code_sha256 = encode(extensions.digest(upper(trim(coalesce(p_unlock_code, ''))), 'sha256'), 'hex')
        and u.used_at is null and u.expires_at > now()
      returning u.id into v_unlock_id;
    if v_unlock_id is null then
      raise exception 'Zarizeni neni odemceno - pozadejte personalni oddeleni o kod.';
    end if;
  end if;
  insert into public.onboarding_sessions (id, session_token_sha256, status, draft_data, expires_at, last_activity_at, unlock_id)
  values (v_id, public.hr_onboarding_token_hash(v_token), 'IN_PROGRESS', '{}'::jsonb, v_expires, now(), v_unlock_id);
  -- token dostane len kiosk, v DB ostava iba hash
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
    where s.session_token_sha256 = public.hr_onboarding_token_hash(p_session_token) and s.status = 'IN_PROGRESS'
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
    where s.session_token_sha256 = public.hr_onboarding_token_hash(p_session_token) and s.status = 'IN_PROGRESS'
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

-- ---------- S-03 ----------
update public.hr_settings
  set value = jsonb_set(value, '{device_unlock_required}', 'true'::jsonb, true)
  where key = 'kiosk';

-- ---------- plan_smien ----------
drop policy if exists plan_smien_public on public.plan_smien;
drop policy if exists plan_smien_read on public.plan_smien;
create policy plan_smien_read on public.plan_smien for select using (true);
revoke insert, update, delete, truncate on public.plan_smien from anon, authenticated;

-- Chybne pokusy o PIN: po 10 chybach za sebou je overovanie daneho PIN
-- (admin alebo konkretny zamestnanec) 5 minut zablokovane.
create table if not exists public.plan_smien_pin_failures (
  target text primary key,
  failures int not null default 0,
  locked_until timestamptz
);
alter table public.plan_smien_pin_failures enable row level security;
revoke all on public.plan_smien_pin_failures from anon, authenticated;

create or replace function public.plan_smien_pin_attempt(p_target text, p_ok boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_locked timestamptz;
begin
  select locked_until into v_locked from public.plan_smien_pin_failures where target = p_target for update;
  if v_locked is not null and v_locked > now() then
    return false;
  end if;
  if p_ok then
    delete from public.plan_smien_pin_failures where target = p_target;
    return true;
  end if;
  insert into public.plan_smien_pin_failures as f (target, failures) values (p_target, 1)
    on conflict (target) do update
      set failures = case when f.locked_until is not null then 1 else f.failures + 1 end,
          locked_until = null;
  update public.plan_smien_pin_failures
    set locked_until = now() + interval '5 minutes', failures = 0
    where target = p_target and failures >= 10;
  return false;
end;
$$;
revoke execute on function public.plan_smien_pin_attempt(text, boolean) from public, anon, authenticated;

create or replace function public.plan_smien_admin_pin_ok(p_pin text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  return public.plan_smien_pin_attempt('admin',
    exists (select 1 from public.plan_smien_pins where id = 1 and admin_pin = coalesce(p_pin, '')));
end;
$$;
revoke execute on function public.plan_smien_admin_pin_ok(text) from public, anon, authenticated;

create or replace function public.plan_smien_employee_pin_ok(p_employee_id text, p_pin text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  return public.plan_smien_pin_attempt('emp:' || coalesce(p_employee_id, ''),
    coalesce((select (employee_pins ->> p_employee_id) = p_pin from public.plan_smien_pins where id = 1), false));
end;
$$;
revoke execute on function public.plan_smien_employee_pin_ok(text, text) from public, anon, authenticated;

-- povodne jazyk sql (bez zapisu) -> plpgsql kvoli evidencii pokusov
drop function if exists public.plan_smien_verify_admin_pin(text);
create function public.plan_smien_verify_admin_pin(p_pin text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  return public.plan_smien_admin_pin_ok(p_pin);
end;
$$;

drop function if exists public.plan_smien_verify_employee_pin(text, text);
create function public.plan_smien_verify_employee_pin(p_employee_id text, p_pin text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  return public.plan_smien_employee_pin_ok(p_employee_id, p_pin);
end;
$$;

create or replace function public.plan_smien_set_admin_pin(p_current_pin text, p_new_pin text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.plan_smien_admin_pin_ok(p_current_pin) then
    return false;
  end if;
  if length(coalesce(p_new_pin, '')) < 4 then
    raise exception 'PIN musi mit alespon 4 znaky.';
  end if;
  update public.plan_smien_pins set admin_pin = p_new_pin where id = 1;
  return true;
end;
$$;

create or replace function public.plan_smien_reset_employee_pin(p_admin_pin text, p_employee_id text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.plan_smien_admin_pin_ok(p_admin_pin) then
    return false;
  end if;
  update public.plan_smien_pins set employee_pins = employee_pins - p_employee_id where id = 1;
  delete from public.plan_smien_pin_failures where target = 'emp:' || p_employee_id;
  return true;
end;
$$;

-- Ulozenie celeho rozpisu (len planovac s admin PIN). Ziadosti zamestnancov,
-- ktore medzitym pribudli (plan_smien_add_request), sa nestratia.
create or replace function public.plan_smien_save(p_admin_pin text, p_data jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_current jsonb;
  v_ids jsonb;
begin
  if not public.plan_smien_admin_pin_ok(p_admin_pin) then
    return false;
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Neplatna data planu.';
  end if;
  if pg_column_size(p_data) > 5242880 then
    raise exception 'Plan je prilis velky.';
  end if;
  select data into v_current from public.plan_smien where id = 1 for update;
  select coalesce(jsonb_agg(r->'id'), '[]'::jsonb) into v_ids
    from jsonb_array_elements(coalesce(p_data->'requests', '[]'::jsonb)) r;
  p_data := jsonb_set(p_data, '{requests}', coalesce(p_data->'requests', '[]'::jsonb) || coalesce((
    select jsonb_agg(r) from jsonb_array_elements(coalesce(v_current->'requests', '[]'::jsonb)) r
    where not (v_ids @> jsonb_build_array(r->'id'))), '[]'::jsonb), true);
  insert into public.plan_smien (id, data, updated_at) values (1, p_data, now())
    on conflict (id) do update set data = excluded.data, updated_at = now();
  return true;
end;
$$;

-- Zamestnanec (s vlastnym PIN) smie len pridat vlastnu ziadost o volno.
create or replace function public.plan_smien_add_request(p_employee_id text, p_pin text, p_request jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_req jsonb;
begin
  if not public.plan_smien_employee_pin_ok(p_employee_id, p_pin) then
    return false;
  end if;
  if p_request is null or jsonb_typeof(p_request) <> 'object' or pg_column_size(p_request) > 4096
     or coalesce(p_request->>'id', '') = '' then
    raise exception 'Neplatna zadost.';
  end if;
  v_req := p_request || jsonb_build_object('employeeId', p_employee_id, 'status', 'pending');
  insert into public.plan_smien (id, data) values (1, '{}'::jsonb) on conflict (id) do nothing;
  update public.plan_smien
    set data = jsonb_set(data, '{requests}', coalesce(data->'requests', '[]'::jsonb) || jsonb_build_array(v_req), true),
        updated_at = now()
    where id = 1
      and not exists (select 1 from jsonb_array_elements(coalesce(data->'requests', '[]'::jsonb)) r where r->>'id' = p_request->>'id');
  return true;
end;
$$;

-- verejna cast (planovanie bez prihlasenia) - explicitne, viz migr. 62
revoke execute on function public.plan_smien_verify_admin_pin(text) from public;
revoke execute on function public.plan_smien_verify_employee_pin(text, text) from public;
grant execute on function public.plan_smien_verify_admin_pin(text) to anon, authenticated, service_role;
grant execute on function public.plan_smien_verify_employee_pin(text, text) to anon, authenticated, service_role;
revoke execute on function public.plan_smien_save(text, jsonb) from public;
revoke execute on function public.plan_smien_add_request(text, text, jsonb) from public;
grant execute on function public.plan_smien_save(text, jsonb) to anon, authenticated, service_role;
grant execute on function public.plan_smien_add_request(text, text, jsonb) to anon, authenticated, service_role;
