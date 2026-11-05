-- ============================================================
-- 51. skladove_karty - priradenie kodu produktu z paletovej etikety (GTIN)
--     k materialu skladu: ktory material, jednotka, kolko jednotiek je
--     v 1 baleni a trvanlivost (ked etiketa nema DMT). Vznikaju pri prvom
--     skene neznameho produktu na prijme, upravit ich moze sklad aj kancelaria.
--     Sarza, DMT a palety (SSCC) sa ukladaju priamo v goods_receipts.data.
--     Spustit JEDNORAZOVO v Supabase -> SQL Editor (je idempotentne).
--     Rovnaky obsah je aj na konci supabase/schema.sql (sekcia 51).
-- ============================================================

create table if not exists public.skladove_karty (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.skladove_karty enable row level security;

drop policy if exists "skladove_karty_select" on public.skladove_karty;
create policy "skladove_karty_select" on public.skladove_karty
  for select
  using (public.current_role() in ('office', 'sklad'));

drop policy if exists "skladove_karty_insert" on public.skladove_karty;
create policy "skladove_karty_insert" on public.skladove_karty
  for insert
  with check (public.current_role() in ('office', 'sklad'));

drop policy if exists "skladove_karty_update" on public.skladove_karty;
create policy "skladove_karty_update" on public.skladove_karty
  for update
  using (public.current_role() in ('office', 'sklad'))
  with check (public.current_role() in ('office', 'sklad'));

drop policy if exists "skladove_karty_delete" on public.skladove_karty;
create policy "skladove_karty_delete" on public.skladove_karty
  for delete
  using (public.current_role() = 'office');

drop trigger if exists audit_skladove_karty on public.skladove_karty;
create trigger audit_skladove_karty after insert or update or delete on public.skladove_karty
  for each row execute function public.audit_trigger();
