import { describe, it, expect } from "vitest";
import { parseGs1, GS } from "./gs1.js";
import { mergeScan, EMPTY_PENDING, pdaErrorMessage, isPrimaryKeyConflict, pdaId, summarizePallets } from "./pdaScan.js";

const TODAY = new Date(2026, 9, 13);
const SSCC_A = "106141411234567897";
const SSCC_B = "359012345000000013";
const GTIN = "14001234000012";
const ssccCode = (s) => parseGs1("00" + s, TODAY);
const prodCode = (count = 48) => parseGs1("02" + GTIN + "15270315" + "37" + count + GS + "10L1", TODAY);

describe("mergeScan - lubovolne poradie", () => {
  it("SSCC potom produkt", () => {
    const a = mergeScan(EMPTY_PENDING, ssccCode(SSCC_A), new Set());
    expect(a.status).toBe("wait");
    const b = mergeScan(a.pending, prodCode(), new Set());
    expect(b.status).toBe("ready");
    expect(b.pallet).toMatchObject({ sscc: SSCC_A, gtin: GTIN, bbd: "2027-03-15", bbd_ai: "15", sarza: "L1", mnozstvo: 48 });
    expect(b.pending).toEqual(EMPTY_PENDING);
  });
  it("produkt potom SSCC", () => {
    const a = mergeScan(EMPTY_PENDING, prodCode(), new Set());
    expect(a.status).toBe("wait");
    expect(a.message).toMatch(/naskenujte SSCC/);
    const b = mergeScan(a.pending, ssccCode(SSCC_A), new Set());
    expect(b.status).toBe("ready");
    expect(b.pallet.sscc).toBe(SSCC_A);
    expect(b.pallet.raw_produkt).toContain(GTIN);
  });
  it("kombinovany kod = hned hotova paleta", () => {
    const r = mergeScan(EMPTY_PENDING, parseGs1("00" + SSCC_A + "02" + GTIN + "3748", TODAY), new Set());
    expect(r.status).toBe("ready");
    expect(r.warnings.join(" ")).toMatch(/BBD/);
  });
});

describe("mergeScan - ochrany", () => {
  it("SSCC uz vo vydajke", () => {
    const r = mergeScan(EMPTY_PENDING, ssccCode(SSCC_A), new Set([SSCC_A]));
    expect(r.status).toBe("error");
    expect(r.pending).toEqual(EMPTY_PENDING);
  });
  it("druhe, ine SSCC pri rozpracovanej palete = chyba, nic sa neprepise", () => {
    const a = mergeScan(EMPTY_PENDING, ssccCode(SSCC_A), new Set());
    const b = mergeScan(a.pending, ssccCode(SSCC_B), new Set());
    expect(b.status).toBe("error");
    expect(b.pending.sscc).toBe(SSCC_A);
  });
  it("rovnake SSCC znova = info", () => {
    const a = mergeScan(EMPTY_PENDING, ssccCode(SSCC_A), new Set());
    expect(mergeScan(a.pending, ssccCode(SSCC_A), new Set()).status).toBe("info");
  });
  it("iny produktovy kod pri rozpracovanej palete = chyba", () => {
    const a = mergeScan(EMPTY_PENDING, prodCode(48), new Set());
    const b = mergeScan(a.pending, prodCode(60), new Set());
    expect(b.status).toBe("error");
    expect(b.pending.produkt.mnozstvo).toBe(48);
  });
  it("rovnaky produktovy kod znova = info", () => {
    const a = mergeScan(EMPTY_PENDING, prodCode(48), new Set());
    expect(mergeScan(a.pending, prodCode(48), new Set()).status).toBe("info");
  });
  it("neplatny kod nemeni rozpracovanu paletu", () => {
    const a = mergeScan(EMPTY_PENDING, ssccCode(SSCC_A), new Set());
    const b = mergeScan(a.pending, parseGs1("00106141411234567898", TODAY), new Set());
    expect(b.status).toBe("error");
    expect(b.pending).toBe(a.pending);
  });
});

describe("pdaErrorMessage", () => {
  it("hlaska z triggera", () => {
    expect(pdaErrorMessage({ message: "PDA_SSCC_DUPLICITA: SSCC 1 je již v dokončené výdejce 4711." })).toBe("SSCC 1 je již v dokončené výdejce 4711.");
  });
  it("unique vo vydajke", () => {
    expect(pdaErrorMessage({ code: "23505", message: 'duplicate key value violates unique constraint "pda_palety_vydajka_id_sscc_key"' })).toMatch(/už je v této výdejce/);
  });
  it("RLS", () => {
    expect(pdaErrorMessage({ code: "42501", message: "new row violates row-level security policy" })).toMatch(/oprávnění/);
  });
  it("siet", () => {
    expect(pdaErrorMessage({ message: "TypeError: Failed to fetch" })).toMatch(/Bez připojení/);
  });
  it("PK konflikt sa rozpozna (opakovane odoslanie)", () => {
    expect(isPrimaryKeyConflict({ code: "23505", message: 'duplicate key value violates unique constraint "pda_palety_pkey"' })).toBe(true);
    expect(isPrimaryKeyConflict({ code: "23505", message: "pda_palety_vydajka_id_sscc_key" })).toBe(false);
  });
});

describe("pdaId", () => {
  it("UUID format a unikatnost", () => {
    const a = pdaId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(pdaId()).not.toBe(a);
  });
});

describe("summarizePallets", () => {
  it("zoskupi podla GTIN/BBD/sarze a scita mnozstvo", () => {
    const rows = summarizePallets([
      { gtin: GTIN, bbd: "2027-03-15", sarza: "L1", mnozstvo: 48 },
      { gtin: GTIN, bbd: "2027-03-15", sarza: "L1", mnozstvo: 40 },
      { gtin: GTIN, bbd: "2027-04-01", sarza: "L2", mnozstvo: null },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ palet: 2, mnozstvo: 88, mnozstvoNeuplne: false });
    expect(rows[1]).toMatchObject({ palet: 1, mnozstvoNeuplne: true });
  });
});
