import { describe, it, expect } from "vitest";
import { parseCsv, loadCatalog, compareCatalogs, report } from "./compare-schema-catalog.mjs";

const csv = (rows) => "kind,name,def\n" + rows.map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\n") + "\n";

describe("compare-schema-catalog", () => {
  it("CSV s uvodzovkami, ciarkami a novymi riadkami v poli", () => {
    expect(parseCsv('kind,name,def\npolicy,"a.b","SELECT to x using(a, ""b"")\n  WHERE c"\r\n')).toEqual([
      ["kind", "name", "def"], ["policy", "a.b", 'SELECT to x using(a, "b")\n  WHERE c'],
    ]);
  });

  it("najde chybajuce, nadbytocne a rozdielne riadky; medzery ignoruje", () => {
    const a = loadCatalog(csv([
      ["meta", "catalog_version", "2"], ["meta", "server_version", "15.8"],
      ["function", "public.f()", "sha256=aa"], ["bucket", "hr-dokumenty", "public=false"],
      ["policy", "public.t.p", "SELECT  to authenticated\n using(true)"],
      ["migration", "20261023180000", "name=x sha256=1"],
    ]), "A");
    const b = loadCatalog("﻿" + csv([
      ["meta", "catalog_version", "2"], ["meta", "server_version", "15.6"],
      ["function", "public.f()", "sha256=bb"], ["bucket", "hr-dokumenty", "public=false"],
      ["policy", "public.t.p", "SELECT to authenticated using(true)"],
      ["cron_job", "(chyba)", "cron.job neexistuje"],
    ]), "B");
    const r = compareCatalogs(a, b);
    expect(r.onlyA.map((x) => x.name)).toEqual(["20261023180000"]);
    expect(r.onlyB.map((x) => x.name)).toEqual(["(chyba)"]);
    expect(r.changed.map((x) => x.name)).toEqual(["public.f()"]);
    const { text, differences } = report("staging", "produkcia", a, b);
    expect(differences).toBe(3);
    expect(text).toContain("Postgres: 15.8 / 15.6");
    expect(text).toContain("## Len v staging");
  });

  it("odmietne subor bez hlavicky katalogu", () => {
    expect(() => loadCatalog("a,b\n1,2\n", "X")).toThrow(/kind,name,def/);
  });
});
