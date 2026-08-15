-- Stenger Mini ERP - Supabase schema
-- Spustit jednorazovo v Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Bezpecne spustit viackrat (pouziva "if not exists" / "or replace" / "on conflict").

-- ============================================================
-- 1. profiles - rola a meno pre kazdeho prihlaseneho pouzivatela
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('office', 'sklad', 'vyroba')),
  created_at timestamptz not null default now()
);

-- Ak tabulka uz existovala s povodnym check (role in ('office','sklad')), rozsirime ho o 'vyroba'.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('office', 'sklad', 'vyroba'));

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select
  using (id = auth.uid());

-- Helper: precita rolu aktualne prihlaseneho pouzivatela.
-- security definer, aby fungovala aj z vnutra dalsich RLS policies bez rekurzie.
create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- ============================================================
-- 2. company - nastavenia firmy (jeden riadok, id = 1) + pocitadla cisiel
-- ============================================================
create table if not exists public.company (
  id int primary key default 1,
  data jsonb not null default '{}'::jsonb,
  posledne_cislo_dopravy int not null default 60400,
  posledne_cislo_dodacieho_listu int not null default 60400,
  updated_at timestamptz not null default now()
);

insert into public.company (id, data, posledne_cislo_dopravy, posledne_cislo_dodacieho_listu)
values (1, '{}'::jsonb, 60400, 60400)
on conflict (id) do nothing;

alter table public.company enable row level security;

drop policy if exists "company_office_all" on public.company;
create policy "company_office_all" on public.company
  for all
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');

-- ============================================================
-- 3. carriers / customers - jednoduche zoznamy (id text = klientom generovane uid())
-- ============================================================
create table if not exists public.carriers (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.carriers enable row level security;
alter table public.customers enable row level security;

drop policy if exists "carriers_office_all" on public.carriers;
create policy "carriers_office_all" on public.carriers
  for all
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');

drop policy if exists "customers_office_all" on public.customers;
create policy "customers_office_all" on public.customers
  for all
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');

-- ============================================================
-- 3b. pricelist - cennik dopravy (jeden riadok, id = 1), naharty ako Excel/ODS v appke
-- ============================================================
create table if not exists public.pricelist (
  id int primary key default 1,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.pricelist (id, data)
values (1, '{}'::jsonb)
on conflict (id) do nothing;

alter table public.pricelist enable row level security;

drop policy if exists "pricelist_office_all" on public.pricelist;
create policy "pricelist_office_all" on public.pricelist
  for all
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');

-- ============================================================
-- 3c. pricelist_archive - stare/nahradene cenniky pre porovnanie (id text = klientom generovane uid())
-- ============================================================
create table if not exists public.pricelist_archive (
  id text primary key,
  data jsonb not null,
  file_name text,
  archived_at timestamptz not null default now()
);

alter table public.pricelist_archive enable row level security;

drop policy if exists "pricelist_archive_office_all" on public.pricelist_archive;
create policy "pricelist_archive_office_all" on public.pricelist_archive
  for all
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');

-- ============================================================
-- 4. orders - cely objekt v "data", + par duplicitnych stlpcov pre rolu Sklad
-- ============================================================
create table if not exists public.orders (
  id text primary key,
  data jsonb not null,
  zakaznik text not null default '',
  adresa_dodania_nazov text not null default '',
  adresa_dodania text not null default '',
  cislo_objednavky_dopravy text not null default '',
  cislo_dodacieho_listu text not null default '',
  stav_expedicie text not null default 'Neexpedovana' check (stav_expedicie in ('Neexpedovana', 'Expedovana')),
  expedovana_by uuid references auth.users(id),
  expedovana_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orders enable row level security;

-- Iba rola "office" ma priamy pristup k tabulke orders (vsetky stlpce).
-- Sklad k nej nema pristup vobec - pouziva vylucne get_orders_for_sklad() nizsie.
drop policy if exists "orders_office_all" on public.orders;
create policy "orders_office_all" on public.orders
  for all
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');

-- ============================================================
-- 5. RPC: get_orders_for_sklad() - len povolene stlpce, pre hocikoho prihlaseneho
--    (rozsirene o pocty paliet/paletovych miest/kartonov, zakaznicke cislo
--    objednavky (Belegnummer) a polozky - kvoli obrazovke Expedicia v Sklade)
-- ============================================================
drop function if exists public.get_orders_for_sklad();

create or replace function public.get_orders_for_sklad()
returns table (
  id text,
  zakaznik text,
  adresa_dodania_nazov text,
  adresa_dodania text,
  cislo_objednavky_dopravy text,
  cislo_dodacieho_listu text,
  cislo_objednavky_zakaznika text,
  stav_expedicie text,
  pocet_paliet text,
  pocet_paletovych_miest text,
  pocet_kartonov text,
  polozky jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    id, zakaznik, adresa_dodania_nazov, adresa_dodania, cislo_objednavky_dopravy, cislo_dodacieho_listu,
    data->>'cisloObjednavkyZakaznika',
    stav_expedicie,
    data->>'pocetPaliet',
    data->>'pocetPaletovychMiest',
    data->>'pocetKartonov',
    coalesce(data->'polozky', '[]'::jsonb)
  from public.orders
  order by created_at desc;
$$;

grant execute on function public.get_orders_for_sklad() to authenticated;

-- ============================================================
-- 6. RPC: set_expedovana(p_id, p_val) - jedina cesta na zmenu stavu expedicie
-- ============================================================
create or replace function public.set_expedovana(p_id text, p_val text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_val not in ('Expedovana', 'Neexpedovana') then
    raise exception 'Neplatna hodnota stavu expedicie: %', p_val;
  end if;
  if public.current_role() not in ('office', 'sklad') then
    raise exception 'Nemate opravnenie';
  end if;

  update public.orders
  set stav_expedicie = p_val,
      expedovana_by = auth.uid(),
      expedovana_at = now(),
      updated_at = now()
  where id = p_id;

  if not found then
    raise exception 'Objednavka nenajdena';
  end if;
end;
$$;

grant execute on function public.set_expedovana(text, text) to authenticated;

-- ============================================================
-- 7. RPC: next_order_numbers() - atomicke pridelenie cisla dopravy/dodacieho listu
-- ============================================================
create or replace function public.next_order_numbers()
returns table (doprava_num int, dodak_num int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doprava int;
  v_dodak int;
begin
  if public.current_role() <> 'office' then
    raise exception 'Nemate opravnenie';
  end if;

  update public.company
  set posledne_cislo_dopravy = posledne_cislo_dopravy + 1,
      posledne_cislo_dodacieho_listu = posledne_cislo_dodacieho_listu + 1,
      updated_at = now()
  where id = 1
  returning posledne_cislo_dopravy, posledne_cislo_dodacieho_listu
  into v_doprava, v_dodak;

  return query select v_doprava, v_dodak;
end;
$$;

grant execute on function public.next_order_numbers() to authenticated;

-- ============================================================
-- 8. Realtime - povolit zmeny na orders pre supabase-js .channel(...) subscriptions
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;

-- ============================================================
-- 10. suppliers (dodavatelia) - jednoduchy zoznam, rovnaky princip ako customers/carriers
-- ============================================================
create table if not exists public.suppliers (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.suppliers enable row level security;

drop policy if exists "suppliers_office_all" on public.suppliers;
create policy "suppliers_office_all" on public.suppliers
  for all
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');

-- ============================================================
-- 11. material_orders (register surovin a obalov) - oddeleny od orders, bez rieseni pre sklad
-- ============================================================
create table if not exists public.material_orders (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.material_orders enable row level security;

drop policy if exists "material_orders_office_all" on public.material_orders;
create policy "material_orders_office_all" on public.material_orders
  for all
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');

alter table public.company add column if not exists posledne_cislo_objednavky_material int not null default 0;
alter table public.company add column if not exists posledny_rok_objednavky_material int;

-- ============================================================
-- 12. RPC: next_material_order_number() - atomicke pridelenie cisla pre register surovin/obalov.
--     Cislo sa kazdy novy rok resetuje na 1 (format v appke: 0001/2026, 0002/2026, ...).
-- ============================================================
create or replace function public.next_material_order_number()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_num int;
  v_year int := extract(year from now())::int;
  v_stored_year int;
begin
  if public.current_role() <> 'office' then
    raise exception 'Nemate opravnenie';
  end if;

  select posledny_rok_objednavky_material into v_stored_year from public.company where id = 1;

  if v_stored_year is distinct from v_year then
    update public.company
    set posledne_cislo_objednavky_material = 1,
        posledny_rok_objednavky_material = v_year,
        updated_at = now()
    where id = 1
    returning posledne_cislo_objednavky_material
    into v_num;
  else
    update public.company
    set posledne_cislo_objednavky_material = posledne_cislo_objednavky_material + 1,
        updated_at = now()
    where id = 1
    returning posledne_cislo_objednavky_material
    into v_num;
  end if;

  return v_num;
end;
$$;

grant execute on function public.next_material_order_number() to authenticated;

-- ============================================================
-- 13. goods_receipts - evidencia prijmu tovaru na sklade, pristupne pre office AJ sklad
-- ============================================================
create table if not exists public.goods_receipts (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.goods_receipts enable row level security;

drop policy if exists "goods_receipts_all" on public.goods_receipts;
create policy "goods_receipts_all" on public.goods_receipts
  for all
  using (public.current_role() in ('office', 'sklad'))
  with check (public.current_role() in ('office', 'sklad'));

-- Sklad potrebuje precitat zoznam dodavatelov a objednavok surovin/obalov,
-- aby si ich vedel vybrat pri zapise prijmu (len citanie, nie zapis).
drop policy if exists "suppliers_sklad_select" on public.suppliers;
create policy "suppliers_sklad_select" on public.suppliers
  for select
  using (public.current_role() = 'sklad');

drop policy if exists "material_orders_sklad_select" on public.material_orders;
create policy "material_orders_sklad_select" on public.material_orders
  for select
  using (public.current_role() = 'sklad');

-- ============================================================
-- 14. Storage bucket pre fotky pri prijme tovaru (napr. poskodeny tovar)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('goods-receipt-photos', 'goods-receipt-photos', false)
on conflict (id) do nothing;

drop policy if exists "goods_receipt_photos_rw" on storage.objects;
create policy "goods_receipt_photos_rw" on storage.objects
  for all
  using (bucket_id = 'goods-receipt-photos' and public.current_role() in ('office', 'sklad'))
  with check (bucket_id = 'goods-receipt-photos' and public.current_role() in ('office', 'sklad'));

-- ============================================================
-- 15. stock_issues - vydaj (spotreba) materialu zo skladu, pre vypocet stavu zasob
-- ============================================================
create table if not exists public.stock_issues (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.stock_issues enable row level security;

drop policy if exists "stock_issues_all" on public.stock_issues;
create policy "stock_issues_all" on public.stock_issues
  for all
  using (public.current_role() in ('office', 'sklad', 'vyroba'))
  with check (public.current_role() in ('office', 'sklad', 'vyroba'));

-- ============================================================
-- 16. products - register vyrobkov s recepturou (suroviny na 1 paletu)
-- ============================================================
create table if not exists public.products (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products enable row level security;

drop policy if exists "products_office_all" on public.products;
create policy "products_office_all" on public.products
  for all
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');

-- Sklad potrebuje precitat recepturu produktov (napr. pri kontrole zasob).
drop policy if exists "products_sklad_select" on public.products;
create policy "products_sklad_select" on public.products
  for select
  using (public.current_role() = 'sklad');

-- Vyroba potrebuje precitat zoznam produktov pre vyber na tablete pri zapise vyroby.
drop policy if exists "products_vyroba_select" on public.products;
create policy "products_vyroba_select" on public.products
  for select
  using (public.current_role() = 'vyroba');

-- ============================================================
-- 17. production_plan - vyrobny plan (sacky/kyble), pristupne pre office AJ sklad
-- ============================================================
create table if not exists public.production_plan (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.production_plan enable row level security;

drop policy if exists "production_plan_all" on public.production_plan;
create policy "production_plan_all" on public.production_plan
  for all
  using (public.current_role() in ('office', 'sklad', 'vyroba'))
  with check (public.current_role() in ('office', 'sklad', 'vyroba'));

-- ============================================================
-- 18. production_outputs - zaznamy skutocnej vyroby (produkt, palety, sarza),
--     zapisovane rolou "vyroba" na tablete vo vyrobe; kazdy zaznam pri ulozeni
--     rovno vytvori vydaj surovin (stock_issues) podla receptury produktu.
-- ============================================================
create table if not exists public.production_outputs (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.production_outputs enable row level security;

drop policy if exists "production_outputs_all" on public.production_outputs;
create policy "production_outputs_all" on public.production_outputs
  for all
  using (public.current_role() in ('office', 'vyroba'))
  with check (public.current_role() in ('office', 'vyroba'));

-- ============================================================
-- 19. workers - zoznam pracovnikov vo vyrobe (mena na "odkliknutie" na tablete,
--     nie su to prihlasovacie ucty - tablet pouziva jeden zdielany ucet rolou "vyroba").
-- ============================================================
create table if not exists public.workers (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.workers enable row level security;

drop policy if exists "workers_office_all" on public.workers;
create policy "workers_office_all" on public.workers
  for all
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');

-- Vyroba potrebuje precitat zoznam mien pre vyber na tablete pri zapise vyroby.
drop policy if exists "workers_vyroba_select" on public.workers;
create policy "workers_vyroba_select" on public.workers
  for select
  using (public.current_role() = 'vyroba');

-- Sklad potrebuje precitat zoznam mien pre vyber "Kto pracuje" na tablete
-- (rovnaka tabulka ako vyroba, rozlisene poliom data->>'typ' = 'vyroba'/'sklad').
drop policy if exists "workers_sklad_select" on public.workers;
create policy "workers_sklad_select" on public.workers
  for select
  using (public.current_role() = 'sklad');

-- ============================================================
-- 20. expedicia_zaznamy - evidencia realne nalozenych davok (produkt, sarza,
--     pocet paliet/kartonov) k objednavke, zapisovane rolou "sklad" pri expedicii.
--     Sluzi na dohladatelnost a na vypocet stavu zasob hotovych vyrobkov
--     (vyrobene z production_outputs minus expedovane odtialto).
-- ============================================================
create table if not exists public.expedicia_zaznamy (
  id text primary key,
  order_id text not null references public.orders(id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.expedicia_zaznamy enable row level security;

drop policy if exists "expedicia_zaznamy_all" on public.expedicia_zaznamy;
create policy "expedicia_zaznamy_all" on public.expedicia_zaznamy
  for all
  using (public.current_role() in ('office', 'sklad'))
  with check (public.current_role() in ('office', 'sklad'));

-- Sklad potrebuje precitat, kolko sa cim vyrobilo, aby vedel spocitat stav
-- zasob hotovych vyrobkov (vyrobene - expedovane) na obrazovke Expedicia.
drop policy if exists "production_outputs_sklad_select" on public.production_outputs;
create policy "production_outputs_sklad_select" on public.production_outputs
  for select
  using (public.current_role() = 'sklad');

-- ============================================================
-- 21. Storage bucket pre fotky pri expedicii (nepovinna fotka k nalozenej davke)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('expedicia-photos', 'expedicia-photos', false)
on conflict (id) do nothing;

drop policy if exists "expedicia_photos_rw" on storage.objects;
create policy "expedicia_photos_rw" on storage.objects
  for all
  using (bucket_id = 'expedicia-photos' and public.current_role() in ('office', 'sklad'))
  with check (bucket_id = 'expedicia-photos' and public.current_role() in ('office', 'sklad'));

-- ============================================================
-- 22b. Vyroba potrebuje precitat prijem tovaru (goods_receipts), aby vedela
--      pri zapise vyrobenej davky skontrolovat, ci je na sklade dost surovin
--      podla receptury (stock_issues uz vyroba cita/zapisuje, receipts nie).
-- ============================================================
drop policy if exists "goods_receipts_vyroba_select" on public.goods_receipts;
create policy "goods_receipts_vyroba_select" on public.goods_receipts
  for select
  using (public.current_role() = 'vyroba');

-- ============================================================
-- 22. Sklad potrebuje precitat zoznam dopravcov, aby vedel na obrazovke
--     Expedicia zaznamenat, kto tovar realne vyzdvihuje (nezavisle od
--     dopravcu, ktoreho pri objednavani dopravy zvolila office).
-- ============================================================
drop policy if exists "carriers_sklad_select" on public.carriers;
create policy "carriers_sklad_select" on public.carriers
  for select
  using (public.current_role() = 'sklad');

-- ============================================================
-- 9. Pouzivatelia a role
-- ============================================================
-- Najprv v Dashboard -> Authentication -> Users -> Add user vytvor kontaka
-- (Dusan Bucha, Radka Buchova, Dominik Hrin, Sklad, Vyroba) s realnymi e-mailami a heslami.
-- Potom pre kazdeho skopiruj jeho UUID (klik na usera v zozname) a nizsie doplň
-- riadky (nahrad 'UUID-Z-DASHBOARDU' a mena), a tento blok spusti v SQL Editore:
--
-- insert into public.profiles (id, full_name, role) values
--   ('UUID-DUSAN', 'Dusan Bucha', 'office'),
--   ('UUID-RADKA', 'Radka Buchova', 'office'),
--   ('UUID-DOMINIK', 'Dominik Hrin', 'office'),
--   ('UUID-SKLAD', 'Sklad', 'sklad'),
--   ('UUID-VYROBA', 'Vyroba', 'vyroba')

-- ============================================================
-- 23. Storage bucket pre NVE listy (Excel export z Maxim, priklada sa
--     k objednavke a posiela emailom kolegom do Nemecka) - len office.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('nve-lists', 'nve-lists', false)
on conflict (id) do nothing;

drop policy if exists "nve_lists_rw" on storage.objects;
create policy "nve_lists_rw" on storage.objects
  for all
  using (bucket_id = 'nve-lists' and public.current_role() = 'office')
  with check (bucket_id = 'nve-lists' and public.current_role() = 'office');

-- ============================================================
-- 24. Storage bucket pre faktury od dodavatelov (priklada sa k prijmom
--     tovaru kvoli oceneniu stavu zasob) - len office.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;

drop policy if exists "invoices_rw" on storage.objects;
create policy "invoices_rw" on storage.objects
  for all
  using (bucket_id = 'invoices' and public.current_role() = 'office')
  with check (bucket_id = 'invoices' and public.current_role() = 'office');
-- on conflict (id) do update set full_name = excluded.full_name, role = excluded.role;

-- ============================================================
-- 25. prestavky - zaznamy prestavok pracovnikov vo vyrobe (zaciatok/koniec),
--     zapisovane rolou "vyroba" jednym tuknutim na tablete; office ich vidi
--     a moze exportovat/opravit vo Vyrobnom plane.
-- ============================================================
create table if not exists public.prestavky (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.prestavky enable row level security;

drop policy if exists "prestavky_all" on public.prestavky;
create policy "prestavky_all" on public.prestavky
  for all
  using (public.current_role() in ('office', 'vyroba'))
  with check (public.current_role() in ('office', 'vyroba'));

-- ============================================================
-- 26. ulohy - todo/tasks zoznam v office (akcny plan, kto ma
--     dorucit, termin) - dostupne len rolou "office".
-- ============================================================
create table if not exists public.ulohy (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.ulohy enable row level security;

drop policy if exists "ulohy_all" on public.ulohy;
create policy "ulohy_all" on public.ulohy
  for all
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');
