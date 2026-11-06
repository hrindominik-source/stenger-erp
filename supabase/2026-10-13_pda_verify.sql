-- ============================================================
-- Kontrola po spusteni 2026-10-13_pda.sql - LEN CITA, nic nemeni.
-- Spusti v Supabase SQL Editore; ocakavane hodnoty su v komentaroch.
-- ============================================================

-- 1) Tabulky existuju a maju zapnute RLS  -> 2 riadky, rowsecurity = true
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename in ('pda_vydajky', 'pda_palety')
order by tablename;

-- 2) Politiky -> 10 riadkov (vydajky: select, insert, update_office,
--    update_sklad, delete_office, delete_sklad; palety: select, insert,
--    update_office, delete)
select tablename, policyname, cmd from pg_policies
where schemaname = 'public' and tablename in ('pda_vydajky', 'pda_palety')
order by tablename, policyname;

-- 3) Triggre -> pda_palety_guard_trg, pda_vydajky_guard_trg, pda_vydajky_insert_guard_trg
select event_object_table, trigger_name, string_agg(event_manipulation, ',') as udalosti
from information_schema.triggers
where event_object_schema = 'public' and event_object_table in ('pda_vydajky', 'pda_palety')
group by 1, 2 order by 1, 2;

-- 4) anon nema ziadne prava -> 0 riadkov
select table_name, privilege_type from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public' and table_name in ('pda_vydajky', 'pda_palety');

-- 5) Realtime -> 2 riadky
select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and tablename in ('pda_vydajky', 'pda_palety');

-- 6) Existujuce tabulky nedotknute (len pre istotu - pocty riadkov pred/po
--    migracii musia byt rovnake)
select
  (select count(*) from public.orders) as orders,
  (select count(*) from public.expedicia_zaznamy) as expedicia_zaznamy,
  (select count(*) from public.production_outputs) as production_outputs,
  (select count(*) from public.stock_issues) as stock_issues;
