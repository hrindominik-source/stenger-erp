import { describe, it, expect, afterEach } from "vitest";
import { isPdaUrl, isPdaTestUrl, isOnboardingKioskUrl } from "./App.jsx";

// ?pda=1 otvara zjednodusene PDA rozhranie (Zebra TC25) namiesto launchera.
// Funguje aj na GitHub Pages pod /stenger-erp/ - je to query parameter na
// index.html, nie SPA cesta, takze netreba 404 presmerovanie.
describe("isPdaUrl", () => {
  afterEach(() => {
    delete globalThis.window;
  });

  it("bez window vracia false", () => {
    delete globalThis.window;
    expect(isPdaUrl()).toBe(false);
  });

  it("normalna URL vracia false", () => {
    globalThis.window = { location: { search: "" } };
    expect(isPdaUrl()).toBe(false);
  });

  it("?pda=1 vracia true", () => {
    globalThis.window = { location: { search: "?pda=1" } };
    expect(isPdaUrl()).toBe(true);
  });

  it("?pda=1 s inymi parametrami vracia true", () => {
    globalThis.window = { location: { search: "?x=y&pda=1" } };
    expect(isPdaUrl()).toBe(true);
  });

  it("ina hodnota vracia false", () => {
    globalThis.window = { location: { search: "?pda=0" } };
    expect(isPdaUrl()).toBe(false);
    globalThis.window = { location: { search: "?pda" } };
    expect(isPdaUrl()).toBe(false);
  });

  it("PDA URL nespusti onboarding kiosk", () => {
    globalThis.window = { location: { search: "?pda=1" } };
    expect(isOnboardingKioskUrl()).toBe(false);
  });

  it("?pda=test je testovaci rezim, nie ostre PDA", () => {
    globalThis.window = { location: { search: "?pda=test" } };
    expect(isPdaTestUrl()).toBe(true);
    expect(isPdaUrl()).toBe(false);
    globalThis.window = { location: { search: "?pda=1" } };
    expect(isPdaTestUrl()).toBe(false);
  });
});
