// Iba pre testy (vitest) - nie je importovane appkou, nebuildi sa.
// Skutocny Postgres (PGlite = Postgres vo WASM) s minimalnou emulaciou
// Supabase: roly anon/authenticated, auth.uid() z request.jwt.claim.sub
// (presne ako Supabase), profiles + current_role() zo schema.sql, orders,
// publikacia supabase_realtime. Na to sa aplikuje PDA migracia.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite, types } from "@electric-sql/pglite";

export const MIGRATION = readFileSync(fileURLToPath(new URL("../../../supabase/2026-10-13_pda.sql", import.meta.url)), "utf8");
export const ROLLBACK = readFileSync(fileURLToPath(new URL("../../../supabase/2026-10-13_pda_rollback.sql", import.meta.url)), "utf8");

export const U = {
  office: "00000000-0000-4000-8000-000000000001",
  sklad: "00000000-0000-4000-8000-000000000002",
  vyroba: "00000000-0000-4000-8000-000000000003",
  bezRole: "00000000-0000-4000-8000-000000000004",
};

export const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
-- Supabase standardne dava anon/authenticated vsetky prava na nove tabulky v public.
alter default privileges in schema public grant all on tables to anon, authenticated;

create table public.profiles (id uuid primary key references auth.users(id), full_name text, role text not null);
create or replace function public.current_role() returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;
create table public.orders (id text primary key, data jsonb not null default '{}');
create publication supabase_realtime;

insert into auth.users values ('${U.office}'), ('${U.sklad}'), ('${U.vyroba}'), ('${U.bezRole}');
insert into public.profiles values ('${U.office}', 'Office', 'office'), ('${U.sklad}', 'Sklad', 'sklad'), ('${U.vyroba}', 'Vyroba', 'vyroba');
insert into public.orders (id) values ('ORD-1');
`;

// Datumy ako retazce - rovnako ako ich vracia PostgREST (Supabase).
const PARSERS = {
  [types.DATE]: (v) => v,
  [types.TIMESTAMPTZ]: (v) => new Date(v).toISOString(),
};

export async function createSupabaseLikeDb({ migrate = true } = {}) {
  const db = new PGlite({ parsers: PARSERS });
  await db.exec(SUPABASE_STUB);
  if (migrate) await db.exec(MIGRATION);

  async function as(who) {
    await db.exec("reset role");
    if (who === "admin") return;
    const sub = who === "anon" ? "" : U[who];
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [sub]);
    await db.exec(who === "anon" ? "set role anon" : "set role authenticated");
  }

  // Serializovane - PGlite je jedno spojenie, prepinanie roly nesmie bezat sucasne.
  let chain = Promise.resolve();
  function q(who, sql, params) {
    const run = chain.then(async () => {
      await as(who);
      try {
        return await db.query(sql, params);
      } finally {
        await as("admin");
      }
    });
    chain = run.catch(() => {});
    return run;
  }

  return { db, q, as };
}
