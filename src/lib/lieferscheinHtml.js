// Lieferschein (dodaci list) - jedno spolocne HTML pre tlac, PDF aj nahlad.
// Usporny vzhlad (navrh 11/2026): ziadne vyplnene plochy, len tenke ciary a
// cierny text, aby tlac brala co najmenej tonera. Obsah je rovnaky ako v
// povodnom dodaku - meni sa len forma.
import { adresaPoNemecky } from "./krajinaNemecky.js";
import { popisDodaku } from "./lieferscheinObsah.js";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const PSC_RIADOK = /^(?:[A-Z]{1,2}\s?-\s?)?\d{2,3}\s?\d{2,3}\s*[A-Z]{0,2}\s+\S/i;

const porovnaj = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

// Adresa bez riadkov, ktore su rovnake ako nazov miesta dodania (nazov sa na
// dodaku pise zvlast tucne - inak by bol dvakrat) a bez opakovanych riadkov.
export function adresaBezNazvu(adresa, nazov) {
  const n = porovnaj(nazov);
  const videne = new Set();
  return String(adresa || "").split(/\n|,/).map((l) => l.trim()).filter((l) => {
    const k = porovnaj(l);
    if (!k || (n && k === n) || videne.has(k)) return false;
    videne.add(k);
    return true;
  }).join("\n");
}

// Adresa dodania po riadkoch: GLN/ILN zvlast (mensie), riadok s PSC tucne.
export function rozdelAdresuDodania(adresa, nazov) {
  const riadky = adresaBezNazvu(adresa, nazov).split("\n").map((l) => l.trim()).filter(Boolean);
  const gln = riadky.filter((l) => /^(GLN|ILN)\b/i.test(l));
  const adresne = riadky.filter((l) => !/^(GLN|ILN)\b/i.test(l));
  return { riadky: adresne.map((text) => ({ text, psc: PSC_RIADOK.test(text) })), gln };
}

function fmtCislo(n) {
  if (n === null || n === undefined || n === "") return "";
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n);
  return x.toLocaleString("cs-CZ").replace(/ /g, " ");
}

const CSS = `
.lsd{font-family:Arial,Helvetica,sans-serif;color:#16181d;font-size:12px;line-height:1.35;display:flex;flex-direction:column;box-sizing:border-box}
.lsd *{box-sizing:border-box}
.lsd .lbl{font-size:8.5px;letter-spacing:.09em;text-transform:uppercase;color:#6b7280;font-weight:bold}
.lsd .head{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:14px;border-bottom:1px solid #16181d}
.lsd .brand{font-size:18px;font-weight:bold}
.lsd .brand-sub{color:#6b7280;font-size:10.5px;margin-top:3px}
.lsd .title{text-align:right}
.lsd .title h1{margin:0;font-size:25px;letter-spacing:.14em;font-weight:normal}
.lsd .title .sub{font-size:11px;color:#6b7280;letter-spacing:.14em;text-transform:uppercase;margin-top:1px}
.lsd .title .nr{font-size:15px;font-weight:bold;margin-top:2px}
.lsd .title .nr span{font-weight:normal;color:#6b7280;font-size:11px;margin-right:6px}
.lsd .meta{display:flex;margin-top:12px;border-bottom:1px solid #c4c8ce}
.lsd .meta>div{flex:1;padding:6px 0 9px}
.lsd .meta .v{font-size:14px;font-weight:bold;margin-top:2px}
.lsd .meta .v small{font-weight:normal;color:#6b7280;font-size:10.5px;margin-left:6px}
.lsd .meta .v.cena{display:flex;justify-content:space-between;align-items:baseline}
.lsd .addr{display:flex;gap:14px;margin-top:14px}
.lsd .card{flex:1;padding:9px 12px;border:1px solid #c4c8ce;border-radius:5px}
.lsd .card.ship{flex:1.25;border-color:#16181d}
.lsd .card .lbl{display:block;margin-bottom:5px}
.lsd .card.ship .lbl{color:#16181d}
.lsd .card .n{font-weight:bold;margin-bottom:2px}
.lsd .card .row{color:#30343b;white-space:pre-wrap}
.lsd .gln{margin-top:4px;font-size:10px;color:#6b7280}
.lsd table{width:100%;border-collapse:collapse;margin-top:20px}
.lsd thead th{color:#16181d;border-top:1px solid #16181d;border-bottom:1px solid #16181d;font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;font-weight:bold;text-align:left;padding:7px 8px}
.lsd td{padding:8px 8px 10px;border-bottom:1px solid #c4c8ce;vertical-align:top}
.lsd .num{text-align:right;white-space:nowrap}
.lsd td .desc{font-weight:bold;font-size:12.5px}
.lsd td .det{font-size:10px;color:#6b7280;margin-top:3px;line-height:1.45;white-space:pre-wrap}
.lsd td .art{font-weight:bold}
.lsd thead th .cz{display:block;font-weight:normal;color:#6b7280;letter-spacing:.04em;margin-top:1px}
.lsd tfoot td{border-bottom:0;border-top:1px solid #16181d;font-weight:bold}
.lsd .pal{display:flex;align-items:center;gap:10px;margin-top:12px;padding:7px 0;border-bottom:1px solid #c4c8ce}
.lsd .pal .eq{font-size:13px;font-weight:bold}
.lsd .pal .eq small{font-weight:normal;color:#6b7280;font-size:10px}
.lsd .pal .eq i{font-style:normal;color:#6b7280;font-weight:normal;margin:0 5px}
.lsd .spacer{flex:1;min-height:24px}
.lsd .sig{display:flex;gap:20px;break-inside:avoid;page-break-inside:avoid}
.lsd tr{break-inside:avoid;page-break-inside:avoid}
.lsd .sig>div{flex:1;border-top:1px solid #c4c8ce;padding-top:8px}
.lsd .sig>div.mid{flex:1.15}
.lsd .sig .lbl{display:block;margin-bottom:5px}
.lsd .fill{display:flex;gap:8px;margin-top:6px;align-items:flex-end}
.lsd .fill span:last-child{flex:1;border-bottom:1px solid #9aa0a8;height:13px}
.lsd .stamp{height:70px;margin-top:7px;border:1px dotted #b5bac1;border-radius:5px;display:flex;align-items:flex-end;justify-content:center;padding-bottom:5px;font-size:9px;color:#6b7280}
.lsd .bottom{margin-top:18px;padding-top:6px;border-top:1px solid #c4c8ce;display:flex;justify-content:space-between;font-size:9.5px;color:#6b7280}
`;

// polozky: [{ palet, karton, popis, inhlt, eanUK, eanVE, rspo, stk, artikel, artikelNase, artikelSW }]
// opts.minVyska: CSS vyska celej strany (pata s podpismi ide na spodok strany)
export function buildLieferscheinDocHtml(d, opts = {}) {
  const { carrierName = "", transportPrice, polozky = [], totalPaliet, rspoKod = "", cs = false } = d;
  const L = popisDodaku(cs);
  // stlpec tabulky: nemecky + cesky pod nim, alebo len cesky
  const th = (de, cz) => (cs ? esc(cz) : `${esc(de)}<span class="cz">${esc(cz)}</span>`);
  // krajiny v adresach po nemecky (napr. "Nemecko" -> "Deutschland"); cesky dodak ich necha
  const poNem = cs ? (a) => a : adresaPoNemecky;
  const company = { ...(d.company || {}), adresa: poNem((d.company || {}).adresa) };
  const customer = d.customer ? { ...d.customer, adresa: poNem(d.customer.adresa) } : d.customer;
  const order = { ...(d.order || {}), adresaDodania: poNem((d.order || {}).adresaDodania) };
  const adr = rozdelAdresuDodania(order.adresaDodania, order.adresaDodaniaNazov);
  const firmaRiadok = [String(company.adresa || "").replace(/\s*\n\s*/g, ", "), company.ico && "IČO " + company.ico, company.dic && "DIČ " + company.dic].filter(Boolean).map(esc).join(" · ");
  const cena = transportPrice && transportPrice.matched ? transportPrice.text || fmtCislo(transportPrice.total) : "";
  const sum = (k) => polozky.reduce((s, it) => s + (parseFloat(String(it[k] ?? "").replace(",", ".")) || 0), 0);
  const sumKarton = sum("karton");
  const sumStk = sum("stk");
  const miesta = order.pocetPaletovychMiest || 0;

  const riadky = polozky.map((it) => {
    const det = [
      it.inhlt ? esc(it.inhlt) : "",
      [it.eanUK && "EAN UK: " + esc(it.eanUK), it.eanVE && "EAN VE: " + esc(it.eanVE)].filter(Boolean).join("&nbsp;&nbsp;&nbsp;"),
      it.rspo ? esc(rspoKod) : "",
    ].filter(Boolean).join("<br>");
    // nase cislo + SW z napojeneho produktu, inak cislo z objednavky
    const art = it.artikelNase || it.artikelSW
      ? `${it.artikelNase ? `<div class="art">${esc(it.artikelNase)}</div>` : ""}${it.artikelSW ? `<div class="det">SW: ${esc(it.artikelSW)}</div>` : ""}`
      : `<div class="art">${esc(it.artikel)}</div>`;
    return `<tr><td class="num">${esc(it.palet)}</td><td class="num">${esc(it.karton)}</td><td><div class="desc">${esc(it.popis)}</div>${det ? `<div class="det">${det}</div>` : ""}</td><td class="num">${esc(fmtCislo(it.stk))}</td><td>${art}</td></tr>`;
  }).join("");
  const suma = polozky.length > 1
    ? `<tfoot><tr><td class="num">${esc(fmtCislo(totalPaliet))}</td><td class="num">${sumKarton ? esc(fmtCislo(sumKarton)) + (polozky.some((it) => /KRT/i.test(String(it.karton))) ? " KRT" : "") : ""}</td><td>${L("Summe", "Celkem")}</td><td class="num">${sumStk ? esc(fmtCislo(sumStk)) : ""}</td><td></td></tr></tfoot>`
    : "";

  return `<style>${CSS}</style>
<div class="lsd" style="min-height:${opts.minVyska || "auto"}">
  <div class="head">
    <div><div class="brand">${esc(company.nazov)}</div><div class="brand-sub">${firmaRiadok}</div></div>
    <div class="title">${cs ? `<h1>DODACÍ LIST</h1>` : `<h1>LIEFERSCHEIN</h1><div class="sub">Dodací list</div>`}<div class="nr"><span>${L("Nr.", "Č.")}</span>${esc(order.cisloDodaciehoListu)}</div></div>
  </div>
  <div class="meta">
    <div><div class="lbl">${L("Lieferdatum", "Datum dodání")}</div><div class="v">${esc(order.datumDodania)}</div></div>
    <div><div class="lbl">${L("Bestellung", "Objednávka")}</div><div class="v">${esc(order.cisloObjednavkyZakaznika)}</div></div>
    <div><div class="lbl">${L("Transport-Nr.", "Č. přepravy")}</div><div class="v cena"><span>${esc(order.cisloObjednavkyDopravy)}</span>${cena ? `<small>${esc(cena)}</small>` : ""}</div></div>
  </div>
  <div class="addr">
    <div class="card"><span class="lbl">${L("Lieferant", "Dodavatel")}</span><div class="n">${esc(company.nazov)}</div><div class="row">${esc(company.adresa)}</div><div class="row" style="margin-top:3px">IČO: ${esc(company.ico)}<br>${L("USt-IdNr.", "DIČ")}: ${esc(company.dic)}</div></div>
    <div class="card"><span class="lbl">${L("Abnehmer", "Odběratel")}</span><div class="n">${esc(customer ? customer.nazov : order.zakaznik)}</div><div class="row">${esc(customer ? customer.adresa : "")}</div>${customer && customer.dic ? `<div class="row" style="margin-top:3px">${L("USt-IdNr.", "DIČ")}: ${esc(customer.dic)}</div>` : ""}</div>
    <div class="card ship"><span class="lbl">${L("Lieferadresse", "Adresa dodání")}</span><div class="n">${esc(order.adresaDodaniaNazov)}</div><div class="row">${adr.riadky.map((r) => (r.psc ? `<b>${esc(r.text)}</b>` : esc(r.text))).join("<br>")}</div>${adr.gln.length ? `<div class="gln">${adr.gln.map(esc).join("<br>")}</div>` : ""}</div>
  </div>
  <table>
    <thead><tr><th class="num" style="width:10%">${th("Paletten", "Palety")}</th><th class="num" style="width:12%">${th("Kartons", "Kartony")}</th><th>${th("Bezeichnung", "Označení zboží")}</th><th class="num" style="width:10%">${th("Stk", "Ks")}</th><th style="width:21%">${th("Artikel Lief.-Nr.", "Číslo artiklu")}</th></tr></thead>
    <tbody>${riadky}</tbody>${suma}
  </table>
  <div class="pal"><span class="lbl">${L("Paletten", "Palety")}</span><span class="eq">${cs
    ? `${esc(miesta)} dvoupatrové<i>=</i>${esc(totalPaliet)} europalety<i>=</i>${esc(miesta)} pal. místa`
    : `${esc(miesta)} Doppelstockpal. <small>(dvoupatrové)</small><i>=</i>${esc(totalPaliet)} Europaletten <small>(europalety)</small><i>=</i>${esc(miesta)} Stellplätze <small>(pal. místa)</small>`}</span></div>
  <div class="spacer"></div>
  <div class="sig">
    <div><span class="lbl">${L("Ausgestellt von", "Vystavil")}</span><div>${esc(company.email)}</div><div class="stamp">${L("Unterschrift", "Podpis")}</div></div>
    <div class="mid"><span class="lbl">${L("Transport", "Dopravce")}</span><div><b>${esc(carrierName)}</b></div><div class="fill"><span>${L("LKW-Kennzeichen", "SPZ")}</span><span></span></div><div class="lbl" style="margin-top:10px">${L("Europaletten", "Europalety")}</div><div class="fill"><span>${L("Übernommen", "Převzato")}</span><span></span></div><div class="fill"><span>${L("Ausgegeben", "Vydáno")}</span><span></span></div><div class="fill"><span>Saldo</span><span></span></div></div>
    <div><span class="lbl">${L("Abnehmer", "Odběratel")}</span><div>${L("Datum, Unterschrift, Stempel", "Datum, podpis, razítko")}</div><div class="stamp">${L("Unterschrift, Stempel", "Podpis, razítko")}</div></div>
  </div>
  <div class="bottom"><span>${esc(company.nazov)}${company.adresa ? " · " + esc(String(company.adresa).replace(/\s*\n\s*/g, ", ")) : ""}</span><span>${L("Lieferschein", "Dodací list")} ${esc(order.cisloDodaciehoListu)}</span></div>
</div>`;
}
