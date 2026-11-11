import { describe, it, expect } from "vitest";
import { miestoVykladky, velkostPismaPrePolicko } from "./cmrXlsx.js";

describe("CMR miesto vykladky", () => {
  it("Edeka Landsberg: GLN vynechane, ulica a PSC + mesto zvlast", () => {
    const lines = ["Verteilzentrum Landsberg am Lech", "GLN: 4314214990108", "Franz-Kollmann-Straße 2", "86899 Landsberg am Lech"];
    expect(miestoVykladky(lines)).toEqual(["Verteilzentrum Landsberg am Lech, Franz-Kollmann-Straße 2", "86899 Landsberg am Lech"]);
    // nezmesti sa citatelne -> len ulica
    expect(miestoVykladky(lines, (x) => velkostPismaPrePolicko(x, 25.28) >= 8)).toEqual(["Franz-Kollmann-Straße 2", "86899 Landsberg am Lech"]);
  });
  it("bezna adresa", () => {
    expect(miestoVykladky(["Globusallee", "55411 Bingen am Rhein"])).toEqual(["Globusallee", "55411 Bingen am Rhein"]);
    expect(miestoVykladky(["Mesonweg 2", "3542AL UTRECHT"])).toEqual(["Mesonweg 2", "3542AL UTRECHT"]);
    expect(miestoVykladky(["Ulica 1", "Mesto"])).toEqual(["Ulica 1", "Mesto"]);
  });
});

describe("CMR velkost pisma", () => {
  it("kratky text ostane, dlhy sa zmensi, nie pod 6", () => {
    expect(velkostPismaPrePolicko("86899 Landsberg am Lech", 25.28)).toBe(11);
    const v = velkostPismaPrePolicko("Verteilzentrum Landsberg am Lech, Franz-Kollmann-Straße 2", 29.85);
    expect(v).toBeLessThan(11);
    expect(v).toBeGreaterThanOrEqual(6);
    expect(velkostPismaPrePolicko("x".repeat(200), 29.85)).toBe(6);
  });
});

import { stranaCmr, krajinaCmr } from "./cmrXlsx.js";

describe("CMR odosielatel / prijemca", () => {
  it("odosielatel zo zakaznika, krajina po nemecky", () => {
    expect(stranaCmr("Stenger Waffeln GmbH", "Nicolaus-Otto-Straße 12, 56727 Mayen, Nemecko")).toEqual(["STENGER WAFFELN GMBH", "NICOLAUS-OTTO-STRAßE 12", "56727 MAYEN", "DEUTSCHLAND"]);
  });
  it("prijemca Edeka: bez GLN a Verteilzentrum, predvolena krajina", () => {
    expect(stranaCmr("EDEKA SB Handels Stiftung & Co. KG", "Verteilzentrum Landsberg am Lech, GLN: 4314214990108, Franz-Kollmann-Straße 2, 86899 Landsberg am Lech", "DEUTSCHLAND")).toEqual(["EDEKA SB HANDELS STIFTUNG & CO. KG", "FRANZ-KOLLMANN-STRAßE 2", "86899 LANDSBERG AM LECH", "DEUTSCHLAND"]);
  });
  it("krajiny", () => {
    expect(krajinaCmr("Německo")).toBe("DEUTSCHLAND");
    expect(krajinaCmr("NIEDERLANDE")).toBe("NIEDERLANDE");
    expect(krajinaCmr("")).toBe("");
  });
});
