import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { buildNveListData, buildNveListWorkbook } from "./pdaExport.js";

// Porovnanie noveho NVE listu s ORIGINALNYM exportom MJ Soft MAXIM, bunka po
// bunke (hodnota, typ text/cislo, ciselny format, vzorec, zlucene bunky,
// sirky stlpcov, rozsah). Originál obsahuje realne prevadzkove data, preto
// NIE JE v gite (pda-podklady/ v .gitignore, repo je verejne) - test bezi
// len lokalne, ked subor existuje. Pismo/oramovanie overuje vzdy
// pdaExport.nveList.test.js proti specifikacii vytiahnutej z originalu.
const REF = fileURLToPath(new URL("../../pda-podklady/2026-2212015.xls", import.meta.url));
const HAS_REF = existsSync(REF);

describe.skipIf(!HAS_REF)("NVE list vs. originalny MAXIM export (pda-podklady/2026-2212015.xls)", () => {
  let ref, gen;

  beforeAll(async () => {
    const opts = { cellNF: true, cellFormula: true, sheetStubs: true, cellStyles: true };
    ref = XLSX.read(readFileSync(REF), opts);
    const rs = ref.Sheets[ref.SheetNames[0]];

    // PDA data zrekonstruovane z originalu: rovnake SSCC, mnozstva, MHD a
    // poradie; produktova karta Stenger ONE s cislom artikla a nazvom
    // ako v MAXIM. Etiketa nesie GTIN kartonu (AI 02), ktory v MAXIM nie je.
    const cislo = rs.A1.v.replace(/^NVE LIST Nr: /, "");
    const [d, m, y] = rs.H1.v.replace(/^Datum: /, "").split(".");
    const vydajka = { id: "V", cislo_lieferschein: cislo, dokoncena_at: new Date(+y, +m - 1, +d, 12).toISOString() };
    const palety = [];
    for (let r = 7; rs["D" + r] && /^\d{18}$/.test(rs["D" + r].v); r++) {
      const [dd, mm, yyyy] = rs["H" + r].v.split(".");
      palety.push({
        id: "p" + r, vydajka_id: "V", sscc: rs["D" + r].v, gtin: "04001234000015",
        mnozstvo: rs["E" + r].v, bbd: `${yyyy}-${mm}-${dd}`, sarza: rs["G" + r].v === rs["H" + r].v ? null : rs["G" + r].v,
        created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, r)).toISOString(),
      });
    }
    const [znacka, gramaz] = [rs.C7.v.replace(/\s+\d+g$/, ""), rs.C7.v.match(/(\d+)g$/)[1]];
    const products = [{ id: "P", znacka, gramaz, cisloArtikluSW: rs.B7.v, eanKarton: "4001234000015" }];
    const prijemce = [rs.A2.v, rs.A3.v, rs.A4.v];

    const wb = await buildNveListWorkbook(buildNveListData(vydajka, palety, { products, prijemce }));
    gen = XLSX.read(await wb.xlsx.writeBuffer(), opts);
  });

  const R = () => ref.Sheets[ref.SheetNames[0]];
  const G = () => gen.Sheets[gen.SheetNames[0]];
  const cells = (ws) => Object.keys(ws).filter((k) => k[0] !== "!");

  it("harok a rozsah", () => {
    expect(gen.SheetNames).toEqual(ref.SheetNames);
    expect(G()["!ref"]).toBe(R()["!ref"]);
  });

  it("zlucene bunky", () => {
    expect(G()["!merges"]).toEqual(R()["!merges"]);
  });

  it("sirky stlpcov A-H", () => {
    for (let c = 0; c < 8; c++) expect(G()["!cols"][c].width).toBeCloseTo(R()["!cols"][c].width, 2);
  });

  it("kazda bunka: hodnota, typ, ciselny format, vzorec", () => {
    const rozdiely = [];
    const vsetky = new Set([...cells(R()), ...cells(G())]);
    for (const a of vsetky) {
      const r = R()[a] || {};
      const g = G()[a] || {};
      const want = { t: r.t, v: r.v, f: r.f };
      const got = { t: g.t, v: g.v, f: g.f };
      // Ciselny format porovnavame len pri vyplnenych bunkach (prazdne
      // naformatovane bunky SheetJS formát neuvadza).
      if (r.t && r.t !== "z") { want.z = r.z; got.z = g.z; }
      if (JSON.stringify(want) !== JSON.stringify(got)) rozdiely.push({ bunka: a, original: want, novy: got });
    }
    expect(rozdiely).toEqual([]);
  });

  it("SSCC: 38 x 18-miestny text, rovnake poradie", () => {
    const sscc = (ws) => Object.keys(ws).filter((k) => /^D\d+$/.test(k) && /^\d{18}$/.test(String(ws[k].v))).map((k) => [k, ws[k].t, ws[k].v]);
    expect(sscc(G())).toEqual(sscc(R()));
    expect(sscc(G())).toHaveLength(38);
    expect(sscc(G()).every(([, t]) => t === "s")).toBe(true);
  });

  it("sucty: SUM mnozstva a TOTAL palet", () => {
    expect([G().E45.f, G().E45.v]).toEqual([R().E45.f, R().E45.v]);
    expect([G().D47.v, G().E47.v, G().F47.v]).toEqual([R().D47.v, R().E47.v, R().F47.v]);
  });
});
