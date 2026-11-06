// Pokyny k lekarskej prehliadke (vstupna / periodicka) - informativny list
// pre zamestnanca, tlaci sa a dava pred navstevou lekara. Kontakt na lekara
// je v hr_nastaveni (key "lekar_kontakt"), personalistka ho upravuje sama.

export const NASTAVENI_LEKAR = "lekar_kontakt";

export const KONTAKT_POLE = [
  { key: "volat", label: "Komu zavolat (ve tvaru „Zavolejte …“)", placeholder: "paní MUDr. Novákové" },
  { key: "telefon", label: "Telefon", placeholder: "318 000 000" },
  { key: "ordinace", label: "Ordinace (kde)", placeholder: "ordinace v Poliklinice …, 1. patro" },
];

export const POKYNY_TYPY = {
  vstupni: {
    nazev: "Pokyny ke vstupní lékařské prohlídce",
    podtitul: "Pro nově nastupující zaměstnance",
    uvod: "děkujeme, že jste si vybrali naši společnost Stenger Czech s.r.o. Prosíme Vás o zajištění níže uvedených úkonů a dokumentů potřebných k nástupu do zaměstnání.",
    prohlidka: "VSTUPNÍ PROHLÍDKU",
  },
  periodicka: {
    nazev: "Pokyny k periodické lékařské prohlídce",
    podtitul: "Pro stávající zaměstnance",
    uvod: "rádi bychom Vás informovali, že je nutné absolvovat periodickou lékařskou prohlídku, která je nezbytnou součástí pracovního poměru. Děkujeme za její včasné vyřízení.",
    prohlidka: "PERIODICKOU PROHLÍDKU",
  },
};

export function kontaktChyby(kontakt) {
  return KONTAKT_POLE.filter((p) => !String(kontakt?.[p.key] || "").trim()).map((p) => p.label.replace(/ \(.*$/, ""));
}

// Kroky ako segmenty textu: { t, b } (b = tucne). Polozka `odrazky` = zoznam pod krokom.
export function pokynyKroky(typ, kontakt) {
  const T = POKYNY_TYPY[typ];
  if (!T) throw new Error(`Neznámý typ pokynů: ${typ}`);
  const k = (key) => String(kontakt?.[key] || "").trim();
  return [
    [{ t: "Požádejte svého praktického lékaře o vystavení " }, { t: "VÝPISU ZE ZDRAVOTNÍ KARTY", b: true }, { t: ". Poplatek za výpis Vám proplatíme." }],
    [{ t: "Na vše, co zaplatíte, si vyžádejte účtenku – tyto platby Vám uhradíme." }],
    [{ t: "Zavolejte " }, { t: k("volat"), b: true }, { t: ", tel. " }, { t: k("telefon"), b: true }, { t: `, ${k("ordinace")}, a objednejte se na ` },
      { t: T.prohlidka, b: true }, { t: "." }],
    Object.assign([{ t: "Na prohlídku si s sebou vezměte:" }], {
      odrazky: [
        [{ t: "formulář " }, { t: "LÉKAŘSKÝ POSUDEK O ZDRAVOTNÍ ZPŮSOBILOSTI K PRÁCI", b: true }, { t: " (obdržíte od nás)" }],
        [{ t: "výpis ze zdravotní karty (viz bod 1)" }],
        [{ t: "vzorek ranní moči" }],
      ],
    }),
    [{ t: "Potvrzený posudek a účtenky přineste prosím do kanceláře." }],
  ];
}

// "Vstupní" -> vstupni, "Periodická" -> periodicka, inak null.
export function pokynyTypZPrehliadky(examType) {
  const s = String(examType || "").toLowerCase();
  if (s.startsWith("vstup")) return "vstupni";
  if (s.startsWith("period")) return "periodicka";
  return null;
}
