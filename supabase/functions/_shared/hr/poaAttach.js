// Kopia plnej moci ako priloha dokumentu (migracia 81). Kto podpisuje za
// zamestnavatela na zaklade plnej moci, ma k dokumentu pripojit jej kopiu -
// pre zamestnanca zaciernenu (bez datumu narodenia a bydliska zmocnencov).
// Pripaja sa ako posledne strany FINALNEHO PDF, takze ju pokryje hash aj podpis
// (papier aj elektronicky postup). Zdielane: server (hr-finalize-pdf) + testy.
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { normalizeName, signatoryValidOn } from "./tabletSigning.js";

// Osoba s plnou mocou uvedena v dokumente (variables_snapshot.zastupce),
// platna k datumu a s nahratou kopiou pre zamestnancov; inak null.
export function poaSignatoryFor(signatories, snapshot, isoDate) {
  const named = normalizeName(snapshot?.zastupce);
  if (!named) return null;
  return (signatories || [])
    .filter((s) => normalizeName(s.full_name) === named && signatoryValidOn(s, isoDate) && s.poa_copy_path)
    .sort((a, b) => String(b.valid_from).localeCompare(String(a.valid_from)))[0] || null;
}

export const poaHeader = (signatory) => `Příloha: kopie plné moci – ${signatory.full_name}`;

// finalBytes + kopia (PDF alebo PNG/JPG) -> nove PDF; na kazdej pripojenej
// strane hore oznacenie prilohy.
export async function appendPoaCopy(finalBytes, copyBytes, copyMime, { fontBytes, header }) {
  const out = await PDFDocument.load(finalBytes);
  out.registerFontkit(fontkit);
  const font = await out.embedFont(fontBytes, { subset: true });
  const added = [];
  if (copyMime === "application/pdf") {
    const src = await PDFDocument.load(copyBytes);
    for (const p of await out.copyPages(src, src.getPageIndices())) added.push(out.addPage(p));
  } else {
    const img = copyMime === "image/png" ? await out.embedPng(copyBytes) : await out.embedJpg(copyBytes);
    const page = out.addPage([595.28, 841.89]);
    const scale = Math.min((595.28 - 40) / img.width, (841.89 - 60) / img.height);
    const w = img.width * scale, h = img.height * scale;
    page.drawImage(img, { x: (595.28 - w) / 2, y: (841.89 - 40 - h) / 2, width: w, height: h });
    added.push(page);
  }
  for (const page of added) {
    const { width, height } = page.getSize();
    const size = 9;
    const tw = font.widthOfTextAtSize(header, size);
    page.drawRectangle({ x: 24, y: height - 26, width: tw + 12, height: 16, color: rgb(1, 1, 1) });
    page.drawText(header, { x: 30, y: height - 21, size, font, color: rgb(0.2, 0.2, 0.2) });
    if (width < 100) throw new Error("Neplatna strana plne moci.");
  }
  return { bytes: await out.save(), pagesAdded: added.length };
}
