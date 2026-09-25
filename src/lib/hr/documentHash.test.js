import { describe, it, expect } from "vitest";
import { sha256Hex, buildSignedScanPath } from "./documentHash.js";

function bytesFrom(str) {
  return new TextEncoder().encode(str).buffer;
}

describe("sha256Hex", () => {
  it("vypocita stabilny, spravny hash pre zname bajty", async () => {
    // SHA-256("hello") - overitelna znama hodnota
    expect(await sha256Hex(bytesFrom("hello"))).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });
  it("identicke bajty davaju identicky hash", async () => {
    const a = await sha256Hex(bytesFrom("podpisany sken - test"));
    const b = await sha256Hex(bytesFrom("podpisany sken - test"));
    expect(a).toBe(b);
  });
  it("aj jediny odlisny bajt zmeni hash (deteguje poskodenie/zamenu suboru)", async () => {
    const original = await sha256Hex(bytesFrom("podpisany sken - test"));
    const corrupted = await sha256Hex(bytesFrom("podpisany sken - Test"));
    expect(original).not.toBe(corrupted);
  });
});

describe("buildSignedScanPath", () => {
  it("zostavi cestu z hr_documents.id, unikatneho suffixu a pripony", () => {
    expect(buildSignedScanPath("doc-123", "abc", "pdf")).toBe("zamestnanci-podpisy/doc-123-abc.pdf");
  });
  it("priponu normalizuje na malé pismena, chybajucu priponu nahradi 'pdf'", () => {
    expect(buildSignedScanPath("doc-123", "abc", "PDF")).toBe("zamestnanci-podpisy/doc-123-abc.pdf");
    expect(buildSignedScanPath("doc-123", "abc", undefined)).toBe("zamestnanci-podpisy/doc-123-abc.pdf");
  });
});

describe("cely tok podpisu (simulovane uloziste) - stiahnutie vracia presne tie iste bajty, ake boli nahrane", () => {
  // Simuluje presne to, co teraz robi SignDocumentForm + DokumentyTab.openDocument:
  // 1) vypocitaj hash PRED uploadom, 2) nahraj bajty na cestu z buildSignedScanPath,
  // 3) uloz TU ISTU cestu aj do "hr_documents.file_path" (fix v tomto commite -
  // predtym sa file_path po podpise vobec neaktualizoval), 4) "stiahni" podla
  // file_path (presne to, co robi openDocument), 5) preveril hash zhodu.
  it("end-to-end: vydany dokument -> nahratie skenu -> potvrdenie -> stiahnutie = identicke bajty", async () => {
    const fakeStorage = new Map(); // path -> ArrayBuffer, simuluje storage.objects + bucket

    // 1) "vydany dokument" - hr_documents riadok pred podpisom
    const hrDocument = { id: "doc-e2e-1", status: "READY_FOR_SIGNATURE", file_path: "zamestnanci/emp-1/doc-e2e-1.docx" };

    // 2) HR nahra naskenovany podpisany subor (simulovane bajty)
    const signedScanBytes = bytesFrom("PDF-BYTES-OF-SIGNED-SCAN-" + Math.random());
    const preUploadHash = await sha256Hex(signedScanBytes);
    const storagePath = buildSignedScanPath(hrDocument.id, "sig-uid-1", "pdf");
    fakeStorage.set(storagePath, signedScanBytes); // upload

    // 3) "ludske potvrdenie" - insert hr_document_signatures + prechod na SIGNED,
    // file_path sa prepisuje na TU ISTU cestu (buildSignedScanPath pouzita raz,
    // zdielana medzi uploadom aj priradenim - nemozu sa rozist).
    const signature = { hr_document_id: hrDocument.id, document_hash: preUploadHash, file_path: storagePath };
    hrDocument.status = "SIGNED";
    hrDocument.file_path = storagePath;

    // 4) "stiahnutie" cez Otevřít soubor (openDocument cita doc.file_path)
    const downloadedBytes = fakeStorage.get(hrDocument.file_path);
    const postDownloadHash = await sha256Hex(downloadedBytes);

    // 5) zhoda
    expect(downloadedBytes).toBe(signedScanBytes);
    expect(postDownloadHash).toBe(preUploadHash);
    expect(postDownloadHash).toBe(signature.document_hash);
  });

  it("REGRESIA: ak by sa file_path po podpise neaktualizoval (povodne spravanie), stiahnutie by vratilo INY subor nez podpisany sken", async () => {
    const fakeStorage = new Map();
    const hrDocument = { id: "doc-e2e-2", status: "READY_FOR_SIGNATURE", file_path: "zamestnanci/emp-2/doc-e2e-2.docx" };
    const originalGeneratedBytes = bytesFrom("PUVODNI-NEPODEPSANY-DOCX");
    fakeStorage.set(hrDocument.file_path, originalGeneratedBytes);

    const signedScanBytes = bytesFrom("PDF-BYTES-OF-SIGNED-SCAN-2");
    const storagePath = buildSignedScanPath(hrDocument.id, "sig-uid-2", "pdf");
    fakeStorage.set(storagePath, signedScanBytes);

    // simulacia POVODNEHO (chybneho) spravania - file_path sa NEPRIRADI
    hrDocument.status = "SIGNED";

    const downloadedBytes = fakeStorage.get(hrDocument.file_path);
    expect(downloadedBytes).toBe(originalGeneratedBytes);
    expect(downloadedBytes).not.toBe(signedScanBytes);
  });
});
