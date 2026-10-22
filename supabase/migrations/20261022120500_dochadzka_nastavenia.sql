-- Sekcia 36 zo schema.sql, ktora v PRODUKCII CHYBA (zistene 22.10.2026 porovnanim
-- katalogu). Aplikacia ju pouziva (src/App.jsx - nastavenia Dochadzky), v produkcii
-- teda nacitanie/ulozenie tychto nastaveni zlyhava. Lokalne sa aplikuje, do
-- produkcie LEN po schvaleni.

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

