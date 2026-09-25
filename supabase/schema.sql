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
  -- Stornovane objednavky (data->>'stornovana' = 'true') sklad vobec nevidi -
  -- nema co nakladat/expedovat, storno riesi vyhradne office v registri.
  select
    id, zakaznik, adresa_dodania_nazov, adresa_dodania, cislo_objednavky_dopravy, cislo_dodacieho_listu,
    data->>'cisloObjednavkyZakaznika',
    stav_expedicie,
    data->>'pocetPaliet',
    data->>'pocetPaletovychMiest',
    data->>'pocetKartonov',
    coalesce(data->'polozky', '[]'::jsonb)
  from public.orders
  where coalesce((data->>'stornovana')::boolean, false) = false
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
  rec_json jsonb;
  rec_id text;
begin
  rec := coalesce(NEW, OLD);
  rec_json := to_jsonb(rec);
  -- Vacsina auditovanych tabuliek ma "id" ako primarny kluc, ale
  -- employee_sensitive_data (Personalistika) ma primarny kluc "employee_id" -
  -- coalesce cez jsonb namiesto priameho rec.id, aby to fungovalo pre oba tvary
  -- bez toho, aby sa musela pisat samostatna trigger funkcia pre kazdu tabulku.
  rec_id := coalesce(rec_json->>'id', rec_json->>'employee_id', 'unknown');
  insert into public.audit_log (entity, entity_id, action, old_value, new_value, changed_by, changed_by_role, source)
  values (
    TG_TABLE_NAME,
    rec_id,
    lower(TG_OP),
    -- TG_OP je vzdy VELKYMI pismenami ('INSERT'/'UPDATE'/'DELETE') - porovnanie
    -- s malymi pismenami by tu nikdy nesedelo a old_value/new_value by ostali
    -- vzdy NULL (presne tento bug tu bol predtym).
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(OLD) else null end,
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(NEW) else null end,
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

-- ============================================================
-- 43. Personalistika - trvaly personalny spis kazdeho zamestnanca
--     (osobne udaje, pracovne pomery, historia zmien zmluvy, lekarske
--     prehliadky, sablony/generovane dokumenty, podpisy, timeline).
--     Samostatna sada tabuliek, ziadna existujuca tabulka (workers,
--     orders, profiles...) sa nemeni. "workers" (mena na tablet) a
--     "employees" (personalny spis) su zamerne oddelene - prepojene
--     len volitelne cez employees.worker_id.
--     Pristup je vrstveny NAD existujucu rolu: musi byt 'office' A
--     zaroven mat konkretne HR opravnenie v hr_permissions (nizsie) -
--     HR_ADMIN v hr_has_permission() automaticky splna kazde opravnenie.
--     Ziadny riadok sa z UI nemaze - len stavy (active/status/ARCHIVED).
-- ============================================================

-- 43.1 hr_permissions - kto ma ake HR opravnenie (nahrada za buduce
--      hardcodovane zoznamy emailov, viz audit_log vyssie).
create table if not exists public.hr_permissions (
  id text primary key,
  user_email text not null unique,
  permissions text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.hr_permissions enable row level security;

-- Helper: ma prihlaseny pouzivatel dane HR opravnenie? HR_ADMIN
-- automaticky splna vsetko (wildcard), security definer aby fungovala
-- aj vnutri dalsich RLS policies bez rekurzie (rovnaky vzor ako current_role()).
create or replace function public.hr_has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.hr_permissions
    where user_email = auth.email()
      and (p_permission = any(permissions) or 'HR_ADMIN' = any(permissions))
  );
$$;

drop policy if exists "hr_permissions_admin_all" on public.hr_permissions;
create policy "hr_permissions_admin_all" on public.hr_permissions
  for all
  using (public.current_role() = 'office' and public.hr_has_permission('HR_ADMIN'))
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_ADMIN'));

-- RPC: vrati opravnenia prihlaseneho pouzivatela (appka podla toho
-- skryva/zobrazuje casti UI) - nemusi mat HR_ADMIN len na to, aby zistil
-- svoje vlastne opravnenia.
create or replace function public.hr_get_permissions()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select permissions from public.hr_permissions where user_email = auth.email()),
    '{}'::text[]
  );
$$;
grant execute on function public.hr_get_permissions() to authenticated;

-- Prvotny HR_ADMIN, aby sa dalo dalsim ludom priradit opravnenia cez appku.
insert into public.hr_permissions (id, user_email, permissions)
values ('seed-dh', 'dh@stenger.eu', array['HR_ADMIN'])
on conflict (user_email) do nothing;

-- 43.2 positions - pracovne pozice (HI-001 Delnice, HI-002 Skladnik, ...)
create table if not exists public.positions (
  id text primary key,
  code text,
  name text not null,
  active boolean not null default true,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.positions enable row level security;
drop policy if exists "positions_view" on public.positions;
create policy "positions_view" on public.positions
  for select
  using (public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_BASIC'));
drop policy if exists "positions_edit" on public.positions;
create policy "positions_edit" on public.positions
  for all
  using (public.current_role() = 'office' and public.hr_has_permission('HR_EDIT'))
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_EDIT'));

-- 43.3 employees - trvaly personalny spis (zakladne, nie citlive udaje).
--      worker_id je volitelne prepojenie na existujucu tabulku "workers"
--      (mena na tablet) - NEMENI workers, len na nu odkazuje.
create table if not exists public.employees (
  id text primary key,
  worker_id text references public.workers(id),
  first_name text not null,
  last_name text not null,
  maiden_name text,
  title text,
  date_of_birth date,
  place_of_birth text,
  country_of_birth text,
  gender text,
  nationality text,
  permanent_address jsonb not null default '{}'::jsonb,
  correspondence_address jsonb not null default '{}'::jsonb,
  phone text,
  private_email text,
  id_document_type text,
  health_insurance_company text,
  highest_education text,
  is_foreigner boolean not null default false,
  notes text,
  active boolean not null default true,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.employees enable row level security;
drop policy if exists "employees_view" on public.employees;
create policy "employees_view" on public.employees
  for select
  using (public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_BASIC'));
drop policy if exists "employees_edit" on public.employees;
create policy "employees_edit" on public.employees
  for all
  using (public.current_role() = 'office' and public.hr_has_permission('HR_EDIT'))
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_EDIT'));

-- 43.4 employee_sensitive_data - 1:1 s employees, oddelene od zakladnych
--      udajov, aby RLS vedela ochranit len tuto cast (rodne cislo, bankovy
--      ucet, cislo dokladu, udaje cudzinca) opravnenim HR_VIEW_SENSITIVE.
create table if not exists public.employee_sensitive_data (
  employee_id text primary key references public.employees(id) on delete cascade,
  birth_number text,
  id_document_number text,
  bank_account text,
  foreigner_data jsonb not null default '{}'::jsonb,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.employee_sensitive_data enable row level security;
drop policy if exists "employee_sensitive_data_view" on public.employee_sensitive_data;
create policy "employee_sensitive_data_view" on public.employee_sensitive_data
  for select
  using (public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_SENSITIVE'));
drop policy if exists "employee_sensitive_data_edit" on public.employee_sensitive_data;
create policy "employee_sensitive_data_edit" on public.employee_sensitive_data
  for all
  using (public.current_role() = 'office' and public.hr_has_permission('HR_EDIT') and public.hr_has_permission('HR_VIEW_SENSITIVE'))
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_EDIT') and public.hr_has_permission('HR_VIEW_SENSITIVE'));

-- 43.5 employment_relationships - jeden zamestnanec moze mat viac
--      pracovnych pomerov v historii (Section 2/17 planu).
create table if not exists public.employment_relationships (
  id text primary key,
  employee_id text not null references public.employees(id),
  status text not null check (status in ('DRAFT', 'PLANNED', 'ACTIVE', 'NOTICE_PERIOD', 'ENDED')),
  employment_type text check (employment_type in ('doba_urcita', 'doba_neurcita')),
  start_date date,
  contract_signed_date date,
  fixed_term_end_date date,
  probation_end_date date,
  weekly_hours numeric,
  workplace text,
  position_id text references public.positions(id),
  supervisor_employee_id text references public.employees(id),
  termination_date date,
  termination_type text,
  termination_reason text,
  notes text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.employment_relationships enable row level security;
drop policy if exists "employment_relationships_view" on public.employment_relationships;
create policy "employment_relationships_view" on public.employment_relationships
  for select
  using (public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_BASIC'));
drop policy if exists "employment_relationships_edit" on public.employment_relationships;
create policy "employment_relationships_edit" on public.employment_relationships
  for all
  using (public.current_role() = 'office' and public.hr_has_permission('HR_EDIT'))
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_EDIT'));

-- 43.6 hr_document_templates / hr_document_template_versions - sablony
--      dokumentov (nikdy sa nemaze ziadna verzia - viz Section 7/8 planu).
--      position_id je vyplnene len pre doc_type='popis_pracovniho_mista'
--      (kazda pozicia ma svoj vlastny popis, napr. HI-002); pre ostatne
--      typy (zmluva, dodatok...) je null = jedna zdielana sablona.
create table if not exists public.hr_document_templates (
  id text primary key,
  doc_type text not null check (doc_type in (
    'pracovni_smlouva', 'mzdovy_vymer', 'popis_pracovniho_mista', 'dodatek',
    'dohoda_o_skonceni', 'vypoved_zamestnance', 'vypoved_zamestnavatele',
    'zruseni_ve_zkusebni_dobe', 'other'
  )),
  position_id text references public.positions(id),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.hr_document_templates enable row level security;
drop policy if exists "hr_document_templates_view" on public.hr_document_templates;
create policy "hr_document_templates_view" on public.hr_document_templates
  for select
  using (public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_BASIC'));
drop policy if exists "hr_document_templates_edit" on public.hr_document_templates;
create policy "hr_document_templates_edit" on public.hr_document_templates
  for all
  using (public.current_role() = 'office' and public.hr_has_permission('HR_DOCUMENT_APPROVE'))
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_DOCUMENT_APPROVE'));

create table if not exists public.hr_document_template_versions (
  id text primary key,
  template_id text not null references public.hr_document_templates(id),
  version_number int not null,
  file_path text not null,
  variables_schema jsonb not null default '{}'::jsonb,
  effective_date date,
  uploaded_by uuid references auth.users(id),
  superseded_by text references public.hr_document_template_versions(id),
  created_at timestamptz not null default now()
);
alter table public.hr_document_template_versions enable row level security;
drop policy if exists "hr_document_template_versions_view" on public.hr_document_template_versions;
create policy "hr_document_template_versions_view" on public.hr_document_template_versions
  for select
  using (public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_BASIC'));
drop policy if exists "hr_document_template_versions_edit" on public.hr_document_template_versions;
create policy "hr_document_template_versions_edit" on public.hr_document_template_versions
  for all
  using (public.current_role() = 'office' and public.hr_has_permission('HR_DOCUMENT_APPROVE'))
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_DOCUMENT_APPROVE'));

-- "Aktualna" verzia sablony (staru historiu si drzia jednotlive hr_documents
-- cez svoj vlastny template_version_id, tento ukazovatel je len pre novo
-- generovane dokumenty) - pridane az po vytvoreni versions kvoli kruhovej FK.
alter table public.hr_document_templates
  add column if not exists current_version_id text references public.hr_document_template_versions(id);

-- 43.7 hr_documents - generovane AJ rucne nahrane historicke dokumenty
--      (origin rozlisi ktore). Po SIGNED/ARCHIVED sa uz riadok nikdy
--      neupravuje - oprava je novy riadok cez superseded_by.
create table if not exists public.hr_documents (
  id text primary key,
  employee_id text not null references public.employees(id),
  employment_id text references public.employment_relationships(id),
  doc_type text not null,
  template_id text references public.hr_document_templates(id),
  template_version_id text references public.hr_document_template_versions(id),
  origin text not null check (origin in ('GENERATED', 'UPLOADED')),
  status text not null check (status in (
    'DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'READY_FOR_SIGNATURE', 'SIGNED', 'ARCHIVED'
  )),
  generated_at timestamptz,
  generated_by uuid references auth.users(id),
  file_path text,
  variables_snapshot jsonb not null default '{}'::jsonb,
  superseded_by text references public.hr_documents(id),
  is_manual_history_entry boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.hr_documents enable row level security;
drop policy if exists "hr_documents_view" on public.hr_documents;
create policy "hr_documents_view" on public.hr_documents
  for select
  using (public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_BASIC'));
drop policy if exists "hr_documents_insert" on public.hr_documents;
create policy "hr_documents_insert" on public.hr_documents
  for insert
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_DOCUMENT_GENERATE'));
-- Update (schvalenie/zmena stavu) - ziadna delete policy = dokumenty sa z UI nikdy nemazu.
drop policy if exists "hr_documents_update" on public.hr_documents;
create policy "hr_documents_update" on public.hr_documents
  for update
  using (public.current_role() = 'office' and (
    public.hr_has_permission('HR_DOCUMENT_GENERATE')
    or public.hr_has_permission('HR_DOCUMENT_APPROVE')
    or public.hr_has_permission('HR_DOCUMENT_SIGN')
  ))
  with check (public.current_role() = 'office' and (
    public.hr_has_permission('HR_DOCUMENT_GENERATE')
    or public.hr_has_permission('HR_DOCUMENT_APPROVE')
    or public.hr_has_permission('HR_DOCUMENT_SIGN')
  ));

-- 43.8 employment_contract_events - nemenny zaznam faktov (Section 4 planu:
--      Nastup/Podpis/Predlzenie/Zmena/Prevod na dobu neurcitu/Ukoncenie).
--      Zamerne ZIADNA update/delete policy - oprava je novy riadok, nikdy
--      uprava povodneho (vynutene na urovni RLS, nielen konvenciou v appke).
create table if not exists public.employment_contract_events (
  id text primary key,
  employment_id text not null references public.employment_relationships(id),
  event_type text not null check (event_type in (
    'CREATED', 'CONTRACT_SIGNED', 'EXTENDED', 'CHANGED', 'CONVERTED_TO_INDEFINITE', 'ENDED'
  )),
  event_date date not null,
  valid_from date,
  valid_to date,
  hr_document_id text references public.hr_documents(id),
  is_legal_override boolean not null default false,
  override_reason text,
  overridden_by uuid references auth.users(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.employment_contract_events enable row level security;
drop policy if exists "employment_contract_events_view" on public.employment_contract_events;
create policy "employment_contract_events_view" on public.employment_contract_events
  for select
  using (public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_BASIC'));
drop policy if exists "employment_contract_events_insert" on public.employment_contract_events;
create policy "employment_contract_events_insert" on public.employment_contract_events
  for insert
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_EDIT'));

-- 43.9 medical_examinations - len administrativne udaje (Section 14 planu),
--      ziadne diagnozy.
create table if not exists public.medical_examinations (
  id text primary key,
  employee_id text not null references public.employees(id),
  exam_type text,
  exam_date date,
  valid_from date,
  valid_until date,
  provider text,
  result_status text,
  hr_document_id text references public.hr_documents(id),
  notes text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.medical_examinations enable row level security;
drop policy if exists "medical_examinations_view" on public.medical_examinations;
create policy "medical_examinations_view" on public.medical_examinations
  for select
  using (public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_BASIC'));
drop policy if exists "medical_examinations_edit" on public.medical_examinations;
create policy "medical_examinations_edit" on public.medical_examinations
  for all
  using (public.current_role() = 'office' and public.hr_has_permission('HR_EDIT'))
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_EDIT'));

-- 43.10 hr_document_signatures - Section 12 planu. Ziadna update/delete
--       policy - podpisany dokument sa uz nikdy neupravuje.
create table if not exists public.hr_document_signatures (
  id text primary key,
  hr_document_id text not null references public.hr_documents(id),
  method text not null check (method in (
    'PAPER', 'TABLET_SIMPLE', 'ELECTRONIC_SIGNATURE_PROVIDER', 'OTHER'
  )),
  signer_type text not null check (signer_type in ('EMPLOYEE', 'EMPLOYER')),
  signed_at timestamptz,
  signed_by_name text,
  document_hash text,
  signing_session_id text,
  provider_reference_id text,
  device_metadata jsonb not null default '{}'::jsonb,
  uploaded_by uuid references auth.users(id),
  file_path text,
  created_at timestamptz not null default now()
);
alter table public.hr_document_signatures enable row level security;
drop policy if exists "hr_document_signatures_view" on public.hr_document_signatures;
create policy "hr_document_signatures_view" on public.hr_document_signatures
  for select
  using (public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_BASIC'));
drop policy if exists "hr_document_signatures_insert" on public.hr_document_signatures;
create policy "hr_document_signatures_insert" on public.hr_document_signatures
  for insert
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_DOCUMENT_SIGN'));

-- 43.11 employee_timeline_events - citatelny prehlad pre zalozku Historie
--       (Section 5 planu). Append-only feed - ziadna update/delete policy.
create table if not exists public.employee_timeline_events (
  id text primary key,
  employee_id text not null references public.employees(id),
  event_date date not null,
  event_type text not null,
  title text not null,
  description text,
  related_entity_type text,
  related_entity_id text,
  source text not null default 'SYSTEM' check (source in ('SYSTEM', 'MANUAL')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.employee_timeline_events enable row level security;
drop policy if exists "employee_timeline_events_view" on public.employee_timeline_events;
create policy "employee_timeline_events_view" on public.employee_timeline_events
  for select
  using (public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_BASIC'));
drop policy if exists "employee_timeline_events_insert" on public.employee_timeline_events;
create policy "employee_timeline_events_insert" on public.employee_timeline_events
  for insert
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_EDIT'));

-- 43.12 onboarding_sessions - dotaznik na tablete pre noveho zamestnanca
--       (Section 10B planu). Ziadny Supabase Auth ucet - session_token
--       gatovany cez buduce SECURITY DEFINER RPC (rovnaky princip ako
--       plan_smien_pins vyssie), ziadna klientska insert/update policy.
--       Office s HR_EDIT moze rovno citat pre obrazovku "cakaju na kontrolu".
create table if not exists public.onboarding_sessions (
  id text primary key,
  session_token text not null unique,
  status text not null default 'IN_PROGRESS' check (status in (
    'IN_PROGRESS', 'SUBMITTED', 'REVIEWED', 'DISCARDED'
  )),
  draft_data jsonb not null default '{}'::jsonb,
  submitted_at timestamptz,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  resulting_employee_id text references public.employees(id),
  created_at timestamptz not null default now()
);
alter table public.onboarding_sessions enable row level security;
drop policy if exists "onboarding_sessions_office_view" on public.onboarding_sessions;
create policy "onboarding_sessions_office_view" on public.onboarding_sessions
  for select
  using (public.current_role() = 'office' and public.hr_has_permission('HR_EDIT'));

-- 43.13 Audit log (audit_trigger z casti 39) na vsetkych HR tabulkach
--       okrem hr_permissions (spravovane priamo cez HR_ADMIN policy) a
--       onboarding_sessions (este nie je napojene na konkretneho zamestnanca).
drop trigger if exists audit_employees on public.employees;
create trigger audit_employees after insert or update or delete on public.employees
  for each row execute function public.audit_trigger();

drop trigger if exists audit_employee_sensitive_data on public.employee_sensitive_data;
create trigger audit_employee_sensitive_data after insert or update or delete on public.employee_sensitive_data
  for each row execute function public.audit_trigger();

drop trigger if exists audit_positions on public.positions;
create trigger audit_positions after insert or update or delete on public.positions
  for each row execute function public.audit_trigger();

drop trigger if exists audit_employment_relationships on public.employment_relationships;
create trigger audit_employment_relationships after insert or update or delete on public.employment_relationships
  for each row execute function public.audit_trigger();

drop trigger if exists audit_employment_contract_events on public.employment_contract_events;
create trigger audit_employment_contract_events after insert or update or delete on public.employment_contract_events
  for each row execute function public.audit_trigger();

drop trigger if exists audit_medical_examinations on public.medical_examinations;
create trigger audit_medical_examinations after insert or update or delete on public.medical_examinations
  for each row execute function public.audit_trigger();

drop trigger if exists audit_hr_document_templates on public.hr_document_templates;
create trigger audit_hr_document_templates after insert or update or delete on public.hr_document_templates
  for each row execute function public.audit_trigger();

drop trigger if exists audit_hr_document_template_versions on public.hr_document_template_versions;
create trigger audit_hr_document_template_versions after insert or update or delete on public.hr_document_template_versions
  for each row execute function public.audit_trigger();

drop trigger if exists audit_hr_documents on public.hr_documents;
create trigger audit_hr_documents after insert or update or delete on public.hr_documents
  for each row execute function public.audit_trigger();

drop trigger if exists audit_hr_document_signatures on public.hr_document_signatures;
create trigger audit_hr_document_signatures after insert or update or delete on public.hr_document_signatures
  for each row execute function public.audit_trigger();

-- 43.14 Storage bucket pre HR dokumenty (sablony, generovane aj rucne
--       nahrane historicke subory, podpisane sceny) - rovnaky vzor ako
--       kvalita-dokumenty vyssie, len navyse vyzaduje HR_VIEW_BASIC.
insert into storage.buckets (id, name, public)
values ('hr-dokumenty', 'hr-dokumenty', false)
on conflict (id) do nothing;

drop policy if exists "hr_dokumenty_files_office" on storage.objects;
create policy "hr_dokumenty_files_office" on storage.objects
  for all
  using (bucket_id = 'hr-dokumenty' and public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_BASIC'))
  with check (bucket_id = 'hr-dokumenty' and public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_BASIC'));

-- ============================================================
-- 44. hr_admin_delete_employee - jediny sposob, ako natvrdo a nevratne
--     zmazat zamestnanca aj s celou historiou (vratane udalosti, ktore
--     RLS policies vyssie zamerne chranili pred bezym update/delete).
--     Urcene VYHRADNE na opravu omylov (napr. duplicitne testovacie
--     zaznamy) - nie na bezne "ukoncenie" zamestnanca, na to sluzi
--     existujuci postup (status ENDED + employees.active = false),
--     ktory zachovava celu historiu. Iba HR_ADMIN.
-- ============================================================
create or replace function public.hr_admin_delete_employee(p_employee_id text)
returns void
language plpgsql
security definer
set search_path = public
as $body$
begin
  if not (public.current_role() = 'office' and public.hr_has_permission('HR_ADMIN')) then
    raise exception 'Neopravnene - trvale vymazani zamestnance vyzaduje HR_ADMIN.';
  end if;

  delete from public.hr_document_signatures
    where hr_document_id in (select id from public.hr_documents where employee_id = p_employee_id);
  delete from public.hr_documents where employee_id = p_employee_id;
  delete from public.employment_contract_events
    where employment_id in (select id from public.employment_relationships where employee_id = p_employee_id);
  delete from public.medical_examinations where employee_id = p_employee_id;
  delete from public.employee_timeline_events where employee_id = p_employee_id;
  delete from public.employment_relationships where employee_id = p_employee_id;
  delete from public.employee_sensitive_data where employee_id = p_employee_id;
  update public.employment_relationships set supervisor_employee_id = null where supervisor_employee_id = p_employee_id;
  update public.onboarding_sessions set resulting_employee_id = null where resulting_employee_id = p_employee_id;
  delete from public.employees where id = p_employee_id;
end;
$body$;
grant execute on function public.hr_admin_delete_employee(text) to authenticated;

-- ============================================================
-- 45. Personalistika rozsirenie (MASTER_PROMPT_Claude_Code_Stenger_ONE) -
--     VYLUCNE ADITIVNE: ziadny existujuci stlpec/tabulka/ID sa nemeni ani
--     neodstranuje. Kazda zmena existujucej RLS policy je len SPRISNENIE
--     (nova poziadavka navyse), nikdy uvolnenie.
-- ============================================================

-- 45.1 employment_terms_versions - casovo ucinne verzie pracovnych podmienok
--      (pozicia, uvazok, miesto, doba urcita/neurcita...) POD existujucim
--      employment_relationships. Riesi medzeru: dnes su tieto udaje priamo
--      stlpcami na employment_relationships BEZ historie - zmena prepise
--      bez stopy. Tato tabulka je od teraz JEDINY zdroj pravdy pre
--      "aktualne platne podmienky" (cez hr_employment_terms_as_of nizsie) -
--      stare stlpce na employment_relationships ostavaju v DB nedotknute
--      (ziadne mazanie stlpcov), ale appka ich uz po tejto migracii necita
--      priamo, aby sa nemohli s novou tabulkou rozist.
create extension if not exists btree_gist;

create table if not exists public.employment_terms_versions (
  id text primary key,
  employment_id text not null references public.employment_relationships(id),
  valid_from date,
  valid_to date,
  position_id text references public.positions(id),
  workplace text,
  weekly_hours numeric,
  employment_type text check (employment_type in ('doba_urcita', 'doba_neurcita')),
  fixed_term_end_date date,
  probation_end_date date,
  notes text,
  -- Pociatocny evidencny stav vytvoreny pri migracii/importe, nie skutocna
  -- zmluvna udalost - viz known_history_scope (bod D.8 planu / bod 1 zadania).
  is_initial_evidentiary_state boolean not null default false,
  known_history_scope text,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  -- Pomocne generovane stlpce LEN pre EXCLUDE constraint nizsie - NULL
  -- valid_from/valid_to sa spravaju ako "od/do nekonecna" (neznamy
  -- zaciatok / stale prebieha), nie ako "ignoruj konflikt".
  effective_from date generated always as (coalesce(valid_from, '0001-01-01'::date)) stored,
  effective_to date generated always as (coalesce(valid_to, '9999-12-31'::date)) stored
);
alter table public.employment_terms_versions
  drop constraint if exists employment_terms_versions_no_overlap;
alter table public.employment_terms_versions
  add constraint employment_terms_versions_no_overlap
  exclude using gist (
    employment_id with =,
    daterange(effective_from, effective_to, '[]') with &&
  );
alter table public.employment_terms_versions enable row level security;
drop policy if exists "employment_terms_versions_view" on public.employment_terms_versions;
create policy "employment_terms_versions_view" on public.employment_terms_versions
  for select
  using (public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_BASIC'));
drop policy if exists "employment_terms_versions_insert" on public.employment_terms_versions;
create policy "employment_terms_versions_insert" on public.employment_terms_versions
  for insert
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_EDIT'));
-- Ziadna update/delete policy - korekcia je novy riadok (bod D.7: "Korekcie
-- su nove auditovane zaznamy, nie prepis minulosti bez stopy"), presne ako
-- uz funguje pri employment_contract_events.

drop trigger if exists audit_employment_terms_versions on public.employment_terms_versions;
create trigger audit_employment_terms_versions after insert or update or delete on public.employment_terms_versions
  for each row execute function public.audit_trigger();

-- Zisti platne podmienky pomeru k danemu datumu (Europe/Prague date-only,
-- appka posiela p_as_of explicitne - ZIADNE spolienanie na server "now()").
-- NIE je security definer - respektuje RLS volajuceho (rovnake opravnenie
-- ako priamy SELECT nad employment_terms_versions).
create or replace function public.hr_employment_terms_as_of(p_employment_id text, p_as_of date)
returns setof public.employment_terms_versions
language sql
stable
as $$
  select *
  from public.employment_terms_versions
  where employment_id = p_employment_id
    and (valid_from is null or valid_from <= p_as_of)
    and (valid_to is null or valid_to >= p_as_of)
  order by valid_from desc nulls last, created_at desc
  limit 1;
$$;

-- Jednorazovy (idempotentny) backfill - pre kazdy existujuci pomer bez
-- akejkolvek terms_versions vytvori PRESNE JEDEN pociatocny evidencny
-- zaznam. valid_from je zamerne NULL (nie employment_relationships.start_date) -
-- pozname len TO, ze tieto hodnoty su AKTUALNE platne, nie od kedy presne
-- tieto KONKRETNE podmienky zacali platit (bod 1 zadania: "Nepredstieraj,
-- ze dnesne podmienky platili od povodneho nastupu, ak to nemame dolozene").
insert into public.employment_terms_versions (
  id, employment_id, valid_from, valid_to, position_id, workplace, weekly_hours,
  employment_type, fixed_term_end_date, probation_end_date,
  is_initial_evidentiary_state, known_history_scope, created_at
)
select
  er.id || '-initial-terms',
  er.id,
  null,
  null,
  er.position_id, er.workplace, er.weekly_hours,
  er.employment_type, er.fixed_term_end_date, er.probation_end_date,
  true,
  'Počáteční evidenční stav vytvořený při migraci na verziované podmínky. '
    || 'Nástup pomeru je evidovaný jako ' || coalesce(er.start_date::text, 'neznámé datum')
    || ', ale přesné datum, odkdy platí TYTO KONKRÉTNÍ podmínky (pozice/úvazek/místo), '
    || 'není doloženo - hodnoty odpovídají poslednímu známému stavu v okamžiku migrace.',
  er.created_at
from public.employment_relationships er
where not exists (
  select 1 from public.employment_terms_versions t where t.employment_id = er.id
)
on conflict (id) do nothing;

-- 45.2 employee_payroll_data - mzdove/rodinne podklady (bod D.3 planu:
--      ucet, poistovna, odmeny, danove vyhlasenia/zlavy, zavisle osoby,
--      subehy, zrazky, administrativne dochodkove/poistne statusy,
--      cudzinecke udaje). ODDELENE od employee_sensitive_data (rodne cislo,
--      cislo dokladu - tie ostavaju tam, bez zmeny) - novy, PRIDANY tier
--      citlivosti, nie nahradenie existujuceho. Bank account/foreigner_data
--      historicky uz su v employee_sensitive_data (ostavaju tam nezmenene,
--      kvoli zakazu mazania stlpcov) - vedomy zvyskovy nesulad zaznamenany
--      v sprave, nie ticho "opraveny" presunom dat.
create table if not exists public.employee_payroll_data (
  employee_id text primary key references public.employees(id) on delete cascade,
  tax_declaration jsonb not null default '{}'::jsonb,
  dependents jsonb not null default '[]'::jsonb,
  concurrent_employment jsonb not null default '{}'::jsonb,
  garnishments jsonb not null default '{}'::jsonb,
  pension_insurance_status jsonb not null default '{}'::jsonb,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.employee_payroll_data enable row level security;
drop policy if exists "employee_payroll_data_view" on public.employee_payroll_data;
create policy "employee_payroll_data_view" on public.employee_payroll_data
  for select
  using (public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_PAYROLL'));
drop policy if exists "employee_payroll_data_edit" on public.employee_payroll_data;
create policy "employee_payroll_data_edit" on public.employee_payroll_data
  for all
  using (public.current_role() = 'office' and public.hr_has_permission('HR_EDIT') and public.hr_has_permission('HR_VIEW_PAYROLL'))
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_EDIT') and public.hr_has_permission('HR_VIEW_PAYROLL'));

drop trigger if exists audit_employee_payroll_data on public.employee_payroll_data;
create trigger audit_employee_payroll_data after insert or update or delete on public.employee_payroll_data
  for each row execute function public.audit_trigger();

-- 45.3 medical_examinations - sprisnenie na SAMOSTATNY tier (bod 2 zadania:
--      "administratívnu evidenciu prehliadok" oddelit od mzdovych/rodinnych
--      aj od bezneho HR_VIEW_BASIC). Predtym: HR_VIEW_BASIC/HR_EDIT (rovnake
--      ako vsetko ostatne). Teraz: vlastne HR_VIEW_MEDICAL_ADMIN.
drop policy if exists "medical_examinations_view" on public.medical_examinations;
create policy "medical_examinations_view" on public.medical_examinations
  for select
  using (public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_MEDICAL_ADMIN'));
drop policy if exists "medical_examinations_edit" on public.medical_examinations;
create policy "medical_examinations_edit" on public.medical_examinations
  for all
  using (public.current_role() = 'office' and public.hr_has_permission('HR_EDIT') and public.hr_has_permission('HR_VIEW_MEDICAL_ADMIN'))
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_EDIT') and public.hr_has_permission('HR_VIEW_MEDICAL_ADMIN'));

-- 45.4 hr_document_templates / _versions - stavovy workflow, hash a
--      EXPLICITNA klasifikacia citlivosti (bod 3 zadania - ZIADNA
--      automaticka analyza obsahu, HR/schvalovatel ju nastavi rucne pri
--      kazdej verzii).
alter table public.hr_document_templates
  add column if not exists status text not null default 'NAHRANA' check (status in (
    'NAHRANA', 'K_MAPOVANI', 'KE_SCHVALENI', 'SCHVALENA', 'VYRAZENA'
  ));
alter table public.hr_document_templates
  add column if not exists has_unresolved_revisions boolean not null default false;
alter table public.hr_document_templates
  add column if not exists approved_by uuid references auth.users(id);
alter table public.hr_document_templates
  add column if not exists approved_at timestamptz;

alter table public.hr_document_template_versions
  add column if not exists content_hash text;
alter table public.hr_document_template_versions
  add column if not exists mapping_status text not null default 'K_MAPOVANI' check (mapping_status in (
    'K_MAPOVANI', 'ROZPRACOVANA', 'SCHVALENA'
  ));
-- Explicitna klasifikacia citlivosti TEJTO KONKRETNEJ verzie (nie typu
-- dokumentu vseobecne - bod 3: "rozne verzie BOZP mozu obsahovat rozne
-- udaje"). Prazdne pole = zatial neklasifikovane = pod hr_document_required_permissions()
-- nizsie padne na najprisnejsi bezpecny default.
alter table public.hr_document_template_versions
  add column if not exists required_permissions text[] not null default '{}'::text[];

-- 45.5 hr_documents - dedenie opravneni zo svojej sablony/dat (bod 3
--      zadania). Nezaradeny (UPLOADED, bez template_version_id alebo s
--      prazdnou klasifikaciou) dokument je pristupny LEN HR_ADMIN, kym ho
--      niekto neklasifikuje - "Nezaradený nahraný dokument zostane
--      prístupný iba poverenému HR do kontroly".
create or replace function public.hr_document_required_permissions(p_document_id text)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_perms text[];
  v_origin text;
begin
  select tv.required_permissions, d.origin
    into v_perms, v_origin
  from public.hr_documents d
  left join public.hr_document_template_versions tv on tv.id = d.template_version_id
  where d.id = p_document_id;

  if v_perms is null or array_length(v_perms, 1) is null then
    if v_origin = 'UPLOADED' then
      return array['HR_ADMIN'];
    else
      return array['HR_VIEW_SENSITIVE'];
    end if;
  end if;
  return v_perms;
end;
$$;

drop policy if exists "hr_documents_view" on public.hr_documents;
create policy "hr_documents_view" on public.hr_documents
  for select
  using (
    public.current_role() = 'office'
    and public.hr_has_permission('HR_VIEW_BASIC')
    and not exists (
      select 1 from unnest(public.hr_document_required_permissions(id)) as perm
      where not public.hr_has_permission(perm)
    )
  );

-- 45.6 storage.objects na buckete hr-dokumenty - rovnaka poziadavka ako
--      45.5, ale na urovni uloziska (bod 2 zadania: "Ak su vsetky udaje v
--      jednom riadku, samotne skrytie stlpcov vo frontende nestaci" plati
--      analogicky aj pre subory - vynutit aj tu, nie len v tabulke).
--      Zhoda podla file_path: ak cesta zodpoveda zaznamu v hr_documents,
--      pouzije sa jeho klasifikacia; inak (napr. subory sablon) len
--      zakladny HR_VIEW_BASIC ako doteraz.
create or replace function public.hr_object_path_visible(p_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_doc_id text;
begin
  select id into v_doc_id from public.hr_documents where file_path = p_path limit 1;
  if v_doc_id is null then
    return true; -- subor sablony a pod. - baseline HR_VIEW_BASIC uz je vynuteny v policy nizsie
  end if;
  return not exists (
    select 1 from unnest(public.hr_document_required_permissions(v_doc_id)) as perm
    where not public.hr_has_permission(perm)
  );
end;
$$;

drop policy if exists "hr_dokumenty_files_office" on storage.objects;
drop policy if exists "hr_dokumenty_files_select" on storage.objects;
create policy "hr_dokumenty_files_select" on storage.objects
  for select
  using (
    bucket_id = 'hr-dokumenty'
    and public.current_role() = 'office'
    and public.hr_has_permission('HR_VIEW_BASIC')
    and public.hr_object_path_visible(name)
  );
drop policy if exists "hr_dokumenty_files_write" on storage.objects;
create policy "hr_dokumenty_files_write" on storage.objects
  for insert
  with check (bucket_id = 'hr-dokumenty' and public.current_role() = 'office' and public.hr_has_permission('HR_EDIT'));
-- Ziadna UPDATE/DELETE policy na tomto bucketi vobec - podpisane/vydane
-- subory sa nesmu prepisat/zmazat bezym uctom (bod G/K: WORM hranica).
-- Privilegovany Supabase administrator (service role / dashboard) tuto
-- hranicu technicky obist moze - vyslovne priznane v zaverecnej sprave,
-- nie je to tvrdene ako absolutna WORM zaruka.

-- 45.7 hr_admin_delete_employee - doplnit cistenie novych tabuliek (inak by
--      FK constraint zablokoval vymazanie existujuceho zaznamu). Cisto
--      rozsirenie tela existujucej funkcie, ziadna zmena jej signatury ani
--      opravnenia (stale HR_ADMIN, stale explicitna oprava duplicit).
create or replace function public.hr_admin_delete_employee(p_employee_id text)
returns void
language plpgsql
security definer
set search_path = public
as $body$
begin
  if not (public.current_role() = 'office' and public.hr_has_permission('HR_ADMIN')) then
    raise exception 'Neopravnene - trvale vymazani zamestnance vyzaduje HR_ADMIN.';
  end if;

  delete from public.hr_document_signatures
    where hr_document_id in (select id from public.hr_documents where employee_id = p_employee_id);
  delete from public.hr_documents where employee_id = p_employee_id;
  delete from public.employment_terms_versions
    where employment_id in (select id from public.employment_relationships where employee_id = p_employee_id);
  delete from public.employment_contract_events
    where employment_id in (select id from public.employment_relationships where employee_id = p_employee_id);
  delete from public.medical_examinations where employee_id = p_employee_id;
  delete from public.employee_timeline_events where employee_id = p_employee_id;
  delete from public.employment_relationships where employee_id = p_employee_id;
  delete from public.employee_sensitive_data where employee_id = p_employee_id;
  delete from public.employee_payroll_data where employee_id = p_employee_id;
  update public.employment_relationships set supervisor_employee_id = null where supervisor_employee_id = p_employee_id;
  update public.onboarding_sessions set resulting_employee_id = null where resulting_employee_id = p_employee_id;
  delete from public.employees where id = p_employee_id;
end;
$body$;
grant execute on function public.hr_admin_delete_employee(text) to authenticated;

-- 45.8 onboarding_sessions - dotaznikova relacia (tablet) MUSI byt
--      pristupna len cez SECURITY DEFINER RPC s token-based izolaciou
--      (rovnaky vzor ako plan_smien_pins), nie priamym SELECT/INSERT -
--      existujuca policy z casti 43.12 je uz len office+HR_EDIT SELECT
--      (na "cakaju na kontrolu" obrazovku), ZIADNA klientska
--      insert/update policy neexistovala ani predtym - potvrdene,
--      pridavaju sa len RPC nizsie, RLS sa nemeni.
create extension if not exists pgcrypto;

create or replace function public.hr_onboarding_start_session()
returns table (id text, session_token text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := 'onb-' || replace(gen_random_uuid()::text, '-', '');
  v_token text := replace(gen_random_uuid()::text, '-', '');
begin
  insert into public.onboarding_sessions (id, session_token, status, draft_data)
  values (v_id, v_token, 'IN_PROGRESS', '{}'::jsonb);
  return query select v_id, v_token;
end;
$$;
grant execute on function public.hr_onboarding_start_session() to anon, authenticated;

-- Ulozenie priebezneho stavu dotaznika - vyzaduje spravny token (nie
-- prihlasenie), a LEN pre relaciu v stave IN_PROGRESS. Nevracia ziadne
-- ine data ako "ok" (ziadny sposob vypisat si cudzie zaznamy cez tento RPC).
create or replace function public.hr_onboarding_save_draft(p_session_token text, p_draft_data jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.onboarding_sessions
    set draft_data = p_draft_data
    where session_token = p_session_token and status = 'IN_PROGRESS';
  return found;
end;
$$;
grant execute on function public.hr_onboarding_save_draft(text, jsonb) to anon, authenticated;

create or replace function public.hr_onboarding_submit(p_session_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.onboarding_sessions
    set status = 'SUBMITTED', submitted_at = now()
    where session_token = p_session_token and status = 'IN_PROGRESS';
  return found;
end;
$$;
grant execute on function public.hr_onboarding_submit(text) to anon, authenticated;

-- HR strana (po prihlaseni, HR_EDIT) - schvalenie/zamietnutie, cita cez
-- uz existujucu SELECT policy (43.12), tu len oznaci vysledok.
create or replace function public.hr_onboarding_review(p_session_id text, p_status text, p_resulting_employee_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.current_role() = 'office' and public.hr_has_permission('HR_EDIT')) then
    raise exception 'Neopravnene.';
  end if;
  if p_status not in ('REVIEWED', 'DISCARDED') then
    raise exception 'Neplatny stav.';
  end if;
  update public.onboarding_sessions
    set status = p_status, reviewed_by = auth.uid(), reviewed_at = now(),
        resulting_employee_id = p_resulting_employee_id
    where id = p_session_id;
  return found;
end;
$$;
grant execute on function public.hr_onboarding_review(text, text, text) to authenticated;

-- 45.9 audit_log - napojit HR_AUDIT_VIEW na SKUTOCNU RLS policy. Zisteny
-- pri overovani (bod 8 zadania - "over aj to, kam audit_trigger zapisuje...
-- a kto ich moze citat"): "HR_AUDIT_VIEW" uz existovalo v UI/HR_PERMISSION_OPTIONS
-- ako volba, ale povodna policy z casti 39 kontrolovala LEN natvrdo
-- auth.email()='dh@stenger.eu' - HR_AUDIT_VIEW nemalo ZIADNY realny ucinok.
--
-- audit_log je ZDIELANA tabulka pre CELU appku (entity = doslovny nazov
-- tabulky cez TG_TABLE_NAME, old_value/new_value su PLNY to_jsonb(OLD/NEW) -
-- t.j. pre employee_sensitive_data/employee_payroll_data obsahuju SKUTOCNE
-- rodne cislo/bankovy ucet v plaintext). Preto HR_AUDIT_VIEW NESMIE
-- odomknut cely audit_log (to by unikalo aj audit objednavok/zakaznikov
-- mimo HR) - obmedzeny len na entity nazvy HR tabuliek. dh@stenger.eu si
-- zachovava presne povodny (siroky) pristup - toto je cisto ADITIVNE
-- rozsirenie pre druhu skupinu ludi, nie oslabenie.
drop policy if exists "audit_log_office_select" on public.audit_log;
create policy "audit_log_office_select" on public.audit_log
  for select
  using (
    public.current_role() = 'office'
    and (
      auth.email() = 'dh@stenger.eu'
      or (
        public.hr_has_permission('HR_AUDIT_VIEW')
        and entity in (
          'employees', 'employee_sensitive_data', 'employee_payroll_data', 'positions',
          'employment_relationships', 'employment_terms_versions', 'employment_contract_events',
          'medical_examinations', 'hr_document_templates', 'hr_document_template_versions',
          'hr_documents', 'hr_document_signatures'
        )
      )
    )
  );

-- 45.10 hr_document_templates.doc_type - ADITIVNE rozsirenie povoleneho
-- zoznamu o presne tie 3 typy, pre ktore mame realne dodane vzory
-- (src/lib/hr/docxMapping.js TEMPLATE_REQUIRED_KEYS) - povodnych 9 hodnot
-- (vratane 'pracovni_smlouva' pre buduci vzor zmluvy, ktory user dodá
-- neskôr) ostava bezo zmeny, len sa PRIDAVAJU dalsie povolene hodnoty.
-- doc_type tu zamerne SLUZI aj ako kluc do TEMPLATE_REQUIRED_KEYS na
-- frontende (1:1 s nazvami tam), aby nevznikal duplicitny "template kind"
-- stlpec navyse.
alter table public.hr_document_templates drop constraint if exists hr_document_templates_doc_type_check;
alter table public.hr_document_templates add constraint hr_document_templates_doc_type_check
  check (doc_type in (
    'pracovni_smlouva', 'mzdovy_vymer', 'popis_pracovniho_mista', 'dodatek',
    'dohoda_o_skonceni', 'vypoved_zamestnance', 'vypoved_zamestnavatele',
    'zruseni_ve_zkusebni_dobe', 'other',
    'platovy_vymer', 'hi001_naplen_prace_delnice', 'vstupni_skoleni'
  ));

-- ============================================================
-- 46. Personalistika - kompletni historie pracovniho pomeru (pracovni pomer,
--     prodlouzeni/dodatky, lekarske prohlidky, rucne doplnena historie).
--     VYLUCNE ADITIVNE - ziadny existujuci stlpec sa nemeni ani neodstranuje,
--     ziadna existujuca RLS policy sa neuvolnuje. employment_terms_versions
--     (45.1) zostava zamerne nezapojena do UI v tejto casti - viz zaverecna
--     sprava, dovod: rozsiahly refaktor uz funkcnych, testovanych komponent
--     bez preukazanej nutnosti teraz; employment_contract_events nizsie
--     pokryva rovnaky pripad (fakticky zaznam zmeny) jednoduchsie.
-- ============================================================

-- 46.1 employment_relationships - created_by/updated_by (bod 1 zadania:
--      "created_at/by", "updated_at/by"). Vyplnaju sa z auth.uid() v appke
--      pri insert/update (rovnaky vzor ako inde v appke - RLS uz vynucuje
--      office+HR_EDIT, tieto stlpce su len auditny odtlacok navyse).
alter table public.employment_relationships add column if not exists created_by uuid references auth.users(id);
alter table public.employment_relationships add column if not exists updated_by uuid references auth.users(id);

-- 46.2 employment_contract_events - rozsirena taxonomia (bod 2 zadania) +
--      old_value/new_value/note (skutocne udalosti, nie len pocitadlo) +
--      is_manual_historical_entry (bod 11 zadania - MANUAL_HISTORICAL_ENTRY
--      ekvivalent pre tuto tabulku). Povodne hodnoty CREATED/CONTRACT_SIGNED/
--      EXTENDED/CHANGED/CONVERTED_TO_INDEFINITE/ENDED ostavaju bezo zmeny
--      (uz existujuce riadky aj kod, ktory ich vklada, funguju dalej) - len
--      sa PRIDAVAJU dalsie povolene hodnoty pre nove typy udalosti.
alter table public.employment_contract_events drop constraint if exists employment_contract_events_event_type_check;
alter table public.employment_contract_events add constraint employment_contract_events_event_type_check
  check (event_type in (
    'CREATED', 'CONTRACT_SIGNED', 'EXTENDED', 'CHANGED', 'CONVERTED_TO_INDEFINITE', 'ENDED',
    'POSITION_CHANGED', 'WORKING_HOURS_CHANGED', 'NOTICE_STARTED'
  ));
alter table public.employment_contract_events add column if not exists old_value text;
alter table public.employment_contract_events add column if not exists new_value text;
alter table public.employment_contract_events add column if not exists note text;
alter table public.employment_contract_events add column if not exists is_manual_historical_entry boolean not null default false;

-- 46.3 medical_examinations - created_by (bod 4 zadania). Zamerne ZIADNY
--      stlpec na diagnozu - len administrativne udaje, presne ako doteraz.
alter table public.medical_examinations add column if not exists created_by uuid references auth.users(id);

-- 46.4 employee_timeline_events - MANUAL_HISTORICAL_ENTRY ako dalsia povolena
--      hodnota source (bod 11 zadania) - SYSTEM/MANUAL ostavaju bezo zmeny
--      pre existujuce aj buduce bezne pripady, tato tretia hodnota sa pouziva
--      VYHRADNE z formulara "Doplnit historicka data".
alter table public.employee_timeline_events drop constraint if exists employee_timeline_events_source_check;
alter table public.employee_timeline_events add constraint employee_timeline_events_source_check
  check (source in ('SYSTEM', 'MANUAL', 'MANUAL_HISTORICAL_ENTRY'));
