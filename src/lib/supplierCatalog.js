const HEADER_ALIASES = {
  artikel: ["article", "artikel"],
  popis: ["customer reference", "nazov", "popis"],
  typLepenky: ["typ lepenky"],
  pcsPal: ["pcs/pal", "ks/pal"],
  vahaKus: ["váha/kus", "vaha/kus", "hmotnost/kus"],
};

function normalizeHeaderCell(v) {
  return String(v || "").trim().toLowerCase();
}

function findHeaderRow(rows) {
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r].map(normalizeHeaderCell);
    if (cells.includes("article")) return r;
  }
  return -1;
}

function buildColumnMap(headerRow) {
  const cells = headerRow.map(normalizeHeaderCell);
  const map = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const col = cells.findIndex((c) => aliases.includes(c));
    if (col !== -1) map[key] = col;
  }
  return map;
}

function formatBalenie(typLepenky, pcsPal, vahaKus) {
  const parts = [];
  if (typLepenky) parts.push(String(typLepenky).trim());
  if (pcsPal !== "" && pcsPal !== null && pcsPal !== undefined) parts.push(`${pcsPal} ks/paleta`);
  if (vahaKus !== "" && vahaKus !== null && vahaKus !== undefined) parts.push(`${vahaKus} kg/ks`);
  return parts.join(", ");
}

// Parses a supplier item catalog (e.g. Smurfit Westrock "oznacenie produktov" export).
// Intentionally ignores per-order columns like "pocet palet/vaha" and "vaha celkem" -
// those are order-specific quantities, not catalog master data.
export async function parseSupplierCatalogFile(arrayBuffer) {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Subor neobsahuje ziadny hárok.");
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (!rows.length) throw new Error("Subor je prazdny.");

  const headerRowIdx = findHeaderRow(rows);
  if (headerRowIdx === -1) {
    throw new Error("Nepodarilo sa najst hlavicku so stlpcom 'Article'.");
  }
  const colMap = buildColumnMap(rows[headerRowIdx]);
  if (colMap.artikel === undefined) {
    throw new Error("Nepodarilo sa najst stlpec 'Article'.");
  }

  const items = [];
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const artikel = String(row[colMap.artikel] ?? "").trim();
    if (!artikel) continue;
    const popis = colMap.popis !== undefined ? String(row[colMap.popis] ?? "").trim() : "";
    const typLepenky = colMap.typLepenky !== undefined ? row[colMap.typLepenky] : "";
    const pcsPal = colMap.pcsPal !== undefined ? row[colMap.pcsPal] : "";
    const vahaKus = colMap.vahaKus !== undefined ? row[colMap.vahaKus] : "";
    items.push({ artikel, popis, balenie: formatBalenie(typLepenky, pcsPal, vahaKus) });
  }

  if (!items.length) {
    throw new Error("V subore sa nenasli ziadne polozky s vyplnenym Article.");
  }
  return items;
}

// Legacy tovary entries can be plain strings (see normalizeTovary in App.jsx) instead
// of { popis, artikel, balenie } objects - normalize before merging so a bare string
// doesn't get spread into a char-indexed object.
function toTovaryObject(t) {
  return typeof t === "string" ? { popis: t, artikel: "", balenie: "" } : t;
}

// Merges imported catalog items into an existing tovary list, matching by "artikel".
// Existing items keep any fields the import doesn't know about; matched items get
// popis/balenie refreshed, unmatched imported items are appended.
export function mergeSupplierCatalog(existingTovary, importedItems) {
  const next = (existingTovary || []).map((t) => ({ ...toTovaryObject(t) }));
  let added = 0;
  let updated = 0;
  for (const item of importedItems) {
    const idx = next.findIndex((t) => (t.artikel || "").trim() === item.artikel);
    if (idx === -1) {
      next.push({ popis: item.popis, artikel: item.artikel, balenie: item.balenie });
      added++;
    } else {
      next[idx] = { ...next[idx], popis: item.popis, balenie: item.balenie };
      updated++;
    }
  }
  return { tovary: next, added, updated };
}
