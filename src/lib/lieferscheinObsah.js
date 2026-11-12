// Riadok pod nazvom produktu na dodacom liste: gramaz, kusy v kartone,
// kartony na palete (z karty Produktu) + volitelny text "Obsah baleni (inhlt)".
// Napr. "200 g · 15 Stk/KRT · 16 KRT/PAL".
// Nazov suboru dodaku: "60879-1611 BOTTROP" (cislo dodaku + mesto velkymi).
export function nazovSuboruDodaku(cisloDodaku, mesto) {
  const c = String(cisloDodaku || "").replace(/[\\/]/g, "-").replace(/[<>:"|?*]/g, "").trim();
  const m = String(mesto || "").toUpperCase().replace(/[\\/<>:"|?*]+/g, " ").replace(/\s+/g, " ").trim();
  return [c, m].filter(Boolean).join(" ") || "Lieferschein";
}

function cislo(v) {
  return String(v ?? "").trim();
}

export function obsahBalenia(p) {
  if (!p) return "";
  const g = cislo(p.gramaz);
  const ks = cislo(p.ksVKartone);
  const kpp = cislo(p.kartonovNaPalete);
  const casti = [
    g ? (/^\d+([.,]\d+)?$/.test(g) ? `${g} g` : g) : "",
    ks ? `${ks} Stk/KRT` : "",
    kpp ? `${kpp} KRT/PAL` : "",
  ].filter(Boolean);
  return [casti.join(" · "), cislo(p.inhlt)].filter(Boolean).join("\n");
}
