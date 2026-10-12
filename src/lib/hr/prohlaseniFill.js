// Prohlaseni poplatnika dane z prijmu (MFin 5457) - vyplnenie oficialneho
// tiskopisu z Financni spravy udajmi z karty zamestnanca. Tiskopis NEMA
// formularove polia (je to len tlacova predloha), preto sa text dopisuje na
// suradnice overene vykreslenim vzoru. Pri novom vzore (MF ho vydava podla
// potreby, nie kazdy rok) treba nahrat novy PDF a skontrolovat suradnice.
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { formatStreetLine, CZ } from "./employeeFields.js";
import { childrenForDeclaration, extractBirthNumber, formatBirthNumber, splitName, fmtCz } from "./taxChildren.js";
export { childTaxWarnings, birthDateFrom, ageOn, childrenForDeclaration } from "./taxChildren.js";

const BASE = import.meta.env?.BASE_URL ?? "/";
export const PROHLASENI_TEMPLATE = { url: `${BASE}hr/MFin5457_vzor27.pdf`, vzor: 27, platnyOd: 2026 };

// ---------------------------------------------------------------------------
// Vyplnenie tiskopisu
// ---------------------------------------------------------------------------

export const PLATCE = { nazev: "Stenger Czech s.r.o.", adresa: "Plynárenská 366, 261 01 Příbram" };

export function buildDeclarationData(v, year) {
  const isNonResident = !!v.stat_rezidence && v.stat_rezidence !== CZ;
  const street = formatStreetLine(v.perm_ulice, v.perm_cp, v.perm_co) || (v.perm_cp ? `${v.perm_obec} ${v.perm_cp}` : "");
  const adresa = [street, v.perm_obec, v.perm_psc, v.perm_stat && v.perm_stat !== CZ ? v.perm_stat : ""].filter(Boolean).join(", ");
  const birth = v.date_of_birth ? fmtCz(v.date_of_birth) : "";
  const jo = splitName(v.jina_osoba_jmeno);
  return {
    rok: String(year),
    platceNazev: PLATCE.nazev,
    platceAdresa: PLATCE.adresa,
    prijmeni: v.last_name || "",
    jmeno: [v.title, v.first_name].filter(Boolean).join(" "),
    rc: formatBirthNumber(v.birth_number),
    adresa,
    nerezident: isNonResident ? {
      datumNarozeni: birth,
      doklad: [v.cz_doklad_cislo || v.id_document_number, v.cz_doklad_typ || v.id_document_type].filter(Boolean).join(", "),
      dokladStat: v.cz_doklad_stat || v.nationality || "",
      danovyId: v.danovy_identifikator || "",
      statRezidence: v.stat_rezidence,
    } : null,
    slevy: v.tax_uplatneni === true ? { a: !!v.tax_zakladni, c: !!v.tax_invalidita, d: !!v.tax_invalidita_iii, e: !!v.tax_ztpp } : { a: false, c: false, d: false, e: false },
    deti: childrenForDeclaration(v, `${year}-01-01`),
    jinaOsoba: v.jina_osoba_tytez === true ? {
      ...jo, rc: extractBirthNumber(v.jina_osoba_datum_rc), adresa: v.jina_osoba_adresa || "",
      zamestnani: v.jina_osoba_platce ? "ANO" : "", platce: v.jina_osoba_platce || "",
    } : null,
    jinaOsobaAnoNe: v.jina_osoba_tytez === true ? "ANO" : v.jina_osoba_tytez === false ? "NE" : "",
  };
}

// Suradnice v bodoch (A4 595x842, pocatok vlavo dole) - tiskopis vzor c. 27.
const P1 = {
  rok: [476, 763], platceNazev: [118, 705], platceAdresa: [74, 689],
  prijmeni: [75, 647.5], jmeno: [272, 647.5], rc: [434, 647.5], adresa: [196, 630.5],
  datumNarozeni: [250, 585], doklad: [237, 568], dokladStat: [498, 568], danovyId: [240, 552], statRezidence: [500, 552],
  slevaX: 52, sleva: { a: 472, c: 431, d: 382, e: 333 },
  detiTop: 181, detiStep: 12.95, detiCols: { jmeno: 33, prijmeni: 132, rc: 256, narok: 367, ztpp: 431, zletile: 474 },
};
const P2 = {
  ano: 452, ne: 501, anoNeY: 752,
  row: 689, cols: { jmeno: 32, prijmeni: 132, rc: 247, adresa: 323, uplatnuje: 488, zamestnani: 536 },
  platceY: 668, platceAdresaY: 654, platceX: 132,
};

export async function fillDeclarationPdf(templateBytes, fontBytes, values, year) {
  const d = buildDeclarationData(values, year);
  const pdfDoc = await PDFDocument.load(templateBytes);
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(fontBytes, { subset: true });
  const [p1, p2] = pdfDoc.getPages();
  const black = rgb(0, 0, 0);
  const put = (page, text, x, y, size = 9, maxWidth) => {
    if (!text) return;
    let s = size;
    if (maxWidth) while (s > 6 && font.widthOfTextAtSize(text, s) > maxWidth) s -= 0.5;
    page.drawText(String(text), { x, y, size: s, font, color: black });
  };
  const center = (page, text, cx, y, size = 9) => text && put(page, text, cx - font.widthOfTextAtSize(text, size) / 2, y, size);

  center(p1, d.rok, P1.rok[0], P1.rok[1], 10);
  put(p1, d.platceNazev, ...P1.platceNazev);
  put(p1, d.platceAdresa, ...P1.platceAdresa);
  put(p1, d.prijmeni, ...P1.prijmeni, 9, 140);
  put(p1, d.jmeno, ...P1.jmeno, 9, 120);
  put(p1, d.rc, ...P1.rc, 9, 105);
  put(p1, d.adresa, ...P1.adresa, 9, 350);
  if (d.nerezident) {
    put(p1, d.nerezident.datumNarozeni, ...P1.datumNarozeni);
    put(p1, d.nerezident.doklad, ...P1.doklad, 8, 110);
    put(p1, d.nerezident.dokladStat, ...P1.dokladStat, 8, 50);
    put(p1, d.nerezident.danovyId, ...P1.danovyId, 8, 110);
    put(p1, d.nerezident.statRezidence, ...P1.statRezidence, 8, 50);
  }
  for (const k of ["a", "c", "d", "e"]) if (d.slevy[k]) put(p1, "X", P1.slevaX, P1.sleva[k], 12);
  d.deti.slice(0, 5).forEach((c, i) => {
    const y = P1.detiTop - i * P1.detiStep;
    put(p1, c.jmeno, P1.detiCols.jmeno, y, 8, 95);
    put(p1, c.prijmeni, P1.detiCols.prijmeni, y, 8, 118);
    put(p1, c.rc, P1.detiCols.rc, y, 8, 66);
    center(p1, c.narok, P1.detiCols.narok, y, 8);
    center(p1, c.ztpp, P1.detiCols.ztpp, y, 8);
    center(p1, c.zletile, P1.detiCols.zletile, y, 8);
  });
  if (d.jinaOsobaAnoNe === "ANO") put(p2, "X", P2.ano - 4, P2.anoNeY - 4, 11);
  if (d.jinaOsobaAnoNe === "NE") put(p2, "X", P2.ne - 4, P2.anoNeY - 4, 11);
  if (d.jinaOsoba) {
    const j = d.jinaOsoba;
    put(p2, j.jmeno, P2.cols.jmeno, P2.row, 8, 95);
    put(p2, j.prijmeni, P2.cols.prijmeni, P2.row, 8, 110);
    put(p2, j.rc, P2.cols.rc, P2.row, 8, 70);
    put(p2, j.adresa, P2.cols.adresa, P2.row, 7, 145);
    center(p2, j.zamestnani, P2.cols.zamestnani, P2.row, 8);
    put(p2, j.platce, P2.platceX, P2.platceY, 8, 400);
  }
  pdfDoc.setTitle(`Prohlášení poplatníka ${d.rok} – ${d.prijmeni} ${d.jmeno}`);
  return { bytes: await pdfDoc.save(), extraChildren: Math.max(0, d.deti.length - 5) };
}
