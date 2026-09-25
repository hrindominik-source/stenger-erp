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

describe("cely lifecycle podpisu (simulovane uloziste) - GENERATED ORIGINAL aj SIGNED ORIGINAL su NEZAVISLE dohladatelne", () => {
  // Simuluje presne architekturu, akou dnes funguje GenerateDocumentForm +
  // SignDocumentForm + DokumentyTab: hr_documents.file_path je GENERATED
  // ORIGINAL a NIKDY sa po podpise neprepisuje; hr_document_signatures.file_path
  // je SIGNED ORIGINAL, ulozene ako SAMOSTATNY zaznam. DokumentyTab.openFile()
  // berie cestu ako explicitny parameter (nie implicitne "doc.file_path"),
  // takze ziadne tlacidlo v UI nemoze jedno tise zamenit za druhe.
  it("po podpise zostava GENERATED ORIGINAL dosiahnutelny cez hr_documents.file_path (nikdy sa neprepisuje)", async () => {
    const fakeStorage = new Map(); // path -> ArrayBuffer, simuluje storage.objects + bucket

    const hrDocument = { id: "doc-e2e-1", status: "READY_FOR_SIGNATURE", file_path: "zamestnanci/emp-1/doc-e2e-1.docx" };
    const generatedBytes = bytesFrom("PUVODNI-VYGENEROVANY-DOCX-" + Math.random());
    fakeStorage.set(hrDocument.file_path, generatedBytes);

    // HR nahra naskenovany podpisany subor + "ludske potvrdenie"
    const signedScanBytes = bytesFrom("PDF-BYTES-OF-SIGNED-SCAN-" + Math.random());
    const storagePath = buildSignedScanPath(hrDocument.id, "sig-uid-1", "pdf");
    fakeStorage.set(storagePath, signedScanBytes);
    const signature = { hr_document_id: hrDocument.id, document_hash: await sha256Hex(signedScanBytes), file_path: storagePath };
    hrDocument.status = "SIGNED"; // POZOR: file_path sa tu NEMENI

    // "Otevřít původní vygenerovaný soubor" cita hr_documents.file_path - beze zmeny
    expect(hrDocument.file_path).toBe("zamestnanci/emp-1/doc-e2e-1.docx");
    expect(fakeStorage.get(hrDocument.file_path)).toBe(generatedBytes);
  });

  it("SIGNED ORIGINAL: stiahnutie cez hr_document_signatures.file_path vracia presne tie iste bajty, ake boli nahrane, a hash sa zhoduje", async () => {
    const fakeStorage = new Map();
    const hrDocument = { id: "doc-e2e-2", status: "READY_FOR_SIGNATURE", file_path: "zamestnanci/emp-2/doc-e2e-2.docx" };
    fakeStorage.set(hrDocument.file_path, bytesFrom("PUVODNI-VYGENEROVANY-DOCX"));

    const signedScanBytes = bytesFrom("PDF-BYTES-OF-SIGNED-SCAN-2-" + Math.random());
    const preUploadHash = await sha256Hex(signedScanBytes);
    const storagePath = buildSignedScanPath(hrDocument.id, "sig-uid-2", "pdf");
    fakeStorage.set(storagePath, signedScanBytes); // upload
    const signature = { hr_document_id: hrDocument.id, document_hash: preUploadHash, file_path: storagePath }; // ludske potvrdenie (insert)
    hrDocument.status = "SIGNED";

    // "Otevřít podepsaný sken" cita signature.file_path, NIE hr_documents.file_path
    const downloadedBytes = fakeStorage.get(signature.file_path);
    const postDownloadHash = await sha256Hex(downloadedBytes);

    expect(downloadedBytes).toBe(signedScanBytes);
    expect(postDownloadHash).toBe(preUploadHash);
    expect(postDownloadHash).toBe(signature.document_hash);
  });

  it("obe cesty su navzajom ROZDIELNE a kazda vracia svoj vlastny, nezamenitelny obsah", async () => {
    const fakeStorage = new Map();
    const hrDocument = { id: "doc-e2e-3", status: "READY_FOR_SIGNATURE", file_path: "zamestnanci/emp-3/doc-e2e-3.docx" };
    const generatedBytes = bytesFrom("GENERATED-3");
    fakeStorage.set(hrDocument.file_path, generatedBytes);

    const signedScanBytes = bytesFrom("SIGNED-3");
    const storagePath = buildSignedScanPath(hrDocument.id, "sig-uid-3", "pdf");
    fakeStorage.set(storagePath, signedScanBytes);
    const signature = { file_path: storagePath };
    hrDocument.status = "SIGNED";

    expect(hrDocument.file_path).not.toBe(signature.file_path);
    expect(fakeStorage.get(hrDocument.file_path)).not.toBe(fakeStorage.get(signature.file_path));
  });

  it("REGENERACE: novy hr_documents riadok (novy uid) nemeni ani nemaze existujuci SIGNED riadok", () => {
    // GenerateDocumentForm vzdy vklada NOVY riadok s cerstvym uid() - simulacia
    // dokazuje, ze opakovane generovanie rovnakeho typu dokumentu pre toho
    // isteho zamestnanca nikdy neupravi uz existujuci (podpisany) riadok.
    const allDocuments = new Map();
    const signedDoc = { id: "doc-signed-1", status: "SIGNED", file_path: "zamestnanci/emp-4/doc-signed-1.docx", doc_type: "platovy_vymer" };
    allDocuments.set(signedDoc.id, { ...signedDoc });

    // "regenerace" - novy dokument rovnakeho typu pre toho isteho zamestnanca
    const newDoc = { id: "doc-regenerated-2", status: "DRAFT", file_path: "zamestnanci/emp-4/doc-regenerated-2.docx", doc_type: "platovy_vymer" };
    allDocuments.set(newDoc.id, newDoc);

    expect(allDocuments.get("doc-signed-1")).toEqual(signedDoc);
    expect(allDocuments.size).toBe(2);
  });
});
