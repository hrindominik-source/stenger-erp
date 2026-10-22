// Citatelne nazvy ulozenych HR dokumentu: "Název – Příjmení Jméno – d.m.rrrr.ext".
// V uložisku zostava technicka cesta (UUID - jedinecna, bez diakritiky);
// tento nazov sa zobrazuje a pouziva pri stahovani.

// Popisky v kartach typu "Rodný list (PDF / sken)" -> "Rodný list".
export function cleanDocLabel(label) {
  return String(label || "")
    .replace(/\s*[–-]?\s*\(?\s*PDF(\s*\/\s*sken)?\s*\)?\s*$/i, "")
    .replace(/\s*\(sken[^)]*\)\s*$/i, "")
    .trim();
}

const czDate = (iso) => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
};

export function fileExt(pathOrName) {
  return (String(pathOrName || "").match(/\.([a-z0-9]{1,5})$/i)?.[1] || "").toLowerCase();
}

export function hrFileName(nazev, employee, date, ext) {
  const jmeno = [employee?.last_name, employee?.first_name].filter(Boolean).join(" ");
  const base = [cleanDocLabel(nazev) || "Dokument", jmeno, czDate(date)].filter(Boolean).join(" – ")
    .replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  const e = String(ext || "").replace(/^\./, "");
  return e ? `${base}.${e}` : base;
}
