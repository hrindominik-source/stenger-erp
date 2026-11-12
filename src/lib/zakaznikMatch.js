// Parovanie zakaznika z AI extrakcie objednavky so zoznamom zakaznikov.
// AI niekedy vrati adresata (nasu firmu) namiesto odosielatela objednavky,
// alebo nazov v inom tvare ("Stenger Waffeln GmbH" vs "STENGER WAFFELN GMBH,").

const PRAVNE_FORMY = /\b(gmbh|co\s*kg|kg|ag|s\s*r\s*o|spol|a\s*s|b\s*v|ltd|inc|mbh|ug|ohg|se)\b/g;

export function normNazovFirmy(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(PRAVNE_FORMY, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Je to nasa vlastna firma (adresat objednavky), nie zakaznik?
export function jeNasaFirma(nazov, nasaFirma) {
  const a = normNazovFirmy(nazov);
  const b = normNazovFirmy(nasaFirma);
  return !!a && !!b && a === b;
}

// Doplnok k instrukciam pre AI: kto je zakaznik a vyber zo zoznamu zakaznikov.
export function zakaznikInstrukcie(nasaFirma, customers) {
  const zoznam = (customers || []).map((c) => c && c.nazov).filter((n) => n && !jeNasaFirma(n, nasaFirma));
  return `
DOLEZITE - KTO JE ZAKAZNIK:
- "${nasaFirma}" je NASA firma - prijemca/adresat objednavky a dodavatel tovaru. NIKDY ju neuvadzaj ako zakaznika, ani ked je jej adresa v okienku adresata.
- Zakaznik je ODOSIELATEL objednavky: firma v hlavicke/logu alebo v malom riadku odosielatela nad adresou adresata (napr. "Stenger Waffeln GmbH - Nikolaus-Otto-Str. 12 - D-56727 Mayen" -> zakaznik "Stenger Waffeln GmbH").
- Do JSON pridaj este dve polia:
  "odosielatel": "nazov firmy odosielatela presne ako v dokumente (bez adresy)",
  "zakaznikZoZoznamu": "PRESNE jeden nazov z tohto zoznamu, ktory zodpoveda odosielatelovi, alebo prazdny retazec ak ziadny nesedi"
- Zoznam zakaznikov:
${zoznam.map((n) => `  - ${n}`).join("\n") || "  (prazdny)"}`;
}

// Najde zakaznika: presna zhoda, potom zhoda po normalizacii (bez pravnej
// formy, diakritiky, interpunkcie). Nasu firmu nikdy nevrati.
export function najdiZakaznika(customers, nazov, nasaFirma) {
  const list = (customers || []).filter((c) => c && c.nazov && !jeNasaFirma(c.nazov, nasaFirma));
  if (!nazov || jeNasaFirma(nazov, nasaFirma)) return null;
  const presne = list.find((c) => c.nazov.trim().toLowerCase() === String(nazov).trim().toLowerCase());
  if (presne) return presne;
  const n = normNazovFirmy(nazov);
  if (!n) return null;
  const zhody = list.filter((c) => normNazovFirmy(c.nazov) === n);
  return zhody.length === 1 ? zhody[0] : null;
}
