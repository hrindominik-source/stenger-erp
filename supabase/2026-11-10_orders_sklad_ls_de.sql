-- 2026-11-10: get_orders_for_sklad vracia aj nemecke cislo dodacieho listu (Lieferschein DE),
-- aby skladnik na PDA videl LS DE a vydajka/NVE list sa ukladali pod nim.

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
  polozky jsonb,
  nemecky_dodak_cislo text
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
    coalesce(data->'polozky', '[]'::jsonb),
    data->>'nemeckyDodakCislo'
  from public.orders
  where coalesce((data->>'stornovana')::boolean, false) = false
  order by created_at desc;
$$;

grant execute on function public.get_orders_for_sklad() to authenticated;
