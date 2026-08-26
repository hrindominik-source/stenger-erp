// Generuje CMR (mezinarodni nakladni list) presnym prepisom niekolkych buniek
// do skutocnej sablony dopravcu (public/templates/CMR_template.xlsx), aby
// vysledny dokument bol vizualne uplne totozny s originalom - zvysok
// dokumentu (vsetky staticke texty, formaty, ramceky, aj zabudovane vzorce
// pre auto-prepocet druheho poctu paliet a druheho datumu) ostava
// nedotknuty presne tak, ako je v sablone.
const TEMPLATE_URL = "/templates/CMR_template.xlsx";

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

export async function buildCmrXlsx({ order, company, carrier, products }) {
  const ExcelJSModule = await import("exceljs");
  const ExcelJS = ExcelJSModule.default || ExcelJSModule;

  const res = await fetch(TEMPLATE_URL);
  if (!res.ok) throw new Error("Nepodařilo se načíst šablonu CMR.");
  const buf = await res.arrayBuffer();

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];

  // cislo dopravy - pravy horny roh (merged R1:T3)
  ws.getCell("R1").value = order.cisloObjednavkyDopravy || "";

  // miesto vykladky (dodania) - z objednavky
  const { lines: dodaciaLines, country: dodaciaCountry } = splitAddress(order.adresaDodania);
  const dodaciaAdresa = addressLines(dodaciaLines, 2);
  ws.getCell("F19").value = order.adresaDodaniaNazov || "";
  ws.getCell("F21").value = dodaciaAdresa[0] || "";
  ws.getCell("F23").value = dodaciaAdresa[1] || "";
  ws.getCell("D25").value = dodaciaCountry || "DEUTSCHLAND";

  // datum nakladky - vzorce v sablone (I74/J74, J75) si z tejto bunky
  // odvodia druhy vyskyt datumu automaticky, netreba ich pisat rucne
  const dodaniaDate = parseSkDateLocal(order.datumDodania);
  if (dodaniaDate) {
    ws.getCell("E32").value = subtractBusinessDaysLocal(dodaniaDate, 2);
  }

  // pripojene doklady - cislo LS Germany (zadava sa rucne cez ikonu "LS
  // Germany", zostava prazdne kym nie je vyplnene - nema sa nahradzovat
  // ceskym cislom dodacieho listu)
  ws.getCell("E36").value = order.nemeckyDodakCislo || "";

  // celkovy pocet paliet - vzorce v sablone (I56, O41) si druhy vyskyt aj
  // hmotnost odvodia automaticky z tejto bunky
  const items = order.polozky && order.polozky.length > 0 ? order.polozky : [];
  const sumPaliet = items.reduce((s, it) => s + (parseFloat(it.palet) || 0), 0);
  const totalPaliet = sumPaliet > 0 ? sumPaliet : parseFloat(order.pocetPaliet) || 0;
  ws.getCell("E41").value = totalPaliet;

  // vynuti prepocet vsetkych vzorcov (I56, O41/P41/Q41, J74/J75...) pri
  // otvoreni v Exceli, inak by zobrazovali stare cachovane hodnoty zo sablony
  wb.calcProperties = { fullCalcOnLoad: true };

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
