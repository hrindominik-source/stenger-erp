-- ============================================================
-- 67. Dvojfazove prihlasenie (TOTP cez autentifikacnu aplikaciu) pre
--     Personalistiku - rozhodnutie jednatela 2026-10-24: povinne pre
--     profily Jednatel a Personalista.
--   - Bez overenia druhym faktorom (JWT aal2) nema pouzivatel s povinnym
--     MFA ziadne HR opravnenia: hr_my_permissions() vrati prazdne pole, takze
--     RLS, uloziste aj serverove funkcie (authorize -> hr_get_permissions)
--     ho odmietnu. Aplikacia mu namiesto toho ukaze registraciu / overenie.
--   - Zoznam profilov je v hr_settings 'mfa' (zmenu vidi jednatel v prehlade).
-- ============================================================

insert into public.hr_settings (key, value, description) values
  ('mfa', '{"required_profiles": ["KONATEL", "PERSONALISTA"]}',
   'Povinné dvoufázové ověření (kód z aplikace) pro tyto profily oprávnění v Personalistice.')
on conflict (key) do nothing;

-- Riadok opravneni aktualneho pouzivatela (bez ohladu na MFA).
create or replace function public.hr_my_permission_row()
returns public.hr_permissions language sql stable security definer set search_path = public as $$
  select p.* from public.hr_permissions p
  where (p.user_id = auth.uid() or (p.user_id is null and p.user_email = lower(auth.email())))
    and (p.valid_from is null or p.valid_from <= current_date)
    and (p.valid_until is null or p.valid_until >= current_date)
  order by (p.user_id = auth.uid()) desc nulls last
  limit 1;
$$;
revoke execute on function public.hr_my_permission_row() from public, anon, authenticated;

create or replace function public.hr_mfa_required()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((public.hr_my_permission_row()).profile = any (array(
    select jsonb_array_elements_text(coalesce(public.hr_setting('mfa')->'required_profiles', '["KONATEL", "PERSONALISTA"]'::jsonb)))), false);
$$;
revoke execute on function public.hr_mfa_required() from public, anon;
grant execute on function public.hr_mfa_required() to authenticated, service_role;

create or replace function public.hr_my_permissions()
returns text[] language sql stable security definer set search_path = public as $$
  select case
    when public.hr_mfa_required() and coalesce(auth.jwt()->>'aal', '') <> 'aal2' then '{}'::text[]
    else coalesce((public.hr_my_permission_row()).permissions, '{}'::text[])
  end;
$$;

-- Pre aplikaciu: treba druhy faktor?
create or replace function public.hr_mfa_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'required', public.hr_mfa_required(),
    'aal', coalesce(auth.jwt()->>'aal', 'aal1'),
    'ok', not public.hr_mfa_required() or coalesce(auth.jwt()->>'aal', '') = 'aal2');
$$;
revoke execute on function public.hr_mfa_status() from public, anon;
grant execute on function public.hr_mfa_status() to authenticated;
