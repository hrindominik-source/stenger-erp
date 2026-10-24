-- Rollback migracie 67 (povinne dvojfazove prihlasenie). Po rollbacku staci
-- na HR opat heslo; zaregistrovane faktory v Auth ostanu (nevadia).
begin;

create or replace function public.hr_my_permissions()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.permissions from public.hr_permissions p
    where (p.user_id = auth.uid() or (p.user_id is null and p.user_email = lower(auth.email())))
      and (p.valid_from is null or p.valid_from <= current_date)
      and (p.valid_until is null or p.valid_until >= current_date)
    order by (p.user_id = auth.uid()) desc nulls last
    limit 1), '{}'::text[]);
$$;

drop function if exists public.hr_mfa_status();
drop function if exists public.hr_mfa_required();
drop function if exists public.hr_my_permission_row();
delete from public.hr_settings where key = 'mfa';

commit;
