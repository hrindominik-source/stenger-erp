const BUCKET_RE = /^(\d+)\s*-\s*(\d+)\s*pal/i;
const VRATKA_RE = /^vratka\s*pal/i;

export async function parsePricelistFile(arrayBuffer) {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Subor neobsahuje ziadny hárok.");
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (!rows.length) throw new Error("Subor je prazdny.");

  const header = rows[0];
  const buckets = [];
  for (let i = 1; i < header.length; i++) {
    const label = String(header[i] || "").trim();
    const m = label.match(BUCKET_RE);
    if (m) buckets.push({ label, min: parseInt(m[1], 10), max: parseInt(m[2], 10), col: i });
  }
  if (!buckets.length) {
    throw new Error("Nepodarilo sa najst stlpce s rozsahmi paletovych miest (napr. '1-2pal') v prvom riadku.");
  }

  const cities = {};
  let vratkaPal = null;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const label = String(row[0] || "").trim();
    if (!label) continue;
    const values = buckets.map((b) => {
      const raw = row[b.col];
      if (raw === "" || raw === null || raw === undefined) return null;
      const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(",", "."));
      return isNaN(n) ? null : n;
    });
    if (VRATKA_RE.test(label)) {
      vratkaPal = values;
    } else {
      cities[label.toUpperCase()] = values;
    }
  }

  if (!Object.keys(cities).length) {
    throw new Error("V subore sa nenasli ziadne riadky s mestami.");
  }

  return {
    buckets: buckets.map(({ label, min, max }) => ({ label, min, max })),
    cities,
    vratkaPal: vratkaPal || buckets.map(() => 0),
  };
}

export function computeTransportPriceForCity(cityRaw, pocetPaletovychMiest, paletyZpat, pricelist) {
  if (!pricelist || !pricelist.buckets || !pricelist.buckets.length) {
    return { matched: false, reason: "Cennik doprav nie je nahraty." };
  }
  const count = parseInt(String(pocetPaletovychMiest || "").replace(/[^\d]/g, ""), 10);
  if (isNaN(count)) {
    return { matched: false, reason: "Zadajte pocet paletovych miest." };
  }
  const bucketIndex = pricelist.buckets.findIndex((b) => count >= b.min && count <= b.max);
  if (bucketIndex === -1) {
    return { matched: false, reason: `Pocet paletovych miest (${count}) je mimo rozsahu cennika.` };
  }
  const bucket = pricelist.buckets[bucketIndex];
  const city = String(cityRaw || "").trim().toUpperCase();
  const cityPrices = city ? pricelist.cities[city] : null;
  const basePrice = cityPrices ? cityPrices[bucketIndex] : null;
  if (basePrice === null || basePrice === undefined) {
    return { matched: false, reason: `Mesto "${city || "?"}" nenajdene v cenniku pre rozsah ${bucket.label}.`, city, bucketLabel: bucket.label };
  }
  const surcharge = paletyZpat ? (pricelist.vratkaPal[bucketIndex] || 0) : 0;
  return {
    matched: true,
    city,
    bucketLabel: bucket.label,
    basePrice,
    surcharge,
    total: basePrice + surcharge,
  };
}

export function computeTransportPrice(order, pricelist, extractCityFromAddress) {
  const city = extractCityFromAddress(order.adresaDodania);
  return computeTransportPriceForCity(city, order.pocetPaletovychMiest, order.paletyZpat, pricelist);
}

export function formatEur(n) {
  return n.toFixed(2).replace(".", ",") + " €";
}
