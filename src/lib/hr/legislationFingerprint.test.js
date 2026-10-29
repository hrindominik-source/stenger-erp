import { describe, it, expect } from "vitest";
import { fingerprint, normalizeForFingerprint } from "../../../supabase/functions/_shared/hr/legislationFingerprint.js";

describe("odtlacok zdroja legislativy", () => {
  it("JSON: poradie klucov nemeni odtlacok, zmena hodnoty ano", async () => {
    const a = await fingerprint('{"novely": ["1/2026"], "znenie": "2026-01-01"}', "application/json");
    const b = await fingerprint('{"znenie": "2026-01-01", "novely": ["1/2026"]}', "application/json; charset=utf-8");
    const c = await fingerprint('{"znenie": "2026-07-01", "novely": ["1/2026", "2/2026"]}', "application/json");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it("neplatny JSON a text sa porovnava ako text", () => {
    expect(normalizeForFingerprint("{zle", "application/json")).toBe("{zle");
    expect(normalizeForFingerprint("<html>", "text/html")).toBe("<html>");
  });
});
