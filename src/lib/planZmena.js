// Zdielana logika pre oznacenie a zobrazenie toho, co konkretne office naposledy
// zmenil vo vyrobnom plane (napr. "Mnozstvi: 30 -> 32 paliet"), aby to Vyroba/Sklad
// videli konkretne, nielen ze "neco se zmenilo". Pouziva sa v App.jsx (Office),
// VyrobaView.jsx aj SkladView.jsx.

export const PLAN_ZMENA_POLIA = ["datum", "linka", "produktNazov", "mnozstvo", "mnozstvoJednotka", "terminDodania", "poznamka"];

const POLE_LABEL = {
  datum: "Datum",
  linka: "Linka",
  produktNazov: "Produkt",
  terminDodania: "Termín dodání",
  poznamka: "Poznámka",
};

// current = puvodni zaznam pred upravou, patch = nove hodnoty (cely zaznam alebo jen zmenene polia).
// linkaLabel(value) je volitelna funkcia na prevod kodu linky na citatelny popisok.
export function diffProductionPlanFields(current, patch, linkaLabel) {
  const zmenene = PLAN_ZMENA_POLIA.filter((key) => String(current[key] ?? "") !== String(patch[key] ?? current[key] ?? ""));
  if (!zmenene.length) return { zmenene: [], detail: [] };

  const detail = [];
  const handled = new Set();
  if (zmenene.includes("mnozstvo") || zmenene.includes("mnozstvoJednotka")) {
    detail.push({
      pole: "mnozstvo",
      label: "Množství",
      stara: `${current.mnozstvo ?? ""} ${current.mnozstvoJednotka ?? ""}`.trim(),
      nova: `${patch.mnozstvo ?? current.mnozstvo ?? ""} ${patch.mnozstvoJednotka ?? current.mnozstvoJednotka ?? ""}`.trim(),
    });
    handled.add("mnozstvo");
    handled.add("mnozstvoJednotka");
  }
  zmenene.forEach((key) => {
    if (handled.has(key)) return;
    const staraRaw = current[key] ?? "";
    const novaRaw = patch[key] ?? current[key] ?? "";
    detail.push({
      pole: key,
      label: POLE_LABEL[key] || key,
      stara: key === "linka" && linkaLabel ? linkaLabel(staraRaw) : staraRaw,
      nova: key === "linka" && linkaLabel ? linkaLabel(novaRaw) : novaRaw,
    });
  });
  return { zmenene, detail };
}

export function isPlanZmenaActive(row) {
  return !!(row.zmenenePolia && row.zmenenePolia.length && row.zmeneneKedy && Date.now() - new Date(row.zmeneneKedy).getTime() < 24 * 60 * 60 * 1000);
}

// Jeden riadok textu na zobrazenie priamo v appke (nie len v title/tooltipe, aby to
// bolo vidiet aj na dotykovom tablete, kde hover nefunguje).
export function formatZmenaText(row) {
  if (!isPlanZmenaActive(row) || !row.zmenyDetail || !row.zmenyDetail.length) return "";
  return row.zmenyDetail.map((d) => `${d.label}: ${d.stara || "—"} → ${d.nova || "—"}`).join(" · ");
}
