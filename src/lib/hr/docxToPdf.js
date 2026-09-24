import mammoth from "mammoth";
import { renderContainerToPdf } from "../textPdf.js";

// Konverzia VYPLNENEHO docx -> PDF, urcena len na nahlad/tlac. Ulozeny/
// podpisovany artefakt zostava vzdy .docx so skutocnym vyberatelnym textom
// (docxTemplate.js) - PDF tu nie je jediny zdroj pravdy, presne ako pri
// kazdom inom dokumente v tejto appke (viz textPdf.js).
//
// Zamerne VYUZIVA len uz existujucu, schvalenu infrastrukturu: mammoth (uz
// zavislost - doteraz iba na citanie nahranych .docx) previedie docx na
// HTML, a ten sa vykresli cez uz existujuci renderContainerToPdf presne tak
// ako kazdy iny PDF v tejto appke (fotenie realneho prehliadacoveho fontu -
// rieši diakritiku rovnako spolahlivo ako vsade inde). Ziadny novy server,
// ziadny externy/verejny konvertor - cely prevod prebehne v prehliadaci
// pouzivatela, personalny dokument nikdy neopusti klienta.
export async function convertFilledDocxToPdf(filename, docxArrayBuffer) {
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: docxArrayBuffer });

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "0";
  container.style.top = "0";
  container.style.zIndex = "-1000";
  container.style.width = "760px";
  container.style.padding = "0";
  container.style.background = "#ffffff";
  container.style.color = "#000000";
  container.style.fontFamily = "Arial, Helvetica, sans-serif";
  container.style.fontSize = "13px";
  container.style.lineHeight = "1.5";

  // mammoth-ova predvolena HTML konverzia neprenasa ramcekovanie tabuliek
  // ako inline styly - bez tohto by tabulky (napr. vo vzore mzdoveho
  // vymeru) vyzerali v PDF nahlade nerozdelene/bez ciar.
  const style = document.createElement("style");
  style.textContent = `
    table { border-collapse: collapse; width: 100%; margin: 8px 0; }
    td, th { border: 1px solid #333; padding: 4px 6px; text-align: left; }
    p { margin: 0 0 8px 0; }
  `;
  container.appendChild(style);
  const body = document.createElement("div");
  body.innerHTML = html;
  container.appendChild(body);

  document.body.appendChild(container);
  try {
    await renderContainerToPdf(filename, container, 760);
  } finally {
    if (container.parentNode) container.parentNode.removeChild(container);
  }
}
