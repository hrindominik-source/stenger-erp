// Prehlad skladu pre kancelariu (bez Reactu/Supabase - kvoli testom).

const norm = (s) => String(s || "").trim().toLowerCase();

// "840 kg" -> { cislo: 840, jednotka: "kg" }
export function parseMnozstvo(s) {
  const m = String(s || "").trim().match(/^([\d\s]+(?:[.,]\d+)?)\s*(.*)$/);
  if (!m) return null;
  const cislo = parseFloat(m[1].replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(cislo) ? { cislo, jednotka: norm(m[2]) } : null;
}

const zaokruhli = (n) => Math.round(n * 1000) / 1000;

// Prijmy, ktore skladnik ulozil s chybou/upozornenim alebo s poskodenym/nekompletnym tovarom.
export function prijmyNaVyriesenie(receipts) {
  return (receipts || [])
    .filter((r) => !r.vyriesene)
    .map((r) => {
      const dovody = [...(r.kontroly || [])];
      if (r.stavPrevzatia && r.stavPrevzatia !== "V poriadku") dovody.unshift(`Stav převzetí: ${r.stavPrevzatia}`);
      return { ...r, dovody };
    })
    .filter((r) => r.dovody.length)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

// Objednavka s jednou polozkou vs. sucet napojenych prijmov v rovnakej jednotke.
export function rozdielyObjednavok(materialOrders, receipts) {
  const out = [];
  for (const o of materialOrders || []) {
    if (o.rozdielVyrieseny) continue;
    if ((o.polozky || []).length > 1) continue;
    const obj = parseMnozstvo((o.polozky && o.polozky[0] && o.polozky[0].mnozstvo) || o.mnozstvo);
    if (!obj || !obj.jednotka) continue;
    const prijmy = (receipts || []).filter((r) => r.materialObjednavkaId === o.id);
    if (!prijmy.length) continue;
    if (prijmy.some((r) => norm(r.mnozstvoJednotka) !== obj.jednotka)) continue;
    const prijate = zaokruhli(prijmy.reduce((s, r) => s + (Number(r.mnozstvoCislo) || 0), 0));
    if (prijate !== zaokruhli(obj.cislo)) out.push({ objednavka: o, objednane: obj.cislo, prijate, jednotka: obj.jednotka, rozdiel: zaokruhli(prijate - obj.cislo) });
  }
  return out;
}

// Polozka faktury vs. napárovany prijem (a jeho objednavka). nesedi = ina hodnota v rovnakej jednotke.
export function porovnanieFaktury(item, receipt, materialOrders) {
  if (!receipt) return null;
  const jf = norm(item.mnozstvoJednotka);
  const fa = Number(String(item.mnozstvoCislo ?? "").replace(",", "."));
  const riadky = [{ co: "Přijato", text: receipt.mnozstvo || `${receipt.mnozstvoCislo} ${receipt.mnozstvoJednotka}` }];
  let nesedi = false;
  if (jf && norm(receipt.mnozstvoJednotka) === jf && Number.isFinite(fa) && zaokruhli(fa) !== zaokruhli(Number(receipt.mnozstvoCislo) || 0)) nesedi = true;
  const o = receipt.materialObjednavkaId ? (materialOrders || []).find((x) => x.id === receipt.materialObjednavkaId) : null;
  if (o) {
    const om = (o.polozky || []).length > 1 ? null : parseMnozstvo((o.polozky && o.polozky[0] && o.polozky[0].mnozstvo) || o.mnozstvo);
    if (om) {
      riadky.push({ co: "Objednáno", text: `${om.cislo} ${om.jednotka}`.trim() });
      if (jf && om.jednotka === jf && Number.isFinite(fa) && zaokruhli(fa) !== zaokruhli(om.cislo)) nesedi = true;
    }
  }
  return { riadky, nesedi };
}

// Objednavka cakajuca na potvrdenie expedicie: nalozene davky alebo dokoncena PDA vydajka, ale nie expedovana.
export function expedicieNaPotvrdenie(orders, dispatches, vydajky) {
  const davky = new Map();
  for (const d of dispatches || []) {
    if (!d.orderId || d.typ) continue;
    davky.set(d.orderId, (davky.get(d.orderId) || 0) + (parseFloat(d.pocetPaliet) || 0));
  }
  const skeny = new Map();
  for (const v of vydajky || []) {
    const id = v.data && v.data.objednavka && v.data.objednavka.id;
    if (id && v.stav === "dokoncena") skeny.set(id, (skeny.get(id) || 0) + 1);
  }
  return (orders || [])
    .filter((o) => !o.stornovana && o.stavExpedicie !== "Expedovana" && (davky.has(o.id) || skeny.has(o.id)))
    .map((o) => ({ order: o, nalozenePalet: davky.get(o.id) || 0, vydajek: skeny.get(o.id) || 0 }));
}

// Objednavky materialu, ku ktorym este nie je ziadny prijem.
export function cakaNaPrijem(materialOrders, receipts) {
  const prijate = new Set((receipts || []).map((r) => r.materialObjednavkaId).filter(Boolean));
  return (materialOrders || []).filter((o) => !prijate.has(o.id) && !o.stornovana);
}

// Zaznam starsi nez dnesny den (ISO cas, porovnanie s lokalnym zaciatkom dna).
export function jeZPredoslehoDna(iso, dnes = new Date()) {
  if (!iso) return false;
  const zaciatok = new Date(dnes.getFullYear(), dnes.getMonth(), dnes.getDate());
  return new Date(iso) < zaciatok;
}
