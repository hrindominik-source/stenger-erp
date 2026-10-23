// Za zamestnavatele podepisuji na zaklade plne moci len tieto osoby -
// zdielane s Edge Function hr-signing (podpis zamestnavatela na tablete).
export const PS_PODEPISUJICI = [
  { jmeno: "Bc. Radka Buchová", pad7: "Bc. Radkou Buchovou" },
  { jmeno: "JUDr. Dominik Hríň", pad7: "JUDr. Dominikem Hríněm" },
];

// Index podepisujiciho podle prijmeni prihlaseneho uzivatele (bez ohledu na
// diakritiku - profil muze byt "Dominik Hrin"); -1 = neni mezi nimi.
export function podepisujiciIndex(userName) {
  const surname = (n) => String(n || "").trim().split(" ").pop().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (!surname(userName)) return -1;
  return PS_PODEPISUJICI.findIndex((p) => surname(p.jmeno) === surname(userName));
}
