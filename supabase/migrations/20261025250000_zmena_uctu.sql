-- Migracia 78 (rozhodnutie 2026-10-29): zmena cisla bankoveho uctu.
-- 1. Pri kazdej zmene (aj prvom zadani, aj zo servera/kiosku) dostane jednatel
--    upozornenie - bez celeho cisla, len posledne 4 cislice a kto zmenil.
-- 2. V mzdovych udajoch sa zobrazi "Účet změněn od poslední výplaty – ověřte",
--    kym zmenu nepotvrdi jednatel alebo uctovnicka (mzdovy pristup bez prava
--    upravovat). Kto ucet zmenil, zmenu sam nepotvrdi (styri oci).

create table if not exists public.hr_bank_account_checks (
  employee_id text primary key references public.employees(id) on delete cascade,
  last4 text,
  changed_at timestamptz not null default now(),
  changed_by uuid,
  changed_by_name text not null,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id)
);
alter table public.hr_bank_account_checks enable row level security;
revoke all on public.hr_bank_account_checks from anon, authenticated;
grant select on public.hr_bank_account_checks to authenticated;
create policy hr_bank_account_checks_select on public.hr_bank_account_checks for select
  using (public.hr_role_ok() and (public.hr_has_permission('HR_ADMIN') or public.hr_has_permission('HR_VIEW_PAYROLL')));
drop trigger if exists audit_hr_bank_account_checks on public.hr_bank_account_checks;
create trigger audit_hr_bank_account_checks after insert or update on public.hr_bank_account_checks
  for each row execute function public.audit_trigger();

-- Posledne 4 cislice cisla uctu (bez kodu banky za lomitkom); nic viac.
create or replace function public.hr_bank_account_last4(p_account text)
returns text language sql immutable as $$
  select nullif(right(regexp_replace(split_part(coalesce(p_account, ''), '/', 1), '\D', '', 'g'), 4), '');
$$;

create or replace function public.hr_bank_account_changed()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_last4 text; v_by uuid := auth.uid(); v_by_name text; v_emp text;
begin
  -- server (kiosk, edge funkcie) = rola poziadavky service_role, nie pouzivatel
  if current_setting('role', true) = 'service_role' then v_by := null; end if;
  if TG_OP = 'INSERT' and nullif(trim(coalesce(new.bank_account, '')), '') is null then return new; end if;
  if TG_OP = 'UPDATE' and new.bank_account is not distinct from old.bank_account then return new; end if;
  v_last4 := public.hr_bank_account_last4(new.bank_account);
  v_by_name := case when v_by is null then 'server (např. kiosk)'
    else coalesce((select full_name from public.profiles where id = v_by), (select email from auth.users where id = v_by), 'neznámý uživatel') end;
  select first_name || ' ' || last_name into v_emp from public.employees where id = new.employee_id;
  insert into public.hr_bank_account_checks (employee_id, last4, changed_at, changed_by, changed_by_name, confirmed_at, confirmed_by)
  values (new.employee_id, v_last4, now(), v_by, v_by_name, null, null)
  on conflict (employee_id) do update set last4 = excluded.last4, changed_at = excluded.changed_at, changed_by = excluded.changed_by,
    changed_by_name = excluded.changed_by_name, confirmed_at = null, confirmed_by = null;
  perform public.hr_notify('BANK_ACCOUNT_CHANGED', 'NA_VEDOMI',
    'Změna čísla účtu: ' || coalesce(v_emp, new.employee_id)
      || case when v_last4 is null then ' – účet odebrán' else ' – nový účet končí …' || v_last4 end
      || ' (změnil: ' || v_by_name || ')',
    'employees', new.employee_id, new.employee_id,
    jsonb_build_object('last4', v_last4, 'changed_by', v_by, 'changed_by_name', v_by_name), v_by);
  return new;
end $$;
revoke all on function public.hr_bank_account_changed() from public, anon, authenticated;
drop trigger if exists hr_bank_account_changed on public.employee_sensitive_data;
create trigger hr_bank_account_changed after insert or update of bank_account on public.employee_sensitive_data
  for each row execute function public.hr_bank_account_changed();

-- Potvrdenie: jednatel alebo uctovnicka (mzdovy pristup bez prava upravovat),
-- nie ten, kto ucet zmenil.
create or replace function public.hr_bank_account_confirm(p_employee_id text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare c public.hr_bank_account_checks;
begin
  if not (public.hr_role_ok() and (public.hr_has_permission('HR_ADMIN')
      or (public.hr_has_permission('HR_VIEW_PAYROLL') and not public.hr_has_permission('HR_EDIT')))) then
    raise exception 'Změnu účtu potvrzuje jednatel nebo účetní.' using errcode = '42501';
  end if;
  select * into c from public.hr_bank_account_checks where employee_id = p_employee_id for update;
  if not found or c.confirmed_at is not null then raise exception 'Žádná nepotvrzená změna účtu.'; end if;
  if c.changed_by = auth.uid() then raise exception 'Vlastní změnu účtu nelze potvrdit (čtyři oči).' using errcode = '42501'; end if;
  update public.hr_bank_account_checks set confirmed_at = now(), confirmed_by = auth.uid() where employee_id = p_employee_id;
end $$;
revoke all on function public.hr_bank_account_confirm(text) from public, anon;
grant execute on function public.hr_bank_account_confirm(text) to authenticated;
