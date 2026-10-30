-- Migracia 79: hr_nastaveni (kluc -> jsonb), prvy kluc "lekar_kontakt" pre
-- pokyny k lekarskej prehliadke. V main uz je (supabase/2026-10-30_hr_nastaveni.sql,
-- na produkcii spustene 2026-10-30 s rolou 'office'); tu idempotentne
-- a s hr_role_ok(), aby ho videla aj rola 'personalistika'.
create table if not exists public.hr_nastaveni (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) default auth.uid()
);
alter table public.hr_nastaveni enable row level security;

drop policy if exists "hr_nastaveni_view" on public.hr_nastaveni;
create policy "hr_nastaveni_view" on public.hr_nastaveni
  for select
  using (public.hr_role_ok() and public.hr_has_permission('HR_VIEW_BASIC'));

drop policy if exists "hr_nastaveni_edit" on public.hr_nastaveni;
create policy "hr_nastaveni_edit" on public.hr_nastaveni
  for all
  using (public.hr_role_ok() and public.hr_has_permission('HR_EDIT'))
  with check (public.hr_role_ok() and public.hr_has_permission('HR_EDIT'));

drop trigger if exists audit_hr_nastaveni on public.hr_nastaveni;
create trigger audit_hr_nastaveni after insert or update or delete on public.hr_nastaveni
  for each row execute function public.audit_trigger();
