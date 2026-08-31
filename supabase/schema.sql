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
alter table public.company add column if not exists posledny_rok_dopravy int;
alter table public.company add column if not exists posledne_cislo_objednavky int not null default 0;
alter table public.company add column if not exists posledny_rok_objednavky int;

drop function if exists public.next_order_numbers();

create or replace function public.next_order_numbers()
returns table (doprava_num int, dodak_num int, objednavka_num int)
language plpgsql
security definer
set search_path = public
as $body$
declare
  v_doprava int;
  v_dodak int;
  v_objednavka int;
  v_year int := extract(year from now())::int;
  v_stored_year_dopravy int;
  v_stored_year_objednavky int;
begin
  if public.current_role() <> 'office' then
    raise exception 'Nemate opravnenie';
  end if;

  select posledny_rok_dopravy, posledny_rok_objednavky
    into v_stored_year_dopravy, v_stored_year_objednavky
    from public.company where id = 1;

  if v_stored_year_dopravy is distinct from v_year then
    update public.company
    set posledne_cislo_dopravy = 1,
        posledne_cislo_dodacieho_listu = 1,
        posledny_rok_dopravy = v_year,
        updated_at = now()
    where id = 1
    returning posledne_cislo_dopravy, posledne_cislo_dodacieho_listu
    into v_doprava, v_dodak;
  else
    update public.company
    set posledne_cislo_dopravy = posledne_cislo_dopravy + 1,
        posledne_cislo_dodacieho_listu = posledne_cislo_dodacieho_listu + 1,
        updated_at = now()
    where id = 1
    returning posledne_cislo_dopravy, posledne_cislo_dodacieho_listu
    into v_doprava, v_dodak;
  end if;

  if v_stored_year_objednavky is distinct from v_year then
    update public.company
    set posledne_cislo_objednavky = 1,
        posledny_rok_objednavky = v_year,
        updated_at = now()
    where id = 1
    returning posledne_cislo_objednavky
    into v_objednavka;
  else
    update public.company
    set posledne_cislo_objednavky = posledne_cislo_objednavky + 1,
        updated_at = now()
    where id = 1
    returning posledne_cislo_objednavky
    into v_objednavka;
  end if;

  return query select v_doprava, v_dodak, v_objednavka;
end;
$body$;

grant execute on function public.next_order_numbers() to authenticated;

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
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'expedicia_zaznamy'
  ) then
    alter publication supabase_realtime add table public.expedicia_zaznamy;
  end if;
end $$;

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
-- 25. prestavky - dochazka (prichod/odchod) pracovnikov vo vyrobe aj na sklade,
--     zapisovane jednym tuknutim na tablete; office ju vidi a moze
--     exportovat/opravit vo Vyrobnom plane. (Nazov tabulky ostava "prestavky"
--     z povodneho navrhu, appka to uz vsade zobrazuje ako "Dochazka".)
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
  using (public.current_role() in ('office', 'vyroba', 'sklad'))
  with check (public.current_role() in ('office', 'vyroba', 'sklad'));

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

-- ============================================================
-- 27. plan_smien - planovanie zmien vo vyrobe (samostatna appka,
--     jeden riadok, id = 1). Otvara sa uz z uvodnej obrazovky pred
--     prihlasenim do ERP a ma vlastny PIN gate (veduci/zamestnankyna),
--     preto NEMA su vazane na public.current_role() - pristup je
--     zamerne verejny cez anon kluc, chraneny len appkovym PIN-om
--     (rovnako ako povodny navrh appky), nie je to citliva financna
--     tabulka.
-- ============================================================
create table if not exists public.plan_smien (
  id int primary key default 1,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.plan_smien (id, data)
values (1, '{}'::jsonb)
on conflict (id) do nothing;

alter table public.plan_smien enable row level security;

drop policy if exists "plan_smien_public" on public.plan_smien;
create policy "plan_smien_public" on public.plan_smien
  for all
  using (true)
  with check (true);

-- ============================================================
-- 28. Plan zmien preberá zoznam mien priamo z workers (typ = "vyroba") -
--     kazdy oznaceny v Pracovnikoch ako "Vyroba" sa automaticky zobrazi
--     aj vo Vyrobe/Prestavkach aj v Plane zmien, bez dalsieho oznacovania.
--     Appka Plan zmien nema Supabase session (rovnako ako plan_smien
--     vyssie), preto potrebuje vlastnu verejnu select policy - zamerne
--     obmedzenu len na riadky s typ = "vyroba" (nevystavuje mena zo skladu).
-- ============================================================
drop policy if exists "workers_planovanie_public_select" on public.workers;
create policy "workers_planovanie_public_select" on public.workers
  for select
  using (data->>'typ' = 'vyroba');

-- ============================================================
-- 29. designs - IML dizajny (kbelíky) a tlačové dáta fólií (sáčky), priradené
--     k viacerym produktom naraz (rovnaky fyzicky dizajn, ina paletizacia/karton).
-- ============================================================
create table if not exists public.designs (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.designs enable row level security;

drop policy if exists "designs_office_all" on public.designs;
create policy "designs_office_all" on public.designs
  for all
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');

insert into storage.buckets (id, name, public)
values ('designs', 'designs', false)
on conflict (id) do nothing;

drop policy if exists "designs_files_office" on storage.objects;
create policy "designs_files_office" on storage.objects
  for all
  using (bucket_id = 'designs' and public.current_role() = 'office')
  with check (bucket_id = 'designs' and public.current_role() = 'office');

-- ============================================================
-- 30. sw_pricelist - cenik Pricelist SW GmbH (jeden riadok, id = 1). Povodny
--     Excel subor sa uklada cely v Storage buckete (moznost stiahnutia),
--     obsah sa zaroven parsuje na "rows" pre scrollovatelny nahlad v appke.
--     Pri nahrati noveho suboru sa predosly automaticky presunie do
--     sw_pricelist_archive (rovnaky princip ako pricelist/pricelist_archive).
-- ============================================================
create table if not exists public.sw_pricelist (
  id int primary key default 1,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.sw_pricelist (id, data)
values (1, '{}'::jsonb)
on conflict (id) do nothing;

alter table public.sw_pricelist enable row level security;

drop policy if exists "sw_pricelist_office_all" on public.sw_pricelist;
create policy "sw_pricelist_office_all" on public.sw_pricelist
  for all
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');

create table if not exists public.sw_pricelist_archive (
  id text primary key,
  data jsonb not null,
  file_name text,
  archived_at timestamptz not null default now()
);

alter table public.sw_pricelist_archive enable row level security;

drop policy if exists "sw_pricelist_archive_office_all" on public.sw_pricelist_archive;
create policy "sw_pricelist_archive_office_all" on public.sw_pricelist_archive
  for all
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');

insert into storage.buckets (id, name, public)
values ('sw-pricelist', 'sw-pricelist', false)
on conflict (id) do nothing;

drop policy if exists "sw_pricelist_files_office" on storage.objects;
create policy "sw_pricelist_files_office" on storage.objects
  for all
  using (bucket_id = 'sw-pricelist' and public.current_role() = 'office')
  with check (bucket_id = 'sw-pricelist' and public.current_role() = 'office');

-- ============================================================
-- 31. navody - PDF navody na pouzivani systemov (napr. MAXIM/NVE listy).
--     Kazdy navod ma nazov + jeden PDF subor, v appke sa zobrazuje ako
--     maly nahled, po kliknuti na celou stranku.
-- ============================================================
create table if not exists public.navody (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.navody enable row level security;

drop policy if exists "navody_office_all" on public.navody;
create policy "navody_office_all" on public.navody
  for all
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');

insert into storage.buckets (id, name, public)
values ('navody', 'navody', false)
on conflict (id) do nothing;

drop policy if exists "navody_files_office" on storage.objects;
create policy "navody_files_office" on storage.objects
  for all
  using (bucket_id = 'navody' and public.current_role() = 'office')
  with check (bucket_id = 'navody' and public.current_role() = 'office');

-- ============================================================
-- 32. reklamace - poskodeny material/obaly zistene napr. pri kontrole pred
--     vyrobou (netykaju sa konkretneho prijmu tovaru), ceka na vyzdvihnuti
--     dodavatelom pri dalsi dodavce.
-- ============================================================
create table if not exists public.reklamace (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.reklamace enable row level security;

drop policy if exists "reklamace_office_sklad_all" on public.reklamace;
create policy "reklamace_office_sklad_all" on public.reklamace
  for all
  using (public.current_role() in ('office', 'sklad'))
  with check (public.current_role() in ('office', 'sklad'));

-- ============================================================
-- 33. plan_smien_pins - PINy pre appku Plan zmien, oddelene od verejne
--     citatelnej tabulky plan_smien (viz jej komentar vyssie - ta je
--     zamerne verejna, lebo appka nema Supabase session). Tato tabulka
--     NEMA ziadnu select/insert/update policy - k PINom sa da dostat
--     vylucne cez SECURITY DEFINER funkcie nizsie, ktore nikdy nevratia
--     samotnu hodnotu PINu, len true/false. Predtym boli PINy ulozene
--     v plaintext priamo v datach verejnej tabulky plan_smien - ktokolvek
--     s anon klucom si ich vedel priamo vycitat cez REST API a obist tak
--     PIN gate uplne.
-- ============================================================
create table if not exists public.plan_smien_pins (
  id int primary key default 1,
  admin_pin text not null default '1234',
  employee_pins jsonb not null default '{}'::jsonb
);

insert into public.plan_smien_pins (id, admin_pin, employee_pins)
values (1, '1234', '{}'::jsonb)
on conflict (id) do nothing;

alter table public.plan_smien_pins enable row level security;
-- Zamerne ziadna policy = nulovy priamy pristup pre anon/authenticated,
-- vratane service role cez REST - jedina cesta dnu su funkcie nizsie.

create or replace function public.plan_smien_verify_admin_pin(p_pin text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from public.plan_smien_pins where id = 1 and admin_pin = p_pin);
$$;
grant execute on function public.plan_smien_verify_admin_pin(text) to anon, authenticated;

-- Bezpecnostna oprava: povodna verzia (jeden parameter, ziadne overenie) nemala
-- ziadnu vlastnu kontrolu volajuceho - ktokolvek so (verejnym) anon klucom mohol
-- zmenit admin PIN bez znalosti povodneho. Kedze appka nema Supabase session
-- (anon kiosk), jedina spolahliva ochrana je overenie priamo vo funkcii.
drop function if exists public.plan_smien_set_admin_pin(text);
create or replace function public.plan_smien_set_admin_pin(p_current_pin text, p_new_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
as $body$
begin
  if not exists (select 1 from public.plan_smien_pins where id = 1 and admin_pin = p_current_pin) then
    return false;
  end if;
  update public.plan_smien_pins set admin_pin = p_new_pin where id = 1;
  return true;
end;
$body$;
grant execute on function public.plan_smien_set_admin_pin(text, text) to anon, authenticated;

create or replace function public.plan_smien_has_employee_pin(p_employee_id text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select employee_pins ? p_employee_id from public.plan_smien_pins where id = 1), false);
$$;
grant execute on function public.plan_smien_has_employee_pin(text) to anon, authenticated;

create or replace function public.plan_smien_verify_employee_pin(p_employee_id text, p_pin text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select (employee_pins ->> p_employee_id) = p_pin from public.plan_smien_pins where id = 1), false);
$$;
grant execute on function public.plan_smien_verify_employee_pin(text, text) to anon, authenticated;

-- Bezpecnostna oprava: povodna verzia dovolila prepisat PIN aj zamestnancovi,
-- ktory uz nejaky ma (ktokolvek s anon klucom mohol niekomu ukradnut identitu
-- nastavenim jeho PINu na znamu hodnotu). Teraz funguje len ako prve nastavenie -
-- ak uz PIN existuje, aktualizacia sa nevykona (0 riadkov, klient uvidi false).
drop function if exists public.plan_smien_set_employee_pin(text, text);
create or replace function public.plan_smien_set_employee_pin(p_employee_id text, p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
as $body$
declare
  affected int;
begin
  update public.plan_smien_pins
  set employee_pins = jsonb_set(employee_pins, array[p_employee_id], to_jsonb(p_pin), true)
  where id = 1 and not (employee_pins ? p_employee_id);
  get diagnostics affected = row_count;
  return affected > 0;
end;
$body$;
grant execute on function public.plan_smien_set_employee_pin(text, text) to anon, authenticated;

-- Bezpecnostna oprava: reset PINu zamestnanca je admin-only akcia (rovnaka
-- uvaha ako pri set_admin_pin vyssie) - vyzaduje admin PIN ako parameter.
drop function if exists public.plan_smien_reset_employee_pin(text);
create or replace function public.plan_smien_reset_employee_pin(p_admin_pin text, p_employee_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $body$
begin
  if not exists (select 1 from public.plan_smien_pins where id = 1 and admin_pin = p_admin_pin) then
    return false;
  end if;
  update public.plan_smien_pins
  set employee_pins = employee_pins - p_employee_id
  where id = 1;
  return true;
end;
$body$;
grant execute on function public.plan_smien_reset_employee_pin(text, text) to anon, authenticated;

-- Existujuce PINy (ak nejake su) sa jednorazovo prenesu z plan_smien.data
-- do novej uzamknutej tabulky, potom sa z verejnych dat vymazu.
do $$
declare
  d jsonb;
  emp jsonb;
  pins jsonb := '{}'::jsonb;
begin
  select data into d from public.plan_smien where id = 1;
  if d is not null then
    if d ? 'adminPin' then
      update public.plan_smien_pins set admin_pin = (d->>'adminPin') where id = 1;
    end if;
    if d ? 'employees' then
      for emp in select * from jsonb_array_elements(d->'employees')
      loop
        if emp ? 'pin' and emp->>'pin' is not null then
          pins := jsonb_set(pins, array[emp->>'id'], emp->'pin', true);
        end if;
      end loop;
      if pins <> '{}'::jsonb then
        update public.plan_smien_pins set employee_pins = employee_pins || pins where id = 1;
      end if;
    end if;

    -- Vycistit plaintext PINy z verejne citatelnych dat, aby tam po migracii uz nelezali.
    d := d - 'adminPin';
    if d ? 'employees' then
      d := jsonb_set(d, '{employees}', (
        select coalesce(jsonb_agg(e - 'pin'), '[]'::jsonb)
        from jsonb_array_elements(d->'employees') e
      ));
    end if;
    update public.plan_smien set data = d where id = 1;
  end if;
end $$;

-- ============================================================
-- 34. ccp_kontroly - CCP kontrola kovoveho detektoru (Fe/NonFe/nerez) pri
--     zahajeni vyroby (kliknuti "Probiha" na danem radku planu). Pri
--     zamitnuti (kterykoliv parametr "NE") se povinne zaznamena napravne
--     opatreni.
-- ============================================================
create table if not exists public.ccp_kontroly (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.ccp_kontroly enable row level security;

drop policy if exists "ccp_kontroly_all" on public.ccp_kontroly;
create policy "ccp_kontroly_all" on public.ccp_kontroly
  for all
  using (public.current_role() in ('office', 'sklad', 'vyroba'))
  with check (public.current_role() in ('office', 'sklad', 'vyroba'));

-- ============================================================
-- 35. pauzy - prestavky pracovniku behem smeny (samostatne od "prestavky",
--     ktera uz sluzi jako Dochazka - prichod/odchod). Stejny princip
--     (tuknuti na jmeno = zacatek/konec), pouziva se ve Vyrobe aj Skladu.
-- ============================================================
create table if not exists public.pauzy (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.pauzy enable row level security;

drop policy if exists "pauzy_all" on public.pauzy;
create policy "pauzy_all" on public.pauzy
  for all
  using (public.current_role() in ('office', 'vyroba', 'sklad'))
  with check (public.current_role() in ('office', 'vyroba', 'sklad'));

-- ============================================================
-- 36. dochadzka_nastavenia - jeden riadok nastaveni pre vypocet mzdovych
--     hodin v Docházce (zaciatok zmeny pre Vyrobu a Sklad, pouziva sa na
--     orezanie prilis skoreho prichodu). Edituje iba office.
-- ============================================================
create table if not exists public.dochadzka_nastavenia (
  id int primary key default 1,
  data jsonb not null default '{"zaciatokVyroba":"06:00","zaciatokSklad":"06:00"}'::jsonb
);

insert into public.dochadzka_nastavenia (id, data)
values (1, '{"zaciatokVyroba":"06:00","zaciatokSklad":"06:00"}'::jsonb)
on conflict (id) do nothing;

alter table public.dochadzka_nastavenia enable row level security;

drop policy if exists "dochadzka_nastavenia_office" on public.dochadzka_nastavenia;
create policy "dochadzka_nastavenia_office" on public.dochadzka_nastavenia
  for all
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');

-- ============================================================
-- 37. dochadzka_pins - PIN ochrana proti tuknutiu cudzieho mena na tablete
--     (Vyroba/Sklad Dochazka). Rovnaky bezpecny vzor ako plan_smien_pins
--     vyssie - ziadna select/insert/update policy, pristup vylucne cez
--     SECURITY DEFINER funkcie, ktore nikdy nevracaju samotny PIN. Pracovnik
--     si PIN zvoli sam pri prvom tuknuti (min. 4 znaky), office ho vie
--     kedykoliv resetovat v Pracovnicich, ak ho niekto zabudne. Klucovane
--     podla worker.id (nie mena), aby prezilo premenovanie pracovnika.
-- ============================================================
create table if not exists public.dochadzka_pins (
  id int primary key default 1,
  worker_pins jsonb not null default '{}'::jsonb
);

insert into public.dochadzka_pins (id, worker_pins)
values (1, '{}'::jsonb)
on conflict (id) do nothing;

alter table public.dochadzka_pins enable row level security;
-- Zamerne ziadna policy - jedina cesta dnu su funkcie nizsie.

create or replace function public.dochadzka_has_worker_pin(p_worker_id text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select worker_pins ? p_worker_id from public.dochadzka_pins where id = 1), false);
$$;
grant execute on function public.dochadzka_has_worker_pin(text) to anon, authenticated;

create or replace function public.dochadzka_verify_worker_pin(p_worker_id text, p_pin text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select (worker_pins ->> p_worker_id) = p_pin from public.dochadzka_pins where id = 1), false);
$$;
grant execute on function public.dochadzka_verify_worker_pin(text, text) to anon, authenticated;

-- Bezpecnostna oprava: povodna verzia dovolila prepisat uz existujuci PIN
-- ktohokolvek pracovnika (ktokolvek s anon klucom mohol ukradnut identitu).
-- Teraz funguje len ako prve nastavenie - ak PIN uz existuje, nic sa nezmeni.
drop function if exists public.dochadzka_set_worker_pin(text, text);
create or replace function public.dochadzka_set_worker_pin(p_worker_id text, p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
as $body$
declare
  affected int;
begin
  update public.dochadzka_pins
  set worker_pins = jsonb_set(worker_pins, array[p_worker_id], to_jsonb(p_pin), true)
  where id = 1 and not (worker_pins ? p_worker_id);
  get diagnostics affected = row_count;
  return affected > 0;
end;
$body$;
grant execute on function public.dochadzka_set_worker_pin(text, text) to anon, authenticated;

-- Bezpecnostna oprava: reset PINu je v appke dostupny iba z Office
-- (Pracovnici -> tlacitko na resetovanie), takze na rozdiel od Plan smien
-- tu mame realnu Supabase session a mozeme si vystacit s rolou.
create or replace function public.dochadzka_reset_worker_pin(p_worker_id text)
returns void
language plpgsql
security definer
set search_path = public
as $body$
begin
  if public.current_role() <> 'office' then
    raise exception 'Neopravnene.';
  end if;
  update public.dochadzka_pins
  set worker_pins = worker_pins - p_worker_id
  where id = 1;
end;
$body$;
grant execute on function public.dochadzka_reset_worker_pin(text) to anon, authenticated;

-- ============================================================
-- 38. cennik_jini_zakaznici - rucne vedeny cenik (artiklove cislo/nazov
--     produktu, zakaznik, cena) pro zakazniky mimo Stenger Waffeln GmbH.
--     Spravuje pouze office.
-- ============================================================
create table if not exists public.cennik_jini_zakaznici (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.cennik_jini_zakaznici enable row level security;

drop policy if exists "cennik_jini_zakaznici_office" on public.cennik_jini_zakaznici;
create policy "cennik_jini_zakaznici_office" on public.cennik_jini_zakaznici
  for all
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');

-- ============================================================
-- 39. audit_log - kto/co/kdy zmenil, na kritickych tabulkach. Zapisovany
--     vyhradne databazovym triggerom (audit_trigger nizsie), nikdy z appky -
--     zachyti zmenu bez ohledu na to, odkud prisla (appka, buduci n8n,
--     priamy SQL zasah). Ziadna insert/update/delete policy pro klienty -
--     jedina cesta dnu je SECURITY DEFINER trigger, rovnaky vzor ako
--     dochadzka_pins/plan_smien_pins vyssie. Office ma iba cteni.
-- ============================================================
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  entity text not null,
  entity_id text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  old_value jsonb,
  new_value jsonb,
  changed_by uuid references auth.users(id),
  changed_by_role text,
  source text not null default 'user' check (source in ('user', 'automation', 'ai', 'integration')),
  created_at timestamptz not null default now()
);

create index if not exists audit_log_entity_idx on public.audit_log (entity, entity_id);
create index if not exists audit_log_created_at_idx on public.audit_log (created_at desc);

alter table public.audit_log enable row level security;

-- Audit log je citlivy (ukazuje kto co pokazil) - zamerne obmedzeny len na
-- konkretneho cloveka (nie na cely office), zamknute uz na urovni RLS (nielen
-- schovanim v menu appky), aby sa to nedalo obist priamym volanim API.
drop policy if exists "audit_log_office_select" on public.audit_log;
create policy "audit_log_office_select" on public.audit_log
  for select
  using (public.current_role() = 'office' and auth.email() = 'dh@stenger.eu');

-- Aby office videl v audit logu mena ludi (nielen svoje vlastne - povodna
-- "profiles_select_own" policy z casti 1 to nedovolovala pre cudzie riadky).
drop policy if exists "profiles_office_select_all" on public.profiles;
create policy "profiles_office_select_all" on public.profiles
  for select
  using (public.current_role() = 'office');

create or replace function public.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $body$
declare
  rec record;
  rec_id text;
begin
  rec := coalesce(NEW, OLD);
  rec_id := rec.id::text;
  insert into public.audit_log (entity, entity_id, action, old_value, new_value, changed_by, changed_by_role, source)
  values (
    TG_TABLE_NAME,
    rec_id,
    lower(TG_OP),
    case when TG_OP in ('update', 'delete') then to_jsonb(OLD) else null end,
    case when TG_OP in ('insert', 'update') then to_jsonb(NEW) else null end,
    auth.uid(),
    public.current_role(),
    case when auth.uid() is null then 'automation' else 'user' end
  );
  return rec;
end;
$body$;

drop trigger if exists audit_orders on public.orders;
create trigger audit_orders after insert or update or delete on public.orders
  for each row execute function public.audit_trigger();

drop trigger if exists audit_production_plan on public.production_plan;
create trigger audit_production_plan after insert or update or delete on public.production_plan
  for each row execute function public.audit_trigger();

drop trigger if exists audit_stock_issues on public.stock_issues;
create trigger audit_stock_issues after insert or update or delete on public.stock_issues
  for each row execute function public.audit_trigger();

drop trigger if exists audit_goods_receipts on public.goods_receipts;
create trigger audit_goods_receipts after insert or update or delete on public.goods_receipts
  for each row execute function public.audit_trigger();

drop trigger if exists audit_products on public.products;
create trigger audit_products after insert or update or delete on public.products
  for each row execute function public.audit_trigger();

drop trigger if exists audit_customers on public.customers;
create trigger audit_customers after insert or update or delete on public.customers
  for each row execute function public.audit_trigger();

drop trigger if exists audit_suppliers on public.suppliers;
create trigger audit_suppliers after insert or update or delete on public.suppliers
  for each row execute function public.audit_trigger();

-- ============================================================
-- 40. orders - priprava na DRAFT -> APPROVED workflow pre buduce
--     automatizovane/AI navrhy objednavek. Ciste technicka priprava -
--     ziadna zmena v appke ju dnes nevytvara ani nezobrazuje, vsetky
--     dnesne objednavky maju zdroj='user' a stav_schvalenia=null
--     (co znamena "mimo tento workflow, obycajna objednavka ako doteraz").
--     Az ked v buducnosti pribudne automatizacia/AI zapisujuca s
--     zdroj != 'user', bude sa objednavka rodit s stav_schvalenia =
--     'pending_approval' a musi ju schvalit clovek cez RPC nizsie
--     predtym, nez sa spracuje ako plnohodnotna objednavka.
-- ============================================================
alter table public.orders add column if not exists zdroj text not null default 'user' check (zdroj in ('user', 'ai_draft', 'automation'));
alter table public.orders add column if not exists stav_schvalenia text check (stav_schvalenia in ('pending_approval', 'approved'));
alter table public.orders add column if not exists schvalil uuid references auth.users(id);
alter table public.orders add column if not exists schvaleno_at timestamptz;

create or replace function public.approve_order_draft(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $body$
begin
  if public.current_role() <> 'office' then
    raise exception 'Neopravnene.';
  end if;
  update public.orders
  set stav_schvalenia = 'approved', schvalil = auth.uid(), schvaleno_at = now()
  where id = p_id and stav_schvalenia = 'pending_approval';
end;
$body$;
grant execute on function public.approve_order_draft(text) to authenticated;

-- ============================================================
-- 41. processed_webhooks - priprava na ochranu proti duplicitnemu
--     spracovaniu (napr. jeden e-mail alebo jeden MRP dokument prijaty
--     dvakrat). "id" je externy idempotency kluc (ID e-mailu, cislo
--     dokladu...) - buduca Edge Function pred spracovanim skontroluje,
--     ci uz existuje; ak ano, vrati ulozeny "result" bez opakovaneho
--     zapisu. Ziadna appka ani role zatial do tejto tabulky nezapisuje -
--     zamerne bez policy (len service-role/Edge Function pristup), kym
--     nepribudne prva realna integracia.
-- ============================================================
create table if not exists public.processed_webhooks (
  id text primary key,
  source text not null,
  payload jsonb,
  result jsonb,
  created_at timestamptz not null default now()
);
alter table public.processed_webhooks enable row level security;

-- ============================================================
-- 42. Kvalita a kontroly - checklisty (sablony + vyplnenia) a register
--     terminov/BOZP (zdravotne prehliadky, kontroly/skolenia VZV, ine BOZP).
--     Len office (samostatna dlazdica na uvodnej obrazovke, znovupouziva
--     bezne Supabase prihlasenie, obmedzene na rolu 'office' v App.jsx).
-- ============================================================
create table if not exists public.checklist_templates (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.checklist_templates enable row level security;
drop policy if exists "checklist_templates_office_all" on public.checklist_templates;
create policy "checklist_templates_office_all" on public.checklist_templates
  for all using (public.current_role() = 'office') with check (public.current_role() = 'office');
drop trigger if exists audit_checklist_templates on public.checklist_templates;
create trigger audit_checklist_templates after insert or update or delete on public.checklist_templates
  for each row execute function public.audit_trigger();

create table if not exists public.checklist_submissions (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.checklist_submissions enable row level security;
drop policy if exists "checklist_submissions_office_all" on public.checklist_submissions;
create policy "checklist_submissions_office_all" on public.checklist_submissions
  for all using (public.current_role() = 'office') with check (public.current_role() = 'office');
drop trigger if exists audit_checklist_submissions on public.checklist_submissions;
create trigger audit_checklist_submissions after insert or update or delete on public.checklist_submissions
  for each row execute function public.audit_trigger();

create table if not exists public.kvalita_terminy (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.kvalita_terminy enable row level security;
drop policy if exists "kvalita_terminy_office_all" on public.kvalita_terminy;
create policy "kvalita_terminy_office_all" on public.kvalita_terminy
  for all using (public.current_role() = 'office') with check (public.current_role() = 'office');
drop trigger if exists audit_kvalita_terminy on public.kvalita_terminy;
create trigger audit_kvalita_terminy after insert or update or delete on public.kvalita_terminy
  for each row execute function public.audit_trigger();

-- Priloha dokumentu (napr. IFS certifikat, RSPO certifikat) k terminu -
-- subor v Storage, referencia v kvalita_terminy.data (dokumentPath/dokumentNazovSuboru).
insert into storage.buckets (id, name, public)
values ('kvalita-dokumenty', 'kvalita-dokumenty', false)
on conflict (id) do nothing;

drop policy if exists "kvalita_dokumenty_files_office" on storage.objects;
create policy "kvalita_dokumenty_files_office" on storage.objects
  for all
  using (bucket_id = 'kvalita-dokumenty' and public.current_role() = 'office')
  with check (bucket_id = 'kvalita-dokumenty' and public.current_role() = 'office');
