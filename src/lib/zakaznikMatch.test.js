import { describe, it, expect } from "vitest";
import { najdiZakaznika, jeNasaFirma, normNazovFirmy, zakaznikInstrukcie } from "./zakaznikMatch.js";

describe("zakaznikInstrukcie", () => {
  it("obsahuje zoznam zakaznikov bez nasej firmy", () => {
    const t = zakaznikInstrukcie("Stenger Czech s.r.o.", [{ nazov: "Stenger Waffeln GmbH" }, { nazov: "Stenger Czech s.r.o." }]);
    expect(t).toContain("  - Stenger Waffeln GmbH");
    expect(t).not.toContain("  - Stenger Czech");
    expect(t).toContain("zakaznikZoZoznamu");
  });
});

const customers = [
  { id: "c1", nazov: "Stenger Waffeln GmbH" },
  { id: "c2", nazov: "Golden Snack s.r.o." },
  { id: "c3", nazov: "Gunz Warenhandels GmbH (Nemecko)" },
];
const NASA = "Stenger Czech s.r.o.";

describe("zakaznik z objednavky", () => {
  it("nasa firma (adresat) nie je zakaznik", () => {
    expect(jeNasaFirma("Stenger Czech s.r.o", NASA)).toBe(true);
    expect(jeNasaFirma("STENGER CZECH SRO", NASA)).toBe(true);
    expect(najdiZakaznika(customers, "Stenger Czech s.r.o", NASA)).toBeNull();
  });
  it("presna aj volnejsia zhoda nazvu", () => {
    expect(najdiZakaznika(customers, "Stenger Waffeln GmbH", NASA).id).toBe("c1");
    expect(najdiZakaznika(customers, "STENGER WAFFELN GMBH", NASA).id).toBe("c1");
    expect(najdiZakaznika(customers, "Stenger Waffeln", NASA).id).toBe("c1");
    expect(najdiZakaznika(customers, "Golden Snack spol. s r.o.", NASA).id).toBe("c2");
  });
  it("nejasna alebo ziadna zhoda -> nic (vyberie sa rucne)", () => {
    expect(najdiZakaznika(customers, "Gunz Warenhandels GmbH", NASA)).toBeNull();
    expect(najdiZakaznika(customers, "Neznama firma", NASA)).toBeNull();
    expect(najdiZakaznika(customers, "", NASA)).toBeNull();
  });
  it("normalizacia", () => {
    expect(normNazovFirmy("Müller & Söhne GmbH & Co. KG")).toBe("muller sohne");
  });
});
