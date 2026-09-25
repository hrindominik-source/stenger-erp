import { describe, it, expect, afterEach } from "vitest";
import { isOnboardingKioskUrl } from "./App.jsx";

// Kiosk detekcia je jediny realny, testovatelny rozhodovaci bod pre
// izolaciu tabletoveho onboarding rezimu (viz komentar pri MiniERPRoot
// v App.jsx) - musi byt spolahliva, kedze na nej stoji cele zabezpecenie
// "kiosk nikdy nezavola useAuth()/nenamontuje autentifikovanu appku".
describe("isOnboardingKioskUrl", () => {
  afterEach(() => {
    delete globalThis.window;
  });

  it("bez window (SSR/test bez DOM) vracia false", () => {
    delete globalThis.window;
    expect(isOnboardingKioskUrl()).toBe(false);
  });

  it("normalna URL bez kiosk parametru vracia false", () => {
    globalThis.window = { location: { search: "" } };
    expect(isOnboardingKioskUrl()).toBe(false);
  });

  it("?kiosk=nastup vracia true", () => {
    globalThis.window = { location: { search: "?kiosk=nastup" } };
    expect(isOnboardingKioskUrl()).toBe(true);
  });

  it("iny/nespravny kiosk parameter vracia false (nesmie sa omylom spustit)", () => {
    globalThis.window = { location: { search: "?kiosk=neco-jineho" } };
    expect(isOnboardingKioskUrl()).toBe(false);
  });

  it("?kiosk=nastup spolu s inymi query parametry stale vracia true", () => {
    globalThis.window = { location: { search: "?foo=bar&kiosk=nastup&baz=1" } };
    expect(isOnboardingKioskUrl()).toBe(true);
  });
});
