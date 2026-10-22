-- Struktura schem public + storage IBA z katalogu Postgresu (ziadne riadky z tabuliek).
-- Pouzitie: rovnaky dotaz na lokalnej aj produkcnej DB, vystupy sa porovnaju.
-- Jeden SELECT, nic nemeni.
select kind, name, def from (
  -- tabulky a stlpce
  select 'column' as kind,
         c.table_schema || '.' || c.table_name || '.' || c.column_name as name,
         c.data_type || coalesce('(' || c.udt_name || ')', '') || ' null=' || c.is_nullable
           || coalesce(' default=' || c.column_default, '')
           || case when c.is_generated = 'ALWAYS' then ' generated=' || coalesce(c.generation_expression, '') else '' end as def
  from information_schema.columns c
  where c.table_schema = 'public'
  union all
  -- obmedzenia (PK, FK, CHECK, UNIQUE, EXCLUDE)
  select 'constraint', n.nspname || '.' || t.relname || '.' || con.conname, pg_get_constraintdef(con.oid)
  from pg_constraint con
  join pg_class t on t.oid = con.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
  union all
  -- indexy
  select 'index', schemaname || '.' || tablename || '.' || indexname, indexdef
  from pg_indexes where schemaname = 'public'
  union all
  -- RLS zapnute?
  select 'rls', n.nspname || '.' || t.relname, t.relrowsecurity::text
  from pg_class t join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public' and t.relkind = 'r'
  union all
  -- RLS politiky (public + storage)
  select 'policy', schemaname || '.' || tablename || '.' || policyname,
         cmd || ' to ' || array_to_string(roles, ',') || ' using(' || coalesce(qual, '') || ') check(' || coalesce(with_check, '') || ')'
  from pg_policies where schemaname in ('public', 'storage')
  union all
  -- funkcie (cele telo - kontrolovat na tajne udaje!)
  select 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind in ('f', 'p')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  union all
  -- prava na funkcie (kto smie volat, napr. anon)
  select 'function_grant', routine_schema || '.' || routine_name || '.' || grantee, string_agg(privilege_type, ',' order by privilege_type)
  from information_schema.routine_privileges
  where routine_schema = 'public' and grantee in ('anon', 'authenticated', 'public', 'PUBLIC')
  group by routine_schema, routine_name, grantee
  union all
  -- triggre (public + storage, bez internych)
  select 'trigger', n.nspname || '.' || t.relname || '.' || tg.tgname, pg_get_triggerdef(tg.oid)
  from pg_trigger tg
  join pg_class t on t.oid = tg.tgrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname in ('public', 'storage') and not tg.tgisinternal
  union all
  -- rozsirenia
  select 'extension', e.extname, e.extversion from pg_extension e
  union all
  -- verzia servera
  select 'server', 'version', current_setting('server_version')
) s
order by kind, name;
