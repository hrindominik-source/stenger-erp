import React, { useState, useEffect, useCallback, useRef, Suspense, lazy } from "react";
import { createPortal } from "react-dom";
import {
  Truck, FileText, Plus, Trash2, Pencil, X, Upload,
  Clipboard, CheckCircle2, Building2, Users, Loader2, AlertCircle,
  ClipboardList, ArrowLeft, Download, Layers, FileSignature, Printer, Package,
  LogOut, PackageCheck, PackageX, Euro, Factory, Boxes, PackagePlus, Camera,
  LayoutDashboard, Warehouse, MinusCircle, FlaskConical, ClipboardCheck, UserCheck, Menu, Mail, Calendar, FileSpreadsheet,
  Recycle, Calculator, Image, Construction, BookOpen, ListChecks
} from "lucide-react";
import { supabase } from "./supabaseClient.js";
import { useAuth } from "./lib/auth.js";
import Login from "./Login.jsx";
const SkladView = lazy(() => import("./SkladView.jsx"));
const VyrobaView = lazy(() => import("./VyrobaView.jsx"));
import { extractCityFromAddress, todayStr, uid, parseSkDate, isoFromSkDateStr, skDateStrFromIso, durationMinutes } from "./lib/utils.js";
import { parsePricelistFile, computeTransportPrice, computeTransportPriceForCity, formatEur } from "./lib/pricelist.js";
import { parseSupplierCatalogFile, mergeSupplierCatalog } from "./lib/supplierCatalog.js";
import { exportRowsToExcel, exportSheetsToExcel } from "./lib/exportExcel.js";
import { computeStockLevels, computeProductionIssues, extraKnownMaterials, suggestReceiptMatches, UNIT_QUICK_PICKS } from "./lib/inventory.js";
import { getCnbRate } from "./lib/exchangeRate.js";

const STATUS_ORDER = {
  "Prijata": "bg-slate-100 text-slate-700",
  "Spracovava sa": "bg-amber-100 text-amber-800",
  "Pripravena": "bg-blue-100 text-blue-700",
  "Odoslana": "bg-emerald-100 text-emerald-700",
};
const STATUS_TRANSPORT = {
  "Neobjednana": "bg-slate-100 text-slate-700",
  "Objednana": "bg-blue-100 text-blue-700",
  "Potvrdena": "bg-teal-100 text-teal-700",
  "Realizovana": "bg-emerald-100 text-emerald-700",
  "Vyzdvihnutie": "bg-purple-100 text-purple-700",
};
const STATUS_EXPEDICIA = {
  "Neexpedovana": "bg-slate-100 text-slate-700",
  "Expedovana": "bg-emerald-100 text-emerald-700",
};

const EMPTY_ORDER = {
  cisloObjednavky: "",
  cisloObjednavkyZakaznika: "",
  sposobDopravy: "doprava",
  datumPrijatia: "",
  zakaznikId: "",
  zakaznik: "",
  kontaktnaOsoba: "",
  zakaznikEmail: "",
  adresaNakladky: "",
  adresaDodaniaNazov: "",
  adresaDodania: "",
  datumDodania: "",
  casDodania: "",
  mercareonRef: "",
  pocetPaliet: "",
  pocetPaletovychMiest: "",
  pocetKartonov: "",
  vyskaPalety: "",
  hmotnost: "",
  paletyZpat: true,
  popisTovaru: "",
  mnozstvo: "",
  polozky: [],
  poznamka: "",
  stavExpedicie: "Neexpedovana",
};

const EMPTY_CUSTOMER = { nazov: "", adresa: "", ico: "", dic: "", email: "", katalog: [], emaily: [] };
const EMPTY_CARRIER = { nazov: "", email: "", adresa: "", ico: "", dic: "", tel: "", web: "", emaily: [] };
const EMPTY_SUPPLIER = { nazov: "", adresa: "", ico: "", dic: "", email: "", tel: "", typ: ["obal"], jazyk: "sk", tovary: [], emaily: [] };
const ULOHY_OSOBY = ["Dusan Bucha", "Radka Buchova", "Dominik Hrin"];
const EMPTY_ULOHA = { popis: "", osoby: [], termin: "", hotovo: false };
const MATERIAL_TYP_OPTIONS = [
  { value: "surovina", label: "Suroviny" },
  { value: "obal", label: "Obalovy material" },
];
// Legacy dat mohol mat "typ" ako obycajny retazec (pred zavedenim viacnasobneho vyberu).
function normalizeSupplierTyp(typ) {
  if (Array.isArray(typ)) return typ.length ? typ : ["obal"];
  if (typeof typ === "string" && typ) return [typ];
  return ["obal"];
}
const MATERIAL_JAZYK_OPTIONS = [
  { value: "sk", label: "Slovencina" },
  { value: "cz", label: "Cestina" },
  { value: "en", label: "Anglictina" },
];
const MATERIAL_ORDER_EMAIL_I18N = {
  sk: {
    dear: (name) => `Dobry den${name ? " " + name : ""},`,
    intro: (cislo) => `objednavame nasledovny tovar (objednavka c. ${cislo}):`,
    mnozstvoLabel: "Mnozstvo",
    terminLabel: "Pozadovany termin dodania",
    terminUpresneny: "bude upresneny dodavatelom",
    doplnte: "[doplnte]",
    vyzdvihneme: "Tovar si osobne vyzdvihneme.",
    adresaDodaniaLabel: "Adresa dodania",
    poznamkaLabel: "Poznamka",
    thanks: "Dakujeme a tesime sa na spolupracu.",
    regards: "S pozdravom,",
    icLabel: "IC",
    dicLabel: "DIC",
    typText: { surovina: "surovin", obal: "obaloveho materialu" },
    typFallback: "surovin/obaloveho materialu",
    and: "a",
    subject: (typ, cislo) => `Objednavka ${typ} c. ${cislo}`,
  },
  cz: {
    dear: (name) => `Dobry den${name ? " " + name : ""},`,
    intro: (cislo) => `objednavame nasledujici zbozi (objednavka c. ${cislo}):`,
    mnozstvoLabel: "Mnozstvi",
    terminLabel: "Pozadovany termin dodani",
    terminUpresneny: "bude upresnen dodavatelem",
    doplnte: "[doplnte]",
    vyzdvihneme: "Zbozi si osobne vyzvedneme.",
    adresaDodaniaLabel: "Adresa dodani",
    poznamkaLabel: "Poznamka",
    thanks: "Dekujeme a tesime se na spolupraci.",
    regards: "S pozdravem,",
    icLabel: "ICO",
    dicLabel: "DIC",
    typText: { surovina: "surovin", obal: "obaloveho materialu" },
    typFallback: "surovin/obaloveho materialu",
    and: "a",
    subject: (typ, cislo) => `Objednavka ${typ} c. ${cislo}`,
  },
  en: {
    dear: (name) => `Dear${name ? " " + name : ""},`,
    intro: (cislo) => `we are ordering the following goods (order no. ${cislo}):`,
    mnozstvoLabel: "Quantity",
    terminLabel: "Requested delivery date",
    terminUpresneny: "to be confirmed by the supplier",
    doplnte: "[please fill in]",
    vyzdvihneme: "We will collect the goods in person.",
    adresaDodaniaLabel: "Delivery address",
    poznamkaLabel: "Note",
    thanks: "Thank you, we look forward to working with you.",
    regards: "Best regards,",
    icLabel: "Company ID",
    dicLabel: "VAT ID",
    typText: { surovina: "raw materials", obal: "packaging material" },
    typFallback: "raw materials/packaging material",
    and: "and",
    subject: (typ, cislo) => `Order for ${typ} no. ${cislo}`,
  },
};
function materialTypText(typ, lang) {
  const arr = typ == null ? [] : normalizeSupplierTyp(typ);
  const parts = arr.map((t) => lang.typText[t]).filter(Boolean);
  return parts.length ? parts.join(` ${lang.and} `) : lang.typFallback;
}
function materialTypLabel(typ) {
  return normalizeSupplierTyp(typ)
    .map((t) => (MATERIAL_TYP_OPTIONS.find((o) => o.value === t) || {}).label)
    .filter(Boolean)
    .join(" + ");
}
const COMPANY_DELIVERY_ADDRESSES = ["Plynarenska 366, 261 01 Pribram I"];
const EMPTY_MATERIAL_ORDER = {
  dodavatelId: "",
  dodavatel: "",
  sposobDopravy: "doprava",
  adresaVyzdvihnutia: "",
  adresaDodaniaNazov: "",
  adresaDodania: COMPANY_DELIVERY_ADDRESSES[0],
  terminDodania: "",
  terminDodaniaNeurcity: false,
  datumVyzdvihnutia: "",
  casVyzdvihnutia: "",
  vyzdvihnutieNeurcite: false,
  popisMaterialu: "",
  mnozstvo: "",
  polozky: [],
  dopravcaId: "",
  poznamka: "",
  cisloObjednavkyDopravy: "",
  stavDopravy: "Neobjednana",
  dopravaOdoslanaInfo: null,
  stavObjednavky: "Neodoslana",
  objednavkaOdoslanaInfo: null,
};
const STATUS_MATERIAL_DOPRAVA = {
  "Neobjednana": "bg-slate-100 text-slate-700",
  "Objednana": "bg-blue-100 text-blue-700",
  "Dodavatel doruci sam": "bg-purple-100 text-purple-700",
  "Osobny odber": "bg-amber-100 text-amber-700",
};
const SPOSOB_DOPRAVY_OPTIONS = [
  { value: "doprava", label: "Objednavame dopravu" },
  { value: "dodavatel", label: "Dodavatel dorucuje sam" },
  { value: "vyzdvihnutie", label: "Osobny odber" },
];
const STATUS_MATERIAL_OBJEDNAVKA = {
  "Neodoslana": "bg-slate-100 text-slate-700",
  "Odoslana": "bg-emerald-100 text-emerald-700",
};
const MATERIAL_QUICK_PICKS = ["Kukurica Mushroom Yellow", "Cukor Tereos krystal", "Sol SUPERFINE", "Tuk AKOSNAC NT MB", "Kartony", "Kbeliky", "Folie", "Strecove folie", "Pasky"];
const EMPTY_GOODS_RECEIPT = {
  datumPrijatia: "",
  casPrijatia: "",
  dodavatelId: "",
  dodavatel: "",
  material: "",
  mnozstvo: "",
  mnozstvoCislo: "",
  mnozstvoJednotka: "ks",
  cisloDokladu: "",
  stavPrevzatia: "V poriadku",
  poznamka: "",
  prevzal: "",
  materialObjednavkaId: "",
  materialObjednavkaCislo: "",
  photoPath: "",
  cenaJednotkova: "",
  cenaMena: "",
  cenaKurz: "",
  cenaJednotkovaCzk: "",
  fakturaCislo: "",
  fakturaDatum: "",
  fakturaPath: "",
};
const GOODS_RECEIPT_PHOTOS_BUCKET = "goods-receipt-photos";
const NVE_LISTS_BUCKET = "nve-lists";
const INVOICES_BUCKET = "invoices";
const STOCK_ISSUE_REASONS = ["Vyroba", "Testovanie/vzorky", "Znehodnotene", "Ine"];
const EMPTY_STOCK_ISSUE = {
  datum: "",
  cas: "",
  material: "",
  mnozstvo: "",
  mnozstvoCislo: "",
  mnozstvoJednotka: "ks",
  dovod: "Vyroba",
  poznamka: "",
  zapisal: "",
};
const STATUS_PREVZATIA = {
  "V poriadku": "bg-emerald-100 text-emerald-700",
  "Poskodene": "bg-red-100 text-red-700",
  "Nekompletne": "bg-amber-100 text-amber-800",
};

const PRODUCTION_LINKY = [
  { value: "sacky", label: "Sacky" },
  { value: "kyble", label: "Kyble" },
  { value: "bulk", label: "Bulk" },
];
const VYROBA_STATUS_LABELS = { caka: "Caka", prebieha: "Prebieha", hotovo: "Hotovo" };
const STATUS_VYROBY = {
  "Caka": "bg-slate-100 text-slate-700",
  "Prebieha": "bg-blue-100 text-blue-700",
  "Hotovo": "bg-emerald-100 text-emerald-700",
};
const EMPTY_PRODUCT = {
  znacka: "",
  gramaz: "",
  ksVKartone: "",
  kartonovNaPalete: "",
  linka: "sacky",
  receptura: [],
};
const EMPTY_PRODUCTION_PLAN = {
  datum: "",
  linka: "sacky",
  produktId: "",
  produktNazov: "",
  mnozstvo: "",
  mnozstvoJednotka: "paliet",
  terminDodania: "",
  poznamka: "",
  stav: "Naplanovane",
  vydajZapisany: false,
  vyrobil: "",
  vyrobeneAt: null,
  zapisal: "",
};
function productLabel(p) {
  if (!p) return "";
  return [p.znacka, [p.gramaz, p.ksVKartone, p.kartonovNaPalete].filter(Boolean).join("/")].filter(Boolean).join(" ");
}

// Cislovany viacriadkovy zapis (nie jednoriadkovy zoznam so zarovnanim do stlpcov) -
// mailto: telo je vzdy plain text, takze skutocna HTML tabulka nie je mozna a
// zarovnanie medzerami by sa rozpadlo pri zalomeni dlhsich nazvov v mailovom klientovi.
function materialOrderItemsText(order, mnozstvoLabel) {
  const label = mnozstvoLabel || "Mnozstvo";
  if (order.polozky && order.polozky.length) {
    return order.polozky
      .map((it, i) => {
        const head = `${i + 1}. ${it.popis}${it.artikel ? " (art. " + it.artikel + ")" : ""}`;
        return it.mnozstvo ? `${head}\n   ${label}: ${it.mnozstvo}` : head;
      })
      .join("\n");
  }
  return [order.popisMaterialu, order.mnozstvo].filter(Boolean).join(" - ") || "[doplnte]";
}

function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatSkDate(d) {
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}
function ddmmFromSkDateStr(str) {
  const d = parseSkDate(str) || new Date();
  return `${String(d.getDate()).padStart(2, "0")}${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function subtractBusinessDays(date, days) {
  const d = new Date(date);
  let remaining = days;
  while (remaining > 0) {
    d.setDate(d.getDate() - 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) remaining--;
  }
  return d;
}
function nakladkaDateFromDodanie(datumDodaniaStr) {
  const d = parseSkDate(datumDodaniaStr);
  if (!d) return "[doplnte]";
  return formatSkDate(subtractBusinessDays(d, 2));
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = () => reject(new Error("Nepodarilo sa nacitat subor"));
    r.readAsDataURL(file);
  });
}

async function callClaude(contentBlocks, apiKey) {
  if (!apiKey) throw new Error("Chyba API kluc. Doplnte ho v Nastaveniach firmy, aby fungovala AI extrakcia.");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{ role: "user", content: contentBlocks }],
    }),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error("Chyba pri komunikacii s AI (" + response.status + "). " + errText.slice(0, 200));
  }
  const data = await response.json();
  const text = (data.content || []).map((b) => b.text || "").join("\n");
  const clean = text.replace(/```json|```/g, "").trim();
  const jsonStart = clean.indexOf("{");
  const jsonEnd = clean.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) throw new Error("AI nevratila platny JSON");
  return JSON.parse(clean.slice(jsonStart, jsonEnd + 1));
}

const EXTRACT_INSTRUCTIONS = `Si asistent, ktory z textu/dokumentu objednavky zakaznika (typicky od Stenger Waffeln GmbH, pripadne inych zakaznikov) vytiahne strukturovane udaje pre logisticku firmu.
Odpovedz VYLUCNE JSON objektom v tomto presnom tvare (bez ciarok naviac, bez markdown, bez vysvetlenia):
{
  "zakaznik": "nazov firmy zakaznika (odberatela, ktoremu sa fakturuje - napr. Stenger Waffeln GmbH, zvycajne v hlavicke dokumentu ako odosielatel objednavky)",
  "adresaDodaniaNazov": "nazov skutocneho mista dodania - hlada sa v sekcii oznacenej 'delivery address' alebo podobne, je to zvycajne INY subjekt ako zakaznik (napr. konkretny retazec/sklad ako Netto Marken-Discount, EDEKA a pod.)",
  "adresaDodania": "cela adresa miesta dodania z tej istej sekcie 'delivery address' (ulica, PSC, mesto, krajina)",
  "kontaktnaOsoba": "meno kontaktnej osoby/spracovatela objednavky (napr. pole 'Bearbeiter'), ak je uvedene, inak prazdny retazec",
  "zakaznikEmail": "e-mailova adresa kontaktu, ak je uvedena, inak prazdny retazec",
  "cisloObjednavkyZakaznika": "cislo objednavky zakaznika oznacene ako 'Belegnummer' (nie 'Vorgangsnummer'!), ak Belegnummer nie je v dokumente, pouzi ine pole typu 'Bestellung' alebo 'Auftragsnummer'",
  "datumDodania": "pozadovany datum dodania vo formate DD.MM.RRRR - hlada sa v riadku typu '<NAZOV RETAZCA> - DELIVERY DATE: DD.MM.RRRR' (napr. 'NETTO MARKEN - DELIVERY DATE: 31.07.2026') alebo v poli 'Delivery date to customer'",
  "casDodania": "casove okno/cas dodania - hladaj riadok typu 'Mercareon time slot booked: HH:MM am/pm' (casty pri EDEKA/EHG objednavkach) a pouzi ten cas, inak hladaj ine casove okno napr. 8:00-14:30, ak nic take nie je v dokumente (casto pri NETTO), nechaj prazdny retazec",
  "mercareonRef": "booking/referencne cislo pre Mercareon alebo Transporeon - hlada sa v riadku typu '<NAZOV RETAZCA> - ORDER-N°: XXXXXXX' (napr. 'NETTO MARKEN - ORDER-N°: 2607026077759', pri inom zakaznikovi moze byt namiesto NETTO MARKEN napr. EDEKA a podobne) - je to cislo objednavky KONCOVEHO odberatela/retazca, nie Belegnummer",
  "pocetPaliet": "celkovy pocet europaliet - hlada sa v riadku typu 'X Doppelstockpal. = Y Europaletten = Z Stellplatze' - pouzi hodnotu Y (Europaletten), ak taky riadok nie je, hladaj inde uvedeny pocet paliet",
  "pocetPaletovychMiest": "pocet paletovych/nakladacich pozicii - z toho isteho riadku 'X Doppelstockpal. = Y Europaletten = Z Stellplatze' pouzi hodnotu Z (Stellplatze). Ak taky riadok chyba, nechaj prazdne - NEODHADUJ ho z poctu paliet.",
  "pocetKartonov": "celkovy pocet kartonov - v tabulke polozok najdi stlpec 'Menge'/'ME' kde jednotka je 'KRT' (karton) a sprocitaj vsetky mnozstva s touto jednotkou naprie vsetkymi polozkami",
  "hmotnost": "celkova hmotnost v kg ako text, ak je priamo uvedena v dokumente, inak prazdny retazec (nepocitaj ju z max. vahy palety)",
  "popisTovaru": "strucny popis objednaneho tovaru - zluc nazvy vsetkych poloziek z tabulky (stlpec Bezeichnung/Artikelnr)",
  "mnozstvo": "mnozstvo/pocet kusov ako text - ak je viac poloziek, strucne zhrni (napr. '192 KRT American Style popcorn sweet')",
  "poznamka": "akakolvek dalsia dolezita poznamka z objednavky (napr. specialne baliace/dodacie podmienky), inak prazdny retazec"
}
Ak nejaky udaj v texte chyba, nechaj ho ako prazdny retazec "". Neodhaduj veci, ktore tam nie su.
Dolezite rozlisenie cisiel:
- "cisloObjednavkyZakaznika" (Belegnummer) a "mercareonRef" (ORDER-N° retazca) su DVE ROZDIELNE cisla z roznych casti dokumentu - nezamienaj ich.
- "pocetPaliet" (Europaletten) a "pocetPaletovychMiest" (Stellplatze) su tiez dve rozdielne cisla z riadku 'Doppelstockpal. = Europaletten = Stellplatze' - pri dvojitom stohovani je pocet paliet dvojnasobny oproti poctu miest.
- "pocetKartonov" je uplne iny, samostatny udaj - sucet vsetkych KRT mnozstiev z tabulky poloziek.`;

const INVOICE_EXTRACT_INSTRUCTIONS = `Si asistent, ktory z faktury od dodavatela (PDF dokument alebo obrazok) vytiahne strukturovane udaje pre sklad/ucstovnictvo.
Odpovedz VYLUCNE JSON objektom v tomto presnom tvare (bez ciarok naviac, bez markdown, bez vysvetlenia):
{
  "dodavatel": "nazov dodavatelskej firmy (odosielatel/vystavovatel faktury)",
  "cisloFaktury": "cislo faktury / invoice number",
  "datumFaktury": "datum vystavenia faktury vo formate DD.MM.RRRR",
  "mena": "trojpismenovy kod meny súm na fakture podla symbolu/skratky pri cenach, napr. EUR, CZK, USD",
  "polozky": [
    {
      "popis": "nazov/popis polozky presne ako je uvedeny na fakture",
      "mnozstvoCislo": cislo mnozstva danej polozky ako JSON cislo (nie retazec, bez jednotky),
      "mnozstvoJednotka": "jednotka mnozstva presne ako na fakture (napr. kg, ks, m, l)",
      "cenaJednotkova": jednotkova cena za jednu jednotku mnozstva ako JSON cislo (nie retazec, bez oznacenia meny)
    }
  ]
}
Vrat vsetky riadkove polozky z faktury v poli "polozky", nie len sucet. Ak nejaky udaj chyba, nechaj ho ako prazdny retazec "" (cisla necahaj ako 0, radsej vynechaj tu polozku). Neodhaduj veci, ktore na fakture nie su - citaj presne to, co je tam napisane.`;

function buildItemsInstructions(katalog) {
  const list = katalog.map((k) => `- ${k.popis}${k.artikel ? " (artikel: " + k.artikel + ")" : ""}`).join("\n");
  return `Mas k dispozicii katalog tovaru zakaznika:\n${list}\n\nPodla textu/dokumentu objednavky priraď mnozstva k polozkam z tohto katalogu, ktore sa v objednavke skutocne vyskytuju.
Odpovedz VYLUCNE JSON objektom v tvare:
{
  "polozky": [
    { "popis": "presny nazov z katalogu", "artikel": "cislo artiklu z katalogu", "palet": "pocet paliet ako text", "karton": "pocet kartonov ako text" }
  ]
}
Ak sa polozka z katalogu v objednavke nenachadza, nezaraduj ju do zoznamu. Ak nevies presne urcit pocet paliet/kartonov, odhadni z poctu kusov ak je uvedeny, inak nechaj prazdny retazec.`;
}

export default function MiniERP() {
  const { loading: authLoading, session, profile, profileError, signIn, signOut } = useAuth();

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        <Loader2 className="animate-spin mr-2" size={20} /> Nacitavam...
      </div>
    );
  }
  if (!session) {
    return <Login onSignIn={signIn} />;
  }
  if (profileError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-4 text-center text-slate-600">
        <AlertCircle size={24} className="text-red-500" />
        <p className="max-w-sm text-sm">{profileError}</p>
        <button onClick={signOut} className="flex items-center gap-1.5 text-sm text-teal-700 hover:text-teal-900">
          <LogOut size={14} /> Odhlasit
        </button>
      </div>
    );
  }
  const lazyFallback = (
    <div className="min-h-screen flex items-center justify-center text-slate-500">
      <Loader2 className="animate-spin mr-2" size={20} /> Nacitavam...
    </div>
  );
  if (profile?.role === "sklad") {
    return (
      <Suspense fallback={lazyFallback}>
        <SkladView fullName={profile.full_name} onSignOut={signOut} />
      </Suspense>
    );
  }
  if (profile?.role === "vyroba") {
    return (
      <Suspense fallback={lazyFallback}>
        <VyrobaView fullName={profile.full_name} onSignOut={signOut} />
      </Suspense>
    );
  }
  return <OfficeApp userFullName={profile?.full_name || ""} userEmail={session?.user?.email || ""} onSignOut={signOut} />;
}

const CENOTVORBA_ALLOWED_EMAILS = ["dh@stenger.eu"];

function OfficeApp({ userFullName, userEmail, onSignOut }) {
  const [view, setView] = useState("dashboard"); // dashboard | register | carriers | customers | company | ...
  const [orders, setOrders] = useState([]);
  const [carriers, setCarriers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [company, setCompany] = useState({
    nazov: "", adresa: "", ico: "", dic: "", tel: "", kontaktnaOsoba: "", email: "", apiKey: "",
    posledneCisloDopravy: 60400, posledneCisloDodaciehoListu: 60400,
    nveEmaily: [],
  });
  const [pricelist, setPricelist] = useState(null);
  const [pricelistArchive, setPricelistArchive] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [materialOrders, setMaterialOrders] = useState([]);
  const [goodsReceipts, setGoodsReceipts] = useState([]);
  const [stockIssues, setStockIssues] = useState([]);
  const [products, setProducts] = useState([]);
  const [productionPlan, setProductionPlan] = useState([]);
  const [productionOutputs, setProductionOutputs] = useState([]);
  const [prestavky, setPrestavky] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [ulohy, setUlohy] = useState([]);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [showNewOrder, setShowNewOrder] = useState(false);
  const [transportOrder, setTransportOrder] = useState(null);
  const [deliveryOrder, setDeliveryOrder] = useState(null);
  const [palletOrder, setPalletOrder] = useState(null);
  const [cmrOrder, setCmrOrder] = useState(null);
  const [nveOrder, setNveOrder] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const [editingCarrier, setEditingCarrier] = useState(null);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [showNewMaterialOrder, setShowNewMaterialOrder] = useState(false);
  const [editingMaterialOrder, setEditingMaterialOrder] = useState(null);
  const [sendMaterialOrder, setSendMaterialOrder] = useState(null);
  const [sendSupplierMaterialOrder, setSendSupplierMaterialOrder] = useState(null);
  const [showNewGoodsReceipt, setShowNewGoodsReceipt] = useState(false);
  const [editingGoodsReceipt, setEditingGoodsReceipt] = useState(null);
  const [showInvoiceUpload, setShowInvoiceUpload] = useState(false);
  const [showNewStockIssue, setShowNewStockIssue] = useState(false);
  const [editingStockIssue, setEditingStockIssue] = useState(null);
  const [editingProduct, setEditingProduct] = useState(null);
  const [showNewProductionPlan, setShowNewProductionPlan] = useState(false);
  const [editingProductionPlan, setEditingProductionPlan] = useState(null);
  const [editingProductionOutput, setEditingProductionOutput] = useState(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const fetchOrders = useCallback(async () => {
    const { data, error } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
    if (error) {
      setLoadError("Nepodarilo sa nacitat objednavky.");
      return;
    }
    setOrders((data || []).map((row) => ({ ...row.data, stavExpedicie: row.stav_expedicie })));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [ordersRes, carriersRes, customersRes, companyRes, pricelistRes, suppliersRes, materialOrdersRes, pricelistArchiveRes, goodsReceiptsRes, stockIssuesRes, productsRes, productionPlanRes, productionOutputsRes, prestavkyRes, workersRes, ulohyRes] = await Promise.all([
          supabase.from("orders").select("*").order("created_at", { ascending: false }),
          supabase.from("carriers").select("*"),
          supabase.from("customers").select("*"),
          supabase.from("company").select("*").eq("id", 1).single(),
          supabase.from("pricelist").select("*").eq("id", 1).single(),
          supabase.from("suppliers").select("*"),
          supabase.from("material_orders").select("*").order("created_at", { ascending: false }),
          supabase.from("pricelist_archive").select("*").order("archived_at", { ascending: false }),
          supabase.from("goods_receipts").select("*").order("created_at", { ascending: false }),
          supabase.from("stock_issues").select("*").order("created_at", { ascending: false }),
          supabase.from("products").select("*"),
          supabase.from("production_plan").select("*").order("created_at", { ascending: false }),
          supabase.from("production_outputs").select("*").order("created_at", { ascending: false }),
          supabase.from("prestavky").select("*").order("created_at", { ascending: false }),
          supabase.from("workers").select("*"),
          supabase.from("ulohy").select("*").order("created_at", { ascending: false }),
        ]);
        if (ordersRes.error || carriersRes.error || customersRes.error || companyRes.error) {
          setLoadError("Nepodarilo sa nacitat ulozene data.");
        } else {
          setOrders((ordersRes.data || []).map((row) => ({ ...row.data, stavExpedicie: row.stav_expedicie })));
          setCarriers((carriersRes.data || []).map((row) => row.data));
          setCustomers((customersRes.data || []).map((row) => row.data));
          if (companyRes.data) {
            setCompany((prev) => ({
              ...prev,
              ...companyRes.data.data,
              posledneCisloDopravy: companyRes.data.posledne_cislo_dopravy,
              posledneCisloDodaciehoListu: companyRes.data.posledne_cislo_dodacieho_listu,
              posledneCisloObjednavkyMaterial: companyRes.data.posledne_cislo_objednavky_material,
            }));
          }
          if (pricelistRes.data && pricelistRes.data.data && pricelistRes.data.data.buckets) {
            setPricelist(pricelistRes.data.data);
          }
          if (!suppliersRes.error) setSuppliers((suppliersRes.data || []).map((row) => row.data));
          if (!materialOrdersRes.error) setMaterialOrders((materialOrdersRes.data || []).map((row) => row.data));
          if (!pricelistArchiveRes.error) setPricelistArchive(pricelistArchiveRes.data || []);
          if (!goodsReceiptsRes.error) setGoodsReceipts((goodsReceiptsRes.data || []).map((row) => row.data));
          if (!stockIssuesRes.error) setStockIssues((stockIssuesRes.data || []).map((row) => row.data));
          if (!productsRes.error) setProducts((productsRes.data || []).map((row) => row.data));
          if (!productionPlanRes.error) setProductionPlan((productionPlanRes.data || []).map((row) => row.data));
          if (!productionOutputsRes.error) setProductionOutputs((productionOutputsRes.data || []).map((row) => row.data));
          if (!prestavkyRes.error) setPrestavky((prestavkyRes.data || []).map((row) => row.data));
          if (!workersRes.error) setWorkers((workersRes.data || []).map((row) => row.data));
          if (!ulohyRes.error) setUlohy((ulohyRes.data || []).map((row) => row.data));
        }
      } catch (e) {
        setLoadError("Nepodarilo sa nacitat ulozene data.");
      }
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("orders-office")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        fetchOrders();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchOrders]);

  function orderRowFromOrder(order) {
    return {
      id: order.id,
      data: order,
      zakaznik: order.zakaznik || "",
      adresa_dodania_nazov: order.adresaDodaniaNazov || "",
      adresa_dodania: order.adresaDodania || "",
      cislo_objednavky_dopravy: order.cisloObjednavkyDopravy || "",
      cislo_dodacieho_listu: order.cisloDodaciehoListu || "",
    };
  }

  async function persistCarriers(next) {
    const prev = carriers;
    setCarriers(next);
    try {
      const prevIds = new Set(prev.map((c) => c.id));
      const nextIds = new Set(next.map((c) => c.id));
      const toDelete = [...prevIds].filter((id) => !nextIds.has(id));
      if (next.length) {
        const { error } = await supabase.from("carriers").upsert(next.map((c) => ({ id: c.id, data: c })));
        if (error) throw error;
      }
      if (toDelete.length) {
        const { error } = await supabase.from("carriers").delete().in("id", toDelete);
        if (error) throw error;
      }
    } catch (e) {
      setLoadError("Ulozenie zlyhalo, skuste znova.");
    }
  }
  async function persistCustomers(next) {
    const prev = customers;
    setCustomers(next);
    try {
      const prevIds = new Set(prev.map((c) => c.id));
      const nextIds = new Set(next.map((c) => c.id));
      const toDelete = [...prevIds].filter((id) => !nextIds.has(id));
      if (next.length) {
        const { error } = await supabase.from("customers").upsert(next.map((c) => ({ id: c.id, data: c })));
        if (error) throw error;
      }
      if (toDelete.length) {
        const { error } = await supabase.from("customers").delete().in("id", toDelete);
        if (error) throw error;
      }
    } catch (e) {
      setLoadError("Ulozenie zlyhalo, skuste znova.");
    }
  }
  async function persistCompany(next) {
    setCompany(next);
    const { posledneCisloDopravy, posledneCisloDodaciehoListu, ...rest } = next;
    try {
      const { error } = await supabase
        .from("company")
        .update({
          data: rest,
          posledne_cislo_dopravy: posledneCisloDopravy,
          posledne_cislo_dodacieho_listu: posledneCisloDodaciehoListu,
        })
        .eq("id", 1);
      if (error) throw error;
      setToast("Udaje o firme boli ulozene.");
    } catch (e) {
      setLoadError("Ulozenie zlyhalo, skuste znova.");
    }
  }

  async function archiveCurrentPricelist() {
    if (!pricelist || !pricelist.buckets || !pricelist.buckets.length) return;
    const entry = { id: uid(), data: pricelist, file_name: pricelist.fileName || null };
    try {
      const { error } = await supabase.from("pricelist_archive").insert(entry);
      if (error) throw error;
      setPricelistArchive((prev) => [{ ...entry, archived_at: new Date().toISOString() }, ...prev]);
    } catch (e) {
      setLoadError("Archivacia cennika zlyhala.");
    }
  }

  async function persistPricelist(next) {
    await archiveCurrentPricelist();
    setPricelist(next);
    try {
      const { error } = await supabase.from("pricelist").update({ data: next }).eq("id", 1);
      if (error) throw error;
    } catch (e) {
      setLoadError("Ulozenie cennika zlyhalo, skuste znova.");
    }
  }

  async function deletePricelist() {
    await archiveCurrentPricelist();
    setPricelist({});
    try {
      const { error } = await supabase.from("pricelist").update({ data: {} }).eq("id", 1);
      if (error) throw error;
    } catch (e) {
      setLoadError("Zmazanie cennika zlyhalo, skuste znova.");
    }
  }

  async function restorePricelistFromArchive(entry) {
    await persistPricelist(entry.data);
  }

  async function deletePricelistArchiveEntry(id) {
    setPricelistArchive((prev) => prev.filter((e) => e.id !== id));
    try {
      const { error } = await supabase.from("pricelist_archive").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      setLoadError("Zmazanie z archivu zlyhalo, skuste znova.");
    }
  }

  async function persistSuppliers(next) {
    const prev = suppliers;
    setSuppliers(next);
    try {
      const prevIds = new Set(prev.map((s) => s.id));
      const nextIds = new Set(next.map((s) => s.id));
      const toDelete = [...prevIds].filter((id) => !nextIds.has(id));
      if (next.length) {
        const { error } = await supabase.from("suppliers").upsert(next.map((s) => ({ id: s.id, data: s })));
        if (error) throw error;
      }
      if (toDelete.length) {
        const { error } = await supabase.from("suppliers").delete().in("id", toDelete);
        if (error) throw error;
      }
    } catch (e) {
      setLoadError("Ulozenie zlyhalo, skuste znova.");
    }
  }

  async function persistProducts(next) {
    const prev = products;
    setProducts(next);
    try {
      const prevIds = new Set(prev.map((p) => p.id));
      const nextIds = new Set(next.map((p) => p.id));
      const toDelete = [...prevIds].filter((id) => !nextIds.has(id));
      if (next.length) {
        const { error } = await supabase.from("products").upsert(next.map((p) => ({ id: p.id, data: p })));
        if (error) throw error;
      }
      if (toDelete.length) {
        const { error } = await supabase.from("products").delete().in("id", toDelete);
        if (error) throw error;
      }
    } catch (e) {
      setLoadError("Ulozenie zlyhalo, skuste znova.");
    }
  }

  async function persistWorkers(next) {
    const prev = workers;
    setWorkers(next);
    try {
      const prevIds = new Set(prev.map((w) => w.id));
      const nextIds = new Set(next.map((w) => w.id));
      const toDelete = [...prevIds].filter((id) => !nextIds.has(id));
      if (next.length) {
        const { error } = await supabase.from("workers").upsert(next.map((w) => ({ id: w.id, data: w })));
        if (error) throw error;
      }
      if (toDelete.length) {
        const { error } = await supabase.from("workers").delete().in("id", toDelete);
        if (error) throw error;
      }
    } catch (e) {
      setLoadError("Ulozenie zlyhalo, skuste znova.");
    }
  }

  async function saveNewMaterialOrder(fields) {
    const { data: num, error: numError } = await supabase.rpc("next_material_order_number");
    if (numError || num === null || num === undefined) {
      setLoadError("Nepodarilo sa prideelit cislo objednavky, skuste znova.");
      return;
    }
    const order = {
      ...EMPTY_MATERIAL_ORDER,
      ...fields,
      id: uid(),
      cisloObjednavkyDopravy: `${String(num).padStart(4, "0")}/${new Date().getFullYear()}`,
      stavDopravy: fields.sposobDopravy === "dodavatel" ? "Dodavatel doruci sam" : fields.sposobDopravy === "vyzdvihnutie" ? "Osobny odber" : "Neobjednana",
      dopravaOdoslanaInfo: null,
      stavObjednavky: "Neodoslana",
      objednavkaOdoslanaInfo: null,
    };
    setMaterialOrders((prev) => [order, ...prev]);
    try {
      const { error } = await supabase.from("material_orders").insert({ id: order.id, data: order });
      if (error) throw error;
    } catch (e) {
      setLoadError("Ulozenie objednavky zlyhalo, skuste znova.");
    }
    setShowNewMaterialOrder(false);
  }

  async function updateMaterialOrder(id, patch) {
    const current = materialOrders.find((o) => o.id === id);
    if (!current) return;
    const merged = { ...current, ...patch };
    setMaterialOrders((prev) => prev.map((o) => (o.id === id ? merged : o)));
    try {
      const { error } = await supabase.from("material_orders").update({ data: merged }).eq("id", id);
      if (error) throw error;
    } catch (e) {
      setLoadError("Ulozenie zlyhalo, skuste znova.");
    }
  }

  async function deleteMaterialOrder(id) {
    setMaterialOrders((prev) => prev.filter((o) => o.id !== id));
    try {
      const { error } = await supabase.from("material_orders").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      setLoadError("Ulozenie zlyhalo, skuste znova.");
    }
  }

  async function saveNewUloha(fields) {
    const uloha = { ...EMPTY_ULOHA, ...fields, id: uid() };
    setUlohy((prev) => [uloha, ...prev]);
    try {
      const { error } = await supabase.from("ulohy").insert({ id: uloha.id, data: uloha });
      if (error) throw error;
    } catch (e) {
      setLoadError("Ulozenie ulohy zlyhalo, skuste znova.");
    }
  }

  async function updateUloha(id, patch) {
    const current = ulohy.find((u) => u.id === id);
    if (!current) return;
    const merged = { ...current, ...patch };
    setUlohy((prev) => prev.map((u) => (u.id === id ? merged : u)));
    try {
      const { error } = await supabase.from("ulohy").update({ data: merged }).eq("id", id);
      if (error) throw error;
    } catch (e) {
      setLoadError("Ulozenie zlyhalo, skuste znova.");
    }
  }

  async function deleteUloha(id) {
    setUlohy((prev) => prev.filter((u) => u.id !== id));
    try {
      const { error } = await supabase.from("ulohy").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      setLoadError("Ulozenie zlyhalo, skuste znova.");
    }
  }

  async function saveNewGoodsReceipt(fields) {
    const receipt = { ...EMPTY_GOODS_RECEIPT, ...fields, id: fields.id || uid() };
    setGoodsReceipts((prev) => [receipt, ...prev]);
    try {
      const { error } = await supabase.from("goods_receipts").insert({ id: receipt.id, data: receipt });
      if (error) throw error;
    } catch (e) {
      setLoadError("Ulozenie zlyhalo, skuste znova.");
    }
    setShowNewGoodsReceipt(false);
    return receipt;
  }

  async function updateGoodsReceipt(id, patch) {
    const current = goodsReceipts.find((r) => r.id === id);
    if (!current) return;
    const merged = { ...current, ...patch };
    setGoodsReceipts((prev) => prev.map((r) => (r.id === id ? merged : r)));
    try {
      const { error } = await supabase.from("goods_receipts").update({ data: merged }).eq("id", id);
      if (error) throw error;
    } catch (e) {
      setLoadError("Ulozenie zlyhalo, skuste znova.");
    }
  }

  async function deleteGoodsReceipt(id) {
    setGoodsReceipts((prev) => prev.filter((r) => r.id !== id));
    try {
      const { error } = await supabase.from("goods_receipts").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      setLoadError("Ulozenie zlyhalo, skuste znova.");
    }
  }

  async function saveNewStockIssue(fields) {
    const issue = { ...EMPTY_STOCK_ISSUE, ...fields, id: fields.id || uid() };
    setStockIssues((prev) => [issue, ...prev]);
    try {
      const { error } = await supabase.from("stock_issues").insert({ id: issue.id, data: issue });
      if (error) throw error;
    } catch (e) {
      setLoadError("Ulozenie zlyhalo, skuste znova.");
    }
    setShowNewStockIssue(false);
    return issue;
  }

  async function updateStockIssue(id, patch) {
    const current = stockIssues.find((i) => i.id === id);
    if (!current) return;
    const merged = { ...current, ...patch };
    setStockIssues((prev) => prev.map((i) => (i.id === id ? merged : i)));
    try {
      const { error } = await supabase.from("stock_issues").update({ data: merged }).eq("id", id);
      if (error) throw error;
    } catch (e) {
      setLoadError("Ulozenie zlyhalo, skuste znova.");
    }
  }

  async function deleteStockIssue(id) {
    setStockIssues((prev) => prev.filter((i) => i.id !== id));
    try {
      const { error } = await supabase.from("stock_issues").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      setLoadError("Ulozenie zlyhalo, skuste znova.");
    }
  }

  async function saveNewProductionPlan(fields) {
    const plan = { ...EMPTY_PRODUCTION_PLAN, ...fields, id: fields.id || uid(), zapisal: fields.zapisal || userFullName || "" };
    setProductionPlan((prev) => [plan, ...prev]);
    try {
      const { error } = await supabase.from("production_plan").insert({ id: plan.id, data: plan });
      if (error) throw error;
    } catch (e) {
      setLoadError("Ulozenie zlyhalo, skuste znova.");
    }
    setShowNewProductionPlan(false);
    return plan;
  }

  async function updateProductionPlan(id, patch) {
    const current = productionPlan.find((p) => p.id === id);
    if (!current) return;
    const merged = { ...current, ...patch };
    setProductionPlan((prev) => prev.map((p) => (p.id === id ? merged : p)));
    try {
      const { error } = await supabase.from("production_plan").update({ data: merged }).eq("id", id);
      if (error) throw error;
    } catch (e) {
      setLoadError("Ulozenie zlyhalo, skuste znova.");
    }
  }

  async function deleteProductionPlan(id) {
    setProductionPlan((prev) => prev.filter((p) => p.id !== id));
    try {
      const { error } = await supabase.from("production_plan").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      setLoadError("Ulozenie zlyhalo, skuste znova.");
    }
  }

  // Zmazanie zaznamu skutocnej vyroby zaroven zrusi vydaje surovin, ktore pri jeho
  // ulozeni automaticky vznikli (korekcia preklepov zapisanych na tablete vo vyrobe).
  async function deleteProductionOutput(output) {
    setProductionOutputs((prev) => prev.filter((o) => o.id !== output.id));
    setStockIssues((prev) => prev.filter((i) => !(output.issueIds || []).includes(i.id)));
    try {
      if ((output.issueIds || []).length) {
        const { error: issuesErr } = await supabase.from("stock_issues").delete().in("id", output.issueIds);
        if (issuesErr) throw issuesErr;
      }
      const { error } = await supabase.from("production_outputs").delete().eq("id", output.id);
      if (error) throw error;
    } catch (e) {
      setLoadError("Zmazanie zlyhalo, skuste znova.");
    }
  }

  // Uprava zaznamu skutocnej vyroby (oprava preklepu) - stare vydaje surovin zrusi
  // a podla noveho produktu/mnozstva vytvori nove, aby stav zasob ostal presny.
  async function updateProductionOutput(id, patch) {
    const current = productionOutputs.find((o) => o.id === id);
    if (!current) return;
    const merged = { ...current, ...patch };
    const product = products.find((p) => p.id === merged.produktId);
    const newIssues = computeProductionIssues({ mnozstvo: merged.mnozstvo, mnozstvoJednotka: "paliet" }, product);
    try {
      if ((current.issueIds || []).length) {
        const { error: delErr } = await supabase.from("stock_issues").delete().in("id", current.issueIds);
        if (delErr) throw delErr;
      }
      const newIssueIds = [];
      for (const issue of newIssues) {
        const issueId = uid();
        const { error: insErr } = await supabase.from("stock_issues").insert({
          id: issueId,
          data: {
            id: issueId,
            datum: merged.datum,
            cas: merged.cas || "",
            material: issue.material,
            mnozstvo: issue.mnozstvo,
            mnozstvoCislo: issue.mnozstvoCislo,
            mnozstvoJednotka: issue.mnozstvoJednotka,
            dovod: "Vyroba",
            poznamka: "Sarza " + (merged.sarza || "") + " - " + (merged.produktNazov || ""),
            zapisal: merged.zapisala || "",
          },
        });
        if (insErr) throw insErr;
        newIssueIds.push(issueId);
      }
      const finalMerged = { ...merged, issueIds: newIssueIds };
      const { error: updErr } = await supabase.from("production_outputs").update({ data: finalMerged }).eq("id", id);
      if (updErr) throw updErr;
      setProductionOutputs((prev) => prev.map((o) => (o.id === id ? finalMerged : o)));
      const { data: freshIssues, error: fetchErr } = await supabase.from("stock_issues").select("*").order("created_at", { ascending: false });
      if (!fetchErr) setStockIssues((freshIssues || []).map((r) => r.data));
    } catch (e) {
      setLoadError("Ulozenie zlyhalo, skuste znova.");
    }
  }

  // Oprava/zmazanie zaznamu prestavky (napr. ked pracovnicka zabudla tuknut koniec).
  async function deletePrestavka(id) {
    setPrestavky((prev) => prev.filter((p) => p.id !== id));
    try {
      const { error } = await supabase.from("prestavky").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      setLoadError("Zmazanie zlyhalo, skuste znova.");
    }
  }

  async function updatePrestavka(id, patch) {
    const current = prestavky.find((p) => p.id === id);
    if (!current) return;
    const merged = { ...current, ...patch };
    setPrestavky((prev) => prev.map((p) => (p.id === id ? merged : p)));
    try {
      const { error } = await supabase.from("prestavky").update({ data: merged }).eq("id", id);
      if (error) throw error;
    } catch (e) {
      setLoadError("Ulozenie zlyhalo, skuste znova.");
    }
  }

  async function exportToExcel() {
    const rows = orders.map((o) => ({
      "Cislo objednavky dopravy": o.cisloObjednavkyDopravy || "",
      "Cislo dodacieho listu": o.cisloDodaciehoListu || "",
      "Cislo objednavky zakaznika": o.cisloObjednavkyZakaznika || "",
      "Datum prijatia": o.datumPrijatia,
      "Zakaznik": o.zakaznik,
      "Miesto dodania": (o.adresaDodaniaNazov ? o.adresaDodaniaNazov + " - " : "") + o.adresaDodania,
      "Datum dodania": o.datumDodania,
      "Cas dodania": o.casDodania,
      "Pocet paliet": o.pocetPaliet,
      "Pocet paletovych miest": o.pocetPaletovychMiest,
      "Pocet kartonov": o.pocetKartonov,
      "Hmotnost": o.hmotnost,
      "Palety zpet": o.paletyZpat ? "Ano" : "Nie",
      "Dopravca": (carriers.find((c) => c.id === o.dopravcaId) || {}).nazov || "",
      "Stav objednavky": o.stavObjednavky,
      "Stav dopravy": o.stavDopravy,
      "Stav expedicie": o.stavExpedicie === "Expedovana" ? "Expedovana" : "Neexpedovana",
      "Dodaci list odoslany": o.dodaciListOdoslany === "Ano" ? "Ano" : "Nie",
      "Paletovy listok pripraveny": o.paletovyListokInfo ? "Ano" : "Nie",
      "CMR pripravene": o.cmrInfo ? "Ano" : "Nie",
      "Poznamka": o.poznamka,
    }));
    await exportRowsToExcel(rows, "Register objednavok", "Register_objednavok");
  }

  function nextOrderNumber() {
    const year = new Date().getFullYear();
    const count = orders.filter((o) => o.cisloObjednavky.includes(String(year))).length + 1;
    return `OBJ-${year}-${String(count).padStart(3, "0")}`;
  }

  async function saveNewOrder(fields) {
    const suffix = ddmmFromSkDateStr(fields.datumDodania);
    const { data: numData, error: numError } = await supabase.rpc("next_order_numbers");
    if (numError || !numData || !numData[0]) {
      setLoadError("Nepodarilo sa prideelit cislo objednavky, skuste znova.");
      return;
    }
    const { doprava_num: dopravaNum, dodak_num: dodakNum } = numData[0];
    const order = {
      id: uid(),
      cisloObjednavky: fields.cisloObjednavky || nextOrderNumber(),
      cisloObjednavkyZakaznika: fields.cisloObjednavkyZakaznika || "",
      datumPrijatia: fields.datumPrijatia || todayStr(),
      zakaznikId: fields.zakaznikId || "",
      zakaznik: fields.zakaznik || "",
      kontaktnaOsoba: fields.kontaktnaOsoba || "",
      zakaznikEmail: fields.zakaznikEmail || "",
      adresaNakladky: fields.adresaNakladky || company.adresa || "",
      adresaDodaniaNazov: fields.adresaDodaniaNazov || fields.zakaznik || "",
      adresaDodania: fields.adresaDodania || "",
      datumDodania: fields.datumDodania || "",
      casDodania: fields.casDodania || "",
      mercareonRef: fields.mercareonRef || "",
      pocetPaliet: fields.pocetPaliet || "",
      pocetPaletovychMiest: fields.pocetPaletovychMiest || "",
      pocetKartonov: fields.pocetKartonov || "",
      vyskaPalety: fields.vyskaPalety || "",
      hmotnost: fields.hmotnost || "",
      paletyZpat: fields.paletyZpat !== undefined ? fields.paletyZpat : true,
      popisTovaru: fields.popisTovaru || "",
      mnozstvo: fields.mnozstvo || "",
      polozky: fields.polozky || [],
      poznamka: fields.poznamka || "",
      zdrojDokument: fields.zdrojDokument || null,
      sposobDopravy: fields.sposobDopravy || "doprava",
      cisloObjednavkyDopravy: `${dopravaNum}/${suffix}`,
      cisloDodaciehoListu: `${dodakNum}/${suffix}`,
      stavObjednavky: "Prijata",
      stavDopravy: fields.sposobDopravy === "vyzdvihnutie" ? "Vyzdvihnutie" : "Neobjednana",
      dopravcaId: "",
      dodaciListOdoslany: "Nie",
      stavExpedicie: "Neexpedovana",
    };
    setCompany((prev) => ({ ...prev, posledneCisloDopravy: dopravaNum, posledneCisloDodaciehoListu: dodakNum }));
    setOrders((prev) => [order, ...prev]);
    try {
      const { error } = await supabase.from("orders").insert(orderRowFromOrder(order));
      if (error) throw error;
    } catch (e) {
      setLoadError("Ulozenie objednavky zlyhalo, skuste znova.");
    }
    setShowNewOrder(false);
  }

  async function updateOrder(id, patch) {
    const current = orders.find((o) => o.id === id);
    if (!current) return;
    const merged = { ...current, ...patch };
    setOrders((prev) => prev.map((o) => (o.id === id ? merged : o)));
    const { id: _drop, ...row } = orderRowFromOrder(merged);
    try {
      const { error } = await supabase.from("orders").update(row).eq("id", id);
      if (error) throw error;
    } catch (e) {
      setLoadError("Ulozenie zlyhalo, skuste znova.");
    }
  }
  async function deleteOrder(id) {
    setOrders((prev) => prev.filter((o) => o.id !== id));
    try {
      const { error } = await supabase.from("orders").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      setLoadError("Ulozenie zlyhalo, skuste znova.");
    }
  }
  async function toggleExpedicia(order) {
    const next = order.stavExpedicie === "Expedovana" ? "Neexpedovana" : "Expedovana";
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, stavExpedicie: next } : o)));
    try {
      const { error } = await supabase.rpc("set_expedovana", { p_id: order.id, p_val: next });
      if (error) throw error;
    } catch (e) {
      setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, stavExpedicie: order.stavExpedicie } : o)));
      setLoadError("Zmena stavu expedicie zlyhala, skuste znova.");
    }
  }

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-96 text-slate-500">
        <Loader2 className="animate-spin mr-2" size={20} /> Nacitavam...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" style={{ fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}>
      <PrintStyles />
      <Header view={view} setView={setView} company={company} userFullName={userFullName} userEmail={userEmail} onSignOut={onSignOut} />
      {toast && (
        <div className="fixed top-4 right-4 z-[60] bg-emerald-600 text-white text-sm font-medium px-4 py-2.5 rounded-md shadow-lg flex items-center gap-2">
          <CheckCircle2 size={16} /> {toast}
        </div>
      )}
      {loadError && (
        <div className="max-w-6xl mx-auto mt-3 px-4">
          <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md flex items-center gap-2">
            <AlertCircle size={16} /> {loadError}
          </div>
        </div>
      )}
      <main className="max-w-6xl mx-auto px-4 py-6">
        {view === "dashboard" && (
          <DashboardView
            orders={orders}
            goodsReceipts={goodsReceipts}
            stockIssues={stockIssues}
            productionOutputs={productionOutputs}
            onGoToRegister={() => setView("register")}
            onGoToGoodsReceipts={() => setView("goodsreceipts")}
            onGoToStock={() => setView("stock")}
            onGoToProduction={() => setView("productionplan")}
          />
        )}
        {view === "register" && !showNewOrder && !editingOrder && (
          <RegisterView
            orders={orders}
            carriers={carriers}
            customers={customers}
            company={company}
            onNew={() => setShowNewOrder(true)}
            onOpenTransport={(o) => setTransportOrder(o)}
            onOpenDelivery={(o) => setDeliveryOrder(o)}
            onOpenPallet={(o) => setPalletOrder(o)}
            onOpenCmr={(o) => setCmrOrder(o)}
            onOpenNve={(o) => setNveOrder(o)}
            onEdit={(o) => setEditingOrder(o)}
            onDelete={deleteOrder}
            onExport={exportToExcel}
            onToggleExpedicia={toggleExpedicia}
          />
        )}
        {view === "register" && showNewOrder && (
          <NewOrderPage
            onClose={() => setShowNewOrder(false)}
            onSave={saveNewOrder}
            suggestedNumber={nextOrderNumber()}
            defaultAdresaNakladky={company.adresa || ""}
            customers={customers}
            company={company}
          />
        )}
        {view === "register" && editingOrder && (
          <EditOrderPage
            order={editingOrder}
            customers={customers}
            onClose={() => setEditingOrder(null)}
            onSave={(patch) => { updateOrder(editingOrder.id, patch); setEditingOrder(null); }}
          />
        )}
        {view === "ulohy" && (
          <UlohyView ulohy={ulohy} onSave={saveNewUloha} onUpdate={updateUloha} onDelete={deleteUloha} />
        )}
        {view === "carriers" && (
          <CarriersView carriers={carriers} onSave={persistCarriers} onEdit={(c) => setEditingCarrier(c)} />
        )}
        {view === "customers" && (
          <CustomersView customers={customers} onSave={persistCustomers} onEdit={(c) => setEditingCustomer(c)} />
        )}
        {view === "company" && (
          <CompanyView company={company} onSave={persistCompany} />
        )}
        {view === "pricelist" && (
          <PricelistView
            pricelist={pricelist}
            pricelistArchive={pricelistArchive}
            onUpload={persistPricelist}
            onDelete={deletePricelist}
            onRestore={restorePricelistFromArchive}
            onDeleteArchiveEntry={deletePricelistArchiveEntry}
          />
        )}
        {view === "suppliers" && (
          <SuppliersView suppliers={suppliers} onSave={persistSuppliers} onEdit={(s) => setEditingSupplier(s)} />
        )}
        {view === "ekokom" && <PlaceholderView title="EKO-KOM" />}
        {view === "cenotvorba" && (
          CENOTVORBA_ALLOWED_EMAILS.includes(userEmail)
            ? <PlaceholderView title="Cenotvorba" />
            : (
              <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-slate-500">
                <AlertCircle size={28} className="mx-auto mb-3 text-slate-300" />
                Nemate opravnenie zobrazit tuto sekciu.
              </div>
            )
        )}
        {view === "designs" && <PlaceholderView title="Dizajny a fotky" />}
        {view === "navody" && <PlaceholderView title="Navody" />}
        {view === "materials" && (
          <MaterialOrdersView
            materialOrders={materialOrders}
            suppliers={suppliers}
            carriers={carriers}
            onNew={() => setShowNewMaterialOrder(true)}
            onEdit={(o) => setEditingMaterialOrder(o)}
            onSend={(o) => setSendMaterialOrder(o)}
            onSendSupplier={(o) => setSendSupplierMaterialOrder(o)}
            onDelete={deleteMaterialOrder}
          />
        )}
        {view === "goodsreceipts" && (
          <GoodsReceiptsView
            receipts={goodsReceipts}
            suppliers={suppliers}
            materialOrders={materialOrders}
            onNew={() => setShowNewGoodsReceipt(true)}
            onEdit={(r) => setEditingGoodsReceipt(r)}
            onDelete={deleteGoodsReceipt}
            onUploadInvoice={() => setShowInvoiceUpload(true)}
          />
        )}
        {view === "stock" && (
          <StockView
            goodsReceipts={goodsReceipts}
            stockIssues={stockIssues}
            onNew={() => setShowNewStockIssue(true)}
            onEdit={(i) => setEditingStockIssue(i)}
            onDelete={deleteStockIssue}
          />
        )}
        {view === "products" && (
          <ProductsView products={products} onSave={persistProducts} onEdit={(p) => setEditingProduct(p)} />
        )}
        {view === "productionplan" && (
          <ProductionPlanView
            productionPlan={productionPlan}
            products={products}
            goodsReceipts={goodsReceipts}
            stockIssues={stockIssues}
            productionOutputs={productionOutputs}
            prestavky={prestavky}
            onNew={() => setShowNewProductionPlan(true)}
            onEdit={(p) => setEditingProductionPlan(p)}
            onDelete={deleteProductionPlan}
            onDeleteOutput={deleteProductionOutput}
            onEditOutput={(o) => setEditingProductionOutput(o)}
            onDeletePrestavka={deletePrestavka}
          />
        )}
        {view === "workers" && (
          <WorkersView workers={workers} onSave={persistWorkers} />
        )}
      </main>

      {editingCarrier && (
        <CarrierModal
          carrier={editingCarrier}
          onClose={() => setEditingCarrier(null)}
          onSave={(patch) => {
            persistCarriers(carriers.map((c) => (c.id === editingCarrier.id ? { ...c, ...patch } : c)));
            setEditingCarrier(null);
          }}
        />
      )}
      {editingCustomer && (
        <CustomerModal
          customer={editingCustomer}
          onClose={() => setEditingCustomer(null)}
          onSave={(patch) => {
            persistCustomers(customers.map((c) => (c.id === editingCustomer.id ? { ...c, ...patch } : c)));
            setEditingCustomer(null);
          }}
        />
      )}
      {editingSupplier && (
        <SupplierModal
          supplier={editingSupplier}
          onClose={() => setEditingSupplier(null)}
          onSave={(patch) => {
            persistSuppliers(suppliers.map((s) => (s.id === editingSupplier.id ? { ...s, ...patch } : s)));
            setEditingSupplier(null);
          }}
        />
      )}
      {showNewMaterialOrder && (
        <MaterialOrderFormModal
          suppliers={suppliers}
          company={company}
          onClose={() => setShowNewMaterialOrder(false)}
          onSave={saveNewMaterialOrder}
        />
      )}
      {editingMaterialOrder && (
        <MaterialOrderFormModal
          order={editingMaterialOrder}
          suppliers={suppliers}
          company={company}
          onClose={() => setEditingMaterialOrder(null)}
          onSave={(patch) => {
            updateMaterialOrder(editingMaterialOrder.id, patch);
            setEditingMaterialOrder(null);
          }}
        />
      )}
      {sendMaterialOrder && (
        <MaterialTransportModal
          order={sendMaterialOrder}
          carriers={carriers}
          suppliers={suppliers}
          company={company}
          currentUserName={userFullName}
          onClose={() => setSendMaterialOrder(null)}
          onSent={(dopravcaId, info) => {
            updateMaterialOrder(sendMaterialOrder.id, { stavDopravy: "Objednana", dopravcaId, dopravaOdoslanaInfo: info });
            setSendMaterialOrder(null);
            setToast("Objednavka dopravy bola odoslana (" + (carriers.find((c) => c.id === dopravcaId) || {}).nazov + ").");
          }}
        />
      )}
      {sendSupplierMaterialOrder && (
        <MaterialSupplierOrderModal
          order={sendSupplierMaterialOrder}
          suppliers={suppliers}
          company={company}
          currentUserName={userFullName}
          onClose={() => setSendSupplierMaterialOrder(null)}
          onSent={(info) => {
            updateMaterialOrder(sendSupplierMaterialOrder.id, { stavObjednavky: "Odoslana", objednavkaOdoslanaInfo: info });
            setSendSupplierMaterialOrder(null);
            setToast("Objednavka bola odoslana dodavatelovi (" + info.to + ").");
          }}
        />
      )}
      {showNewGoodsReceipt && (
        <GoodsReceiptFormModal
          suppliers={suppliers}
          materialOrders={materialOrders}
          existingReceipts={goodsReceipts}
          currentUserName={userFullName}
          onClose={() => setShowNewGoodsReceipt(false)}
          onSave={saveNewGoodsReceipt}
        />
      )}
      {editingGoodsReceipt && (
        <GoodsReceiptFormModal
          receipt={editingGoodsReceipt}
          suppliers={suppliers}
          materialOrders={materialOrders}
          existingReceipts={goodsReceipts}
          currentUserName={userFullName}
          onClose={() => setEditingGoodsReceipt(null)}
          onSave={(patch) => {
            updateGoodsReceipt(editingGoodsReceipt.id, patch);
            setEditingGoodsReceipt(null);
          }}
        />
      )}
      {showInvoiceUpload && (
        <InvoiceUploadModal
          receipts={goodsReceipts}
          company={company}
          onClose={() => setShowInvoiceUpload(false)}
          onApply={async (updates) => {
            for (const u of updates) {
              await updateGoodsReceipt(u.receiptId, u.patch);
            }
            setToast(`Cena doplnena k ${updates.length} prijmu(om) tovaru.`);
          }}
        />
      )}
      {showNewStockIssue && (
        <StockIssueFormModal
          existingReceipts={goodsReceipts}
          existingIssues={stockIssues}
          currentUserName={userFullName}
          onClose={() => setShowNewStockIssue(false)}
          onSave={saveNewStockIssue}
        />
      )}
      {editingStockIssue && (
        <StockIssueFormModal
          issue={editingStockIssue}
          existingReceipts={goodsReceipts}
          existingIssues={stockIssues}
          currentUserName={userFullName}
          onClose={() => setEditingStockIssue(null)}
          onSave={(patch) => {
            updateStockIssue(editingStockIssue.id, patch);
            setEditingStockIssue(null);
          }}
        />
      )}
      {editingProduct && (
        <ProductModal
          product={editingProduct}
          existingReceipts={goodsReceipts}
          existingIssues={stockIssues}
          onClose={() => setEditingProduct(null)}
          onSave={(patch) => {
            persistProducts(products.map((p) => (p.id === editingProduct.id ? { ...p, ...patch } : p)));
            setEditingProduct(null);
          }}
        />
      )}
      {showNewProductionPlan && (
        <ProductionPlanFormModal
          products={products}
          goodsReceipts={goodsReceipts}
          stockIssues={stockIssues}
          currentUserName={userFullName}
          onClose={() => setShowNewProductionPlan(false)}
          onSave={saveNewProductionPlan}
        />
      )}
      {editingProductionPlan && (
        <ProductionPlanFormModal
          plan={editingProductionPlan}
          products={products}
          goodsReceipts={goodsReceipts}
          stockIssues={stockIssues}
          currentUserName={userFullName}
          onClose={() => setEditingProductionPlan(null)}
          onSave={(patch) => {
            updateProductionPlan(editingProductionPlan.id, patch);
            setEditingProductionPlan(null);
          }}
        />
      )}
      {editingProductionOutput && (
        <ProductionOutputEditModal
          output={editingProductionOutput}
          products={products}
          onClose={() => setEditingProductionOutput(null)}
          onSave={(patch) => {
            updateProductionOutput(editingProductionOutput.id, patch);
            setEditingProductionOutput(null);
          }}
        />
      )}
      {transportOrder && (
        <TransportModal
          order={transportOrder}
          carriers={carriers}
          company={company}
          onClose={() => setTransportOrder(null)}
          onSent={(dopravcaId, info) => {
            updateOrder(transportOrder.id, { stavDopravy: "Objednana", dopravcaId, dopravaOdoslanaInfo: info });
            setTransportOrder(null);
            setToast("Objednavka dopravy bola odoslana (" + (carriers.find((c) => c.id === dopravcaId) || {}).nazov + ").");
          }}
        />
      )}
      {deliveryOrder && (
        <DeliveryModal
          order={deliveryOrder}
          customers={customers}
          carriers={carriers}
          company={company}
          pricelist={pricelist}
          onClose={() => setDeliveryOrder(null)}
          onSent={(email, info) => {
            updateOrder(deliveryOrder.id, { dodaciListOdoslany: "Ano", zakaznikEmail: email, stavObjednavky: "Odoslana", dodaciListOdoslanaInfo: info });
            setDeliveryOrder(null);
            setToast("Dodaci list bol odoslany na " + email + ".");
          }}
        />
      )}
      {palletOrder && (
        <PalletModal
          order={palletOrder}
          carriers={carriers}
          company={company}
          onClose={() => setPalletOrder(null)}
          onDone={(info, action) => {
            updateOrder(palletOrder.id, { paletovyListokInfo: info });
            setPalletOrder(null);
            setToast(action === "print" ? "Paletovy listok posielany na tlac." : "Paletovy listok bol stiahnuty.");
          }}
        />
      )}
      {cmrOrder && (
        <CmrModal
          order={cmrOrder}
          carriers={carriers}
          customers={customers}
          company={company}
          onClose={() => setCmrOrder(null)}
          onDone={(info, action) => {
            updateOrder(cmrOrder.id, { cmrInfo: info });
            setCmrOrder(null);
            setToast(action === "print" ? "CMR posielane na tlac." : "CMR bolo stiahnute.");
          }}
        />
      )}
      {nveOrder && (
        <NveListModal
          order={nveOrder}
          company={company}
          onClose={() => setNveOrder(null)}
          onSave={async (patch) => {
            await updateOrder(nveOrder.id, patch);
            setNveOrder((prev) => (prev ? { ...prev, ...patch } : prev));
          }}
          onSent={(info) => {
            updateOrder(nveOrder.id, { nveOdoslanaInfo: info });
            setNveOrder(null);
            setToast("Email s NVE listom pripraveny (" + info.to + ").");
          }}
        />
      )}
    </div>
  );
}

function PrintStyles() {
  return (
    <style>{`
      .print-only-content { position: fixed; left: -10000px; top: 0; }
      @media print {
        body * { visibility: hidden; }
        .print-only-content, .print-only-content * { visibility: visible; }
        .print-only-content { position: absolute; left: 0; top: 0; width: 100%; padding: 24px; }
      }
    `}</style>
  );
}

function PrintDocument({ id, title, body }) {
  return (
    <div id={id} className="print-only-content">
      <div style={{ fontFamily: "Arial, sans-serif", fontSize: "12px", color: "#111" }}>
        <div style={{ fontWeight: "bold", fontSize: "18px", textAlign: "center", marginBottom: "14px" }}>{title}</div>
        <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{body}</div>
      </div>
    </div>
  );
}

function buildMailto(to, subject, body) {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function openGoodsReceiptPhoto(path) {
  if (!path) return;
  const { data, error } = await supabase.storage.from(GOODS_RECEIPT_PHOTOS_BUCKET).createSignedUrl(path, 3600);
  if (!error && data) window.open(data.signedUrl, "_blank");
}

async function openNveListFile(path) {
  if (!path) return;
  const { data, error } = await supabase.storage.from(NVE_LISTS_BUCKET).createSignedUrl(path, 3600, { download: true });
  if (!error && data) window.open(data.signedUrl, "_blank");
}

async function openInvoiceFile(path) {
  if (!path) return;
  const { data, error } = await supabase.storage.from(INVOICES_BUCKET).createSignedUrl(path, 3600, { download: true });
  if (!error && data) window.open(data.signedUrl, "_blank");
}

function downloadText(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadHtml(filename, htmlBody) {
  const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${filename}</title>
<style>body{font-family:Arial,sans-serif;padding:24px;color:#111;} @media print { @page { margin: 12mm; } }</style>
</head><body>${htmlBody}</body></html>`;
  const blob = new Blob([doc], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const HEADER_MENU_ITEMS = [
  { icon: <ListChecks size={16} />, label: "Ulohy", v: "ulohy" },
  { icon: <Users size={16} />, label: "Dopravcovia", v: "carriers" },
  { icon: <Package size={16} />, label: "Zakaznici", v: "customers" },
  { icon: <Building2 size={16} />, label: "Nastavenia firmy", v: "company" },
  { icon: <Euro size={16} />, label: "Cennik doprav", v: "pricelist" },
  { icon: <Factory size={16} />, label: "Dodavatelia", v: "suppliers" },
  { icon: <Recycle size={16} />, label: "EKO-KOM", v: "ekokom" },
  { icon: <Calculator size={16} />, label: "Cenotvorba", v: "cenotvorba" },
  { icon: <Image size={16} />, label: "Dizajny a fotky", v: "designs" },
  { icon: <BookOpen size={16} />, label: "Navody", v: "navody" },
  { icon: <FlaskConical size={16} />, label: "Produkty", v: "products" },
  { icon: <UserCheck size={16} />, label: "Pracovnici", v: "workers" },
];

function PlaceholderView({ title }) {
  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">{title}</h1>
      <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-slate-500">
        <Construction size={28} className="mx-auto mb-3 text-slate-300" />
        Tato sekcia sa pripravuje - obsah doplnime neskor.
      </div>
    </div>
  );
}

function Header({ view, setView, company, userFullName, userEmail, onSignOut }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuItems = HEADER_MENU_ITEMS.filter((item) => item.v !== "cenotvorba" || CENOTVORBA_ALLOWED_EMAILS.includes(userEmail));
  const inMenu = menuItems.some((item) => item.v === view);

  return (
    <header className="bg-slate-900 text-white">
      <div className="max-w-6xl mx-auto px-4 pt-4 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <img src="/stenger-logo.png" alt="Stenger" className="h-10 w-auto" />
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-400">
              {company.nazov ? company.nazov : "Firma nenastavena"}
            </div>
            <div className="text-lg font-semibold">Objednavky Stenger Czech</div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 relative">
          {userFullName && <span className="text-sm text-slate-300">{userFullName}</span>}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              title="Dalsie sekcie"
              className={"flex items-center justify-center w-9 h-9 rounded-md " + (inMenu ? "bg-white text-slate-900" : "text-slate-300 hover:bg-slate-800")}
            >
              <Menu size={18} />
            </button>
            <button
              onClick={onSignOut}
              title="Odhlasit"
              className="flex items-center gap-1.5 px-3 h-9 rounded-md text-sm text-slate-300 hover:bg-slate-800"
            >
              <LogOut size={16} /> Odhlasit
            </button>
          </div>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute top-full right-0 mt-2 bg-white text-slate-900 rounded-md shadow-lg border border-slate-200 py-1.5 w-56 z-50">
                {menuItems.map((item) => (
                  <button
                    key={item.v}
                    onClick={() => { setView(item.v); setMenuOpen(false); }}
                    className={"w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 " + (view === item.v ? "bg-slate-100 font-medium" : "")}
                  >
                    {item.icon} {item.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-4 pb-4">
        <nav className="flex items-stretch gap-2 mt-3 bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-2 shadow-inner">
          <NavButton icon={<LayoutDashboard size={18} />} label="Prehlad" color="teal" active={view === "dashboard"} onClick={() => setView("dashboard")} />
          <NavButton icon={<ClipboardList size={18} />} label="Objednavky" color="blue" active={view === "register"} onClick={() => setView("register")} />
          <NavButton icon={<Boxes size={18} />} label="Objednavky surovin a obalov" color="amber" active={view === "materials"} onClick={() => setView("materials")} />
          <NavButton icon={<PackagePlus size={18} />} label="Prijem tovaru" color="emerald" active={view === "goodsreceipts"} onClick={() => setView("goodsreceipts")} />
          <NavButton icon={<Warehouse size={18} />} label="Stav zasob" color="violet" active={view === "stock"} onClick={() => setView("stock")} />
          <NavButton icon={<ClipboardCheck size={18} />} label="Vyrobny plan" color="rose" active={view === "productionplan"} onClick={() => setView("productionplan")} />
        </nav>
      </div>
    </header>
  );
}

const NAV_COLORS = {
  teal: { badge: "from-teal-400 to-teal-600", shadow: "shadow-teal-500/40" },
  blue: { badge: "from-blue-400 to-blue-600", shadow: "shadow-blue-500/40" },
  amber: { badge: "from-amber-400 to-amber-600", shadow: "shadow-amber-500/40" },
  emerald: { badge: "from-emerald-400 to-emerald-600", shadow: "shadow-emerald-500/40" },
  violet: { badge: "from-violet-400 to-violet-600", shadow: "shadow-violet-500/40" },
  rose: { badge: "from-rose-400 to-rose-600", shadow: "shadow-rose-500/40" },
};

function NavButton({ icon, label, active, onClick, color }) {
  const c = NAV_COLORS[color] || NAV_COLORS.teal;
  return (
    <button
      onClick={onClick}
      className={
        "group relative flex-1 flex flex-col items-center justify-center gap-1.5 py-3 px-2 rounded-xl text-sm font-bold text-center leading-tight transition-all duration-200 " +
        (active
          ? "bg-gradient-to-b from-white to-slate-50 text-slate-900 shadow-lg " + c.shadow + " -translate-y-0.5"
          : "text-slate-300 hover:text-white hover:bg-white/5 hover:-translate-y-0.5")
      }
    >
      <span className={"flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br text-white shadow-md transition-transform duration-200 group-hover:scale-110 " + c.badge}>
        {icon}
      </span>
      {label}
    </button>
  );
}

function Badge({ text, map }) {
  const cls = map[text] || "bg-slate-100 text-slate-700";
  return <span className={"text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap " + cls}>{text}</span>;
}

function IconButton({ children, title, onClick, disabled, sent }) {
  const btnRef = useRef(null);
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState(null);

  function showTooltip() {
    const el = btnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const below = spaceBelow > 60;
    setPos({
      left: rect.left + rect.width / 2,
      top: below ? rect.bottom + 6 : rect.top - 6,
      below,
    });
    setHover(true);
  }

  return (
    <span className="relative inline-flex">
      <button
        ref={btnRef}
        title={title}
        disabled={disabled}
        onClick={onClick}
        onMouseEnter={showTooltip}
        onMouseLeave={() => setHover(false)}
        className={"p-1.5 rounded-md border " + (disabled ? "border-slate-100 text-slate-300 cursor-not-allowed" : sent ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900")}
      >
        {children}
      </button>
      {sent && !disabled && (
        <span className="absolute -top-1.5 -right-1.5 bg-emerald-600 rounded-full p-0.5 border border-white pointer-events-none">
          <CheckCircle2 size={10} className="text-white" />
        </span>
      )}
      {title && hover && pos && createPortal(
        <div
          className="pointer-events-none fixed bg-slate-900 text-white text-xs font-medium px-2 py-1 rounded-md shadow-lg max-w-[220px] whitespace-normal text-center leading-snug z-[9999]"
          style={{ left: pos.left, top: pos.top, transform: `translate(-50%, ${pos.below ? "0" : "-100%"})` }}
        >
          {title}
          <span
            className={"absolute left-1/2 -translate-x-1/2 border-4 border-transparent " + (pos.below ? "bottom-full border-b-slate-900" : "top-full border-t-slate-900")}
          ></span>
        </div>,
        document.body
      )}
    </span>
  );
}

function ModalShell({ title, onClose, children, wide, extraWide }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className={"bg-white rounded-lg shadow-xl w-full " + (extraWide ? "max-w-5xl" : wide ? "max-w-3xl" : "max-w-lg") + " max-h-[85vh] flex flex-col min-h-0"}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 flex-shrink-0">
          <h2 className="font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0" style={{ WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, textarea, rows, type }) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>
      {textarea ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows || 3} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" />
      ) : (
        <input type={type || "text"} value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" />
      )}
    </label>
  );
}

// Ulozeny format ostava text "DD.MM.RRRR" (pouziva sa v tlaciach/CMR/emailoch),
// takze pisanie ostava rovnake ako doteraz - kalendar je len doplnkovy sposob zadania.
function DateField({ label, value, onChange }) {
  const nativeRef = useRef(null);
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>
      <div className="relative flex gap-1.5">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="DD.MM.RRRR"
          className="flex-1 border border-slate-200 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
        />
        <button
          type="button"
          title="Vybrat z kalendara"
          onClick={() => { const el = nativeRef.current; if (el && el.showPicker) el.showPicker(); }}
          className="border border-slate-200 rounded-md px-2.5 text-slate-500 hover:bg-slate-50 hover:text-teal-700"
        >
          <Calendar size={16} />
        </button>
        <input
          ref={nativeRef}
          type="date"
          value={isoFromSkDateStr(value)}
          onChange={(e) => onChange(skDateStrFromIso(e.target.value))}
          className="absolute right-0 top-0 w-0 h-0 opacity-0 pointer-events-none"
          tabIndex={-1}
          aria-hidden="true"
        />
      </div>
    </label>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function ToggleField({ label, value, onChange, yesLabel, noLabel }) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>
      <div className="flex gap-2">
        <button type="button" onClick={() => onChange(true)} className={"px-3 py-1.5 rounded-md text-sm border " + (value ? "bg-teal-700 text-white border-teal-700" : "border-slate-200 text-slate-600")}>{yesLabel}</button>
        <button type="button" onClick={() => onChange(false)} className={"px-3 py-1.5 rounded-md text-sm border " + (!value ? "bg-teal-700 text-white border-teal-700" : "border-slate-200 text-slate-600")}>{noLabel}</button>
      </div>
    </label>
  );
}

function SegmentedField({ label, value, onChange, options }) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button key={o.value} type="button" onClick={() => onChange(o.value)} className={"px-3 py-1.5 rounded-md text-sm border " + (value === o.value ? "bg-teal-700 text-white border-teal-700" : "border-slate-200 text-slate-600")}>{o.label}</button>
        ))}
      </div>
    </label>
  );
}

function MultiCheckField({ label, value, onChange, options }) {
  function toggle(v) {
    const set = new Set(value || []);
    if (set.has(v)) set.delete(v); else set.add(v);
    onChange([...set]);
  }
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const active = (value || []).includes(o.value);
          return (
            <button key={o.value} type="button" onClick={() => toggle(o.value)} className={"px-3 py-1.5 rounded-md text-sm border flex items-center gap-1.5 " + (active ? "bg-teal-700 text-white border-teal-700" : "border-slate-200 text-slate-600")}>
              {active && <CheckCircle2 size={14} />}
              {o.label}
            </button>
          );
        })}
      </div>
    </label>
  );
}

function ItemsTable({ items, setItems }) {
  function update(i, key, val) {
    const next = items.slice();
    next[i] = { ...next[i], [key]: val };
    setItems(next);
  }
  function remove(i) {
    setItems(items.filter((_, idx) => idx !== i));
  }
  function add() {
    setItems([...items, { popis: "", artikel: "", palet: "", karton: "" }]);
  }
  return (
    <div className="mb-3">
      <span className="block text-xs font-medium text-slate-500 mb-1">Polozky tovaru (pre dodaci list)</span>
      <div className="border border-slate-200 rounded-md overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-100 text-slate-600 text-left">
              <th className="px-2 py-1.5">Popis</th>
              <th className="px-2 py-1.5 w-24">Artikel</th>
              <th className="px-2 py-1.5 w-16">Palet</th>
              <th className="px-2 py-1.5 w-16">Karton</th>
              <th className="px-2 py-1.5 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-1 py-1"><input value={it.popis} onChange={(e) => update(i, "popis", e.target.value)} className="w-full border border-slate-200 rounded px-1.5 py-1" /></td>
                <td className="px-1 py-1"><input value={it.artikel} onChange={(e) => update(i, "artikel", e.target.value)} className="w-full border border-slate-200 rounded px-1.5 py-1" /></td>
                <td className="px-1 py-1"><input value={it.palet} onChange={(e) => update(i, "palet", e.target.value)} className="w-full border border-slate-200 rounded px-1.5 py-1" /></td>
                <td className="px-1 py-1"><input value={it.karton} onChange={(e) => update(i, "karton", e.target.value)} className="w-full border border-slate-200 rounded px-1.5 py-1" /></td>
                <td className="px-1 py-1 text-center">
                  <button onClick={() => remove(i)} className="text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={add} className="mt-1.5 text-xs text-teal-700 hover:text-teal-900 flex items-center gap-1"><Plus size={12} /> Pridat polozku</button>
    </div>
  );
}

function TabButton({ icon, label, active, onClick }) {
  return (
    <button onClick={onClick} className={"flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border " + (active ? "bg-slate-900 text-white border-slate-900" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>
      {icon}{label}
    </button>
  );
}

/* ---------------- Register ---------------- */

function RegisterView({ orders, carriers, customers, onNew, onOpenTransport, onOpenDelivery, onOpenPallet, onOpenCmr, onOpenNve, onEdit, onDelete, onExport, onToggleExpedicia }) {
  const [confirmDelete, setConfirmDelete] = useState(null);
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Objednavky</h1>
        <div className="flex gap-2">
          <button onClick={onExport} disabled={orders.length === 0} title={orders.length === 0 ? "Register je prazdny" : "Exportovat register do Excelu"} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-sm font-medium px-3 py-2 rounded-md">
            <Download size={16} /> Export do Excelu
          </button>
          <button onClick={onNew} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md">
            <Plus size={16} /> Nova objednavka
          </button>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-slate-500">
          <ClipboardList size={28} className="mx-auto mb-3 text-slate-300" />
          Zatial ziadne objednavky. Kliknite na "Nova objednavka" a vlozte text alebo subor.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-left">
                <th className="px-3 py-2 font-medium whitespace-nowrap">Cislo dopravy</th>
                <th className="px-3 py-2 font-medium">Zakaznik / miesto dodania</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">Dodanie</th>
                <th className="px-3 py-2 font-medium">Doprava</th>
                <th className="px-3 py-2 font-medium">Dodaci list</th>
                <th className="px-3 py-2 font-medium">Expedicia</th>
                <th className="px-3 py-2 font-medium text-right">Akcie</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const carrierMissing = carriers.length === 0;
                const emailMissing = !o.zakaznikEmail;
                const rowText = ((o.adresaDodaniaNazov || "") + " " + (o.adresaDodania || "")).toLowerCase();
                const rowTint = rowText.includes("netto") ? "bg-blue-50" : (rowText.includes("ehg") || rowText.includes("edeka")) ? "bg-red-50" : "";
                return (
                  <tr key={o.id} onClick={() => onEdit(o)} className={"border-t-2 border-slate-300 hover:brightness-95 cursor-pointer " + rowTint}>
                    <td className="px-3 py-2 font-medium whitespace-nowrap">
                      {o.cisloObjednavkyDopravy}
                      <div className="text-xs text-slate-400 font-normal">LS: {o.cisloDodaciehoListu}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div>{o.zakaznik || <span className="text-slate-400">-</span>}</div>
                      <div className="text-xs text-slate-400">{o.adresaDodaniaNazov}{o.adresaDodaniaNazov ? " - " : ""}{o.adresaDodania}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {o.datumDodania || <span className="text-slate-400">-</span>}
                      {o.casDodania && <div className="text-xs text-slate-400">{o.casDodania}</div>}
                    </td>
                    <td className="px-3 py-2"><Badge text={o.stavDopravy} map={STATUS_TRANSPORT} /></td>
                    <td className="px-3 py-2">
                      <Badge text={o.dodaciListOdoslany === "Ano" ? "Odoslany" : "Neodoslany"} map={{ Odoslany: "bg-emerald-100 text-emerald-700", Neodoslany: "bg-slate-100 text-slate-700" }} />
                    </td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => onToggleExpedicia(o)}
                        title="Kliknutim prepnete stav expedicie"
                        className={"text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap border border-transparent hover:brightness-95 " + (STATUS_EXPEDICIA[o.stavExpedicie] || STATUS_EXPEDICIA["Neexpedovana"])}
                      >
                        {o.stavExpedicie === "Expedovana" ? "Expedovana" : "Neexpedovana"}
                      </button>
                    </td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1 flex-wrap">
                        <IconButton
                          title={o.sposobDopravy === "vyzdvihnutie" ? "Zakaznik si tovar vyzdvihuje sam - doprava sa neobjednava" : carrierMissing ? "Najprv pridajte dopravcu v Nastaveniach" : o.dopravaOdoslanaInfo ? "Odoslane " + formatDateTime(o.dopravaOdoslanaInfo.datum) : "Objednavka dopravy"}
                          disabled={o.sposobDopravy === "vyzdvihnutie" || carrierMissing}
                          sent={!!o.dopravaOdoslanaInfo}
                          onClick={() => onOpenTransport(o)}
                        >
                          <Truck size={16} />
                        </IconButton>
                        <IconButton title={o.paletovyListokInfo ? "Pripravene " + formatDateTime(o.paletovyListokInfo.datum) : "Paletovy listok"} sent={!!o.paletovyListokInfo} onClick={() => onOpenPallet(o)}>
                          <Layers size={16} />
                        </IconButton>
                        <IconButton title={o.cmrInfo ? "Pripravene " + formatDateTime(o.cmrInfo.datum) : "CMR"} sent={!!o.cmrInfo} onClick={() => onOpenCmr(o)}>
                          <FileSignature size={16} />
                        </IconButton>
                        <IconButton title={o.dodaciListOdoslanaInfo ? "Odoslane " + formatDateTime(o.dodaciListOdoslanaInfo.datum) : emailMissing ? "Dodaci list (e-mail zakaznika doplnte v okne)" : "Dodaci list"} sent={!!o.dodaciListOdoslanaInfo} onClick={() => onOpenDelivery(o)}>
                          <FileText size={16} />
                        </IconButton>
                        <IconButton title={o.nveOdoslanaInfo ? "NVE list odoslany " + formatDateTime(o.nveOdoslanaInfo.datum) : o.nveListPath ? "NVE list nahraty - pripravit email" : "NVE list"} sent={!!o.nveOdoslanaInfo} onClick={() => onOpenNve(o)}>
                          <FileSpreadsheet size={16} />
                        </IconButton>
                        <IconButton title="Upravit / porovnat s PDF" onClick={() => onEdit(o)}><Pencil size={16} /></IconButton>
                        <IconButton title="Zmazat" onClick={() => setConfirmDelete(o)}><Trash2 size={16} /></IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {confirmDelete && (
        <ModalShell title="Zmazat objednavku?" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-slate-600 mb-4">
            Naozaj chcete zmazat objednavku <b>{confirmDelete.cisloObjednavkyDopravy}</b>
            {confirmDelete.zakaznik ? " (" + confirmDelete.zakaznik + ")" : ""}? Tuto akciu nie je mozne vratit spat.
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDelete(null)} className="text-sm text-slate-500 px-3 py-2">Zrusit</button>
            <button
              onClick={() => { onDelete(confirmDelete.id); setConfirmDelete(null); }}
              className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5"
            >
              <Trash2 size={16} /> Ano, zmazat
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

/* ---------------- New order ---------------- */

function PageShell({ title, onBack, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100">
        <button onClick={onBack} className="text-slate-400 hover:text-slate-700"><ArrowLeft size={18} /></button>
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function NewOrderPage({ onClose, onSave, suggestedNumber, defaultAdresaNakladky, customers, company }) {
  const [mode, setMode] = useState("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyItems, setBusyItems] = useState(false);
  const [error, setError] = useState("");
  const [extracted, setExtracted] = useState(null);
  const [sourceBlocks, setSourceBlocks] = useState(null);
  const fileInputRef = useRef(null);

  async function handleExtract() {
    setError("");
    if (mode === "manual") {
      setExtracted({
        ...EMPTY_ORDER,
        cisloObjednavky: suggestedNumber,
        datumPrijatia: todayStr(),
        adresaNakladky: defaultAdresaNakladky,
        zdrojDokument: null,
      });
      return;
    }
    setBusy(true);
    try {
      let blocks;
      let zdrojDokument = null;
      if (mode === "text") {
        if (!text.trim()) throw new Error("Vlozte text objednavky.");
        blocks = [{ type: "text", text: "TEXT OBJEDNAVKY:\n" + text }];
        zdrojDokument = { typ: "text", obsah: text };
      } else {
        if (!file) throw new Error("Vyberte subor.");
        if (file.type === "application/pdf") {
          const b64 = await fileToBase64(file);
          blocks = [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }];
          zdrojDokument = { typ: "pdf", mediaType: "application/pdf", data: b64, nazovSuboru: file.name };
        } else if (file.type.startsWith("image/")) {
          const b64 = await fileToBase64(file);
          blocks = [{ type: "image", source: { type: "base64", media_type: file.type, data: b64 } }];
          zdrojDokument = { typ: "image", mediaType: file.type, data: b64, nazovSuboru: file.name };
        } else if (file.name.endsWith(".docx")) {
          const buf = await file.arrayBuffer();
          const mammoth = await import("mammoth");
          const out = await mammoth.extractRawText({ arrayBuffer: buf });
          blocks = [{ type: "text", text: "TEXT OBJEDNAVKY:\n" + out.value }];
          zdrojDokument = { typ: "text", obsah: out.value, nazovSuboru: file.name };
        } else {
          throw new Error("Nepodporovany typ suboru. Pouzite PDF, DOCX alebo obrazok.");
        }
      }
      const result = await callClaude([...blocks, { type: "text", text: EXTRACT_INSTRUCTIONS }], company.apiKey);
      setSourceBlocks(blocks);
      setExtracted({
        ...EMPTY_ORDER,
        cisloObjednavky: suggestedNumber,
        datumPrijatia: todayStr(),
        adresaNakladky: defaultAdresaNakladky,
        ...result,
        paletyZpat: true,
        polozky: [],
        zdrojDokument,
      });
    } catch (e) {
      setError(e.message || "Extrakcia zlyhala.");
    }
    setBusy(false);
  }

  async function handleMatchItems() {
    const customer = customers.find((c) => c.id === extracted.zakaznikId);
    if (!customer || !customer.katalog || customer.katalog.length === 0 || !sourceBlocks) return;
    setBusyItems(true);
    setError("");
    try {
      const result = await callClaude([...sourceBlocks, { type: "text", text: buildItemsInstructions(customer.katalog) }], company.apiKey);
      setExtracted({ ...extracted, polozky: result.polozky || [] });
    } catch (e) {
      setError(e.message || "Priradenie polozok zlyhalo.");
    }
    setBusyItems(false);
  }

  if (extracted) {
    const customer = customers.find((c) => c.id === extracted.zakaznikId);
    return (
      <PageShell title="Skontrolujte udaje pred ulozenim" onBack={() => setExtracted(null)}>
        <div className="flex flex-col lg:flex-row gap-6">
        <div className="lg:w-1/2">
        <SelectField
          label="Zakaznik (odberatel)"
          value={extracted.zakaznikId}
          onChange={(v) => {
            const c = customers.find((x) => x.id === v);
            setExtracted({ ...extracted, zakaznikId: v, zakaznik: c ? c.nazov : extracted.zakaznik });
          }}
          options={[{ value: "", label: "-- nevybrane / doplnim rucne --" }, ...customers.map((c) => ({ value: c.id, label: c.nazov }))]}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
          <Field label="Nazov zakaznika (zobrazenie)" value={extracted.zakaznik} onChange={(v) => setExtracted({ ...extracted, zakaznik: v })} />
          <Field label="Cislo objednavky zakaznika (Belegnummer)" value={extracted.cisloObjednavkyZakaznika} onChange={(v) => setExtracted({ ...extracted, cisloObjednavkyZakaznika: v })} />
          <Field label="Kontaktna osoba" value={extracted.kontaktnaOsoba} onChange={(v) => setExtracted({ ...extracted, kontaktnaOsoba: v })} />
          <Field label="E-mail" value={extracted.zakaznikEmail} onChange={(v) => setExtracted({ ...extracted, zakaznikEmail: v })} />
          <Field label="Nazov miesta dodania" value={extracted.adresaDodaniaNazov} onChange={(v) => setExtracted({ ...extracted, adresaDodaniaNazov: v })} />
          <Field label="Adresa dodania" value={extracted.adresaDodania} onChange={(v) => setExtracted({ ...extracted, adresaDodania: v })} />
          <DateField label="Datum dodania" value={extracted.datumDodania} onChange={(v) => setExtracted({ ...extracted, datumDodania: v })} />
          <Field label="Cas dodania" value={extracted.casDodania} onChange={(v) => setExtracted({ ...extracted, casDodania: v })} />
          <Field label="Mercareon / Transporeon ref. (ORDER-N° retazca)" value={extracted.mercareonRef} onChange={(v) => setExtracted({ ...extracted, mercareonRef: v })} />
          <Field label="Pocet paliet (kusov)" value={extracted.pocetPaliet} onChange={(v) => setExtracted({ ...extracted, pocetPaliet: v })} />
          <Field label="Pocet paletovych miest (double stack)" value={extracted.pocetPaletovychMiest} onChange={(v) => setExtracted({ ...extracted, pocetPaletovychMiest: v })} />
          <Field label="Pocet kartonov (celkovo)" value={extracted.pocetKartonov} onChange={(v) => setExtracted({ ...extracted, pocetKartonov: v })} />
          <Field label="Hmotnost (kg)" value={extracted.hmotnost} onChange={(v) => setExtracted({ ...extracted, hmotnost: v })} />
        </div>
        <ToggleField label="Sposob dopravy" value={extracted.sposobDopravy !== "vyzdvihnutie"} onChange={(v) => setExtracted({ ...extracted, sposobDopravy: v ? "doprava" : "vyzdvihnutie" })} yesLabel="Doprava (zabezpecujeme my)" noLabel="Vyzdvihnutie zakaznikom" />
        <ToggleField label="Palety zpet" value={extracted.paletyZpat} onChange={(v) => setExtracted({ ...extracted, paletyZpat: v })} yesLabel="Ano" noLabel="Nie" />
        <Field label="Popis tovaru (volny text)" value={extracted.popisTovaru} onChange={(v) => setExtracted({ ...extracted, popisTovaru: v })} textarea />
        <Field label="Poznamka" value={extracted.poznamka} onChange={(v) => setExtracted({ ...extracted, poznamka: v })} textarea />

        {customer && customer.katalog && customer.katalog.length > 0 && (
          <button onClick={handleMatchItems} disabled={busyItems} className="mb-3 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-md flex items-center gap-1.5">
            {busyItems ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
            {busyItems ? "Priradujem..." : "Priradit polozky z katalogu (AI)"}
          </button>
        )}
        <ItemsTable items={extracted.polozky} setItems={(items) => setExtracted({ ...extracted, polozky: items })} />

        {error && <div className="mb-3 bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={16} /> {error}</div>}

        <div className="flex justify-between items-center mt-4 pb-2">
          <button onClick={() => setExtracted(null)} className="text-sm text-slate-500 flex items-center gap-1 hover:text-slate-800"><ArrowLeft size={14} /> Spat</button>
          <button onClick={() => onSave(extracted)} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5"><CheckCircle2 size={16} /> Ulozit do registra</button>
        </div>
        </div>
        <div className="lg:w-1/2">
          <div className="lg:sticky lg:top-4">
            <span className="block text-xs font-medium text-slate-500 mb-1">Povodny dokument (na porovnanie)</span>
            <DocumentPreview zdrojDokument={extracted.zdrojDokument} />
          </div>
        </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="Nova objednavka" onBack={onClose}>
      <div className="flex gap-2 mb-4">
        <TabButton icon={<Clipboard size={14} />} label="Vlozit text" active={mode === "text"} onClick={() => setMode("text")} />
        <TabButton icon={<Upload size={14} />} label="Nahrat subor" active={mode === "file"} onClick={() => setMode("file")} />
        <TabButton icon={<Pencil size={14} />} label="Vlozit objednavku manualne" active={mode === "manual"} onClick={() => setMode("manual")} />
      </div>
      {mode === "text" && (
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} placeholder="Sem vlozte text objednavky z e-mailu..." className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" />
      )}
      {mode === "file" && (
        <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-slate-200 rounded-lg p-10 text-center text-slate-500 cursor-pointer hover:border-teal-400 hover:text-teal-700">
          <Upload size={24} className="mx-auto mb-2" />
          {file ? file.name : "Kliknite pre vyber suboru (PDF, DOCX, obrazok)"}
          <input ref={fileInputRef} type="file" accept=".pdf,.docx,image/*,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files[0] || null)} />
        </div>
      )}
      {mode === "manual" && (
        <div className="border border-slate-200 rounded-lg p-6 text-center text-slate-500 text-sm">
          Otvori sa prazdny formular objednavky, ktory vyplnite rucne (bez automatického rozpoznávania z dokumentu).
        </div>
      )}
      {error && <div className="mt-3 bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={16} /> {error}</div>}
      <div className="flex justify-between mt-4 pb-2">
        <button onClick={onClose} className="text-sm text-slate-500 px-3 py-2">Zrusit</button>
        <button onClick={handleExtract} disabled={busy} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
          {busy ? "Spracovavam..." : mode === "manual" ? "Pokracovat na formular" : "Spracovat udaje"}
        </button>
      </div>
    </PageShell>
  );
}

function base64ToBlobUrl(base64, mediaType) {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: mediaType });
  return URL.createObjectURL(blob);
}

function PdfPreview({ zdrojDokument }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let url = null;
    try {
      url = base64ToBlobUrl(zdrojDokument.data, "application/pdf");
      setBlobUrl(url);
    } catch (e) {
      setFailed(true);
    }
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [zdrojDokument.data]);

  return (
    <div>
      <div className="text-xs text-slate-500 mb-1">{zdrojDokument.nazovSuboru || "objednavka.pdf"}</div>
      <div className="flex gap-2 mb-2">
        <a
          href={blobUrl || "#"}
          target="_blank"
          rel="noreferrer"
          className={"text-xs px-2 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1 " + (!blobUrl ? "opacity-50 pointer-events-none" : "")}
        >
          Otvorit PDF v novej karte
        </a>
        <a
          href={blobUrl || "#"}
          download={zdrojDokument.nazovSuboru || "objednavka.pdf"}
          className={"text-xs px-2 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1 " + (!blobUrl ? "opacity-50 pointer-events-none" : "")}
        >
          Stiahnut PDF
        </a>
      </div>
      {blobUrl && !failed ? (
        <iframe
          src={blobUrl}
          title="Zdrojova objednavka PDF"
          style={{ width: "100%", height: "65vh", border: "1px solid #e2e8f0", borderRadius: "6px" }}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="text-xs text-slate-400 border border-dashed border-slate-200 rounded-md p-6 text-center">
          Nahlad sa nepodarilo zobrazit priamo tu - pouzite tlacidlo "Otvorit v novej karte" vyssie.
        </div>
      )}
    </div>
  );
}

function DocumentPreview({ zdrojDokument }) {
  if (!zdrojDokument) {
    return (
      <div className="text-xs text-slate-400 border border-dashed border-slate-200 rounded-md p-6 text-center">
        K tejto objednavke nie je ulozeny zdrojovy dokument (bola pravdepodobne vytvorena rucne).
      </div>
    );
  }
  if (zdrojDokument.typ === "pdf") {
    return <PdfPreview zdrojDokument={zdrojDokument} />;
  }
  if (zdrojDokument.typ === "image") {
    return (
      <div>
        <div className="text-xs text-slate-500 mb-1">{zdrojDokument.nazovSuboru || "objednavka"}</div>
        <img src={`data:${zdrojDokument.mediaType};base64,${zdrojDokument.data}`} alt="Zdrojova objednavka" className="w-full rounded-md border border-slate-200" />
      </div>
    );
  }
  return (
    <div>
      <div className="text-xs text-slate-500 mb-1">{zdrojDokument.nazovSuboru || "Vlozeny text objednavky"}</div>
      <pre className="text-xs whitespace-pre-wrap bg-slate-50 border border-slate-200 rounded-md p-3" style={{ maxHeight: "70vh", overflowY: "auto" }}>{zdrojDokument.obsah}</pre>
    </div>
  );
}

function EditOrderPage({ order, customers, onClose, onSave }) {
  const [f, setF] = useState({ ...order });
  return (
    <PageShell title={"Upravit objednavku " + order.cisloObjednavkyDopravy} onBack={onClose}>
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="lg:w-1/2">
          <SelectField label="Zakaznik (odberatel)" value={f.zakaznikId} onChange={(v) => { const c = customers.find((x) => x.id === v); setF({ ...f, zakaznikId: v, zakaznik: c ? c.nazov : f.zakaznik }); }} options={[{ value: "", label: "-- nevybrane --" }, ...customers.map((c) => ({ value: c.id, label: c.nazov }))]} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <Field label="Nazov zakaznika" value={f.zakaznik} onChange={(v) => setF({ ...f, zakaznik: v })} />
            <Field label="Cislo objednavky zakaznika (Belegnummer)" value={f.cisloObjednavkyZakaznika} onChange={(v) => setF({ ...f, cisloObjednavkyZakaznika: v })} />
            <Field label="Kontaktna osoba" value={f.kontaktnaOsoba} onChange={(v) => setF({ ...f, kontaktnaOsoba: v })} />
            <Field label="E-mail" value={f.zakaznikEmail} onChange={(v) => setF({ ...f, zakaznikEmail: v })} />
            <Field label="Nazov miesta dodania" value={f.adresaDodaniaNazov} onChange={(v) => setF({ ...f, adresaDodaniaNazov: v })} />
            <Field label="Adresa dodania" value={f.adresaDodania} onChange={(v) => setF({ ...f, adresaDodania: v })} />
            <Field label="Adresa nakladky" value={f.adresaNakladky} onChange={(v) => setF({ ...f, adresaNakladky: v })} />
            <DateField label="Datum dodania" value={f.datumDodania} onChange={(v) => setF({ ...f, datumDodania: v })} />
            <Field label="Cas dodania" value={f.casDodania} onChange={(v) => setF({ ...f, casDodania: v })} />
            <Field label="Mercareon / Transporeon ref. (ORDER-N° retazca)" value={f.mercareonRef} onChange={(v) => setF({ ...f, mercareonRef: v })} />
            <Field label="Cislo nemeckeho dodacieho listu (Lieferschein DE od kolegov)" value={f.nemeckyDodakCislo || ""} onChange={(v) => setF({ ...f, nemeckyDodakCislo: v })} />
            <Field label="Pocet paliet (kusov)" value={f.pocetPaliet} onChange={(v) => setF({ ...f, pocetPaliet: v })} />
            <Field label="Pocet paletovych miest (double stack)" value={f.pocetPaletovychMiest} onChange={(v) => setF({ ...f, pocetPaletovychMiest: v })} />
            <Field label="Pocet kartonov (celkovo)" value={f.pocetKartonov} onChange={(v) => setF({ ...f, pocetKartonov: v })} />
            <Field label="Vyska palety (cm)" value={f.vyskaPalety} onChange={(v) => setF({ ...f, vyskaPalety: v })} />
            <Field label="Hmotnost (kg)" value={f.hmotnost} onChange={(v) => setF({ ...f, hmotnost: v })} />
          </div>
          <ToggleField label="Sposob dopravy" value={f.sposobDopravy !== "vyzdvihnutie"} onChange={(v) => setF({ ...f, sposobDopravy: v ? "doprava" : "vyzdvihnutie", stavDopravy: v ? (f.stavDopravy === "Vyzdvihnutie" ? "Neobjednana" : f.stavDopravy) : "Vyzdvihnutie" })} yesLabel="Doprava (zabezpecujeme my)" noLabel="Vyzdvihnutie zakaznikom" />
          <ToggleField label="Palety zpet" value={f.paletyZpat} onChange={(v) => setF({ ...f, paletyZpat: v })} yesLabel="Ano" noLabel="Nie" />
          <Field label="Popis tovaru (volny text)" value={f.popisTovaru} onChange={(v) => setF({ ...f, popisTovaru: v })} textarea />
          <Field label="Poznamka" value={f.poznamka} onChange={(v) => setF({ ...f, poznamka: v })} textarea />
          <ItemsTable items={f.polozky || []} setItems={(items) => setF({ ...f, polozky: items })} />
          <div className="flex justify-between mt-2 pb-2">
            <button onClick={onClose} className="text-sm text-slate-500 px-3 py-2">Zrusit</button>
            <button onClick={() => onSave(f)} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Ulozit zmeny</button>
          </div>
        </div>
        <div className="lg:w-1/2">
          <div className="lg:sticky lg:top-4">
            <span className="block text-xs font-medium text-slate-500 mb-1">Povodny dokument (na porovnanie)</span>
            <DocumentPreview zdrojDokument={f.zdrojDokument} />
          </div>
        </div>
      </div>
    </PageShell>
  );
}

/* ---------------- Transport order (email) ---------------- */

function EmailQuickPicks({ emaily, onPick }) {
  if (!emaily || emaily.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {emaily.map((e, i) => (
        <button key={i} type="button" onClick={() => onPick(e.email)} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded-md">
          {e.label}: {e.email}
        </button>
      ))}
    </div>
  );
}

function TransportModal({ order, carriers, company, onClose, onSent }) {
  const last = order.dopravaOdoslanaInfo;
  const [carrierId, setCarrierId] = useState(order.dopravcaId || (carriers[0] ? carriers[0].id : ""));
  const carrier = carriers.find((c) => c.id === carrierId);
  const [to, setTo] = useState(last ? last.to : (carrier ? carrier.email : ""));
  function pickCarrier(id) {
    setCarrierId(id);
    if (!last) {
      const c = carriers.find((x) => x.id === id);
      setTo(c ? c.email : "");
    }
  }
  const [subject, setSubject] = useState(last ? last.subject : `Objednavka prepravy c. ${order.cisloObjednavkyDopravy}`);
  const [body, setBody] = useState(
    last ? last.body :
    `${company.nazov || "[Nazov spolocnosti]"}\n` +
    `IC: ${company.ico || ""}  DIC: ${company.dic || ""}  TEL: ${company.tel || ""}\n\n` +
    `PRO: ${carrier ? carrier.nazov : "[dopravca]"}  NEOZNAMOVAT ODESILATELE!!\n\n` +
    `OBJEDNAVKA C. ${order.cisloObjednavkyDopravy}\n\n` +
    `Objednavam: DOPRAVU na ${order.pocetPaliet || "[doplnte]"} europalet` +
    (order.pocetPaletovychMiest ? ` (${order.pocetPaletovychMiest} paletovych miest)` : "") +
    (order.vyskaPalety ? `, vyska palety ${order.vyskaPalety} cm` : "") +
    `, hmotnost ${order.hmotnost || "[doplnte]"} kg.\n` +
    (order.pocetKartonov ? `Pocet kartonov: ${order.pocetKartonov}\n` : "") +
    `Palety zpet: ${order.paletyZpat ? "ANO" : "NE"}\n` +
    (order.mercareonRef ? `Mercareon/Transporeon ref.: ${order.mercareonRef}\n` : "") +
    `\nNAKLADKA: ${company.nazov || "[Nazov spolocnosti]"}\n${company.adresa || ""}\n` +
    `Datum nakladky: ${nakladkaDateFromDodanie(order.datumDodania)}\n\n` +
    `VYKLADKA: ${order.datumDodania || "[doplnte]"}${order.casDodania ? " cas: " + order.casDodania : ""}\n` +
    `${order.adresaDodaniaNazov || ""}\n${order.adresaDodania || ""}\n\n` +
    `Poznamka: ${order.poznamka || ""}\n\n` +
    `Cena: - EUR\n\n` +
    `${company.kontaktnaOsoba || ""}\n${company.nazov || ""}\n${company.email || ""}\n${company.tel || ""}`
  );

  return (
    <ModalShell title={"Objednavka dopravy - " + order.cisloObjednavkyDopravy} onClose={onClose} extraWide>
      {last && <div className="mb-3 bg-emerald-50 text-emerald-800 text-xs px-3 py-2 rounded-md flex items-center gap-2"><CheckCircle2 size={14} /> Naposledy odoslane {formatDateTime(last.datum)} na {last.to}</div>}
      <SelectField label="Dopravca" value={carrierId} onChange={pickCarrier} options={carriers.map((c) => ({ value: c.id, label: `${c.nazov} (${c.email})` }))} />
      <EmailQuickPicks emaily={carrier ? carrier.emaily : []} onPick={setTo} />
      <Field label="E-mail (komu)" value={to} onChange={setTo} type="email" />
      <Field label="Predmet" value={subject} onChange={setSubject} />
      <Field label="Text spravy" value={body} onChange={setBody} textarea rows={18} />
      <div className="flex justify-end gap-2 mt-2">
        <button onClick={onClose} className="text-sm text-slate-500 px-3 py-2">Zrusit</button>
        <a href={to ? buildMailto(to, subject, body) : "#"} onClick={() => to && onSent(carrierId, { subject, body, to, datum: new Date().toISOString() })} className={"bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5 " + (!to ? "opacity-50 pointer-events-none" : "")}>
          <Truck size={16} /> Odoslat dopravcovi
        </a>
      </div>
    </ModalShell>
  );
}

/* ---------------- Dodaci list / Lieferschein (email) ---------------- */

function LieferscheinPrintTable({ id, company, customer, order, carrierName, transportPrice }) {
  const row = { display: "flex", borderBottom: "1px solid #ddd", padding: "2px 0" };
  const left = { width: "50%", paddingRight: "8px" };
  const right = { width: "50%" };
  const items = ((order.polozky && order.polozky.length > 0) ? order.polozky : [{ popis: order.popisTovaru || "", artikel: "", palet: order.pocetPaliet || "", karton: order.pocetKartonov || "", detail: "" }])
    .map((it) => {
      if (it.detail) return it;
      const match = customer && customer.katalog ? customer.katalog.find((k) => k.artikel && k.artikel === it.artikel) : null;
      return match ? { ...it, detail: match.detail || "" } : it;
    });
  return (
    <div id={id} className="print-only-content">
      <div style={{ fontFamily: "Arial, sans-serif", fontSize: "11px", color: "#111", maxWidth: "760px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ fontWeight: "bold" }}>{company.nazov}</div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "9px", color: "#777" }}>obj. dopravy: {order.cisloObjednavkyDopravy}</div>
            <div style={{ fontWeight: "bold", fontSize: "16px" }}>LIEFERSCHEIN <span style={{ fontWeight: "normal", fontSize: "12px" }}>Nr: {order.cisloDodaciehoListu}</span></div>
            {transportPrice && (
              <div style={{ fontSize: "11px", marginTop: "2px" }}>
                Cena dopravy:{" "}
                {transportPrice.matched ? (
                  <b>{formatEur(transportPrice.total)}</b>
                ) : (
                  <span style={{ color: "#b45309" }}>neurcena{transportPrice.reason ? " (" + transportPrice.reason + ")" : ""}</span>
                )}
              </div>
            )}
          </div>
        </div>

        <div style={{ marginTop: "8px", textAlign: "right" }}>
          <div style={{ fontStyle: "italic", fontSize: "10px" }}>Lieferadresse/adresa dodani</div>
          <div style={{ fontWeight: "bold" }}>{order.adresaDodaniaNazov}</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{order.adresaDodania}</div>
        </div>

        <div style={{ display: "flex", marginTop: "12px", gap: "16px" }}>
          <div style={{ width: "50%" }}>
            <div style={{ fontWeight: "bold" }}>LIEFERANT:</div>
            <div>{company.nazov}</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{company.adresa}</div>
            <div>IČO: {company.ico}</div>
            <div>DIČ: {company.dic}</div>
          </div>
          <div style={{ width: "50%" }}>
            <div style={{ fontWeight: "bold" }}>ABNEHMER/ODBĚRATEL</div>
            <div>{customer ? customer.nazov : order.zakaznik}</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{customer ? customer.adresa : ""}</div>
            <div>{customer && customer.dic ? "Ust.-Id Nr. " + customer.dic : ""}</div>
          </div>
        </div>

        <div style={{ ...row, marginTop: "12px" }}>
          <div style={left}>Lieferungstag: <b>{order.datumDodania}</b></div>
          <div style={right}>Bestellung: <b>{order.cisloObjednavkyZakaznika}</b></div>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "10px", fontSize: "10.5px" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #333", textAlign: "left" }}>
              <th style={{ padding: "3px" }}>Palet</th>
              <th style={{ padding: "3px" }}>Karton</th>
              <th style={{ padding: "3px" }}>BEZEICHNUNG</th>
              <th style={{ padding: "3px" }}>STK</th>
              <th style={{ padding: "3px" }}>ARTIKEL LIEF.NUM.</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #eee", verticalAlign: "top" }}>
                <td style={{ padding: "3px" }}>{it.palet}</td>
                <td style={{ padding: "3px" }}>{it.karton}</td>
                <td style={{ padding: "3px" }}>
                  <div>{it.popis}</div>
                  {it.detail && <div style={{ fontSize: "9px", color: "#555", whiteSpace: "pre-wrap" }}>{it.detail}</div>}
                </td>
                <td style={{ padding: "3px" }}></td>
                <td style={{ padding: "3px" }}>{it.artikel}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginTop: "14px", fontWeight: "bold" }}>
          {order.pocetPaletovychMiest || 0} Doppelstockpal. = {order.pocetPaliet || 0} europaletten = {order.pocetPaletovychMiest || 0} stallplätze
        </div>

        <div style={{ display: "flex", marginTop: "20px", gap: "16px" }}>
          <div style={{ width: "33%" }}>
            <div>vystavil/ausgestellt von:</div>
            <div>{company.kontaktnaOsoba} {company.email ? "(" + company.email + ")" : ""}</div>
          </div>
          <div style={{ width: "33%" }}>
            <div>TRANSPORT: {carrierName || ""}</div>
            <div>NUMBER TRUCK: ________________</div>
            <div style={{ marginTop: "6px" }}>EUROPALETTEN</div>
            <div>ACCEPTED: ______</div>
            <div>RELEASSED: ______</div>
            <div>DEBT: ______</div>
          </div>
          <div style={{ width: "33%" }}>
            <div>odběratel / abnehmer:</div>
            <div style={{ marginTop: "30px" }}>podpis: ________________</div>
          </div>
        </div>
      </div>
    </div>
  );
}
function buildLieferscheinHtml({ company, customer, order, carrierName, transportPrice }) {
  const items = ((order.polozky && order.polozky.length > 0) ? order.polozky : [{ popis: order.popisTovaru || "", artikel: "", palet: order.pocetPaliet || "", karton: order.pocetKartonov || "", detail: "" }])
    .map((it) => {
      if (it.detail) return it;
      const match = customer && customer.katalog ? customer.katalog.find((k) => k.artikel && k.artikel === it.artikel) : null;
      return match ? { ...it, detail: match.detail || "" } : it;
    });
  const itemRows = items.map((it) => `
    <tr style="border-bottom:1px solid #eee;vertical-align:top;">
      <td style="padding:3px;">${it.palet || ""}</td>
      <td style="padding:3px;">${it.karton || ""}</td>
      <td style="padding:3px;"><div>${it.popis || ""}</div>${it.detail ? `<div style="font-size:9px;color:#555;white-space:pre-wrap;">${it.detail}</div>` : ""}</td>
      <td style="padding:3px;"></td>
      <td style="padding:3px;">${it.artikel || ""}</td>
    </tr>`).join("");
  return `
    <div style="font-family:Arial,sans-serif;font-size:11px;color:#111;max-width:760px;">
      <div style="display:flex;justify-content:space-between;">
        <div style="font-weight:bold;">${company.nazov || ""}</div>
        <div style="text-align:right;">
          <div style="font-size:9px;color:#777;">obj. dopravy: ${order.cisloObjednavkyDopravy}</div>
          <div style="font-weight:bold;font-size:16px;">LIEFERSCHEIN <span style="font-weight:normal;font-size:12px;">Nr: ${order.cisloDodaciehoListu}</span></div>
          ${transportPrice ? `<div style="font-size:11px;margin-top:2px;">Cena dopravy: ${transportPrice.matched ? `<b>${formatEur(transportPrice.total)}</b>` : `<span style="color:#b45309;">neurcena${transportPrice.reason ? " (" + transportPrice.reason + ")" : ""}</span>`}</div>` : ""}
        </div>
      </div>
      <div style="margin-top:8px;text-align:right;">
        <div style="font-style:italic;font-size:10px;">Lieferadresse/adresa dodani</div>
        <div style="font-weight:bold;">${order.adresaDodaniaNazov || ""}</div>
        <div style="white-space:pre-wrap;">${order.adresaDodania || ""}</div>
      </div>
      <div style="display:flex;margin-top:12px;gap:16px;">
        <div style="width:50%;">
          <div style="font-weight:bold;">LIEFERANT:</div>
          <div>${company.nazov || ""}</div>
          <div style="white-space:pre-wrap;">${company.adresa || ""}</div>
          <div>IČO: ${company.ico || ""}</div>
          <div>DIČ: ${company.dic || ""}</div>
        </div>
        <div style="width:50%;">
          <div style="font-weight:bold;">ABNEHMER/ODBĚRATEL</div>
          <div>${customer ? customer.nazov : (order.zakaznik || "")}</div>
          <div style="white-space:pre-wrap;">${customer ? customer.adresa || "" : ""}</div>
          <div>${customer && customer.dic ? "Ust.-Id Nr. " + customer.dic : ""}</div>
        </div>
      </div>
      <div style="display:flex;border-bottom:1px solid #ddd;padding:2px 0;margin-top:12px;">
        <div style="width:50%;">Lieferungstag: <b>${order.datumDodania || ""}</b></div>
        <div style="width:50%;">Bestellung: <b>${order.cisloObjednavkyZakaznika || ""}</b></div>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:10.5px;">
        <thead><tr style="border-bottom:2px solid #333;text-align:left;">
          <th style="padding:3px;">Palet</th><th style="padding:3px;">Karton</th><th style="padding:3px;">BEZEICHNUNG</th><th style="padding:3px;">STK</th><th style="padding:3px;">ARTIKEL LIEF.NUM.</th>
        </tr></thead>
        <tbody>${itemRows}</tbody>
      </table>
      <div style="margin-top:14px;font-weight:bold;">
        ${order.pocetPaletovychMiest || 0} Doppelstockpal. = ${order.pocetPaliet || 0} europaletten = ${order.pocetPaletovychMiest || 0} stallplätze
      </div>
      <div style="display:flex;margin-top:20px;gap:16px;">
        <div style="width:33%;"><div>vystavil/ausgestellt von:</div><div>${company.kontaktnaOsoba || ""} ${company.email ? "(" + company.email + ")" : ""}</div></div>
        <div style="width:33%;"><div>TRANSPORT: ${carrierName || ""}</div><div>NUMBER TRUCK: ________________</div><div style="margin-top:6px;">EUROPALETTEN</div><div>ACCEPTED: ______</div><div>RELEASSED: ______</div><div>DEBT: ______</div></div>
        <div style="width:33%;"><div>odběratel / abnehmer:</div><div style="margin-top:30px;">podpis: ________________</div></div>
      </div>
    </div>`;
}

function DeliveryModal({ order, customers, carriers, company, pricelist, onClose, onSent }) {
  const last = order.dodaciListOdoslanaInfo;
  const customer = customers.find((c) => c.id === order.zakaznikId);
  const carrier = carriers.find((c) => c.id === order.dopravcaId);
  const printId = "print-lieferschein-" + order.id;
  const defaultEmail = (customer && customer.email) ? customer.email : (order.zakaznikEmail || "");
  const [email, setEmail] = useState(last ? last.to : defaultEmail);
  const [subject, setSubject] = useState(last ? last.subject : `Lieferschein / Dodaci list c. ${order.cisloDodaciehoListu}`);
  const transportPrice = computeTransportPrice(order, pricelist, extractCityFromAddress);

  function buildItemsLines() {
    if (order.polozky && order.polozky.length > 0) {
      return order.polozky.map((it) => `  ${it.popis}${it.artikel ? " (art. " + it.artikel + ")" : ""} - Palet: ${it.palet || "0"}, Karton: ${it.karton || "0"}`).join("\n");
    }
    return `  ${order.popisTovaru || "[doplnte]"} - ${order.mnozstvo || ""}`;
  }

  const [body, setBody] = useState(
    last ? last.body :
    `${company.nazov || "[Nazov spolocnosti]"}\n${company.adresa || ""}\n\n` +
    `LIEFERSCHEIN / DODACI LIST  Nr: ${order.cisloDodaciehoListu}\n` +
    `(objednavka dopravy c.: ${order.cisloObjednavkyDopravy})\n\n` +
    `Lieferadresse / adresa dodani:\n${order.adresaDodaniaNazov || ""}\n${order.adresaDodania || ""}\n\n` +
    `Abnehmer / odberatel:\n${customer ? customer.nazov : (order.zakaznik || "")}\n${customer ? customer.adresa : ""}\n${customer && customer.dic ? "Ust.-Id Nr. " + customer.dic : ""}\n\n` +
    `Lieferungstag / datum dodania: ${order.datumDodania || "[doplnte]"}\n` +
    `Bestellung / cislo objednavky zakaznika: ${order.cisloObjednavkyZakaznika || "[doplnte]"}\n\n` +
    `TOVAR:\n${buildItemsLines()}\n\n` +
    `Celkovy pocet paliet: ${order.pocetPaliet || ""}${order.pocetKartonov ? "   Celkovy pocet kartonov: " + order.pocetKartonov : ""}\n\n` +
    `Poznamka: ${order.poznamka || ""}\n\n` +
    `Cena dopravy: ${transportPrice.matched ? formatEur(transportPrice.total) : "neurcena (" + transportPrice.reason + ")"}\n\n` +
    `vystavil: ${company.kontaktnaOsoba || ""} (${company.email || ""})`
  );

  function handlePrint() {
    setTimeout(() => window.print(), 50);
  }
  function handleDownload() {
    const html = buildLieferscheinHtml({ company, customer, order, carrierName: carrier ? carrier.nazov : "", transportPrice });
    downloadHtml(`Lieferschein_${order.cisloDodaciehoListu.replace("/", "-")}.html`, html);
  }

  return (
    <ModalShell title={"Dodaci list - " + order.cisloDodaciehoListu} onClose={onClose} wide>
      <LieferscheinPrintTable id={printId} company={company} customer={customer} order={order} carrierName={carrier ? carrier.nazov : ""} transportPrice={transportPrice} />
      {last && <div className="mb-3 bg-emerald-50 text-emerald-800 text-xs px-3 py-2 rounded-md flex items-center gap-2"><CheckCircle2 size={14} /> Naposledy odoslane {formatDateTime(last.datum)} na {last.to}</div>}
      <p className="text-xs text-slate-400 mb-3">Nahlad hore zodpoveda presnemu formatu vasho Lieferscheinu - "Stiahnut" ulozi rovnaky vzhlad ako .html. E-mail nizsie sa posiela kolegom v Nemecku ako obycajny text (mailto nepodporuje formatovanu prilohu).</p>
      <EmailQuickPicks emaily={customer ? customer.emaily : []} onPick={setEmail} />
      <Field label="E-mail (kolegovia v Nemecku)" value={email} onChange={setEmail} type="email" />
      <Field label="Predmet" value={subject} onChange={setSubject} />
      <Field label="Text spravy (e-mail)" value={body} onChange={setBody} textarea />
      <div className="flex justify-end gap-2 mt-2 flex-wrap">
        <button onClick={onClose} className="text-sm text-slate-500 px-3 py-2">Zrusit</button>
        <button onClick={handleDownload} className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5"><Download size={16} /> Stiahnut</button>
        <button onClick={handlePrint} className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5"><Printer size={16} /> Vytlacit</button>
        <a href={email ? buildMailto(email, subject, body) : "#"} onClick={() => email && onSent(email, { subject, body, to: email, datum: new Date().toISOString() })} className={"bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5 " + (!email ? "opacity-50 pointer-events-none" : "")}>
          <FileText size={16} /> Odoslat mailom
        </a>
      </div>
    </ModalShell>
  );
}

/* ---------------- Paletovy listok (print only) ---------------- */

function buildPalletHtml({ cislo, nalozeno, miesto }) {
  const L = "width:58%;padding-right:10px;";
  const R = "width:42%;";
  const row = "display:flex;padding:3px 0;border-bottom:1px solid #ddd;";
  return `
    <div style="font-family:Arial,sans-serif;color:#111;max-width:760px;">
      <div style="text-align:center;font-weight:bold;font-size:11pt;">ЦЕЙ ДОКУМЕНТ ТІЛЬКИ ДЛЯ BESTPOP, s.r.o. та ДОРИС, с.р.о.</div>
      <div style="text-align:center;font-size:14pt;">TENTO DOKUMENT JE POUZE PRO FIRMU STENGER CZECH,s.r.o. a DORYS, s.r.o.</div>
      <div style="text-align:center;font-weight:bold;font-size:14pt;margin-bottom:10px;">ЦЕЙ ДОКУМЕНТ ЛИШЕ ДЛЯ STENGER CZECH, s.r.o. та DORYS, s.r.o.</div>

      <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:14pt;border-bottom:2px solid #333;padding-bottom:6px;margin-bottom:6px;">
        <span>PALETOVÝ LIST // ЛИСТ ПІДДОНА</span>
        <span>číslo: <b>${cislo}</b></span>
      </div>
      <div style="text-align:center;font-size:14pt;margin-bottom:10px;">STENGER CZECH,s.r.o. → DORYS CZ,s.r.o. →STENGER CZECH,s.r.o.</div>

      <div style="text-align:center;font-weight:bold;font-size:16pt;">ŘIDIČ MUSÍ // ВОДІЙ ПОВИНЕН</div>
      <div style="text-align:center;font-weight:bold;font-size:14pt;margin-bottom:10px;">↓ V Y P L N I T ↓ В Й П Л Н І Т ↓</div>

      <div style="${row}font-size:12pt;">
        <div style="${L}text-align:center;">V STENGER CZECH, s.r.o.</div>
        <div style="${R}text-align:center;font-weight:bold;">Řidič(tiskace)/ВОДІЙ(шрифт друку):</div>
      </div>
      <div style="${row}font-size:12pt;align-items:center;">
        <div style="${L}">NALOŽENO EUROPALET: <b style="font-size:18pt;">${nalozeno}</b></div>
        <div style="${R}"></div>
      </div>
      <div style="${row}font-size:12pt;">
        <div style="${L}">Místo doručení: <b style="font-size:11pt;">${miesto}</b></div>
        <div style="${R}"></div>
      </div>
      <div style="${row}font-size:12pt;">
        <div style="${L}">Číslo objednávky : ${cislo}</div>
        <div style="${R}">RZ:</div>
      </div>

      <div style="height:16px;"></div>

      <div style="${row}font-size:12pt;">
        <div style="${L}text-align:center;">ZÁKAZNÍK:</div>
        <div style="${R}">Řidič musí dopsat vyzvednuté europalety u zákazníka(na vykládce)</div>
      </div>
      <div style="${row}font-size:12pt;align-items:center;">
        <div style="${L}">Složeno europalet: ${nalozeno}</div>
        <div style="${R}text-align:center;font-size:22pt;">NEBRAT MODRÉ EUROPALETY</div>
      </div>
      <div style="${row}font-size:12pt;font-weight:bold;">
        <div style="width:100%;">Přijato od zákazníka prázdných europalet: ______ kusů</div>
      </div>

      <div style="height:16px;"></div>

      <div style="${row}font-size:12pt;">
        <div style="${L}text-align:center;">DORYS,s.r.o.</div>
        <div style="${R}text-align:center;">DORYS,s.r.o. - SKLAD</div>
      </div>
      <div style="${row}font-size:12pt;">
        <div style="${L}">EUROPALETY:</div>
        <div style="${R}">převzal:</div>
      </div>
      <div style="${row}font-size:12pt;">
        <div style="${L}">Složeno ve skladu na Brodě: ______ kusů</div>
        <div style="${R}">podpis:</div>
      </div>
      <div style="${row}font-size:12pt;">
        <div style="${L}"></div>
        <div style="${R}">datum:</div>
      </div>
      <div style="${row}font-size:12pt;">
        <div style="${L}">Místo doručení: <b>${miesto}</b></div>
        <div style="${R}"></div>
      </div>
      <div style="${row}font-size:12pt;">
        <div style="${L}">Číslo objednávky : ${cislo}</div>
        <div style="${R}"></div>
      </div>
      <div style="${row}font-size:12pt;">
        <div style="${L}">Předal:</div>
        <div style="${R}">razítko:</div>
      </div>
      <div style="${row}font-size:12pt;">
        <div style="${L}">Podpis:</div>
        <div style="${R}"></div>
      </div>

      <div style="height:16px;"></div>

      <div style="${row}font-size:12pt;">
        <div style="${L}text-align:center;">STENGER CZECH, s.r.o.</div>
        <div style="${R}text-align:center;">STENGER CZECH,s.r.o. - SKLAD</div>
      </div>
      <div style="${row}font-size:12pt;">
        <div style="${L}">EUROPALETY:</div>
        <div style="${R}"></div>
      </div>
      <div style="${row}font-size:12pt;">
        <div style="${L}">Přijato: ______ kusů</div>
        <div style="${R}">datum:</div>
      </div>
      <div style="display:flex;padding:3px 0;font-size:12pt;">
        <div style="${L}"></div>
        <div style="${R}">podpis:</div>
      </div>
      <div style="display:flex;padding:3px 0;font-size:12pt;">
        <div style="${L}"></div>
        <div style="${R}">razítko:</div>
      </div>
    </div>`;
}

function PalletPrintTable({ id, cislo, nalozeno, miesto }) {
  return (
    <div id={id} className="print-only-content" dangerouslySetInnerHTML={{ __html: buildPalletHtml({ cislo, nalozeno, miesto }) }} />
  );
}

function PalletModal({ order, onClose, onDone }) {
  const last = order.paletovyListokInfo;
  const printId = "print-pallet-" + order.id;
  const [nalozeno, setNalozeno] = useState(last ? last.nalozeno || order.pocetPaliet : order.pocetPaliet || "");
  const [miesto, setMiesto] = useState(extractCityFromAddress(order.adresaDodania) || (last ? last.miesto : "") || "");

  function handlePrint() {
    onDone({ subject: "Paletovy listok", body: `Nalozeno: ${nalozeno}, Miesto: ${miesto}`, nalozeno, miesto, to: "vytlacene", datum: new Date().toISOString() }, "print");
    setTimeout(() => window.print(), 50);
  }
  function handleDownload() {
    const html = buildPalletHtml({ cislo: order.cisloObjednavkyDopravy, nalozeno, miesto });
    downloadHtml(`Paletovy_listok_${order.cisloObjednavkyDopravy.replace("/", "-")}.html`, html);
    onDone({ subject: "Paletovy listok", body: html, nalozeno, miesto, to: "stiahnute", datum: new Date().toISOString() }, "download");
  }

  return (
    <ModalShell title={"Paletovy listok - " + order.cisloObjednavkyDopravy} onClose={onClose} wide>
      <div className="border border-slate-300 rounded-md overflow-x-auto mb-3 bg-white" style={{ maxHeight: "50vh", overflowY: "auto" }}>
        <div style={{ minWidth: "600px", padding: "12px" }} dangerouslySetInnerHTML={{ __html: buildPalletHtml({ cislo: order.cisloObjednavkyDopravy, nalozeno, miesto }) }} />
      </div>
      <PalletPrintTable id={printId} cislo={order.cisloObjednavkyDopravy} nalozeno={nalozeno} miesto={miesto} />
      {last && <div className="mb-3 bg-emerald-50 text-emerald-800 text-xs px-3 py-2 rounded-md flex items-center gap-2"><CheckCircle2 size={14} /> Naposledy pripravene {formatDateTime(last.datum)}</div>}
      <p className="text-xs text-slate-400 mb-3">Formular je 1:1 kopia vasho originalneho paletoveho listku - meni sa len cislo objednavky dopravy, pocet paliet a mesto dodania (predvyplnene z objednavky). Ostatne (RZ, meno vodica, podpisy) doplna vodic/sklad rucne po vytlaceni.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
        <Field label="Pocet paliet (NALOZENO/SLOZENO EUROPALET)" value={nalozeno} onChange={setNalozeno} />
        <Field label="Misto doruceni" value={miesto} onChange={setMiesto} />
      </div>
      <div className="flex justify-end gap-2 mt-2">
        <button onClick={onClose} className="text-sm text-slate-500 px-3 py-2">Zrusit</button>
        <button onClick={handleDownload} className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5"><Download size={16} /> Stiahnut</button>
        <button onClick={handlePrint} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5"><Printer size={16} /> Vytlacit</button>
      </div>
    </ModalShell>
  );
}

/* ---------------- NVE list (Maxim export - nahratie + odoslanie kolegom) ---------------- */

function NveListModal({ order, company, onClose, onSave, onSent }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);
  const last = order.nveOdoslanaInfo;

  const mesto = extractCityFromAddress(order.adresaDodania) || "";
  const dodakRef = order.nemeckyDodakCislo || order.cisloObjednavkyDopravy;
  const [dodak, setDodak] = useState(order.nemeckyDodakCislo || "");

  function applyDodakToSubject() {
    const ref = dodak.trim() || order.cisloObjednavkyDopravy;
    onSave({ nemeckyDodakCislo: dodak.trim() });
    setSubject(`NVE list - ${ref}${mesto ? " - " + mesto : ""}`);
  }

  const defaultTo = (company.nveEmaily || []).map((e) => e.email).join(", ");
  const [to, setTo] = useState(last ? last.to : defaultTo);
  const [subject, setSubject] = useState(last ? last.subject : `NVE list - ${dodakRef}${mesto ? " - " + mesto : ""}`);
  const [body, setBody] = useState(
    last ? last.body :
    `Ahoj,\n\n` +
    `v prilohe posielame NVE list k objednavke c. ${order.cisloObjednavkyDopravy}${order.zakaznik ? " (" + order.zakaznik + ")" : ""}.\n` +
    `Dodaci list: ${dodakRef}${mesto ? ", miesto dodania: " + mesto : ""}\n\n` +
    `POZOR: priloha sa nepripaja automaticky - pred odoslanim nezabudnite rucne pripojit stiahnuty subor${order.nveListFileName ? ' "' + order.nveListFileName + '"' : ""}.\n\n` +
    `S pozdravom`
  );

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const ext = (file.name.split(".").pop() || "xlsx").toLowerCase();
      const path = `${order.id}/nve.${ext}`;
      const { error: uploadError } = await supabase.storage.from(NVE_LISTS_BUCKET).upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;
      await onSave({ nveListPath: path, nveListFileName: file.name, nveListUploadedAt: new Date().toISOString() });
    } catch (err) {
      setError("Nahratie suboru zlyhalo, skuste znova.");
    }
    setBusy(false);
    if (e.target) e.target.value = "";
  }

  return (
    <ModalShell title={"NVE list - " + order.cisloObjednavkyDopravy} onClose={onClose} extraWide>
      <div className="mb-3">
        <span className="block text-xs font-medium text-slate-500 mb-1">Cislo nemeckeho dodacieho listu (Lieferschein DE od kolegov) - nepovinne, len ak sa tovar posiela cez nich (napr. Stenger Waffeln)</span>
        <div className="flex gap-1.5">
          <input value={dodak} onChange={(e) => setDodak(e.target.value)} placeholder="napr. 2206-22007895" className="flex-1 border border-slate-200 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" />
          <button type="button" onClick={applyDodakToSubject} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-md font-medium whitespace-nowrap">Ulozit a doplnit do predmetu</button>
        </div>
      </div>
      <div className="mb-3">
        <span className="block text-xs font-medium text-slate-500 mb-1">Subor z Maxim (Excel)</span>
        {order.nveListPath ? (
          <div className="flex items-center justify-between bg-slate-50 rounded-md px-3 py-2 text-sm">
            <span className="flex items-center gap-2 text-slate-700"><FileSpreadsheet size={16} className="text-teal-700" /> {order.nveListFileName || "NVE list"} <span className="text-slate-400 text-xs">({formatDateTime(order.nveListUploadedAt)})</span></span>
            <div className="flex items-center gap-2">
              <button onClick={() => openNveListFile(order.nveListPath)} className="text-xs text-teal-700 hover:text-teal-900 font-medium flex items-center gap-1"><Download size={14} /> Stiahnut</button>
              <button onClick={() => fileInputRef.current && fileInputRef.current.click()} disabled={busy} className="text-xs text-slate-500 hover:text-slate-700 font-medium disabled:opacity-50">Nahradit</button>
            </div>
          </div>
        ) : (
          <button onClick={() => fileInputRef.current && fileInputRef.current.click()} disabled={busy} className="w-full flex items-center justify-center gap-1.5 bg-white border-2 border-dashed border-slate-300 hover:border-teal-500 hover:text-teal-700 text-slate-500 text-sm font-medium px-3 py-4 rounded-md disabled:opacity-50">
            <Upload size={16} /> {busy ? "Nahravam..." : "Nahrat NVE list (Excel z Maxim)"}
          </button>
        )}
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
        {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
      </div>

      {!order.nveListPath && (
        <div className="mb-3 bg-amber-50 text-amber-800 text-xs px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={14} /> Najprv nahrajte NVE list, potom pripravte email.</div>
      )}
      {last && <div className="mb-3 bg-emerald-50 text-emerald-800 text-xs px-3 py-2 rounded-md flex items-center gap-2"><CheckCircle2 size={14} /> Naposledy odoslane {formatDateTime(last.datum)} na {last.to}</div>}

      <Field label="E-mail (komu) - oddelte ciarkou pri viacerych adresach" value={to} onChange={setTo} />
      <Field label="Predmet" value={subject} onChange={setSubject} />
      <Field label="Text spravy" value={body} onChange={setBody} textarea rows={8} />
      <p className="text-xs text-slate-400 mb-2">Priloha sa cez mailto odkaz nepripaja automaticky - po kliknuti "Otvorit email" pretiahnite stiahnuty subor do otvoreneho draftu.</p>

      <div className="flex justify-end gap-2 mt-2">
        <button onClick={onClose} className="text-sm text-slate-500 px-3 py-2">Zrusit</button>
        {order.nveListPath && (
          <button onClick={() => openNveListFile(order.nveListPath)} className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5"><Download size={16} /> Stiahnut prilohu</button>
        )}
        <a
          href={to && order.nveListPath ? buildMailto(to, subject, body) : "#"}
          onClick={() => to && order.nveListPath && onSent({ subject, body, to, datum: new Date().toISOString() })}
          className={"bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5 " + (!to || !order.nveListPath ? "opacity-50 pointer-events-none" : "")}
        >
          <Mail size={16} /> Otvorit email
        </a>
      </div>
    </ModalShell>
  );
}

/* ---------------- CMR (print only) ---------------- */


function CmrModal({ order, carriers, customers, company, onClose, onDone }) {
  const last = order.cmrInfo;
  const carrier = carriers.find((c) => c.id === order.dopravcaId);
  const customer = customers.find((c) => c.id === order.zakaznikId);
  const printId = "print-cmr-" + order.id;
  const [body, setBody] = useState(
    last ? last.body :
    `MEZINARODNI NAKLADNI LIST c. ${order.cisloObjednavkyDopravy}\n\n` +
    `1. Odesilatel: ${company.nazov || "[doplnte]"}\n${company.adresa || ""}\n\n` +
    `2. Prijemce: ${customer ? customer.nazov : (order.zakaznik || "[doplnte]")}\n${customer ? customer.adresa : ""}\n\n` +
    `3. Misto vykladky zbozi: ${order.adresaDodaniaNazov || ""}\n${order.adresaDodania || ""}\n\n` +
    `4. Misto a datum nakladky zbozi: ${company.adresa || ""}, ${nakladkaDateFromDodanie(order.datumDodania)}\n\n` +
    `5. Pripojene doklady: LS: ${order.cisloDodaciehoListu}${order.nemeckyDodakCislo ? `, Lieferschein DE: ${order.nemeckyDodakCislo}` : ""}\n\n` +
    `6-12. Oznaceni zbozi: ${order.popisTovaru || "POPCORN"}\n` +
    `Pocet kolli: ${order.pocetPaliet || "[doplnte]"}   Druh obalu: EUROPALETTEN\n` +
    `Hr. hmotnost v kg: ${order.hmotnost || "[doplnte]"}\n\n` +
    `13. Pokyny odesilatele: EUROPALETTEN\n\n` +
    `16. Dopravce: ${order.sposobDopravy === "vyzdvihnutie" ? "VYZDVIHNUTIE ZAKAZNIKOM (zakaznik si zabezpecuje dopravu sam)" : carrier ? carrier.nazov : "[doplnte]"}\n${carrier ? carrier.adresa || "" : ""}\n${carrier && carrier.ico ? "ICO: " + carrier.ico : ""} ${carrier && carrier.dic ? "DIC: " + carrier.dic : ""}\n${carrier ? carrier.tel || "" : ""} ${carrier ? carrier.email || "" : ""}\n` +
    `SPZ vozidla: [doplni dopravce]   Jmeno ridice: [doplni dopravce]\n\n` +
    `17. Dalsi dopravci: -\n\n` +
    `THE DELIVERED QUANTITY // DODANO: ${order.pocetPaliet || ""}\n` +
    `RETURNED QUANTITY // VRACENO: [doplni pri navratu]\n\n` +
    `Podpis a peciatka odesilatele: ______________________\n` +
    `Podpis a peciatka dopravce: ______________________\n` +
    `Podpis a peciatka prijemce: ______________________`
  );

  function handlePrint() {
    onDone({ subject: "CMR", body, to: "vytlacene", datum: new Date().toISOString() }, "print");
    setTimeout(() => window.print(), 50);
  }
  function handleDownload() {
    downloadText(`CMR_${order.cisloObjednavkyDopravy.replace("/", "-")}.txt`, body);
    onDone({ subject: "CMR", body, to: "stiahnute", datum: new Date().toISOString() }, "download");
  }

  return (
    <ModalShell title={"CMR - " + order.cisloObjednavkyDopravy} onClose={onClose} wide>
      <PrintDocument id={printId} title="CMR - MEZINARODNI NAKLADNI LIST" body={body} />
      {last && <div className="mb-3 bg-emerald-50 text-emerald-800 text-xs px-3 py-2 rounded-md flex items-center gap-2"><CheckCircle2 size={14} /> Naposledy pripravene {formatDateTime(last.datum)}</div>}
      <p className="text-xs text-slate-400 mb-3">Obsahovy podklad podla udajov objednavky, cislovanie zodpoveda poliam CMR listu, nejde o certifikovane tlacivo.</p>
      <Field label="Text dokumentu" value={body} onChange={setBody} textarea />
      <div className="flex justify-end gap-2 mt-2">
        <button onClick={onClose} className="text-sm text-slate-500 px-3 py-2">Zrusit</button>
        <button onClick={handleDownload} className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5"><Download size={16} /> Stiahnut</button>
        <button onClick={handlePrint} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5"><Printer size={16} /> Vytlacit</button>
      </div>
    </ModalShell>
  );
}

/* ---------------- Carriers ---------------- */

function UlohyView({ ulohy, onSave, onUpdate, onDelete }) {
  const [popis, setPopis] = useState("");
  const [osoby, setOsoby] = useState([]);
  const [termin, setTermin] = useState("");
  const [formError, setFormError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);

  const osobyOptions = ULOHY_OSOBY.map((o) => ({ value: o, label: o }));

  function add() {
    if (!popis.trim()) { setFormError("Vyplnte znenie ulohy."); return; }
    setFormError("");
    onSave({ popis: popis.trim(), osoby, termin: termin.trim() });
    setPopis(""); setOsoby([]); setTermin("");
  }

  const dnes = parseSkDate(todayStr());
  const sorted = ulohy.slice().sort((a, b) => {
    if (!!a.hotovo !== !!b.hotovo) return a.hotovo ? 1 : -1;
    const da = parseSkDate(a.termin);
    const db = parseSkDate(b.termin);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da - db;
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Ulohy</h1>
      </div>
      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
        <Field label="Uloha / akcny plan / bod" value={popis} onChange={setPopis} textarea rows={2} />
        <MultiCheckField label="Kto ma dorucit" value={osoby} onChange={setOsoby} options={osobyOptions} />
        <div className="flex gap-2 items-end flex-wrap">
          <div className="min-w-[160px]">
            <DateField label="Termin" value={termin} onChange={setTermin} />
          </div>
          <button onClick={add} className="mb-3 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md flex items-center gap-1.5"><Plus size={16} /> Pridat ulohu</button>
        </div>
        {formError && <div className="bg-red-50 text-red-700 text-xs px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={14} /> {formError}</div>}
      </div>
      {sorted.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500">Zatial ziadna uloha.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-100 text-slate-600 text-left"><th className="px-3 py-2 font-medium">Uloha</th><th className="px-3 py-2 font-medium">Kto</th><th className="px-3 py-2 font-medium">Termin</th><th className="px-3 py-2 font-medium">Stav</th><th className="px-3 py-2"></th></tr></thead>
            <tbody>
              {sorted.map((u) => {
                const terminDate = parseSkDate(u.termin);
                const overdue = !u.hotovo && terminDate && dnes && terminDate < dnes;
                return (
                  <tr key={u.id} className={"border-t border-slate-100 " + (u.hotovo ? "opacity-50" : "")}>
                    <td className="px-3 py-2 whitespace-pre-wrap max-w-md">{u.popis}</td>
                    <td className="px-3 py-2 text-slate-500">
                      <div className="flex flex-wrap gap-1">
                        {(u.osoby || []).map((o) => (
                          <span key={o} className="bg-slate-100 text-slate-600 rounded-full px-2 py-0.5 text-xs">{o}</span>
                        ))}
                      </div>
                    </td>
                    <td className={"px-3 py-2 " + (overdue ? "text-red-600 font-medium" : "text-slate-500")}>{u.termin || "—"}</td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => onUpdate(u.id, { hotovo: !u.hotovo })}
                        className={"flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full border " + (u.hotovo ? "bg-green-50 text-green-700 border-green-200" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50")}
                      >
                        <CheckCircle2 size={14} /> {u.hotovo ? "Splnene" : "Otvorene"}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <IconButton title="Zmazat" onClick={() => setConfirmDelete(u)}><Trash2 size={16} /></IconButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {confirmDelete && (
        <ModalShell title="Zmazat ulohu?" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-slate-600 mb-4">Naozaj chcete zmazat tuto ulohu? Tuto akciu nie je mozne vratit spat.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDelete(null)} className="px-3 py-1.5 rounded-md text-sm border border-slate-200 text-slate-600">Zrusit</button>
            <button onClick={() => { onDelete(confirmDelete.id); setConfirmDelete(null); }} className="px-3 py-1.5 rounded-md text-sm bg-red-600 hover:bg-red-700 text-white">Zmazat</button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

function CarriersView({ carriers, onSave, onEdit }) {
  const [nazov, setNazov] = useState("");
  const [email, setEmail] = useState("");
  const [formError, setFormError] = useState("");

  function add() {
    if (!nazov.trim() && !email.trim()) { setFormError("Vyplnte nazov aj e-mail dopravcu."); return; }
    if (!nazov.trim()) { setFormError("Vyplnte nazov dopravcu."); return; }
    if (!email.trim()) { setFormError("Vyplnte e-mail dopravcu."); return; }
    setFormError("");
    onSave([...carriers, { ...EMPTY_CARRIER, id: uid(), nazov: nazov.trim(), email: email.trim() }]);
    setNazov(""); setEmail("");
  }
  function remove(id) { onSave(carriers.filter((c) => c.id !== id)); }
  async function exportToExcel() {
    const rows = carriers.map((c) => ({
      "Nazov": c.nazov,
      "E-mail": c.email,
      "Adresa": c.adresa,
      "ICO": c.ico,
      "DIC": c.dic,
      "Telefon": c.tel,
      "Web": c.web,
    }));
    await exportRowsToExcel(rows, "Dopravcovia", "Dopravcovia");
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Dopravcovia</h1>
        <button onClick={exportToExcel} disabled={carriers.length === 0} title={carriers.length === 0 ? "Zoznam je prazdny" : "Exportovat do Excelu"} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-sm font-medium px-3 py-2 rounded-md">
          <Download size={16} /> Export do Excelu
        </button>
      </div>
      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
        <div className="flex gap-2 items-end flex-wrap">
          <label className="flex-1 min-w-[160px]"><span className="block text-xs font-medium text-slate-500 mb-1">Nazov dopravcu</span><input value={nazov} onChange={(e) => setNazov(e.target.value)} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" /></label>
          <label className="flex-1 min-w-[160px]"><span className="block text-xs font-medium text-slate-500 mb-1">E-mail</span><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" /></label>
          <button onClick={add} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md flex items-center gap-1.5"><Plus size={16} /> Pridat</button>
        </div>
        {formError && <div className="mt-2 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={14} /> {formError}</div>}
        <p className="text-xs text-slate-400 mt-2">Po pridani kliknite na "Upravit" pre doplnenie adresy, ICO, DIC (pouziva sa v CMR).</p>
      </div>
      {carriers.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500">Zatial ziadny dopravca.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-100 text-slate-600 text-left"><th className="px-3 py-2 font-medium">Nazov</th><th className="px-3 py-2 font-medium">E-mail</th><th className="px-3 py-2"></th></tr></thead>
            <tbody>
              {carriers.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{c.nazov}</td>
                  <td className="px-3 py-2 text-slate-500">{c.email}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <IconButton title="Upravit" onClick={() => onEdit(c)}><Pencil size={16} /></IconButton>
                      <IconButton title="Zmazat" onClick={() => remove(c.id)}><Trash2 size={16} /></IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EmailListEditor({ emaily, onChange, caption }) {
  const [label, setLabel] = useState("");
  const [email, setEmail] = useState("");

  function add() {
    if (!label.trim() || !email.trim()) return;
    onChange([...(emaily || []), { label: label.trim(), email: email.trim() }]);
    setLabel("");
    setEmail("");
  }
  function remove(i) {
    onChange(emaily.filter((_, idx) => idx !== i));
  }

  return (
    <div className="mb-3">
      <span className="block text-xs font-medium text-slate-500 mb-1">{caption || "Dalsie e-maily podla ucelu (napr. Objednavky, Faktury) - pri viacerych adresach naraz ich oddelte ciarkou"}</span>
      {(emaily || []).length > 0 && (
        <div className="mb-1.5 space-y-1">
          {emaily.map((e, i) => (
            <div key={i} className="flex items-center justify-between bg-slate-50 rounded-md px-2.5 py-1.5 text-sm">
              <span><b>{e.label}:</b> {e.email}</span>
              <button onClick={() => remove(i)} className="text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ucel (napr. Objednavky)" className="w-36 border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="email1@x.cz, email2@x.cz"
          className="flex-1 border border-slate-200 rounded-md px-2.5 py-1.5 text-sm"
        />
        <button onClick={add} className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium px-3 py-1.5 rounded-md flex items-center gap-1"><Plus size={14} /> Pridat</button>
      </div>
    </div>
  );
}

function CarrierModal({ carrier, onClose, onSave }) {
  const [f, setF] = useState({ ...EMPTY_CARRIER, ...carrier });
  return (
    <ModalShell title={"Upravit dopravcu - " + carrier.nazov} onClose={onClose}>
      <Field label="Nazov" value={f.nazov} onChange={(v) => setF({ ...f, nazov: v })} />
      <Field label="E-mail" value={f.email} onChange={(v) => setF({ ...f, email: v })} type="email" />
      <Field label="Adresa" value={f.adresa} onChange={(v) => setF({ ...f, adresa: v })} textarea />
      <Field label="ICO" value={f.ico} onChange={(v) => setF({ ...f, ico: v })} />
      <Field label="DIC" value={f.dic} onChange={(v) => setF({ ...f, dic: v })} />
      <Field label="Telefon" value={f.tel} onChange={(v) => setF({ ...f, tel: v })} />
      <Field label="Web" value={f.web} onChange={(v) => setF({ ...f, web: v })} />
      <EmailListEditor emaily={f.emaily} onChange={(list) => setF({ ...f, emaily: list })} />
      <div className="flex justify-end mt-2"><button onClick={() => onSave(f)} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Ulozit</button></div>
    </ModalShell>
  );
}

/* ---------------- Customers ---------------- */

function CustomersView({ customers, onSave, onEdit }) {
  const [nazov, setNazov] = useState("");
  const [formError, setFormError] = useState("");

  function add() {
    if (!nazov.trim()) { setFormError("Vyplnte nazov zakaznika."); return; }
    setFormError("");
    onSave([...customers, { ...EMPTY_CUSTOMER, id: uid(), nazov: nazov.trim() }]);
    setNazov("");
  }
  function remove(id) { onSave(customers.filter((c) => c.id !== id)); }
  async function exportToExcel() {
    const rows = customers.map((c) => ({
      "Nazov": c.nazov,
      "Adresa": c.adresa,
      "ICO": c.ico,
      "DIC": c.dic,
      "E-mail": c.email,
      "Polozky v katalogu": (c.katalog || []).length,
    }));
    await exportRowsToExcel(rows, "Zakaznici", "Zakaznici");
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Zakaznici</h1>
        <button onClick={exportToExcel} disabled={customers.length === 0} title={customers.length === 0 ? "Zoznam je prazdny" : "Exportovat do Excelu"} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-sm font-medium px-3 py-2 rounded-md">
          <Download size={16} /> Export do Excelu
        </button>
      </div>
      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
        <div className="flex gap-2 items-end flex-wrap">
          <label className="flex-1 min-w-[220px]"><span className="block text-xs font-medium text-slate-500 mb-1">Nazov zakaznika (odberatela)</span><input value={nazov} onChange={(e) => setNazov(e.target.value)} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" /></label>
          <button onClick={add} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md flex items-center gap-1.5"><Plus size={16} /> Pridat</button>
        </div>
        {formError && <div className="mt-2 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={14} /> {formError}</div>}
        <p className="text-xs text-slate-400 mt-2">Po pridani kliknite na "Upravit" pre doplnenie fakturacnej adresy, ICO/DIC a katalogu tovaru.</p>
      </div>
      {customers.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500">Zatial ziadny zakaznik.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-100 text-slate-600 text-left"><th className="px-3 py-2 font-medium">Nazov</th><th className="px-3 py-2 font-medium">Adresa</th><th className="px-3 py-2 font-medium">Polozky v katalogu</th><th className="px-3 py-2"></th></tr></thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{c.nazov}</td>
                  <td className="px-3 py-2 text-slate-500 whitespace-pre-wrap">{c.adresa}</td>
                  <td className="px-3 py-2 text-slate-500">{(c.katalog || []).length}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <IconButton title="Upravit" onClick={() => onEdit(c)}><Pencil size={16} /></IconButton>
                      <IconButton title="Zmazat" onClick={() => remove(c.id)}><Trash2 size={16} /></IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CatalogTable({ katalog, setKatalog }) {
  function update(i, key, val) {
    const next = katalog.slice();
    next[i] = { ...next[i], [key]: val };
    setKatalog(next);
  }
  function remove(i) { setKatalog(katalog.filter((_, idx) => idx !== i)); }
  function add() { setKatalog([...katalog, { popis: "", artikel: "", detail: "" }]); }
  return (
    <div className="mb-3">
      <span className="block text-xs font-medium text-slate-500 mb-1">Katalog tovaru</span>
      <div className="border border-slate-200 rounded-md overflow-hidden">
        <table className="w-full text-xs">
          <thead><tr className="bg-slate-100 text-slate-600 text-left"><th className="px-2 py-1.5">Popis tovaru</th><th className="px-2 py-1.5 w-28">Cislo artiklu</th><th className="px-2 py-1.5 w-48">Balenie / EAN / cert. (viac riadkov)</th><th className="px-2 py-1.5 w-8"></th></tr></thead>
          <tbody>
            {katalog.map((k, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-1 py-1"><input value={k.popis} onChange={(e) => update(i, "popis", e.target.value)} className="w-full border border-slate-200 rounded px-1.5 py-1" /></td>
                <td className="px-1 py-1"><input value={k.artikel} onChange={(e) => update(i, "artikel", e.target.value)} className="w-full border border-slate-200 rounded px-1.5 py-1" /></td>
                <td className="px-1 py-1"><textarea value={k.detail || ""} onChange={(e) => update(i, "detail", e.target.value)} rows={2} placeholder="napr. inhalt: 20 x 75g Beutel, 1 PLT=16 KRT" className="w-full border border-slate-200 rounded px-1.5 py-1" /></td>
                <td className="px-1 py-1 text-center"><button onClick={() => remove(i)} className="text-slate-400 hover:text-red-600"><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={add} className="mt-1.5 text-xs text-teal-700 hover:text-teal-900 flex items-center gap-1"><Plus size={12} /> Pridat polozku katalogu</button>
    </div>
  );
}

function CustomerModal({ customer, onClose, onSave }) {
  const [f, setF] = useState({ ...EMPTY_CUSTOMER, ...customer, katalog: customer.katalog || [] });
  return (
    <ModalShell title={"Upravit zakaznika - " + customer.nazov} onClose={onClose} wide>
      <Field label="Nazov" value={f.nazov} onChange={(v) => setF({ ...f, nazov: v })} />
      <Field label="Fakturacna adresa (Abnehmer)" value={f.adresa} onChange={(v) => setF({ ...f, adresa: v })} textarea />
      <Field label="ICO" value={f.ico} onChange={(v) => setF({ ...f, ico: v })} />
      <Field label="DIC / Ust.-Id Nr." value={f.dic} onChange={(v) => setF({ ...f, dic: v })} />
      <Field label="E-mail (komu sa posiela dodaci list - oddelte ciarkou, ak viac adries)" value={f.email} onChange={(v) => setF({ ...f, email: v })} />
      <EmailListEditor emaily={f.emaily} onChange={(list) => setF({ ...f, emaily: list })} />
      <CatalogTable katalog={f.katalog} setKatalog={(k) => setF({ ...f, katalog: k })} />
      <div className="flex justify-end mt-2"><button onClick={() => onSave(f)} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Ulozit</button></div>
    </ModalShell>
  );
}

/* ---------------- Dodavatelia ---------------- */

function SuppliersView({ suppliers, onSave, onEdit }) {
  const [nazov, setNazov] = useState("");
  const [formError, setFormError] = useState("");

  function add() {
    if (!nazov.trim()) { setFormError("Vyplnte nazov dodavatela."); return; }
    setFormError("");
    onSave([...suppliers, { ...EMPTY_SUPPLIER, id: uid(), nazov: nazov.trim() }]);
    setNazov("");
  }
  function remove(id) { onSave(suppliers.filter((s) => s.id !== id)); }
  async function exportToExcel() {
    const rows = suppliers.map((s) => ({
      "Nazov": s.nazov,
      "Typ": materialTypLabel(s.typ),
      "Jazyk komunikacie": (MATERIAL_JAZYK_OPTIONS.find((o) => o.value === s.jazyk) || {}).label || "Slovencina",
      "Adresa": s.adresa,
      "ICO": s.ico,
      "DIC": s.dic,
      "E-mail": s.email,
      "Telefon": s.tel,
      "Tovary v katalogu": (s.tovary || []).length,
    }));
    await exportRowsToExcel(rows, "Dodavatelia", "Dodavatelia");
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Dodavatelia</h1>
        <button onClick={exportToExcel} disabled={suppliers.length === 0} title={suppliers.length === 0 ? "Zoznam je prazdny" : "Exportovat do Excelu"} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-sm font-medium px-3 py-2 rounded-md">
          <Download size={16} /> Export do Excelu
        </button>
      </div>
      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
        <div className="flex gap-2 items-end flex-wrap">
          <label className="flex-1 min-w-[220px]"><span className="block text-xs font-medium text-slate-500 mb-1">Nazov dodavatela</span><input value={nazov} onChange={(e) => setNazov(e.target.value)} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" /></label>
          <button onClick={add} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md flex items-center gap-1.5"><Plus size={16} /> Pridat</button>
        </div>
        {formError && <div className="mt-2 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={14} /> {formError}</div>}
        <p className="text-xs text-slate-400 mt-2">Po pridani kliknite na "Upravit" pre doplnenie adresy (miesto vyzdvihnutia), e-mailu, ICO, DIC.</p>
      </div>
      {suppliers.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500">Zatial ziadny dodavatel.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-100 text-slate-600 text-left"><th className="px-3 py-2 font-medium">Nazov</th><th className="px-3 py-2 font-medium">Typ</th><th className="px-3 py-2 font-medium">Adresa</th><th className="px-3 py-2 font-medium">Tovary</th><th className="px-3 py-2"></th></tr></thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{s.nazov}</td>
                  <td className="px-3 py-2 text-slate-500">{materialTypLabel(s.typ) || "-"}</td>
                  <td className="px-3 py-2 text-slate-500 whitespace-pre-wrap">{s.adresa}</td>
                  <td className="px-3 py-2 text-slate-500">{(s.tovary || []).length}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <IconButton title="Upravit" onClick={() => onEdit(s)}><Pencil size={16} /></IconButton>
                      <IconButton title="Zmazat" onClick={() => remove(s.id)}><Trash2 size={16} /></IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function normalizeTovary(tovary) {
  return (tovary || []).map((t) => (typeof t === "string" ? { popis: t, artikel: "", balenie: "" } : t));
}

function SupplierGoodsTable({ tovary, setTovary }) {
  const fileInputRef = useRef(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const [importMsg, setImportMsg] = useState("");

  function update(i, key, val) {
    const next = tovary.slice();
    next[i] = { ...next[i], [key]: val };
    setTovary(next);
  }
  function remove(i) { setTovary(tovary.filter((_, idx) => idx !== i)); }
  function add() { setTovary([...tovary, { popis: "", artikel: "", balenie: "" }]); }

  async function handleImportFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setImportBusy(true);
    setImportError("");
    setImportMsg("");
    try {
      const buf = await file.arrayBuffer();
      const items = await parseSupplierCatalogFile(buf);
      const { tovary: next, added, updated } = mergeSupplierCatalog(tovary, items);
      setTovary(next);
      setImportMsg(`Naimportovane: ${added} novych, ${updated} aktualizovanych.`);
    } catch (err) {
      setImportError(err.message || "Nepodarilo sa spracovat subor.");
    }
    setImportBusy(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="block text-xs font-medium text-slate-500">Tovary / materialy, ktore dodava</span>
        <div className="flex items-center gap-2">
          <button type="button" disabled={importBusy} onClick={() => fileInputRef.current && fileInputRef.current.click()} className="text-xs text-teal-700 hover:text-teal-900 flex items-center gap-1 disabled:opacity-50">
            <Upload size={12} /> {importBusy ? "Importujem..." : "Import z XLS"}
          </button>
          <input ref={fileInputRef} type="file" accept=".xls,.xlsx" className="hidden" onChange={handleImportFile} />
        </div>
      </div>
      {importError && <p className="text-xs text-red-600 mb-1">{importError}</p>}
      {importMsg && <p className="text-xs text-teal-700 mb-1">{importMsg}</p>}
      <div className="border border-slate-200 rounded-md overflow-hidden">
        <table className="w-full text-xs">
          <thead><tr className="bg-slate-100 text-slate-600 text-left"><th className="px-2 py-1.5">Nazov polozky</th><th className="px-2 py-1.5 w-28">Artikel</th><th className="px-2 py-1.5 w-48">Balenie (napr. 25 kg karton, 40 kartonov/paleta)</th><th className="px-2 py-1.5 w-8"></th></tr></thead>
          <tbody>
            {tovary.map((t, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-1 py-1"><input value={t.popis} onChange={(e) => update(i, "popis", e.target.value)} className="w-full border border-slate-200 rounded px-1.5 py-1" /></td>
                <td className="px-1 py-1"><input value={t.artikel} onChange={(e) => update(i, "artikel", e.target.value)} className="w-full border border-slate-200 rounded px-1.5 py-1" /></td>
                <td className="px-1 py-1"><input value={t.balenie || ""} onChange={(e) => update(i, "balenie", e.target.value)} className="w-full border border-slate-200 rounded px-1.5 py-1" /></td>
                <td className="px-1 py-1 text-center"><button onClick={() => remove(i)} className="text-slate-400 hover:text-red-600"><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={add} className="mt-1.5 text-xs text-teal-700 hover:text-teal-900 flex items-center gap-1"><Plus size={12} /> Pridat polozku</button>
    </div>
  );
}

function SupplierModal({ supplier, onClose, onSave }) {
  const [f, setF] = useState({ ...EMPTY_SUPPLIER, ...supplier, typ: normalizeSupplierTyp(supplier.typ), jazyk: supplier.jazyk || "sk", tovary: normalizeTovary(supplier.tovary) });

  return (
    <ModalShell title={"Upravit dodavatela - " + supplier.nazov} onClose={onClose} wide>
      <Field label="Nazov" value={f.nazov} onChange={(v) => setF({ ...f, nazov: v })} />
      <MultiCheckField label="Typ dodavatela (co dodava - moze byt aj oboje)" value={f.typ} onChange={(v) => setF({ ...f, typ: v })} options={MATERIAL_TYP_OPTIONS} />
      <SegmentedField label="Jazyk komunikacie (predmet a text objednavkoveho emailu)" value={f.jazyk} onChange={(v) => setF({ ...f, jazyk: v })} options={MATERIAL_JAZYK_OPTIONS} />
      <Field label="Adresa (miesto vyzdvihnutia)" value={f.adresa} onChange={(v) => setF({ ...f, adresa: v })} textarea />
      <Field label="ICO" value={f.ico} onChange={(v) => setF({ ...f, ico: v })} />
      <Field label="DIC" value={f.dic} onChange={(v) => setF({ ...f, dic: v })} />
      <Field label="E-mail" value={f.email} onChange={(v) => setF({ ...f, email: v })} type="email" />
      <Field label="Telefon" value={f.tel} onChange={(v) => setF({ ...f, tel: v })} />

      <SupplierGoodsTable tovary={f.tovary} setTovary={(t) => setF({ ...f, tovary: t })} />

      <EmailListEditor emaily={f.emaily} onChange={(list) => setF({ ...f, emaily: list })} />

      <div className="flex justify-end mt-2"><button onClick={() => onSave(f)} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Ulozit</button></div>
    </ModalShell>
  );
}

/* ---------------- Produkty ---------------- */

function ProductsView({ products, onSave, onEdit }) {
  const [f, setF] = useState({ znacka: "", gramaz: "", ksVKartone: "", kartonovNaPalete: "", linka: "sacky" });
  const [formError, setFormError] = useState("");

  function add() {
    if (!f.znacka.trim()) { setFormError("Vyplnte znacku/nazov produktu."); return; }
    setFormError("");
    onSave([...products, { ...EMPTY_PRODUCT, ...f, znacka: f.znacka.trim(), id: uid() }]);
    setF({ znacka: "", gramaz: "", ksVKartone: "", kartonovNaPalete: "", linka: "sacky" });
  }
  function remove(id) { onSave(products.filter((p) => p.id !== id)); }
  async function exportToExcel() {
    const rows = products.map((p) => ({
      "Produkt": productLabel(p),
      "Linka": (PRODUCTION_LINKY.find((l) => l.value === p.linka) || {}).label || p.linka,
      "Gramaz": p.gramaz,
      "Ks v kartone": p.ksVKartone,
      "Kartonov na palete": p.kartonovNaPalete,
      "Polozky v recepture": (p.receptura || []).length,
    }));
    await exportRowsToExcel(rows, "Produkty", "Produkty");
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Produkty</h1>
        <button onClick={exportToExcel} disabled={products.length === 0} title={products.length === 0 ? "Zoznam je prazdny" : "Exportovat do Excelu"} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-sm font-medium px-3 py-2 rounded-md">
          <Download size={16} /> Export do Excelu
        </button>
      </div>
      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
        <div className="flex gap-2 items-end flex-wrap">
          <label className="min-w-[160px]"><span className="block text-xs font-medium text-slate-500 mb-1">Znacka / nazov</span><input value={f.znacka} onChange={(e) => setF({ ...f, znacka: e.target.value })} placeholder="napr. FUN" className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" /></label>
          <label className="w-24"><span className="block text-xs font-medium text-slate-500 mb-1">Gramaz</span><input value={f.gramaz} onChange={(e) => setF({ ...f, gramaz: e.target.value })} placeholder="250" className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" /></label>
          <label className="w-28"><span className="block text-xs font-medium text-slate-500 mb-1">Ks v kartone</span><input value={f.ksVKartone} onChange={(e) => setF({ ...f, ksVKartone: e.target.value })} placeholder="24" className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" /></label>
          <label className="w-32"><span className="block text-xs font-medium text-slate-500 mb-1">Kartonov/paletu</span><input value={f.kartonovNaPalete} onChange={(e) => setF({ ...f, kartonovNaPalete: e.target.value })} placeholder="4" className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" /></label>
          <label className="w-28"><span className="block text-xs font-medium text-slate-500 mb-1">Linka</span>
            <select value={f.linka} onChange={(e) => setF({ ...f, linka: e.target.value })} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm">
              {PRODUCTION_LINKY.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </label>
          <button onClick={add} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md flex items-center gap-1.5"><Plus size={16} /> Pridat</button>
        </div>
        {formError && <div className="mt-2 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={14} /> {formError}</div>}
        <p className="text-xs text-slate-400 mt-2">Po pridani kliknite na "Upravit" pre doplnenie receptury (suroviny na 1 paletu).</p>
      </div>
      {products.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500">Zatial ziadny produkt.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-100 text-slate-600 text-left"><th className="px-3 py-2 font-medium">Produkt</th><th className="px-3 py-2 font-medium">Linka</th><th className="px-3 py-2 font-medium">Receptura</th><th className="px-3 py-2"></th></tr></thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{productLabel(p)}</td>
                  <td className="px-3 py-2 text-slate-500">{(PRODUCTION_LINKY.find((l) => l.value === p.linka) || {}).label || p.linka}</td>
                  <td className="px-3 py-2 text-slate-500">{(p.receptura || []).length} polozka(y)</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <IconButton title="Upravit" onClick={() => onEdit(p)}><Pencil size={16} /></IconButton>
                      <IconButton title="Zmazat" onClick={() => remove(p.id)}><Trash2 size={16} /></IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RecipeTable({ receptura, setReceptura, existingReceipts, existingIssues }) {
  const materialPicks = [...MATERIAL_QUICK_PICKS, ...extraKnownMaterials(existingReceipts, existingIssues, MATERIAL_QUICK_PICKS)];
  function update(i, key, val) {
    const next = receptura.slice();
    next[i] = { ...next[i], [key]: val };
    setReceptura(next);
  }
  function remove(i) { setReceptura(receptura.filter((_, idx) => idx !== i)); }
  function add() { setReceptura([...receptura, { material: "", mnozstvo: "", jednotka: "kg" }]); }
  return (
    <div className="mb-3">
      <span className="block text-xs font-medium text-slate-500 mb-1">Receptura (suroviny na 1 paletu)</span>
      <div className="border border-slate-200 rounded-md overflow-hidden">
        <table className="w-full text-xs">
          <thead><tr className="bg-slate-100 text-slate-600 text-left"><th className="px-2 py-1.5">Material</th><th className="px-2 py-1.5 w-24">Mnozstvo</th><th className="px-2 py-1.5 w-24">Jednotka</th><th className="px-2 py-1.5 w-8"></th></tr></thead>
          <tbody>
            {receptura.map((r, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-1 py-1"><input value={r.material} onChange={(e) => update(i, "material", e.target.value)} list="production-material-picks" className="w-full border border-slate-200 rounded px-1.5 py-1" /></td>
                <td className="px-1 py-1"><input value={r.mnozstvo} onChange={(e) => update(i, "mnozstvo", e.target.value)} inputMode="decimal" className="w-full border border-slate-200 rounded px-1.5 py-1" /></td>
                <td className="px-1 py-1">
                  <select value={r.jednotka || "kg"} onChange={(e) => update(i, "jednotka", e.target.value)} className="w-full border border-slate-200 rounded px-1.5 py-1">
                    {UNIT_QUICK_PICKS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </td>
                <td className="px-1 py-1 text-center"><button onClick={() => remove(i)} className="text-slate-400 hover:text-red-600"><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <datalist id="production-material-picks">
        {materialPicks.map((m) => <option key={m} value={m} />)}
      </datalist>
      <button onClick={add} className="mt-1.5 text-xs text-teal-700 hover:text-teal-900 flex items-center gap-1"><Plus size={12} /> Pridat surovinu</button>
    </div>
  );
}

function ProductModal({ product, existingReceipts, existingIssues, onClose, onSave }) {
  const [f, setF] = useState({ ...EMPTY_PRODUCT, ...product, receptura: product.receptura || [] });
  return (
    <ModalShell title={"Upravit produkt - " + productLabel(product)} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Znacka / nazov" value={f.znacka} onChange={(v) => setF({ ...f, znacka: v })} />
        <SelectField label="Linka" value={f.linka} onChange={(v) => setF({ ...f, linka: v })} options={PRODUCTION_LINKY.map((l) => ({ value: l.value, label: l.label }))} />
      </div>
      <div className="grid grid-cols-3 gap-x-3">
        <Field label="Gramaz" value={f.gramaz} onChange={(v) => setF({ ...f, gramaz: v })} />
        <Field label="Ks v kartone" value={f.ksVKartone} onChange={(v) => setF({ ...f, ksVKartone: v })} />
        <Field label="Kartonov na palete" value={f.kartonovNaPalete} onChange={(v) => setF({ ...f, kartonovNaPalete: v })} />
      </div>
      <RecipeTable receptura={f.receptura} setReceptura={(r) => setF({ ...f, receptura: r })} existingReceipts={existingReceipts} existingIssues={existingIssues} />
      <div className="flex justify-end mt-2"><button onClick={() => onSave(f)} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Ulozit</button></div>
    </ModalShell>
  );
}

/* ---------------- Pracovnici vo vyrobe ---------------- */

const WORKER_TYPY = [
  { value: "vyroba", label: "Vyroba" },
  { value: "sklad", label: "Sklad" },
];

function WorkersView({ workers, onSave }) {
  const [meno, setMeno] = useState("");
  const [typ, setTyp] = useState("vyroba");
  const [formError, setFormError] = useState("");

  function add() {
    if (!meno.trim()) { setFormError("Vyplnte meno pracovnika."); return; }
    setFormError("");
    onSave([...workers, { id: uid(), meno: meno.trim(), typ }]);
    setMeno("");
  }
  function remove(id) { onSave(workers.filter((w) => w.id !== id)); }
  function changeTyp(id, next) {
    onSave(workers.map((w) => (w.id === id ? { ...w, typ: next } : w)));
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Pracovnici</h1>
      <p className="text-xs text-slate-400 mb-4">Tento zoznam sluzi na oznacenie, kto zapisal davku na tablete vo Vyrobe alebo v Sklade (nie su to prihlasovacie ucty - kazdy tablet pouziva jeden zdielany login, ludia si tam len "odkliknu" svoje meno). Typ urcuje, na ktorom tablete sa dane meno ponuka na vyber.</p>
      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
        <div className="flex gap-2 items-end flex-wrap">
          <label className="flex-1 min-w-[220px]"><span className="block text-xs font-medium text-slate-500 mb-1">Meno pracovnika</span><input value={meno} onChange={(e) => setMeno(e.target.value)} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" /></label>
          <label><span className="block text-xs font-medium text-slate-500 mb-1">Typ</span>
            <select value={typ} onChange={(e) => setTyp(e.target.value)} className="border border-slate-200 rounded-md px-2.5 py-1.5 text-sm">
              {WORKER_TYPY.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <button onClick={add} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md flex items-center gap-1.5"><Plus size={16} /> Pridat</button>
        </div>
        {formError && <div className="mt-2 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={14} /> {formError}</div>}
      </div>
      {workers.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500">Zatial ziadny pracovnik.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-100 text-slate-600 text-left"><th className="px-3 py-2 font-medium">Meno</th><th className="px-3 py-2 font-medium">Typ</th><th className="px-3 py-2"></th></tr></thead>
            <tbody>
              {workers.map((w) => (
                <tr key={w.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{w.meno}</td>
                  <td className="px-3 py-2">
                    <select value={w.typ || "vyroba"} onChange={(e) => changeTyp(w.id, e.target.value)} className="border border-slate-200 rounded-md px-2 py-1 text-xs">
                      {WORKER_TYPY.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <IconButton title="Zmazat" onClick={() => remove(w.id)}><Trash2 size={16} /></IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------- Register surovin a obalov ---------------- */

function MaterialOrdersView({ materialOrders, suppliers, carriers, onNew, onEdit, onSend, onSendSupplier, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(null);
  async function exportToExcel() {
    const rows = materialOrders.map((o) => ({
      "Cislo dopravy": o.cisloObjednavkyDopravy,
      "Dodavatel": o.dodavatel,
      "Adresa vyzdvihnutia": o.adresaVyzdvihnutia,
      "Popis materialu": o.popisMaterialu,
      "Mnozstvo": o.mnozstvo,
      "Termin dodania": o.terminDodaniaNeurcity ? "Bude upresneny" : o.terminDodania,
      "Sposob dopravy": (SPOSOB_DOPRAVY_OPTIONS.find((s) => s.value === o.sposobDopravy) || {}).label || "Objednavame dopravu",
      "Datum vyzdvihnutia": o.sposobDopravy === "dodavatel" ? "" : (o.vyzdvihnutieNeurcite ? "Bude upresnene" : o.datumVyzdvihnutia),
      "Dopravca": (carriers.find((c) => c.id === o.dopravcaId) || {}).nazov || "",
      "Nazov miesta dodania": o.sposobDopravy === "vyzdvihnutie" ? "" : o.adresaDodaniaNazov,
      "Adresa dodania": o.sposobDopravy === "vyzdvihnutie" ? "" : o.adresaDodania,
      "Stav objednavky": o.stavObjednavky || "Neodoslana",
      "Stav dopravy": o.stavDopravy,
      "Poznamka": o.poznamka,
    }));
    await exportRowsToExcel(rows, "Objednavky surovin", "Objednavky_surovin_a_obalov");
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Objednavky surovin a obalov</h1>
        <div className="flex gap-2">
          <button onClick={exportToExcel} disabled={materialOrders.length === 0} title={materialOrders.length === 0 ? "Zoznam je prazdny" : "Exportovat do Excelu"} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-sm font-medium px-3 py-2 rounded-md">
            <Download size={16} /> Export do Excelu
          </button>
          <button onClick={onNew} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md">
            <Plus size={16} /> Nova objednavka
          </button>
        </div>
      </div>
      {materialOrders.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-slate-500">
          <Boxes size={28} className="mx-auto mb-3 text-slate-300" />
          Zatial ziadne objednavky surovin/obalov.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-left">
                <th className="px-3 py-2 font-medium whitespace-nowrap">Cislo dopravy</th>
                <th className="px-3 py-2 font-medium">Dodavatel / adresa vyzdvihnutia</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">Termin dodania</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">Vyzdvihnutie</th>
                <th className="px-3 py-2 font-medium">Objednavka</th>
                <th className="px-3 py-2 font-medium">Doprava</th>
                <th className="px-3 py-2 font-medium text-right">Akcie</th>
              </tr>
            </thead>
            <tbody>
              {materialOrders.map((o) => {
                const carrierMissing = carriers.length === 0;
                const supplier = suppliers.find((s) => s.id === o.dodavatelId);
                const supplierEmailMissing = !supplier || !supplier.email;
                return (
                  <tr key={o.id} onClick={() => onEdit(o)} className="border-t-2 border-slate-300 hover:brightness-95 cursor-pointer">
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{o.cisloObjednavkyDopravy}</td>
                    <td className="px-3 py-2">
                      <div>{o.dodavatel || <span className="text-slate-400">-</span>}</div>
                      <div className="text-xs text-slate-400">{o.adresaVyzdvihnutia}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {o.terminDodaniaNeurcity ? <span className="text-slate-500">Bude upresneny</span> : (o.terminDodania || <span className="text-slate-400">-</span>)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {o.sposobDopravy === "dodavatel" ? (
                        <span className="text-slate-500">Dodavatel dorucuje sam</span>
                      ) : o.vyzdvihnutieNeurcite ? (
                        <span className="text-slate-500">Bude upresnene</span>
                      ) : (
                        o.datumVyzdvihnutia || <span className="text-slate-400">-</span>
                      )}
                      {o.sposobDopravy !== "dodavatel" && !o.vyzdvihnutieNeurcite && o.casVyzdvihnutia && <div className="text-xs text-slate-400">{o.casVyzdvihnutia}</div>}
                    </td>
                    <td className="px-3 py-2"><Badge text={o.stavObjednavky || "Neodoslana"} map={STATUS_MATERIAL_OBJEDNAVKA} /></td>
                    <td className="px-3 py-2"><Badge text={o.stavDopravy} map={STATUS_MATERIAL_DOPRAVA} /></td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1 flex-wrap">
                        <IconButton
                          title={supplierEmailMissing ? "Doplnte e-mail dodavatela" : o.objednavkaOdoslanaInfo ? "Odoslane " + formatDateTime(o.objednavkaOdoslanaInfo.datum) : "Objednavka dodavatelovi"}
                          disabled={supplierEmailMissing}
                          sent={!!o.objednavkaOdoslanaInfo}
                          onClick={() => onSendSupplier(o)}
                        >
                          <Mail size={16} />
                        </IconButton>
                        <IconButton
                          title={o.sposobDopravy === "dodavatel" ? "Dodavatel dorucuje tovar sam - doprava sa neobjednava" : o.sposobDopravy === "vyzdvihnutie" ? "Osobny odber - doprava sa neobjednava" : carrierMissing ? "Najprv pridajte dopravcu v Nastaveniach" : o.dopravaOdoslanaInfo ? "Odoslane " + formatDateTime(o.dopravaOdoslanaInfo.datum) : "Objednavka dopravy"}
                          disabled={o.sposobDopravy !== "doprava" || carrierMissing}
                          sent={!!o.dopravaOdoslanaInfo}
                          onClick={() => onSend(o)}
                        >
                          <Truck size={16} />
                        </IconButton>
                        <IconButton title="Upravit" onClick={() => onEdit(o)}><Pencil size={16} /></IconButton>
                        <IconButton title="Zmazat" onClick={() => setConfirmDelete(o)}><Trash2 size={16} /></IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {confirmDelete && (
        <ModalShell title="Zmazat objednavku?" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-slate-600 mb-4">
            Naozaj chcete zmazat objednavku <b>{confirmDelete.cisloObjednavkyDopravy}</b>
            {confirmDelete.dodavatel ? " (" + confirmDelete.dodavatel + ")" : ""}? Tuto akciu nie je mozne vratit spat.
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDelete(null)} className="text-sm text-slate-500 px-3 py-2">Zrusit</button>
            <button
              onClick={() => { onDelete(confirmDelete.id); setConfirmDelete(null); }}
              className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5"
            >
              <Trash2 size={16} /> Ano, zmazat
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

function MaterialOrderItemsTable({ items, setItems, supplierTovary }) {
  function update(i, key, val) {
    const next = items.slice();
    next[i] = { ...next[i], [key]: val };
    setItems(next);
  }
  function updateMnozstvo(i, cislo, jednotka) {
    const next = items.slice();
    next[i] = { ...next[i], mnozstvoCislo: cislo, mnozstvoJednotka: jednotka, mnozstvo: [cislo, jednotka].filter(Boolean).join(" ").trim() };
    setItems(next);
  }
  function remove(i) { setItems(items.filter((_, idx) => idx !== i)); }
  function addFromCatalog(t) {
    setItems([...items, { popis: t.popis, artikel: t.artikel || "", mnozstvo: "", mnozstvoCislo: "", mnozstvoJednotka: "ks" }]);
  }
  function addCustom() {
    setItems([...items, { popis: "", artikel: "", mnozstvo: "", mnozstvoCislo: "", mnozstvoJednotka: "ks" }]);
  }

  const totals = {};
  items.forEach((it) => {
    const n = parseFloat(String(it.mnozstvoCislo).replace(",", "."));
    if (!it.mnozstvoJednotka || isNaN(n)) return;
    totals[it.mnozstvoJednotka] = (totals[it.mnozstvoJednotka] || 0) + n;
  });
  const totalEntries = Object.entries(totals);

  return (
    <div className="mb-3">
      <span className="block text-xs font-medium text-slate-500 mb-1">Polozky objednavky</span>
      {supplierTovary.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {supplierTovary.map((t, i) => (
            <button key={i} type="button" onClick={() => addFromCatalog(t)} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded-md">
              + {t.popis}
            </button>
          ))}
        </div>
      )}
      {items.length > 0 && (
        <div className="border border-slate-200 rounded-md overflow-hidden mb-1.5">
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-100 text-slate-600 text-left"><th className="px-2 py-1.5">Popis</th><th className="px-2 py-1.5 w-24">Artikel</th><th className="px-2 py-1.5 w-16">Mnozstvo</th><th className="px-2 py-1.5 w-24">Jednotka</th><th className="px-2 py-1.5 w-8"></th></tr></thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-1 py-1"><input value={it.popis} onChange={(e) => update(i, "popis", e.target.value)} className="w-full border border-slate-200 rounded px-1.5 py-1" /></td>
                  <td className="px-1 py-1"><input value={it.artikel} onChange={(e) => update(i, "artikel", e.target.value)} className="w-full border border-slate-200 rounded px-1.5 py-1" /></td>
                  <td className="px-1 py-1"><input value={it.mnozstvoCislo !== undefined ? it.mnozstvoCislo : ""} onChange={(e) => updateMnozstvo(i, e.target.value, it.mnozstvoJednotka || "ks")} inputMode="decimal" placeholder="napr. 2" className="w-full border border-slate-200 rounded px-1.5 py-1" /></td>
                  <td className="px-1 py-1">
                    <select value={it.mnozstvoJednotka || "ks"} onChange={(e) => updateMnozstvo(i, it.mnozstvoCislo, e.target.value)} className="w-full border border-slate-200 rounded px-1.5 py-1">
                      {UNIT_QUICK_PICKS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1 text-center"><button onClick={() => remove(i)} className="text-slate-400 hover:text-red-600"><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {totalEntries.length > 0 && (
        <p className="text-xs text-slate-500 mb-1.5">Spolu: {totalEntries.map(([u, n]) => `${n % 1 === 0 ? n : n.toFixed(2)} ${u}`).join(", ")}</p>
      )}
      <button onClick={addCustom} className="text-xs text-teal-700 hover:text-teal-900 flex items-center gap-1"><Plus size={12} /> Pridat vlastnu polozku</button>
    </div>
  );
}

function MaterialOrderFormModal({ order, suppliers, company, onClose, onSave }) {
  const [f, setF] = useState({ ...EMPTY_MATERIAL_ORDER, datumVyzdvihnutia: todayStr(), adresaDodaniaNazov: (company && company.nazov) || "", ...order, polozky: (order && order.polozky) || [] });
  const selectedSupplier = suppliers.find((s) => s.id === f.dodavatelId);
  const supplierTovary = selectedSupplier ? normalizeTovary(selectedSupplier.tovary) : [];

  function pickSupplier(id) {
    const s = suppliers.find((x) => x.id === id);
    setF({ ...f, dodavatelId: id, dodavatel: s ? s.nazov : f.dodavatel, adresaVyzdvihnutia: s ? (s.adresa || f.adresaVyzdvihnutia) : f.adresaVyzdvihnutia });
  }

  function pickSposobDopravy(next) {
    const stavDopravy =
      next === "dodavatel" ? "Dodavatel doruci sam" :
      next === "vyzdvihnutie" ? "Osobny odber" :
      (f.stavDopravy === "Dodavatel doruci sam" || f.stavDopravy === "Osobny odber") ? "Neobjednana" : f.stavDopravy;
    setF({ ...f, sposobDopravy: next, stavDopravy });
  }

  return (
    <ModalShell title={order ? "Upravit objednavku - " + order.cisloObjednavkyDopravy : "Nova objednavka surovin/obalov"} onClose={onClose} wide>
      <SelectField
        label="Dodavatel"
        value={f.dodavatelId}
        onChange={pickSupplier}
        options={[{ value: "", label: "-- vyberte / doplnim rucne --" }, ...suppliers.map((s) => ({ value: s.id, label: s.nazov }))]}
      />
      <Field label="Nazov dodavatela (zobrazenie)" value={f.dodavatel} onChange={(v) => setF({ ...f, dodavatel: v })} />

      <SegmentedField label="Sposob dorucenia" value={f.sposobDopravy} onChange={pickSposobDopravy} options={SPOSOB_DOPRAVY_OPTIONS} />

      {f.sposobDopravy !== "dodavatel" && (
        <Field label="Adresa vyzdvihnutia (u dodavatela)" value={f.adresaVyzdvihnutia} onChange={(v) => setF({ ...f, adresaVyzdvihnutia: v })} textarea />
      )}

      <MaterialOrderItemsTable items={f.polozky} setItems={(items) => setF({ ...f, polozky: items })} supplierTovary={supplierTovary} />
      <Field label="Popis materialu / obaloveho materialu (zhrnutie, nepovinne ak su vyplnene polozky)" value={f.popisMaterialu} onChange={(v) => setF({ ...f, popisMaterialu: v })} textarea />
      <Field label="Mnozstvo (zhrnutie)" value={f.mnozstvo} onChange={(v) => setF({ ...f, mnozstvo: v })} />

      {f.sposobDopravy !== "vyzdvihnutie" && (
        <>
          <Field label="Nazov miesta dodania (firma)" value={f.adresaDodaniaNazov} onChange={(v) => setF({ ...f, adresaDodaniaNazov: v })} />
          <div className="mb-1 flex flex-wrap gap-1.5">
            {COMPANY_DELIVERY_ADDRESSES.map((a) => (
              <button key={a} type="button" onClick={() => setF({ ...f, adresaDodania: a })} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded-md">{a}</button>
            ))}
          </div>
          <Field label="Adresa dodania (kam ma dodavatel/dopravca tovar doviezt)" value={f.adresaDodania} onChange={(v) => setF({ ...f, adresaDodania: v })} textarea />
        </>
      )}

      <ToggleField label="Termin dodania od dodavatela" value={f.terminDodaniaNeurcity} onChange={(v) => setF({ ...f, terminDodaniaNeurcity: v })} yesLabel="Bude upresneny dodavatelom" noLabel="Zadat datum" />
      {!f.terminDodaniaNeurcity && (
        <DateField label="Termin dodania" value={f.terminDodania} onChange={(v) => setF({ ...f, terminDodania: v })} />
      )}

      {f.sposobDopravy !== "dodavatel" && (
        <>
          <ToggleField label="Termin vyzdvihnutia" value={f.vyzdvihnutieNeurcite} onChange={(v) => setF({ ...f, vyzdvihnutieNeurcite: v })} yesLabel="Bude upresneny" noLabel="Zadat datum" />
          {!f.vyzdvihnutieNeurcite && (
            <div className="grid grid-cols-2 gap-x-3">
              <DateField label="Datum vyzdvihnutia" value={f.datumVyzdvihnutia} onChange={(v) => setF({ ...f, datumVyzdvihnutia: v })} />
              <Field label="Cas vyzdvihnutia" value={f.casVyzdvihnutia} onChange={(v) => setF({ ...f, casVyzdvihnutia: v })} />
            </div>
          )}
        </>
      )}

      <Field label="Poznamka" value={f.poznamka} onChange={(v) => setF({ ...f, poznamka: v })} textarea />
      <div className="flex justify-end mt-2"><button onClick={() => onSave(f)} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Ulozit</button></div>
    </ModalShell>
  );
}

function MaterialTransportModal({ order, carriers, suppliers, company, currentUserName, onClose, onSent }) {
  const last = order.dopravaOdoslanaInfo;
  const [carrierId, setCarrierId] = useState(order.dopravcaId || (carriers[0] ? carriers[0].id : ""));
  const carrier = carriers.find((c) => c.id === carrierId);
  const supplier = (suppliers || []).find((s) => s.id === order.dodavatelId);
  const materialTypStr = materialTypText(supplier ? supplier.typ : null, MATERIAL_ORDER_EMAIL_I18N.sk);
  const [to, setTo] = useState(last ? last.to : (carrier ? carrier.email : ""));
  function pickCarrier(id) {
    setCarrierId(id);
    if (!last) {
      const c = carriers.find((x) => x.id === id);
      setTo(c ? c.email : "");
    }
  }
  const [subject, setSubject] = useState(last ? last.subject : `Objednavka prepravy c. ${order.cisloObjednavkyDopravy}`);
  const [body, setBody] = useState(
    last ? last.body :
    `Dobry den${carrier ? " " + carrier.nazov : ""},\n\n` +
    `objednavame prepravu ${materialTypStr} (objednavka c. ${order.cisloObjednavkyDopravy}).\n\n` +
    `VYZDVIHNUTIE:\n${order.dodavatel || "[dodavatel]"}\n${order.adresaVyzdvihnutia || ""}\n` +
    `Datum: ${order.vyzdvihnutieNeurcite ? "bude upresneny" : (order.datumVyzdvihnutia || "[doplnte]")}${!order.vyzdvihnutieNeurcite && order.casVyzdvihnutia ? " cas: " + order.casVyzdvihnutia : ""}\n\n` +
    `TOVAR:\n${materialOrderItemsText(order)}\n\n` +
    `VYKLADKA:\n${order.adresaDodaniaNazov || company.nazov || ""}\n${order.adresaDodania || company.adresa || ""}\n\n` +
    (order.poznamka ? `Poznamka: ${order.poznamka}\n\n` : "") +
    `Dakujeme a tesime sa na spolupracu.\n\n` +
    `S pozdravom,\n${currentUserName || company.kontaktnaOsoba || ""}\n${company.nazov || ""}\n` +
    `${company.ico ? "IC: " + company.ico + (company.dic ? "  DIC: " + company.dic : "") + "\n" : ""}` +
    `${[company.email, company.tel].filter(Boolean).join("  ")}`
  );

  return (
    <ModalShell title={"Objednavka dopravy - " + order.cisloObjednavkyDopravy} onClose={onClose} extraWide>
      {last && <div className="mb-3 bg-emerald-50 text-emerald-800 text-xs px-3 py-2 rounded-md flex items-center gap-2"><CheckCircle2 size={14} /> Naposledy odoslane {formatDateTime(last.datum)} na {last.to}</div>}
      <SelectField label="Dopravca" value={carrierId} onChange={pickCarrier} options={carriers.map((c) => ({ value: c.id, label: `${c.nazov} (${c.email})` }))} />
      <EmailQuickPicks emaily={carrier ? carrier.emaily : []} onPick={setTo} />
      <Field label="E-mail (komu)" value={to} onChange={setTo} type="email" />
      <Field label="Predmet" value={subject} onChange={setSubject} />
      <Field label="Text spravy" value={body} onChange={setBody} textarea rows={18} />
      <div className="flex justify-end gap-2 mt-2">
        <button onClick={onClose} className="text-sm text-slate-500 px-3 py-2">Zrusit</button>
        <a href={to ? buildMailto(to, subject, body) : "#"} onClick={() => to && onSent(carrierId, { subject, body, to, datum: new Date().toISOString() })} className={"bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5 " + (!to ? "opacity-50 pointer-events-none" : "")}>
          <Truck size={16} /> Odoslat dopravcovi
        </a>
      </div>
    </ModalShell>
  );
}

function MaterialSupplierOrderModal({ order, suppliers, company, currentUserName, onClose, onSent }) {
  const last = order.objednavkaOdoslanaInfo;
  const supplier = suppliers.find((s) => s.id === order.dodavatelId);
  const dodavatelNazov = order.dodavatel || (supplier ? supplier.nazov : "");
  const lang = MATERIAL_ORDER_EMAIL_I18N[(supplier && supplier.jazyk) || "sk"] || MATERIAL_ORDER_EMAIL_I18N.sk;
  const materialTypStr = materialTypText(supplier ? supplier.typ : null, lang);
  const [to, setTo] = useState(last ? last.to : (supplier ? supplier.email : ""));
  const [subject, setSubject] = useState(last ? last.subject : lang.subject(materialTypStr, order.cisloObjednavkyDopravy));
  const terminText = order.terminDodaniaNeurcity ? lang.terminUpresneny : (order.terminDodania || lang.doplnte);
  const [body, setBody] = useState(
    last ? last.body :
    `${lang.dear(dodavatelNazov)}\n\n` +
    `${lang.intro(order.cisloObjednavkyDopravy)}\n\n` +
    `${materialOrderItemsText(order, lang.mnozstvoLabel)}\n\n` +
    `${lang.terminLabel}: ${terminText}\n\n` +
    (order.sposobDopravy === "vyzdvihnutie"
      ? `${lang.vyzdvihneme}\n\n`
      : `${lang.adresaDodaniaLabel}:\n${(order.adresaDodaniaNazov ? order.adresaDodaniaNazov + "\n" : "") + (order.adresaDodania || "")}\n\n`) +
    (order.poznamka ? `${lang.poznamkaLabel}: ${order.poznamka}\n\n` : "") +
    `${lang.thanks}\n\n` +
    `${lang.regards}\n${currentUserName || company.kontaktnaOsoba || ""}\n${company.nazov || ""}\n` +
    `${company.ico ? lang.icLabel + ": " + company.ico + (company.dic ? "  " + lang.dicLabel + ": " + company.dic : "") + "\n" : ""}` +
    `${[company.email, company.tel].filter(Boolean).join("  ")}`
  );

  return (
    <ModalShell title={"Objednavka dodavatelovi - " + order.cisloObjednavkyDopravy} onClose={onClose} extraWide>
      {last && <div className="mb-3 bg-emerald-50 text-emerald-800 text-xs px-3 py-2 rounded-md flex items-center gap-2"><CheckCircle2 size={14} /> Naposledy odoslane {formatDateTime(last.datum)} na {last.to}</div>}
      {supplier && supplier.jazyk && supplier.jazyk !== "sk" && (
        <div className="mb-3 bg-amber-50 text-amber-800 text-xs px-3 py-2 rounded-md flex items-center gap-2">
          <AlertCircle size={14} /> Dodavatel ma nastaveny jazyk komunikacie: {(MATERIAL_JAZYK_OPTIONS.find((o) => o.value === supplier.jazyk) || {}).label}. Text nizsie je predvyplneny v tomto jazyku.
        </div>
      )}
      <EmailQuickPicks emaily={supplier ? supplier.emaily : []} onPick={setTo} />
      <Field label="E-mail (komu)" value={to} onChange={setTo} type="email" />
      <Field label="Predmet" value={subject} onChange={setSubject} />
      <Field label="Text spravy" value={body} onChange={setBody} textarea rows={18} />
      <div className="flex justify-end gap-2 mt-2">
        <button onClick={onClose} className="text-sm text-slate-500 px-3 py-2">Zrusit</button>
        <a href={to ? buildMailto(to, subject, body) : "#"} onClick={() => to && onSent({ subject, body, to, datum: new Date().toISOString() })} className={"bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5 " + (!to ? "opacity-50 pointer-events-none" : "")}>
          <Mail size={16} /> Odoslat dodavatelovi
        </a>
      </div>
    </ModalShell>
  );
}

/* ---------------- Faktura - dodatocne ocenenie prijmov tovaru ---------------- */

function InvoiceUploadModal({ receipts, company, onClose, onApply }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [extracted, setExtracted] = useState(null);
  const [matches, setMatches] = useState([]);
  const [kurz, setKurz] = useState(null);
  const fileInputRef = useRef(null);
  const unpricedReceipts = receipts.filter((r) => r.cenaJednotkovaCzk === "" || r.cenaJednotkovaCzk === undefined || r.cenaJednotkovaCzk === null);

  function pickFile(e) {
    const f = e.target.files && e.target.files[0];
    if (f) setFile(f);
  }

  async function handleExtract() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const b64 = await fileToBase64(file);
      const blocks = [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
        { type: "text", text: INVOICE_EXTRACT_INSTRUCTIONS },
      ];
      const data = await callClaude(blocks, company.apiKey);
      const mena = (data.mena || "CZK").toUpperCase().trim() || "CZK";
      const rateInfo = await getCnbRate(data.datumFaktury, mena, import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
      setExtracted({ ...data, mena });
      setKurz(rateInfo);
      setMatches(
        (data.polozky || []).map((it) => {
          const suggestions = suggestReceiptMatches(it, data.dodavatel, receipts);
          return { item: it, receiptId: suggestions[0] ? suggestions[0].id : "", suggestions };
        })
      );
    } catch (err) {
      setError(err.message || "Extrakcia zlyhala, skuste znova.");
    }
    setBusy(false);
  }

  function setMatchReceipt(i, receiptId) {
    setMatches((prev) => prev.map((m, idx) => (idx === i ? { ...m, receiptId } : m)));
  }

  async function handleApply() {
    setBusy(true);
    setError("");
    try {
      let fakturaPath = "";
      if (file) {
        const ext = (file.name.split(".").pop() || "pdf").toLowerCase();
        const path = `${uid()}/faktura.${ext}`;
        const { error: uploadError } = await supabase.storage.from(INVOICES_BUCKET).upload(path, file, { contentType: file.type });
        if (uploadError) throw uploadError;
        fakturaPath = path;
      }
      const updates = matches
        .filter((m) => m.receiptId)
        .map((m) => {
          const cenaJednotkova = Number(m.item.cenaJednotkova) || 0;
          const rate = kurz ? kurz.rate : 1;
          const cenaJednotkovaCzk = Math.round(cenaJednotkova * rate * 10000) / 10000;
          return {
            receiptId: m.receiptId,
            patch: {
              cenaJednotkova,
              cenaMena: extracted.mena,
              cenaKurz: rate,
              cenaJednotkovaCzk,
              fakturaCislo: extracted.cisloFaktury || "",
              fakturaDatum: extracted.datumFaktury || "",
              fakturaPath,
            },
          };
        });
      if (!updates.length) throw new Error("Nevybrali ste ziadnu zhodu s prijmom tovaru.");
      await onApply(updates);
      onClose();
    } catch (err) {
      setError(err.message || "Ulozenie zlyhalo, skuste znova.");
    }
    setBusy(false);
  }

  return (
    <ModalShell title="Nahrat fakturu" onClose={onClose} extraWide>
      {!extracted ? (
        <>
          <p className="text-xs text-slate-500 mb-3">
            Nahrajte PDF faktury od dodavatela. AI z nej vytiahne polozky a ceny, appka k nim navrhne zodpovedajuce uz zapisane prijmy tovaru (bez ceny) - vy len potvrdite spravnu zhodu.
          </p>
          <button onClick={() => fileInputRef.current && fileInputRef.current.click()} className="w-full flex items-center justify-center gap-1.5 bg-white border-2 border-dashed border-slate-300 hover:border-teal-500 hover:text-teal-700 text-slate-500 text-sm font-medium px-3 py-6 rounded-md mb-3">
            <Upload size={18} /> {file ? file.name : "Vybrat PDF faktury"}
          </button>
          <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={pickFile} />
          {error && <div className="mb-3 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={14} /> {error}</div>}
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={onClose} className="text-sm text-slate-500 px-3 py-2">Zrusit</button>
            <button onClick={handleExtract} disabled={!file || busy} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />} {busy ? "Spracovavam..." : "Extrahovat"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="bg-slate-50 rounded-md px-3 py-2 mb-3 text-sm">
            <div><b>Dodavatel:</b> {extracted.dodavatel || "-"}</div>
            <div><b>Cislo faktury:</b> {extracted.cisloFaktury || "-"}</div>
            <div><b>Datum:</b> {extracted.datumFaktury || "-"}</div>
            <div><b>Mena:</b> {extracted.mena}{kurz && extracted.mena !== "CZK" && ` - kurz CNB ${kurz.rate} CZK/${extracted.mena} (platny pre ${kurz.validFor})`}</div>
          </div>
          {unpricedReceipts.length === 0 && (
            <div className="mb-3 bg-amber-50 text-amber-800 text-xs px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={14} /> Nenasiel sa ziadny prijem tovaru bez ceny na naparovanie. Skontrolujte, ci je prijem uz v systeme zapisany.</div>
          )}
          <div className="border border-slate-200 rounded-md overflow-hidden mb-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-600 text-left">
                  <th className="px-2 py-1.5">Polozka na fakture</th>
                  <th className="px-2 py-1.5 w-24">Mnozstvo</th>
                  <th className="px-2 py-1.5 w-24">Cena/j.</th>
                  <th className="px-2 py-1.5 w-64">Naparovat na prijem tovaru</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((m, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-2 py-1.5">{m.item.popis}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{m.item.mnozstvoCislo} {m.item.mnozstvoJednotka}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{m.item.cenaJednotkova} {extracted.mena}</td>
                    <td className="px-2 py-1.5">
                      <select value={m.receiptId} onChange={(e) => setMatchReceipt(i, e.target.value)} className="w-full border border-slate-200 rounded px-1.5 py-1">
                        <option value="">-- nesparovat --</option>
                        {m.suggestions.length > 0 && (
                          <optgroup label="Navrhovana zhoda">
                            {m.suggestions.map((r) => (
                              <option key={r.id} value={r.id}>{r.material} - {r.mnozstvo} - {r.datumPrijatia} ({r.dodavatel})</option>
                            ))}
                          </optgroup>
                        )}
                        <optgroup label="Vsetky neocenene prijmy">
                          {unpricedReceipts.filter((r) => !m.suggestions.some((s) => s.id === r.id)).map((r) => (
                            <option key={r.id} value={r.id}>{r.material} - {r.mnozstvo} - {r.datumPrijatia} ({r.dodavatel})</option>
                          ))}
                        </optgroup>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && <div className="mb-3 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={14} /> {error}</div>}
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={onClose} className="text-sm text-slate-500 px-3 py-2">Zrusit</button>
            <button onClick={handleApply} disabled={busy} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} {busy ? "Ukladam..." : "Ulozit ceny"}
            </button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

/* ---------------- Prijem tovaru (evidencia pre office) ---------------- */

function GoodsReceiptsView({ receipts, suppliers, materialOrders, onNew, onEdit, onDelete, onUploadInvoice }) {
  const [confirmDelete, setConfirmDelete] = useState(null);
  async function exportToExcel() {
    const rows = receipts.map((r) => ({
      "Datum prijatia": r.datumPrijatia,
      "Cas prijatia": r.casPrijatia,
      "Dodavatel": r.dodavatel,
      "Cislo objednavky": r.materialObjednavkaCislo,
      "Material": r.material,
      "Mnozstvo": r.mnozstvo,
      "Cena/j. (Kc)": r.cenaJednotkovaCzk || "",
      "Cislo faktury": r.fakturaCislo || "",
      "Stav": r.stavPrevzatia,
      "Prevzal": r.prevzal,
      "Pociatocny stav": r.pociatocnyStav ? "Ano" : "Nie",
    }));
    await exportRowsToExcel(rows, "Prijem tovaru", "Prijem_tovaru");
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Prijem tovaru na sklade</h1>
        <div className="flex gap-2">
          <button onClick={exportToExcel} disabled={receipts.length === 0} title={receipts.length === 0 ? "Zoznam je prazdny" : "Exportovat do Excelu"} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-sm font-medium px-3 py-2 rounded-md">
            <Download size={16} /> Export do Excelu
          </button>
          <button onClick={onUploadInvoice} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-3 py-2 rounded-md">
            <FileSpreadsheet size={16} /> Nahrat fakturu
          </button>
          <button onClick={onNew} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md">
            <Plus size={16} /> Novy prijem
          </button>
        </div>
      </div>
      {receipts.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-slate-500">
          <PackagePlus size={28} className="mx-auto mb-3 text-slate-300" />
          Zatial ziadne zaznamy o prijme tovaru.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-left">
                <th className="px-3 py-2 font-medium whitespace-nowrap">Prijate</th>
                <th className="px-3 py-2 font-medium">Dodavatel</th>
                <th className="px-3 py-2 font-medium">Material / mnozstvo</th>
                <th className="px-3 py-2 font-medium">Stav</th>
                <th className="px-3 py-2 font-medium">Prevzal</th>
                <th className="px-3 py-2 font-medium text-right">Akcie</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id} onClick={() => onEdit(r)} className="border-t-2 border-slate-300 hover:brightness-95 cursor-pointer">
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.datumPrijatia || <span className="text-slate-400">-</span>}
                    {r.casPrijatia && <div className="text-xs text-slate-400">{r.casPrijatia}</div>}
                  </td>
                  <td className="px-3 py-2">
                    {r.dodavatel || <span className="text-slate-400">-</span>}
                    {r.pociatocnyStav && <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">Pociatocny stav</span>}
                    {r.materialObjednavkaCislo && <div className="text-xs text-slate-400">obj.: {r.materialObjednavkaCislo}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <div>{r.material || <span className="text-slate-400">-</span>}</div>
                    <div className="text-xs text-slate-400">{r.mnozstvo}</div>
                  </td>
                  <td className="px-3 py-2"><Badge text={r.stavPrevzatia} map={STATUS_PREVZATIA} /></td>
                  <td className="px-3 py-2 text-slate-500">{r.prevzal}</td>
                  <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      {r.photoPath && <IconButton title="Zobrazit fotku" onClick={() => openGoodsReceiptPhoto(r.photoPath)}><Camera size={16} /></IconButton>}
                      {r.fakturaPath && (
                        <IconButton title={`Faktura ${r.fakturaCislo || ""} - cena ${r.cenaJednotkovaCzk} Kc/j.`} sent onClick={() => openInvoiceFile(r.fakturaPath)}>
                          <FileSpreadsheet size={16} />
                        </IconButton>
                      )}
                      <IconButton title="Upravit" onClick={() => onEdit(r)}><Pencil size={16} /></IconButton>
                      <IconButton title="Zmazat" onClick={() => setConfirmDelete(r)}><Trash2 size={16} /></IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {confirmDelete && (
        <ModalShell title="Zmazat zaznam?" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-slate-600 mb-4">Naozaj chcete zmazat tento zaznam o prijme tovaru? Tuto akciu nie je mozne vratit spat.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDelete(null)} className="text-sm text-slate-500 px-3 py-2">Zrusit</button>
            <button onClick={() => { onDelete(confirmDelete.id); setConfirmDelete(null); }} className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5">
              <Trash2 size={16} /> Ano, zmazat
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

function GoodsReceiptFormModal({ receipt, suppliers, materialOrders, existingReceipts, currentUserName, onClose, onSave }) {
  const [formId] = useState(() => (receipt && receipt.id) || uid());
  const [f, setF] = useState({
    ...EMPTY_GOODS_RECEIPT,
    datumPrijatia: todayStr(),
    prevzal: currentUserName || "",
    ...receipt,
  });
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const materialPicks = [...MATERIAL_QUICK_PICKS, ...extraKnownMaterials(existingReceipts, [], MATERIAL_QUICK_PICKS)];

  function pickSupplier(id) {
    const s = suppliers.find((x) => x.id === id);
    setF({ ...f, dodavatelId: id, dodavatel: s ? s.nazov : f.dodavatel });
  }
  function pickMaterialOrder(id) {
    const o = materialOrders.find((x) => x.id === id);
    setF({ ...f, materialObjednavkaId: id, materialObjednavkaCislo: o ? o.cisloObjednavkyDopravy : "" });
  }
  async function handlePhotoSelect(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setPhotoUploading(true);
    setPhotoError("");
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${formId}/photo.${ext}`;
      const { error } = await supabase.storage.from(GOODS_RECEIPT_PHOTOS_BUCKET).upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      setF((prev) => ({ ...prev, photoPath: path }));
    } catch (err) {
      setPhotoError("Nahratie fotky zlyhalo, skuste znova.");
    }
    setPhotoUploading(false);
    if (e.target) e.target.value = "";
  }

  return (
    <ModalShell title={receipt ? "Upravit prijem" : "Novy prijem tovaru"} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-x-3">
        <DateField label="Datum prijatia" value={f.datumPrijatia} onChange={(v) => setF({ ...f, datumPrijatia: v })} />
        <Field label="Cas prijatia" value={f.casPrijatia} onChange={(v) => setF({ ...f, casPrijatia: v })} />
      </div>
      <SelectField
        label="Dodavatel"
        value={f.dodavatelId}
        onChange={pickSupplier}
        options={[{ value: "", label: "-- vyberte / doplnim rucne --" }, ...suppliers.map((s) => ({ value: s.id, label: s.nazov }))]}
      />
      <Field label="Nazov dodavatela (zobrazenie)" value={f.dodavatel} onChange={(v) => setF({ ...f, dodavatel: v })} />
      {materialOrders.length > 0 && (
        <SelectField
          label="Suvisiaca objednavka (Objednavky surovin a obalov) - nepovinne"
          value={f.materialObjednavkaId}
          onChange={pickMaterialOrder}
          options={[{ value: "", label: "-- ziadna --" }, ...materialOrders.map((o) => ({ value: o.id, label: `${o.cisloObjednavkyDopravy} - ${o.dodavatel || ""}` }))]}
        />
      )}
      <div className="mb-1 flex gap-1.5 flex-wrap">
        {materialPicks.map((m) => (
          <button key={m} type="button" onClick={() => setF({ ...f, material: m })} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded-md">{m}</button>
        ))}
      </div>
      <Field label="Material / polozka" value={f.material} onChange={(v) => setF({ ...f, material: v })} />
      <div className="mb-3">
        <span className="block text-xs font-medium text-slate-500 mb-1">Mnozstvo</span>
        <div className="flex gap-2 items-center flex-wrap">
          <input
            value={f.mnozstvoCislo !== undefined && f.mnozstvoCislo !== "" ? f.mnozstvoCislo : ""}
            onChange={(e) => {
              const num = e.target.value;
              setF({ ...f, mnozstvoCislo: num, mnozstvo: [num, f.mnozstvoJednotka].filter(Boolean).join(" ").trim() });
            }}
            inputMode="decimal"
            placeholder="napr. 20"
            className="w-24 border border-slate-200 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
          <select
            value={f.mnozstvoJednotka || "ks"}
            onChange={(e) => {
              const unit = e.target.value;
              setF({ ...f, mnozstvoJednotka: unit, mnozstvo: [f.mnozstvoCislo, unit].filter(Boolean).join(" ").trim() });
            }}
            className="border border-slate-200 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            {UNIT_QUICK_PICKS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
      </div>
      <Field label="Cislo dodacieho listu / faktury od dodavatela" value={f.cisloDokladu} onChange={(v) => setF({ ...f, cisloDokladu: v })} />
      <SelectField
        label="Stav pri prevzati"
        value={f.stavPrevzatia}
        onChange={(v) => setF({ ...f, stavPrevzatia: v })}
        options={[
          { value: "V poriadku", label: "V poriadku" },
          { value: "Poskodene", label: "Poskodene" },
          { value: "Nekompletne", label: "Nekompletne" },
        ]}
      />
      <Field label="Poznamka" value={f.poznamka} onChange={(v) => setF({ ...f, poznamka: v })} textarea />
      <Field label="Prevzal" value={f.prevzal} onChange={(v) => setF({ ...f, prevzal: v })} />
      <div className="mb-3">
        <span className="block text-xs font-medium text-slate-500 mb-1">Fotka (nepovinne)</span>
        <div className="flex items-center gap-2 flex-wrap">
          {f.photoPath && (
            <button type="button" onClick={() => openGoodsReceiptPhoto(f.photoPath)} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1.5 rounded-md flex items-center gap-1"><Camera size={12} /> Zobrazit fotku</button>
          )}
          <label className="text-xs bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-2.5 py-1.5 rounded-md cursor-pointer flex items-center gap-1">
            {photoUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            {f.photoPath ? "Nahradit fotku" : "Nahrat fotku"}
            <input type="file" accept="image/*" className="hidden" onChange={handlePhotoSelect} disabled={photoUploading} />
          </label>
        </div>
        {photoError && <div className="mt-1 text-xs text-red-700">{photoError}</div>}
      </div>
      <div className="flex justify-end mt-2"><button onClick={() => onSave({ ...f, id: formId })} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Ulozit</button></div>
    </ModalShell>
  );
}

/* ---------------- Stav zasob ---------------- */

function formatCzk(n) {
  return Math.round(n).toLocaleString("sk-SK") + " Kc";
}

function StockView({ goodsReceipts, stockIssues, onNew, onEdit, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(null);
  const stock = computeStockLevels(goodsReceipts, stockIssues);
  const celkovaHodnota = stock.reduce((sum, row) => sum + (row.hodnota || 0), 0);
  const pocetNeocenenych = stock.reduce((sum, row) => sum + row.neocenenePrijmy, 0);

  async function exportToExcel() {
    const stockRows = stock.map((row) => ({
      "Material": row.material,
      "Prijate": row.prijate,
      "Vydane": row.vydane,
      "Aktualny stav": row.stav,
      "Jednotka": row.unit,
      "Priemerna cena (Kc)": row.priemernaCena !== null ? Math.round(row.priemernaCena * 100) / 100 : "",
      "Hodnota (Kc)": row.hodnota !== null ? Math.round(row.hodnota) : "",
      "Neocenene prijmy": row.neocenenePrijmy,
    }));
    const issueRows = stockIssues.map((i) => ({
      "Datum": i.datum,
      "Cas": i.cas,
      "Material": i.material,
      "Mnozstvo": i.mnozstvo,
      "Dovod": i.dovod,
      "Zapisal": i.zapisal,
      "Nad stav": i.prekroceniePotvrdene ? "Ano" : "Nie",
    }));
    await exportSheetsToExcel(
      [
        { name: "Stav zasob", rows: stockRows },
        { name: "Posledne vydaje", rows: issueRows },
      ],
      "Stav_zasob"
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Stav zasob</h1>
        <div className="flex gap-2">
          <button onClick={exportToExcel} disabled={stock.length === 0 && stockIssues.length === 0} title={stock.length === 0 && stockIssues.length === 0 ? "Zoznam je prazdny" : "Exportovat do Excelu"} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-sm font-medium px-3 py-2 rounded-md">
            <Download size={16} /> Export do Excelu
          </button>
          <button onClick={onNew} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md">
            <MinusCircle size={16} /> Zapisat vydaj
          </button>
        </div>
      </div>

      {stock.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-slate-500 mb-6">
          <Warehouse size={28} className="mx-auto mb-3 text-slate-300" />
          Zatial ziadne data o zasobach.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto mb-6">
          <div className="flex items-center justify-between px-3 py-2.5 bg-slate-50 border-b border-slate-200 flex-wrap gap-2">
            <span className="text-sm text-slate-600">Celkova hodnota skladu: <b className="text-slate-900">{formatCzk(celkovaHodnota)}</b></span>
            {pocetNeocenenych > 0 && (
              <span className="text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded-md flex items-center gap-1"><AlertCircle size={12} /> {pocetNeocenenych} prijem(ov) caka na fakturu - hodnota je neuplna</span>
            )}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-left">
                <th className="px-3 py-2 font-medium">Material</th>
                <th className="px-3 py-2 font-medium text-right">Prijate</th>
                <th className="px-3 py-2 font-medium text-right">Vydane</th>
                <th className="px-3 py-2 font-medium text-right">Aktualny stav</th>
                <th className="px-3 py-2 font-medium text-right">Hodnota</th>
              </tr>
            </thead>
            <tbody>
              {stock.map((row) => (
                <tr key={row.material + row.unit} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{row.material}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{row.prijate} {row.unit}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{row.vydane} {row.unit}</td>
                  <td className={"px-3 py-2 text-right font-semibold " + (row.stav <= 0 ? "text-red-600" : "")}>{row.stav} {row.unit}</td>
                  <td className="px-3 py-2 text-right text-slate-500">
                    {row.hodnota !== null ? formatCzk(row.hodnota) : <span className="text-slate-400">-</span>}
                    {row.neocenenePrijmy > 0 && <div className="text-xs text-amber-600">+{row.neocenenePrijmy} bez ceny</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="text-sm font-semibold text-slate-500 mb-2">Posledne vydaje</h2>
      {stockIssues.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm">Zatial ziadne zaznamy.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-left">
                <th className="px-3 py-2 font-medium">Datum</th>
                <th className="px-3 py-2 font-medium">Material</th>
                <th className="px-3 py-2 font-medium">Mnozstvo</th>
                <th className="px-3 py-2 font-medium">Dovod</th>
                <th className="px-3 py-2 font-medium">Zapisal</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {stockIssues.map((i) => (
                <tr key={i.id} onClick={() => onEdit(i)} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer">
                  <td className="px-3 py-2 whitespace-nowrap">{i.datum} {i.cas}</td>
                  <td className="px-3 py-2">{i.material}</td>
                  <td className="px-3 py-2 text-slate-500">
                    {i.mnozstvo}
                    {i.prekroceniePotvrdene && <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">nad stav</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{i.dovod}</td>
                  <td className="px-3 py-2 text-slate-500">{i.zapisal}</td>
                  <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <IconButton title="Zmazat" onClick={() => setConfirmDelete(i)}><Trash2 size={16} /></IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmDelete && (
        <ModalShell title="Zmazat vydaj?" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-slate-600 mb-4">Naozaj chcete zmazat tento zaznam o vydaji materialu? Tuto akciu nie je mozne vratit spat.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDelete(null)} className="text-sm text-slate-500 px-3 py-2">Zrusit</button>
            <button onClick={() => { onDelete(confirmDelete.id); setConfirmDelete(null); }} className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5">
              <Trash2 size={16} /> Ano, zmazat
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

function StockIssueFormModal({ issue, existingReceipts, existingIssues, currentUserName, onClose, onSave }) {
  const [formId] = useState(() => (issue && issue.id) || uid());
  const [f, setF] = useState({
    ...EMPTY_STOCK_ISSUE,
    datum: todayStr(),
    zapisal: currentUserName || "",
    ...issue,
  });
  const materialPicks = [...MATERIAL_QUICK_PICKS, ...extraKnownMaterials(existingReceipts, existingIssues, MATERIAL_QUICK_PICKS)];

  return (
    <ModalShell title={issue ? "Upravit vydaj" : "Novy vydaj materialu"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-x-3">
        <DateField label="Datum" value={f.datum} onChange={(v) => setF({ ...f, datum: v })} />
        <Field label="Cas" value={f.cas} onChange={(v) => setF({ ...f, cas: v })} />
      </div>
      <div className="mb-1 flex gap-1.5 flex-wrap">
        {materialPicks.map((m) => (
          <button key={m} type="button" onClick={() => setF({ ...f, material: m })} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded-md">{m}</button>
        ))}
      </div>
      <Field label="Material / polozka" value={f.material} onChange={(v) => setF({ ...f, material: v })} />
      <div className="mb-3">
        <span className="block text-xs font-medium text-slate-500 mb-1">Mnozstvo</span>
        <div className="flex gap-2 items-center flex-wrap">
          <input
            value={f.mnozstvoCislo !== undefined && f.mnozstvoCislo !== "" ? f.mnozstvoCislo : ""}
            onChange={(e) => {
              const num = e.target.value;
              setF({ ...f, mnozstvoCislo: num, mnozstvo: [num, f.mnozstvoJednotka].filter(Boolean).join(" ").trim() });
            }}
            inputMode="decimal"
            placeholder="napr. 20"
            className="w-24 border border-slate-200 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
          <select
            value={f.mnozstvoJednotka || "ks"}
            onChange={(e) => {
              const unit = e.target.value;
              setF({ ...f, mnozstvoJednotka: unit, mnozstvo: [f.mnozstvoCislo, unit].filter(Boolean).join(" ").trim() });
            }}
            className="border border-slate-200 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            {UNIT_QUICK_PICKS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
      </div>
      <SelectField
        label="Dovod"
        value={f.dovod}
        onChange={(v) => setF({ ...f, dovod: v })}
        options={STOCK_ISSUE_REASONS.map((d) => ({ value: d, label: d }))}
      />
      <Field label="Poznamka" value={f.poznamka} onChange={(v) => setF({ ...f, poznamka: v })} textarea />
      <Field label="Zapisal" value={f.zapisal} onChange={(v) => setF({ ...f, zapisal: v })} />
      <div className="flex justify-end mt-2"><button onClick={() => onSave({ ...f, id: formId })} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Ulozit</button></div>
    </ModalShell>
  );
}

/* ---------------- Vyrobny plan ---------------- */

function ProductionPlanView({ productionPlan, products, goodsReceipts, stockIssues, productionOutputs, prestavky, onNew, onEdit, onDelete, onDeleteOutput, onEditOutput, onDeletePrestavka }) {
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmDeleteOutput, setConfirmDeleteOutput] = useState(null);
  const [confirmDeletePrestavka, setConfirmDeletePrestavka] = useState(null);
  const [filterLinka, setFilterLinka] = useState("vsetko");

  const stock = computeStockLevels(goodsReceipts, stockIssues);
  function shortagesFor(row) {
    const product = products.find((p) => p.id === row.produktId);
    const issues = computeProductionIssues(row, product);
    return issues.filter((iss) => {
      const level = stock.find((s) => s.material.toLowerCase() === iss.material.toLowerCase() && s.unit.toLowerCase() === (iss.mnozstvoJednotka || "").toLowerCase());
      return iss.mnozstvoCislo > (level ? level.stav : 0);
    });
  }

  const rows = productionPlan
    .filter((r) => filterLinka === "vsetko" || r.linka === filterLinka)
    .slice()
    .sort((a, b) => (parseSkDate(a.datum) || 0) - (parseSkDate(b.datum) || 0));

  async function exportOutputsToExcel() {
    const exportRows = (productionOutputs || []).map((o) => ({
      "Datum": o.datum,
      "Cas": o.cas,
      "Linka": (PRODUCTION_LINKY.find((l) => l.value === o.linka) || {}).label || o.linka,
      "Produkt": o.produktNazov,
      "Mnozstvo (paliet)": o.mnozstvo,
      "Sarza": o.sarza,
      "Zapisala": o.zapisala,
    }));
    await exportRowsToExcel(exportRows, "Vyrobne zaznamy", "Vyrobne_zaznamy", 16);
  }

  async function exportPrestavkyToExcel() {
    const exportRows = (prestavky || []).map((p) => ({
      "Meno": p.meno,
      "Datum": p.datum,
      "Zaciatok": p.casZaciatku,
      "Koniec": p.casKonca || "prebieha",
      "Trvanie (min)": durationMinutes(p.casZaciatku, p.casKonca) ?? "",
    }));
    await exportRowsToExcel(exportRows, "Prestavky", "Prestavky", 16);
  }

  async function exportPlanToExcel() {
    const exportRows = rows.map((r) => ({
      "Datum": r.datum,
      "Produkt": r.produktNazov,
      "Linka": (PRODUCTION_LINKY.find((l) => l.value === r.linka) || {}).label || r.linka,
      "Mnozstvo": r.mnozstvo,
      "Jednotka": r.mnozstvoJednotka === "kartonov" ? "kartonov" : "paliet",
      "Termin dodania": r.terminDodania,
      "Poznamka": r.poznamka,
    }));
    await exportRowsToExcel(exportRows, "Vyrobny plan", "Vyrobny_plan", 16);
  }

  const printBody = rows
    .map((r) => `${r.datum}  ${r.produktNazov}  -  ${r.mnozstvo} ${r.mnozstvoJednotka === "kartonov" ? "kartonov" : "paliet"}${r.poznamka ? "  (" + r.poznamka + ")" : ""}${r.terminDodania ? "  [termin: " + r.terminDodania + "]" : ""}`)
    .join("\n");

  function handlePrint() {
    setTimeout(() => window.print(), 50);
  }

  return (
    <div>
      <PrintDocument id="production-plan-print" title="Vyrobny plan" body={printBody || "Ziadne zaznamy."} />
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-xl font-semibold">Vyrobny plan</h1>
        <div className="flex gap-2">
          <button onClick={exportPlanToExcel} disabled={rows.length === 0} title={rows.length === 0 ? "Plan je prazdny" : "Exportovat vyrobny plan do Excelu"} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-sm font-medium px-3 py-2 rounded-md">
            <Download size={16} /> Export do Excelu
          </button>
          <button onClick={handlePrint} className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-3 py-2 rounded-md flex items-center gap-1.5"><Printer size={16} /> Tlacit</button>
          <button onClick={onNew} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md">
            <Plus size={16} /> Novy zaznam
          </button>
        </div>
      </div>

      <div className="flex gap-1.5 mb-4">
        {[{ value: "vsetko", label: "Vsetko" }, ...PRODUCTION_LINKY].map((l) => (
          <button key={l.value} onClick={() => setFilterLinka(l.value)} className={"text-sm px-3 py-1.5 rounded-md border " + (filterLinka === l.value ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>{l.label}</button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-slate-500">
          <ClipboardCheck size={28} className="mx-auto mb-3 text-slate-300" />
          Zatial ziadne zaznamy vyrobneho planu.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-left">
                <th className="px-3 py-2 font-medium">Datum</th>
                <th className="px-3 py-2 font-medium">Produkt</th>
                <th className="px-3 py-2 font-medium">Mnozstvo</th>
                <th className="px-3 py-2 font-medium">Termin dodania</th>
                <th className="px-3 py-2 font-medium">Poznamka</th>
                <th className="px-3 py-2 font-medium">Stav vyroby</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const shortages = shortagesFor(r);
                return (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 whitespace-nowrap">{r.datum}</td>
                    <td className="px-3 py-2 font-medium">
                      {r.produktNazov}
                      {shortages.length > 0 && <AlertCircle size={14} className="inline-block ml-1.5 text-red-500 align-text-bottom" />}
                    </td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.mnozstvo} {r.mnozstvoJednotka === "kartonov" ? "kartonov" : "paliet"}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.terminDodania}</td>
                    <td className="px-3 py-2 text-slate-500">{r.poznamka}</td>
                    <td className="px-3 py-2"><Badge text={VYROBA_STATUS_LABELS[r.stavVyroby] || VYROBA_STATUS_LABELS.caka} map={STATUS_VYROBY} /></td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <IconButton title="Upravit" onClick={() => onEdit(r)}><Pencil size={16} /></IconButton>
                        <IconButton title="Zmazat" onClick={() => setConfirmDelete(r)}><Trash2 size={16} /></IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {confirmDelete && (
        <ModalShell title="Zmazat zaznam vyroby?" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-slate-600 mb-4">Naozaj chcete zmazat tento zaznam vyrobneho planu? Uz zapisany vydaj materialu sa tym nezrusi.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDelete(null)} className="text-sm text-slate-500 px-3 py-2">Zrusit</button>
            <button onClick={() => { onDelete(confirmDelete.id); setConfirmDelete(null); }} className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5">
              <Trash2 size={16} /> Ano, zmazat
            </button>
          </div>
        </ModalShell>
      )}

      <div className="flex items-center justify-between mt-8 mb-2">
        <h2 className="text-sm font-semibold text-slate-500">Vyrobne zaznamy (skutocna vyroba)</h2>
        <button onClick={exportOutputsToExcel} className="text-xs text-teal-700 hover:text-teal-900 font-medium flex items-center gap-1"><Download size={14} /> Export do Excelu</button>
      </div>
      {(productionOutputs || []).length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm">Zatial ziadne zaznamy skutocnej vyroby.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-left">
                <th className="px-3 py-2 font-medium">Datum</th>
                <th className="px-3 py-2 font-medium">Produkt</th>
                <th className="px-3 py-2 font-medium">Mnozstvo</th>
                <th className="px-3 py-2 font-medium">Sarza</th>
                <th className="px-3 py-2 font-medium">Zapisala</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {productionOutputs.map((o) => (
                <tr key={o.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 whitespace-nowrap">{o.datum} {o.cas}</td>
                  <td className="px-3 py-2 font-medium">
                    {o.produktNazov}
                    {o.pociatocnyStav && <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">Pociatocny stav</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{o.mnozstvo} paliet</td>
                  <td className="px-3 py-2 text-slate-500">{o.sarza}</td>
                  <td className="px-3 py-2 text-slate-500">{o.zapisala}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <IconButton title="Upravit" onClick={() => onEditOutput(o)}><Pencil size={16} /></IconButton>
                      <IconButton title="Zmazat" onClick={() => setConfirmDeleteOutput(o)}><Trash2 size={16} /></IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between mt-8 mb-2">
        <h2 className="text-sm font-semibold text-slate-500">Prestavky</h2>
        <button onClick={exportPrestavkyToExcel} className="text-xs text-teal-700 hover:text-teal-900 font-medium flex items-center gap-1"><Download size={14} /> Export do Excelu</button>
      </div>
      {(() => {
        const aktualne = (prestavky || []).filter((p) => !p.casKonca);
        return aktualne.length > 0 && (
          <div className="mb-2 bg-amber-50 text-amber-800 text-xs px-3 py-2 rounded-md flex items-center gap-2">
            <AlertCircle size={14} /> Prave na prestavke: {aktualne.map((p) => p.meno).join(", ")}
          </div>
        );
      })()}
      {(prestavky || []).length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm">Zatial ziadne zaznamy prestavok.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-left">
                <th className="px-3 py-2 font-medium">Meno</th>
                <th className="px-3 py-2 font-medium">Datum</th>
                <th className="px-3 py-2 font-medium">Zaciatok</th>
                <th className="px-3 py-2 font-medium">Koniec</th>
                <th className="px-3 py-2 font-medium">Trvanie</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {prestavky.slice(0, 50).map((p) => {
                const mins = durationMinutes(p.casZaciatku, p.casKonca);
                return (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium">{p.meno}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{p.datum}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{p.casZaciatku}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{p.casKonca || <span className="text-amber-600 font-medium">prebieha</span>}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{mins !== null ? mins + " min" : "-"}</td>
                    <td className="px-3 py-2 text-right">
                      <IconButton title="Zmazat" onClick={() => setConfirmDeletePrestavka(p)}><Trash2 size={16} /></IconButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {confirmDeletePrestavka && (
        <ModalShell title="Zmazat zaznam prestavky?" onClose={() => setConfirmDeletePrestavka(null)}>
          <p className="text-sm text-slate-600 mb-4">Naozaj chcete zmazat zaznam prestavky pre "{confirmDeletePrestavka.meno}" ({confirmDeletePrestavka.datum})? Tuto akciu nie je mozne vratit spat.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDeletePrestavka(null)} className="text-sm text-slate-500 px-3 py-2">Zrusit</button>
            <button onClick={() => { onDeletePrestavka(confirmDeletePrestavka.id); setConfirmDeletePrestavka(null); }} className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5">
              <Trash2 size={16} /> Ano, zmazat
            </button>
          </div>
        </ModalShell>
      )}

      {confirmDeleteOutput && (
        <ModalShell title="Zmazat vyrobny zaznam?" onClose={() => setConfirmDeleteOutput(null)}>
          <p className="text-sm text-slate-600 mb-4">Naozaj chcete zmazat tento zaznam skutocnej vyroby? Zarovej sa zrusia aj vydaje surovin, ktore pri jeho ulozeni vznikli (oprava zasob).</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDeleteOutput(null)} className="text-sm text-slate-500 px-3 py-2">Zrusit</button>
            <button onClick={() => { onDeleteOutput(confirmDeleteOutput); setConfirmDeleteOutput(null); }} className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5">
              <Trash2 size={16} /> Ano, zmazat
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

function ProductionPlanFormModal({ plan, products, goodsReceipts, stockIssues, currentUserName, onClose, onSave }) {
  const [formId] = useState(() => (plan && plan.id) || uid());
  const [f, setF] = useState({
    ...EMPTY_PRODUCTION_PLAN,
    datum: todayStr(),
    zapisal: currentUserName || "",
    ...plan,
  });

  const linkaProducts = products.filter((p) => p.linka === f.linka);
  const selectedProduct = products.find((p) => p.id === f.produktId);

  function pickProduct(id) {
    const p = products.find((x) => x.id === id);
    setF({ ...f, produktId: id, produktNazov: p ? productLabel(p) : "" });
  }

  const issues = computeProductionIssues(f, selectedProduct);
  const stock = computeStockLevels(goodsReceipts, stockIssues);
  const shortages = issues.filter((iss) => {
    const level = stock.find((s) => s.material.toLowerCase() === iss.material.toLowerCase() && s.unit.toLowerCase() === (iss.mnozstvoJednotka || "").toLowerCase());
    return iss.mnozstvoCislo > (level ? level.stav : 0);
  });

  return (
    <ModalShell title={plan ? "Upravit zaznam vyroby" : "Novy zaznam vyroby"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-x-3">
        <DateField label="Datum vyroby" value={f.datum} onChange={(v) => setF({ ...f, datum: v })} />
        <SelectField label="Linka" value={f.linka} onChange={(v) => setF({ ...f, linka: v, produktId: "", produktNazov: "" })} options={PRODUCTION_LINKY.map((l) => ({ value: l.value, label: l.label }))} />
      </div>
      <SelectField
        label="Produkt"
        value={f.produktId}
        onChange={pickProduct}
        options={[{ value: "", label: "Vyberte produkt..." }, ...linkaProducts.map((p) => ({ value: p.id, label: productLabel(p) }))]}
      />
      <div className="mb-3">
        <span className="block text-xs font-medium text-slate-500 mb-1">Mnozstvo</span>
        <div className="flex gap-2 items-center flex-wrap">
          <input
            value={f.mnozstvo}
            onChange={(e) => setF({ ...f, mnozstvo: e.target.value })}
            inputMode="decimal"
            placeholder="napr. 30"
            className="w-24 border border-slate-200 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
          <div className="flex gap-1.5">
            {[{ value: "paliet", label: "paliet" }, { value: "kartonov", label: "kartonov" }].map((u) => (
              <button key={u.value} type="button" onClick={() => setF({ ...f, mnozstvoJednotka: u.value })} className={"text-xs px-2.5 py-1.5 rounded-md border " + (f.mnozstvoJednotka === u.value ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>{u.label}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-3">
        <DateField label="Termin dodania (nepovinne)" value={f.terminDodania} onChange={(v) => setF({ ...f, terminDodania: v })} />
        <Field label="Zapisal" value={f.zapisal} onChange={(v) => setF({ ...f, zapisal: v })} />
      </div>
      <Field label="Poznamka (napr. oznacit GERWISCH, pekne palety)" value={f.poznamka} onChange={(v) => setF({ ...f, poznamka: v })} textarea />
      {shortages.length > 0 && (
        <div className="mb-3 bg-amber-50 text-amber-800 text-xs px-3 py-2 rounded-md flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span>Mozny nedostatok materialu: {shortages.map((s) => s.material + " (" + s.mnozstvo + ")").join(", ")}</span>
        </div>
      )}
      <div className="flex justify-end mt-2"><button onClick={() => onSave({ ...f, id: formId })} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Ulozit</button></div>
    </ModalShell>
  );
}

function ProductionOutputEditModal({ output, products, onClose, onSave }) {
  const [f, setF] = useState({ ...output });

  function pickProduct(id) {
    const p = products.find((x) => x.id === id);
    setF({ ...f, produktId: id, produktNazov: p ? productLabel(p) : "", linka: p ? p.linka : f.linka });
  }

  return (
    <ModalShell title="Upravit vyrobny zaznam" onClose={onClose}>
      <DateField label="Datum vyroby" value={f.datum} onChange={(v) => setF({ ...f, datum: v })} />
      <SelectField
        label="Produkt"
        value={f.produktId}
        onChange={pickProduct}
        options={products.map((p) => ({ value: p.id, label: productLabel(p) }))}
      />
      <Field label="Mnozstvo (paliet)" value={f.mnozstvo} onChange={(v) => setF({ ...f, mnozstvo: parseFloat(String(v).replace(",", ".")) || 0 })} />
      <Field label="Sarza" value={f.sarza} onChange={(v) => setF({ ...f, sarza: v })} />
      <Field label="Zapisala" value={f.zapisala} onChange={(v) => setF({ ...f, zapisala: v })} />
      <p className="text-xs text-amber-600 mb-3">Pri ulozeni sa stare vydaje surovin zrusia a nahradia novymi podla upraveneho mnozstva/produktu.</p>
      <div className="flex justify-end mt-2"><button onClick={() => onSave(f)} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Ulozit</button></div>
    </ModalShell>
  );
}

/* ---------------- Dashboard ---------------- */

function DashboardCard({ icon, label, value, tone, onClick }) {
  const Icon = icon;
  return (
    <button onClick={onClick} className="bg-white border border-slate-200 rounded-lg p-4 text-left hover:border-teal-300 hover:shadow-sm transition-shadow">
      <Icon size={20} className={tone || "text-slate-400"} />
      <div className="text-2xl font-semibold mt-2">{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </button>
  );
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function DashboardView({ orders, goodsReceipts, stockIssues, productionOutputs, onGoToRegister, onGoToGoodsReceipts, onGoToStock, onGoToProduction }) {
  const pendingExpedicia = orders.filter((o) => o.stavExpedicie !== "Expedovana").length;
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dueSoon = orders.filter((o) => {
    if (o.stavExpedicie === "Expedovana") return false;
    const d = parseSkDate(o.datumDodania);
    return d && (isSameDay(d, today) || isSameDay(d, tomorrow));
  }).length;
  const todayVyroba = (productionOutputs || [])
    .filter((o) => o.datum === todayStr())
    .reduce((sum, o) => sum + (parseFloat(o.mnozstvo) || 0), 0);
  const problemReceipts = goodsReceipts.filter((r) => r.stavPrevzatia && r.stavPrevzatia !== "V poriadku");
  const upcoming = orders
    .filter((o) => o.stavExpedicie !== "Expedovana")
    .map((o) => ({ o, d: parseSkDate(o.datumDodania) }))
    .filter((x) => x.d)
    .sort((a, b) => a.d - b.d)
    .slice(0, 6);
  const stock = computeStockLevels(goodsReceipts, stockIssues);
  const criticalStock = stock.filter((row) => row.stav <= 0).length;

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Prehlad</h1>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <DashboardCard icon={PackageX} label="Caka na expediciu" value={pendingExpedicia} tone="text-amber-500" onClick={onGoToRegister} />
        <DashboardCard icon={Truck} label="Dnes / zajtra dodanie" value={dueSoon} tone="text-red-500" onClick={onGoToRegister} />
        <DashboardCard icon={Factory} label="Dnesna vyroba (paliet)" value={todayVyroba} tone="text-teal-600" onClick={onGoToProduction} />
        <DashboardCard icon={AlertCircle} label="Kriticke zasoby" value={criticalStock} tone="text-red-500" onClick={onGoToStock} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h2 className="text-sm font-semibold text-slate-500 mb-2">Najblizsie dodania</h2>
          {upcoming.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm">Ziadne nadchadzajuce dodania.</div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              {upcoming.map(({ o }) => (
                <div key={o.id} onClick={onGoToRegister} className="px-4 py-2.5 border-t border-slate-100 first:border-t-0 flex items-center justify-between cursor-pointer hover:bg-slate-50">
                  <div>
                    <div className="font-medium text-sm">{o.zakaznik || "-"}</div>
                    <div className="text-xs text-slate-400">{o.adresaDodaniaNazov}</div>
                  </div>
                  <div className="text-sm text-slate-600 whitespace-nowrap">{o.datumDodania}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="text-sm font-semibold text-slate-500 mb-2">Prijmy s problemom</h2>
          {problemReceipts.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm">Ziadne problemy.</div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              {problemReceipts.slice(0, 6).map((r) => (
                <div key={r.id} onClick={onGoToGoodsReceipts} className="px-4 py-2.5 border-t border-slate-100 first:border-t-0 flex items-center justify-between cursor-pointer hover:bg-slate-50">
                  <div>
                    <div className="font-medium text-sm">{r.dodavatel} <span className="text-slate-400 font-normal">- {r.material}</span></div>
                    <div className="text-xs text-slate-400">{r.datumPrijatia}</div>
                  </div>
                  <Badge text={r.stavPrevzatia} map={STATUS_PREVZATIA} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-slate-500">Stav zasob</h2>
          <button onClick={onGoToStock} className="text-xs text-teal-700 hover:text-teal-900 font-medium">Zobrazit vsetko</button>
        </div>
        {stock.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm">Zatial ziadne data.</div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-100 text-slate-600 text-left"><th className="px-3 py-2 font-medium">Material</th><th className="px-3 py-2 font-medium text-right">Aktualny stav</th></tr></thead>
              <tbody>
                {stock.slice(0, 8).map((row) => (
                  <tr key={row.material + row.unit} className="border-t border-slate-100">
                    <td className="px-3 py-2">{row.material}</td>
                    <td className={"px-3 py-2 text-right font-semibold " + (row.stav <= 0 ? "text-red-600" : "")}>{row.stav} {row.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Company ---------------- */

function CompanyView({ company, onSave }) {
  const [f, setF] = useState(company);
  const [editing, setEditing] = useState(!company.nazov);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setF(company); }, [company]);

  async function handleSave() {
    setSaving(true);
    await onSave(f);
    setSaving(false);
    setEditing(false);
  }

  if (!editing) {
    return (
      <div>
        <h1 className="text-xl font-semibold mb-4">Nastavenia firmy</h1>
        <div className="bg-white border border-slate-200 rounded-lg p-5 max-w-lg">
          <dl className="grid grid-cols-1 gap-y-3 text-sm">
            <CompanyInfoRow label="Nazov spolocnosti" value={company.nazov} />
            <CompanyInfoRow label="Adresa (sklad / miesto nakladky)" value={company.adresa} pre />
            <CompanyInfoRow label="ICO" value={company.ico} />
            <CompanyInfoRow label="DIC" value={company.dic} />
            <CompanyInfoRow label="Telefon" value={company.tel} />
            <CompanyInfoRow label="Kontaktna osoba" value={company.kontaktnaOsoba} />
            <CompanyInfoRow label="E-mail" value={company.email} />
            <CompanyInfoRow label="Anthropic API kluc" value={company.apiKey ? "•••• (nastaveny)" : ""} />
            <CompanyInfoRow label="Posledne pouzite cislo objednavky dopravy" value={company.posledneCisloDopravy} />
            <CompanyInfoRow label="Posledne pouzite cislo dodacieho listu" value={company.posledneCisloDodaciehoListu} />
          </dl>
          {(company.nveEmaily || []).length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <div className="text-xs font-medium text-slate-500 mb-1.5">NVE list - preddefinovane emaily (Nemecko)</div>
              <div className="space-y-1">
                {company.nveEmaily.map((e, i) => (
                  <div key={i} className="text-sm"><b>{e.label}:</b> {e.email}</div>
                ))}
              </div>
            </div>
          )}
          <button onClick={() => { setF(company); setEditing(true); }} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md mt-4">
            <Pencil size={16} /> Upravit
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Nastavenia firmy</h1>
      <div className="bg-white border border-slate-200 rounded-lg p-5 max-w-lg">
        <Field label="Nazov spolocnosti" value={f.nazov} onChange={(v) => setF({ ...f, nazov: v })} />
        <Field label="Adresa (sklad / miesto nakladky)" value={f.adresa} onChange={(v) => setF({ ...f, adresa: v })} textarea />
        <Field label="ICO" value={f.ico} onChange={(v) => setF({ ...f, ico: v })} />
        <Field label="DIC" value={f.dic} onChange={(v) => setF({ ...f, dic: v })} />
        <Field label="Telefon" value={f.tel} onChange={(v) => setF({ ...f, tel: v })} />
        <Field label="Kontaktna osoba" value={f.kontaktnaOsoba} onChange={(v) => setF({ ...f, kontaktnaOsoba: v })} />
        <Field label="E-mail" value={f.email} onChange={(v) => setF({ ...f, email: v })} />
        <Field label="Anthropic API kluc (pre AI extrakciu z PDF, nepovinne)" value={f.apiKey || ""} onChange={(v) => setF({ ...f, apiKey: v })} type="password" />
        <EmailListEditor
          emaily={f.nveEmaily}
          onChange={(list) => setF({ ...f, nveEmaily: list })}
          caption="NVE list - preddefinovane emaily kolegom do Nemecka (napr. Sklad DE) - pri viacerych adresach naraz ich oddelte ciarkou"
        />
        <div className="grid grid-cols-2 gap-x-3">
          <Field label="Posledne pouzite cislo objednavky dopravy" value={String(f.posledneCisloDopravy)} onChange={(v) => setF({ ...f, posledneCisloDopravy: parseInt(v) || 0 })} />
          <Field label="Posledne pouzite cislo dodacieho listu" value={String(f.posledneCisloDodaciehoListu)} onChange={(v) => setF({ ...f, posledneCisloDodaciehoListu: parseInt(v) || 0 })} />
        </div>
        <div className="flex gap-2 mt-2">
          <button onClick={handleSave} disabled={saving} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-60">{saving ? "Ukladam..." : "Ulozit"}</button>
          {company.nazov && (
            <button onClick={() => { setF(company); setEditing(false); }} className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-md">Zrusit</button>
          )}
        </div>
      </div>
      <p className="text-xs text-slate-400 mt-3 max-w-lg">
        Cisla objednavky dopravy a dodacieho listu sa pri kazdej novej objednavke automaticky zvysia o 1 a pripoji sa k nim datum dodania (format cislo/DDMM). Ak potrebujete pokracovat v existujucom rade cisiel, nastavte tu posledne pouzite cislo.
      </p>
      <p className="text-xs text-slate-400 mt-2 max-w-lg">
        API kluc ziskate na <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" className="underline">console.anthropic.com</a> (zalozka API Keys). Je to samostatna platba od Claude Pro/Code predplatneho, ale spracovanie objednavok stoji len halierove sumy. Kluc je viditelny len pouzivatelom s rolou office, nikam inam sa neposiela okrem priamo do Anthropic API.
      </p>
    </div>
  );
}

function CompanyInfoRow({ label, value, pre }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className={"text-slate-800" + (pre ? " whitespace-pre-wrap" : "")}>{value || value === 0 ? value : <span className="text-slate-300">-</span>}</dd>
    </div>
  );
}

function PricelistTable({ pricelist }) {
  const cityCount = pricelist && pricelist.cities ? Object.keys(pricelist.cities).length : 0;
  if (!pricelist || cityCount === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-slate-500">
        <Euro size={28} className="mx-auto mb-3 text-slate-300" />
        Cennik zatial nie je nahraty.
      </div>
    );
  }
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="text-sm text-slate-600 mb-3">
        Nahrany subor: <b>{pricelist.fileName}</b>
        {pricelist.uploadedAt ? " (" + formatDateTime(pricelist.uploadedAt) + ")" : ""} - {cityCount} miest, {pricelist.buckets.length} rozsahov poctu paletovych miest.
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs w-full">
          <thead>
            <tr className="bg-slate-100 text-slate-600 text-left">
              <th className="px-2 py-1.5 whitespace-nowrap">Mesto</th>
              {pricelist.buckets.map((b) => (
                <th key={b.label} className="px-2 py-1.5 whitespace-nowrap">{b.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.keys(pricelist.cities).sort().map((city) => (
              <tr key={city} className="border-t border-slate-100">
                <td className="px-2 py-1 font-medium whitespace-nowrap">{city}</td>
                {pricelist.cities[city].map((v, i) => (
                  <td key={i} className="px-2 py-1 whitespace-nowrap">{v == null ? <span className="text-slate-300">-</span> : v.toFixed(2)}</td>
                ))}
              </tr>
            ))}
            <tr className="border-t border-slate-200 bg-slate-50 font-medium">
              <td className="px-2 py-1 whitespace-nowrap">Vratka pal. (priplatok)</td>
              {pricelist.vratkaPal.map((v, i) => (
                <td key={i} className="px-2 py-1 whitespace-nowrap">{v == null ? <span className="text-slate-300">-</span> : v.toFixed(2)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TransportPriceCalculator({ pricelist }) {
  const [mesto, setMesto] = useState("");
  const [pocet, setPocet] = useState("");
  const [vymena, setVymena] = useState(false);
  const result = (mesto.trim() && pocet.trim()) ? computeTransportPriceForCity(mesto, pocet, vymena, pricelist) : null;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4 max-w-2xl">
      <h2 className="text-sm font-semibold mb-3">Rychly vypocet ceny dopravy</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4">
        <Field label="Mesto dodania" value={mesto} onChange={setMesto} />
        <Field label="Pocet paletovych miest" value={pocet} onChange={setPocet} />
        <ToggleField label="Paletova vymena" value={vymena} onChange={setVymena} yesLabel="Ano" noLabel="Nie" />
      </div>
      {result && (
        result.matched ? (
          <div className="mt-1 text-lg font-semibold text-teal-700">{formatEur(result.total)}</div>
        ) : (
          <div className="mt-1 text-sm text-amber-700 flex items-center gap-1.5"><AlertCircle size={14} /> {result.reason}</div>
        )
      )}
    </div>
  );
}

function PricelistArchiveSection({ pricelistArchive, onRestore, onDeleteEntry }) {
  const [viewing, setViewing] = useState(null);
  if (!pricelistArchive.length) return null;
  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold mb-2 text-slate-700">Archiv cennikov (neaktualne)</h2>
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-100 text-slate-600 text-left"><th className="px-3 py-2 font-medium">Subor</th><th className="px-3 py-2 font-medium">Archivovane</th><th className="px-3 py-2"></th></tr></thead>
          <tbody>
            {pricelistArchive.map((entry) => (
              <tr key={entry.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{entry.file_name || entry.data.fileName || "cennik"}</td>
                <td className="px-3 py-2 text-slate-500">{formatDateTime(entry.archived_at)}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    <IconButton title="Zobrazit" onClick={() => setViewing(entry)}><ClipboardList size={16} /></IconButton>
                    <IconButton title="Obnovit ako aktualny" onClick={() => onRestore(entry)}><CheckCircle2 size={16} /></IconButton>
                    <IconButton title="Zmazat natrvalo" onClick={() => onDeleteEntry(entry.id)}><Trash2 size={16} /></IconButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {viewing && (
        <ModalShell title={"Archivovany cennik - " + (viewing.file_name || viewing.data.fileName || "")} onClose={() => setViewing(null)} wide>
          <PricelistTable pricelist={viewing.data} />
          <div className="flex justify-end mt-3">
            <button onClick={() => { onRestore(viewing); setViewing(null); }} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Obnovit ako aktualny</button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

function PricelistView({ pricelist, pricelistArchive, onUpload, onDelete, onRestore, onDeleteArchiveEntry }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);
  const hasPricelist = pricelist && pricelist.cities && Object.keys(pricelist.cities).length > 0;

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const buf = await file.arrayBuffer();
      const parsed = await parsePricelistFile(buf);
      await onUpload({ ...parsed, fileName: file.name, uploadedAt: new Date().toISOString() });
    } catch (err) {
      setError(err.message || "Nepodarilo sa spracovat subor.");
    }
    setBusy(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Cennik doprav</h1>
        <div className="flex gap-2">
          {hasPricelist && (
            <button onClick={onDelete} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-3 py-2 rounded-md">
              <Trash2 size={16} /> Vymazat cennik
            </button>
          )}
          <label className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md cursor-pointer">
            <Upload size={16} /> Nahrat cennik (Excel/ODS)
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.ods,.csv" className="hidden" onChange={handleFile} />
          </label>
        </div>
      </div>
      <p className="text-xs text-slate-400 mb-3 max-w-2xl">
        Prvy riadok suboru musi obsahovat nazvy rozsahov poctu paletovych miest (napr. "1-2pal", "3-4pal"...). Kazdy dalsi riadok je jedno mesto dodania s cenami pre jednotlive rozsahy. Riadok s nazvom zacinajucim na "vratka pal" je priplatok za vymenu paliet, ktory sa pripocita, ak ma objednavka nastavene "Palety zpet: Ano". Pri nahrati noveho alebo vymazani cennika sa ten predosly automaticky presunie do archivu nizsie.
      </p>
      {error && (
        <div className="mb-3 bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}
      {busy && (
        <div className="mb-3 text-sm text-slate-500 flex items-center gap-2">
          <Loader2 size={16} className="animate-spin" /> Spracovavam subor...
        </div>
      )}
      <TransportPriceCalculator pricelist={pricelist} />
      <PricelistTable pricelist={pricelist} />
      <PricelistArchiveSection pricelistArchive={pricelistArchive} onRestore={onRestore} onDeleteEntry={onDeleteArchiveEntry} />
    </div>
  );
}
