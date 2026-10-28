-- Migracia 69: obnova dvojfazoveho prihlasenia (rozhodnutie jednatela).
-- - MFA povinne aj pre externu uctovnicku (profil UCTOVNIK_EXT).
-- - Zalozne kody: pri registracii 10 jednorazovych kodov (ulozene len otlacky),
--   zobrazia sa raz. Pouzitie kodu zrusi faktor (server, hr-mfa) -> nova registracia.
-- - Reset MFA personalistky a uctovnicky: len jednatel (hr-mfa, s dovodom).
-- - Reset MFA jednatela: len serverovo (hr_mfa_server_reset, postup pre IT).
-- - Kazdy reset: audit_log (entity 'auth_mfa') + upozornenie jednatelovi.

update public.hr_settings set value = jsonb_set(value, '{required_profiles}', '["KONATEL", "PERSONALISTA", "UCTOVNIK_EXT"]')
where key = 'mfa';

create table if not exists public.hr_mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_sha256 text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
create index if not exists hr_mfa_recovery_codes_user on public.hr_mfa_recovery_codes (user_id);
alter table public.hr_mfa_recovery_codes enable row level security;
revoke all on public.hr_mfa_recovery_codes from anon, authenticated;

-- neuspesne pokusy o zalozny kod (obmedzenie skusania)
create table if not exists public.hr_mfa_recovery_failures (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  at timestamptz not null default now()
);
alter table public.hr_mfa_recovery_failures enable row level security;
revoke all on public.hr_mfa_recovery_failures from anon, authenticated;

create or replace function public.hr_mfa_code_hash(p_code text)
returns text language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g')), 'sha256'), 'hex');
$$;

-- Nove zalozne kody (stare sa zahodia). Len po overeni druhym faktorom.
create or replace function public.hr_mfa_generate_recovery_codes()
returns text[] language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_codes text[] := '{}';
  v_code text;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'aal', '') <> 'aal2' then
    raise exception 'Zalozne kody len po overeni kodom z aplikacie.' using errcode = '42501';
  end if;
  delete from public.hr_mfa_recovery_codes where user_id = auth.uid();
  for i in 1..10 loop
    v_code := upper(encode(extensions.gen_random_bytes(5), 'hex'));
    v_code := substr(v_code, 1, 5) || '-' || substr(v_code, 6, 5);
    v_codes := v_codes || v_code;
    insert into public.hr_mfa_recovery_codes (user_id, code_sha256) values (auth.uid(), public.hr_mfa_code_hash(v_code));
  end loop;
  insert into public.audit_log (entity, entity_id, action, new_value, changed_by, changed_by_role, source)
  values ('auth_mfa', auth.uid()::text, 'insert', jsonb_build_object('event', 'recovery_codes_generated', 'count', 10),
    auth.uid(), public.current_role(), 'user');
  return v_codes;
end $$;
revoke all on function public.hr_mfa_generate_recovery_codes() from public, anon;
grant execute on function public.hr_mfa_generate_recovery_codes() to authenticated;

create or replace function public.hr_mfa_recovery_remaining()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.hr_mfa_recovery_codes where user_id = auth.uid() and used_at is null;
$$;
revoke all on function public.hr_mfa_recovery_remaining() from public, anon;
grant execute on function public.hr_mfa_recovery_remaining() to authenticated;

-- Spotrebovanie zalozneho kodu (vola server hr-mfa so service role).
-- true = kod platil a je teraz pouzity. Max 5 neuspesnych pokusov za hodinu.
create or replace function public.hr_mfa_consume_recovery_code(p_user_id uuid, p_code text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid;
begin
  if (select count(*) from public.hr_mfa_recovery_failures where user_id = p_user_id and at > now() - interval '1 hour') >= 5 then
    raise exception 'Prilis mnoho pokusu. Zkuste to za hodinu nebo pozadejte jednatele o zruseni overeni.' using errcode = 'P0001';
  end if;
  update public.hr_mfa_recovery_codes set used_at = now()
  where id = (select id from public.hr_mfa_recovery_codes
    where user_id = p_user_id and used_at is null and code_sha256 = public.hr_mfa_code_hash(p_code) limit 1)
  returning id into v_id;
  if v_id is null then
    insert into public.hr_mfa_recovery_failures (user_id) values (p_user_id);
    return false;
  end if;
  return true;
end $$;
revoke all on function public.hr_mfa_consume_recovery_code(uuid, text) from public, anon, authenticated;
grant execute on function public.hr_mfa_consume_recovery_code(uuid, text) to service_role;

-- Zapis resetu (faktory uz zrusene): audit + upozornenie jednatelovi.
-- p_method: ZALOZNI_KOD (sam pouzivatel), JEDNATEL (v aplikacii), SERVER (IT).
create or replace function public.hr_mfa_log_reset(p_user_id uuid, p_actor uuid, p_method text, p_reason text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_email text;
begin
  if p_method not in ('ZALOZNI_KOD', 'JEDNATEL', 'SERVER') then raise exception 'Neznamy sposob resetu.'; end if;
  select email into v_email from auth.users where id = p_user_id;
  -- po resete nove zalozne kody vzniknu az s novou registraciou
  if p_method <> 'ZALOZNI_KOD' then delete from public.hr_mfa_recovery_codes where user_id = p_user_id; end if;
  insert into public.audit_log (entity, entity_id, action, old_value, new_value, changed_by, changed_by_role, source)
  values ('auth_mfa', p_user_id::text, 'delete', jsonb_build_object('email', v_email),
    jsonb_build_object('event', 'mfa_reset', 'method', p_method, 'reason', p_reason),
    p_actor, (select role from public.profiles where id = p_actor), case when p_method = 'SERVER' then 'server' else 'user' end);
  perform public.hr_notify('MFA_RESET', 'NA_VEDOMI',
    case p_method
      when 'ZALOZNI_KOD' then 'Dvoufázové ověření obnoveno záložním kódem: ' || coalesce(v_email, '?')
      when 'JEDNATEL' then 'Dvoufázové ověření zrušeno jednatelem: ' || coalesce(v_email, '?')
      else 'Dvoufázové ověření zrušeno serverově (IT): ' || coalesce(v_email, '?') end,
    'auth_mfa', p_user_id::text, null,
    jsonb_build_object('email', v_email, 'method', p_method, 'reason', p_reason), p_actor);
end $$;
revoke all on function public.hr_mfa_log_reset(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.hr_mfa_log_reset(uuid, uuid, text, text) to service_role;

-- Reset MFA jednatela (a v nudzi kohokolvek) - LEN serverovo: spusta IT v SQL
-- editore Supabase (rola postgres). Postup v 06-plan-nasadenia.md.
-- p_factors_deleted = true, ak IT faktor zmazal v Dashboarde (Auth -> Users)
-- a funkcia ma uz len zapisat zaznam.
create or replace function public.hr_mfa_server_reset(p_email text, p_reason text, p_factors_deleted boolean default false)
returns int language plpgsql volatile security definer set search_path = public, auth as $$
declare v_user uuid; v_n int := 0;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'Uvedte dovod resetu.'; end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then raise exception 'Pouzivatel % neexistuje.', p_email; end if;
  if not p_factors_deleted then
    delete from auth.mfa_factors where user_id = v_user;
    get diagnostics v_n = row_count;
  end if;
  perform public.hr_mfa_log_reset(v_user, null, 'SERVER', trim(p_reason));
  return v_n;
end $$;
revoke all on function public.hr_mfa_server_reset(text, text, boolean) from public, anon, authenticated, service_role;

-- Prehlad jednatela: ktore ucty maju aktivne overenie (bez detailov faktora).
create or replace function public.hr_mfa_overview()
returns table (user_id uuid, email text, mfa_active boolean, recovery_left int)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.hr_has_permission('HR_ADMIN') then raise exception 'Neopravneno.' using errcode = '42501'; end if;
  return query
    select u.id, u.email::text,
      exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified'),
      (select count(*)::int from public.hr_mfa_recovery_codes c where c.user_id = u.id and c.used_at is null)
    from auth.users u
    where lower(u.email) in (select lower(p.user_email) from public.hr_permissions p);
end $$;
revoke all on function public.hr_mfa_overview() from public, anon;
grant execute on function public.hr_mfa_overview() to authenticated;
