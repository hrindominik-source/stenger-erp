import mammoth from "mammoth";
import { renderContainerToPdf } from "../textPdf.js";

// Konverzia VYPLNENEHO docx -> PDF, urcena VYSLOVNE len na nahlad/tlac.
// Ulozeny/podpisovany artefakt zostava VZDY .docx so skutocnym vyberatelnym
// textom (docxTemplate.js) alebo, po papierovom podpise, priamo nahraty
// naskenovany subor (SignDocumentForm v PersonalistikaModule.jsx) - v
// oboch pripadoch ide o iny subor nez tento PDF nahlad, nikdy sa
// nenahradzuju. PDF tu NIE JE a nesmie byt povazovany za jediny zdroj
// pravdy ani za archivovany podpisany vystup.
//
// Zamerne VYUZIVA len uz existujucu, schvalenu infrastrukturu: mammoth (uz
// zavislost - doteraz iba na citanie nahranych .docx) previedie docx na
// HTML, a ten sa vykresli cez uz existujuci renderContainerToPdf presne tak
// ako kazdy iny PDF v tejto appke (fotenie realneho prehliadacoveho fontu -
// rieši diakritiku rovnako spolahlivo ako vsade inde). Ziadny novy server,
// ziadny externy/verejny konvertor - cely prevod prebehne v prehliadaci
// pouzivatela, personalny dokument nikdy neopusti klienta.
//
// OVERENE (nie len predpokladane) priamo na vsetkych 3 realnych vzoroch,
// vratane vizualneho porovnania vykresleneho canvasu v prehliadaci:
// - Ziadny z 3 vzorov nepouziva skutocnu DOCX tabulku (mammoth html.includes
//   "<table") je false pre vsetky 3) - vyssie uvedene CSS pre <table>/<td>
//   je teda pripravena poistka pre buduce vzory s tabulkou, nie nieco, co
//   uz teraz nieco opravuje.
// - Podpisove miesta (v realnych vzoroch su to len textove riadky bodiek/
//   podtrzitok, nie skutocne Word-ove podpisove polia) sa prenasaju verne,
//   vratane textu pod nimi (meno zastupcu a pod.).
// - PAGINACIA SA NEZACHOVAVA presne podla povodneho .docx. 01 a 02 vychadzaju
//   na 1 stranu aj tu aj v pôvodnom rozsahu textu. 03_VSTUPNI_SKOLENI_vzor
//   (dlhsi text, ziadny explicitny w:br type="page" v puvodnom document.xml)
//   sa v tomto pipeline vykresluje na 2 strany - presny bod zlomu strany je
//   dany akumulovanou vyskou nasho CSS renderu (Arial 13px/1.5 v 760px
//   sirokom kontajneri), NIE povodnymi Word/LibreOffice fontami a okrajmi,
//   takze presna stranka a riadok, kde PDF stranku rozdeli, sa NEMUSI
//   zhodovat s tym, co by ukazal Word pri tlaci. Kedze povodny dokument
//   nema ziadny manualny zlom stranky, nejde o "zlu" pozíciu zlomu (nic sa
//   nestraca ani neprekryva), len o INU (viac/menej mist na stranu) nez
//   akou by povodny subor vytlacil samotny Word - presne preto tento
//   vystup NIE JE vhodny ako archivovany/podpisovany dokument, len ako
//   pracovny nahlad pred generovanim.
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
