// Generator platnych testovacich GS1 kodov palet - pre testovaci rezim PDA
// (?pda=test) a automaticke testy. Pouziva GS1 prikladovy prefix 0614141
// (nie skutocny vyrobca), takze nekoliduje s realnymi etiketami.

import { gs1CheckDigit, GS } from "./gs1.js";

export const DEMO_GTINS = [
  { gtin: "14001234000012", nazov: "Test – oplatky 48 ks" },
  { gtin: "04001234000015", nazov: "Test – oplatky 24 ks" },
];

export function randomSscc() {
  let serial = "";
  for (let i = 0; i < 9; i++) serial += Math.floor(Math.random() * 10);
  const body = "3" + "0614141" + serial;
  return body + gs1CheckDigit(body);
}

export function ssccCode(sscc) {
  return "00" + sscc;
}

// ISO datum "YYYY-MM-DD" -> YYMMDD
export function yymmdd(iso) {
  return iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);
}

// Produktovy kod ako na NVE etikete: (02) GTIN, (15) BBD, (37) pocet, GS, (10) sarza.
// Prazdne/undefined pole sa vynecha (test neuplnych etikiet).
export function produktCode({ gtin = DEMO_GTINS[0].gtin, bbd, mnozstvo, sarza } = {}) {
  let raw = "02" + gtin;
  if (bbd) raw += "15" + yymmdd(bbd);
  if (mnozstvo != null && mnozstvo !== "") raw += "37" + String(Number(mnozstvo));
  if (sarza) raw += GS + "10" + sarza;
  return raw;
}
