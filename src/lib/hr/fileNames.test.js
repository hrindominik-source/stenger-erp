import { describe, it, expect } from "vitest";
import { hrFileName, cleanDocLabel, fileExt } from "./fileNames.js";

const emp = { first_name: "Jana", last_name: "Nováková" };

describe("názvy HR dokumentů", () => {
  it("Název – Příjmení Jméno – datum.ext", () => {
    expect(hrFileName("Pracovní smlouva", emp, "2026-10-22T08:15:00Z", "docx")).toBe("Pracovní smlouva – Nováková Jana – 22.10.2026.docx");
    expect(hrFileName("Pracovní smlouva – cizinec", emp, "2026-10-22")).toBe("Pracovní smlouva – cizinec – Nováková Jana – 22.10.2026");
  });
  it("popisky z karty bez (PDF / sken), bez zakázaných znaků", () => {
    expect(cleanDocLabel("Rodný list (PDF / sken)")).toBe("Rodný list");
    expect(cleanDocLabel("Doklady cizince (sken pasu, rozhodnutí cizinecké policie apod.)")).toBe("Doklady cizince");
    expect(cleanDocLabel("Dokument prokazující nárok – PDF / sken")).toBe("Dokument prokazující nárok");
    expect(hrFileName("Evidence pojistného vztahu – potvrzení ČSSZ o přidělení OIČ / ID PPV (PDF)", emp, "2026-10-22", "pdf"))
      .toBe("Evidence pojistného vztahu – potvrzení ČSSZ o přidělení OIČ - ID PPV – Nováková Jana – 22.10.2026.pdf");
  });
  it("přípona z cesty, chybějící údaje", () => {
    expect(fileExt("zamestnanci/x/prilohy/abc.PDF")).toBe("pdf");
    expect(fileExt("bez-pripony")).toBe("");
    expect(hrFileName("", null, null, "pdf")).toBe("Dokument.pdf");
  });
});
