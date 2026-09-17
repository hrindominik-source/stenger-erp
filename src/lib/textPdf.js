import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

// Jednoduchy plain-text PDF (predmet + telo spravy) - pouziva sa tam, kde
// chce office mat zaznam/prilohu presne toho, co sa poslalo (alebo posle)
// e-mailom, bez nutnosti otvarat tlacovy dialog prehliadaca.
//
// jsPDF-ov vstavany font (Helvetica) nevie zobrazit ceske/slovenske znaky
// (č, ř, ě, ň, ů, ...) - jednoducho ich vynecha alebo nahradi inym znakom.
// Riesenim je nechat text vykreslit priamo prehliadac (skutocny font
// nainstalovany v systeme pouzivatela) do canvasu cez html2canvas, a az
// vysledny obrazok (bitmapa, ziadny font/kodovanie) vlozit do PDF.
//
// Zamerne sa NEPOUZIVA jsPDF.html() s autoPaging:"text" - ten popri
// obrazku zapisuje aj vlastnu textovu vrstvu (kvoli vyberatelnosti textu)
// cez svoj vstavany font, cim sa diakritika znova rozbije a stranky sa
// zle rezu. Stranky sa preto rezu rucne, priamo z hotoveho obrazku.
export async function downloadTextAsPdf(filename, subject, body) {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "0";
  container.style.top = "0";
  container.style.zIndex = "-1000";
  container.style.width = "700px";
  container.style.padding = "0";
  container.style.background = "#ffffff";
  container.style.color = "#000000";
  container.style.fontFamily = "Arial, Helvetica, sans-serif";

  const subjectEl = document.createElement("div");
  subjectEl.style.fontWeight = "bold";
  subjectEl.style.fontSize = "16px";
  subjectEl.style.marginBottom = "14px";
  subjectEl.textContent = subject || "";

  const bodyEl = document.createElement("div");
  bodyEl.style.fontSize = "13px";
  bodyEl.style.lineHeight = "1.5";
  bodyEl.style.whiteSpace = "pre-wrap";
  bodyEl.style.wordBreak = "break-word";
  // Bez tejto rezervy koncilo posledne riadky presne na hranici vysky
  // containeru a html2canvas ho pri zaokruhlovani obcas orezal.
  bodyEl.style.paddingBottom = "20px";
  bodyEl.textContent = body || "";

  container.appendChild(subjectEl);
  container.appendChild(bodyEl);
  document.body.appendChild(container);
  try {
    await renderContainerToPdf(filename, container, 700);
  } finally {
    if (container.parentNode) container.parentNode.removeChild(container);
  }
}

// Odfoti lubovolny (male, staticke) HTML do PNG data URL - pouziva sa na
// hlavicky/paty dokumentov s diakritikou (jsPDF-ov vstavany font ju
// nezvlada, viz vyssie), ktore sa oproti telu dokumentu opakuju nezmenene
// na kazdej stranke, tak sa vyplati odfotit len raz a vlozit ako obrazok.
export async function renderHtmlBlockToImage(html, widthPx) {
  const div = document.createElement("div");
  div.style.position = "fixed";
  div.style.left = "0";
  div.style.top = "0";
  div.style.zIndex = "-1000";
  div.style.width = widthPx + "px";
  div.style.background = "#ffffff";
  div.style.color = "#111111";
  div.style.fontFamily = "Arial, Helvetica, sans-serif";
  div.innerHTML = html;
  document.body.appendChild(div);
  try {
    const h = div.scrollHeight;
    const canvas = await html2canvas(div, { scale: 2, backgroundColor: "#ffffff", windowWidth: widthPx, windowHeight: h, height: h });
    return { dataUrl: canvas.toDataURL("image/png"), widthPx: canvas.width, heightPx: canvas.height };
  } finally {
    if (div.parentNode) div.parentNode.removeChild(div);
  }
}

// Zdielany renderer offscreen DOM containeru (ktory si zavolajuci uz sam
// pripojil do document.body) do viacstranoveho PDF - pouziva ho aj
// downloadTextAsPdf vyssie, aj napr. export checklistu z Kvality (tabulka s
// hlavickou firmy). Container ostava caller-ovou zodpovednostou (vytvorenie
// aj odstranenie), tato funkcia ho len odfoti a narezie na stranky A4.
//
// onHeader/onFooter (voliltelne) sa zavolaju natívne cez jsPDF (vektorovy
// text, nie obrazok) na KAZDEJ stranke pred/po vlozeni orezaneho obrazka -
// takto vie dokument niest opakujucu sa hlavicku/patu ako skutocny tlaceny
// dokument (napr. GF-001 sablona), bez toho aby sa musela hlavicka
// zdvojene fotit spolu s obsahom pri kazdom rezani strany.
export async function renderContainerToPdf(filename, container, windowWidth, opts = {}) {
  const { marginTop = 15, marginBottom = 15, onHeader, onFooter } = opts;
  // container je "position: fixed", takze bez explicitnej vysky by
  // html2canvas orezal zabery na vysku viewportu (okna) namiesto na
  // skutocnu vysku obsahu - posledny riadok tak niekedy vypadol.
  const contentHeight = container.scrollHeight;

  const canvas = await html2canvas(container, {
    scale: 2,
    backgroundColor: "#ffffff",
    windowWidth: windowWidth || container.offsetWidth,
    windowHeight: contentHeight,
    height: contentHeight,
  });

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const marginX = 15;
  const pageWidth = doc.internal.pageSize.getWidth() - marginX * 2;
  const pageHeight = doc.internal.pageSize.getHeight() - marginTop - marginBottom;

  const imgWidth = pageWidth;
  const pxToMm = imgWidth / canvas.width;
  const pageHeightPx = pageHeight / pxToMm;
  const pageCount = Math.max(1, Math.ceil(canvas.height / pageHeightPx));

  let renderedPx = 0;
  let pageIndex = 0;
  while (renderedPx < canvas.height) {
    pageIndex += 1;
    const sliceHeightPx = Math.min(pageHeightPx, canvas.height - renderedPx);

    const sliceCanvas = document.createElement("canvas");
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = sliceHeightPx;
    sliceCanvas
      .getContext("2d")
      .drawImage(
        canvas,
        0,
        renderedPx,
        canvas.width,
        sliceHeightPx,
        0,
        0,
        canvas.width,
        sliceHeightPx
      );

    if (pageIndex > 1) doc.addPage();
    if (onHeader) onHeader(doc, pageIndex, pageCount);
    doc.addImage(
      sliceCanvas.toDataURL("image/png"),
      "PNG",
      marginX,
      marginTop,
      imgWidth,
      sliceHeightPx * pxToMm
    );
    if (onFooter) onFooter(doc, pageIndex, pageCount);

    renderedPx += sliceHeightPx;
  }

  doc.save(filename);
}
