-- ============================================================
-- 49. inventury - fyzicka inventura skladu (suroviny, obaly).
--     Sklad spocita naslepo (ROZPRACOVANA -> SPOCITANA), kancelaria oceni
--     a uzavrie (UZAVRENA). Rozdiely sa pri uzavreti zapisu ako bezne
--     pohyby do goods_receipts / stock_issues (data.inventuraId).
--     Uzavretu inventuru uz nikto nezmeni ani nezmaze.
--     Spustit JEDNORAZOVO v Supabase -> SQL Editor (je idempotentne).
--     Rovnaky obsah je aj na konci supabase/schema.sql (sekcia 49).
-- ============================================================

create table if not exists public.inventury (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.inventury enable row level security;

drop policy if exists "inventury_select" on public.inventury;
create policy "inventury_select" on public.inventury
  for select
  using (public.current_role() in ('office', 'sklad'));

drop policy if exists "inventury_insert" on public.inventury;
create policy "inventury_insert" on public.inventury
  for insert
  with check (public.current_role() in ('office', 'sklad') and data->>'stav' in ('ROZPRACOVANA', 'SPOCITANA'));

drop policy if exists "inventury_update" on public.inventury;
create policy "inventury_update" on public.inventury
  for update
  using (public.current_role() in ('office', 'sklad') and data->>'stav' <> 'UZAVRENA')
  with check (
    (public.current_role() = 'office' and data->>'stav' in ('ROZPRACOVANA', 'SPOCITANA', 'UZAVRENA'))
    or (public.current_role() = 'sklad' and data->>'stav' in ('ROZPRACOVANA', 'SPOCITANA'))
  );

drop policy if exists "inventury_delete" on public.inventury;
create policy "inventury_delete" on public.inventury
  for delete
  using (public.current_role() = 'office' and data->>'stav' <> 'UZAVRENA');

drop trigger if exists audit_inventury on public.inventury;
create trigger audit_inventury after insert or update or delete on public.inventury
  for each row execute function public.audit_trigger();
