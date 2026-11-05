import { computeStockLevels } from "./inventory.js";
import { parseSkDate } from "./utils.js";

// Inventura: sklad spocita zasoby naslepo (nevidi evidovany stav), kancelaria
// porovna s evidenciou k datumu inventury, oceni a uzavrie. Pri uzavreti sa
// rozdiely zapisu ako bezne pohyby (manko = vydaj, prebytok = prijem), takze
// stav zasob a jeho vypocet ostavaju bez zmeny.

export const INVENTURA_STAV = {
  ROZPRACOVANA: "Rozpracovaná",
  SPOCITANA: "Spočítaná – čeká na kancelář",
  UZAVRENA: "Uzavřená",
};

export const INVENTURA_DOVOD = "Inventurní rozdíl";
export const INVENTURA_PREBYTEK = "Inventurní přebytek";

export function polozkaKey(material, unit) {
  return String(material || "").trim().toLowerCase() + "|" + String(unit || "").trim().toLowerCase();
}

export function parseQtyInput(v) {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return isNaN(n) ? null : n;
}

// Zaznamy do datumu inventury vratane. Zaznam bez citatelneho datumu sa zapocita
// (radsej nez by tichym vynechanim zmizol zo stavu).
function doDatumu(records, field, datum) {
  const limit = parseSkDate(datum);
  if (!limit) return records || [];
  return (records || []).filter((r) => {
    const d = parseSkDate(r[field]);
    return !d || d <= limit;
  });
}

export function stavKDatu(receipts, issues, datum) {
  return computeStockLevels(doDatumu(receipts, "datumPrijatia", datum), doDatumu(issues, "datum", datum));
}

// Zoznam na pocitanie: vsetko, co ma v evidencii nenulovy stav. Mnozstvo sa
// nepredvyplna - pocita sa naslepo.
export function polozkyNaPocitanie(receipts, issues, datum) {
  return stavKDatu(receipts, issues, datum)
    .filter((row) => Math.abs(row.stav) > 1e-9)
    .map((row) => ({ material: row.material, unit: row.unit, napocitane: "", poznamka: "" }));
}

const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

// Porovnanie a ocenenie. Cena = vazeny priemer zo vsetkych ocenenych prijmov
// do datumu (rovnaka metoda ako Stav zasob). Polozka bez ceny ma hodnotu null.
export function vyhodnotInventuru(inventura, receipts, issues) {
  const evid = stavKDatu(receipts, issues, inventura.datum);
  const byKey = new Map(evid.map((row) => [polozkaKey(row.material, row.unit), row]));
  const seen = new Set();
  const rows = [];
  for (const p of inventura.polozky || []) {
    const key = polozkaKey(p.material, p.unit);
    if (!p.material || seen.has(key)) continue;
    seen.add(key);
    const e = byKey.get(key);
    rows.push(radek(p.material, p.unit, e, parseQtyInput(p.napocitane), p.poznamka || ""));
  }
  // Evidovane, ale na zozname chybajuce = nespocitane, nie nula.
  for (const e of evid) {
    const key = polozkaKey(e.material, e.unit);
    if (seen.has(key) || Math.abs(e.stav) <= 1e-9) continue;
    rows.push(radek(e.material, e.unit, e, null, ""));
  }
  rows.sort((a, b) => a.material.localeCompare(b.material) || a.unit.localeCompare(b.unit));
  const spocitane = rows.filter((r) => r.napocitane !== null);
  return {
    rows,
    nespocitane: rows.filter((r) => r.napocitane === null),
    bezCeny: spocitane.filter((r) => r.priemernaCena === null && r.napocitane !== 0),
    hodnotaEvidovana: round(sum(rows, "hodnotaEvidovana"), 2),
    hodnotaSkutecna: round(sum(spocitane, "hodnotaSkutecna"), 2),
    hodnotaRozdilu: round(sum(spocitane, "hodnotaRozdilu"), 2),
  };
}

function sum(rows, field) {
  return rows.reduce((s, r) => s + (r[field] || 0), 0);
}

function radek(material, unit, e, napocitane, poznamka) {
  const evidovane = e ? round(e.stav) : 0;
  const cena = e ? e.priemernaCena : null;
  const rozdil = napocitane === null ? null : round(napocitane - evidovane);
  const hodnota = (q) => (cena === null || q === null ? null : round(q * cena, 2));
  return {
    material: String(material).trim(),
    unit: String(unit || "").trim(),
    evidovane,
    napocitane,
    rozdil,
    priemernaCena: cena,
    hodnotaEvidovana: hodnota(evidovane),
    hodnotaSkutecna: hodnota(napocitane),
    hodnotaRozdilu: hodnota(rozdil),
    poznamka,
  };
}

// Opravne pohyby pri uzavreti. Nespocitane polozky sa neopravuju.
export function inventuraOpravy(vyhodnoceni, { inventuraId, datum, cas, kdo }) {
  const issues = [];
  const receipts = [];
  for (const r of vyhodnoceni.rows) {
    if (r.rozdil === null || Math.abs(r.rozdil) <= 1e-9) continue;
    const q = round(Math.abs(r.rozdil));
    const mnozstvo = [q, r.unit].filter((x) => x !== "").join(" ").trim();
    const poznamka = `Inventura k ${datum}: evidováno ${r.evidovane}, napočítáno ${r.napocitane}${r.poznamka ? " – " + r.poznamka : ""}`;
    if (r.rozdil < 0) {
      issues.push({
        datum, cas, material: r.material, mnozstvo, mnozstvoCislo: q, mnozstvoJednotka: r.unit,
        dovod: INVENTURA_DOVOD, poznamka, zapisal: kdo, inventuraId,
      });
    } else {
      receipts.push({
        datumPrijatia: datum, casPrijatia: cas, dodavatelId: "", dodavatel: INVENTURA_PREBYTEK,
        material: r.material, mnozstvo, mnozstvoCislo: q, mnozstvoJednotka: r.unit,
        cisloDokladu: "", stavPrevzatia: "V poriadku", poznamka, prevzal: kdo,
        materialObjednavkaId: "", materialObjednavkaCislo: "", photoPath: "",
        // prebytok sa oceni priemernou cenou, aby necakal na fakturu, ktora nepride
        ...(r.priemernaCena !== null ? { cenaJednotkovaCzk: round(r.priemernaCena, 4) } : {}),
        inventuraId,
      });
    }
  }
  return { issues, receipts };
}
