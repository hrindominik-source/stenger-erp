import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createSupabaseLikeDb, SUPABASE_STUB, MIGRATION, ROLLBACK, U } from "./__testutils__/pgliteSupabase.js";
import { pdaErrorMessage, isPrimaryKeyConflict } from "../lib/pdaScan.js";
import { gs1CheckDigit } from "../lib/gs1.js";

// Skutocny Postgres (PGlite = Postgres skompilovany do WASM) - overuje
// supabase/2026-10-13_pda.sql (triggre, RLS, granty) bez produkcneho Supabase.

const SSCC1 = "106141411234567897";
const SSCC2 = "359012345000000013";
const GTIN = "14001234000012";
const SSCC3 = "30614141000000777" + gs1CheckDigit("30614141000000777");

let db;
let q;

async function fails(who, sql, params) {
  try {
    await q(who, sql, params);
  } catch (e) {
    return String(e.message || e);
  }
  throw new Error("Ocakavana chyba, ale prikaz presiel: " + sql);
}

const newVydajka = (who, id, ls = "LS-" + id) =>
  q(who, "insert into pda_vydajky (id, cislo_lieferschein, pracovnik) values ($1, $2, 'Test') returning *", [id, ls]);
const newPaleta = (who, id, vydajkaId, sscc) =>
  q(who, "insert into pda_palety (id, vydajka_id, sscc, gtin, bbd, bbd_ai, sarza, mnozstvo) values ($1, $2, $3, $4, '2027-03-15', '15', 'L1', 48) returning *", [id, vydajkaId, sscc, GTIN]);
const dokoncit = (who, id) => q(who, "update pda_vydajky set stav = 'dokoncena', dokoncil = 'Test' where id = $1 returning *", [id]);

beforeAll(async () => {
  ({ db, q } = await createSupabaseLikeDb());
  // Idempotencia - druhe spustenie nesmie zlyhat.
  await db.exec(MIGRATION);
}, 60000);

describe("PDA migracia - struktura", () => {
  it("RLS zapnute, realtime publikacia, 10 politik, 3 triggre", async () => {
    const rls = await q("admin", "select tablename, rowsecurity from pg_tables where tablename like 'pda_%' order by 1");
    expect(rls.rows).toEqual([{ tablename: "pda_palety", rowsecurity: true }, { tablename: "pda_vydajky", rowsecurity: true }]);
    const pub = await q("admin", "select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1");
    expect(pub.rows.map((r) => r.tablename)).toEqual(["pda_palety", "pda_vydajky"]);
    const pol = await q("admin", "select count(*)::int as n from pg_policies where tablename like 'pda_%'");
    expect(pol.rows[0].n).toBe(10);
    const trg = await q("admin", "select count(distinct trigger_name)::int as n from information_schema.triggers where event_object_table like 'pda_%'");
    expect(trg.rows[0].n).toBe(3);
  });
});

describe("PDA migracia - pristup podla role", () => {
  it("anon nema ani SELECT (granty odobrate)", async () => {
    expect(await fails("anon", "select * from pda_vydajky")).toMatch(/permission denied/);
    expect(await fails("anon", "select * from pda_palety")).toMatch(/permission denied/);
  });
  it("rola vyroba a ucet bez profilu nevidia nic a nemozu vkladat", async () => {
    await newVydajka("sklad", "V-viditelnost");
    expect((await q("vyroba", "select * from pda_vydajky")).rows).toHaveLength(0);
    expect((await q("bezRole", "select * from pda_vydajky")).rows).toHaveLength(0);
    expect(await fails("vyroba", "insert into pda_vydajky (id, cislo_lieferschein) values ('X', '1')")).toMatch(/row-level security/);
    expect(await fails("bezRole", "insert into pda_vydajky (id, cislo_lieferschein) values ('Y', '1')")).toMatch(/row-level security/);
    expect((await q("sklad", "select * from pda_vydajky where id = 'V-viditelnost'")).rows).toHaveLength(1);
    expect((await q("office", "select * from pda_vydajky where id = 'V-viditelnost'")).rows).toHaveLength(1);
  });
  it("triggrove funkcie nejde volat z API", async () => {
    expect(await fails("sklad", "select public.pda_vydajky_guard()")).toMatch(/permission denied|trigger/);
  });
});

describe("PDA migracia - serverove hodnoty", () => {
  it("sklad nemoze podvrhnut created_by, stav ani dokoncena_at", async () => {
    const r = await q("sklad", `insert into pda_vydajky (id, cislo_lieferschein, created_by, dokoncena_at, dokoncil) values ('V-podvrh', '100', '${U.office}', now(), 'X') returning *`);
    expect(r.rows[0]).toMatchObject({ created_by: U.sklad, dokoncena_at: null, dokoncil: "", stav: "rozpracovana" });
    // Vlozenie rovno ako "dokoncena" trigger prepise na rozpracovanu.
    const r2 = await q("sklad", "insert into pda_vydajky (id, cislo_lieferschein, stav) values ('V-podvrh2', '101', 'dokoncena') returning stav");
    expect(r2.rows[0].stav).toBe("rozpracovana");
    const u = await q("sklad", "update pda_vydajky set dokoncena_at = now() where id = 'V-podvrh' returning dokoncena_at");
    expect(u.rows[0].dokoncena_at).toBeNull();
  });
  it("order_id smie nastavit len office; zmazanie objednavky ho vynuluje", async () => {
    expect(await fails("sklad", "insert into pda_vydajky (id, cislo_lieferschein, order_id) values ('V-ord', '1', 'ORD-1')")).toMatch(/PDA_ORDER_ID/);
    await newVydajka("sklad", "V-ord2");
    expect(await fails("sklad", "update pda_vydajky set order_id = 'ORD-1' where id = 'V-ord2'")).toMatch(/PDA_ORDER_ID/);
    await q("office", "update pda_vydajky set order_id = 'ORD-1' where id = 'V-ord2'");
    await q("admin", "delete from orders where id = 'ORD-1'");
    expect((await q("office", "select order_id from pda_vydajky where id = 'V-ord2'")).rows[0].order_id).toBeNull();
  });
  it("kontroly formatu: SSCC 18 cislic, GTIN 14, prazdny LS", async () => {
    await newVydajka("sklad", "V-format");
    expect(await fails("sklad", "insert into pda_palety (id, vydajka_id, sscc) values ('P-f1', 'V-format', '123')")).toMatch(/check constraint/);
    expect(await fails("sklad", "insert into pda_palety (id, vydajka_id, sscc, gtin) values ('P-f2', 'V-format', $1, '12')", [SSCC1])).toMatch(/check constraint/);
    expect(await fails("sklad", "insert into pda_vydajky (id, cislo_lieferschein) values ('V-f', '   ')")).toMatch(/check constraint/);
  });
});

describe("PDA migracia - zivotny cyklus vydajky", () => {
  it("prazdnu vydajku nejde dokoncit", async () => {
    await newVydajka("sklad", "V-prazdna");
    expect(await fails("sklad", "update pda_vydajky set stav = 'dokoncena' where id = 'V-prazdna'")).toMatch(/PDA_PRAZDNA/);
  });

  it("duplicita SSCC v tej istej vydajke = unique", async () => {
    await newVydajka("sklad", "V-A", "4711");
    await newPaleta("sklad", "P-A1", "V-A", SSCC1);
    expect(await fails("sklad", "insert into pda_palety (id, vydajka_id, sscc) values ('P-A1b', 'V-A', $1)", [SSCC1])).toMatch(/duplicate key|unique/);
  });

  it("dokoncenie, potom je vydajka zamknuta pre sklad", async () => {
    const r = await dokoncit("sklad", "V-A");
    expect(r.rows[0].stav).toBe("dokoncena");
    expect(r.rows[0].dokoncena_at).not.toBeNull();
    expect(await fails("sklad", "insert into pda_palety (id, vydajka_id, sscc) values ('P-A2', 'V-A', $1)", [SSCC2])).toMatch(/PDA_VYDAJKA_DOKONCENA/);
    expect(await fails("sklad", "delete from pda_palety where id = 'P-A1'")).toMatch(/PDA_VYDAJKA_DOKONCENA/);
    // Znovu otvorenie skladom - RLS riadok vobec nepusti (0 zmenenych).
    const reopen = await q("sklad", "update pda_vydajky set stav = 'rozpracovana' where id = 'V-A' returning *");
    expect(reopen.rows).toHaveLength(0);
    expect((await q("sklad", "delete from pda_vydajky where id = 'V-A' returning *")).rows).toHaveLength(0);
    expect((await q("admin", "select stav from pda_vydajky where id = 'V-A'")).rows[0].stav).toBe("dokoncena");
  });

  it("SSCC z dokoncenej vydajky nejde vlozit do inej vydajky", async () => {
    await newVydajka("sklad", "V-B", "4712");
    expect(await fails("sklad", "insert into pda_palety (id, vydajka_id, sscc) values ('P-B1', 'V-B', $1)", [SSCC1])).toMatch(/PDA_SSCC_DUPLICITA.*4711/);
  });

  it("dve rozpracovane s rovnakym SSCC - dokoncit ide len prva", async () => {
    await newVydajka("sklad", "V-C", "4713");
    await newVydajka("sklad", "V-D", "4714");
    await newPaleta("sklad", "P-C1", "V-C", SSCC2);
    await newPaleta("sklad", "P-D1", "V-D", SSCC2);
    await dokoncit("sklad", "V-C");
    expect(await fails("sklad", "update pda_vydajky set stav = 'dokoncena' where id = 'V-D'")).toMatch(/PDA_SSCC_DUPLICITA/);
  });

  it("sklad zmaze len prazdnu rozpracovanu vydajku", async () => {
    expect((await q("sklad", "delete from pda_vydajky where id = 'V-D' returning *")).rows).toHaveLength(0);
    await q("sklad", "delete from pda_palety where id = 'P-D1'");
    expect((await q("sklad", "delete from pda_vydajky where id = 'V-D' returning *")).rows).toHaveLength(1);
  });

  it("office: presun palety z dokoncenej vydajky je zakazany", async () => {
    await newVydajka("office", "V-E", "4715");
    expect(await fails("office", "update pda_palety set vydajka_id = 'V-E' where id = 'P-A1'")).toMatch(/PDA_VYDAJKA_DOKONCENA/);
  });

  it("office: znovu otvorit, upravit, znovu dokoncit, zmazat (kaskada palet)", async () => {
    const r = await q("office", "update pda_vydajky set stav = 'rozpracovana' where id = 'V-A' returning *");
    expect(r.rows[0]).toMatchObject({ stav: "rozpracovana", dokoncena_at: null, dokoncil: "" });
    await q("office", "update pda_palety set mnozstvo = 40 where id = 'P-A1'");
    await dokoncit("office", "V-A");
    await q("office", "delete from pda_vydajky where id = 'V-A'");
    expect((await q("admin", "select count(*)::int as n from pda_palety where vydajka_id = 'V-A'")).rows[0].n).toBe(0);
  });

  it("created_by/created_at palety su serverove", async () => {
    await newVydajka("sklad", "V-F");
    const r = await q("sklad", `insert into pda_palety (id, vydajka_id, sscc, created_by, created_at) values ('P-F1', 'V-F', $1, '${U.office}', '2000-01-01') returning *`, [SSCC1]);
    expect(r.rows[0].created_by).toBe(U.sklad);
    expect(new Date(r.rows[0].created_at).getFullYear()).toBeGreaterThan(2000);
  });
});

describe("PDA migracia - chybove hlasky zodpovedaju tomu, co appka rozpoznava", () => {
  async function err(who, sql, params) {
    try {
      await q(who, sql, params);
    } catch (e) {
      return { code: e.code, message: e.message };
    }
    throw new Error("Ocakavana chyba: " + sql);
  }
  it("PK konflikt palety -> isPrimaryKeyConflict", async () => {
    await newVydajka("sklad", "V-err");
    await newPaleta("sklad", "P-err", "V-err", SSCC3);
    const e = await err("sklad", "insert into pda_palety (id, vydajka_id, sscc) values ('P-err', 'V-err', $1)", [SSCC1]);
    expect(e.code).toBe("23505");
    expect(isPrimaryKeyConflict(e)).toBe(true);
  });
  it("SSCC 2x vo vydajke -> nie PK konflikt, zrozumitelna hlaska", async () => {
    const e = await err("sklad", "insert into pda_palety (id, vydajka_id, sscc) values ('P-err2', 'V-err', $1)", [SSCC3]);
    expect(isPrimaryKeyConflict(e)).toBe(false);
    expect(pdaErrorMessage(e)).toBe("Toto SSCC už je v této výdejce.");
  });
  it("hlaska z triggera -> text bez prefixu PDA_", async () => {
    const e = await err("sklad", "update pda_vydajky set stav = 'dokoncena' where id = 'V-prazdna'");
    expect(pdaErrorMessage(e)).toBe("Výdejka nemá žádnou paletu.");
  });
  it("RLS -> hlaska o opravneni", async () => {
    const e = await err("vyroba", "insert into pda_vydajky (id, cislo_lieferschein) values ('V-rls', '1')");
    expect(pdaErrorMessage(e)).toMatch(/oprávnění/);
  });
});

describe("PDA migracia - rollback", () => {
  it("rollback odstrani len PDA objekty, ostatne tabulky zostanu", async () => {
    const db2 = new PGlite();
    await db2.exec(SUPABASE_STUB);
    await db2.exec(MIGRATION);
    await db2.exec(ROLLBACK);
    const t = await db2.query("select tablename from pg_tables where schemaname = 'public' order by 1");
    expect(t.rows.map((r) => r.tablename)).toEqual(["orders", "profiles"]);
    await db2.close();
  }, 60000);
});
