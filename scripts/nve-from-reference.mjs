// Vygeneruje NVE list zo Stenger ONE z dat originalneho MAXIM exportu
// (rovnake SSCC, mnozstva, MHD, poradie) - na vizualne/nastrojove porovnanie.
//   npx vite-node scripts/nve-from-reference.mjs pda-podklady/2026-2212015.xls pda-podklady/novy.xlsx
import { readFileSync, writeFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { buildNveListData, buildNveListWorkbook } from "../src/lib/pdaExport.js";

const [src, out] = process.argv.slice(2);
const rs = XLSX.read(readFileSync(src)).Sheets["NVE List"];
const [d, m, y] = rs.H1.v.replace(/^Datum: /, "").split(".");
const vydajka = { id: "V", cislo_lieferschein: rs.A1.v.replace(/^NVE LIST Nr: /, ""), dokoncena_at: new Date(+y, +m - 1, +d, 12).toISOString() };
const palety = [];
for (let r = 7; rs["D" + r] && /^\d{18}$/.test(rs["D" + r].v); r++) {
  const [dd, mm, yyyy] = rs["H" + r].v.split(".");
  palety.push({ id: "p" + r, vydajka_id: "V", sscc: rs["D" + r].v, gtin: "04001234000015", mnozstvo: rs["E" + r].v, bbd: `${yyyy}-${mm}-${dd}`, sarza: null, created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, r)).toISOString() });
}
const products = [{ znacka: rs.C7.v.replace(/\s+\d+g$/, ""), gramaz: rs.C7.v.match(/(\d+)g$/)[1], cisloArtikluSW: rs.B7.v, eanKarton: "4001234000015" }];
const wb = await buildNveListWorkbook(buildNveListData(vydajka, palety, { products, prijemce: [rs.A2.v, rs.A3.v, rs.A4.v] }));
writeFileSync(out, Buffer.from(await wb.xlsx.writeBuffer()));
console.log("ulozene:", out, "-", palety.length, "palet");
