-- Katalog struktury databazy na porovnanie stagingu s produkciou (a lokalnou DB).
-- IBA katalog Postgresu - ziadne riadky z aplikacnych tabuliek, ziadne heslo k DB.
-- Pouzitie: Supabase Dashboard -> SQL Editor -> vlozit cely subor -> Run ->
-- vysledok stiahnut ako CSV; dva CSV porovna scripts/compare-schema-catalog.mjs.
-- Jeden SELECT, nic nemeni. Vysledok = jedna tabulka (kind, name, def).
--
-- Bez tajnych udajov v CSV:
--  - tela funkcii, pohladov a migracii su nahradene SHA-256 (zhoda/rozdiel staci);
--  - cron ulohy len nazov, rozvrh a stav - bez prikazu;
--  - buckety len nastavenia, nie subory.
-- Tabulky, ktore nemusia existovat (supabase_migrations.schema_migrations,
-- cron.job), sa citaju cez query_to_xml - ak chybaju, vznikne riadok
-- "(chyba)" namiesto chyby dotazu. (Verzia 2 tu vracala prazdny nazov -
-- NULL z query_to_xml prichadza ako prazdny retazec; vyznam je rovnaky.)
select kind, name, def from (
  -- verzia katalogu (zmena skriptu = zmena tohto cisla)
  select 'meta' as kind, 'catalog_version' as name, '3' as def
  union all
  select 'meta', 'server_version', current_setting('server_version')

  -- tabulky a stlpce
  union all
  select 'column',
         c.table_schema || '.' || c.table_name || '.' || c.column_name,
         c.data_type || coalesce('(' || c.udt_name || ')', '') || ' null=' || c.is_nullable
           || coalesce(' default=' || c.column_default, '')
           || case when c.is_generated = 'ALWAYS' then ' generated=' || coalesce(c.generation_expression, '') else '' end
  from information_schema.columns c
  where c.table_schema = 'public'

  -- obmedzenia (PK, FK, CHECK, UNIQUE, EXCLUDE)
  union all
  select 'constraint', n.nspname || '.' || t.relname || '.' || con.conname, pg_get_constraintdef(con.oid)
  from pg_constraint con
  join pg_class t on t.oid = con.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'

  -- indexy
  union all
  select 'index', schemaname || '.' || tablename || '.' || indexname, indexdef
  from pg_indexes where schemaname = 'public'

  -- RLS zapnute / vynutene
  union all
  select 'rls', n.nspname || '.' || t.relname, 'enabled=' || t.relrowsecurity || ' forced=' || t.relforcerowsecurity
  from pg_class t join pg_namespace n on n.oid = t.relnamespace
  where n.nspname in ('public', 'storage') and t.relkind in ('r', 'p')

  -- RLS politiky (public + storage)
  union all
  select 'policy', schemaname || '.' || tablename || '.' || policyname,
         permissive || ' ' || cmd || ' to ' || array_to_string(roles, ',') || ' using(' || coalesce(qual, '') || ') check(' || coalesce(with_check, '') || ')'
  from pg_policies where schemaname in ('public', 'storage')

  -- funkcie: telo len ako SHA-256; vlastnosti (definer, search_path, volatilita) citatelne
  union all
  select 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         'returns=' || pg_get_function_result(p.oid)
           || ' definer=' || p.prosecdef
           || ' volatile=' || p.provolatile::text
           || ' config=' || coalesce(array_to_string(p.proconfig, ';'), '')
           || ' sha256=' || encode(sha256(convert_to(pg_get_functiondef(p.oid), 'UTF8')), 'hex')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind in ('f', 'p')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')

  -- pohlady: definicia ako SHA-256
  union all
  select 'view', schemaname || '.' || viewname, 'sha256=' || encode(sha256(convert_to(definition, 'UTF8')), 'hex')
  from pg_views where schemaname = 'public'

  -- triggre (public + storage, bez internych)
  union all
  select 'trigger', n.nspname || '.' || t.relname || '.' || tg.tgname, pg_get_triggerdef(tg.oid)
  from pg_trigger tg
  join pg_class t on t.oid = tg.tgrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname in ('public', 'storage') and not tg.tgisinternal

  -- prava anon / authenticated: schemy
  union all
  select 'grant_schema', s.nspname || '.' || r.rolname,
         'usage=' || has_schema_privilege(r.rolname, s.nspname, 'USAGE') || ' create=' || has_schema_privilege(r.rolname, s.nspname, 'CREATE')
  from pg_namespace s cross join pg_roles r
  where s.nspname in ('public', 'storage') and r.rolname in ('anon', 'authenticated')

  -- prava anon / authenticated: tabulky a pohlady
  union all
  select 'grant_table', table_schema || '.' || table_name || '.' || grantee, string_agg(privilege_type, ',' order by privilege_type)
  from information_schema.role_table_grants
  where table_schema in ('public', 'storage') and grantee in ('anon', 'authenticated', 'PUBLIC')
  group by table_schema, table_name, grantee

  -- prava anon / authenticated: stlpce (len ak su udelene po stlpcoch)
  union all
  select 'grant_column', table_schema || '.' || table_name || '.' || column_name || '.' || grantee, string_agg(privilege_type, ',' order by privilege_type)
  from information_schema.column_privileges cp
  where table_schema = 'public' and grantee in ('anon', 'authenticated')
    and not exists (select 1 from information_schema.role_table_grants g
                    where g.table_schema = cp.table_schema and g.table_name = cp.table_name
                      and g.grantee = cp.grantee and g.privilege_type = cp.privilege_type)
  group by table_schema, table_name, column_name, grantee

  -- prava anon / authenticated: funkcie (kto smie volat)
  union all
  select 'grant_function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ').' || r.rolname,
         'execute=' || has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join pg_roles r
  where n.nspname = 'public' and p.prokind in ('f', 'p') and r.rolname in ('anon', 'authenticated')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')

  -- prava anon / authenticated: sekvencie
  union all
  select 'grant_sequence', n.nspname || '.' || c.relname || '.' || r.rolname,
         'usage=' || has_sequence_privilege(r.rolname, c.oid, 'USAGE') || ' select=' || has_sequence_privilege(r.rolname, c.oid, 'SELECT')
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join pg_roles r
  where n.nspname = 'public' and c.relkind = 'S' and r.rolname in ('anon', 'authenticated')

  -- buckety (nastavenia, nie subory)
  union all
  select 'bucket', b.id,
         'public=' || b.public
           || ' file_size_limit=' || coalesce(b.file_size_limit::text, '')
           || ' allowed_mime_types=' || coalesce(array_to_string(b.allowed_mime_types, ','), '')
  from storage.buckets b

  -- rozsirenia
  union all
  select 'extension', e.extname, 'version=' || e.extversion || ' schema=' || e.extnamespace::regnamespace::text
  from pg_extension e

  -- historia migracii (ak tabulka existuje); obsah migracie len ako SHA-256
  union all
  select 'migration', coalesce(nullif(x.version, ''), '(chyba)'),
         case when nullif(x.version, '') is null then 'supabase_migrations.schema_migrations neexistuje'
              else 'name=' || coalesce(x.name, '') || ' sha256=' || coalesce(x.statements_sha256, '') end
  from xmltable('/table/row' passing query_to_xml(
         case when to_regclass('supabase_migrations.schema_migrations') is not null
           then 'select m.version::text as version, to_jsonb(m)->>''name'' as name,
                        encode(sha256(convert_to(coalesce((to_jsonb(m)->''statements'')::text, ''''), ''UTF8'')), ''hex'') as statements_sha256
                 from supabase_migrations.schema_migrations m'
           else 'select null::text as version, null::text as name, null::text as statements_sha256' end,
         true, false, '')
       columns version text, name text, statements_sha256 text) x

  -- cron ulohy (ak je pg_cron): nazov, rozvrh, stav - BEZ prikazu
  union all
  select 'cron_job', coalesce(nullif(x.jobname, ''), '(chyba)'),
         case when nullif(x.jobname, '') is null then 'cron.job neexistuje (pg_cron nie je zapnuty)'
              else 'schedule=' || coalesce(x.schedule, '') || ' active=' || coalesce(x.active, '') end
  from xmltable('/table/row' passing query_to_xml(
         case when to_regclass('cron.job') is not null
           then 'select coalesce(jobname, ''job#'' || jobid) as jobname, schedule, active::text as active from cron.job'
           else 'select null::text as jobname, null::text as schedule, null::text as active' end,
         true, false, '')
       columns jobname text, schedule text, active text) x
) s
order by kind, name;
