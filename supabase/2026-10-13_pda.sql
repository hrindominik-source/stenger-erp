-- ============================================================
-- PDA / Expedice - vydajky skenovane na Zebra TC25 (?pda=1) + prehlad v Office.
--
-- Iba PRIDAVA nove tabulky/funkcie/politiky - nemeni ziadnu existujucu tabulku
-- (orders, expedicia_zaznamy, zasoby...). Skript je idempotentny (mozno ho
-- spustit opakovane) a spusta sa rucne v Supabase SQL Editore.
-- Automaticky test: src/pda/pdaMigration.test.js (PGlite = Postgres vo WASM).
-- Odvolanie: supabase/2026-10-13_pda_rollback.sql
--
-- Pravidla vynucovane v DB (nie len v UI):
--   * pristup len rola office/sklad (RLS cez public.current_role()), anon nic,
--   * do dokoncenej vydajky nejde pridat/zmazat/presunut paletu (trigger),
--   * SSCC je v jednej vydajke max. raz (unique) a nesmie byt v inej
--     DOKONCENEJ vydajke (trigger pri vlozeni palety aj pri dokonceni),
--   * dokoncenu vydajku moze znovu otvorit/upravit/zmazat len office,
--   * sklad nesmie nastavit order_id, dokoncena_at, created_by ani created_at
--     (server ich nastavuje sam), zmazat smie len prazdnu rozpracovanu vydajku.
-- ============================================================

create table if not exists public.pda_vydajky (
  id text primary key check (length(id) between 1 and 64),
  cislo_lieferschein text not null check (length(trim(cislo_lieferschein)) between 1 and 50),
  stav text not null default 'rozpracovana' check (stav in ('rozpracovana', 'dokoncena')),
  pracovnik text not null default '' check (length(pracovnik) <= 100),
  dokoncil text not null default '' check (length(dokoncil) <= 100),
  poznamka text not null default '' check (length(poznamka) <= 1000),
  -- Buduce prepojenie s objednavkou Stenger ONE (orders.id). Zatial sa
  -- nevyplna ani nezobrazuje - pripravene, aby neskor nebola nutna migracia.
  -- Menit ho smie len office (trigger).
  order_id text null references public.orders(id) on delete set null,
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) <= 10000),
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  dokoncena_at timestamptz null
);

create index if not exists pda_vydajky_created_at_idx on public.pda_vydajky (created_at desc);
create index if not exists pda_vydajky_lieferschein_idx on public.pda_vydajky (cislo_lieferschein);
create index if not exists pda_vydajky_order_idx on public.pda_vydajky (order_id) where order_id is not null;

create table if not exists public.pda_palety (
  id text primary key check (length(id) between 1 and 64),
  vydajka_id text not null references public.pda_vydajky(id) on delete cascade,
  sscc text not null check (sscc ~ '^[0-9]{18}$'),
  gtin text null check (gtin is null or gtin ~ '^[0-9]{14}$'),
  -- AI 15 = minimalna trvanlivost (BBD), AI 17 = datum spotreby; ulozene
  -- uz prepocitane podla GS1 pravidiel (rok/storocie, den 00 = koniec mesiaca).
  bbd date null,
  bbd_ai text null check (bbd_ai is null or bbd_ai in ('15', '17')),
  sarza text null check (sarza is null or length(sarza) <= 20),
  mnozstvo integer null check (mnozstvo is null or mnozstvo between 0 and 99999999),
  raw_sscc text not null default '' check (length(raw_sscc) <= 200),
  raw_produkt text not null default '' check (length(raw_produkt) <= 200),
  pracovnik text not null default '' check (length(pracovnik) <= 100),
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) <= 10000),
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique (vydajka_id, sscc)
);

create index if not exists pda_palety_vydajka_idx on public.pda_palety (vydajka_id);
create index if not exists pda_palety_sscc_idx on public.pda_palety (sscc);

-- ------------------------------------------------------------
-- Triggre
-- ------------------------------------------------------------

-- Paleta: vlozenie/zmena/zmazanie len v rozpracovanej vydajke + SSCC nesmie
-- byt v inej dokoncenej vydajke. Chybova hlaska zacina "PDA_..." - appka ju
-- rozpozna a zobrazi zrozumitelne.
create or replace function public.pda_palety_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stav text;
  v_ls text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select stav into v_stav from public.pda_vydajky where id = old.vydajka_id;
    -- Pri kaskadovom mazani celej vydajky uz rodic neexistuje -> povolit.
    if v_stav = 'dokoncena' then
      raise exception 'PDA_VYDAJKA_DOKONCENA: Výdejka je dokončená, paletu nelze měnit ani smazat.';
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
  end if;

  if tg_op = 'INSERT' then
    -- Serverove hodnoty - klient ich nemoze podvrhnut.
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.id := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;

  select stav into v_stav from public.pda_vydajky where id = new.vydajka_id;
  if v_stav is distinct from 'rozpracovana' then
    raise exception 'PDA_VYDAJKA_DOKONCENA: Výdejka není rozpracovaná, paletu nelze přidat.';
  end if;

  select v.cislo_lieferschein into v_ls
  from public.pda_palety p
  join public.pda_vydajky v on v.id = p.vydajka_id
  where p.sscc = new.sscc and v.stav = 'dokoncena' and p.vydajka_id <> new.vydajka_id
  limit 1;
  if v_ls is not null then
    raise exception 'PDA_SSCC_DUPLICITA: SSCC % je již v dokončené výdejce %.', new.sscc, v_ls;
  end if;
  return new;
end;
$$;

drop trigger if exists pda_palety_guard_trg on public.pda_palety;
create trigger pda_palety_guard_trg
  before insert or update or delete on public.pda_palety
  for each row execute function public.pda_palety_guard();

-- Vydajka - vlozenie: serverove hodnoty, order_id len office.
create or replace function public.pda_vydajky_insert_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.stav := 'rozpracovana';
  new.dokoncena_at := null;
  new.dokoncil := '';
  new.created_by := auth.uid();
  new.created_at := now();
  new.updated_at := now();
  if new.order_id is not null and coalesce(public.current_role(), '') <> 'office' then
    raise exception 'PDA_ORDER_ID: Propojení s objednávkou smí nastavit jen kancelář.';
  end if;
  return new;
end;
$$;

drop trigger if exists pda_vydajky_insert_guard_trg on public.pda_vydajky;
create trigger pda_vydajky_insert_guard_trg
  before insert on public.pda_vydajky
  for each row execute function public.pda_vydajky_insert_guard();

-- Vydajka - zmena: dokoncenie (min. 1 paleta, ziadne SSCC v inej dokoncenej
-- vydajke), znovuotvorenie / uprava dokoncenej len pre office.
create or replace function public.pda_vydajky_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dup text;
  v_office boolean := coalesce(public.current_role(), '') = 'office';
begin
  if new.id <> old.id then
    raise exception 'PDA_ZMENA_ID: ID výdejky nelze měnit.';
  end if;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();

  if old.stav = 'dokoncena' and not v_office then
    raise exception 'PDA_VYDAJKA_DOKONCENA: Dokončenou výdejku může měnit jen kancelář.';
  end if;
  -- Nastavit/zmenit order_id smie len office; vynulovanie (aj cez
  -- "on delete set null" pri zmazani objednavky) je povolene.
  if new.order_id is distinct from old.order_id and not v_office and new.order_id is not null then
    raise exception 'PDA_ORDER_ID: Propojení s objednávkou smí měnit jen kancelář.';
  end if;

  if new.stav = 'dokoncena' and old.stav <> 'dokoncena' then
    -- Serializuje subezne dokoncovania, aby dve vydajky s rovnakym SSCC
    -- nemohli prejst kontrolou naraz.
    perform pg_advisory_xact_lock(hashtext('pda_vydajky_dokoncenie'));

    if not exists (select 1 from public.pda_palety where vydajka_id = new.id) then
      raise exception 'PDA_PRAZDNA: Výdejka nemá žádnou paletu.';
    end if;

    select p.sscc || ' (výdejka ' || v.cislo_lieferschein || ')' into v_dup
    from public.pda_palety p
    join public.pda_palety o on o.sscc = p.sscc and o.vydajka_id <> p.vydajka_id
    join public.pda_vydajky v on v.id = o.vydajka_id and v.stav = 'dokoncena'
    where p.vydajka_id = new.id
    limit 1;
    if v_dup is not null then
      raise exception 'PDA_SSCC_DUPLICITA: SSCC % je již v dokončené výdejce.', v_dup;
    end if;

    new.dokoncena_at := now();
  elsif new.stav = 'rozpracovana' then
    new.dokoncena_at := null;
    new.dokoncil := '';
  else
    -- dokoncena -> dokoncena (uprava poznamky v office): cas sa nemeni.
    new.dokoncena_at := old.dokoncena_at;
  end if;
  return new;
end;
$$;

drop trigger if exists pda_vydajky_guard_trg on public.pda_vydajky;
create trigger pda_vydajky_guard_trg
  before update on public.pda_vydajky
  for each row execute function public.pda_vydajky_guard();

-- Triggrove funkcie nie su urcene na volanie cez API.
revoke all on function public.pda_palety_guard() from public, anon, authenticated;
revoke all on function public.pda_vydajky_insert_guard() from public, anon, authenticated;
revoke all on function public.pda_vydajky_guard() from public, anon, authenticated;

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.pda_vydajky enable row level security;
alter table public.pda_palety enable row level security;

-- Neprihlaseny (anon) kluc nema k PDA tabulkam ziadny pristup ani na urovni grantov.
revoke all on public.pda_vydajky from anon;
revoke all on public.pda_palety from anon;
grant select, insert, update, delete on public.pda_vydajky to authenticated;
grant select, insert, update, delete on public.pda_palety to authenticated;

drop policy if exists "pda_vydajky_select" on public.pda_vydajky;
create policy "pda_vydajky_select" on public.pda_vydajky
  for select
  using (public.current_role() in ('office', 'sklad'));

drop policy if exists "pda_vydajky_insert" on public.pda_vydajky;
create policy "pda_vydajky_insert" on public.pda_vydajky
  for insert
  with check (public.current_role() in ('office', 'sklad') and stav = 'rozpracovana');

drop policy if exists "pda_vydajky_update_office" on public.pda_vydajky;
create policy "pda_vydajky_update_office" on public.pda_vydajky
  for update
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');

-- Sklad smie upravit/dokoncit len rozpracovanu vydajku (znovu otvorit nie).
drop policy if exists "pda_vydajky_update_sklad" on public.pda_vydajky;
create policy "pda_vydajky_update_sklad" on public.pda_vydajky
  for update
  using (public.current_role() = 'sklad' and stav = 'rozpracovana')
  with check (public.current_role() = 'sklad');

drop policy if exists "pda_vydajky_delete_office" on public.pda_vydajky;
create policy "pda_vydajky_delete_office" on public.pda_vydajky
  for delete
  using (public.current_role() = 'office');

-- Sklad smie zrusit len omylom zalozenu, este PRAZDNU rozpracovanu vydajku.
drop policy if exists "pda_vydajky_delete_sklad" on public.pda_vydajky;
create policy "pda_vydajky_delete_sklad" on public.pda_vydajky
  for delete
  using (
    public.current_role() = 'sklad'
    and stav = 'rozpracovana'
    and not exists (select 1 from public.pda_palety p where p.vydajka_id = pda_vydajky.id)
  );

drop policy if exists "pda_palety_select" on public.pda_palety;
create policy "pda_palety_select" on public.pda_palety
  for select
  using (public.current_role() in ('office', 'sklad'));

drop policy if exists "pda_palety_insert" on public.pda_palety;
create policy "pda_palety_insert" on public.pda_palety
  for insert
  with check (public.current_role() in ('office', 'sklad'));

drop policy if exists "pda_palety_update_office" on public.pda_palety;
create policy "pda_palety_update_office" on public.pda_palety
  for update
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');

drop policy if exists "pda_palety_delete" on public.pda_palety;
create policy "pda_palety_delete" on public.pda_palety
  for delete
  using (public.current_role() in ('office', 'sklad'));

-- ------------------------------------------------------------
-- Realtime - Office prehlad vidi nove skeny okamzite.
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pda_vydajky'
  ) then
    alter publication supabase_realtime add table public.pda_vydajky;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pda_palety'
  ) then
    alter publication supabase_realtime add table public.pda_palety;
  end if;
end $$;
