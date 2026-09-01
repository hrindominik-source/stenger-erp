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
    // container je "position: fixed", takze bez explicitnej vysky by
    // html2canvas orezal zabery na vysku viewportu (okna) namiesto na
    // skutocnu vysku obsahu - posledny riadok tak niekedy vypadol.
    const contentHeight = container.scrollHeight;

    const canvas = await html2canvas(container, {
      scale: 2,
      backgroundColor: "#ffffff",
      windowWidth: 700,
      windowHeight: contentHeight,
      height: contentHeight,
    });

    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const marginX = 15;
    const marginY = 15;
    const pageWidth = doc.internal.pageSize.getWidth() - marginX * 2;
    const pageHeight = doc.internal.pageSize.getHeight() - marginY * 2;

    const imgWidth = pageWidth;
    const pxToMm = imgWidth / canvas.width;
    const pageHeightPx = pageHeight / pxToMm;

    let renderedPx = 0;
    let firstPage = true;
    while (renderedPx < canvas.height) {
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

      if (!firstPage) doc.addPage();
      doc.addImage(
        sliceCanvas.toDataURL("image/png"),
        "PNG",
        marginX,
        marginY,
        imgWidth,
        sliceHeightPx * pxToMm
      );

      renderedPx += sliceHeightPx;
      firstPage = false;
    }

    doc.save(filename);
  } finally {
    if (container.parentNode) container.parentNode.removeChild(container);
  }
}
