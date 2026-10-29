import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { ODEV_POLOZKY, protokolPolozky, protokolChyby, odevChecklistItem, odevVydeje, rukaviceZaznamy, rukaviceCelkem } from "./pracovniOdev.js";
import { buildProtokolPdf } from "./pracovniOdevPdf.js";

const root = path.resolve(__dirname, "../../..");

describe("pracovní oděv – předávací protokol", () => {
  it("položky: tričko, legíny, mikina, obuv; velikosti oděvu a obuvi", () => {
    expect(ODEV_POLOZKY.map((p) => p.label)).toEqual(["Tričko", "Legíny", "Mikina", "Obuv"]);
    expect(ODEV_POLOZKY[0].velikosti).toContain("XL");
    expect(ODEV_POLOZKY[3].velikosti).toEqual(expect.arrayContaining(["35", "42", "48"]));
  });
  it("do protokolu jdou jen řádky s počtem; chybějící velikost se hlásí", () => {
    const p = protokolPolozky({ tricko: { pocet: "3", velikost: "M" }, leginy: { pocet: "0", velikost: "S" }, obuv: { pocet: "1" } });
    expect(p).toEqual([{ key: "tricko", label: "Tričko", pocet: 3, velikost: "M" }, { key: "obuv", label: "Obuv", pocet: 1, velikost: "" }]);
    expect(protokolChyby("2026-10-29", p)).toEqual(["velikost – obuv"]);
    expect(protokolChyby("", [])).toEqual(["datum předání", "alespoň jedna položka (počet kusů)"]);
  });
  it("nástupní balíček: chybí → vytvořeno → podepsáno; nevydává se", () => {
    expect(odevChecklistItem({ data: {} }).state).toBe("missing");
    expect(odevChecklistItem({ data: { odev_vydeje: [{ id: "a", datum: "2026-10-01", polozky: [] }] } }).state).toBe("created");
    expect(odevChecklistItem({ data: { odev_vydeje: [{ id: "a", sken: { path: "x.pdf" } }] } }).state).toBe("done");
    expect(odevChecklistItem({ data: { odev_nevydava: true } })).toEqual({ state: "done", detail: "nevydává se" });
  });
  it("evidence rukavic: nejnovější nahoře, součet", () => {
    const e = { data: { rukavice: [{ datum: "2026-09-01", pocet: 5 }, { datum: "2026-10-01", pocet: 10 }], odev_vydeje: [{ datum: "2026-01-01" }, { datum: "2026-10-01" }] } };
    expect(rukaviceZaznamy(e).map((z) => z.datum)).toEqual(["2026-10-01", "2026-09-01"]);
    expect(rukaviceCelkem(rukaviceZaznamy(e))).toBe(15);
    expect(odevVydeje(e)[0].datum).toBe("2026-10-01");
  });
  it("PDF protokolu se vytvoří (české znaky)", async () => {
    const fontBytes = fs.readFileSync(path.join(root, "public/hr/DejaVuSans.ttf"));
    const boldBytes = fs.readFileSync(path.join(root, "public/hr/DejaVuSans-Bold.ttf"));
    const logoBytes = fs.readFileSync(path.join(root, "public/stenger-logo.png"));
    const bytes = await buildProtokolPdf({ fontBytes, boldBytes, logoBytes }, {
      zamestnanec: { jmeno: "Žaneta Příkladová", osobniCislo: "123", datumNarozeni: "1990-05-03", pozice: "Dělník/dělnice ve výrobě" },
      datum: "2026-10-29", predal: "Personalistka",
      polozky: protokolPolozky({ tricko: { pocet: 3, velikost: "M" }, leginy: { pocet: 2, velikost: "M" }, mikina: { pocet: 1, velikost: "L" }, obuv: { pocet: 1, velikost: "39" } }),
    });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
  });
});
