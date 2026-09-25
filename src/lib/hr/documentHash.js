// SHA-256 hash pouzity pri ukladani podpisu (hr_document_signatures.document_hash)
// - hash sa pocita z bajtov naskenovaneho suboru PRED uploadom a uklada sa
// spolu s cestou k tomu istemu suboru. Kedze storage.objects nema ziadnu
// UPDATE/DELETE policy (WORM, overene prakticky v predchadzajucej sprave),
// bajty na tejto ceste sa uz nemozu zmenit - ulozeny hash preto zostava
// navzdy platnym dokazom, ze neskorsie stiahnutie (rovnaka cesta) vrati
// presne tie iste bajty, ake boli nahrane pri podpise.
export async function sha256Hex(arrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", arrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// JEDNA funkcia pouzita na oboch miestach, ktore musia ukazovat na TEN ISTY
// objekt v uloziskue: cesta, kam sa naskenovany podpisany subor nahra
// (storage.objects), aj cesta ulozena do hr_documents.file_path pri
// prechode na SIGNED. Predtym boli tieto dve miesta oddelene (storagePath
// vytvoreny raz pre upload, hr_documents.file_path sa vobec neaktualizoval)
// a "Otevřít soubor" tak po podpise otvaral stary nepodpisany vygenerovany
// dokument namiesto podpisaneho skenu - podpisany sken nebol z UI vobec
// dosiahnutelny. Zdielana funkcia to strukturalne vylucuje.
export function buildSignedScanPath(hrDocumentId, uniqueSuffix, fileExtension) {
  const ext = (fileExtension || "pdf").toLowerCase();
  return `zamestnanci-podpisy/${hrDocumentId}-${uniqueSuffix}.${ext}`;
}
