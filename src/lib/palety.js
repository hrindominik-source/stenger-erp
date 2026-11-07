// Palety, ktore prichadzaju s tovarom. Nase palety (EUR od dodavatela) su bezny
// material. Vratne palety (pool CHEP/LPR, vymenne EUR B) nie su nas majetok:
// eviduju sa zvlast, bez ceny, prijem pri dodavke a vydaj pri vrateni.

export const VRATNA_PREFIX = "Vratná paleta";
export const VRATENIE_DOVOD = "Vrácení palet";

export const VRATNE_PALETY = [
  { material: "Vratná paleta EUR B (Tereos)", vlastnik: "Tereos" },
  { material: "Vratná paleta CHEP mini", vlastnik: "CHEP" },
  { material: "Vratná paleta CHEP EUR", vlastnik: "CHEP" },
  { material: "Vratná paleta LPR mini", vlastnik: "LPR" },
  { material: "Vratná paleta LPR EUR", vlastnik: "LPR" },
];

export function jeVratnaPaleta(material) {
  return String(material || "").trim().toLowerCase().startsWith(VRATNA_PREFIX.toLowerCase());
}

export function vlastnikPalety(material) {
  const m = String(material || "").trim().toLowerCase();
  const p = VRATNE_PALETY.find((x) => x.material.toLowerCase() === m);
  return p ? p.vlastnik : "";
}

// Volby pri prijme: nase palety z katalogov (nazov zacina "Paleta") + vratne.
export function volbyPaliet(materialy) {
  const nase = (materialy || []).filter((m) => /^paleta\b/i.test(String(m).trim()) && !jeVratnaPaleta(m));
  return { nase: Array.from(new Set(nase)).sort((a, b) => a.localeCompare(b)), vratne: VRATNE_PALETY.map((p) => p.material) };
}

export function rozdelStav(stock) {
  const materialy = [];
  const vratne = [];
  for (const row of stock || []) (jeVratnaPaleta(row.material) ? vratne : materialy).push(row);
  return { materialy, vratne };
}

// Riadky "palety s dodavkou" -> zaznamy prijmu. Prazdne a nulove riadky sa vynechaju,
// rovnaky typ sa scita. Vratne palety nikdy nemaju cenu.
export function prijmyPaliet(riadky, zaklad) {
  const spolu = new Map();
  for (const r of riadky || []) {
    const material = String(r.material || "").trim();
    const pocet = parseFloat(String(r.pocet || "").replace(",", "."));
    if (!material || !(pocet > 0)) continue;
    spolu.set(material, (spolu.get(material) || 0) + pocet);
  }
  return Array.from(spolu, ([material, pocet]) => {
    const vratna = jeVratnaPaleta(material);
    return {
      ...zaklad,
      material,
      mnozstvo: `${pocet} ks`,
      mnozstvoCislo: pocet,
      mnozstvoJednotka: "ks",
      sarza: "",
      dmt: "",
      palety: [],
      kontroly: [],
      kontrolyPotvrdil: "",
      dodakPolozka: null,
      paletySDodavkou: true,
      ...(vratna ? { vratnaPaleta: true, vlastnikPalety: vlastnikPalety(material) } : {}),
    };
  });
}
