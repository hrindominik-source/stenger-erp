import { describe, it, expect } from "vitest";
import { buildEmlDraft, emailyPreOutlook, rozdelEmaily } from "./emlDraft.js";

describe("adresy", () => {
  it("pre Outlook oddelene bodkociarkou", () => {
    expect(emailyPreOutlook("a@x.test, b@y.test")).toBe("a@x.test;b@y.test");
    expect(emailyPreOutlook(" a@x.test;b@y.test ,c@z.test\n")).toBe("a@x.test;b@y.test;c@z.test");
    expect(emailyPreOutlook("")).toBe("");
  });
  it("koncept .eml ma adresy podla normy (ciarka)", () => {
    expect(rozdelEmaily("a@x.test; b@y.test")).toEqual(["a@x.test", "b@y.test"]);
    expect(buildEmlDraft({ to: "a@x.test; b@y.test" }, "H")).toContain("To: a@x.test, b@y.test\r\n");
  });
});

const dekoduj = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\r\n/g, "")), (c) => c.charCodeAt(0)));

describe("buildEmlDraft", () => {
  const pdf = new TextEncoder().encode("%PDF-1.4 test");
  const eml = buildEmlDraft({
    to: "kolega@example.test",
    subject: "Lieferschein / Dodací list č. 1/2 - MĚSTO",
    body: "Hello,\n\nplease find attached.",
    attachments: [{ filename: "Lieferschein_1-2_MESTO.pdf", contentType: "application/pdf", bytes: pdf }],
  }, "HRANICA");

  it("je koncept (Outlook ho otvori ako novu spravu)", () => {
    expect(eml).toMatch(/^MIME-Version: 1\.0\r\nX-Unsent: 1\r\n/);
    expect(eml).toContain("To: kolega@example.test\r\n");
  });

  it("predmet s diakritikou je kodovany a da sa precitat spat", () => {
    const m = eml.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/);
    expect(dekoduj(m[1])).toBe("Lieferschein / Dodací list č. 1/2 - MĚSTO");
  });

  it("obsahuje text aj PDF prilohu", () => {
    const casti = eml.split("--HRANICA");
    expect(casti.length).toBe(4); // hlavicka, text, priloha, koniec
    expect(dekoduj(casti[1].split("\r\n\r\n")[1].trim())).toBe("Hello,\r\n\r\nplease find attached.");
    expect(casti[2]).toContain('Content-Disposition: attachment; filename="Lieferschein_1-2_MESTO.pdf"');
    expect(dekoduj(casti[2].split("\r\n\r\n")[1].trim())).toBe("%PDF-1.4 test");
    expect(eml.trimEnd().endsWith("--HRANICA--")).toBe(true);
  });

  it("adresa s novym riadkom nevlozi hlavicku navyse", () => {
    const zly = buildEmlDraft({ to: "a@b.test\r\nBcc: x@y.test", subject: "s", body: "" }, "H");
    expect(zly).not.toMatch(/\r\nBcc:/);
  });
});
