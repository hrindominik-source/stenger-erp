// Mzdy - podklad pre uctovnicku podla doterajsieho rucneho postupu (tabulka
// "MZDA" kolegu). Nie je to zakonny mzdovy vypocet: zakladnu mzdu z fondu
// pocita uctovnicka, tu sa pocita len suma, ktora sa jej nadiktuje ako premie
// (nadcas + priplatky + upratovanie + premia). Sadzby su v Legende (meni sa
// v appke, platnost od mesiaca), nic tu nie je natvrdo okrem struktury.
import { isPublicHoliday, computeDayHours, zaciatkyZmeny, pauzyNaOdpocet } from "./dochadzka.js";
import { parseSkDate } from "./utils.js";

// Skupiny pracovnikov - kazda ma vlastne sadzby v Legende.
export const MZDY_SKUPINY = [
  { value: "hrncova", label: "Hrncová" },
  { value: "pozicia3", label: "Pozice 3" },
  { value: "ostatne", label: "Ostatní (výroba)" },
  { value: "skusobna", label: "Zkušební doba" },
  { value: "skladnik", label: "Skladník" },
];

// Polozky Legendy na skupinu (kluc, popis, jednotka).
export const MZDY_POLOZKY_SKUPINY = [
  { key: "hodinovka", label: "Hodinová sazba", jednotka: "Kč/hod" },
  { key: "priplatokHod", label: "Příplatek za každou hodinu (denní i noční)", jednotka: "Kč/hod" },
  { key: "priplatokVikend", label: "Příplatek navíc za víkendovou hodinu", jednotka: "Kč/hod" },
  { key: "zaSmenu", label: "Příplatek za každou směnu", jednotka: "Kč/směna" },
  { key: "uklid", label: "Úklid", jednotka: "Kč/úklid" },
  { key: "premia", label: "Prémie (při plném fondu)", jednotka: "Kč/měsíc" },
  { key: "mesacnyPriplatok", label: "Měsíční příplatek (např. pozice 3)", jednotka: "Kč/měsíc" },
];

// Spolocne polozky Legendy.
export const MZDY_POLOZKY_SPOLOCNE = [
  { key: "koefNadcas", label: "Koeficient přesčasu", jednotka: "×" },
  { key: "hodinNaDen", label: "Hodin na den (fond)", jednotka: "hod" },
];

// Legenda podla zadania (10/2026). Hodnoty sa menia v appke.
export const MZDY_LEGENDA_VYCHODZIA = {
  spolocne: { koefNadcas: 1.25, hodinNaDen: 8 },
  skupiny: {
    hrncova: { hodinovka: 165, priplatokHod: 30, priplatokVikend: 0, zaSmenu: 100, uklid: 500, premia: 6000, mesacnyPriplatok: 0 },
    pozicia3: { hodinovka: 165, priplatokHod: 0, priplatokVikend: 0, zaSmenu: 0, uklid: 350, premia: 4500, mesacnyPriplatok: 500 },
    ostatne: { hodinovka: 165, priplatokHod: 0, priplatokVikend: 0, zaSmenu: 0, uklid: 350, premia: 4500, mesacnyPriplatok: 0 },
    skusobna: { hodinovka: 155, priplatokHod: 0, priplatokVikend: 0, zaSmenu: 0, uklid: 350, premia: 0, mesacnyPriplatok: 0 },
    skladnik: { hodinovka: 220, priplatokHod: 0, priplatokVikend: 0, zaSmenu: 0, uklid: 0, premia: 2500, mesacnyPriplatok: 0 },
  },
};

// Legenda platna pre mesiac: posledna verzia s platnostOd <= mesiac ("RRRR-MM").
export function legendaPreMesiac(verzie, mesiac) {
  const platne = (verzie || []).filter((v) => v && v.platnostOd && v.platnostOd <= mesiac).sort((a, b) => b.platnostOd.localeCompare(a.platnostOd));
  const v = platne[0];
  if (!v) return MZDY_LEGENDA_VYCHODZIA;
  return {
    spolocne: { ...MZDY_LEGENDA_VYCHODZIA.spolocne, ...(v.data && v.data.spolocne) },
    skupiny: Object.fromEntries(MZDY_SKUPINY.map((s) => [s.value, { ...MZDY_LEGENDA_VYCHODZIA.skupiny[s.value], ...(v.data && v.data.skupiny && v.data.skupiny[s.value]) }])),
  };
}

// Zaokruhlenie minut ako kolega: do 29 min nadol, od 30 min nahor (cele hodiny).
export function zaokruhliHodiny(minuty) {
  const m = Math.max(0, Math.round(Number(minuty) || 0));
  const h = Math.floor(m / 60);
  return m % 60 >= 30 ? h + 1 : h;
}

// Pracovne dni v mesiaci (po-pi bez statnych sviatkov). mesiac = "RRRR-MM".
export function pracovneDni(mesiac) {
  const [r, m] = String(mesiac).split("-").map(Number);
  if (!r || !m) return 0;
  let n = 0;
  for (let d = new Date(r, m - 1, 1); d.getMonth() === m - 1; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6 && !isPublicHoliday(d)) n++;
  }
  return n;
}

// Nocna zmena = cela zmena sa pocita ako nocna (kolega: 17:55-06:00), podla
// zaciatku zmeny: od 14:00 do 03:59 je to nocna zmena.
export function jeNocnaZmena(casZaciatku) {
  const h = Number(String(casZaciatku || "").split(":")[0]);
  if (Number.isNaN(h)) return false;
  return h >= 14 || h < 4;
}

const cislo = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const zaok2 = (n) => Math.round(n * 100) / 100;

// Vypocet za jedneho pracovnika a mesiac.
// dochadzka (z appky, v minutach): { denneMin, nocneMin, vikendMin, zmeny }
// vstup (rucne, kazde pole moze prepisat navrh appky):
//   { dovolenkaDni, uklidy, fond, korekciaHod, hodinyCelkem, hodinyDenne, hodinyNocne, hodinyVikend,
//     zmeny, premia, mesacnyPriplatok, pohyblivaPremia, mimoriadnaPremia, sadzbaUklid, premiaZaklad }
export function vypocitajMzdu({ skupina, mesiac, legenda, dochadzka = {}, vstup = {} }) {
  const sp = legenda.spolocne;
  const s = legenda.skupiny[skupina] || legenda.skupiny.ostatne;
  const pd = pracovneDni(mesiac);
  const plnyFond = pd * sp.hodinNaDen;
  const dovolenkaDni = cislo(vstup.dovolenkaDni) || 0;

  const navrhDenne = zaokruhliHodiny(dochadzka.denneMin);
  const navrhNocne = zaokruhliHodiny(dochadzka.nocneMin);
  const hodinyDenne = cislo(vstup.hodinyDenne) ?? navrhDenne;
  const hodinyNocne = cislo(vstup.hodinyNocne) ?? navrhNocne;
  const hodinyVikend = cislo(vstup.hodinyVikend) ?? zaokruhliHodiny(dochadzka.vikendMin);
  const navrhCelkem = zaokruhliHodiny((dochadzka.denneMin || 0) + (dochadzka.nocneMin || 0));
  const korekciaHod = cislo(vstup.korekciaHod) || 0;
  const hodinyCelkem = (cislo(vstup.hodinyCelkem) ?? navrhCelkem) + korekciaHod;
  const zmeny = cislo(vstup.zmeny) ?? (dochadzka.zmeny || 0);
  const uklidy = cislo(vstup.uklidy) || 0;

  const navrhFond = Math.max(0, (pd - dovolenkaDni) * sp.hodinNaDen);
  const fond = cislo(vstup.fond) ?? navrhFond;
  const podiel = plnyFond > 0 ? Math.min(1, Math.max(0, fond / plnyFond)) : 0;

  const nadcasHod = Math.max(0, hodinyCelkem - fond);
  const nadcasKc = zaok2(nadcasHod * s.hodinovka * sp.koefNadcas);
  const priplatokHodKc = zaok2((hodinyDenne + hodinyNocne) * s.priplatokHod);
  const priplatokVikendKc = zaok2(hodinyVikend * s.priplatokVikend);
  const smenyKc = zaok2(zmeny * s.zaSmenu);
  // Zastup (napr. pozicia 3 obcas na hrnci): ina sadzba uklidu / zaklad premie
  // len na dany mesiac, ostatne sadzby zostavaju podla skupiny.
  const sadzbaUklid = cislo(vstup.sadzbaUklid) ?? s.uklid;
  const premiaZaklad = cislo(vstup.premiaZaklad) ?? s.premia;
  const uklidKc = zaok2(uklidy * sadzbaUklid);
  const navrhPremia = Math.round(premiaZaklad * podiel);
  const premia = cislo(vstup.premia) ?? navrhPremia;
  const navrhMesacny = Math.round(s.mesacnyPriplatok * podiel);
  const mesacnyPriplatok = cislo(vstup.mesacnyPriplatok) ?? navrhMesacny;
  const pohyblivaPremia = cislo(vstup.pohyblivaPremia) || 0;
  const mimoriadnaPremia = cislo(vstup.mimoriadnaPremia) || 0;

  const celkem = zaok2(nadcasKc + priplatokHodKc + priplatokVikendKc + smenyKc + uklidKc + premia + mesacnyPriplatok + pohyblivaPremia + mimoriadnaPremia);
  return {
    skupina, hodinovka: s.hodinovka, sadzbaUklid, premiaZaklad, pracovneDni: pd, plnyFond, dovolenkaDni,
    hodinyCelkem, hodinyDenne, hodinyNocne, hodinyVikend, korekciaHod, zmeny, uklidy,
    navrhFond, fond, nadcasHod, nadcasKc, priplatokHodKc, priplatokVikendKc, smenyKc, uklidKc,
    navrhPremia, premia, navrhMesacny, mesacnyPriplatok, pohyblivaPremia, mimoriadnaPremia, celkem,
  };
}

// Suhrn dochadzky pre mzdy z dennych zaznamov: kazda zmena cela ako denna
// alebo nocna (podla zaciatku), vikend = denne minuty v sobotu/nedelu.
// zaznamy: [{ datum: Date, casZaciatku, minuty }]
export function dochadzkaPreMzdy(zaznamy) {
  return (zaznamy || []).reduce((acc, z) => {
    const min = Number(z.minuty) || 0;
    if (min <= 0) return acc;
    const noc = jeNocnaZmena(z.casZaciatku);
    const dow = z.datum instanceof Date ? z.datum.getDay() : -1;
    return {
      denneMin: acc.denneMin + (noc ? 0 : min),
      nocneMin: acc.nocneMin + (noc ? min : 0),
      vikendMin: acc.vikendMin + (!noc && (dow === 0 || dow === 6) ? min : 0),
      zmeny: acc.zmeny + 1,
    };
  }, { denneMin: 0, nocneMin: 0, vikendMin: 0, zmeny: 0 });
}

// Dochadzka mesiaca -> suhrn pre mzdy po pracovnikoch. Minuty zmeny su ako
// v mesacnom prehlade dochadzky (zarovnanie na zaciatok zmeny, platene
// prestavky), denna/nocna podla skutocneho prichodu. Zaznamy bez odchodu
// sa nepocitaju (pocet je v nedokoncene).
// prestavky: zaznamy prichod/odchod za mesiac, workersByMeno: { meno: { typ } }
export function dochadzkaMesiacaPreMzdy(prestavky, pauzy, workersByMeno, nastavenia) {
  const pauzyOdpocet = pauzyNaOdpocet(pauzy, nastavenia);
  const poMenach = {};
  for (const p of prestavky || []) {
    if (!poMenach[p.meno]) poMenach[p.meno] = { zaznamy: [], nedokoncene: 0 };
    if (!p.casKonca) { poMenach[p.meno].nedokoncene++; continue; }
    const typ = workersByMeno && workersByMeno[p.meno] ? workersByMeno[p.meno].typ : null;
    const h = computeDayHours(p, pauzyOdpocet, zaciatkyZmeny(typ, nastavenia));
    if (!h) { poMenach[p.meno].nedokoncene++; continue; }
    poMenach[p.meno].zaznamy.push({ datum: parseSkDate(p.datum), casZaciatku: p.casZaciatku, minuty: h.totalMin });
  }
  return Object.fromEntries(Object.entries(poMenach).map(([meno, v]) => [meno, { ...dochadzkaPreMzdy(v.zaznamy), nedokoncene: v.nedokoncene }]));
}

// Predvolena skupina: ulozena pri pracovnikovi, inak podla typu (sklad -> skladnik).
export function skupinaPracovnika(meno, mzdyPracovnici, workersByMeno, mesacne) {
  if (mesacne && mesacne.skupina) return mesacne.skupina;
  const ulozena = mzdyPracovnici && mzdyPracovnici[meno] && mzdyPracovnici[meno].skupina;
  if (ulozena) return ulozena;
  return workersByMeno && workersByMeno[meno] && workersByMeno[meno].typ === "sklad" ? "skladnik" : "ostatne";
}
