import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { pokynyKroky, kontaktChyby, pokynyTypZPrehliadky, POKYNY_TYPY } from "./pokynyProhlidka.js";
import { buildPokynyPdf } from "./pokynyProhlidkaPdf.js";

const kontakt = { volat: "paní MUDr. Testové", telefon: "000 000 000", ordinace: "ordinace v testovací poliklinice" };
const text = (segs) => segs.map((s) => s.t).join("");

describe("pokyny k lékařské prohlídce", () => {
  it("krok 3 obsahuje kontakt a typ prohlídky", () => {
    expect(text(pokynyKroky("vstupni", kontakt)[2])).toBe(
      "Zavolejte paní MUDr. Testové, tel. 000 000 000, ordinace v testovací poliklinice, a objednejte se na VSTUPNÍ PROHLÍDKU.");
    expect(text(pokynyKroky("periodicka", kontakt)[2])).toMatch(/PERIODICKOU PROHLÍDKU\.$/);
  });
  it("pět kroků, čtvrtý s odrážkami", () => {
    const k = pokynyKroky("vstupni", kontakt);
    expect(k).toHaveLength(5);
    expect(k[3].odrazky.map(text)).toEqual([
      "formulář LÉKAŘSKÝ POSUDEK O ZDRAVOTNÍ ZPŮSOBILOSTI K PRÁCI (obdržíte od nás)", "výpis ze zdravotní karty (viz bod 1)", "vzorek ranní moči"]);
  });
  it("chybějící kontakt", () => {
    expect(kontaktChyby({})).toEqual(["Komu zavolat", "Telefon", "Ordinace"]);
    expect(kontaktChyby(kontakt)).toEqual([]);
  });
  it("typ z prohlídky", () => {
    expect(pokynyTypZPrehliadky("Vstupní")).toBe("vstupni");
    expect(pokynyTypZPrehliadky("Periodická")).toBe("periodicka");
    expect(pokynyTypZPrehliadky("")).toBeNull();
  });
  it("PDF má jednu stranu pro oba typy", async () => {
    const read = (f) => fs.readFileSync(path.resolve("public", f));
    for (const typ of Object.keys(POKYNY_TYPY)) {
      const bytes = await buildPokynyPdf({ fontBytes: read("hr/DejaVuSans.ttf"), boldBytes: read("hr/DejaVuSans-Bold.ttf"), logoBytes: read("stenger-logo.png") },
        { typ, kontakt, zamestnanec: "Jana Testová" });
      expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
      if (process.env.POKYNY_SAMPLE_DIR) fs.writeFileSync(path.join(process.env.POKYNY_SAMPLE_DIR, `pokyny-${typ}.pdf`), bytes);
    }
  });
});
