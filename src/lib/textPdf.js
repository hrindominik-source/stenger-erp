import { jsPDF } from "jspdf";

// Jednoduchy plain-text PDF (predmet + telo spravy) - pouziva sa tam, kde
// chce office mat zaznam/prilohu presne toho, co sa poslalo (alebo posle)
// e-mailom, bez nutnosti otvarat tlacovy dialog prehliadaca.
export function downloadTextAsPdf(filename, subject, body) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const marginX = 15;
  const maxWidth = 180;
  const lineHeight = 5.5;
  const pageBottom = 285;
  let y = 20;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  for (const line of doc.splitTextToSize(subject || "", maxWidth)) {
    doc.text(line, marginX, y);
    y += lineHeight + 1;
  }

  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const bodyLines = (body || "").split("\n").flatMap((l) => doc.splitTextToSize(l, maxWidth));
  for (const line of bodyLines) {
    if (y > pageBottom) {
      doc.addPage();
      y = 20;
    }
    doc.text(line, marginX, y);
    y += lineHeight;
  }

  doc.save(filename);
}
