import { describe, it, expect } from "vitest";
import { exportFilePaths } from "./gdprExport.js";

describe("exportFilePaths", () => {
  it("dokumenty a prilohy bez duplicit", () => {
    const data = {
      documents: [{ file_path: "a.docx", final_pdf_path: "a.pdf", signed_pdf_path: null }, { final_pdf_path: "a.pdf" }],
      payroll: { data: { prilohy: [{ path: "p1.pdf" }, { name: "bez cesty" }], prilohy_ukonceni: [{ path: "u.pdf" }], mzda_historie: [{ path: "x" }] } },
    };
    expect(exportFilePaths(data)).toEqual(["a.docx", "a.pdf", "p1.pdf", "u.pdf"]);
  });
  it("prazdny export", () => {
    expect(exportFilePaths({ documents: [], payroll: null })).toEqual([]);
    expect(exportFilePaths(null)).toEqual([]);
  });
});
