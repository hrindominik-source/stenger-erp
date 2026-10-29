-- Migracia 73 (balik G): bezpecnost uctov.
-- 1. Neuspesne prihlasenia (heslo, dvojfazovy kod) zapisuje server cez Auth
--    hooky (password/mfa verification attempt) - len pre ucty s pristupom do
--    HR. Bez anon funkcie. Pri 5 neuspechoch za 15 min upozornenie jednatelovi.
-- 2. Prehlad pre jednatela: aktivne relacie a zariadenia, prihlasenie na
--    viacerych zariadeniach naraz (zdielany ucet?), neuspesne prihlasenia.
-- 3. Odchod pouzivatela (hr_offboard_user), dve akcie (rozhodnutie 2026-10-29):
--    'HR' = ukoncit pristup do HR (ucet v ERP ostava);
--    'ACCOUNT' = zablokovat ucet - odchod z firmy (koniec HR, zrusenie relacii,
--    blokacia uctu robi server hr-ucty cez admin API). Obe: audit + upozornenie.
--    Jednatela a seba v aplikacii neukonci (IT serverovo).
-- 4. Nove zariadenie: prve prihlasenie uctu HR z noveho zariadenia (prehliadac
--    a system podla user agenta) = upozornenie jednatelovi; nezakazuje sa.
-- MFA a odhlasenie po necinnosti su v migraciach 67-69 a vo frontende.

create table if not exists public.hr_login_failures (
  id bigserial primary key,
  user_id uuid not null,
  kind text not null check (kind in ('PASSWORD', 'MFA')),
  created_at timestamptz not null default now()
);
create index if not exists hr_login_failures_user on public.hr_login_failures (user_id, created_at desc);
alter table public.hr_login_failures enable row level security;
revoke all on public.hr_login_failures from anon, authenticated;

-- Ucet s (aj buducim/skoncenym) zaznamom v hr_permissions.
create or replace function public.hr_is_hr_account(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.hr_permissions p
    where p.user_id = p_user or (p.user_id is null and p.user_email = (select lower(email) from auth.users where id = p_user)));
$$;
revoke all on function public.hr_is_hr_account(uuid) from public, anon, authenticated;

create or replace function public.hr_record_login_failure(p_user uuid, p_kind text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_recent int; v_email text;
begin
  if p_user is null or not public.hr_is_hr_account(p_user) then return; end if;
  insert into public.hr_login_failures (user_id, kind) values (p_user, p_kind);
  select count(*) into v_recent from public.hr_login_failures where user_id = p_user and created_at > now() - interval '15 minutes';
  if v_recent >= 5 and not exists (select 1 from public.hr_notifications
      where event_type = 'LOGIN_FAILURES' and entity_id = p_user::text and created_at > now() - interval '1 hour') then
    select email into v_email from auth.users where id = p_user;
    perform public.hr_notify('LOGIN_FAILURES', 'NA_VEDOMI', 'Opakovaná neúspěšná přihlášení: ' || coalesce(v_email, '?'),
      'auth_user', p_user::text, null, jsonb_build_object('count_15_min', v_recent, 'kind', p_kind));
  end if;
end $$;
revoke all on function public.hr_record_login_failure(uuid, text) from public, anon, authenticated;

-- Auth hooky (volane serverom Auth ako supabase_auth_admin). Rozhodnutie
-- nemenia - prihlasenie bezi dalej (pocet pokusov obmedzuje Auth sam).
create or replace function public.hook_password_verification_attempt(event jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not coalesce((event->>'valid')::boolean, true) then
    perform public.hr_record_login_failure((event->>'user_id')::uuid, 'PASSWORD');
  end if;
  return jsonb_build_object('decision', 'continue');
exception when others then
  return jsonb_build_object('decision', 'continue'); -- zaznam nesmie zablokovat prihlasenie
end $$;
create or replace function public.hook_mfa_verification_attempt(event jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not coalesce((event->>'valid')::boolean, true) then
    perform public.hr_record_login_failure((event->>'user_id')::uuid, 'MFA');
  end if;
  return jsonb_build_object('decision', 'continue');
exception when others then
  return jsonb_build_object('decision', 'continue');
end $$;
revoke all on function public.hook_password_verification_attempt(jsonb) from public, anon, authenticated;
revoke all on function public.hook_mfa_verification_attempt(jsonb) from public, anon, authenticated;
grant execute on function public.hook_password_verification_attempt(jsonb) to supabase_auth_admin;
grant execute on function public.hook_mfa_verification_attempt(jsonb) to supabase_auth_admin;

-- ---------- prehlad pre jednatela ----------
-- Relacia je aktivna, ak sa obnovila za poslednych 15 min (odhlasenie po
-- necinnosti v HR je 15 min). Viac aktivnych relacii = viac zariadeni naraz.
create or replace function public.hr_account_security_overview()
returns table (email text, user_id uuid, profile text, active_sessions int, devices jsonb, last_sign_in_at timestamptz,
  failed_7d int, last_failed_at timestamptz, banned_until timestamptz, offboarded boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.hr_has_permission('HR_ADMIN') then raise exception 'Neopravneno.' using errcode = '42501'; end if;
  return query
  select p.user_email, u.id, p.profile,
    (select count(*)::int from auth.sessions s where s.user_id = u.id
      and coalesce(s.refreshed_at, s.updated_at, s.created_at) > now() - interval '15 minutes' and (s.not_after is null or s.not_after > now())),
    (select coalesce(jsonb_agg(jsonb_build_object('user_agent', s.user_agent, 'last_active', coalesce(s.refreshed_at, s.updated_at, s.created_at))
        order by coalesce(s.refreshed_at, s.updated_at, s.created_at) desc), '[]'::jsonb)
      from auth.sessions s where s.user_id = u.id and coalesce(s.refreshed_at, s.updated_at, s.created_at) > now() - interval '24 hours'),
    u.last_sign_in_at,
    (select count(*)::int from public.hr_login_failures f where f.user_id = u.id and f.created_at > now() - interval '7 days'),
    (select max(f.created_at) from public.hr_login_failures f where f.user_id = u.id),
    u.banned_until,
    coalesce(p.note, '') like 'Odchod:%'
  from public.hr_permissions p
  left join auth.users u on u.id = p.user_id or (p.user_id is null and lower(u.email) = p.user_email)
  order by p.user_email;
end $$;
revoke all on function public.hr_account_security_overview() from public, anon;
grant execute on function public.hr_account_security_overview() to authenticated;

-- ---------- odchod pouzivatela ----------
-- Vola len server (hr-ucty) po overeni jednatela; blokaciu uctu robi admin API.
create or replace function public.hr_offboard_user(p_user_id uuid, p_actor uuid, p_reason text, p_mode text default 'ACCOUNT')
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_email text; v_profile text;
begin
  if p_mode not in ('HR', 'ACCOUNT') then raise exception 'Neznámá akce.'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Uveďte důvod (alespoň 5 znaků).'; end if;
  if p_user_id = p_actor then raise exception 'Vlastní přístup v aplikaci neukončíte.'; end if;
  select lower(email) into v_email from auth.users where id = p_user_id;
  select profile into v_profile from public.hr_permissions where user_id = p_user_id or (user_id is null and user_email = v_email) limit 1;
  if v_profile = 'KONATEL' then raise exception 'Přístup jednatele ukončuje IT serverově.'; end if;
  -- koniec pristupu do HR (zaznam ostava; zmena ide do auditu a upozornenia)
  update public.hr_permissions set
    valid_from = least(coalesce(valid_from, current_date - 1), current_date - 1),
    valid_until = current_date - 1,
    note = case when p_mode = 'ACCOUNT' then 'Odchod: ' else 'Konec přístupu do HR: ' end || trim(p_reason)
  where user_id = p_user_id or (user_id is null and user_email = v_email);
  if p_mode = 'ACCOUNT' then
    -- zrusenie vsetkych relacii (obnovovacie tokeny padnu s reláciou)
    delete from auth.refresh_tokens where user_id = p_user_id::text;
    delete from auth.sessions where user_id = p_user_id;
  end if;
  insert into public.audit_log (entity, entity_id, action, old_value, new_value, changed_by, changed_by_role, source)
  values ('auth_user', p_user_id::text, 'update', null,
    jsonb_build_object(case when p_mode = 'ACCOUNT' then 'offboarded' else 'hr_access_ended' end, true, 'email', v_email, 'reason', trim(p_reason)),
    p_actor, 'office', 'server');
  perform public.hr_notify(case when p_mode = 'ACCOUNT' then 'USER_OFFBOARDED' else 'HR_ACCESS_ENDED' end, 'NA_VEDOMI',
    case when p_mode = 'ACCOUNT' then 'Účet zablokován (odchod z firmy): ' else 'Ukončen přístup do HR: ' end || coalesce(v_email, '?'),
    'auth_user', p_user_id::text, null, jsonb_build_object('reason', trim(p_reason)), p_actor);
end $$;
revoke all on function public.hr_offboard_user(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.hr_offboard_user(uuid, uuid, text, text) to service_role;

-- ---------- nove zariadenie ----------
-- Zariadenie = user agent bez cisel verzii (aktualizacia prehliadaca nie je
-- nove zariadenie). Obmedzenie: dva pocitace s rovnakym systemom a
-- prehliadacom sa nerozlisia; IP sa nepouziva (sukromie, meni sa).
create table if not exists public.hr_known_devices (
  user_id uuid not null,
  device_key text not null,
  user_agent text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (user_id, device_key)
);
alter table public.hr_known_devices enable row level security;
revoke all on public.hr_known_devices from anon, authenticated;

create or replace function public.hr_device_key(p_user_agent text)
returns text language sql immutable as $$
  select md5(regexp_replace(lower(coalesce(p_user_agent, '')), '[0-9]+([._][0-9]+)*', '', 'g'));
$$;

create or replace function public.hr_sessions_new_device()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_key text; v_had boolean; v_email text;
begin
  if new.user_agent is null or not public.hr_is_hr_account(new.user_id) then return new; end if;
  v_key := public.hr_device_key(new.user_agent);
  if exists (select 1 from public.hr_known_devices where user_id = new.user_id and device_key = v_key) then
    update public.hr_known_devices set last_seen = now() where user_id = new.user_id and device_key = v_key;
    return new;
  end if;
  v_had := exists (select 1 from public.hr_known_devices where user_id = new.user_id);
  insert into public.hr_known_devices (user_id, device_key, user_agent) values (new.user_id, v_key, left(new.user_agent, 500))
    on conflict do nothing;
  -- prve zariadenie uctu sa len zapise (zavedenie), dalsie = upozornenie
  if v_had then
    select email into v_email from auth.users where id = new.user_id;
    perform public.hr_notify('NEW_DEVICE', 'NA_VEDOMI', 'Přihlášení z nového zařízení: ' || coalesce(v_email, '?'),
      'auth_user', new.user_id::text, null, jsonb_build_object('user_agent', left(new.user_agent, 300)));
  end if;
  return new;
exception when others then
  return new; -- zaznam nesmie zablokovat prihlasenie
end $$;
revoke all on function public.hr_sessions_new_device() from public, anon, authenticated;
drop trigger if exists hr_sessions_new_device on auth.sessions;
create trigger hr_sessions_new_device after insert or update of user_agent on auth.sessions
  for each row execute function public.hr_sessions_new_device();
