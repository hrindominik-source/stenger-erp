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

// ---- Palety pri expedicii a paletove konto zakaznikov ----
// Palety odchadzaju zo skladu az ked fyzicky odidu (potvrdenie expedicie).
// Zakaznik ich vrati (prijem "z expedicie"), alebo sa mu vyfakturuju / odpisu
// (vyrovnanie v kancelarii, ulozene v karte zakaznika).
export const EXPEDICE_DOVOD = "Expedice";
export const PALETA_EXPEDICE = "Paleta EUR tmavá (použitá)";
export const VYROVNANI_TYPY = [
  { id: "vyfakturovano", label: "Vyfakturováno" },
  { id: "odepsano", label: "Odepsáno" },
];

// Riadky typ+pocet -> zaznamy vydaja (stock_issues) pri expedicii.
export function vydajePalietExpedice(riadky, zaklad) {
  return prijmyPaliet(riadky, {}).map((r) => ({
    ...zaklad,
    material: r.material,
    mnozstvo: r.mnozstvo,
    mnozstvoCislo: r.mnozstvoCislo,
    mnozstvoJednotka: "ks",
    dovod: EXPEDICE_DOVOD,
    paletyExpedice: true,
  }));
}

// Riadky typ+pocet -> prijmy paliet vratenych z expedicie.
export function prijmyPalietZExpedice(riadky, zaklad) {
  return prijmyPaliet(riadky, zaklad).map(({ paletySDodavkou, ...r }) => ({ ...r, paletyZExpedice: true }));
}

function kluc(s) {
  return String(s || "").trim().toLowerCase();
}

// Paletove konto: po zakaznikoch a typoch paliet kolko odislo, vratilo sa,
// vyfakturovalo / odpisalo a kolko este zakaznik dlhuje.
export function paletoveKonto(issues, receipts, customers) {
  const map = new Map();
  function riadok(zakaznik, material) {
    const k = kluc(zakaznik);
    if (!k) return null;
    if (!map.has(k)) map.set(k, { zakaznik: String(zakaznik).trim(), palety: new Map() });
    const z = map.get(k);
    const m = String(material || "").trim();
    if (!z.palety.has(m)) z.palety.set(m, { material: m, odeslo: 0, vraceno: 0, vyfakturovano: 0, odepsano: 0 });
    return z.palety.get(m);
  }
  for (const i of issues || []) {
    if (!i.paletyExpedice) continue;
    const r = riadok(i.zakaznik, i.material);
    if (r) r.odeslo += parseFloat(i.mnozstvoCislo) || 0;
  }
  for (const p of receipts || []) {
    if (!p.paletyZExpedice) continue;
    const r = riadok(p.zakaznik, p.material);
    if (r) r.vraceno += parseFloat(p.mnozstvoCislo) || 0;
  }
  for (const c of customers || []) {
    for (const v of c.paletyVyrovnani || []) {
      const r = riadok(c.nazov, v.material);
      if (r && (v.typ === "vyfakturovano" || v.typ === "odepsano")) r[v.typ] += parseFloat(v.pocet) || 0;
    }
  }
  return Array.from(map.values())
    .map((z) => {
      const palety = Array.from(z.palety.values())
        .map((r) => ({ ...r, zbyva: r.odeslo - r.vraceno - r.vyfakturovano - r.odepsano }))
        .sort((a, b) => a.material.localeCompare(b.material));
      return { zakaznik: z.zakaznik, palety, zbyva: palety.reduce((s, r) => s + r.zbyva, 0) };
    })
    .sort((a, b) => b.zbyva - a.zbyva || a.zakaznik.localeCompare(b.zakaznik));
}
