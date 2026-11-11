// Generuje CMR (mezinarodni nakladni list) presnym prepisom niekolkych buniek
// do skutocnej sablony dopravcu (public/templates/CMR_template.xlsx), aby
// vysledny dokument bol vizualne uplne totozny s originalom - zvysok
// dokumentu (vsetky staticke texty, formaty, ramceky, aj zabudovane vzorce
// pre auto-prepocet druheho poctu paliet a druheho datumu) ostava
// nedotknuty presne tak, ako je v sablone.
const TEMPLATE_URL = `${import.meta.env.BASE_URL}templates/CMR_template.xlsx`;

// Pouziva Date.UTC/getUTCDay namiesto lokalneho casu: exceljs pri zapise
// datumu do xlsx pocita seriove cislo z UTC casu Date objektu, takze pri
// lokalnom konstruktore na stroji s kladnym UTC posunom (napr. CEST +2) by
// sa datum v subore posunul o den spat - a pravidelne tak vysiel vikend
// namiesto spravneho pracovneho dna.
function parseSkDateLocal(str) {
  const m = String(str || "").match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return null;
  return new Date(Date.UTC(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10)));
}

// Datum nakladky nesmie nikdy pripadnut na vikend - preskakuje soboty/nedele.
function subtractBusinessDaysLocal(date, days) {
  const d = new Date(date.getTime());
  let remaining = days;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) remaining--;
  }
  return d;
}

// Ak posledny riadok adresy vyzera ako samostatny nazov krajiny (ziadne
// cislice), oddel ho zvlast - inak sa zapise aj do riadku s PSC/mestom
// (viz bug: "3542AL UTRECHT, NIEDERLANDE" namiesto len "3542AL UTRECHT").
function splitAddress(adresa) {
  const lines = String(adresa || "").split(/[\n,]/).map((l) => l.trim()).filter(Boolean);
  let country = "";
  if (lines.length > 1) {
    const last = lines[lines.length - 1];
    if (last && !/\d/.test(last) && last.length > 2) {
      country = last.toUpperCase();
      lines.pop();
    }
  }
  return { lines, country };
}

function addressLines(lines, max) {
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max - 1), lines.slice(max - 1).join(", ")];
}

// Riadok "PSC mesto" (86899 Landsberg, D-77656 Offenburg, 811 01 Bratislava, 3542AL Utrecht).
const PSC_RIADOK = /^(?:[A-Z]{1,2}\s?-\s?)?\d{2,3}\s?\d{2,3}\s*[A-Z]{0,2}\s+\S/i;

// Miesto vykladky do dvoch riadkov CMR: [ulica, PSC + mesto]. Riadky ako
// "GLN: …" (cislo pre zakaznika, nie adresa) sa vynechaju; ostatne riadky
// pred ulicou (napr. "Verteilzentrum …") idu pred ulicu, ak sa zmestia.
export function miestoVykladky(lines, zmestiSa = () => true) {
  const bezGln = lines.filter((l) => !/^(GLN|ILN|GS1)\b/i.test(l));
  const iPsc = bezGln.findIndex((l) => PSC_RIADOK.test(l));
  if (iPsc < 0) return addressLines(bezGln, 2);
  const pred = bezGln.slice(0, iPsc);
  const ulica = pred.length ? pred[pred.length - 1] : "";
  const ostatne = pred.slice(0, -1);
  const plny = [...ostatne, ulica].filter(Boolean).join(", ");
  // ked sa doplnkove riadky (napr. "Verteilzentrum …") s ulicou citatelne
  // nezmestia, ostane len ulica - mesto je aj tak v riadku s PSC
  const riadok1 = zmestiSa(plny) ? plny : ulica;
  return [riadok1, [bezGln[iPsc], ...bezGln.slice(iPsc + 1)].join(", ")];
}

// Sirka zluceneho policka (v znakoch pisma Calibri 11) - sucet sirok stlpcov.
function sirkaPolicka(ws, addr) {
  // ExcelJS: ws._merges[master] = { model: { left, right } } (1-based stlpce)
  const m = ws._merges && ws._merges[addr];
  const cell = ws.getCell(addr);
  const left = m && m.model ? m.model.left : cell.col;
  let right = m && m.model ? m.model.right : cell.col;
  // nezlucena bunka: text smie pretiect do prazdnych susednych buniek vpravo
  // (po prvu vyplnenu alebo zlucenu bunku), Excel ho tam zobrazi
  if (!m) {
    while (right < ws.columnCount) {
      const dalsia = ws.getRow(cell.row).getCell(right + 1);
      if (dalsia.isMerged || (dalsia.value !== null && dalsia.value !== undefined && dalsia.value !== "")) break;
      right++;
    }
  }
  let w = 0;
  for (let c = left; c <= right; c++) w += ws.getColumn(c).width || 8.43;
  return w;
}

// Pismo sa zmensi, aby sa text zmestil do policka na jeden riadok (nic nepretecie
// cez ramik a strana ostane jedna). Pod minimum nejde - vtedy Excel "zmensit, aby sa zmestilo".
export function velkostPismaPrePolicko(text, sirkaZnakov, povodne = 11, minimum = 6) {
  // odhad sirky textu v jednotkach sirky stlpca (= sirka "0" pri Calibri 11)
  const t = String(text || "");
  if (!t) return povodne;
  let dlzka = 1;
  for (const ch of t) dlzka += /[A-ZÀ-ÞŠŽČŘĎŤŇĽĹ]/.test(ch) ? 1.25 : /[0-9]/.test(ch) ? 1 : /[ .,:;'!|il]/.test(ch) ? 0.5 : /[mwMW]/.test(ch) ? 1.4 : 0.95;
  if (dlzka <= sirkaZnakov) return povodne;
  return Math.max(minimum, Math.floor(((povodne * sirkaZnakov) / dlzka) * 2) / 2);
}

function zapisDoPolicka(ws, addr, text) {
  const cell = ws.getCell(addr);
  cell.value = text || "";
  const povodne = (cell.font && cell.font.size) || 11;
  const velkost = velkostPismaPrePolicko(text, sirkaPolicka(ws, addr), povodne);
  if (velkost === povodne) return;
  // NOVY objekt stylu - sablona zdiela styl medzi bunkami, zmena by sa inak
  // preniesla aj do inych policok
  const st = JSON.parse(JSON.stringify(cell.style || {}));
  st.font = { ...(st.font || {}), size: velkost };
  if (velkost <= 6) st.alignment = { ...(st.alignment || {}), shrinkToFit: true, wrapText: false };
  cell.style = st;
}

// Nacita sablonu a vyplni ju - zdielane jadro pre stiahnutie .xlsx aj pre
// nahlad/tlac/PDF (renderovane priamo z tohto isteho vyplneneho workbooku,
// viz xlsxToHtml.js), aby oba vystupy boli vzdy presne rovnake.
export async function buildCmrWorkbook({ order, company, carrier, products }) {
  const ExcelJSModule = await import("exceljs");
  const ExcelJS = ExcelJSModule.default || ExcelJSModule;

  const res = await fetch(TEMPLATE_URL);
  if (!res.ok) throw new Error("Nepodařilo se načíst šablonu CMR.");
  const buf = await res.arrayBuffer();

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];

  // cislo dopravy - pravy horny roh (merged R1:T3)
  zapisDoPolicka(ws, "R1", order.cisloObjednavkyDopravy || "");

  // miesto vykladky (dodania) - z objednavky
  const { lines: dodaciaLines, country: dodaciaCountry } = splitAddress(order.adresaDodania);
  const dodaciaAdresa = miestoVykladky(dodaciaLines, (t) => velkostPismaPrePolicko(t, sirkaPolicka(ws, "F21")) >= 8);
  zapisDoPolicka(ws, "F19", order.adresaDodaniaNazov || "");
  zapisDoPolicka(ws, "F21", dodaciaAdresa[0] || "");
  zapisDoPolicka(ws, "F23", dodaciaAdresa[1] || "");
  zapisDoPolicka(ws, "D25", dodaciaCountry || "DEUTSCHLAND");

  // datum nakladky - vzorce v sablone (I74/J74, J75) si z tejto bunky
  // odvodia druhy vyskyt datumu automaticky, netreba ich pisat rucne
  const dodaniaDate = parseSkDateLocal(order.datumDodania);
  if (dodaniaDate) {
    ws.getCell("E32").value = subtractBusinessDaysLocal(dodaniaDate, 2);
  }

  // pripojene doklady - cislo LS Germany (zadava sa rucne cez ikonu "LS
  // Germany", zostava prazdne kym nie je vyplnene - nema sa nahradzovat
  // ceskym cislom dodacieho listu)
  zapisDoPolicka(ws, "E36", order.nemeckyDodakCislo || "");

  // celkovy pocet paliet - vzorce v sablone (I56, O41) si druhy vyskyt aj
  // hmotnost odvodia automaticky z tejto bunky
  const items = order.polozky && order.polozky.length > 0 ? order.polozky : [];
  const sumPaliet = items.reduce((s, it) => s + (parseFloat(it.palet) || 0), 0);
  const totalPaliet = sumPaliet > 0 ? sumPaliet : parseFloat(order.pocetPaliet) || 0;
  ws.getCell("E41").value = totalPaliet;

  // vynuti prepocet vsetkych vzorcov (I56, O41/P41/Q41, J74/J75...) pri
  // otvoreni v Exceli, inak by zobrazovali stare cachovane hodnoty zo sablony
  wb.calcProperties = { fullCalcOnLoad: true };

  return { wb, ws };
}

export async function buildCmrXlsx({ order, company, carrier, products }) {
  const { wb } = await buildCmrWorkbook({ order, company, carrier, products });

  const buf2 = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf2], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `CMR_${String(order.cisloObjednavkyDopravy || order.id).replace(/\//g, "-")}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
