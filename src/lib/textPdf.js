import { jsPDF } from "jspdf";

// Jednoduchy plain-text PDF (predmet + telo spravy) - pouziva sa tam, kde
// chce office mat zaznam/prilohu presne toho, co sa poslalo (alebo posle)
// e-mailom, bez nutnosti otvarat tlacovy dialog prehliadaca.
//
// jsPDF-ov vstavany font (Helvetica) nevie zobrazit ceske/slovenske znaky
// (č, ř, ě, ň, ů, ...) - jednoducho ich vynecha alebo nahradi inym znakom.
// Riesenim je nechat text vykreslit priamo prehliadac (skutocny font
// nainstalovany v systeme pouzivatela, nie font vsity do PDF-ka) do canvasu
// cez jsPDF.html()/html2canvas, a az vysledny obrazok vlozit do PDF - text
// tak vyzera presne tak, ako v prehliadaci, bez ohladu na diakritiku.
export function downloadTextAsPdf(filename, subject, body) {
  return new Promise((resolve, reject) => {
    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.left = "-10000px";
    container.style.top = "0";
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
    bodyEl.textContent = body || "";

    container.appendChild(subjectEl);
    container.appendChild(bodyEl);
    document.body.appendChild(container);

    const cleanup = () => {
      if (container.parentNode) container.parentNode.removeChild(container);
    };

    const doc = new jsPDF({ unit: "mm", format: "a4" });
    doc
      .html(container, {
        x: 15,
        y: 15,
        width: 180,
        windowWidth: 700,
        autoPaging: "text",
        html2canvas: { scale: 2, backgroundColor: "#ffffff" },
      })
      .then(() => {
        cleanup();
        doc.save(filename);
        resolve();
      })
      .catch((err) => {
        cleanup();
        reject(err);
      });
  });
}
