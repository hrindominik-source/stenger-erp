-- ============================================================
-- 52. prijem_rozpracovany - rozpracovany prijem tovaru zdielany medzi
--     zariadeniami (tablet odfoti dodaci list, PDA naskenuje palety).
--     Nemeni sklad; po ulozeni prijmu sa riadok zmaze.
--     Spustit JEDNORAZOVO v Supabase -> SQL Editor (je idempotentne).
--     Rovnaky obsah je aj na konci supabase/schema.sql (sekcia 52).
-- ============================================================

create table if not exists public.prijem_rozpracovany (
  id text primary key,
  data jsonb not null check (pg_column_size(data) <= 200000),
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.prijem_rozpracovany enable row level security;

drop policy if exists "prijem_rozpracovany_all" on public.prijem_rozpracovany;
create policy "prijem_rozpracovany_all" on public.prijem_rozpracovany
  for all
  using (public.current_role() in ('office', 'sklad'))
  with check (public.current_role() in ('office', 'sklad'));

drop trigger if exists audit_prijem_rozpracovany on public.prijem_rozpracovany;
create trigger audit_prijem_rozpracovany after insert or update or delete on public.prijem_rozpracovany
  for each row execute function public.audit_trigger();
