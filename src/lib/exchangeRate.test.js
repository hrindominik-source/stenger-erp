import { describe, it, expect, vi, afterEach } from "vitest";
import { getCnbRate } from "./exchangeRate.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getCnbRate", () => {
  it("vrati kurz 1 pre CZK bez volania siete", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await getCnbRate("07.08.2026", "CZK", "https://x.supabase.co", "anon");
    expect(result).toEqual({ rate: 1, currencyCode: "CZK", validFor: "07.08.2026" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("zavola edge function so spravnym ISO datumom a menou", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rate: 24.21, currencyCode: "EUR", validFor: "2026-08-06" }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const result = await getCnbRate("6.8.2026", "eur", "https://x.supabase.co", "anon-key");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/functions/v1/cnb-rate?date=2026-08-06&currency=EUR",
      { headers: { Authorization: "Bearer anon-key", apikey: "anon-key" } }
    );
    expect(result.rate).toBe(24.21);
  });

  it("vyhodi chybu ked edge function vrati chybovu odpoved", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Mena XYZ sa nenasla." }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    await expect(getCnbRate("07.08.2026", "XYZ", "https://x.supabase.co", "anon")).rejects.toThrow("Mena XYZ sa nenasla.");
  });

  it("vyhodi chybu pri neplatnom datume", async () => {
    await expect(getCnbRate("nieco", "EUR", "https://x.supabase.co", "anon")).rejects.toThrow();
  });
});
