import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { buildNveListData, buildNveListWorkbook, findProduktForGtin, nveProduktNazov, nveListFileName, NVE_PRIJEMCA_DEFAULT, kratkeMesto } from "./pdaExport.js";
import LAYOUT from "./__fixtures__/nveListMaxim.layout.json";

// NVE LIST vo formate MAXIM - vzdy spustany test (synteticke data, bez
// realneho suboru). Formatovanie sa porovnava so specifikaciou vytiahnutou
// z originalneho MAXIM exportu (scripts/maxim-nve-spec.py). Porovnanie
// s originalnym suborom bunka po bunke: pdaExport.maxim.test.js.

const GTIN = "04001234000015"; // EAN karton 4001234000015
const PRODUKT = { id: "P1", znacka: "TEST POPCORN", gramaz: "200", cisloArtikluSW: "62 99901", cisloArtiklu: "SNC-1", eanKarton: "4001234000015" };
const V = { id: "V1", cislo_lieferschein: "2026-0000001", stav: "dokoncena", created_at: "2026-10-13T06:00:00.000Z", dokoncena_at: "2026-10-13T10:00:00.000Z" };
const pal = (i, o = {}) => ({ id: "p" + i, vydajka_id: "V1", sscc: "00406141410000000" + i, gtin: GTIN, bbd: "2027-04-29", sarza: null, mnozstvo: 16, created_at: `2026-10-13T08:00:0${i}.000Z`, ...o });

const COLS = ["A", "B", "C", "D", "E", "F", "G", "H"];

async function roundTrip(nve) {
  const wb = await buildNveListWorkbook(nve);
  const buf = await wb.xlsx.writeBuffer();
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buf);
  return { ws: back.worksheets[0], buf };
}

function styleOf(cell) {
  const f = cell.font || {};
  const b = cell.border || {};
  return {
    font: { name: f.name, size: f.size, bold: !!f.bold, italic: !!f.italic },
    numFmt: cell.numFmt || "General",
    hAlign: (cell.alignment && cell.alignment.horizontal) || "general",
    vAlign: (cell.alignment && cell.alignment.vertical) || "bottom",
    border: { top: (b.top && b.top.style) || null, bottom: (b.bottom && b.bottom.style) || null, left: (b.left && b.left.style) || null, right: (b.right && b.right.style) || null },
  };
}

describe("NVE list - data", () => {
  it("poradie skenovania, cislo artikla (SW), nazov, LOT = MHD bez sarze, sucty", () => {
    const nve = buildNveListData(V, [pal(2, { mnozstvo: 10 }), pal(1), pal(3, { sarza: "L77" })], { products: [PRODUKT] });
    expect(nve.cislo).toBe("2026-0000001");
    expect(nve.rows.map((r) => r.sscc)).toEqual(["004061414100000001", "004061414100000002", "004061414100000003"]);
    expect(nve.rows[0]).toEqual({ poradie: "1", number: "62 99901", product: "TEST POPCORN 200g", sscc: "004061414100000001", amount: 16, unit: "box", lot: "29.04.2027", mhd: "29.04.2027" });
    expect(nve.rows[2].lot).toBe("L77");
    expect(nve.sumAmount).toBe(42);
    expect(nve.palet).toBe(3);
    expect(nve.prijemce).toEqual(NVE_PRIJEMCA_DEFAULT);
    expect(nve.upozornenia).toEqual({ bezProduktu: [], bezMnozstva: 0 });
  });
  it("datum = den dokoncenia vydajky", () => {
    expect(buildNveListData(V, [pal(1)]).datum).toBe("13.10.2026");
  });
  it("neznamy GTIN a chybajuce mnozstvo su v upozorneniach", () => {
    const nve = buildNveListData(V, [pal(1, { gtin: "09999999999999", mnozstvo: null })], { products: [PRODUKT] });
    expect(nve.rows[0]).toMatchObject({ number: "", product: "GTIN 09999999999999", amount: null });
    expect(nve.upozornenia).toEqual({ bezProduktu: ["09999999999999"], bezMnozstva: 1 });
  });
  it("hlada produkt podla EAN kartonu aj GTIN-14 s indikatorom", () => {
    expect(findProduktForGtin("04001234000015", [PRODUKT])).toBe(PRODUKT);
    expect(findProduktForGtin("14001234000012", [PRODUKT])).toBe(PRODUKT);
    expect(findProduktForGtin("04009999000015", [PRODUKT])).toBeNull();
  });
  it("nazov produktu a nazov suboru", () => {
    expect(nveProduktNazov({ znacka: "GUT&GÜNSTIG POPCORN", gramaz: "200" })).toBe("GUT&GÜNSTIG POPCORN 200g");
    expect(nveProduktNazov({ znacka: "GUT&GÜNSTIG POPCORN 200g", gramaz: "200g" })).toBe("GUT&GÜNSTIG POPCORN 200g");
    expect(nveListFileName("2026-2212015")).toBe("2026-2212015.xlsx");
    expect(nveListFileName("LS/7")).toBe("LS_7.xlsx");
  });
});

describe("NVE list - Excel subor (rozlozenie podla MAXIM)", () => {
  it("harok, zlucene bunky, sirky stlpcov, vysky riadkov", async () => {
    const { ws } = await roundTrip(buildNveListData(V, [pal(1), pal(2), pal(3)], { products: [PRODUKT] }));
    expect(ws.name).toBe(LAYOUT.sheetName);
    expect(Object.keys(ws._merges).sort()).toEqual(["A1", "A2", "A3", "A4"]);
    expect(ws._merges.A1.range).toBe("A1:E1");
    COLS.forEach((c, i) => expect(ws.getColumn(i + 1).width).toBeCloseTo(LAYOUT.columnWidths[c], 2));
    expect(ws.getRow(1).height).toBeCloseTo(LAYOUT.rowHeights.title, 2);
    expect(ws.getRow(7).height).toBeCloseTo(LAYOUT.rowHeights.dataFirst, 2);
  });

  it("riadky 1-4 nemaju bunky F-H (okrem datumu v H1), rovnako ako MAXIM", async () => {
    const { buf } = await roundTrip(buildNveListData(V, [pal(1)], { products: [PRODUKT] }));
    const sj = XLSX.read(buf, { type: "buffer", sheetStubs: true }).Sheets["NVE List"];
    expect(["F1", "G1", "F2", "G2", "H2", "F3", "G3", "H3", "F4", "G4", "H4"].filter((a) => sj[a])).toEqual([]);
    expect(sj.H1.v).toBe("Datum: 13.10.2026");
  });

  it("hodnoty: nadpis, datum, prijemca, hlavicka, palety, sucet (vzorec), TOTAL", async () => {
    const { ws } = await roundTrip(buildNveListData(V, [pal(1), pal(2), pal(3)], { products: [PRODUKT] }));
    expect(ws.getCell("A1").value).toBe("NVE LIST Nr: 2026-0000001");
    expect(ws.getCell("H1").value).toBe("Datum: 13.10.2026");
    expect([2, 3, 4].map((r) => ws.getCell("A" + r).value)).toEqual(NVE_PRIJEMCA_DEFAULT);
    expect(ws.getCell("A5").value).toBeNull();
    expect(COLS.map((c) => ws.getCell(c + "6").value)).toEqual(LAYOUT.headerLabels);
    expect(COLS.map((c) => ws.getCell(c + "7").value)).toEqual(["1", "62 99901", "TEST POPCORN 200g", "004061414100000001", 16, "box", "29.04.2027", "29.04.2027"]);
    expect(ws.getCell("E10").value).toEqual({ formula: "SUM(E7:E9)", result: 48 });
    expect(ws.getCell("D11").value).toBeNull();
    expect(["D12", "E12", "F12"].map((a) => ws.getCell(a).value)).toEqual(["TOTAL", 3, "pal"]);
  });

  it("SSCC je 18-miestny TEXT s uvodnymi nulami (aj pre Excel/SheetJS)", async () => {
    const { ws, buf } = await roundTrip(buildNveListData(V, [pal(1)], { products: [PRODUKT] }));
    expect(ws.getCell("D7").value).toBe("004061414100000001");
    expect(ws.getCell("D7").numFmt).toBe("@");
    const sj = XLSX.read(buf, { type: "buffer" }).Sheets["NVE List"];
    expect(sj.D7.t).toBe("s");
    expect(sj.D7.v).toBe("004061414100000001");
    expect(sj.A7.t).toBe("s");
    expect(sj.E7.t).toBe("n");
  });

  it("formatovanie kazdej bunky zodpoveda MAXIM (pismo, format, zarovnanie, oramovanie)", async () => {
    const { ws } = await roundTrip(buildNveListData(V, [pal(1), pal(2), pal(3)], { products: [PRODUKT] }));
    const rows = { title: 1, address1: 2, address2: 3, address3: 4, header: 6, dataFirst: 7, dataMiddle: 8, dataLast: 9, sum: 10, spacer: 11, total: 12 };
    for (const [role, r] of Object.entries(rows)) {
      for (const c of COLS) {
        // Riadky 1-4: v MAXIM existuju len bunky A:E a H1 (F-H prazdne bez formatu).
        if (r <= 4 && "FGH".includes(c) && !(r === 1 && c === "H")) continue;
        // Skryte bunky zlucenej oblasti ExcelJS pri citani preberie z prvej
        // bunky - overuje ich test "skryte bunky zlucenej hlavicky" nizsie z XML.
        if (r <= 4 && "BCDE".includes(c)) continue;
        const want = role === "title" && LAYOUT.titleCells[c + "1"] ? LAYOUT.titleCells[c + "1"] : LAYOUT.roles[role][c];
        expect({ cell: c + r, ...styleOf(ws.getCell(c + r)) }).toEqual({ cell: c + r, ...want });
      }
    }
  });

  it("skryte bunky zlucenej hlavicky (B1:E4) maju pismo/zarovnanie ako MAXIM a format General", async () => {
    const { buf } = await roundTrip(buildNveListData(V, [pal(1)], { products: [PRODUKT] }));
    const zip = await JSZip.loadAsync(buf);
    const sheet = await zip.file("xl/worksheets/sheet1.xml").async("string");
    const styles = await zip.file("xl/styles.xml").async("string");
    const xfs = styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)[1].match(/<xf [\s\S]*?(?:\/>|<\/xf>)/g);
    const fonts = styles.match(/<fonts[^>]*>([\s\S]*?)<\/fonts>/)[1].match(/<font>[\s\S]*?<\/font>/g);
    const xfOf = (a) => xfs[Number((sheet.match(new RegExp(`<c r="${a}"[^>]*?s="(\\d+)"`)) || [])[1] || 0)];
    const attr = (xf, n) => (xf.match(new RegExp(`${n}="([^"]*)"`)) || [])[1];
    for (const [r, role] of [[1, "title"], [2, "address1"], [3, "address2"], [4, "address3"]]) {
      for (const c of ["B", "C", "D", "E"]) {
        const xf = xfOf(c + r);
        const want = LAYOUT.roles[role][c];
        expect([c + r, attr(xf, "numFmtId")]).toEqual([c + r, "0"]); // General
        const font = fonts[Number(attr(xf, "fontId"))];
        expect([c + r, /<b\/>/.test(font), (font.match(/<sz val="([\d.]+)"/) || [])[1], (font.match(/<name val="([^"]+)"/) || [])[1]]).toEqual([c + r, want.font.bold, String(want.font.size), want.font.name]);
        expect([c + r, (xf.match(/horizontal="(\w+)"/) || [])[1]]).toEqual([c + r, want.hAlign]);
      }
    }
  });

  it("jedina paleta: riadok ma oramovanie hore aj dole", async () => {
    const { ws } = await roundTrip(buildNveListData(V, [pal(1)], { products: [PRODUKT] }));
    for (const c of COLS) {
      const b = styleOf(ws.getCell(c + "7")).border;
      expect([b.top, b.bottom]).toEqual(["thin", "thin"]);
    }
    expect(ws.getCell("E8").value).toEqual({ formula: "SUM(E7:E7)", result: 16 });
  });
});

describe("NVE list - mesto a gramaz", () => {
  it("mesto za cislom v nadpise aj nazve suboru", () => {
    const v = { id: "V9", cislo_lieferschein: "2026-2212740", created_at: "2026-11-10T09:00:00Z", data: { objednavka: { mesto: "LANDSBERG AM LECH" } } };
    const nve = buildNveListData(v, []);
    expect(nve.mesto).toBe("LANDSBERG");
    expect(nveListFileName(nve.cislo, nve.mesto)).toBe("2026-2212740 LANDSBERG.xlsx");
    expect(nveListFileName("2026/1")).toBe("2026_1.xlsx");
    expect(kratkeMesto("Bingen am Rhein")).toBe("BINGEN");
  });
  it("gramaz sa neopakuje", () => {
    expect(nveProduktNazov({ znacka: "EDEKA POPCORN Sladký 200 g", gramaz: "200" })).toBe("EDEKA POPCORN Sladký 200 g");
  });
});
