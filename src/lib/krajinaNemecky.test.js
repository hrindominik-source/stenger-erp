import { describe, it, expect } from "vitest";
import { krajinaNemecky, adresaPoNemecky } from "./krajinaNemecky.js";
import { buildLieferscheinDocHtml } from "./lieferscheinHtml.js";

describe("krajinaNemecky", () => {
  it("prelozi slovenske/ceske/anglicke nazvy", () => {
    expect(krajinaNemecky("Nemecko")).toBe("Deutschland");
    expect(krajinaNemecky(" Německo ")).toBe("Deutschland");
    expect(krajinaNemecky("Česká republika")).toBe("Tschechien");
    expect(krajinaNemecky("Slovensko")).toBe("Slowakei");
    expect(krajinaNemecky("Austria")).toBe("Österreich");
  });
  it("neznamy text vrati null", () => {
    expect(krajinaNemecky("Mayen")).toBeNull();
    expect(krajinaNemecky("")).toBeNull();
  });
});

describe("adresaPoNemecky", () => {
  it("nahradi krajinu za ciarkou aj na samostatnom riadku", () => {
    expect(adresaPoNemecky("Musterstraße 1, 12345 Musterstadt, Nemecko")).toBe("Musterstraße 1, 12345 Musterstadt, Deutschland");
    expect(adresaPoNemecky("Hlavná 1\n811 01 Bratislava\nSlovensko")).toBe("Hlavná 1\n811 01 Bratislava\nSlowakei");
  });
  it("nemeni ulice ani mesta a prazdne hodnoty", () => {
    expect(adresaPoNemecky("Deutschlandstraße 5, 10115 Berlin")).toBe("Deutschlandstraße 5, 10115 Berlin");
    expect(adresaPoNemecky("")).toBe("");
    expect(adresaPoNemecky(undefined)).toBeUndefined();
  });
});

describe("Lieferschein - krajina po nemecky", () => {
  it("adresa odberatela na dodaku ma krajinu po nemecky", () => {
    const html = buildLieferscheinDocHtml({
      company: { nazov: "Dodavatel s.r.o.", adresa: "Ulica 1\n100 00 Mesto\nČeská republika" },
      customer: { nazov: "Odberatel GmbH", adresa: "Musterstraße 1, 12345 Musterstadt, Nemecko" },
      order: { adresaDodania: "Lagerweg 2\n54321 Lagerstadt\nNěmecko" },
      polozky: [],
    });
    expect(html).toContain("12345 Musterstadt, Deutschland");
    expect(html).not.toMatch(/Nemecko|Německo|Česká republika/);
    expect(html).toContain("Tschechien");
  });

  it("Excel dodaku ma krajinu po nemecky", async () => {
    let blob = null;
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    const origDoc = globalThis.document;
    URL.createObjectURL = (b) => { blob = b; return "blob:test"; };
    URL.revokeObjectURL = () => {};
    globalThis.document = { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } };
    try {
      const { buildLieferscheinXlsx } = await import("./lieferscheinXlsx.js");
      await buildLieferscheinXlsx({
        order: { id: "t1", cisloDodaciehoListu: "T1", adresaDodania: "Lagerweg 2\n54321 Lagerstadt, Německo", polozky: [] },
        company: { nazov: "Dodavatel s.r.o.", adresa: "Ulica 1\n100 00 Mesto, Česká republika" },
        customer: { nazov: "Odberatel GmbH", adresa: "Musterstraße 1\n12345 Musterstadt, Nemecko" },
        products: [],
      });
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await blob.arrayBuffer());
      const ws = wb.worksheets[0];
      expect(String(ws.getCell("G8").value)).toContain("12345 Musterstadt, Deutschland");
      expect(String(ws.getCell("D6").value)).toContain("Deutschland");
      expect(String(ws.getCell("A8").value)).toContain("Tschechien");
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
      globalThis.document = origDoc;
    }
  });
});
