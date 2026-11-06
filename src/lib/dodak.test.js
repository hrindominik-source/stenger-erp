import { describe, it, expect } from "vitest";
import { normalizujDodak, normalizujDatum, extractDodak, dodakPrompt, mediaTypePodlaCesty } from "../../supabase/functions/dodak-extract/dodak.js";
import { kontrolaPrijmu, polozkaPreMaterial, paletaNaDodaku } from "./prijemPalety.js";

const ZOZNAMY = { materialy: ["Cukr krystal", "Tuk palmový"], dodavatelia: ["Test Cukr s.r.o."] };

describe("normalizujDatum", () => {
  it("rozne zapisy", () => {
    expect(normalizujDatum("5.3.2027")).toBe("05.03.2027");
    expect(normalizujDatum("05/03/27")).toBe("05.03.2027");
    expect(normalizujDatum("2027-03-05")).toBe("05.03.2027");
    expect(normalizujDatum("31.02.2027")).toBe("");
    expect(normalizujDatum("03/2027")).toBe("");
    expect(normalizujDatum("")).toBe("");
  });
});

describe("normalizujDodak", () => {
  it("jednotky, cisla, nazvy len zo zoznamu", () => {
    const r = normalizujDodak(
      {
        dodavatel: " Test Cukr ",
        dodavatelNas: "test cukr s.r.o.",
        cisloDokladu: "DL-1",
        datum: "2026-11-05",
        cisloObjednavky: "M-12",
        polozky: [
          { nazov: "Weißzucker", materialNas: "Cukr krystal", mnozstvo: "1,68", jednotka: "t", sarza: "L1", dmt: "16.10.29", pocetPaliet: "2" },
          { nazov: "Neznamy", materialNas: "Vymysleny", mnozstvo: 10, jednotka: "Stk" },
          { nazov: "", mnozstvo: 0 },
        ],
      },
      ZOZNAMY,
    );
    expect(r).toMatchObject({ jeDodak: true, dodavatelNas: "Test Cukr s.r.o.", datum: "05.11.2026", cisloObjednavky: "M-12" });
    expect(r.polozky).toHaveLength(2);
    expect(r.polozky[0]).toMatchObject({ materialNas: "Cukr krystal", mnozstvo: 1680, jednotka: "kg", sarza: "L1", dmt: "16.10.2029", pocetPaliet: 2 });
    expect(r.polozky[1]).toMatchObject({ materialNas: "", mnozstvo: 10, jednotka: "ks" });
  });
  it("nie je dodak", () => {
    expect(normalizujDodak({ jeDodak: false })).toEqual({ jeDodak: false, polozky: [] });
  });
});

describe("extractDodak", () => {
  it("posle obrazok aj zoznamy a spracuje odpoved", async () => {
    let poslane;
    const fetchImpl = async (url, opts) => {
      poslane = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ content: [{ type: "text", text: '```json\n{"cisloDokladu":"DL-9","polozky":[{"nazov":"Zucker","materialNas":"Cukr krystal","mnozstvo":840,"jednotka":"kg"}]}\n```' }] }) };
    };
    const r = await extractDodak({ bytes: new Uint8Array([1, 2, 3]), mediaType: "image/jpeg", apiKey: "k", ...ZOZNAMY, fetchImpl });
    expect(poslane.messages[0].content[0]).toMatchObject({ type: "image", source: { media_type: "image/jpeg", data: "AQID" } });
    expect(poslane.messages[0].content[1].text).toContain("VSEOBECNE MATERIALY:\n- Cukr krystal");
    expect(r.polozky[0]).toMatchObject({ materialNas: "Cukr krystal", mnozstvo: 840 });
  });
  it("PDF ako document, chyba API", async () => {
    let typ;
    const ok = async (u, o) => {
      typ = JSON.parse(o.body).messages[0].content[0].type;
      return { ok: true, json: async () => ({ content: [{ text: '{"jeDodak":false}' }] }) };
    };
    expect((await extractDodak({ bytes: new Uint8Array([1]), mediaType: "application/pdf", apiKey: "k", fetchImpl: ok })).jeDodak).toBe(false);
    expect(typ).toBe("document");
    const zle = async () => ({ ok: false, status: 401, text: async () => "bad key" });
    await expect(extractDodak({ bytes: new Uint8Array([1]), mediaType: "image/png", apiKey: "k", fetchImpl: zle })).rejects.toThrow(/401/);
  });
  it("prompt a typ suboru", () => {
    expect(dodakPrompt()).toContain("(prazdny)");
    expect(mediaTypePodlaCesty("a/dodak.JPG")).toBe("image/jpeg");
    expect(mediaTypePodlaCesty("a/dodak.exe")).toBe("");
  });
});

describe("krizove kontroly s dodacim listom", () => {
  const dnes = new Date(2026, 10, 5);
  const dodak = { polozky: [{ nazov: "Zucker", materialNas: "Cukr krystal", mnozstvo: 1680, jednotka: "kg", sarza: "L1, L2", dmt: "16.10.2029", pocetPaliet: 2 }], cisloObjednavky: "M-12" };
  const texty = (r) => r.map((x) => x.text).join(" | ");

  it("polozkaPreMaterial", () => {
    expect(polozkaPreMaterial(dodak, "cukr krystal")).toBe(dodak.polozky[0]);
    expect(polozkaPreMaterial(dodak, "Zucker")).toBe(dodak.polozky[0]);
    expect(polozkaPreMaterial(dodak, "Sůl")).toBe(null);
    expect(polozkaPreMaterial(dodak, "")).toBe(dodak.polozky[0]);
  });

  it("vsetko sedi = ziadne upozornenie", () => {
    const palety = [{ sarza: "L1", dmt: "16.10.2029", mnozstvo: 840 }, { sarza: "L2", dmt: "16.10.2029", mnozstvo: 840 }];
    const r = kontrolaPrijmu({ material: "Cukr krystal", mnozstvo: "1680", jednotka: "kg", palety, objednavka: { cislo: "M-12" }, dodak: { polozka: dodak.polozky[0], cisloObjednavky: "M-12", maPolozky: true }, dnes });
    expect(r).toEqual([]);
  });

  it("nesedi mnozstvo, sarza, DMT, palety, objednavka, material", () => {
    const palety = [{ sarza: "X9", dmt: "01.01.2030", mnozstvo: 840 }];
    const r = kontrolaPrijmu({ material: "Cukr krystal", mnozstvo: "840", jednotka: "kg", palety, objednavka: { cislo: "M-99" }, dodak: { polozka: dodak.polozky[0], cisloObjednavky: "M-12", maPolozky: true }, dnes });
    const t = texty(r);
    expect(t).toContain("Dodací list uvádí 1680 kg, přijímáte 840 kg");
    expect(t).toContain("Šarže na etiketě (X9)");
    expect(t).toContain("DMT na etiketě (01.01.2030)");
    expect(t).toContain("2 palet, naskenováno 1");
    expect(t).toContain("objednávku M-12, příjem je vázán na M-99");
    expect(texty(kontrolaPrijmu({ material: "Sůl", dodak: { polozka: null, maPolozky: true }, dnes }))).toContain("na dodacím listu nenalezen");
  });
});

// Tvar podla skutocnych dodakov (vymyslene cisla): viac sarzi s roznym DMT a SSCC
// na kazdu paletu, zoznam paliet s kratkymi NVE cislami, viac objednavok na doklade.
describe("dodak s viacerymi sarzami a zoznamom paliet", () => {
  const dodak = normalizujDodak({
    cisloDokladu: "DL-5",
    polozky: [
      {
        nazov: "cukr krystal 10 x 1kg",
        mnozstvo: "1,68",
        jednotka: "t",
        sarze: [
          { sarza: "B2", dmt: "21.09.2029", datumVyroby: "21.09.2026" },
          { sarza: "B1", dmt: "16.10.2029", datumVyroby: "16.10.2026" },
          { sarza: "b1", dmt: "" },
        ],
        palety: [{ sscc: "1234 5678 9012 3456 75", sarza: "B1" }, { sscc: "340123456789012340", sarza: "B2" }],
      },
      { nazov: "Kelimek", mnozstvo: 3240, jednotka: "Stk", cisloObjednavky: "450/0411", palety: [{ sscc: "86754671" }, { sscc: "" }] },
    ],
  });
  const [cukr, kelimek] = dodak.polozky;

  it("normalizacia: sarze bez duplicit, najskorsie DMT, palety len cislice, pocet paliet zo zoznamu", () => {
    expect(cukr).toMatchObject({ mnozstvo: 1680, jednotka: "kg", sarza: "B2, B1", dmt: "21.09.2029", datumVyroby: "21.09.2026", pocetPaliet: 2 });
    expect(cukr.sarze).toHaveLength(2);
    expect(cukr.palety[0].sscc).toBe("123456789012345675");
    expect(kelimek).toMatchObject({ jednotka: "ks", cisloObjednavky: "450/0411", pocetPaliet: 1, sarze: [] });
  });

  it("paletaNaDodaku: cele SSCC aj kratke NVE (seriova cast pred kontrolnou cislicou)", () => {
    expect(paletaNaDodaku("123456789012345675", cukr.palety)).toBe(true);
    expect(paletaNaDodaku("340000000867546714", kelimek.palety)).toBe(true);
    expect(paletaNaDodaku("340000000867546721", kelimek.palety)).toBe(false);
  });

  it("DMT sa porovnava s DMT sarze palety, cudzia paleta a ina objednavka polozky", () => {
    const dnes = new Date(2026, 10, 5);
    const palety = [
      { sscc: "123456789012345675", sarza: "B1", dmt: "16.10.2029", mnozstvo: 840 },
      { sscc: "340123456789012340", sarza: "B2", dmt: "21.09.2029", mnozstvo: 840 },
    ];
    const ok = kontrolaPrijmu({ material: "Cukr", mnozstvo: "1680", jednotka: "kg", palety, dodak: { polozka: cukr, maPolozky: true }, dnes });
    expect(ok).toEqual([]);
    const zle = kontrolaPrijmu({ material: "Cukr", mnozstvo: "1680", jednotka: "kg", palety: [{ ...palety[0], dmt: "21.09.2029" }, { sscc: "123456789012345682", sarza: "B2", dmt: "21.09.2029" }], dodak: { polozka: cukr, maPolozky: true }, dnes })
      .map((x) => x.text)
      .join(" | ");
    expect(zle).toContain("DMT na etiketě (21.09.2029)");
    expect(zle).toContain("Paleta 123456789012345682 není na dodacím listu");
    const obj = kontrolaPrijmu({ objednavka: { cislo: "451/0511" }, dodak: { polozka: kelimek, cisloObjednavky: "", maPolozky: true }, dnes });
    expect(obj.map((x) => x.text).join()).toContain("objednávku 450/0411");
  });
});

describe("material len z katalogu dodavatela dokladu", () => {
  const zoznamy = {
    materialy: ["Kartony"],
    katalog: [
      { dodavatel: "Cukrovar", materialy: ["Cukr krystal Bestpop"] },
      { dodavatel: "Kelimky s.r.o.", materialy: ["Kýble JET 56P red", "Víčka DET 225P"] },
    ],
    dodavatelia: ["Cukrovar", "Kelimky s.r.o."],
  };

  it("material ineho dodavatela sa zahodi, vseobecny ostane", () => {
    const r = normalizujDodak({ dodavatelNas: "Kelimky s.r.o.", polozky: [{ nazov: "JET 56P Bestpop", materialNas: "Cukr krystal Bestpop" }, { nazov: "DET", materialNas: "víčka det 225p" }, { nazov: "Krabice", materialNas: "Kartony" }] }, zoznamy);
    expect(r.polozky.map((p) => p.materialNas)).toEqual(["", "Víčka DET 225P", "Kartony"]);
  });

  it("nerozpoznany dodavatel = vsetky materialy, prompt ma sekcie podla dodavatela", () => {
    const r = normalizujDodak({ polozky: [{ nazov: "Zucker", materialNas: "Cukr krystal Bestpop" }] }, zoznamy);
    expect(r.polozky[0].materialNas).toBe("Cukr krystal Bestpop");
    const p = dodakPrompt(zoznamy);
    expect(p).toContain("## Kelimky s.r.o.\n- Kýble JET 56P red");
    expect(p).toContain("VSEOBECNE MATERIALY:\n- Kartony");
  });
});
