-- ============================================================
-- 53. Mzdy - podklad pre uctovnicku z dochadzky (zalozka Docházka -> Mzdy).
--     Nie je prepojene s Personalistikou. Pristup ma len pouzivatel
--     zapisany v mzdy_pristup (admin + personalistika) - riadky sa
--     pridavaju rucne v SQL editore, appka ich nevie menit.
--     Samostatne: supabase/2026-11-13_mzdy.sql
-- ============================================================

create table if not exists public.mzdy_pristup (
  user_id uuid primary key references auth.users(id) on delete cascade,
  poznamka text,
  created_at timestamptz not null default now()
);
alter table public.mzdy_pristup enable row level security;

-- Kazdy vidi len, ci ma pristup on sam. Insert/update/delete len cez SQL editor.
drop policy if exists "mzdy_pristup_self" on public.mzdy_pristup;
create policy "mzdy_pristup_self" on public.mzdy_pristup
  for select
  using (user_id = auth.uid());

create or replace function public.ma_pristup_mzdy()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.mzdy_pristup where user_id = auth.uid());
$$;

-- Legenda (sadzby skupin) - verzie podla platnosti od mesiaca ("RRRR-MM").
create table if not exists public.mzdy_legenda (
  id text primary key,
  platnost_od text not null check (platnost_od ~ '^\d{4}-\d{2}$'),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Predvolena skupina pracovnika (kluc = meno ako vo workers/dochadzke).
create table if not exists public.mzdy_pracovnici (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Mesacne rucne udaje (id = "RRRR-MM|meno").
create table if not exists public.mzdy_mesiac (
  id text primary key,
  mesiac text not null check (mesiac ~ '^\d{4}-\d{2}$'),
  meno text not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists mzdy_mesiac_mesiac_idx on public.mzdy_mesiac (mesiac);

alter table public.mzdy_legenda enable row level security;
alter table public.mzdy_pracovnici enable row level security;
alter table public.mzdy_mesiac enable row level security;

drop policy if exists "mzdy_legenda_pristup" on public.mzdy_legenda;
create policy "mzdy_legenda_pristup" on public.mzdy_legenda
  for all using (public.ma_pristup_mzdy()) with check (public.ma_pristup_mzdy());

drop policy if exists "mzdy_pracovnici_pristup" on public.mzdy_pracovnici;
create policy "mzdy_pracovnici_pristup" on public.mzdy_pracovnici
  for all using (public.ma_pristup_mzdy()) with check (public.ma_pristup_mzdy());

drop policy if exists "mzdy_mesiac_pristup" on public.mzdy_mesiac;
create policy "mzdy_mesiac_pristup" on public.mzdy_mesiac
  for all using (public.ma_pristup_mzdy()) with check (public.ma_pristup_mzdy());

drop trigger if exists audit_mzdy_legenda on public.mzdy_legenda;
create trigger audit_mzdy_legenda after insert or update or delete on public.mzdy_legenda
  for each row execute function public.audit_trigger();
drop trigger if exists audit_mzdy_pracovnici on public.mzdy_pracovnici;
create trigger audit_mzdy_pracovnici after insert or update or delete on public.mzdy_pracovnici
  for each row execute function public.audit_trigger();
drop trigger if exists audit_mzdy_mesiac on public.mzdy_mesiac;
create trigger audit_mzdy_mesiac after insert or update or delete on public.mzdy_mesiac
  for each row execute function public.audit_trigger();

notify pgrst, 'reload schema';

-- Pristup sa prideluje rucne (nie je sucastou migracie):
--   insert into public.mzdy_pristup (user_id, poznamka)
--   select id, 'admin' from auth.users where email = '...';
