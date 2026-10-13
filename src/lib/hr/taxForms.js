// Vyplnenie tiskopisov Financni spravy pre zalozku "Daně":
//  - MFin 5558 vzor c. 3 - Potvrzeni zamestnavatele druheho z poplatniku
//  - MFin 5457/B vzor c. 4 - Zadost o rocni zuctovani zaloh a dan. zvyhodneni
// Tiskopisy nemaju formularove polia - text sa dopisuje na suradnice overene
// vykreslenim vzoru (A4 595x842, pocatok vlavo dole; nizsie su suradnice
// "zhora" a prepocitaju sa). Pri novom vzore treba skontrolovat suradnice.
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { formatStreetLine, CZ } from "./employeeFields.js";
import { formatBirthNumber, fmtCz } from "./taxChildren.js";
import { PLATCE_DANE, RZ_POLOZKY, childMonthsForYear } from "./taxYear.js";

const BASE = import.meta.env?.BASE_URL ?? "/";
export const TAX_FORM_TEMPLATES = {
  f5558: { url: `${BASE}hr/MFin5558_vzor3.pdf`, nazev: "MFin 5558 – vzor č. 3" },
  f5457b: { url: `${BASE}hr/MFin5457B_vzor4.pdf`, nazev: "MFin 5457/B – vzor č. 4" },
};

async function openForm(templateBytes, fontBytes) {
  const pdfDoc = await PDFDocument.load(templateBytes);
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(fontBytes, { subset: true });
  const black = rgb(0, 0, 0);
  const H = pdfDoc.getPages()[0].getHeight();
  // top = vzdialenost zakladne textu od horneho okraja
  const put = (page, text, x, top, size = 9, maxWidth) => {
    if (text === null || text === undefined || text === "") return;
    const t = String(text);
    let s = size;
    if (maxWidth) while (s > 5.5 && font.widthOfTextAtSize(t, s) > maxWidth) s -= 0.5;
    page.drawText(t, { x, y: H - top, size: s, font, color: black });
  };
  const center = (page, text, cx, top, size = 9) => text !== "" && text != null && put(page, text, cx - font.widthOfTextAtSize(String(text), size) / 2, top, size);
  const right = (page, text, rx, top, size = 9) => text !== "" && text != null && put(page, text, rx - font.widthOfTextAtSize(String(text), size), top, size);
  return { pdfDoc, font, put, center, right, H };
}

function addressParts(v) {
  const street = formatStreetLine(v.perm_ulice, v.perm_cp, v.perm_co) || (v.perm_cp ? `${v.perm_obec} ${v.perm_cp}` : "");
  return { street, obec: v.perm_obec || "", psc: String(v.perm_psc || "").replace(/\s/g, ""), stat: v.perm_stat && v.perm_stat !== CZ ? v.perm_stat : "" };
}

const fmtKc = (n) => (Number(n) || 0).toLocaleString("cs-CZ").replace(/ /g, " ");

// ---------------------------------------------------------------------------
// MFin 5558 - potvrzeni pro druheho z poplatniku
// ---------------------------------------------------------------------------

// opts: { deti (prepisane mesiace), vyhotovil, kontakt, dne (iso), nahrazujeDne (iso) }
export function build5558Data(v, year, employment, opts = {}) {
  const deti = opts.deti || childMonthsForYear(v, year, employment);
  return {
    rok: String(year),
    prijmeni: v.last_name || "",
    jmeno: [v.title, v.first_name].filter(Boolean).join(" "),
    rc: formatBirthNumber(v.birth_number),
    adresa: addressParts(v),
    uplatnil: deti.some((c) => c.mesice > 0),
    deti: deti.filter((c) => c.mesice > 0),
    vyhotovil: opts.vyhotovil || "",
    kontakt: opts.kontakt || "",
    dne: opts.dne ? fmtCz(opts.dne) : "",
    nahrazujeDne: opts.nahrazujeDne ? fmtCz(opts.nahrazujeDne) : "",
  };
}

export async function fill5558Pdf(templateBytes, fontBytes, v, year, employment, opts) {
  const d = build5558Data(v, year, employment, opts);
  const { pdfDoc, put, center, right, font } = await openForm(templateBytes, fontBytes);
  const p = pdfDoc.getPages()[0];
  put(p, PLATCE_DANE.dic, 44, 200.5, 10);
  put(p, PLATCE_DANE.nazev, 44, 231.5, 10);
  put(p, PLATCE_DANE.adresa, 44, 262.5, 10);
  center(p, d.rok, 368, 293.5, 10);
  put(p, d.prijmeni, 44, 329.5, 10, 255);
  put(p, d.jmeno, 327, 329.5, 10, 228);
  const [rc1, rc2] = d.rc.includes("/") ? d.rc.split("/") : [d.rc, ""];
  right(p, rc1, 124, 360.5, 10);
  put(p, rc2, 136, 360.5, 10);
  put(p, d.adresa.street, 212, 359.5, 10, 343);
  put(p, d.adresa.obec, 44, 391.5, 10, 510);
  put(p, d.adresa.stat, 44, 421.5, 10, 425);
  center(p, d.adresa.psc, 526, 421.5, 10);
  center(p, d.rok, 85, 450.5, 10);
  // nehodiace sa "uplatnil" / "neuplatnil" sa preskrtne
  const strike = d.uplatnil ? [146.2, 184.4] : [115.6, 143.8];
  p.drawLine({ start: { x: strike[0], y: 842 - 448 }, end: { x: strike[1], y: 842 - 448 }, thickness: 0.9, color: rgb(0, 0, 0) });
  const cols = { prijmeni: 53, jmeno: 141, rc: 223, m: [346, 434, 522] };
  if (d.uplatnil) {
    d.deti.slice(0, 7).forEach((c, i) => {
      const top = 507.5 + i * 17.02;
      put(p, c.prijmeni, cols.prijmeni, top, 8.5, 82);
      put(p, c.jmeno, cols.jmeno, top, 8.5, 76);
      put(p, c.rc, cols.rc, top, 8.5, 76);
      center(p, String(c.mesice), cols.m[c.poradi - 1], top, 9);
    });
  } else {
    // ziadne dieta - informacia cez cely prvy riadok tabulky
    p.drawRectangle({ x: 51, y: 842 - 512, width: 514, height: 15.5, color: rgb(1, 1, 1) });
    const t = `Poplatník v roce ${d.rok} neuplatňuje daňové zvýhodnění na žádné vyživované dítě.`;
    put(p, t, 308 - font.widthOfTextAtSize(t, 9) / 2, 507.5, 9);
  }
  put(p, d.nahrazujeDne, 129, 657.5, 9);
  put(p, d.vyhotovil, 326, 647.5, 9.5, 230);
  put(p, d.kontakt, 326, 665.5, 9.5, 230);
  put(p, d.dne, 326, 683.5, 9.5);
  pdfDoc.setTitle(`Potvrzení zaměstnavatele druhého z poplatníků ${d.rok} – ${d.prijmeni} ${d.jmeno}`);
  return { bytes: await pdfDoc.save(), extraChildren: Math.max(0, d.deti.length - 7), data: d };
}

// ---------------------------------------------------------------------------
// MFin 5457/B - zadost o rocni zuctovani
// ---------------------------------------------------------------------------

const RZ_ROW_TOP = { dary: 406.8, uroky: 423.8, penzijni_pripojisteni: 457.8, dps: 474.8, penzijni_pojisteni: 491.8, zivotni: 508.8, dip: 525.8, dlouhodoba_pece: 542.8 };

export async function fill5457bPdf(templateBytes, fontBytes, v, year, rz = {}, prilohy = []) {
  const { pdfDoc, put, center, right } = await openForm(templateBytes, fontBytes);
  const [p1, p2] = pdfDoc.getPages();
  center(p1, String(year), 389, 79.5, 11);
  put(p1, v.last_name || "", 117, 122, 9, 182);
  put(p1, [v.title, v.first_name].filter(Boolean).join(" "), 302, 122, 9, 110);
  put(p1, formatBirthNumber(v.birth_number) || (v.date_of_birth ? fmtCz(v.date_of_birth) : ""), 468, 122, 9, 92);
  put(p1, `${PLATCE_DANE.nazev}, ${PLATCE_DANE.adresa}, DIČ ${PLATCE_DANE.dic}`, 84, 158, 9, 470);
  (rz.predchozi || []).filter((r) => r.obdobi || r.platce).slice(0, 2).forEach((r, i) => {
    const top = 286.5 + i * 17;
    put(p1, r.obdobi, 75, top, 8.5, 86);
    put(p1, r.platce, 168, top, 8.5, 393);
  });
  for (const pol of RZ_POLOZKY) {
    const val = Number(rz.polozky?.[pol.key]) || 0;
    if (val <= 0) continue;
    center(p1, "X", 97.5, RZ_ROW_TOP[pol.key], 10);
    right(p1, fmtKc(val), 559, RZ_ROW_TOP[pol.key], 9);
  }
  (rz.jina_osoba || []).filter((o) => o.jmeno || o.prijmeni).slice(0, 2).forEach((o, i) => {
    const top = 663.5 + i * 17;
    put(p1, o.jmeno, 74, top, 8.5, 94);
    put(p1, o.prijmeni, 173, top, 8.5, 125);
    put(p1, o.rc, 303, top, 8.5, 92);
    put(p1, o.adresa, 400, top, 7.5, 163);
  });
  String(rz.adresa_bytu || "").split(/\n/).slice(0, 4).forEach((line, i) => put(p1, line, 77, 745 + i * 11, 9, 484));

  if (rz.uver_pred2021) center(p2, "X", 46, 41.5, 11);
  if (rz.uver_od2021) center(p2, "X", 45.5, 116, 11);
  if (Number(rz.exekuce) > 0) right(p2, fmtKc(rz.exekuce), 517, 265, 9);
  const m = rz.manzel || {};
  if (m.prijmeni || m.jmeno) {
    put(p2, m.jmeno, 33, 365.5, 8.5, 94);
    put(p2, m.prijmeni, 131, 365.5, 8.5, 95);
    put(p2, m.rc, 230, 365.5, 8.5, 94);
    put(p2, m.mesice, 329, 365.5, 8, 54);
    if (m.ztpp) center(p2, "X", 402.5, 365.5, 10);
    put(p2, m.mesice_ztpp, 425, 365.5, 8, 97);
  }
  (rz.manzel_deti || []).filter((c) => c.jmeno || c.prijmeni).slice(0, 2).forEach((c, i) => {
    const top = 467 + i * 17;
    put(p2, c.jmeno, 33, top, 8.5, 122);
    put(p2, c.prijmeni, 160, top, 8.5, 136);
    put(p2, c.rc, 302, top, 8.5, 220);
  });
  if (rz.dodatecne) center(p2, "X", 490, 617.5, 11);
  const names = [...new Set(prilohy.map((p) => p.name))];
  if (names.length) {
    const text = `Přílohy (${names.length}): ${names.join(", ")}`;
    const words = text.split(" ");
    const lines = [];
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).length > 110) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) lines.push(cur);
    lines.slice(0, 4).forEach((l, i) => put(p2, l, 34, 773 + i * 10.5, 8, 485));
  }
  pdfDoc.setTitle(`Žádost o roční zúčtování ${year} – ${v.last_name || ""} ${v.first_name || ""}`);
  return { bytes: await pdfDoc.save() };
}
