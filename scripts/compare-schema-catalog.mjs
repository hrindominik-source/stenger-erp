// Porovnanie dvoch vystupov scripts/schema-catalog.sql (CSV zo Supabase SQL
// Editora alebo z psql --csv). Bez zavislosti, nic sa nikam neposiela.
//
// Spustenie:
//   node scripts/compare-schema-catalog.mjs <A.csv> <B.csv> [--out sprava.md]
//   napr. node scripts/compare-schema-catalog.mjs C:\Users\Hrin\Documents\stenger-porovnanie\staging.csv C:\Users\Hrin\Documents\stenger-porovnanie\produkcia.csv --out C:\Users\Hrin\Documents\stenger-porovnanie\porovnanie.md
//
// Vystup: co je len v A, len v B a co sa lisi (podla druhu: column, function,
// grant_table, bucket, migration ...). Medzery sa pri porovnani zjednotia.
// Navratovy kod: 0 = zhoda, 1 = rozdiely, 2 = chyba vstupu.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// CSV podla RFC 4180 (uvodzovky, ciarky a nove riadky v poli)
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

export function loadCatalog(text, label) {
  const rows = parseCsv(text);
  const header = rows.shift()?.map((h) => h.trim().toLowerCase());
  const [ki, ni, di] = ["kind", "name", "def"].map((h) => header?.indexOf(h));
  if (!header || ki < 0 || ni < 0 || di < 0) throw new Error(`${label}: chyba hlavicka kind,name,def - je to vystup scripts/schema-catalog.sql?`);
  const map = new Map();
  for (const r of rows) map.set(`${r[ki]}\u0000${r[ni]}`, { kind: r[ki], name: r[ni], def: r[di] ?? "" });
  return map;
}

const norm = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

export function compareCatalogs(a, b) {
  const onlyA = [], onlyB = [], changed = [];
  for (const [k, v] of a) {
    if (v.kind === "meta" && v.name === "server_version") continue; // hlasi sa zvlast
    if (!b.has(k)) onlyA.push(v);
    else if (norm(v.def) !== norm(b.get(k).def)) changed.push({ ...v, defB: b.get(k).def });
  }
  for (const [k, v] of b) if (!a.has(k) && !(v.kind === "meta" && v.name === "server_version")) onlyB.push(v);
  return { onlyA, onlyB, changed };
}

function byKind(list) {
  const g = new Map();
  for (const x of list) g.set(x.kind, [...(g.get(x.kind) || []), x]);
  return [...g.entries()].sort(([x], [y]) => x.localeCompare(y));
}

export function report(aName, bName, a, b) {
  const { onlyA, onlyB, changed } = compareCatalogs(a, b);
  const meta = (m, n) => m.get(`meta\u0000${n}`)?.def || "?";
  const out = [];
  out.push(`# Porovnanie struktury: ${aName} ↔ ${bName}`, "");
  out.push(`- verzia katalogu: ${meta(a, "catalog_version")} / ${meta(b, "catalog_version")}`);
  out.push(`- Postgres: ${meta(a, "server_version")} / ${meta(b, "server_version")}`);
  out.push(`- riadkov: ${a.size} / ${b.size}`);
  out.push(`- len v ${aName}: ${onlyA.length}, len v ${bName}: ${onlyB.length}, rozdielne: ${changed.length}`, "");
  if (!onlyA.length && !onlyB.length && !changed.length) out.push("Struktura je zhodna.");
  const section = (title, list, fmt) => {
    if (!list.length) return;
    out.push(`## ${title}`, "");
    for (const [kind, items] of byKind(list)) {
      out.push(`### ${kind} (${items.length})`, "");
      for (const x of items.sort((p, q) => p.name.localeCompare(q.name))) out.push(...fmt(x));
      out.push("");
    }
  };
  section(`Len v ${aName}`, onlyA, (x) => [`- \`${x.name}\`: ${norm(x.def)}`]);
  section(`Len v ${bName}`, onlyB, (x) => [`- \`${x.name}\`: ${norm(x.def)}`]);
  section("Rozdielne", changed, (x) => [`- \`${x.name}\``, `  - ${aName}: ${norm(x.def)}`, `  - ${bName}: ${norm(x.defB)}`]);
  return { text: out.join("\n") + "\n", differences: onlyA.length + onlyB.length + changed.length };
}

function main(argv) {
  const args = argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outFile = outIdx >= 0 ? args.splice(outIdx, 2)[1] : null;
  if (args.length !== 2) {
    console.error("Pouzitie: node scripts/compare-schema-catalog.mjs <A.csv> <B.csv> [--out sprava.md]");
    return 2;
  }
  const [fa, fb] = args;
  const label = (f) => path.basename(f).replace(/\.csv$/i, "");
  let a, b;
  try {
    a = loadCatalog(fs.readFileSync(fa, "utf8"), fa);
    b = loadCatalog(fs.readFileSync(fb, "utf8"), fb);
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  const { text, differences } = report(label(fa), label(fb), a, b);
  if (outFile) {
    fs.writeFileSync(outFile, text, "utf8");
    console.log(`Sprava: ${outFile} (rozdielov: ${differences})`);
  } else process.stdout.write(text);
  return differences ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv);
}
