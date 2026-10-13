-- ============================================================
-- ODVOLANIE migracie 2026-10-13_pda.sql - NEVRATNE ZMAZE VSETKY PDA VYDAJKY A PALETY.
-- Spustat len po vyslovnom rozhodnuti (napr. ak by migracia sposobila problem).
-- Pred spustenim si stiahni zalohu: Office -> PDA / Expedice -> Export Excel
-- (s prazdnym filtrom "Od"), pripadne Supabase -> Database -> Backups.
-- Ostatne tabulky Stenger ONE (orders, expedicia_zaznamy, ...) sa nemenia.
-- ============================================================

do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pda_palety') then
    alter publication supabase_realtime drop table public.pda_palety;
  end if;
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pda_vydajky') then
    alter publication supabase_realtime drop table public.pda_vydajky;
  end if;
end $$;

-- Jednym prikazom - politika pda_vydajky_delete_sklad odkazuje na pda_palety.
drop table if exists public.pda_palety, public.pda_vydajky;
drop function if exists public.pda_palety_guard();
drop function if exists public.pda_vydajky_insert_guard();
drop function if exists public.pda_vydajky_guard();
