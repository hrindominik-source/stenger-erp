// Nazvy krajin v adresach po nemecky - adresy v appke byvaju zadane aj po
// slovensky/cesky ("Nemecko", "Německo"), ale nemecke doklady (Lieferschein)
// maju mat krajinu po nemecky. Nahradza sa len samostatny usek adresy
// (riadok alebo cast oddelena ciarkou), ktory je cely nazvom krajiny -
// nazvy ulic/miest s podobnym slovom ostavaju nedotknute.
const KRAJINY_DE = [
  [/^(nemecko|německo|germany|deutschland|bundesrepublik deutschland|brd)$/i, "Deutschland"],
  [/^(česko|cesko|česká republika|ceska republika|czech republic|czechia|tschechien|tschechische republik)$/i, "Tschechien"],
  [/^(slovensko|slovenská republika|slovenska republika|slovakia|slowakei)$/i, "Slowakei"],
  [/^(rakúsko|rakusko|rakousko|austria|österreich|osterreich)$/i, "Österreich"],
  [/^(holandsko|nizozemsko|netherlands|niederlande|holland)$/i, "Niederlande"],
  [/^(poľsko|polsko|poland|polen)$/i, "Polen"],
  [/^(francúzsko|francuzsko|francie|france|frankreich)$/i, "Frankreich"],
  [/^(belgicko|belgie|belgium|belgien)$/i, "Belgien"],
  [/^(maďarsko|madarsko|hungary|ungarn)$/i, "Ungarn"],
  [/^(taliansko|itálie|italie|italy|italien)$/i, "Italien"],
  [/^(švajčiarsko|svajciarsko|švýcarsko|svycarsko|switzerland|schweiz)$/i, "Schweiz"],
  [/^(dánsko|dansko|denmark|dänemark)$/i, "Dänemark"],
  [/^(luxembursko|lucembursko|luxembourg|luxemburg)$/i, "Luxemburg"],
];

// Vrati nemecky nazov krajiny, alebo null ak text nie je (znamy) nazov krajiny.
export function krajinaNemecky(text) {
  const k = String(text || "").trim();
  if (!k) return null;
  const hit = KRAJINY_DE.find(([re]) => re.test(k));
  return hit ? hit[1] : null;
}

// Prelozi nazvy krajin v adrese, oddelovace (novy riadok, ciarky) zachova.
export function adresaPoNemecky(adresa) {
  if (adresa === null || adresa === undefined) return adresa;
  return String(adresa).replace(/[^,\n]+/g, (usek) => {
    const de = krajinaNemecky(usek);
    if (!de) return usek;
    const lead = usek.match(/^\s*/)[0];
    const trail = usek.match(/\s*$/)[0];
    return lead + de + trail;
  });
}
