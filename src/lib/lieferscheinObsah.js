// Dodaci list: nazov produktu s gramazou ("... Popcorn süß 200 g") a pod nim
// riadok s kusmi v kartone a kartonmi na palete (z karty Produktu) + volitelny
// text "Obsah baleni (inhlt)". Napr. "15 Stk/KRT · 16 KRT/PAL".

// Nazov suboru dodaku: "60879-1611 BOTTROP" (cislo dodaku + mesto velkymi).
export function nazovSuboruDodaku(cisloDodaku, mesto) {
  const c = String(cisloDodaku || "").replace(/[\\/]/g, "-").replace(/[<>:"|?*]/g, "").trim();
  const m = String(mesto || "").toUpperCase().replace(/[\\/<>:"|?*]+/g, " ").replace(/\s+/g, " ").trim();
  return [c, m].filter(Boolean).join(" ") || "Lieferschein";
}

function cislo(v) {
  return String(v ?? "").trim();
}

export function gramazText(p) {
  const g = cislo(p && p.gramaz);
  if (!g) return "";
  return /^\d+([.,]\d+)?$/.test(g) ? `${g} g` : g;
}

// Nazov polozky + gramaz za nim (ak uz v nazve nie je).
export function nazovSGramazou(popis, p) {
  const n = cislo(popis);
  const g = gramazText(p);
  if (!g) return n;
  const bezMedzier = (s) => s.toLowerCase().replace(/\s+/g, "");
  if (bezMedzier(n).includes(bezMedzier(g))) return n;
  return n ? `${n} ${g}` : g;
}

// Artiklove cislo bez medzier a velkosti pismen ("403 00058" = "40300058").
function normArtikel(s) {
  return String(s ?? "").replace(/\s+/g, "").toUpperCase();
}

// Produkt k polozke objednavky: najprv katalog zakaznika, potom nase SNC,
// nemecke SW alebo artiklove cislo zakaznika na karte Produktu.
export function najdiProduktPolozky(it, customer, products) {
  const a = normArtikel(it && it.artikel);
  if (!a) return null;
  const katalogItem = customer && customer.katalog ? customer.katalog.find((k) => k.artikel && normArtikel(k.artikel) === a) : null;
  if (katalogItem && katalogItem.produktId) {
    const p = (products || []).find((x) => x.id === katalogItem.produktId);
    if (p) return p;
  }
  return (products || []).find((p) => [p.cisloArtiklu, p.cisloArtikluSW, p.cisloArtikluZakaznika].some((c) => c && normArtikel(c) === a)) || null;
}

// Jazyk dodaku podla karty zakaznika: "cs" = len cesky, inak nemecky + cesky.
export function dodakJenCesky(customer) {
  return !!customer && customer.jazykDodaku === "cs";
}

// Popisok dodaku: "Nemecky / Cesky", alebo len cesky.
export function popisDodaku(cs) {
  return (de, cz) => (cs ? cz : `${de} / ${cz}`);
}

export function obsahBalenia(p, cs = false) {
  if (!p) return "";
  const ks = cislo(p.ksVKartone);
  const kpp = cislo(p.kartonovNaPalete);
  const casti = cs
    ? [ks ? `${ks} ks/kart.` : "", kpp ? `${kpp} kart./pal.` : ""].filter(Boolean)
    : [ks ? `${ks} Stk/KRT` : "", kpp ? `${kpp} KRT/PAL` : ""].filter(Boolean);
  return [casti.join(" · "), cislo(p.inhlt)].filter(Boolean).join("\n");
}
