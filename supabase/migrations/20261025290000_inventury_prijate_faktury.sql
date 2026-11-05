-- Z main: inventura skladu + faktury z e-mailu (v produkcii spustene 2026-11-05).

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

-- ============================================================
-- 50. prijate_faktury - faktury dodavatelov nacitane automaticky zo schranky
--     (Edge Function invoice-inbox). Zapisuje ich len funkcia (service role),
--     kancelaria ich v Prijme tovaru skontroluje a napáruje na prijmy.
--     Stavy: KE_KONTROLE, ZPRACOVANA, NESKLADOVA, NIE_JE_FAKTURA.
--     Spustit JEDNORAZOVO v Supabase -> SQL Editor (je idempotentne).
--     Rovnaky obsah (bez casti B) je aj na konci supabase/schema.sql (sekcia 50).
-- ============================================================

-- A. Tabulka, pristup, token pre cron ---------------------------------

create table if not exists public.prijate_faktury (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.prijate_faktury enable row level security;

drop policy if exists "prijate_faktury_select" on public.prijate_faktury;
create policy "prijate_faktury_select" on public.prijate_faktury
  for select
  using (public.current_role() = 'office');

drop policy if exists "prijate_faktury_update" on public.prijate_faktury;
create policy "prijate_faktury_update" on public.prijate_faktury
  for update
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office' and data->>'stav' in ('KE_KONTROLE', 'ZPRACOVANA', 'NESKLADOVA', 'NIE_JE_FAKTURA'));

drop trigger if exists audit_prijate_faktury on public.prijate_faktury;
create trigger audit_prijate_faktury after insert or update or delete on public.prijate_faktury
  for each row execute function public.audit_trigger();

-- Nahodny token, ktorym sa cron preukazuje funkcii. Vznikne raz v Supabase Vault,
-- nikto ho nemusi kopirovat (funkcia ho overi cez RPC nizsie).
create extension if not exists supabase_vault;
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'invoice_inbox_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'invoice_inbox_token');
  end if;
end $$;

create or replace function public.invoice_inbox_token_ok(p_token text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'invoice_inbox_token' and decrypted_secret = p_token
  );
$$;
revoke all on function public.invoice_inbox_token_ok(text) from public, anon, authenticated;
grant execute on function public.invoice_inbox_token_ok(text) to service_role;
