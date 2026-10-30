-- ============================================================
-- 48. hr_nastaveni - nastavenia Personalistiky (kluc -> jsonb hodnota).
--     Prvy kluc: "lekar_kontakt" = kontakt na lekara pre pokyny
--     k lekarskej prehliadke ({ volat, telefon, ordinace }).
--     Spustit JEDNORAZOVO v Supabase -> SQL Editor (je idempotentne).
--     Rovnaky obsah je aj na konci supabase/schema.sql (sekcia 48).
--     Citat moze HR_VIEW_BASIC, menit HR_EDIT. Zmeny zapisuje audit_trigger.
-- ============================================================

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
  using (public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_BASIC'));

drop policy if exists "hr_nastaveni_edit" on public.hr_nastaveni;
create policy "hr_nastaveni_edit" on public.hr_nastaveni
  for all
  using (public.current_role() = 'office' and public.hr_has_permission('HR_EDIT'))
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_EDIT'));

drop trigger if exists audit_hr_nastaveni on public.hr_nastaveni;
create trigger audit_hr_nastaveni after insert or update or delete on public.hr_nastaveni
  for each row execute function public.audit_trigger();
