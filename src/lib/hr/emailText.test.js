import { describe, it, expect } from "vitest";
import { osloveni, rod, vokativPriezviskaMuz, PODPIS } from "../../../supabase/functions/_shared/hr/emailText.js";

describe("osloveni", () => {
  it("zena - priezvisko bez zmeny", () => {
    expect(osloveni({ last_name: "Nováková", gender: "zena" })).toBe("Vážená paní Nováková,");
  });
  it("muz - 5. pad pri beznych vzoroch", () => {
    expect(osloveni({ last_name: "Novák", gender: "muz" })).toBe("Vážený pane Nováku,");
    expect(osloveni({ last_name: "Svoboda", gender: "muz" })).toBe("Vážený pane Svobodo,");
    expect(osloveni({ last_name: "Černý", gender: "muz" })).toBe("Vážený pane Černý,");
    expect(osloveni({ last_name: "Hájek", gender: "muz" })).toBe("Vážený pane Hájku,");
  });
  it("muz - neisty tvar bez mena", () => {
    expect(osloveni({ last_name: "Dvořák-Testový", gender: "muz" })).toBe("Vážený pane,");
    expect(vokativPriezviskaMuz("Beneš")).toBeNull();
  });
  it("bez pohlavia neutralne", () => {
    expect(osloveni({ last_name: "Test" })).toBe("Dobrý den,");
    expect(osloveni(null)).toBe("Dobrý den,");
  });
});

describe("rod", () => {
  it("tvar podla pohlavia", () => {
    expect(rod({ gender: "zena" }, "oznámil", "oznámila")).toBe("oznámila");
    expect(rod({ gender: "muz" }, "oznámil", "oznámila")).toBe("oznámil");
    expect(rod({}, "oznámil", "oznámila")).toBe("oznámil(a)");
  });
});

describe("podpis", () => {
  it("obsahuje firmu a kontakt", () => {
    expect(PODPIS).toMatch(/Stenger Czech s\.r\.o\./);
    expect(PODPIS).toMatch(/odpovědí na tento e-mail/);
  });
});
