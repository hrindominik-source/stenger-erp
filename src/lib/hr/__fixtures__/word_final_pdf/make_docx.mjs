// Generator testovacieho .docx (VYMYSLENE udaje) pre test "PDF ulozene z Wordu".
// Vystup: zmluva.docx, zmluva_ina_mzda.docx, zmluva_ine_meno.docx.
// PDF z nich vyrobi skutocny Word (export_pdf.ps1) - zarovnany text do bloku,
// automaticke delenie slov, nedelitelne medzery v cislach a datumoch.
// Spustenie: node make_docx.mjs <vystupny_priecinok>
import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";

export const SNAPSHOT = {
  jmeno: "Jana Nováková-Testová",
  datum_narozeni: "7. 3. 1991",
  adresa: "Krátká 12, 261 01 Příbram",
  datum_nastupu: "1. 11. 2026",
  pozice: "dělnice výroby",
  mzda: "32 500 Kč",
  prispevek: "1 250 Kč",
  zastupce: "JUDr. Testovací Zástupce",
  zkusebni_doba: "3 měsíce",
  nepouzite: "Tato hodnota v dokumentu není",
};

const NBSP = " ";
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const p = (text, { bold = false, center = false } = {}) =>
  `<w:p><w:pPr><w:jc w:val="${center ? "center" : "both"}"/></w:pPr><w:r><w:rPr>${bold ? "<w:b/>" : ""}<w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;

function body(v) {
  const n = (s) => s.replace(/ (?=\d)|(?<=\d) (?=\d)/g, NBSP); // Word: NBSP v cislach/datumoch
  return [
    p("PRACOVNÍ SMLOUVA", { bold: true, center: true }),
    p(`Zaměstnankyně: ${v.jmeno}, narozená ${n(v.datum_narozeni)}, bytem ${n(v.adresa)}.`),
    p(`Zaměstnankyně nastoupí do práce dne ${n(v.datum_nastupu)} na pozici „${v.pozice}“ s místem výkonu práce v provozovně zaměstnavatele. ` +
      "Zaměstnankyně se zavazuje vykonávat práci osobně podle pokynů zaměstnavatele, dodržovat hygienické předpisy, předpisy bezpečnosti a ochrany zdraví při práci a vnitřní předpisy zaměstnavatele, se kterými byla prokazatelně seznámena."),
    p(`Mzda činí ${n(v.mzda)} měsíčně a příspěvek na stravování ${n(v.prispevek)} měsíčně – podrobnosti stanoví mzdový výměr, který je nedílnou součástí této smlouvy. ` +
      `Zkušební doba se sjednává na ${n(v.zkusebni_doba)} ode dne vzniku pracovního poměru; ostatní práva a povinnosti se řídí zákoníkem práce.`),
    p(`Za zaměstnavatele: ${v.zastupce}, na základě plné moci`),
  ].join("");
}

function docx(v) {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>`);
  zip.file("word/settings.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:autoHyphenation/><w:defaultTabStop w:val="708"/><w:lang w:val="cs-CZ"/></w:settings>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body(v)}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="2600" w:bottom="1417" w:left="2600"/></w:sectPr></w:body></w:document>`);
  return zip.generate({ type: "nodebuffer" });
}

if (process.argv[2]) {
  const out = process.argv[2];
  fs.writeFileSync(path.join(out, "zmluva.docx"), docx(SNAPSHOT));
  fs.writeFileSync(path.join(out, "zmluva_ina_mzda.docx"), docx({ ...SNAPSHOT, mzda: "23 500 Kč" }));
  fs.writeFileSync(path.join(out, "zmluva_ine_meno.docx"), docx({ ...SNAPSHOT, jmeno: "Jana Novotná-Testová" }));
  console.log("ok");
}
