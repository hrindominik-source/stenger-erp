// Iba pre testy - PDA API (rovnake rozhranie ako pda/pdaApi.js) nad
// skutocnym Postgresom s PDA migraciou. Chyby maju tvar { code, message }
// ako z PostgREST. Spolu s withNetworkFaults umoznuje pustit tie iste
// scenare proti simulacii (pdaMockApi.js) aj proti skutocnej DB.

const one = (rows) => (rows && rows.length ? rows[0] : null);

export function createPglitePdaApi(q, role = "sklad") {
  async function run(fn) {
    try {
      return { data: await fn(), error: null };
    } catch (e) {
      return { data: null, error: { code: e.code, message: e.message } };
    }
  }
  const sql = (text, params) => q(role, text, params).then((r) => r.rows);

  return {
    isDemo: false,
    listWorkers: () => run(async () => []),
    listOpenVydajky: () =>
      run(async () =>
        (await sql("select v.*, (select count(*)::int from pda_palety p where p.vydajka_id = v.id) as cnt from pda_vydajky v where stav = 'rozpracovana' order by created_at desc")).map(({ cnt, ...v }) => ({ ...v, pda_palety: [{ count: cnt }] }))
      ),
    findVydajkyByLs: (cislo) => run(() => sql("select id, stav, created_at from pda_vydajky where cislo_lieferschein = $1", [cislo])),
    createVydajka: (row) =>
      run(async () => one(await sql("insert into pda_vydajky (id, cislo_lieferschein, pracovnik) values ($1, $2, $3) returning *", [row.id, row.cislo_lieferschein, row.pracovnik || ""]))),
    getVydajka: (id) => run(async () => one(await sql("select * from pda_vydajky where id = $1", [id]))),
    loadPalety: (id) => run(() => sql("select * from pda_palety where vydajka_id = $1 order by created_at desc", [id])),
    findSscc: (sscc) =>
      run(async () =>
        (await sql("select p.vydajka_id, v.stav, v.cislo_lieferschein from pda_palety p left join pda_vydajky v on v.id = p.vydajka_id where p.sscc = $1", [sscc])).map((r) => ({
          vydajka_id: r.vydajka_id,
          pda_vydajky: r.stav ? { stav: r.stav, cislo_lieferschein: r.cislo_lieferschein } : null,
        }))
      ),
    insertPaleta: (p) =>
      run(async () =>
        one(
          await sql(
            "insert into pda_palety (id, vydajka_id, sscc, gtin, bbd, bbd_ai, sarza, mnozstvo, raw_sscc, raw_produkt, pracovnik, data) values ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9,''),coalesce($10,''),coalesce($11,''),coalesce($12::jsonb,'{}')) returning *",
            [p.id, p.vydajka_id, p.sscc, p.gtin, p.bbd, p.bbd_ai, p.sarza, p.mnozstvo, p.raw_sscc, p.raw_produkt, p.pracovnik, p.data == null ? null : JSON.stringify(p.data)]
          )
        )
      ),
    getPaleta: (id) => run(async () => one(await sql("select * from pda_palety where id = $1", [id]))),
    deletePaleta: (id) => run(() => sql("delete from pda_palety where id = $1 returning *", [id])),
    deleteVydajka: (id) => run(() => sql("delete from pda_vydajky where id = $1 returning *", [id])),
    finishVydajka: (id, dokoncil) => run(async () => one(await sql("update pda_vydajky set stav = 'dokoncena', dokoncil = $2 where id = $1 and stav = 'rozpracovana' returning *", [id, dokoncil]))),
    reopenVydajka: (id) => run(async () => one(await sql("update pda_vydajky set stav = 'rozpracovana' where id = $1 returning *", [id]))),
    listVydajkyOd: (od) => run(() => sql("select * from pda_vydajky where $1::timestamptz is null or created_at >= $1 order by created_at desc", [od])),
    listPaletyOd: (od) => run(() => sql("select p.* from pda_palety p join pda_vydajky v on v.id = p.vydajka_id where $1::timestamptz is null or v.created_at >= $1 order by p.created_at", [od])),
    subscribe: () => () => {},
  };
}

const WRITES = new Set(["createVydajka", "insertPaleta", "deletePaleta", "deleteVydajka", "finishVydajka", "reopenVydajka"]);
const NET_ERROR = { message: "TypeError: Failed to fetch" };

// Obali API simulovanou sietou: net.mode = "ok" | "offline" | "lostResponse".
export function withNetworkFaults(api, net) {
  const wrapped = { ...api };
  for (const [name, fn] of Object.entries(api)) {
    if (typeof fn !== "function" || name === "subscribe") continue;
    wrapped[name] = async (...args) => {
      if (net.mode === "offline") return { data: null, error: NET_ERROR };
      const res = await fn(...args);
      if (net.mode === "lostResponse" && WRITES.has(name) && !res.error) return { data: null, error: NET_ERROR };
      return res;
    };
  }
  return wrapped;
}
