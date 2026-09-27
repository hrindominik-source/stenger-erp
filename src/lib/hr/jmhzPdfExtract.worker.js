// Web Worker obal okolo extractJmhzFields (jmhzPdf.js). Dovod existencie:
// pdf-lib pri niektorych realne vyplnenych PDF (konkretne subory z Adobe
// nastroju "Vyplnit a podepsat") v prehliadaci niekedy zabehne do extremne
// dlheho/blokujeheho synchronneho spracovania - AJ KED ten isty subor v
// Node.js precita okamzite. Kedze ide o SYNCHRONNE blokovanie hlavneho
// vlakna, obycajny `Promise.race` s `setTimeout` v hlavnom vlakne NEPOMOZE
// (setTimeout callback sa nemoze spustit, kym hlavne vlakno bezi) - jedina
// spolahliva ochrana je spustit spracovanie v samostatnom Worker vlakne,
// ktore sa da v pripade prekrocenia casoveho limitu naozaj `terminate()`-ovat
// bez zamrznutia zvysku appky.
import { extractJmhzFields } from "./jmhzPdf.js";

self.onmessage = async (e) => {
  const { fileBuffer, version } = e.data;
  try {
    const result = await extractJmhzFields(fileBuffer, version);
    self.postMessage({ ok: true, result });
  } catch (err) {
    self.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
  }
};
