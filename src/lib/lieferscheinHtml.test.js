import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { buildLieferscheinDocHtml, rozdelAdresuDodania } from "./lieferscheinHtml.js";

const data = {
  company: { nazov: "Firma s.r.o.", adresa: "Ulice 1\n100 00 Město", ico: "123", dic: "CZ123", email: "orders@example.cz" },
  customer: { nazov: "Odběratel GmbH", adresa: "Straße 12, 56727 Stadt", dic: "DE1" },
  order: { cisloDodaciehoListu: "60738/1211", cisloObjednavkyDopravy: "60738/1211", datumDodania: "12.11.2026", cisloObjednavkyZakaznika: "2026-1", adresaDodaniaNazov: "EDEKA <Test>", adresaDodania: "Verteilzentrum Landsberg am Lech, GLN: 4314214990108, Franz-Kollmann-Straße 2, 86899 Landsberg am Lech", pocetPaletovychMiest: 11 },
  carrierName: "Dopravce s.r.o.",
  transportPrice: { matched: true, total: 525 },
  polozky: [{ palet: "22", karton: "352 KRT", popis: "Popcorn süß", eanUK: "4311501019740", eanVE: "4311501019733", rspo: true, stk: 5280, artikel: "X", artikelNase: "EDEKA 6215200", artikelSW: "11000000422" }],
  totalPaliet: 22,
  rspoKod: "RSPO-KOD",
};

describe("Lieferschein HTML", () => {
  it("obsahuje vsetky udaje a escapuje text", () => {
    const h = buildLieferscheinDocHtml(data);
    for (const t of ["LIEFERSCHEIN", "60738/1211", "12.11.2026", "2026-1", "525", "Firma s.r.o.", "IČO: 123", "DIČ: CZ123", "Odběratel GmbH", "USt-IdNr. / DIČ: DE1", "EDEKA &lt;Test&gt;", "<b>86899 Landsberg am Lech</b>", "GLN: 4314214990108", "352 KRT", "Popcorn süß", "EAN UK: 4311501019740", "EAN VE: 4311501019733", "RSPO-KOD", "5 280", "EDEKA 6215200", "SW: 11000000422", "11 Doppelstockpal.", "22 Europaletten", "11 Stellplätze", "orders@example.cz", "Dopravce s.r.o.", "LKW-Kennzeichen / SPZ", "Übernommen / Převzato", "Ausgegeben / Vydáno", "Saldo", "Dodací list", "Paletten<span class=\"cz\">Palety</span>"]) {
      expect(h).toContain(t);
    }
    expect(h).not.toContain("<Test>");
    expect(h).not.toContain("Summe"); // pri 1 polozke bez suctu
  });
  it("viac poloziek -> riadok Summe", () => {
    const h = buildLieferscheinDocHtml({ ...data, polozky: [data.polozky[0], { ...data.polozky[0], karton: "100 KRT", stk: 1500 }], totalPaliet: 30 });
    expect(h).toContain("Summe");
    expect(h).toContain("452 KRT");
    expect(h).toContain("6 780");
  });
  it("cisto cesky dodak (karta zakaznika: Jen česky) - bez nemciny", () => {
    const h = buildLieferscheinDocHtml({ ...data, cs: true, polozky: [data.polozky[0], data.polozky[0]] });
    for (const t of ["DODACÍ LIST", "Datum dodání", "Objednávka", "Č. přepravy", "Dodavatel", "Odběratel", "Adresa dodání", "DIČ: DE1", "Palety", "Označení zboží", "Celkem", "11 dvoupatrové", "22 europalety", "11 pal. místa", "Vystavil", "SPZ", "Převzato", "Vydáno", "Datum, podpis, razítko"]) {
      expect(h).toContain(t);
    }
    for (const t of ["LIEFERSCHEIN", "Lieferschein", "Lieferdatum", "Bestellung", "Lieferant", "Abnehmer", "USt-IdNr", "Paletten", "Kartons", "Summe", "Doppelstock", "Europaletten", "Stellplätze", "Kennzeichen", "Unterschrift", "Übernommen", "Ausgegeben", " / "]) {
      expect(h).not.toContain(t);
    }
  });
  it("adresa dodania: GLN zvlast, PSC oznacene", () => {
    const k = rozdelAdresuDodania("K+K Klaas & Kock B.V. & Co. KG, GLN: 4305430009996, Zentrallager, Bessemer Straße 5, 48599 Gronau", "K+K Klaas  & Kock B.V. & Co. KG");
    expect(k.riadky.map((r) => r.text)).toEqual(["Zentrallager", "Bessemer Straße 5", "48599 Gronau"]);
    expect(k.gln).toEqual(["GLN: 4305430009996"]);
    const a = rozdelAdresuDodania("Globusallee\n55411 Bingen am Rhein");
    expect(a.gln).toEqual([]);
    expect(a.riadky).toEqual([{ text: "Globusallee", psc: false }, { text: "55411 Bingen am Rhein", psc: true }]);
  });
  it.skipIf(!process.env.LS_OUT)("export na vizualnu kontrolu", () => {
    const css = "@page { size: A4; margin: 8mm; } body{margin:0}";
    writeFileSync(process.env.LS_OUT, `<!doctype html><meta charset="utf-8"><style>${css}</style>${buildLieferscheinDocHtml(data, { minVyska: "272mm" })}`);
    const viac = { ...data, polozky: Array.from({ length: 8 }, (_, i) => ({ ...data.polozky[0], popis: "Položka " + (i + 1) })), totalPaliet: 176 };
    writeFileSync(process.env.LS_OUT.replace(".html", "_8.html"), `<!doctype html><meta charset="utf-8"><style>${css}</style>${buildLieferscheinDocHtml(viac, { minVyska: "272mm" })}`);
  });
});
