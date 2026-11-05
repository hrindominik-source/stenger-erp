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

-- B. Automaticke spustanie raz denne rano (az PO nasadeni funkcie) -----
--    <PROJEKT> nahradte adresou projektu (Settings -> API -> Project URL).
--    Jeden beh spracuje najviac 4 nove PDF (casovy limit funkcie), preto sa
--    rano spusti viackrat po 5 min: 5:00-6:55 UTC = 6:00-7:55 v zime,
--    7:00-8:55 v lete (az ~96 faktur denne). Behy bez novej faktury AI nevolaju.
--
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
-- select cron.schedule('invoice-inbox', '*/5 5-6 * * *', $cron$
--   select net.http_post(
--     url := 'https://<PROJEKT>.supabase.co/functions/v1/invoice-inbox',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-inbox-token', (select decrypted_secret from vault.decrypted_secrets where name = 'invoice_inbox_token')
--     ),
--     body := '{}'::jsonb,
--     timeout_milliseconds := 150000
--   );
-- $cron$);
--
-- Zrusenie: select cron.unschedule('invoice-inbox');
