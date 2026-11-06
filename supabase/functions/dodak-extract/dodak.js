// Citanie dodacieho listu (fotka alebo PDF) cez Claude a uprava vysledku do tvaru
// pre prijem tovaru. Pouziva Edge Function dodak-extract aj testy (bez Deno API).

export const DODAK_INSTRUCTIONS = `Si asistent skladu potravinarskej vyroby. Dostanes fotku alebo PDF dodacieho listu (dodací list / Lieferschein / delivery note / bill of lading) od dodavatela suroviny alebo obalu. Dokument moze mat viac stran, strany mozu byt otocene alebo v inom poradi a moze obsahovat prilohu so zoznamom paliet (napr. "NVE List", stlpec SSCC). Precitaj vsetky strany.
Odpovedz VYLUCNE JSON objektom v tomto tvare (bez markdown, bez vysvetlenia):
{
  "jeDodak": true,
  "dodavatel": "nazov firmy dodavatela (odosielatela tovaru)",
  "dodavatelNas": "presne jeden nazov zo zoznamu NASI DODAVATELIA nizsie, ktory je ta ista firma, inak prazdny retazec",
  "cisloDokladu": "cislo dodacieho listu",
  "datum": "datum dodacieho listu DD.MM.RRRR alebo prazdny retazec",
  "cisloObjednavky": "nase cislo objednavky, ak je jedno pre cely doklad (napr. 'Your reference', 'Your order no', 'Číslo objednávky', 'objednací číslo', 'Číslo obj. zákazníka'), inak prazdny retazec",
  "polozky": [
    {
      "nazov": "nazov produktu presne ako na doklade",
      "materialNas": "presne jeden nazov zo zoznamu NASE MATERIALY nizsie, ktory zodpoveda tomuto produktu, inak prazdny retazec",
      "mnozstvo": 0,
      "jednotka": "kg | ks | l | m | t",
      "cisloObjednavky": "nase cislo objednavky pre tuto polozku, ak je pri nej uvedene, inak prazdny retazec",
      "pocetPaliet": 0,
      "sarze": [{ "sarza": "cislo sarze (Šarže / Charge / Lot / Batch)", "dmt": "DD.MM.RRRR", "datumVyroby": "DD.MM.RRRR" }],
      "palety": [{ "sscc": "SSCC alebo NVE cislo palety (len cislice)", "sarza": "sarza tejto palety" }]
    }
  ]
}
Pravidla:
- Jeden produkt = jedna polozka. Ak je ten isty produkt vo viacerych riadkoch (napr. riadok na kazdu paletu alebo druhy riadok s neuplnou paletou), spoj ich: mnozstvo a pocetPaliet scitaj, sarze a palety zluc. Rozne produkty alebo rovnaky produkt pre rozne objednavky su samostatne polozky.
- Riadky s paletami a vratnymi obalmi (paleta EUR, Euro pallet, Paleta/víko a podobne) nie su polozky - nevracaj ich.
- mnozstvo je celkove DODANE mnozstvo polozky (nie objednane, nie na jednu paletu). Pri surovinach uprednostni netto hmotnost v kg alebo t; pri obaloch pocet kusov.
- sarze: kazda sarza polozky raz, s DMT (MHD, BBD, best before, shelf life exp. date, datum trvanlivosti, spotřebujte do) a datumom vyroby, ak su uvedene. Ak sarza nie je uvedena, prazdne pole.
- palety: len ak doklad uvadza cisla jednotlivych paliet (SSCC, NVE). Inak prazdne pole.
- pocetPaliet je pocet paliet polozky, ak je uvedeny alebo ho mozno spocitat zo zoznamu paliet, inak 0.
- Udaje nevymyslaj. Co na doklade nie je alebo sa neda precitat, nechaj prazdne (cislo 0).
- Datumy vzdy DD.MM.RRRR. Ak je uvedeny len mesiac a rok, pouzi posledny den mesiaca.
- Ak dokument nie je dodaci list, vrat {"jeDodak": false}.`;

export function dodakPrompt({ materialy = [], dodavatelia = [] } = {}) {
  const zoznam = (nadpis, list) => `\n\n${nadpis}:\n` + (list.length ? list.map((m) => "- " + m).join("\n") : "(prazdny)");
  return DODAK_INSTRUCTIONS + zoznam("NASE MATERIALY", materialy.slice(0, 300)) + zoznam("NASI DODAVATELIA", dodavatelia.slice(0, 200));
}

export function parseClaudeJson(text) {
  const clean = String(text || "").replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("AI nevrátila platný JSON");
  return JSON.parse(clean.slice(start, end + 1));
}

// Rozne zapisy datumu -> DD.MM.RRRR (inak prazdny retazec).
export function normalizujDatum(v) {
  const s = String(v || "").trim();
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  let d, mo, y;
  if (m) [, d, mo, y] = m;
  else if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [, y, mo, d] = m;
  else return "";
  y = y.length === 2 ? "20" + y : y;
  const dn = Number(d);
  const mn = Number(mo);
  if (mn < 1 || mn > 12 || dn < 1 || dn > new Date(Date.UTC(Number(y), mn, 0)).getUTCDate()) return "";
  return `${String(dn).padStart(2, "0")}.${String(mn).padStart(2, "0")}.${y}`;
}

function datumKluc(d) {
  const m = String(d || "").match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? m[3] + m[2] + m[1] : "";
}

const JEDNOTKY = { kg: "kg", ks: "ks", stk: "ks", st: "ks", pcs: "ks", pc: "ks", l: "l", m: "m", kartonov: "kartonov", balikov: "balikov", paliet: "paliet", t: "t" };

function cisloZ(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v || "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function normalizujSarze(p) {
  const list = Array.isArray(p.sarze) ? p.sarze : p.sarza ? [{ sarza: p.sarza, dmt: p.dmt, datumVyroby: p.datumVyroby }] : [];
  const out = new Map();
  for (const s of list) {
    const sarza = String((s && s.sarza) || "").trim();
    const dmt = normalizujDatum(s && s.dmt);
    const datumVyroby = normalizujDatum(s && s.datumVyroby);
    if (!sarza && !dmt) continue;
    const k = sarza.toLowerCase() || "dmt:" + dmt;
    const prev = out.get(k);
    out.set(k, { sarza: prev ? prev.sarza : sarza, dmt: (prev && prev.dmt) || dmt, datumVyroby: (prev && prev.datumVyroby) || datumVyroby });
  }
  return Array.from(out.values());
}

// Upravi odpoved AI: datumy, jednotky (t -> kg), materialNas/dodavatelNas len zo zoznamu.
// Polozka dostane aj suhrnne sarza (vsetky), dmt a datumVyroby (najskorsie) pre formular.
export function normalizujDodak(raw, { materialy = [], dodavatelia = [] } = {}) {
  if (!raw || raw.jeDodak === false) return { jeDodak: false, polozky: [] };
  const zoListu = (v, list) => {
    const t = String(v || "").trim().toLowerCase();
    return t ? list.find((x) => x.trim().toLowerCase() === t) || "" : "";
  };
  const polozky = (Array.isArray(raw.polozky) ? raw.polozky : []).map((p) => {
    let mnozstvo = cisloZ(p.mnozstvo);
    let jednotka = JEDNOTKY[String(p.jednotka || "").trim().toLowerCase()] || "";
    if (jednotka === "t") {
      mnozstvo = Math.round(mnozstvo * 1000 * 1000) / 1000;
      jednotka = "kg";
    }
    const sarze = normalizujSarze(p);
    const najskor = (k) => sarze.map((s) => s[k]).filter(Boolean).sort((a, b) => datumKluc(a).localeCompare(datumKluc(b)))[0] || "";
    const palety = (Array.isArray(p.palety) ? p.palety : [])
      .map((x) => ({ sscc: String((x && x.sscc) || "").replace(/\D/g, ""), sarza: String((x && x.sarza) || "").trim() }))
      .filter((x) => x.sscc);
    return {
      nazov: String(p.nazov || "").trim(),
      materialNas: zoListu(p.materialNas, materialy),
      mnozstvo: mnozstvo > 0 ? mnozstvo : null,
      jednotka,
      cisloObjednavky: String(p.cisloObjednavky || "").trim(),
      sarze,
      sarza: sarze.map((s) => s.sarza).filter(Boolean).join(", "),
      dmt: najskor("dmt"),
      datumVyroby: najskor("datumVyroby"),
      palety,
      pocetPaliet: Math.max(0, Math.round(cisloZ(p.pocetPaliet))) || palety.length,
    };
  });
  return {
    jeDodak: true,
    dodavatel: String(raw.dodavatel || "").trim(),
    dodavatelNas: zoListu(raw.dodavatelNas, dodavatelia),
    cisloDokladu: String(raw.cisloDokladu || "").trim(),
    datum: normalizujDatum(raw.datum),
    cisloObjednavky: String(raw.cisloObjednavky || "").trim(),
    polozky: polozky.filter((p) => p.nazov || p.mnozstvo),
  };
}

export function base64FromBytes(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}

const MEDIA = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" };
export function mediaTypePodlaCesty(path) {
  return MEDIA[String(path || "").split(".").pop().toLowerCase()] || "";
}

// Zavola Claude s dokladom a vrati normalizovany vysledok.
export async function extractDodak({ bytes, mediaType, apiKey, materialy = [], dodavatelia = [], fetchImpl = fetch }) {
  const zdroj = { type: "base64", media_type: mediaType, data: base64FromBytes(bytes) };
  const blok = mediaType === "application/pdf" ? { type: "document", source: zdroj } : { type: "image", source: zdroj };
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    // zoznam paliet (napr. 28 riadkov so SSCC) potrebuje dlhsiu odpoved; funkcia ma limit 150 s
    signal: AbortSignal.timeout(110_000),
    body: JSON.stringify({
      model: "claude-sonnet-5-5",
      max_tokens: 8000,
      messages: [{ role: "user", content: [blok, { type: "text", text: dodakPrompt({ materialy, dodavatelia }) }] }],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error("AI chyba (" + res.status + "). " + t.slice(0, 200));
  }
  const data = await res.json();
  if (data.stop_reason === "max_tokens") throw new Error("Doklad je příliš dlouhý, AI ho nedočetla.");
  return normalizujDodak(parseClaudeJson((data.content || []).map((b) => b.text || "").join("\n")), { materialy, dodavatelia });
}
