import { describe, it, expect } from "vitest";
import { snapshotPrijmu, zlucPrijem, popisRozpracovaneho } from "./prijemRozpracovany.js";

const PREDVOLENE = { dodavatel: "", material: "", mnozstvoUnit: "ks", stavPrevzatia: "V poriadku", sarza: "", dodakPath: "" };
const DODAK = { dodavatel: "Tereos", cisloDokladu: "8001", polozky: [{ popis: "Cukr" }] };

describe("snapshotPrijmu", () => {
  it("rozpracovana paleta ide medzi skeny", () => {
    const s = snapshotPrijmu({ f: PREDVOLENE, skeny: [{ sscc: "1" }], rozpracovana: { gtin: "G" } }, { verzia: "v1" });
    expect(s.skeny).toEqual([{ sscc: "1" }, { gtin: "G" }]);
    expect(s).toMatchObject({ dodak: null, dodakIdx: null, riadky: [], verzia: "v1" });
  });
});

describe("zlucPrijem", () => {
  // tablet ulozil dodaci list, PDA ma naskenovane palety
  const tablet = { f: { ...PREDVOLENE, dodavatel: "Tereos", material: "Cukr", mnozstvoUnit: "kg", dodakPath: "a/dodak.jpg" }, dodak: DODAK, dodakIdx: 0, riadky: [], skeny: [], paletyDodavky: [] };
  const pda = { f: { ...PREDVOLENE, sarza: "L1" }, dodak: null, dodakIdx: null, riadky: [], skeny: [{ sscc: "1" }, { sscc: "2" }], paletyDodavky: [] };

  it("nic sa nestrati: dodaci list z tabletu, palety a sarza z PDA", () => {
    const z = zlucPrijem(pda, tablet, PREDVOLENE);
    expect(z.dodak).toBe(DODAK);
    expect(z.dodakIdx).toBe(0);
    expect(z.skeny).toEqual([{ sscc: "1" }, { sscc: "2" }]);
    expect(z.f).toMatchObject({ dodavatel: "Tereos", material: "Cukr", mnozstvoUnit: "kg", sarza: "L1", dodakPath: "a/dodak.jpg" });
  });
  it("palety podla SSCC bez duplicit, aj opacnym smerom", () => {
    const z = zlucPrijem({ ...tablet, skeny: [{ sscc: "2" }, { sscc: "3" }] }, pda, PREDVOLENE);
    expect(z.skeny).toEqual([{ sscc: "2" }, { sscc: "3" }, { sscc: "1" }]);
    expect(z.dodak).toBe(DODAK);
    expect(z.f.sarza).toBe("L1");
  });
  it("vyplnena hodnota teraz vyhrava nad ulozenou", () => {
    const z = zlucPrijem({ ...pda, f: { ...PREDVOLENE, material: "Cukr krystal" } }, tablet, PREDVOLENE);
    expect(z.f.material).toBe("Cukr krystal");
  });
});

describe("popisRozpracovaneho", () => {
  it("dodavatel, doklad, palety, dodaci list", () => {
    expect(popisRozpracovaneho({ f: { dodavatel: "Tereos", cisloDokladu: "" }, dodak: DODAK, skeny: [{}, {}] })).toBe("Tereos · DL 8001 · 2 pal. naskenováno · dodací list ✓");
    expect(popisRozpracovaneho({ f: {}, skeny: [] })).toBe("Neznámý dodavatel · bez skenu · bez dodacího listu");
  });
});
