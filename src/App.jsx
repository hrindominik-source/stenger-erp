import React, { useState, useEffect, useCallback, useRef, useMemo, Suspense, lazy } from "react";
import { createPortal } from "react-dom";
import {
  Truck, FileText, Plus, Trash2, Pencil, X, Upload,
  Clipboard, CheckCircle2, Building2, Users, Loader2, AlertCircle,
  ClipboardList, ArrowLeft, Download, Layers, FileSignature, Printer, Package,
  LogOut, PackageCheck, PackageX, Euro, Factory, Boxes, PackagePlus, Camera,
  LayoutDashboard, Warehouse, MinusCircle, FlaskConical, ClipboardCheck, UserCheck, Menu, Mail, Calendar, FileSpreadsheet, Receipt,
  Recycle, Calculator, Image, Construction, BookOpen, ListChecks, CalendarClock, Coffee, ChevronDown, ChevronUp, BarChart3, Settings, KeyRound, History, ShieldCheck, Stamp
} from "lucide-react";
import { supabase } from "./supabaseClient.js";
import { useAuth } from "./lib/auth.js";
import Login from "./Login.jsx";
const SkladView = lazy(() => import("./SkladView.jsx"));
const VyrobaView = lazy(() => import("./VyrobaView.jsx"));
const PlanSmienView = lazy(() => import("./PlanSmienView.jsx"));
const KvalitaView = lazy(() => import("./KvalitaView.jsx"));
const UctovnictviView = lazy(() => import("./UctovnictviView.jsx"));
import { extractCityFromAddress, todayStr, uid, parseSkDate, isoFromSkDateStr, skDateStrFromIso, durationMinutes, formatMinutes } from "./lib/utils.js";
import { parsePricelistFile, computeTransportPrice, computeTransportPriceForCity, formatEur } from "./lib/pricelist.js";
import { buildLieferscheinXlsx } from "./lib/lieferscheinXlsx.js";
import { buildCmrXlsx } from "./lib/cmrXlsx.js";
import { parseSupplierCatalogFile, mergeSupplierCatalog } from "./lib/supplierCatalog.js";
import { exportRowsToExcel, exportSheetsToExcel } from "./lib/exportExcel.js";
import { computeStockLevels, computeProductionIssues, extraKnownMaterials, materialPicksForSupplier, allKnownMaterials, suggestReceiptMatches, UNIT_QUICK_PICKS } from "./lib/inventory.js";
import { diffProductionPlanFields, isPlanZmenaActive, formatZmenaText } from "./lib/planZmena.js";
import { getCnbRate } from "./lib/exchangeRate.js";
import { summarizeMonth, computeDayHours, shiftInterval, clampShiftStart } from "./lib/dochadzka.js";

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
const ULOHY_ZODPOVEDNY_OPTIONS = [{ value: "", label: "— nevybráno —" }, ...ULOHY_OSOBY.map((o) => ({ value: o, label: o }))];
const EMPTY_ULOHA = { popis: "", osoby: [], termin: "", hotovo: false, zodpovedny: "", zastupca: "" };
const MATERIAL_TYP_OPTIONS = [
  { value: "surovina", label: "Suroviny" },
  { value: "obal", label: "Obalový materiál" },
];
// Legacy dat mohol mat "typ" ako obycajny retazec (pred zavedenim viacnasobneho vyberu).
function normalizeSupplierTyp(typ) {
  if (Array.isArray(typ)) return typ.length ? typ : ["obal"];
  if (typeof typ === "string" && typ) return [typ];
  return ["obal"];
}
const MATERIAL_JAZYK_OPTIONS = [
  { value: "sk", label: "Slovenština" },
  { value: "cz", label: "Čeština" },
  { value: "en", label: "Angličtina" },
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
const COMPANY_DELIVERY_ADDRESSES = ["Plynárenská 366, 261 01 Příbram I"];
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
  { value: "doprava", label: "Objednáváme dopravu" },
  { value: "dodavatel", label: "Dodavatel doručuje sám" },
  { value: "vyzdvihnutie", label: "Osobny odber" },
];
const STATUS_MATERIAL_OBJEDNAVKA = {
  "Neodoslana": "bg-slate-100 text-slate-700",
  "Odoslana": "bg-emerald-100 text-emerald-700",
};
const MATERIAL_QUICK_PICKS = ["Kukuřice Mushroom Yellow", "Cukr Tereos krystal", "Sůl SUPERFINE", "Tuk AKOSNAC NT MB", "Kartony", "Kbelíky", "Fólie", "Střešní fólie", "Pásky"];
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
const DESIGNS_BUCKET = "designs";
const SW_PRICELIST_BUCKET = "sw-pricelist";
const NAVODY_BUCKET = "navody";
const DESIGN_KATEGORIE = [
  { value: "kbelik", label: "Kbelíky (IML)" },
  { value: "sacky", label: "Sáčky (fólie)" },
  { value: "ine", label: "Iné" },
];
const EMPTY_DESIGN = { nazov: "", kategoria: "kbelik", tlacoveDataPath: "", tlacoveDataNazov: "", nahladPath: "", fotkaPath: "" };
const STOCK_ISSUE_REASONS = ["Vyroba", "Testovanie/vzorky", "Znehodnotene", "Ine"];
const EMPTY_REKLAMACE = {
  datum: "",
  dodavatel: "",
  material: "",
  mnozstvoCislo: "",
  mnozstvoJednotka: "ks",
  mnozstvo: "",
  dovod: "",
  poznamka: "",
  stav: "Ceka na vyzdvihnutie",
  zapisal: "",
  issueId: null,
  dodavatelId: "",
};
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
  { value: "sacky", label: "Sáčky (fólie)" },
  { value: "kyble", label: "Kbelíky" },
  { value: "bulk", label: "Bulk" },
];
const VYROBA_STATUS_LABELS = { caka: "Čeká", prebieha: "Probíhá", hotovo: "Ukončeno" };
const STATUS_VYROBY = {
  "Čeká": "bg-slate-100 text-slate-700",
  "Probíhá": "bg-blue-100 text-blue-700",
  "Ukončeno": "bg-emerald-100 text-emerald-700",
};
const EMPTY_PRODUCT = {
  znacka: "",
  gramaz: "",
  ksVKartone: "",
  kartonovNaPalete: "",
  linka: "sacky",
  receptura: [],
  designId: "",
  cisloArtiklu: "",
  cisloArtikluSW: "",
  inhlt: "",
  eanKarton: "",
  eanUnit: "",
  rspo: false,
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
  const label = mnozstvoLabel || "Množství";
  if (order.polozky && order.polozky.length) {
    return order.polozky
      .map((it, i) => {
        const head = `${i + 1}. ${it.popis}${it.artikel ? " (art. " + it.artikel + ")" : ""}`;
        return it.mnozstvo ? `${head}\n   ${label}: ${it.mnozstvo}` : head;
      })
      .join("\n");
  }
  return [order.popisMaterialu, order.mnozstvo].filter(Boolean).join(" - ") || "[doplňte]";
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
// Rozpozna, ci je miesto dodania v Nemecku (podla textu adresy/nazvu miesta dodania) -
// pouziva sa na vyber spravneho zoznamu NVE/dodaci-list emailov (Nemecko vs. export).
// Nemecke adresy v tychto dokumentoch casto krajinu vobec neuvadzaju (napr. len
// "76437 Rastatt"), zatial co zahranicne adresy krajinu takmer vzdy explicitne
// pisu (napr. "FRANKREICH") - preto je predvolena hodnota Nemecko a na export sa
// prepne len ak adresa vyslovne spomina inu krajinu.
function isGermanDelivery(order) {
  const text = `${order.adresaDodania || ""} ${order.adresaDodaniaNazov || ""}`;
  const foreignCountry = /frankreich|france|francúzsko|francie|österreich|rakousko|polska|polsko|italia|itálie|nederland|holandsko|belgie|belgium|schweiz|švýcarsko|\bCH-\d{4}\b|\bA-\d{4}\b|\bF-\d{5}\b|\bPL-\d{2}-?\d{3}\b|\bNL-\d{4}\b|\bB-\d{4}\b/i.test(text);
  if (foreignCountry) return false;
  return true;
}
// Vyberie z ucelovych emailov (napr. zakaznika) tie, ktorych "ucel" (label)
// obsahuje niektore z klucovych slov (napr. "leh"/"cc" pre Nemecko, "export"
// pre zvysok) - pouziva sa na predvyplnenie "Komu" podla krajiny dodania.
function pickEmailsByKeyword(emaily, keywords) {
  const matched = (emaily || []).filter((e) => keywords.some((k) => (e.label || "").toLowerCase().includes(k)));
  return matched.map((e) => e.email).join(", ");
}
// Predvoleny dopravca v objednavke dopravy - Dorys, ak existuje, inak prvy v zozname.
function defaultCarrierId(carriers) {
  const dorys = (carriers || []).find((c) => (c.nazov || "").toLowerCase().includes("dorys"));
  if (dorys) return dorys.id;
  return carriers && carriers[0] ? carriers[0].id : "";
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
  if (!d) return "[doplňte]";
  return formatSkDate(subtractBusinessDays(d, 2));
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = () => reject(new Error("Nepodařilo se načíst soubor"));
    r.readAsDataURL(file);
  });
}

async function callClaude(contentBlocks, apiKey) {
  if (!apiKey) throw new Error("Chyba API klíče. Doplňte ho v Nastavení firmy, aby fungovala AI extrakce.");
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
    throw new Error("Chyba při komunikaci s AI (" + response.status + "). " + errText.slice(0, 200));
  }
  const data = await response.json();
  const text = (data.content || []).map((b) => b.text || "").join("\n");
  const clean = text.replace(/```json|```/g, "").trim();
  const jsonStart = clean.indexOf("{");
  const jsonEnd = clean.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) throw new Error("AI nevrátila platný JSON");
  return JSON.parse(clean.slice(jsonStart, jsonEnd + 1));
}

const EXTRACT_INSTRUCTIONS = `Si asistent, ktory z textu/dokumentu objednavky zakaznika (typicky od Stenger Waffeln GmbH, pripadne inych zakaznikov) vytiahne strukturovane udaje pre logisticku firmu.
Odpovedz VYLUCNE JSON objektom v tomto presnom tvare (bez ciarok naviac, bez markdown, bez vysvetlenia):
{
  "zakaznik": "nazov firmy zakaznika (odberatela, ktoremu sa fakturuje - napr. Stenger Waffeln GmbH, zvycajne v hlavicke dokumentu ako odosielatel objednavky)",
  "adresaDodaniaNazov": "nazov skutocneho mista dodania - hlada sa v sekcii oznacenej 'delivery address' alebo podobne, je to zvycajne INY subjekt ako zakaznik (napr. konkretny retazec/sklad ako Netto Marken-Discount, EDEKA, PICNIC DC1 a pod.). Ak je prvy riadok tejto sekcie len vseobecny popis bez konkretneho mena (napr. 'Firma'/'Company'), preskoc ho a pouzi az dalsi riadok s konkretnym nazvom. NIKDY nepouzi posledny riadok tejto sekcie, ak je to samostatny nazov krajiny (napr. 'NIEDERLANDE', 'FRANKREICH', 'DEUTSCHLAND') - krajina sem nepatri, len skutocny nazov miesta/skladu.",
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
  "poznamka": "akakolvek dalsia dolezita poznamka z objednavky (napr. specialne baliace/dodacie podmienky), inak prazdny retazec",
  "polozky": [
    { "popis": "presny nazov polozky ako v dokumente (stlpec Bezeichnung)", "artikel": "hlavne cislo artiklu polozky presne ako v dokumente (stlpec Artikelnr./Art.-Nr./Artikel) - pouzi VZDY len HLAVNE (prve, najhornejsie) cislo v tomto stlpci. POZOR na dva odlisne pripady: (1) ak je TO ISTE cislo kvoli sirke stlpca rozdelene na viac riadkov (napr. posledna cislica osamote na dalsom riadku hned pod predoslymi cislicami), SPOJ ich do jedneho cisla, nikdy neodrezavaj poslednu cislicu. (2) ak je pod hlavnym cislom v tej istej bunke este SAMOSTATNY doplnkovy text/kod (napr. nazov zakaznika a ich vlastne interne oznacenie ako 'EDEKA 6215200' alebo 'NM 6215200' pod cislom '11000000422'), NESPAJAJ ho s hlavnym cislom - pouzi len to hlavne cislo, doplnkovy text ignoruj", "palet": "pocet paliet tejto konkretnej polozky ako text, len ak je to v dokumente uvedene osobitne pre kazdu polozku ako samostatny stlpec/udaj (zriedkave), inak prazdny retazec. DOLEZITE: NIKDY nepouzi cislo pri texte 'Doppelstockpal.'/'DOPA'/'Europaletten'/'Stellplatze' ako pocet paliet polozky, ani ked sa tento text nachadza priamo vedla alebo pod polozkou v dokumente - je to VZDY celkovy sucet za celu objednavku (patri do samostatnych polí pocetPaliet/pocetPaletovychMiest), nikdy nie hodnota jednej polozky", "karton": "mnozstvo tejto polozky ako text - hodnota zo stlpca Menge/ME s jednotkou KRT/karton" }
  ]
}
Ak nejaky udaj v texte chyba, nechaj ho ako prazdny retazec "". Neodhaduj veci, ktore tam nie su.
Dolezite rozlisenie cisiel:
- "cisloObjednavkyZakaznika" (Belegnummer) a "mercareonRef" (ORDER-N° retazca) su DVE ROZDIELNE cisla z roznych casti dokumentu - nezamienaj ich.
- "pocetPaliet" (Europaletten) a "pocetPaletovychMiest" (Stellplatze) su tiez dve rozdielne cisla z riadku 'Doppelstockpal. = Europaletten = Stellplatze' - pri dvojitom stohovani je pocet paliet dvojnasobny oproti poctu miest.
- "pocetKartonov" je uplne iny, samostatny udaj - sucet vsetkych KRT mnozstiev z tabulky poloziek.
Dolezite k "polozky": ak dokument obsahuje jasnu tabulku jednotlivych poloziek (stlpce typu Pos./Artikelnr./Bezeichnung/Menge), vytiahni KAZDU polozku ako samostatny zaznam v poli "polozky" - toto pole ma prednost pred "popisTovaru" pri zobrazovani na dodacom liste. Ak dokument nema ziadnu jasnu tabulku poloziek (len volny text bez struktury), nechaj "polozky" ako prazdne pole [].`;

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

const APP_CHOICE_KEY = "stenger_app_choice";

const APP_LAUNCHER_CARDS = [
  {
    key: "erp",
    label: "Stenger ONE",
    desc: "Objednávky, sklad, výroba, dodavatelé",
    icon: <LayoutDashboard size={30} />,
    badge: "from-teal-400 to-teal-600",
    shadow: "shadow-teal-500/40",
    ring: "hover:border-teal-300",
  },
  {
    key: "planovanie",
    label: "Plán směn",
    desc: "Plánování směn ve výrobě",
    icon: <CalendarClock size={30} />,
    badge: "from-amber-400 to-amber-600",
    shadow: "shadow-amber-500/40",
    ring: "hover:border-amber-300",
  },
  {
    key: "kvalita",
    label: "Kvalita a kontroly",
    desc: "Checklisty, termíny a BOZP",
    icon: <ShieldCheck size={30} />,
    badge: "from-violet-400 to-violet-600",
    shadow: "shadow-violet-500/40",
    ring: "hover:border-violet-300",
  },
  {
    key: "uctovnictvi",
    label: "Účetnictví",
    desc: "Připravujeme",
    icon: <Calculator size={30} />,
    badge: "from-sky-400 to-sky-600",
    shadow: "shadow-sky-500/40",
    ring: "hover:border-sky-300",
  },
];

function AppLauncher({ onChoose }) {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4" style={{ fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}>
      <div className="w-full max-w-2xl">
        <div className="text-center mb-10">
          <img src="/stenger-logo.png" alt="Stenger" className="h-16 w-auto mx-auto mb-3" />
          <div className="text-xs tracking-wider text-slate-400">Stenger Czech s.r.o.</div>
        </div>
        <div className="grid sm:grid-cols-2 gap-6">
          {APP_LAUNCHER_CARDS.map((c) => (
            <button
              key={c.key}
              onClick={() => onChoose(c.key)}
              className={"group bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-200 " + c.ring}
            >
              <span className={"inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br text-white shadow-lg mb-4 transition-transform duration-200 group-hover:scale-110 " + c.badge + " " + c.shadow}>
                {c.icon}
              </span>
              <div className="text-lg font-bold text-slate-900">{c.label}</div>
              <div className="text-sm text-slate-500 mt-1">{c.desc}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function MiniERP() {
  const { loading: authLoading, session, profile, profileError, signIn, signOut } = useAuth();
  const [appChoice, setAppChoice] = useState(() => {
    try { return localStorage.getItem(APP_CHOICE_KEY) || null; } catch (e) { return null; }
  });

  function chooseApp(choice) {
    try { localStorage.setItem(APP_CHOICE_KEY, choice); } catch (e) {}
    setAppChoice(choice);
  }
  function switchApp() {
    try { localStorage.removeItem(APP_CHOICE_KEY); } catch (e) {}
    setAppChoice(null);
  }

  if (!appChoice) {
    return <AppLauncher onChoose={chooseApp} />;
  }

  if (appChoice === "planovanie") {
    return (
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-slate-500"><Loader2 className="animate-spin mr-2" size={20} /> Načítám...</div>}>
        <PlanSmienView onBack={switchApp} />
      </Suspense>
    );
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        <Loader2 className="animate-spin mr-2" size={20} /> Načítám...
      </div>
    );
  }
  if (!session) {
    return <Login onSignIn={signIn} onSwitchApp={switchApp} />;
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
      <Loader2 className="animate-spin mr-2" size={20} /> Načítám...
    </div>
  );
  if (appChoice === "kvalita") {
    if (profile?.role !== "office") {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-4 text-center text-slate-600">
          <AlertCircle size={24} className="text-red-500" />
          <p className="max-w-sm text-sm">Nemáte oprávnění zobrazit tuto sekci.</p>
          <button onClick={switchApp} className="flex items-center gap-1.5 text-sm text-teal-700 hover:text-teal-900">
            <ArrowLeft size={14} /> Zpět na výběr appky
          </button>
        </div>
      );
    }
    return (
      <Suspense fallback={lazyFallback}>
        <KvalitaView fullName={profile.full_name} onSignOut={signOut} onBack={switchApp} />
      </Suspense>
    );
  }
  if (appChoice === "uctovnictvi") {
    if (profile?.role !== "office") {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-4 text-center text-slate-600">
          <AlertCircle size={24} className="text-red-500" />
          <p className="max-w-sm text-sm">Nemáte oprávnění zobrazit tuto sekci.</p>
          <button onClick={switchApp} className="flex items-center gap-1.5 text-sm text-teal-700 hover:text-teal-900">
            <ArrowLeft size={14} /> Zpět na výběr appky
          </button>
        </div>
      );
    }
    return (
      <Suspense fallback={lazyFallback}>
        <UctovnictviView fullName={profile.full_name} onSignOut={signOut} onBack={switchApp} />
      </Suspense>
    );
  }
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
const AUDIT_LOG_ALLOWED_EMAILS = ["dh@stenger.eu"];
const RSPO_CERT_CODE = "BVC-RSPO-CZ009581, PALMÖL MB";

function OfficeApp({ userFullName, userEmail, onSignOut }) {
  const [view, setView] = useState("dashboard"); // dashboard | register | carriers | customers | company | ...
  const [orders, setOrders] = useState([]);
  const [carriers, setCarriers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [company, setCompany] = useState({
    nazov: "", adresa: "", ico: "", dic: "", tel: "", kontaktnaOsoba: "", email: "", apiKey: "",
    posledneCisloDopravy: 60400, posledneCisloDodaciehoListu: 60400, posledneCisloObjednavky: 0,
    nveEmaily: [], nveEmailyExport: [],
  });
  const [pricelist, setPricelist] = useState(null);
  const [pricelistArchive, setPricelistArchive] = useState([]);
  const [swPricelist, setSwPricelist] = useState(null);
  const [swPricelistArchive, setSwPricelistArchive] = useState([]);
  const [cennikJinychZakazniku, setCennikJinychZakazniku] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [materialOrders, setMaterialOrders] = useState([]);
  const [goodsReceipts, setGoodsReceipts] = useState([]);
  const [stockIssues, setStockIssues] = useState([]);
  const [products, setProducts] = useState([]);
  const [productionPlan, setProductionPlan] = useState([]);
  const [productionOutputs, setProductionOutputs] = useState([]);
  const [prestavky, setPrestavky] = useState([]);
  const [pauzy, setPauzy] = useState([]);
  const [dochadzkaNastavenia, setDochadzkaNastavenia] = useState({ zaciatokVyroba: "06:00", zaciatokSklad: "06:00" });
  const [ccpKontroly, setCcpKontroly] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [ulohy, setUlohy] = useState([]);
  const [expedicniaZaznamy, setExpedicniaZaznamy] = useState([]);
  const [designs, setDesigns] = useState([]);
  const [navody, setNavody] = useState([]);
  const [reklamace, setReklamace] = useState([]);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [showNewOrder, setShowNewOrder] = useState(false);
  const [transportOrder, setTransportOrder] = useState(null);
  const [deliveryOrder, setDeliveryOrder] = useState(null);
  const [palletOrder, setPalletOrder] = useState(null);
  const [cmrOrder, setCmrOrder] = useState(null);
  const [nveOrder, setNveOrder] = useState(null);
  const [lsGermanyOrder, setLsGermanyOrder] = useState(null);
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
  const [showNewTestProductionIssue, setShowNewTestProductionIssue] = useState(false);
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
      setLoadError("Nepodařilo se načíst objednávky.");
      return;
    }
    setOrders((data || []).map((row) => ({ ...row.data, stavExpedicie: row.stav_expedicie })));
  }, []);

  const fetchExpedicniaZaznamy = useCallback(async () => {
    const { data, error } = await supabase.from("expedicia_zaznamy").select("*").order("created_at", { ascending: false });
    if (error) return;
    setExpedicniaZaznamy((data || []).map((row) => ({ ...row.data, orderId: row.order_id })));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [ordersRes, carriersRes, customersRes, companyRes, pricelistRes, suppliersRes, materialOrdersRes, pricelistArchiveRes, goodsReceiptsRes, stockIssuesRes, productsRes, productionPlanRes, productionOutputsRes, prestavkyRes, pauzyRes, dochadzkaNastaveniaRes, workersRes, ulohyRes, expedicniaZaznamyRes, designsRes, swPricelistRes, swPricelistArchiveRes, navodyRes, reklamaceRes, ccpKontrolyRes, cennikJinychZakaznikuRes] = await Promise.all([
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
          supabase.from("pauzy").select("*").order("created_at", { ascending: false }),
          supabase.from("dochadzka_nastavenia").select("*").eq("id", 1).single(),
          supabase.from("workers").select("*"),
          supabase.from("ulohy").select("*").order("created_at", { ascending: false }),
          supabase.from("expedicia_zaznamy").select("*").order("created_at", { ascending: false }),
          supabase.from("designs").select("*").order("created_at", { ascending: false }),
          supabase.from("sw_pricelist").select("*").eq("id", 1).single(),
          supabase.from("sw_pricelist_archive").select("*").order("archived_at", { ascending: false }),
          supabase.from("navody").select("*").order("created_at", { ascending: false }),
          supabase.from("reklamace").select("*").order("created_at", { ascending: false }),
          supabase.from("ccp_kontroly").select("*").order("created_at", { ascending: false }),
          supabase.from("cennik_jini_zakaznici").select("*"),
        ]);
        if (ordersRes.error || carriersRes.error || customersRes.error || companyRes.error) {
          setLoadError("Nepodařilo se načíst uložená data.");
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
              posledneCisloObjednavky: companyRes.data.posledne_cislo_objednavky,
              posledneCisloObjednavkyMaterial: companyRes.data.posledne_cislo_objednavky_material,
            }));
          }
          if (pricelistRes.data && pricelistRes.data.data && pricelistRes.data.data.buckets) {
            setPricelist(pricelistRes.data.data);
          }
          if (swPricelistRes.data && swPricelistRes.data.data && swPricelistRes.data.data.path) {
            setSwPricelist(swPricelistRes.data.data);
          }
          if (!swPricelistArchiveRes.error) setSwPricelistArchive(swPricelistArchiveRes.data || []);
          if (!cennikJinychZakaznikuRes.error) setCennikJinychZakazniku((cennikJinychZakaznikuRes.data || []).map((row) => row.data));
          if (!navodyRes.error) setNavody((navodyRes.data || []).map((row) => row.data));
          if (!reklamaceRes.error) setReklamace((reklamaceRes.data || []).map((row) => row.data));
          if (!ccpKontrolyRes.error) setCcpKontroly((ccpKontrolyRes.data || []).map((row) => row.data));
          if (!suppliersRes.error) setSuppliers((suppliersRes.data || []).map((row) => row.data));
          if (!materialOrdersRes.error) setMaterialOrders((materialOrdersRes.data || []).map((row) => row.data));
          if (!pricelistArchiveRes.error) setPricelistArchive(pricelistArchiveRes.data || []);
          if (!goodsReceiptsRes.error) setGoodsReceipts((goodsReceiptsRes.data || []).map((row) => row.data));
          if (!stockIssuesRes.error) setStockIssues((stockIssuesRes.data || []).map((row) => row.data));
          if (!productsRes.error) setProducts((productsRes.data || []).map((row) => row.data));
          if (!productionPlanRes.error) setProductionPlan((productionPlanRes.data || []).map((row) => row.data));
          if (!productionOutputsRes.error) setProductionOutputs((productionOutputsRes.data || []).map((row) => row.data));
          if (!prestavkyRes.error) setPrestavky((prestavkyRes.data || []).map((row) => row.data));
          if (!pauzyRes.error) setPauzy((pauzyRes.data || []).map((row) => row.data));
          if (dochadzkaNastaveniaRes.data) {
            setDochadzkaNastavenia((prev) => ({ ...prev, ...dochadzkaNastaveniaRes.data.data }));
          }
          if (!workersRes.error) setWorkers((workersRes.data || []).map((row) => row.data));
          if (!ulohyRes.error) setUlohy((ulohyRes.data || []).map((row) => row.data));
          if (!expedicniaZaznamyRes.error) setExpedicniaZaznamy((expedicniaZaznamyRes.data || []).map((row) => ({ ...row.data, orderId: row.order_id })));
          if (!designsRes.error) setDesigns((designsRes.data || []).map((row) => row.data));
        }
      } catch (e) {
        console.error(e);
        setLoadError("Nepodařilo se načíst uložená data.");
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

  useEffect(() => {
    const channel = supabase
      .channel("expedicia-zaznamy-office")
      .on("postgres_changes", { event: "*", schema: "public", table: "expedicia_zaznamy" }, () => {
        fetchExpedicniaZaznamy();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchExpedicniaZaznamy]);

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
      console.error(e);
      setCarriers(prev);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
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
      console.error(e);
      setCustomers(prev);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
    }
  }
  async function persistCompany(next) {
    setCompany(next);
    const { posledneCisloDopravy, posledneCisloDodaciehoListu, posledneCisloObjednavky, ...rest } = next;
    try {
      const { error } = await supabase
        .from("company")
        .update({
          data: rest,
          posledne_cislo_dopravy: posledneCisloDopravy,
          posledne_cislo_dodacieho_listu: posledneCisloDodaciehoListu,
          posledne_cislo_objednavky: posledneCisloObjednavky,
        })
        .eq("id", 1);
      if (error) throw error;
      setToast("Údaje o firmě byly uloženy.");
    } catch (e) {
      console.error(e);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
    }
  }
  async function persistDochadzkaNastavenia(next) {
    const prev = dochadzkaNastavenia;
    setDochadzkaNastavenia(next);
    try {
      const { error } = await supabase.from("dochadzka_nastavenia").update({ data: next }).eq("id", 1);
      if (error) throw error;
      setToast("Nastavení docházky bylo uloženo.");
    } catch (e) {
      console.error(e);
      setDochadzkaNastavenia(prev);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
    }
  }

  async function archiveCurrentPricelist() {
    if (!pricelist || !pricelist.buckets || !pricelist.buckets.length) return true;
    const entry = { id: uid(), data: pricelist, file_name: pricelist.fileName || null };
    try {
      const { error } = await supabase.from("pricelist_archive").insert(entry);
      if (error) throw error;
      setPricelistArchive((prev) => [{ ...entry, archived_at: new Date().toISOString() }, ...prev]);
      return true;
    } catch (e) {
      console.error(e);
      setLoadError("Archivace ceníku se nezdařila, nový ceník nebyl uložen.");
      return false;
    }
  }

  async function persistPricelist(next) {
    if (!(await archiveCurrentPricelist())) return;
    setPricelist(next);
    try {
      const { error } = await supabase.from("pricelist").update({ data: next }).eq("id", 1);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setLoadError("Uložení ceníku se nezdařilo, zkuste to znovu.");
    }
  }

  async function deletePricelist() {
    if (!(await archiveCurrentPricelist())) return;
    setPricelist({});
    try {
      const { error } = await supabase.from("pricelist").update({ data: {} }).eq("id", 1);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setLoadError("Smazání ceníku se nezdařilo, zkuste to znovu.");
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
      console.error(e);
      setLoadError("Smazání z archivu se nezdařilo, zkuste to znovu.");
    }
  }

  async function archiveCurrentSwPricelist() {
    if (!swPricelist || !swPricelist.path) return true;
    const entry = { id: uid(), data: swPricelist, file_name: swPricelist.fileName || null };
    try {
      const { error } = await supabase.from("sw_pricelist_archive").insert(entry);
      if (error) throw error;
      setSwPricelistArchive((prev) => [{ ...entry, archived_at: new Date().toISOString() }, ...prev]);
      return true;
    } catch (e) {
      console.error(e);
      setLoadError("Archivace ceniku SW GmbH se nezdarila, novy cenik nebyl ulozen.");
      return false;
    }
  }

  async function persistSwPricelist(next) {
    if (!(await archiveCurrentSwPricelist())) return;
    setSwPricelist(next);
    try {
      const { error } = await supabase.from("sw_pricelist").update({ data: next }).eq("id", 1);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setLoadError("Ulozeni ceniku SW GmbH se nezdarilo, zkuste to znovu.");
    }
  }

  async function restoreSwPricelistFromArchive(entry) {
    await persistSwPricelist(entry.data);
  }

  async function deleteSwPricelistArchiveEntry(id) {
    setSwPricelistArchive((prev) => prev.filter((e) => e.id !== id));
    try {
      const { error } = await supabase.from("sw_pricelist_archive").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setLoadError("Smazani z archivu se nezdarilo, zkuste to znovu.");
    }
  }

  async function saveNewNavod(fields) {
    const navod = { ...fields, id: fields.id || uid() };
    setNavody((prev) => [navod, ...prev]);
    try {
      const { error } = await supabase.from("navody").insert({ id: navod.id, data: navod });
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setLoadError("Uložení návodu se nezdařilo, zkuste to znovu.");
    }
    return navod;
  }

  async function deleteNavod(id) {
    setNavody((prev) => prev.filter((n) => n.id !== id));
    try {
      const { error } = await supabase.from("navody").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setLoadError("Smazání návodu se nezdařilo, zkuste to znovu.");
    }
  }

  async function saveNewReklamace(fields) {
    const rec = { ...EMPTY_REKLAMACE, ...fields, id: fields.id || uid() };
    if (rec.material && rec.mnozstvoCislo) {
      const issue = await saveNewStockIssue({
        datum: rec.datum,
        material: rec.material,
        mnozstvoCislo: rec.mnozstvoCislo,
        mnozstvoJednotka: rec.mnozstvoJednotka,
        mnozstvo: rec.mnozstvo,
        dovod: "Znehodnotene",
        poznamka: `Reklamace${rec.dodavatel ? " - " + rec.dodavatel : ""}${rec.dovod ? " (" + rec.dovod + ")" : ""}`,
        zapisal: rec.zapisal,
      });
      rec.issueId = issue.id;
    }
    setReklamace((prev) => [rec, ...prev]);
    try {
      const { error } = await supabase.from("reklamace").insert({ id: rec.id, data: rec });
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setReklamace((prev) => prev.filter((r) => r.id !== rec.id));
      if (rec.issueId) await deleteStockIssue(rec.issueId);
      setLoadError("Uložení reklamace se nezdařilo, zkuste to znovu.");
    }
    return rec;
  }

  async function updateReklamace(id, patch) {
    const current = reklamace.find((r) => r.id === id);
    if (!current) return;
    const merged = { ...current, ...patch };
    setReklamace((prev) => prev.map((r) => (r.id === id ? merged : r)));
    try {
      const { error } = await supabase.from("reklamace").update({ data: merged }).eq("id", id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setLoadError("Uložení reklamace se nezdařilo, zkuste to znovu.");
    }
  }

  async function deleteReklamace(id) {
    const rec = reklamace.find((r) => r.id === id);
    setReklamace((prev) => prev.filter((r) => r.id !== id));
    try {
      const { error } = await supabase.from("reklamace").delete().eq("id", id);
      if (error) throw error;
      if (rec && rec.issueId) await deleteStockIssue(rec.issueId);
    } catch (e) {
      console.error(e);
      setLoadError("Smazání reklamace se nezdařilo, zkuste to znovu.");
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
      console.error(e);
      setSuppliers(prev);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
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
      console.error(e);
      setProducts(prev);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
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
      console.error(e);
      setWorkers(prev);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
    }
  }

  async function persistCennikJinychZakazniku(next) {
    const prev = cennikJinychZakazniku;
    setCennikJinychZakazniku(next);
    try {
      const prevIds = new Set(prev.map((e) => e.id));
      const nextIds = new Set(next.map((e) => e.id));
      const toDelete = [...prevIds].filter((id) => !nextIds.has(id));
      if (next.length) {
        const { error } = await supabase.from("cennik_jini_zakaznici").upsert(next.map((e) => ({ id: e.id, data: e })));
        if (error) throw error;
      }
      if (toDelete.length) {
        const { error } = await supabase.from("cennik_jini_zakaznici").delete().in("id", toDelete);
        if (error) throw error;
      }
    } catch (e) {
      console.error(e);
      setCennikJinychZakazniku(prev);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
    }
  }

  async function saveNewMaterialOrder(fields) {
    const { data: num, error: numError } = await supabase.rpc("next_material_order_number");
    if (numError || num === null || num === undefined) {
      setLoadError("Nepodařilo se přidělit číslo objednávky, zkuste to znovu.");
      return;
    }
    const order = {
      ...EMPTY_MATERIAL_ORDER,
      ...fields,
      id: uid(),
      cisloObjednavkyDopravy: `M${String(num).padStart(4, "0")}/${new Date().getFullYear()}`,
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
      console.error(e);
      setLoadError("Uložení objednávky se nezdařilo, zkuste to znovu.");
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
      console.error(e);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
    }
  }

  async function deleteMaterialOrder(id) {
    setMaterialOrders((prev) => prev.filter((o) => o.id !== id));
    try {
      const { error } = await supabase.from("material_orders").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
    }
  }

  async function saveNewUloha(fields) {
    const uloha = { ...EMPTY_ULOHA, ...fields, id: uid() };
    setUlohy((prev) => [uloha, ...prev]);
    try {
      const { error } = await supabase.from("ulohy").insert({ id: uloha.id, data: uloha });
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setLoadError("Uložení úkolu se nezdařilo, zkuste to znovu.");
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
      console.error(e);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
    }
  }

  async function deleteUloha(id) {
    setUlohy((prev) => prev.filter((u) => u.id !== id));
    try {
      const { error } = await supabase.from("ulohy").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
    }
  }

  async function updateExpedicniaZaznam(id, patch) {
    const current = expedicniaZaznamy.find((z) => z.id === id);
    if (!current) return;
    const merged = { ...current, ...patch };
    setExpedicniaZaznamy((prev) => prev.map((z) => (z.id === id ? merged : z)));
    try {
      const { orderId, ...data } = merged;
      const { error } = await supabase.from("expedicia_zaznamy").update({ data }).eq("id", id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
    }
  }

  async function deleteExpedicniaZaznam(id) {
    setExpedicniaZaznamy((prev) => prev.filter((z) => z.id !== id));
    try {
      const { error } = await supabase.from("expedicia_zaznamy").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
    }
  }

  async function saveNewDesign(fields) {
    const design = { ...EMPTY_DESIGN, ...fields, id: fields.id || uid() };
    setDesigns((prev) => [design, ...prev]);
    try {
      const { error } = await supabase.from("designs").insert({ id: design.id, data: design });
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
    }
    return design;
  }

  async function updateDesign(id, patch) {
    const current = designs.find((d) => d.id === id);
    if (!current) return;
    const merged = { ...current, ...patch };
    setDesigns((prev) => prev.map((d) => (d.id === id ? merged : d)));
    try {
      const { error } = await supabase.from("designs").update({ data: merged }).eq("id", id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
    }
  }

  async function deleteDesign(id) {
    setDesigns((prev) => prev.filter((d) => d.id !== id));
    try {
      const { error } = await supabase.from("designs").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
    }
  }

  async function saveNewGoodsReceipt(fields) {
    const receipt = { ...EMPTY_GOODS_RECEIPT, ...fields, id: fields.id || uid() };
    setGoodsReceipts((prev) => [receipt, ...prev]);
    try {
      const { error } = await supabase.from("goods_receipts").insert({ id: receipt.id, data: receipt });
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
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
      console.error(e);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
    }
  }

  async function deleteGoodsReceipt(id) {
    setGoodsReceipts((prev) => prev.filter((r) => r.id !== id));
    try {
      const { error } = await supabase.from("goods_receipts").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
    }
  }

  async function saveNewStockIssue(fields) {
    const issue = { ...EMPTY_STOCK_ISSUE, ...fields, id: fields.id || uid() };
    setStockIssues((prev) => [issue, ...prev]);
    try {
      const { error } = await supabase.from("stock_issues").insert({ id: issue.id, data: issue });
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
    }
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
      console.error(e);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
    }
  }

  async function saveTestProductionIssueBatch(lines) {
    await Promise.all(lines.map((line) => saveNewStockIssue(line)));
    setShowNewTestProductionIssue(false);
    setToast(`Zapsáno ${lines.length} výdej(ů) pro testovací výrobu.`);
  }

  async function deleteStockIssue(id) {
    setStockIssues((prev) => prev.filter((i) => i.id !== id));
    try {
      const { error } = await supabase.from("stock_issues").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
    }
  }

  async function saveNewProductionPlan(fields) {
    const plan = { ...EMPTY_PRODUCTION_PLAN, ...fields, id: fields.id || uid(), zapisal: fields.zapisal || userFullName || "" };
    setProductionPlan((prev) => [plan, ...prev]);
    try {
      const { error } = await supabase.from("production_plan").insert({ id: plan.id, data: plan });
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
    }
    setShowNewProductionPlan(false);
    return plan;
  }

  async function updateProductionPlan(id, patch) {
    const current = productionPlan.find((p) => p.id === id);
    if (!current) return;
    let merged = { ...current, ...patch };
    // Oznaci, ktore konkretne polia planu office prave zmenil a s akymi hodnotami
    // (predtym/potom), aby to Vyroba/Sklad/Office videli konkretne (24 hodin) -
    // zmena stavVyroby samotnou vyrobou sa nepocita.
    const { zmenene, detail } = diffProductionPlanFields(current, patch, (v) => (PRODUCTION_LINKY.find((l) => l.value === v) || {}).label || v);
    if (zmenene.length > 0) {
      merged = { ...merged, zmenenePolia: zmenene, zmeneneKedy: new Date().toISOString(), zmenyDetail: detail };
    }
    setProductionPlan((prev) => prev.map((p) => (p.id === id ? merged : p)));
    try {
      const { error } = await supabase.from("production_plan").update({ data: merged }).eq("id", id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
    }
  }

  async function deleteProductionPlan(id) {
    setProductionPlan((prev) => prev.filter((p) => p.id !== id));
    try {
      const { error } = await supabase.from("production_plan").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
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
      console.error(e);
      setLoadError("Smazání se nezdařilo, zkuste to znovu.");
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
            poznamka: "Šarže " + (merged.sarza || "") + " - " + (merged.produktNazov || ""),
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
      console.error(e);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
    }
  }

  // Oprava/zmazanie zaznamu prestavky (napr. ked pracovnicka zabudla tuknut koniec).
  async function deletePrestavka(id) {
    const prevList = prestavky;
    setPrestavky((prev) => prev.filter((p) => p.id !== id));
    try {
      const { error } = await supabase.from("prestavky").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setPrestavky(prevList);
      setLoadError("Smazání se nezdařilo, zkuste to znovu.");
    }
  }

  async function updatePrestavka(id, patch) {
    const current = prestavky.find((p) => p.id === id);
    if (!current) return;
    const prevList = prestavky;
    const merged = { ...current, ...patch };
    setPrestavky((prev) => prev.map((p) => (p.id === id ? merged : p)));
    try {
      const { error } = await supabase.from("prestavky").update({ data: merged }).eq("id", id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setPrestavky(prevList);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
    }
  }

  async function deletePauza(id) {
    const prevList = pauzy;
    setPauzy((prev) => prev.filter((p) => p.id !== id));
    try {
      const { error } = await supabase.from("pauzy").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setPauzy(prevList);
      setLoadError("Smazání se nezdařilo, zkuste to znovu.");
    }
  }

  async function updatePauza(id, patch) {
    const current = pauzy.find((p) => p.id === id);
    if (!current) return;
    const prevList = pauzy;
    const merged = { ...current, ...patch };
    setPauzy((prev) => prev.map((p) => (p.id === id ? merged : p)));
    try {
      const { error } = await supabase.from("pauzy").update({ data: merged }).eq("id", id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setPauzy(prevList);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
    }
  }

  async function exportToExcel() {
    const rows = orders.map((o) => ({
      "Číslo objednávky dopravy": o.cisloObjednavkyDopravy || "",
      "Číslo dodacího listu": o.cisloDodaciehoListu || "",
      "Číslo objednávky zákazníka": o.cisloObjednavkyZakaznika || "",
      "Datum přijetí": o.datumPrijatia,
      "Zákazník": o.zakaznik,
      "Místo dodání": (o.adresaDodaniaNazov ? o.adresaDodaniaNazov + " - " : "") + o.adresaDodania,
      "Datum dodání": o.datumDodania,
      "Čas dodání": o.casDodania,
      "Počet palet": o.pocetPaliet,
      "Počet paletových míst": o.pocetPaletovychMiest,
      "Počet kartonů": o.pocetKartonov,
      "Hmotnost": o.hmotnost,
      "Palety zpět": o.paletyZpat ? "Ano" : "Nie",
      "Dopravce": (carriers.find((c) => c.id === o.dopravcaId) || {}).nazov || "",
      "Stav objednávky": o.stavObjednavky,
      "Stav dopravy": o.stavDopravy,
      "Stav expedice": o.stavExpedicie === "Expedovana" ? "Expedovana" : "Neexpedovana",
      "Dodací list odeslán": o.dodaciListOdoslany === "Ano" ? "Ano" : "Nie",
      "Paletový lístek připraven": o.paletovyListokInfo ? "Ano" : "Nie",
      "CMR připraveno": o.cmrInfo ? "Ano" : "Nie",
      "Poznámka": o.poznamka,
    }));
    await exportRowsToExcel(rows, "Registr objednávek", "Register_objednavok");
  }

  async function saveNewOrder(fields) {
    const suffix = ddmmFromSkDateStr(fields.datumDodania);
    const { data: numData, error: numError } = await supabase.rpc("next_order_numbers");
    if (numError || !numData || !numData[0]) {
      setLoadError("Nepodařilo se přidělit číslo objednávky, zkuste to znovu.");
      return;
    }
    const { doprava_num: dopravaNum, dodak_num: dodakNum, objednavka_num: objednavkaNum } = numData[0];
    const order = {
      id: uid(),
      cisloObjednavky: `OBJ-${new Date().getFullYear()}-${String(objednavkaNum).padStart(4, "0")}`,
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
      cisloObjednavkyDopravy: `${String(dopravaNum).padStart(4, "0")}/${suffix}`,
      cisloDodaciehoListu: `${String(dodakNum).padStart(4, "0")}/${suffix}`,
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
      console.error(e);
      setLoadError("Uložení objednávky se nezdařilo, zkuste to znovu.");
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
      console.error(e);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
    }
  }
  async function deleteOrder(id) {
    setOrders((prev) => prev.filter((o) => o.id !== id));
    try {
      const { error } = await supabase.from("orders").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setLoadError("Uložení se nezdařilo, zkuste to znovu.");
    }
  }
  async function toggleExpedicia(order) {
    const next = order.stavExpedicie === "Expedovana" ? "Neexpedovana" : "Expedovana";
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, stavExpedicie: next } : o)));
    try {
      const { error } = await supabase.rpc("set_expedovana", { p_id: order.id, p_val: next });
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, stavExpedicie: order.stavExpedicie } : o)));
      setLoadError("Změna stavu expedice se nezdařila, zkuste to znovu.");
    }
  }

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-96 text-slate-500">
        <Loader2 className="animate-spin mr-2" size={20} /> Načítám...
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
            expedicniaZaznamy={expedicniaZaznamy}
            products={products}
            onUpdateExpedicia={updateExpedicniaZaznam}
            onDeleteExpedicia={deleteExpedicniaZaznam}
            onNew={() => setShowNewOrder(true)}
            onOpenTransport={(o) => setTransportOrder(o)}
            onOpenDelivery={(o) => setDeliveryOrder(o)}
            onOpenPallet={(o) => setPalletOrder(o)}
            onOpenCmr={(o) => setCmrOrder(o)}
            onOpenNve={(o) => setNveOrder(o)}
            onOpenLsGermany={(o) => setLsGermanyOrder(o)}
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
            defaultAdresaNakladky={company.adresa || ""}
            customers={customers}
            products={products}
            company={company}
            orders={orders}
          />
        )}
        {view === "register" && editingOrder && (
          <EditOrderPage
            order={editingOrder}
            customers={customers}
            products={products}
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
        {view === "waffelnpricelist" && (
          <SwPricelistView
            swPricelist={swPricelist}
            swPricelistArchive={swPricelistArchive}
            onUpload={persistSwPricelist}
            onRestore={restoreSwPricelistFromArchive}
            onDeleteArchiveEntry={deleteSwPricelistArchiveEntry}
            cennikJinychZakazniku={cennikJinychZakazniku}
            onSaveCennikJinychZakazniku={persistCennikJinychZakazniku}
            products={products}
          />
        )}
        {view === "ekokom" && <PlaceholderView title="EKO-KOM" />}
        {view === "reporting" && (
          CENOTVORBA_ALLOWED_EMAILS.includes(userEmail)
            ? <PlaceholderView title="Reporting" />
            : (
              <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-slate-500">
                <AlertCircle size={28} className="mx-auto mb-3 text-slate-300" />
                Nemate opravnenie zobrazit tuto sekciu.
              </div>
            )
        )}
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
        {view === "auditlog" && (
          AUDIT_LOG_ALLOWED_EMAILS.includes(userEmail)
            ? <AuditLogView />
            : (
              <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-slate-500">
                <AlertCircle size={28} className="mx-auto mb-3 text-slate-300" />
                Nemate opravnenie zobrazit tuto sekciu.
              </div>
            )
        )}
        {view === "designs" && (
          <DesignsView designs={designs} onSave={saveNewDesign} onUpdate={updateDesign} onDelete={deleteDesign} />
        )}
        {view === "navody" && (
          <NavodyView navody={navody} onSave={saveNewNavod} onDelete={deleteNavod} />
        )}
        {view === "reklamace" && (
          <ReklamaceView reklamace={reklamace} suppliers={suppliers} currentUserName={userFullName} onSave={saveNewReklamace} onUpdate={updateReklamace} onDelete={deleteReklamace} />
        )}
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
            onNewTestProduction={() => setShowNewTestProductionIssue(true)}
            onEdit={(i) => setEditingStockIssue(i)}
            onDelete={deleteStockIssue}
          />
        )}
        {view === "products" && (
          <ProductsView products={products} designs={designs} swPricelist={swPricelist} onSave={persistProducts} onEdit={(p) => setEditingProduct(p)} />
        )}
        {view === "productionplan" && (
          <ProductionPlanView
            productionPlan={productionPlan}
            products={products}
            goodsReceipts={goodsReceipts}
            stockIssues={stockIssues}
            productionOutputs={productionOutputs}
            prestavky={prestavky}
            pauzy={pauzy}
            dochadzkaNastavenia={dochadzkaNastavenia}
            ccpKontroly={ccpKontroly}
            onNew={() => setShowNewProductionPlan(true)}
            onEdit={(p) => setEditingProductionPlan(p)}
            onDelete={deleteProductionPlan}
            onDeleteOutput={deleteProductionOutput}
            onEditOutput={(o) => setEditingProductionOutput(o)}
            onDeletePrestavka={deletePrestavka}
            onUpdatePrestavka={updatePrestavka}
            onDeletePauza={deletePauza}
            onUpdatePauza={updatePauza}
            onUpdateDochadzkaNastavenia={persistDochadzkaNastavenia}
            workers={workers}
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
          products={products}
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
          onUpdateCarrierEmails={(carrierId, emaily) => persistCarriers(carriers.map((c) => (c.id === carrierId ? { ...c, emaily } : c)))}
          onSent={(dopravcaId, info) => {
            updateMaterialOrder(sendMaterialOrder.id, { stavDopravy: "Objednana", dopravcaId, dopravaOdoslanaInfo: info });
            setSendMaterialOrder(null);
            setToast("Objednávka dopravy byla odeslána (" + (carriers.find((c) => c.id === dopravcaId) || {}).nazov + ").");
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
            setToast("Objednávka byla odeslána dodavateli (" + info.to + ").");
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
          suppliers={suppliers}
          onClose={() => setShowInvoiceUpload(false)}
          onApply={async (updates) => {
            for (const u of updates) {
              await updateGoodsReceipt(u.receiptId, u.patch);
            }
            setToast(`Cena doplněna k ${updates.length} příjmu(ům) zboží.`);
          }}
          onAddToSupplierCatalog={async (supplierId, popisList) => {
            const supplier = suppliers.find((s) => s.id === supplierId);
            if (!supplier) return;
            const existing = normalizeTovary(supplier.tovary);
            const seen = new Set(existing.map((t) => (t.popis || "").trim().toLowerCase()));
            const additions = [];
            for (const p of popisList) {
              const key = (p || "").trim().toLowerCase();
              if (!key || seen.has(key)) continue;
              seen.add(key);
              additions.push({ popis: p.trim(), artikel: "", balenie: "" });
            }
            if (!additions.length) { setToast("Všechny položky už jsou v katalogu dodavatele."); return; }
            await persistSuppliers(suppliers.map((s) => (s.id === supplierId ? { ...s, tovary: [...existing, ...additions] } : s)));
            setToast(`Přidáno ${additions.length} položek do katalogu dodavatele ${supplier.nazov}.`);
          }}
        />
      )}
      {showNewStockIssue && (
        <StockIssueFormModal
          suppliers={suppliers}
          currentUserName={userFullName}
          onClose={() => setShowNewStockIssue(false)}
          onSave={async (fields) => { await saveNewStockIssue(fields); setShowNewStockIssue(false); }}
        />
      )}
      {editingStockIssue && (
        <StockIssueFormModal
          issue={editingStockIssue}
          suppliers={suppliers}
          currentUserName={userFullName}
          onClose={() => setEditingStockIssue(null)}
          onSave={(patch) => {
            updateStockIssue(editingStockIssue.id, patch);
            setEditingStockIssue(null);
          }}
        />
      )}
      {showNewTestProductionIssue && (
        <TestProductionIssueModal
          suppliers={suppliers}
          currentUserName={userFullName}
          onClose={() => setShowNewTestProductionIssue(false)}
          onSaveBatch={saveTestProductionIssueBatch}
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
          onUpdateCarrierEmails={(carrierId, emaily) => persistCarriers(carriers.map((c) => (c.id === carrierId ? { ...c, emaily } : c)))}
          onSent={(dopravcaId, info) => {
            updateOrder(transportOrder.id, { stavDopravy: "Objednana", dopravcaId, dopravaOdoslanaInfo: info });
            setTransportOrder(null);
            setToast("Objednávka dopravy byla odeslána (" + (carriers.find((c) => c.id === dopravcaId) || {}).nazov + ").");
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
          products={products}
          currentUserName={userFullName}
          onClose={() => setDeliveryOrder(null)}
          onSent={(email, info) => {
            updateOrder(deliveryOrder.id, { dodaciListOdoslany: "Ano", zakaznikEmail: email, stavObjednavky: "Odoslana", dodaciListOdoslanaInfo: info });
            setDeliveryOrder(null);
            setToast("Dodací list byl odeslán na " + email + ".");
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
            setToast(action === "print" ? "Paletový lístek odesílán na tisk." : "Paletový lístek byl stažen.");
          }}
        />
      )}
      {cmrOrder && (
        <CmrModal
          order={cmrOrder}
          carriers={carriers}
          customers={customers}
          company={company}
          products={products}
          onClose={() => setCmrOrder(null)}
          onDone={(info, action) => {
            updateOrder(cmrOrder.id, { cmrInfo: info });
            setCmrOrder(null);
            setToast(action === "print" ? "CMR odesíláno na tisk." : "CMR bylo staženo.");
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
            setToast("E-mail s NVE listem připraven (" + info.to + ").");
          }}
        />
      )}
      {lsGermanyOrder && (
        <LsGermanyModal
          order={lsGermanyOrder}
          onClose={() => setLsGermanyOrder(null)}
          onSave={async (patch) => {
            await updateOrder(lsGermanyOrder.id, patch);
            setLsGermanyOrder(null);
            setToast("Číslo LS Germany uloženo.");
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

function PrintDocument({ id, title, subtitle, body, fontSize, lineHeight }) {
  return (
    <div id={id} className="print-only-content">
      <div style={{ fontFamily: "Arial, sans-serif", fontSize: fontSize || "12px", color: "#111" }}>
        {subtitle && <div style={{ textAlign: "center", fontSize: "0.75em", color: "#555", marginBottom: "2px", textTransform: "uppercase", letterSpacing: "0.05em" }}>{subtitle}</div>}
        <div style={{ fontWeight: "bold", fontSize: "1.5em", textAlign: "center", marginBottom: "14px" }}>{title}</div>
        <div style={{ whiteSpace: "pre-wrap", lineHeight: lineHeight || 1.5 }}>{body}</div>
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

async function openDesignFile(path) {
  if (!path) return;
  const { data, error } = await supabase.storage.from(DESIGNS_BUCKET).createSignedUrl(path, 3600);
  if (!error && data) window.open(data.signedUrl, "_blank");
}

async function openSwPricelistFile(path) {
  if (!path) return;
  const { data, error } = await supabase.storage.from(SW_PRICELIST_BUCKET).createSignedUrl(path, 3600, { download: true });
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
  { icon: <ListChecks size={16} />, label: "Úkoly", v: "ulohy" },
  { icon: <Users size={16} />, label: "Dopravci", v: "carriers" },
  { icon: <Package size={16} />, label: "Zákazníci", v: "customers" },
  { icon: <Building2 size={16} />, label: "Nastavení firmy", v: "company" },
  { icon: <Euro size={16} />, label: "Ceník dopravy DORYS", v: "pricelist" },
  { icon: <Receipt size={16} />, label: "Ceník Stenger Waffeln", v: "waffelnpricelist" },
  { icon: <Factory size={16} />, label: "Dodavatelé", v: "suppliers" },
  { icon: <Recycle size={16} />, label: "EKO-KOM", v: "ekokom" },
  { icon: <Calculator size={16} />, label: "Tvorba cen", v: "cenotvorba" },
  { icon: <Image size={16} />, label: "Designy a fotky", v: "designs" },
  { icon: <BookOpen size={16} />, label: "Návody", v: "navody" },
  { icon: <PackageX size={16} />, label: "Reklamace", v: "reklamace" },
  { icon: <FlaskConical size={16} />, label: "Produkty", v: "products" },
  { icon: <UserCheck size={16} />, label: "Pracovníci", v: "workers" },
  { icon: <BarChart3 size={16} />, label: "Reporting", v: "reporting" },
  { icon: <History size={16} />, label: "Audit log", v: "auditlog" },
];

function PlaceholderView({ title }) {
  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">{title}</h1>
      <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-slate-500">
        <Construction size={28} className="mx-auto mb-3 text-slate-300" />
        Tato sekce se připravuje - obsah doplníme později.
      </div>
    </div>
  );
}

function Header({ view, setView, company, userFullName, userEmail, onSignOut }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuItems = HEADER_MENU_ITEMS.filter((item) => {
    if (item.v === "cenotvorba" || item.v === "reporting") return CENOTVORBA_ALLOWED_EMAILS.includes(userEmail);
    if (item.v === "auditlog") return AUDIT_LOG_ALLOWED_EMAILS.includes(userEmail);
    return true;
  });
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
            <div className="text-lg font-semibold">Stenger ONE</div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 relative">
          {userFullName && <span className="text-sm text-slate-300">{userFullName}</span>}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              title="Další sekce"
              className={"flex items-center justify-center w-9 h-9 rounded-md " + (inMenu ? "bg-white text-slate-900" : "text-slate-300 hover:bg-slate-800")}
            >
              <Menu size={18} />
            </button>
            <button
              onClick={onSignOut}
              title="Odhlásit"
              className="flex items-center gap-1.5 px-3 h-9 rounded-md text-sm text-slate-300 hover:bg-slate-800"
            >
              <LogOut size={16} /> Odhlásit
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
          <NavButton icon={<LayoutDashboard size={18} />} label="Přehled" color="teal" active={view === "dashboard"} onClick={() => setView("dashboard")} />
          <NavButton icon={<ClipboardList size={18} />} label="Objednávky" color="blue" active={view === "register"} onClick={() => setView("register")} />
          <NavButton icon={<Boxes size={18} />} label="Objednávky surovin a obalů" color="amber" active={view === "materials"} onClick={() => setView("materials")} />
          <NavButton icon={<PackagePlus size={18} />} label="Příjem zboží" color="emerald" active={view === "goodsreceipts"} onClick={() => setView("goodsreceipts")} />
          <NavButton icon={<Warehouse size={18} />} label="Stav zásob" color="violet" active={view === "stock"} onClick={() => setView("stock")} />
          <NavButton icon={<ClipboardCheck size={18} />} label="Výroba" color="rose" active={view === "productionplan"} onClick={() => setView("productionplan")} />
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
          title="Vybrat z kalendáře"
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

function ItemsTable({ items, setItems, customer, products }) {
  function update(i, key, val) {
    const next = items.slice();
    next[i] = { ...next[i], [key]: val };
    if (key === "karton" || key === "artikel") {
      const computed = computePaletFromKarton(next[i].karton, next[i].artikel, customer, products);
      if (computed) next[i].palet = computed;
    }
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
              <th className="px-2 py-1.5 w-24">Artikl</th>
              <th className="px-2 py-1.5 w-16">Palet</th>
              <th className="px-2 py-1.5 w-16">Kartonů</th>
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
      <button onClick={add} className="mt-1.5 text-xs text-teal-700 hover:text-teal-900 flex items-center gap-1"><Plus size={12} /> Přidat položku</button>
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

function RegisterView({ orders, carriers, customers, expedicniaZaznamy, products, onUpdateExpedicia, onDeleteExpedicia, onNew, onOpenTransport, onOpenDelivery, onOpenPallet, onOpenCmr, onOpenNve, onOpenLsGermany, onEdit, onDelete, onExport, onToggleExpedicia }) {
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [detailOrder, setDetailOrder] = useState(null);

  const batchZaznamy = (expedicniaZaznamy || []).filter((z) => z.typ !== "doprava" && z.typ !== "celkova" && z.typ !== "kontrola");
  const dopravaByOrder = new Map();
  (expedicniaZaznamy || []).filter((z) => z.typ === "doprava").forEach((z) => { dopravaByOrder.set(z.orderId, z); });
  const kontrolaByOrder = new Map();
  (expedicniaZaznamy || []).filter((z) => z.typ === "kontrola").forEach((z) => { kontrolaByOrder.set(z.orderId, z); });

  // Zorpanie riadok, sa da spolahnut na to, ze v tomto stlpci moze exportovat rovnaka objednavka na viac riadkov (viac sarzi)
  async function exportExpediciaToExcel() {
    const byOrder = new Map();
    batchZaznamy.forEach((z) => {
      if (!byOrder.has(z.orderId)) byOrder.set(z.orderId, []);
      byOrder.get(z.orderId).push(z);
    });
    const orderIds = [...byOrder.keys()].sort((a, b) => {
      const oa = orders.find((o) => o.id === a) || {};
      const ob = orders.find((o) => o.id === b) || {};
      return (parseSkDate(oa.datumDodania) || 0) - (parseSkDate(ob.datumDodania) || 0);
    });
    const blankRow = { "Číslo objednávky": "", "Číslo dodacího listu": "", "Zákazník": "", "Produkt": "", "Šarže": "", "Počet palet": "", "Počet kartonů": "", "Název místa dodání": "", "Adresa dodania": "", "Město": "", "Dopravce": "", "Řidič": "", "Datum naložení": "", "Datum dodání": "", "Ložná plocha": "" };
    const rows = [];
    orderIds.forEach((orderId, orderIdx) => {
      const order = orders.find((o) => o.id === orderId) || {};
      const doprava = dopravaByOrder.get(orderId) || {};
      const kontrola = kontrolaByOrder.get(orderId);
      const loznaPlochaText = !kontrola
        ? ""
        : kontrola.vysledek === "odmitnuto"
        ? `Odmítnuto - ${kontrola.duvodOdmitnuti || ""} (${kontrola.zapisal || ""})`
        : `OK (${kontrola.zapisal || ""})`;
      const batches = byOrder.get(orderId).slice().sort((a, b) => (parseSkDate(a.datum) || 0) - (parseSkDate(b.datum) || 0));
      batches.forEach((z, i) => {
        // Udaje na urovni objednavky (cislo, zakaznik, miesto, doprava, datum dodania) sa vypisu
        // len na prvom riadku danej objednavky - dalsie sarze tej istej objednavky maju tieto
        // stlpce prazdne, aby v Exceli vizualne "patrili" pod prvy riadok ako jeden blok.
        rows.push({
          "Číslo objednávky": i === 0 ? (order.cisloObjednavky || "") : "",
          "Číslo dodacího listu": i === 0 ? (order.cisloDodaciehoListu || "") : "",
          "Zákazník": i === 0 ? (order.zakaznik || "") : "",
          "Produkt": z.produktNazov || "",
          "Šarže": z.sarza || "",
          "Počet palet": z.pocetPaliet ?? "",
          "Počet kartonů": z.pocetKartonov ?? "",
          "Název místa dodání": i === 0 ? (order.adresaDodaniaNazov || "") : "",
          "Adresa dodania": i === 0 ? (order.adresaDodania || "") : "",
          "Město": i === 0 ? (extractCityFromAddress(order.adresaDodania) || "") : "",
          "Dopravce": i === 0 ? (doprava.dopravca || "") : "",
          "Řidič": i === 0 ? (doprava.vodic || "") : "",
          "Datum naložení": z.datum || "",
          "Datum dodání": i === 0 ? (order.datumDodania || "") : "",
          "Ložná plocha": i === 0 ? loznaPlochaText : "",
        });
      });
      if (orderIdx < orderIds.length - 1) rows.push({ ...blankRow });
    });
    await exportRowsToExcel(rows, "Expedice - šarže", "Expedicia_sarze", 16);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Objednávky</h1>
        <div className="flex gap-2">
          <button onClick={onExport} disabled={orders.length === 0} title={orders.length === 0 ? "Registr je prázdný" : "Exportovat registr do Excelu"} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-sm font-medium px-3 py-2 rounded-md">
            <Download size={16} /> Export do Excelu
          </button>
          <button onClick={exportExpediciaToExcel} disabled={batchZaznamy.length === 0} title={batchZaznamy.length === 0 ? "Zatím žádné naložené dávky" : "Exportovat naložené dávky (šarže) do Excelu"} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-sm font-medium px-3 py-2 rounded-md">
            <Download size={16} /> Export expedicie (sarze)
          </button>
          <button onClick={onNew} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md">
            <Plus size={16} /> Nova objednavka
          </button>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-slate-500">
          <ClipboardList size={28} className="mx-auto mb-3 text-slate-300" />
          Zatím žádné objednávky. Klikněte na "Nová objednávka" a vložte text nebo soubor.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-left">
                <th className="px-3 py-2 font-medium whitespace-nowrap">Číslo objednávky</th>
                <th className="px-3 py-2 font-medium">Místo dodání / zákazník</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">Dodání</th>
                <th className="px-3 py-2 font-medium">Doprava</th>
                <th className="px-3 py-2 font-medium">Dodací list</th>
                <th className="px-3 py-2 font-medium">Expedice</th>
                <th className="px-3 py-2 font-medium text-right">Akce</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const carrierMissing = carriers.length === 0;
                const emailMissing = !o.zakaznikEmail;
                const orderBatches = batchZaznamy.filter((z) => z.orderId === o.id);
                const orderDoprava = dopravaByOrder.get(o.id) || null;
                const rowText = ((o.adresaDodaniaNazov || "") + " " + (o.adresaDodania || "")).toLowerCase();
                const rowTint = rowText.includes("netto") ? "bg-blue-100" : (rowText.includes("ehg") || rowText.includes("edeka")) ? "bg-red-100" : "";
                return (
                  <tr key={o.id} onClick={() => onEdit(o)} className={"border-t-2 border-slate-300 hover:brightness-95 cursor-pointer " + rowTint}>
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{o.cisloObjednavky}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">
                        {extractCityFromAddress(o.adresaDodania) && <span>{extractCityFromAddress(o.adresaDodania)}{o.adresaDodaniaNazov ? " - " : ""}</span>}
                        {o.adresaDodaniaNazov || (!extractCityFromAddress(o.adresaDodania) && <span className="text-slate-400 font-normal">-</span>)}
                      </div>
                      <div className="text-xs text-slate-400">{o.zakaznik}{o.zakaznik && o.adresaDodania ? " - " : ""}{o.adresaDodania}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {o.datumDodania || <span className="text-slate-400">-</span>}
                      {o.casDodania && <div className="text-xs text-slate-400">{o.casDodania}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <Badge text={o.stavDopravy} map={STATUS_TRANSPORT} />
                      <div className="text-xs text-slate-500 font-normal mt-0.5">{o.cisloObjednavkyDopravy}</div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge text={o.dodaciListOdoslany === "Ano" ? "Odesláno" : "Neodesláno"} map={{ Odoslany: "bg-emerald-100 text-emerald-700", Neodoslany: "bg-slate-100 text-slate-700" }} />
                      <div className="text-xs text-slate-500 font-normal mt-0.5">{o.cisloDodaciehoListu}</div>
                    </td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => onToggleExpedicia(o)}
                        title="Kliknutím přepnete stav expedice"
                        className={"text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap border border-transparent hover:brightness-95 " + (STATUS_EXPEDICIA[o.stavExpedicie] || STATUS_EXPEDICIA["Neexpedovana"])}
                      >
                        {o.stavExpedicie === "Expedovana" ? "Expedovana" : "Neexpedovana"}
                      </button>
                    </td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1 flex-wrap">
                        <IconButton
                          title={o.sposobDopravy === "vyzdvihnutie" ? "Zákazník si zboží vyzvedává sám - doprava se neobjednává" : carrierMissing ? "Nejprve přidejte dopravce v Nastavení" : o.dopravaOdoslanaInfo ? "Odesláno " + formatDateTime(o.dopravaOdoslanaInfo.datum) : "Objednávka dopravy"}
                          disabled={o.sposobDopravy === "vyzdvihnutie" || carrierMissing}
                          sent={!!o.dopravaOdoslanaInfo}
                          onClick={() => onOpenTransport(o)}
                        >
                          <Truck size={16} />
                        </IconButton>
                        <IconButton title={o.paletovyListokInfo ? "Připraveno " + formatDateTime(o.paletovyListokInfo.datum) : "Paletový lístek"} sent={!!o.paletovyListokInfo} onClick={() => onOpenPallet(o)}>
                          <Layers size={16} />
                        </IconButton>
                        <IconButton title={o.cmrInfo ? "Připraveno " + formatDateTime(o.cmrInfo.datum) : "CMR"} sent={!!o.cmrInfo} onClick={() => onOpenCmr(o)}>
                          <FileSignature size={16} />
                        </IconButton>
                        <IconButton title={o.dodaciListOdoslanaInfo ? "Odesláno " + formatDateTime(o.dodaciListOdoslanaInfo.datum) : emailMissing ? "Dodací list (e-mail zákazníka doplňte v okně)" : "Dodací list"} sent={!!o.dodaciListOdoslanaInfo} onClick={() => onOpenDelivery(o)}>
                          <FileText size={16} />
                        </IconButton>
                        <IconButton title={o.nveOdoslanaInfo ? "NVE list odeslán " + formatDateTime(o.nveOdoslanaInfo.datum) : o.nveListPath ? "NVE list nahrán - připravit e-mail" : "NVE list"} sent={!!o.nveOdoslanaInfo} onClick={() => onOpenNve(o)}>
                          <FileSpreadsheet size={16} />
                        </IconButton>
                        <IconButton title={o.nemeckyDodakCislo ? "LS Germany: " + o.nemeckyDodakCislo : "LS Germany - zadejte číslo německého dodacího listu"} sent={!!o.nemeckyDodakCislo} onClick={() => onOpenLsGermany(o)}>
                          <Stamp size={16} />
                        </IconButton>
                        {(orderBatches.length > 0 || orderDoprava) && (
                          <IconButton title={"Detail expedice (" + orderBatches.length + " šarží) - oprava chybně zapsaných údajů"} onClick={() => setDetailOrder(o)}>
                            <Boxes size={16} />
                          </IconButton>
                        )}
                        <IconButton title="Upravit / porovnat s PDF" onClick={() => onEdit(o)}><Pencil size={16} /></IconButton>
                        <IconButton title="Smazat" onClick={() => setConfirmDelete(o)}><Trash2 size={16} /></IconButton>
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
        <ModalShell title="Smazat objednávku?" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-slate-600 mb-4">
            Opravdu chcete smazat objednávku <b>{confirmDelete.cisloObjednavkyDopravy}</b>
            {confirmDelete.zakaznik ? " (" + confirmDelete.zakaznik + ")" : ""}? Tuto akciu nie je mozne vratit spat.
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDelete(null)} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
            <button
              onClick={() => { onDelete(confirmDelete.id); setConfirmDelete(null); }}
              className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5"
            >
              <Trash2 size={16} /> Ano, zmazat
            </button>
          </div>
        </ModalShell>
      )}
      {detailOrder && (
        <ExpediciaDetailModal
          order={detailOrder}
          batches={batchZaznamy.filter((z) => z.orderId === detailOrder.id)}
          doprava={dopravaByOrder.get(detailOrder.id) || null}
          products={products}
          onUpdate={onUpdateExpedicia}
          onDelete={onDeleteExpedicia}
          onClose={() => setDetailOrder(null)}
        />
      )}
    </div>
  );
}

function ExpediciaDetailModal({ order, batches, doprava, products, onUpdate, onDelete, onClose }) {
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  function startEdit(z) {
    setEditingId(z.id);
    setEditForm({ produktId: z.produktId || "", produktNazov: z.produktNazov || "", sarza: z.sarza || "", pocetPaliet: z.pocetPaliet ?? "", pocetKartonov: z.pocetKartonov ?? "", datum: z.datum || "" });
  }
  function saveEdit() {
    const produkt = products.find((p) => p.id === editForm.produktId);
    onUpdate(editingId, {
      produktId: editForm.produktId,
      produktNazov: produkt ? (produkt.znacka + " " + produkt.gramaz) : editForm.produktNazov,
      sarza: editForm.sarza.trim(),
      pocetPaliet: parseFloat(String(editForm.pocetPaliet).replace(",", ".")) || 0,
      pocetKartonov: editForm.pocetKartonov === "" ? null : (parseFloat(String(editForm.pocetKartonov).replace(",", ".")) || 0),
      datum: editForm.datum.trim(),
    });
    setEditingId(null);
    setEditForm(null);
  }

  function startEditDoprava() {
    setEditingId("doprava");
    setEditForm({ dopravca: doprava.dopravca || "", vodic: doprava.vodic || "" });
  }
  function saveEditDoprava() {
    onUpdate(doprava.id, { dopravca: editForm.dopravca.trim(), vodic: editForm.vodic.trim() });
    setEditingId(null);
    setEditForm(null);
  }

  return (
    <ModalShell title={"Detail expedice - " + (order.cisloObjednavkyDopravy || order.cisloObjednavky)} onClose={onClose} wide>
      <p className="text-xs text-slate-400 mb-3">Oprava údajů, které zapsal sklad při nakládce (např. pokud se při kontrole zjistí chyba). Změna se uloží ihned.</p>

      <div className="mb-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Doprava</h3>
        {doprava ? (
          editingId === "doprava" ? (
            <div className="flex gap-2 items-end flex-wrap bg-slate-50 border border-slate-200 rounded-md p-2">
              <Field label="Dopravce" value={editForm.dopravca} onChange={(v) => setEditForm({ ...editForm, dopravca: v })} />
              <Field label="Řidič" value={editForm.vodic} onChange={(v) => setEditForm({ ...editForm, vodic: v })} />
              <button onClick={saveEditDoprava} className="mb-3 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md">Uložit</button>
              <button onClick={() => { setEditingId(null); setEditForm(null); }} className="mb-3 text-sm text-slate-500 px-3 py-2">Zrušit</button>
            </div>
          ) : (
            <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
              <span className="text-sm">{doprava.dopravca || "-"}{doprava.vodic ? " - řidič: " + doprava.vodic : ""}</span>
              <IconButton title="Upravit" onClick={startEditDoprava}><Pencil size={16} /></IconButton>
            </div>
          )
        ) : (
          <p className="text-sm text-slate-400">Zatím nezapsáno.</p>
        )}
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Naložené šarže ({batches.length})</h3>
        {batches.length === 0 ? (
          <p className="text-sm text-slate-400">Zatím žádná naložená dávka.</p>
        ) : (
          <div className="border border-slate-200 rounded-md overflow-hidden">
            <table className="w-full text-xs">
              <thead><tr className="bg-slate-100 text-slate-600 text-left"><th className="px-2 py-1.5">Produkt</th><th className="px-2 py-1.5">Šarže</th><th className="px-2 py-1.5 text-right">Palet</th><th className="px-2 py-1.5 text-right">Kartonů</th><th className="px-2 py-1.5">Datum</th><th className="px-2 py-1.5"></th></tr></thead>
              <tbody>
                {batches.map((z) => (
                  editingId === z.id ? (
                    <tr key={z.id} className="border-t border-slate-100 bg-amber-50">
                      <td className="px-1 py-1">
                        <select value={editForm.produktId} onChange={(e) => setEditForm({ ...editForm, produktId: e.target.value })} className="w-full border border-slate-200 rounded px-1.5 py-1">
                          <option value="">-- {editForm.produktNazov || "produkt"} --</option>
                          {products.map((p) => <option key={p.id} value={p.id}>{p.znacka} {p.gramaz}</option>)}
                        </select>
                      </td>
                      <td className="px-1 py-1"><input value={editForm.sarza} onChange={(e) => setEditForm({ ...editForm, sarza: e.target.value })} className="w-full border border-slate-200 rounded px-1.5 py-1" /></td>
                      <td className="px-1 py-1"><input value={editForm.pocetPaliet} onChange={(e) => setEditForm({ ...editForm, pocetPaliet: e.target.value })} className="w-16 border border-slate-200 rounded px-1.5 py-1 text-right" /></td>
                      <td className="px-1 py-1"><input value={editForm.pocetKartonov} onChange={(e) => setEditForm({ ...editForm, pocetKartonov: e.target.value })} className="w-16 border border-slate-200 rounded px-1.5 py-1 text-right" /></td>
                      <td className="px-1 py-1"><input value={editForm.datum} onChange={(e) => setEditForm({ ...editForm, datum: e.target.value })} placeholder="DD.MM.RRRR" className="w-24 border border-slate-200 rounded px-1.5 py-1" /></td>
                      <td className="px-1 py-1 whitespace-nowrap">
                        <button onClick={saveEdit} className="text-emerald-600 hover:text-emerald-800 p-1" title="Uložit"><Check className="inline" size={14} /></button>
                        <button onClick={() => { setEditingId(null); setEditForm(null); }} className="text-slate-400 hover:text-rose-600 p-1" title="Zrušit"><X className="inline" size={14} /></button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={z.id} className="border-t border-slate-100">
                      <td className="px-2 py-1.5">{z.produktNazov}</td>
                      <td className="px-2 py-1.5">{z.sarza || "-"}</td>
                      <td className="px-2 py-1.5 text-right">{z.pocetPaliet ?? "-"}</td>
                      <td className="px-2 py-1.5 text-right">{z.pocetKartonov ?? "-"}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{z.datum || "-"}</td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        <IconButton title="Upravit" onClick={() => startEdit(z)}><Pencil size={16} /></IconButton>
                        <IconButton title="Smazat" onClick={() => setConfirmDeleteId(z.id)}><Trash2 size={16} /></IconButton>
                      </td>
                    </tr>
                  )
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirmDeleteId && (
        <div className="mt-4 bg-red-50 border border-red-200 rounded-md p-3">
          <p className="text-sm text-red-700 mb-2">Opravdu smazat tuto naloženou dávku? Tuto akci nelze vrátit zpět.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDeleteId(null)} className="text-sm text-slate-500 px-3 py-1.5">Zrušit</button>
            <button onClick={() => { onDelete(confirmDeleteId); setConfirmDeleteId(null); }} className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-3 py-1.5 rounded-md">Ano, smazat</button>
          </div>
        </div>
      )}
    </ModalShell>
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

function NewOrderPage({ onClose, onSave, defaultAdresaNakladky, customers, products, company, orders }) {
  const [mode, setMode] = useState("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyItems, setBusyItems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [extracted, setExtracted] = useState(null);
  const [sourceBlocks, setSourceBlocks] = useState(null);
  const fileInputRef = useRef(null);

  async function handleExtract() {
    setError("");
    if (mode === "manual") {
      setExtracted({
        ...EMPTY_ORDER,
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
        if (!text.trim()) throw new Error("Vložte text objednávky.");
        blocks = [{ type: "text", text: "TEXT OBJEDNÁVKY:\n" + text }];
        zdrojDokument = { typ: "text", obsah: text };
      } else {
        if (!file) throw new Error("Vyberte soubor.");
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
          blocks = [{ type: "text", text: "TEXT OBJEDNÁVKY:\n" + out.value }];
          zdrojDokument = { typ: "text", obsah: out.value, nazovSuboru: file.name };
        } else {
          throw new Error("Nepodporovaný typ souboru. Použijte PDF, DOCX nebo obrázek.");
        }
      }
      const result = await callClaude([...blocks, { type: "text", text: EXTRACT_INSTRUCTIONS }], company.apiKey);
      setSourceBlocks(blocks);
      const matchedCustomer = customers.find((c) => c.nazov.trim().toLowerCase() === (result.zakaznik || "").trim().toLowerCase());
      // Primarne pouzi polozky priamo z dokumentu (tabulka Pos./Artikelnr./Bezeichnung) -
      // funguje aj bez toho, aby mal zakaznik uz vopred vyplneny katalog. Katalogovy
      // druhy AI krok je len zalozna moznost pre nestrukturovane objednavky (volny text
      // bez tabulky), kde primarna extrakcia nevrati ziadne polozky.
      let polozky = result.polozky || [];
      if (polozky.length === 0 && matchedCustomer && matchedCustomer.katalog && matchedCustomer.katalog.length > 0) {
        try {
          const itemsResult = await callClaude([...blocks, { type: "text", text: buildItemsInstructions(matchedCustomer.katalog) }], company.apiKey);
          polozky = itemsResult.polozky || [];
        } catch (itemsErr) {
          console.error(itemsErr);
        }
      }
      // Ak polozka nema vyplnene palety, dopocitaj ich z kartonov + "Kartonů na paletě"
      // u prepojeneho Produktu (ak sa da najst podla artiklu).
      polozky = polozky.map((it) => (
        it.palet ? it : { ...it, palet: computePaletFromKarton(it.karton, it.artikel, matchedCustomer, products) || it.palet }
      ));
      setExtracted({
        ...EMPTY_ORDER,
        datumPrijatia: todayStr(),
        adresaNakladky: defaultAdresaNakladky,
        ...result,
        zakaznikId: matchedCustomer ? matchedCustomer.id : "",
        paletyZpat: true,
        polozky,
        zdrojDokument,
      });
    } catch (e) {
      console.error(e);
      setError(e.message || "Extrakce se nezdařila.");
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
      console.error(e);
      setError(e.message || "Přiřazení položek se nezdařilo.");
    }
    setBusyItems(false);
  }

  if (extracted) {
    const customer = customers.find((c) => c.id === extracted.zakaznikId);
    const cislo = (extracted.cisloObjednavkyZakaznika || "").trim();
    const duplicateOrder = cislo ? (orders || []).find((o) => (o.cisloObjednavkyZakaznika || "").trim() === cislo) : null;
    return (
      <PageShell title="Zkontrolujte údaje před uložením" onBack={() => setExtracted(null)}>
        {duplicateOrder && (
          <div className="mb-4 bg-amber-50 text-amber-800 text-sm px-3 py-2 rounded-md flex items-center gap-2">
            <AlertCircle size={16} />
            Objednávka s číslem "{cislo}" už v registru existuje ({duplicateOrder.cisloDodaciehoListu || duplicateOrder.id}, zákazník {duplicateOrder.zakaznik || "?"}) - zkontrolujte, zda nejde o duplicitu, než ji uložíte znovu.
          </div>
        )}
        <div className="flex flex-col lg:flex-row gap-6">
        <div className="lg:w-1/2">
        <SelectField
          label="Zákazník (odběratel)"
          value={extracted.zakaznikId}
          onChange={(v) => {
            const c = customers.find((x) => x.id === v);
            setExtracted({ ...extracted, zakaznikId: v, zakaznik: c ? c.nazov : extracted.zakaznik });
          }}
          options={[{ value: "", label: "-- nevybráno / doplním ručně --" }, ...customers.map((c) => ({ value: c.id, label: c.nazov }))]}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
          <Field label="Název zákazníka (zobrazení)" value={extracted.zakaznik} onChange={(v) => setExtracted({ ...extracted, zakaznik: v })} />
          <Field label="Číslo objednávky zákazníka (Belegnummer)" value={extracted.cisloObjednavkyZakaznika} onChange={(v) => setExtracted({ ...extracted, cisloObjednavkyZakaznika: v })} />
          <Field label="Kontaktní osoba" value={extracted.kontaktnaOsoba} onChange={(v) => setExtracted({ ...extracted, kontaktnaOsoba: v })} />
          <Field label="E-mail" value={extracted.zakaznikEmail} onChange={(v) => setExtracted({ ...extracted, zakaznikEmail: v })} />
          <Field label="Název místa dodání" value={extracted.adresaDodaniaNazov} onChange={(v) => setExtracted({ ...extracted, adresaDodaniaNazov: v })} />
          <Field label="Adresa dodania" value={extracted.adresaDodania} onChange={(v) => setExtracted({ ...extracted, adresaDodania: v })} />
          <DateField label="Datum dodání" value={extracted.datumDodania} onChange={(v) => setExtracted({ ...extracted, datumDodania: v })} />
          <Field label="Čas dodání" value={extracted.casDodania} onChange={(v) => setExtracted({ ...extracted, casDodania: v })} />
          <Field label="Mercareon / Transporeon ref. (ORDER-N° řetězce)" value={extracted.mercareonRef} onChange={(v) => setExtracted({ ...extracted, mercareonRef: v })} />
          <Field label="Počet palet (kusů)" value={extracted.pocetPaliet} onChange={(v) => setExtracted({ ...extracted, pocetPaliet: v })} />
          <Field label="Počet paletových míst (double stack)" value={extracted.pocetPaletovychMiest} onChange={(v) => setExtracted({ ...extracted, pocetPaletovychMiest: v })} />
          <Field label="Počet kartonů (celkem)" value={extracted.pocetKartonov} onChange={(v) => setExtracted({ ...extracted, pocetKartonov: v })} />
          <Field label="Hmotnost (kg)" value={extracted.hmotnost} onChange={(v) => setExtracted({ ...extracted, hmotnost: v })} />
        </div>
        <ToggleField label="Způsob dopravy" value={extracted.sposobDopravy !== "vyzdvihnutie"} onChange={(v) => setExtracted({ ...extracted, sposobDopravy: v ? "doprava" : "vyzdvihnutie" })} yesLabel="Doprava (zajišťujeme my)" noLabel="Vyzvednutí zákazníkem" />
        <ToggleField label="Palety zpět" value={extracted.paletyZpat} onChange={(v) => setExtracted({ ...extracted, paletyZpat: v })} yesLabel="Ano" noLabel="Nie" />
        <Field label="Popis zboží (volný text)" value={extracted.popisTovaru} onChange={(v) => setExtracted({ ...extracted, popisTovaru: v })} textarea />
        <Field label="Poznámka" value={extracted.poznamka} onChange={(v) => setExtracted({ ...extracted, poznamka: v })} textarea />

        {customer && customer.katalog && customer.katalog.length > 0 && (
          <button onClick={handleMatchItems} disabled={busyItems} className="mb-3 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-md flex items-center gap-1.5">
            {busyItems ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
            {busyItems ? "Přiřazuji..." : "Přiřadit položky z katalogu (AI)"}
          </button>
        )}
        <ItemsTable items={extracted.polozky} setItems={(items) => setExtracted({ ...extracted, polozky: items })} customer={customer} products={products} />

        {error && <div className="mb-3 bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={16} /> {error}</div>}

        <div className="flex justify-between items-center mt-4 pb-2">
          <button onClick={() => setExtracted(null)} className="text-sm text-slate-500 flex items-center gap-1 hover:text-slate-800"><ArrowLeft size={14} /> Zpět</button>
          <button
            onClick={async () => { if (saving) return; setSaving(true); try { await onSave(extracted); } finally { setSaving(false); } }}
            disabled={saving}
            className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} {saving ? "Ukládám..." : "Uložit do registru"}
          </button>
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
    <PageShell title="Nová objednávka" onBack={onClose}>
      <div className="flex gap-2 mb-4">
        <TabButton icon={<Clipboard size={14} />} label="Vložit text" active={mode === "text"} onClick={() => setMode("text")} />
        <TabButton icon={<Upload size={14} />} label="Nahrát soubor" active={mode === "file"} onClick={() => setMode("file")} />
        <TabButton icon={<Pencil size={14} />} label="Vložit objednávku ručně" active={mode === "manual"} onClick={() => setMode("manual")} />
      </div>
      {mode === "text" && (
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} placeholder="Sem vložte text objednávky z e-mailu..." className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" />
      )}
      {mode === "file" && (
        <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-slate-200 rounded-lg p-10 text-center text-slate-500 cursor-pointer hover:border-teal-400 hover:text-teal-700">
          <Upload size={24} className="mx-auto mb-2" />
          {file ? file.name : "Klikněte pro výběr souboru (PDF, DOCX, obrázek)"}
          <input ref={fileInputRef} type="file" accept=".pdf,.docx,image/*,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files[0] || null)} />
        </div>
      )}
      {mode === "manual" && (
        <div className="border border-slate-200 rounded-lg p-6 text-center text-slate-500 text-sm">
          Otevře se prázdný formulář objednávky, který vyplníte ručně (bez automatického rozpoznávání z dokumentu).
        </div>
      )}
      {error && <div className="mt-3 bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={16} /> {error}</div>}
      <div className="flex justify-between mt-4 pb-2">
        <button onClick={onClose} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
        <button onClick={handleExtract} disabled={busy} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
          {busy ? "Zpracovávám..." : mode === "manual" ? "Pokračovat na formulář" : "Zpracovat údaje"}
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
      console.error(e);
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
          Otevřít PDF v nové kartě
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
          title="Zdrojová objednávka PDF"
          style={{ width: "100%", height: "65vh", border: "1px solid #e2e8f0", borderRadius: "6px" }}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="text-xs text-slate-400 border border-dashed border-slate-200 rounded-md p-6 text-center">
          Nahlad sa nepodarilo zobrazit priamo tu - pouzite tlacidlo "Otevřít v nové kartě" vyssie.
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
        <img src={`data:${zdrojDokument.mediaType};base64,${zdrojDokument.data}`} alt="Zdrojová objednávka" className="w-full rounded-md border border-slate-200" />
      </div>
    );
  }
  return (
    <div>
      <div className="text-xs text-slate-500 mb-1">{zdrojDokument.nazovSuboru || "Vložený text objednávky"}</div>
      <pre className="text-xs whitespace-pre-wrap bg-slate-50 border border-slate-200 rounded-md p-3" style={{ maxHeight: "70vh", overflowY: "auto" }}>{zdrojDokument.obsah}</pre>
    </div>
  );
}

function EditOrderPage({ order, customers, products, onClose, onSave }) {
  const [f, setF] = useState({ ...order });
  const customer = customers.find((c) => c.id === f.zakaznikId);
  return (
    <PageShell title={"Upravit objednávku " + order.cisloObjednavkyDopravy} onBack={onClose}>
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="lg:w-1/2">
          <SelectField label="Zákazník (odběratel)" value={f.zakaznikId} onChange={(v) => { const c = customers.find((x) => x.id === v); setF({ ...f, zakaznikId: v, zakaznik: c ? c.nazov : f.zakaznik }); }} options={[{ value: "", label: "-- nevybráno --" }, ...customers.map((c) => ({ value: c.id, label: c.nazov }))]} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <Field label="Název zákazníka" value={f.zakaznik} onChange={(v) => setF({ ...f, zakaznik: v })} />
            <Field label="Číslo objednávky zákazníka (Belegnummer)" value={f.cisloObjednavkyZakaznika} onChange={(v) => setF({ ...f, cisloObjednavkyZakaznika: v })} />
            <Field label="Kontaktní osoba" value={f.kontaktnaOsoba} onChange={(v) => setF({ ...f, kontaktnaOsoba: v })} />
            <Field label="E-mail" value={f.zakaznikEmail} onChange={(v) => setF({ ...f, zakaznikEmail: v })} />
            <Field label="Název místa dodání" value={f.adresaDodaniaNazov} onChange={(v) => setF({ ...f, adresaDodaniaNazov: v })} />
            <Field label="Adresa dodania" value={f.adresaDodania} onChange={(v) => setF({ ...f, adresaDodania: v })} />
            <Field label="Adresa nakládky" value={f.adresaNakladky} onChange={(v) => setF({ ...f, adresaNakladky: v })} />
            <DateField label="Datum dodání" value={f.datumDodania} onChange={(v) => setF({ ...f, datumDodania: v })} />
            <Field label="Čas dodání" value={f.casDodania} onChange={(v) => setF({ ...f, casDodania: v })} />
            <Field label="Mercareon / Transporeon ref. (ORDER-N° řetězce)" value={f.mercareonRef} onChange={(v) => setF({ ...f, mercareonRef: v })} />
            <Field label="Číslo německého dodacího listu (Lieferschein DE od kolegů)" value={f.nemeckyDodakCislo || ""} onChange={(v) => setF({ ...f, nemeckyDodakCislo: v })} />
            <Field label="Počet palet (kusů)" value={f.pocetPaliet} onChange={(v) => setF({ ...f, pocetPaliet: v })} />
            <Field label="Počet paletových míst (double stack)" value={f.pocetPaletovychMiest} onChange={(v) => setF({ ...f, pocetPaletovychMiest: v })} />
            <Field label="Počet kartonů (celkem)" value={f.pocetKartonov} onChange={(v) => setF({ ...f, pocetKartonov: v })} />
            <Field label="Výška palety (cm)" value={f.vyskaPalety} onChange={(v) => setF({ ...f, vyskaPalety: v })} />
            <Field label="Hmotnost (kg)" value={f.hmotnost} onChange={(v) => setF({ ...f, hmotnost: v })} />
          </div>
          <ToggleField label="Způsob dopravy" value={f.sposobDopravy !== "vyzdvihnutie"} onChange={(v) => setF({ ...f, sposobDopravy: v ? "doprava" : "vyzdvihnutie", stavDopravy: v ? (f.stavDopravy === "Vyzdvihnutie" ? "Neobjednana" : f.stavDopravy) : "Vyzdvihnutie" })} yesLabel="Doprava (zajišťujeme my)" noLabel="Vyzvednutí zákazníkem" />
          <ToggleField label="Palety zpět" value={f.paletyZpat} onChange={(v) => setF({ ...f, paletyZpat: v })} yesLabel="Ano" noLabel="Nie" />
          <Field label="Popis zboží (volný text)" value={f.popisTovaru} onChange={(v) => setF({ ...f, popisTovaru: v })} textarea />
          <Field label="Poznámka" value={f.poznamka} onChange={(v) => setF({ ...f, poznamka: v })} textarea />
          <ItemsTable items={f.polozky || []} setItems={(items) => setF({ ...f, polozky: items })} customer={customer} products={products} />
          <div className="flex justify-between mt-2 pb-2">
            <button onClick={onClose} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
            <button onClick={() => onSave(f)} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Uložit změny</button>
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

// Predvyplnene "Komu" pri vybere dopravcu/dodavatela - vsetky ucelove emaily
// (emaily[]), bez duplicit. Obecny email sa NIKDY nepredvypna automaticky -
// je dostupny len ako samostatne tlacidlo "Obecny" v EmailQuickPicks, ktore
// si user musi vybrat rucne, ked ho naozaj potrebuje.
function defaultEmailFor(entity) {
  if (!entity) return "";
  const all = [];
  (entity.emaily || []).forEach((e) => {
    (e.email || "").split(",").map((s) => s.trim()).filter(Boolean).forEach((addr) => all.push(addr));
  });
  return [...new Set(all)].join(", ");
}
function generalPlusPurposeEmails(entity) {
  const purpose = (entity && entity.emaily) || [];
  if (!entity || !entity.email) return purpose;
  return [{ label: "Obecný", email: entity.email }, ...purpose];
}

function EmailQuickPicks({ emaily, value, onPick }) {
  if (!emaily || emaily.length === 0) return null;
  const current = (value || "").split(",").map((s) => s.trim()).filter(Boolean);
  function toggle(email) {
    const parts = email.split(",").map((s) => s.trim()).filter(Boolean);
    const allSelected = parts.length > 0 && parts.every((p) => current.includes(p));
    const next = allSelected ? current.filter((c) => !parts.includes(c)) : current.slice();
    if (!allSelected) parts.forEach((p) => { if (!next.includes(p)) next.push(p); });
    onPick(next.join(", "));
  }
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {emaily.map((e, i) => {
        const parts = (e.email || "").split(",").map((s) => s.trim()).filter(Boolean);
        const selected = parts.length > 0 && parts.every((p) => current.includes(p));
        return (
          <button
            key={i}
            type="button"
            onClick={() => toggle(e.email)}
            title={selected ? "Odebrat z pole Komu" : "Přidat do pole Komu"}
            className={"text-xs px-2 py-1 rounded-md font-medium " + (selected ? "bg-teal-600 text-white hover:bg-teal-700" : "bg-slate-100 hover:bg-slate-200 text-slate-700")}
          >
            {selected ? "✓" : "+"} {e.label}: {e.email}
          </button>
        );
      })}
    </div>
  );
}

function TransportModal({ order, carriers, company, onClose, onSent, onUpdateCarrierEmails }) {
  const last = order.dopravaOdoslanaInfo;
  const [carrierId, setCarrierId] = useState(order.dopravcaId || defaultCarrierId(carriers));
  const carrier = carriers.find((c) => c.id === carrierId);
  const [to, setTo] = useState(last ? last.to : defaultEmailFor(carrier));
  const [manageEmails, setManageEmails] = useState(false);
  function pickCarrier(id) {
    const c = carriers.find((x) => x.id === id);
    setCarrierId(id);
    if (!last) {
      setTo(defaultEmailFor(c));
      const oldName = carrier ? carrier.nazov : "[dopravce]";
      const newName = c ? c.nazov : "[dopravce]";
      setBody((prev) => prev.replace(`PRO: ${oldName}`, `PRO: ${newName}`));
    }
  }
  const mesto = extractCityFromAddress(order.adresaDodania) || order.adresaDodaniaNazov || "";
  const [subject, setSubject] = useState(last ? last.subject : `Objednávka přepravy č. ${order.cisloObjednavkyDopravy}${mesto ? " - " + mesto : ""}`);
  const [body, setBody] = useState(
    last ? last.body :
    `${company.nazov || "[Název společnosti]"}\n` +
    `IČ: ${company.ico || ""}  DIČ: ${company.dic || ""}  TEL: ${company.tel || ""}\n\n` +
    `PRO: ${carrier ? carrier.nazov : "[dopravce]"}  NEOZNAMOVAT ODESÍLATELE!!\n\n` +
    `OBJEDNÁVKA Č. ${order.cisloObjednavkyDopravy}\n\n` +
    `Objednávám: DOPRAVU na ${order.pocetPaliet || "[doplňte]"} europalet` +
    (order.pocetPaletovychMiest ? ` (${order.pocetPaletovychMiest} paletových míst)` : "") +
    (order.vyskaPalety ? `, výška palety ${order.vyskaPalety} cm` : "") +
    `, hmotnost ${order.hmotnost || "[doplňte]"} kg.\n` +
    (order.pocetKartonov ? `Počet kartonů: ${order.pocetKartonov}\n` : "") +
    `Palety zpět: ${order.paletyZpat ? "ANO" : "NE"}\n` +
    (order.mercareonRef ? `Mercareon/Transporeon ref.: ${order.mercareonRef}\n` : "") +
    `\nNAKLÁDKA: ${company.nazov || "[Název společnosti]"}\n${company.adresa || ""}\n` +
    `Datum nakládky: ${nakladkaDateFromDodanie(order.datumDodania)}\n\n` +
    `VYKLÁDKA: ${order.datumDodania || "[doplňte]"}${order.casDodania ? " čas: " + order.casDodania : ""}\n` +
    `${order.adresaDodaniaNazov || ""}\n${order.adresaDodania || ""}\n\n` +
    `${company.kontaktnaOsoba || ""}\n${company.nazov || ""}\n${company.email || ""}\n${company.tel || ""}`
  );

  return (
    <ModalShell title={"Objednávka dopravy - " + order.cisloObjednavkyDopravy} onClose={onClose} extraWide>
      {last && <div className="mb-3 bg-emerald-50 text-emerald-800 text-xs px-3 py-2 rounded-md flex items-center gap-2"><CheckCircle2 size={14} /> Naposledy odesláno {formatDateTime(last.datum)} na {last.to}</div>}
      <SelectField label="Dopravce" value={carrierId} onChange={pickCarrier} options={carriers.map((c) => ({ value: c.id, label: `${c.nazov} (${c.email})` }))} />
      <div className="mb-2">
        <EmailQuickPicks emaily={generalPlusPurposeEmails(carrier)} value={to} onPick={setTo} />
        {carrier && (
          <button type="button" onClick={() => setManageEmails((v) => !v)} className="text-xs text-teal-700 hover:underline">
            {manageEmails ? "Skrýt správu e-mailů dopravce" : "Spravovat e-maily dopravce"}
          </button>
        )}
        {manageEmails && carrier && (
          <div className="mt-2 border border-slate-200 rounded-md p-2 bg-slate-50">
            <EmailListEditor emaily={carrier.emaily} onChange={(list) => onUpdateCarrierEmails(carrier.id, list)} />
          </div>
        )}
      </div>
      <Field label="E-mail (komu)" value={to} onChange={setTo} type="email" />
      <Field label="Předmět" value={subject} onChange={setSubject} />
      <Field label="Text zprávy" value={body} onChange={setBody} textarea rows={18} />
      <div className="flex justify-end gap-2 mt-2">
        <button onClick={onClose} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
        <a href={to ? buildMailto(to, subject, body) : "#"} onClick={() => to && onSent(carrierId, { subject, body, to, datum: new Date().toISOString() })} className={"bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5 " + (!to ? "opacity-50 pointer-events-none" : "")}>
          <Truck size={16} /> Odeslat dopravci
        </a>
      </div>
    </ModalShell>
  );
}

/* ---------------- Dodaci list / Lieferschein (email) ---------------- */

// Najde Produkt pre polozku objednavky - najprv skusi prepojenie cez katalog
// zakaznika (katalogItem.produktId), a ak sa nenajde, priamo porovna
// polozka.artikel s cislom artiklu na Produkte (nase SNC aj nemecke/Sage SW
// cislo) - takze funguje aj ked polozka pride s nemeckym artiklom priamo
// zapisanym z objednavky, bez potreby mat ho zvlast v katalogu zakaznika.
function findProduktForItem(it, customer, products) {
  if (!it.artikel) return null;
  const katalogItem = customer && customer.katalog ? customer.katalog.find((k) => k.artikel && k.artikel === it.artikel) : null;
  if (katalogItem && katalogItem.produktId) {
    const p = (products || []).find((p) => p.id === katalogItem.produktId);
    if (p) return p;
  }
  return (products || []).find((p) => p.cisloArtiklu === it.artikel || p.cisloArtikluSW === it.artikel) || null;
}

// Automaticky navrhne pocet paliet z poctu kartonov + "Kartonů na paletě" u
// prepojeneho Produktu (zaokruhlene nahor - nedokoncena paleta sa stale
// pocita ako cela paletova pozicia). Vracia "" ak sa neda spocitat
// (chyba produkt, artikel, alebo pocet kartonov na palete).
function computePaletFromKarton(karton, artikel, customer, products) {
  const k = parseFloat(String(karton || "").replace(",", "."));
  if (!k || k <= 0) return "";
  const produkt = findProduktForItem({ artikel }, customer, products);
  const perPallet = produkt && parseFloat(produkt.kartonovNaPalete);
  if (!perPallet) return "";
  return String(Math.ceil(k / perPallet));
}

// Pocet kusov (STK) na dodacom liste = pocet kartonov * "Ks v kartonu" u
// prepojeneho Produktu. Vracia null ak sa neda spocitat.
function computeKusyFromKarton(karton, produkt) {
  const k = parseFloat(String(karton || "").replace(",", "."));
  const perKarton = produkt && parseFloat(produkt.ksVKartone);
  if (!k || !perKarton) return null;
  return Math.round(k * perKarton);
}

function LieferscheinPrintTable({ id, company, customer, order, carrierName, transportPrice, products }) {
  const row = { display: "flex", borderBottom: "1px solid #ddd", padding: "2px 0" };
  const left = { width: "50%", paddingRight: "8px" };
  const right = { width: "50%" };
  const items = ((order.polozky && order.polozky.length > 0) ? order.polozky : [{ popis: order.popisTovaru || "", artikel: "", palet: order.pocetPaliet || "", karton: order.pocetKartonov || "" }])
    .map((it) => {
      const produkt = findProduktForItem(it, customer, products);
      const paletEffective = it.palet || computePaletFromKarton(it.karton, it.artikel, customer, products) || "";
      return { ...it, produkt, paletEffective };
    });
  const sumPaliet = items.reduce((s, it) => s + (parseFloat(it.paletEffective) || 0), 0);
  const totalPaliet = sumPaliet > 0 ? sumPaliet : (order.pocetPaliet || 0);
  return (
    <div id={id} className="print-only-content">
      <div style={{ fontFamily: "Arial, sans-serif", fontSize: "11px", color: "#111", maxWidth: "760px" }}>
        <div style={{ textAlign: "right" }}>
          {order.cisloObjednavkyDopravy}
          {transportPrice && transportPrice.matched ? "   " + formatEur(transportPrice.total) : ""}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginTop: "2px" }}>
          <div style={{ fontWeight: "bold" }}>{company.nazov}</div>
          <div style={{ fontWeight: "bold", fontSize: "16px" }}>LIEFERSCHEIN <span style={{ fontWeight: "normal", fontSize: "12px" }}>Nr: {order.cisloDodaciehoListu}</span></div>
        </div>

        <div style={{ marginTop: "8px", textAlign: "right" }}>
          <div style={{ fontStyle: "italic", fontSize: "10px" }}>Lieferadresse/adresa dodání</div>
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
              <th style={{ padding: "3px" }}>AKRTIKEL LIEF.NUM.</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #eee", verticalAlign: "top" }}>
                <td style={{ padding: "3px" }}>{it.paletEffective}</td>
                <td style={{ padding: "3px" }}>{it.karton}</td>
                <td style={{ padding: "3px" }}>
                  <div>{it.popis}</div>
                  {it.produkt?.inhlt && <div style={{ fontSize: "9px", color: "#555", whiteSpace: "pre-wrap" }}>{it.produkt.inhlt}</div>}
                  {(it.produkt?.eanKarton || it.produkt?.eanUnit) && (
                    <div style={{ fontSize: "9px", color: "#555" }}>
                      {[it.produkt.eanKarton && `EAN karton: ${it.produkt.eanKarton}`, it.produkt.eanUnit && `EAN kus: ${it.produkt.eanUnit}`].filter(Boolean).join("   ")}
                    </div>
                  )}
                  {it.produkt?.rspo && <div style={{ fontSize: "9px", color: "#555" }}>{RSPO_CERT_CODE}</div>}
                </td>
                <td style={{ padding: "3px" }}>{computeKusyFromKarton(it.karton, it.produkt)}</td>
                <td style={{ padding: "3px" }}>{it.artikel}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginTop: "14px", fontWeight: "bold" }}>
          {order.pocetPaletovychMiest || 0} Doppelstockpal. = {totalPaliet} europaletten = {order.pocetPaletovychMiest || 0} stallplätze
        </div>

        <div style={{ display: "flex", marginTop: "20px", gap: "16px" }}>
          <div style={{ width: "33%" }}>
            <div>vystavil/ausgestellt von:</div>
            <div>{company.email}</div>
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
          </div>
        </div>
      </div>
    </div>
  );
}
function buildLieferscheinHtml({ company, customer, order, carrierName, transportPrice, products }) {
  const items = ((order.polozky && order.polozky.length > 0) ? order.polozky : [{ popis: order.popisTovaru || "", artikel: "", palet: order.pocetPaliet || "", karton: order.pocetKartonov || "" }])
    .map((it) => {
      const produkt = findProduktForItem(it, customer, products);
      const paletEffective = it.palet || computePaletFromKarton(it.karton, it.artikel, customer, products) || "";
      return { ...it, produkt, paletEffective };
    });
  const sumPaliet = items.reduce((s, it) => s + (parseFloat(it.paletEffective) || 0), 0);
  const totalPaliet = sumPaliet > 0 ? sumPaliet : (order.pocetPaliet || 0);
  const itemRows = items.map((it) => {
    const p = it.produkt;
    const eanLine = p ? [p.eanKarton && `EAN karton: ${p.eanKarton}`, p.eanUnit && `EAN kus: ${p.eanUnit}`].filter(Boolean).join("   ") : "";
    return `
    <tr style="border-bottom:1px solid #eee;vertical-align:top;">
      <td style="padding:3px;">${it.paletEffective || ""}</td>
      <td style="padding:3px;">${it.karton || ""}</td>
      <td style="padding:3px;">
        <div>${it.popis || ""}</div>
        ${p && p.inhlt ? `<div style="font-size:9px;color:#555;white-space:pre-wrap;">${p.inhlt}</div>` : ""}
        ${eanLine ? `<div style="font-size:9px;color:#555;">${eanLine}</div>` : ""}
        ${p && p.rspo ? `<div style="font-size:9px;color:#555;">${RSPO_CERT_CODE}</div>` : ""}
      </td>
      <td style="padding:3px;">${computeKusyFromKarton(it.karton, p) ?? ""}</td>
      <td style="padding:3px;">${it.artikel || ""}</td>
    </tr>`;
  }).join("");
  return `
    <div style="font-family:Arial,sans-serif;font-size:11px;color:#111;max-width:760px;">
      <div style="text-align:right;">
        ${order.cisloObjednavkyDopravy}${transportPrice && transportPrice.matched ? "   " + formatEur(transportPrice.total) : ""}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-top:2px;">
        <div style="font-weight:bold;">${company.nazov || ""}</div>
        <div style="font-weight:bold;font-size:16px;">LIEFERSCHEIN <span style="font-weight:normal;font-size:12px;">Nr: ${order.cisloDodaciehoListu}</span></div>
      </div>
      <div style="margin-top:8px;text-align:right;">
        <div style="font-style:italic;font-size:10px;">Lieferadresse/adresa dodání</div>
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
          <th style="padding:3px;">Palet</th><th style="padding:3px;">Karton</th><th style="padding:3px;">BEZEICHNUNG</th><th style="padding:3px;">STK</th><th style="padding:3px;">AKRTIKEL LIEF.NUM.</th>
        </tr></thead>
        <tbody>${itemRows}</tbody>
      </table>
      <div style="margin-top:14px;font-weight:bold;">
        ${order.pocetPaletovychMiest || 0} Doppelstockpal. = ${totalPaliet} europaletten = ${order.pocetPaletovychMiest || 0} stallplätze
      </div>
      <div style="display:flex;margin-top:20px;gap:16px;">
        <div style="width:33%;"><div>vystavil/ausgestellt von:</div><div>${company.email || ""}</div></div>
        <div style="width:33%;"><div>TRANSPORT: ${carrierName || ""}</div><div>NUMBER TRUCK: ________________</div><div style="margin-top:6px;">EUROPALETTEN</div><div>ACCEPTED: ______</div><div>RELEASSED: ______</div><div>DEBT: ______</div></div>
        <div style="width:33%;"><div>odběratel / abnehmer:</div></div>
      </div>
    </div>`;
}

function DeliveryModal({ order, customers, carriers, company, pricelist, products, currentUserName, onClose, onSent }) {
  const last = order.dodaciListOdoslanaInfo;
  const customer = customers.find((c) => c.id === order.zakaznikId);
  const carrier = carriers.find((c) => c.id === order.dopravcaId);
  const printId = "print-lieferschein-" + order.id;
  const jeNemecko = isGermanDelivery(order);
  const keywordMatched = pickEmailsByKeyword(customer && customer.emaily, jeNemecko ? ["leh", "cc"] : ["export"]);
  const defaultEmail = keywordMatched || defaultEmailFor(customer) || order.zakaznikEmail || "";
  const [email, setEmail] = useState(last ? last.to : defaultEmail);
  const mesto = extractCityFromAddress(order.adresaDodania) || order.adresaDodaniaNazov || "";
  const [subject, setSubject] = useState(last ? last.subject : `Lieferschein / Dodací list č. ${order.cisloDodaciehoListu}${mesto ? " - " + mesto : ""}`);
  const transportPrice = computeTransportPrice(order, pricelist, extractCityFromAddress);

  const [body, setBody] = useState(
    last ? last.body :
    `Hello,\n\n` +
    `please find attached the delivery note for this order.\n\n` +
    `Have a nice day.\n\n` +
    `Best regards,\n${currentUserName || company.kontaktnaOsoba || ""}`
  );

  function handlePrint() {
    setTimeout(() => window.print(), 50);
  }
  function handleDownload() {
    const html = buildLieferscheinHtml({ company, customer, order, carrierName: carrier ? carrier.nazov : "", transportPrice, products });
    const mestoSuffix = mesto ? `_${mesto.replace(/[^\p{L}\p{N}]+/gu, "_")}` : "";
    downloadHtml(`Lieferschein_${order.cisloDodaciehoListu.replace("/", "-")}${mestoSuffix}.html`, html);
  }
  function handleDownloadXlsx() {
    buildLieferscheinXlsx({ order, company, customer, carrierName: carrier ? carrier.nazov : "", transportPrice, products, mesto });
  }

  return (
    <ModalShell title={"Dodací list - " + order.cisloDodaciehoListu} onClose={onClose} wide>
      <LieferscheinPrintTable id={printId} company={company} customer={customer} order={order} carrierName={carrier ? carrier.nazov : ""} transportPrice={transportPrice} products={products} />
      {last && <div className="mb-3 bg-emerald-50 text-emerald-800 text-xs px-3 py-2 rounded-md flex items-center gap-2"><CheckCircle2 size={14} /> Naposledy odesláno {formatDateTime(last.datum)} na {last.to}</div>}
      <p className="text-xs text-slate-400 mb-3">Náhled nahoře odpovídá přesnému formátu vašeho Lieferscheinu - klikněte na "Stáhnout Excel" (přesná kopie vaší šablony) a stažený soubor ručně přiložte v Outlooku k e-mailu, který se otevře tlačítkem "Odeslat" (mailto odkaz nepodporuje automatickou přílohu).</p>
      <EmailQuickPicks emaily={generalPlusPurposeEmails(customer)} value={email} onPick={setEmail} />
      <Field label="E-mail (kolegové v Německu)" value={email} onChange={setEmail} type="email" />
      <Field label="Předmět" value={subject} onChange={setSubject} />
      <Field label="Text zprávy (e-mail)" value={body} onChange={setBody} textarea />
      <div className="flex justify-end gap-2 mt-2 flex-wrap">
        <button onClick={onClose} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
        <button onClick={handleDownloadXlsx} className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5"><Download size={16} /> Stáhnout Excel</button>
        <button onClick={handleDownload} className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5"><Download size={16} /> Stáhnout HTML</button>
        <button onClick={handlePrint} className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5"><Printer size={16} /> Vytisknout</button>
        <a href={email ? buildMailto(email, subject, body) : "#"} onClick={() => email && onSent(email, { subject, body, to: email, datum: new Date().toISOString() })} className={"bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5 " + (!email ? "opacity-50 pointer-events-none" : "")}>
          <FileText size={16} /> Odeslat e-mailem
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
    onDone({ subject: "Paletový lístek", body: `Naloženo: ${nalozeno}, Místo: ${miesto}`, nalozeno, miesto, to: "vytlacene", datum: new Date().toISOString() }, "print");
    setTimeout(() => window.print(), 50);
  }
  function handleDownload() {
    const html = buildPalletHtml({ cislo: order.cisloObjednavkyDopravy, nalozeno, miesto });
    downloadHtml(`Paletovy_listok_${order.cisloObjednavkyDopravy.replace("/", "-")}.html`, html);
    onDone({ subject: "Paletový lístek", body: html, nalozeno, miesto, to: "stiahnute", datum: new Date().toISOString() }, "download");
  }

  return (
    <ModalShell title={"Paletový lístek - " + order.cisloObjednavkyDopravy} onClose={onClose} wide>
      <div className="border border-slate-300 rounded-md overflow-x-auto mb-3 bg-white" style={{ maxHeight: "50vh", overflowY: "auto" }}>
        <div style={{ minWidth: "600px", padding: "12px" }} dangerouslySetInnerHTML={{ __html: buildPalletHtml({ cislo: order.cisloObjednavkyDopravy, nalozeno, miesto }) }} />
      </div>
      <PalletPrintTable id={printId} cislo={order.cisloObjednavkyDopravy} nalozeno={nalozeno} miesto={miesto} />
      {last && <div className="mb-3 bg-emerald-50 text-emerald-800 text-xs px-3 py-2 rounded-md flex items-center gap-2"><CheckCircle2 size={14} /> Naposledy připraveno {formatDateTime(last.datum)}</div>}
      <p className="text-xs text-slate-400 mb-3">Formulář je 1:1 kopie vašeho originálního paletového lístku - mění se jen číslo objednávky dopravy, počet palet a město dodání (předvyplněné z objednávky). Ostatní (RZ, jméno řidiče, podpisy) doplňuje řidič/sklad ručně po vytištění.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
        <Field label="Počet palet (NALOŽENO/SLOŽENO EUROPALET)" value={nalozeno} onChange={setNalozeno} />
        <Field label="Místo doručení" value={miesto} onChange={setMiesto} />
      </div>
      <div className="flex justify-end gap-2 mt-2">
        <button onClick={onClose} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
        <button onClick={handleDownload} className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5"><Download size={16} /> Stáhnout</button>
        <button onClick={handlePrint} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5"><Printer size={16} /> Vytisknout</button>
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

  function baseFileName(name) {
    if (!name) return "";
    const idx = name.lastIndexOf(".");
    return idx > 0 ? name.slice(0, idx) : name;
  }
  function subjectFor(fileName) {
    const nazov = baseFileName(fileName) || dodakRef;
    return `NVE list - ${nazov}${mesto ? " - " + mesto : ""}`;
  }

  function applyDodakToSubject() {
    const trimmed = dodak.trim();
    onSave({ nemeckyDodakCislo: trimmed });
    setBody((prev) => prev.replace(`Delivery note: ${dodakRef}`, `Delivery note: ${trimmed || order.cisloObjednavkyDopravy}`));
  }

  const jeNemecko = isGermanDelivery(order);
  const defaultTo = ((jeNemecko ? company.nveEmaily : company.nveEmailyExport) || []).map((e) => e.email).join(", ");
  const [to, setTo] = useState(last ? last.to : defaultTo);
  const [subject, setSubject] = useState(last ? last.subject : subjectFor(order.nveListFileName));
  const [body, setBody] = useState(
    last ? last.body :
    `Hello,\n\n` +
    `please find attached the NVE list for order no. ${order.cisloObjednavkyDopravy}${order.zakaznik ? " (" + order.zakaznik + ")" : ""}.\n` +
    `Delivery note: ${dodakRef}${mesto ? ", place of delivery: " + mesto : ""}\n\n` +
    `NOTE: the attachment is not added automatically - before sending, please remember to manually attach the downloaded file${order.nveListFileName ? ` "${order.nveListFileName}"` : ""}.\n\n` +
    `Best regards`
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
      if (!last) setSubject(subjectFor(file.name));
    } catch (err) {
      console.error(err);
      setError("Nahrání souboru se nezdařilo, zkuste to znovu.");
    }
    setBusy(false);
    if (e.target) e.target.value = "";
  }

  return (
    <ModalShell title={"NVE list - " + order.cisloObjednavkyDopravy} onClose={onClose} extraWide>
      <div className="mb-3">
        <span className="block text-xs font-medium text-slate-500 mb-1">Číslo německého dodacího listu (Lieferschein DE od kolegů) - nepovinné, jen pokud se zboží posílá přes ně (např. Stenger Waffeln)</span>
        <div className="flex gap-1.5">
          <input value={dodak} onChange={(e) => setDodak(e.target.value)} placeholder="např. 2206-22007895" className="flex-1 border border-slate-200 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" />
          <button type="button" onClick={applyDodakToSubject} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-md font-medium whitespace-nowrap">Uložit</button>
        </div>
      </div>
      <div className="mb-3">
        <span className="block text-xs font-medium text-slate-500 mb-1">Subor z Maxim (Excel)</span>
        {order.nveListPath ? (
          <div className="flex items-center justify-between bg-slate-50 rounded-md px-3 py-2 text-sm">
            <span className="flex items-center gap-2 text-slate-700"><FileSpreadsheet size={16} className="text-teal-700" /> {order.nveListFileName || "NVE list"} <span className="text-slate-400 text-xs">({formatDateTime(order.nveListUploadedAt)})</span></span>
            <div className="flex items-center gap-2">
              <button onClick={() => openNveListFile(order.nveListPath)} className="text-xs text-teal-700 hover:text-teal-900 font-medium flex items-center gap-1"><Download size={14} /> Stáhnout</button>
              <button onClick={() => fileInputRef.current && fileInputRef.current.click()} disabled={busy} className="text-xs text-slate-500 hover:text-slate-700 font-medium disabled:opacity-50">Nahradit</button>
            </div>
          </div>
        ) : (
          <button onClick={() => fileInputRef.current && fileInputRef.current.click()} disabled={busy} className="w-full flex items-center justify-center gap-1.5 bg-white border-2 border-dashed border-slate-300 hover:border-teal-500 hover:text-teal-700 text-slate-500 text-sm font-medium px-3 py-4 rounded-md disabled:opacity-50">
            <Upload size={16} /> {busy ? "Nahrávám..." : "Nahrát NVE list (Excel z Maxim)"}
          </button>
        )}
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
        {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
      </div>

      {!order.nveListPath && (
        <div className="mb-3 bg-amber-50 text-amber-800 text-xs px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={14} /> Nejprve nahrajte NVE list, poté připravte e-mail.</div>
      )}
      {last && <div className="mb-3 bg-emerald-50 text-emerald-800 text-xs px-3 py-2 rounded-md flex items-center gap-2"><CheckCircle2 size={14} /> Naposledy odesláno {formatDateTime(last.datum)} na {last.to}</div>}

      <div className="mb-2 text-xs text-slate-500">
        Podle místa dodání rozpoznáno jako: <b>{jeNemecko ? "Německo" : "Export (mimo Německo)"}</b> - pokud to neodpovídá, přidejte e-maily ručně z druhé skupiny níže.
      </div>
      <EmailQuickPicks emaily={company.nveEmaily} value={to} onPick={setTo} />
      <EmailQuickPicks emaily={company.nveEmailyExport} value={to} onPick={setTo} />
      <Field label="E-mail (komu) - oddělte čárkou při více adresách" value={to} onChange={setTo} />
      <Field label="Předmět" value={subject} onChange={setSubject} />
      <Field label="Text zprávy" value={body} onChange={setBody} textarea rows={8} />
      <p className="text-xs text-slate-400 mb-2">Příloha se přes mailto odkaz nepřipojuje automaticky - po kliknutí na "Otevřít e-mail" přetáhněte stažený soubor do otevřeného draftu.</p>

      <div className="flex justify-end gap-2 mt-2">
        <button onClick={onClose} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
        {order.nveListPath && (
          <button onClick={() => openNveListFile(order.nveListPath)} className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5"><Download size={16} /> Stáhnout přílohu</button>
        )}
        <a
          href={to && order.nveListPath ? buildMailto(to, subject, body) : "#"}
          onClick={() => to && order.nveListPath && onSent({ subject, body, to, datum: new Date().toISOString() })}
          className={"bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5 " + (!to || !order.nveListPath ? "opacity-50 pointer-events-none" : "")}
        >
          <Mail size={16} /> Otevřít e-mail
        </a>
      </div>
    </ModalShell>
  );
}

/* ---------------- LS Germany (nemecky dodaci list - cislo pre CMR) ---------------- */

function LsGermanyModal({ order, onClose, onSave }) {
  const [value, setValue] = useState(order.nemeckyDodakCislo || "");
  return (
    <ModalShell title={"LS Germany - " + order.cisloObjednavkyDopravy} onClose={onClose}>
      <p className="text-xs text-slate-400 mb-3">Číslo německého dodacího listu (Lieferschein DE od kolegů, např. Stenger Waffeln) - použije se v CMR.</p>
      <Field label="Číslo LS Germany" value={value} onChange={setValue} />
      <div className="flex justify-end gap-2 mt-2">
        <button onClick={onClose} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
        <button onClick={() => onSave({ nemeckyDodakCislo: value.trim() })} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Uložit</button>
      </div>
    </ModalShell>
  );
}

/* ---------------- CMR (print only) ---------------- */


function CmrModal({ order, carriers, customers, company, products, onClose, onDone }) {
  const last = order.cmrInfo;
  const carrier = carriers.find((c) => c.id === order.dopravcaId);
  const customer = customers.find((c) => c.id === order.zakaznikId);
  const printId = "print-cmr-" + order.id;
  const [body, setBody] = useState(
    last ? last.body :
    `MEZINÁRODNÍ NÁKLADNÍ LIST č. ${order.cisloObjednavkyDopravy}\n\n` +
    `1. Odesílatel: ${company.nazov || "[doplňte]"}\n${company.adresa || ""}\n\n` +
    `2. Příjemce: ${customer ? customer.nazov : (order.zakaznik || "[doplňte]")}\n${customer ? customer.adresa : ""}\n\n` +
    `3. Místo vykládky zboží: ${order.adresaDodaniaNazov || ""}\n${order.adresaDodania || ""}\n\n` +
    `4. Místo a datum nakládky zboží: ${company.adresa || ""}, ${nakladkaDateFromDodanie(order.datumDodania)}\n\n` +
    `5. Připojené doklady: LS: ${order.cisloDodaciehoListu}${order.nemeckyDodakCislo ? `, Lieferschein DE: ${order.nemeckyDodakCislo}` : ""}\n\n` +
    `6-12. Označení zboží: ${order.popisTovaru || "POPCORN"}\n` +
    `Počet kolli: ${order.pocetPaliet || "[doplňte]"}   Druh obalu: EUROPALETTEN\n` +
    `Hr. hmotnost v kg: ${order.hmotnost || "[doplňte]"}\n\n` +
    `13. Pokyny odesílatele: EUROPALETTEN\n\n` +
    `16. Dopravce: ${order.sposobDopravy === "vyzdvihnutie" ? "VYZVEDNUTÍ ZÁKAZNÍKEM (zákazník si zajišťuje dopravu sám)" : carrier ? carrier.nazov : "[doplňte]"}\n${carrier ? carrier.adresa || "" : ""}\n${carrier && carrier.ico ? "IČO: " + carrier.ico : ""} ${carrier && carrier.dic ? "DIČ: " + carrier.dic : ""}\n${carrier ? carrier.tel || "" : ""} ${carrier ? carrier.email || "" : ""}\n` +
    `SPZ vozidla: [doplní dopravce]   Jméno řidiče: [doplní dopravce]\n\n` +
    `17. Další dopravci: -\n\n` +
    `THE DELIVERED QUANTITY // DODÁNO: ${order.pocetPaliet || ""}\n` +
    `RETURNED QUANTITY // VRÁCENO: [doplní se při návratu]\n\n` +
    `Podpis a razítko odesílatele: ______________________\n` +
    `Podpis a razítko dopravce: ______________________\n` +
    `Podpis a razítko příjemce: ______________________`
  );

  function handlePrint() {
    onDone({ subject: "CMR", body, to: "vytlacene", datum: new Date().toISOString() }, "print");
    setTimeout(() => window.print(), 50);
  }
  function handleDownload() {
    downloadText(`CMR_${order.cisloObjednavkyDopravy.replace("/", "-")}.txt`, body);
    onDone({ subject: "CMR", body, to: "stiahnute", datum: new Date().toISOString() }, "download");
  }
  async function handleDownloadXlsx() {
    await buildCmrXlsx({ order, company, carrier, products });
    onDone({ subject: "CMR", body, to: "stiahnute (Excel)", datum: new Date().toISOString() }, "download");
  }

  return (
    <ModalShell title={"CMR - " + order.cisloObjednavkyDopravy} onClose={onClose} wide>
      <PrintDocument id={printId} title="CMR - MEZINÁRODNÍ NÁKLADNÍ LIST" body={body} />
      {last && <div className="mb-3 bg-emerald-50 text-emerald-800 text-xs px-3 py-2 rounded-md flex items-center gap-2"><CheckCircle2 size={14} /> Naposledy připraveno {formatDateTime(last.datum)}</div>}
      <p className="text-xs text-slate-400 mb-3">Tlačítko "Stáhnout Excel" vyplní přesnou šablonu CMR (stejný formulář, jaký používáte dnes) - místo dodání, počet palet a datum nakládky se doplní automaticky z objednávky. Text níže je jen záložní textový podklad.</p>
      <Field label="Text dokumentu" value={body} onChange={setBody} textarea />
      <div className="flex justify-end gap-2 mt-2 flex-wrap">
        <button onClick={onClose} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
        <button onClick={handleDownloadXlsx} className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5"><Download size={16} /> Stáhnout Excel</button>
        <button onClick={handleDownload} className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5"><Download size={16} /> Stáhnout text</button>
        <button onClick={handlePrint} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5"><Printer size={16} /> Vytisknout</button>
      </div>
    </ModalShell>
  );
}

/* ---------------- Carriers ---------------- */

function UlohaEditModal({ uloha, onClose, onSave }) {
  const [popis, setPopis] = useState(uloha.popis || "");
  const [osoby, setOsoby] = useState(uloha.osoby || []);
  const [termin, setTermin] = useState(uloha.termin || "");
  const [zodpovedny, setZodpovedny] = useState(uloha.zodpovedny || "");
  const [zastupca, setZastupca] = useState(uloha.zastupca || "");
  const [error, setError] = useState("");
  const osobyOptions = ULOHY_OSOBY.map((o) => ({ value: o, label: o }));

  function save() {
    if (!popis.trim()) { setError("Vyplňte znění úkolu."); return; }
    setError("");
    onSave({ popis: popis.trim(), osoby, termin: termin.trim(), zodpovedny, zastupca });
  }

  return (
    <ModalShell title="Upravit úkol" onClose={onClose}>
      <Field label="Úkol / akční plán / bod" value={popis} onChange={setPopis} textarea rows={2} />
      <MultiCheckField label="Kdo má doručit" value={osoby} onChange={setOsoby} options={osobyOptions} />
      <div className="grid grid-cols-2 gap-x-3">
        <SelectField label="Zodpovědná osoba" value={zodpovedny} onChange={setZodpovedny} options={ULOHY_ZODPOVEDNY_OPTIONS} />
        <SelectField label="Zástupce (při nepřítomnosti)" value={zastupca} onChange={setZastupca} options={ULOHY_ZODPOVEDNY_OPTIONS} />
      </div>
      <DateField label="Termín" value={termin} onChange={setTermin} />
      {error && <div className="mb-3 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={14} /> {error}</div>}
      <div className="flex justify-end mt-2">
        <button onClick={save} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Uložit</button>
      </div>
    </ModalShell>
  );
}

function UlohyView({ ulohy, onSave, onUpdate, onDelete }) {
  const [popis, setPopis] = useState("");
  const [osoby, setOsoby] = useState([]);
  const [termin, setTermin] = useState("");
  const [zodpovedny, setZodpovedny] = useState("");
  const [zastupca, setZastupca] = useState("");
  const [formError, setFormError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [editingUloha, setEditingUloha] = useState(null);

  const osobyOptions = ULOHY_OSOBY.map((o) => ({ value: o, label: o }));

  function add() {
    if (!popis.trim()) { setFormError("Vyplňte znění úkolu."); return; }
    setFormError("");
    onSave({ popis: popis.trim(), osoby, termin: termin.trim(), zodpovedny, zastupca });
    setPopis(""); setOsoby([]); setTermin(""); setZodpovedny(""); setZastupca("");
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
        <h1 className="text-xl font-semibold">Úkoly</h1>
      </div>
      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
        <Field label="Úkol / akční plán / bod" value={popis} onChange={setPopis} textarea rows={2} />
        <MultiCheckField label="Kdo má doručit" value={osoby} onChange={setOsoby} options={osobyOptions} />
        <div className="grid grid-cols-2 gap-x-3">
          <SelectField label="Zodpovědná osoba" value={zodpovedny} onChange={setZodpovedny} options={ULOHY_ZODPOVEDNY_OPTIONS} />
          <SelectField label="Zástupce (při nepřítomnosti)" value={zastupca} onChange={setZastupca} options={ULOHY_ZODPOVEDNY_OPTIONS} />
        </div>
        <div className="flex gap-2 items-end flex-wrap">
          <div className="min-w-[160px]">
            <DateField label="Termín" value={termin} onChange={setTermin} />
          </div>
          <button onClick={add} className="mb-3 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md flex items-center gap-1.5"><Plus size={16} /> Přidat úkol</button>
        </div>
        {formError && <div className="bg-red-50 text-red-700 text-xs px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={14} /> {formError}</div>}
      </div>
      {sorted.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500">Zatím žádný úkol.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-100 text-slate-600 text-left"><th className="px-3 py-2 font-medium">Úkol</th><th className="px-3 py-2 font-medium">Kdo</th><th className="px-3 py-2 font-medium">Zodpovědný</th><th className="px-3 py-2 font-medium">Termín</th><th className="px-3 py-2 font-medium">Stav</th><th className="px-3 py-2"></th></tr></thead>
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
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                      {u.zodpovedny ? (
                        <>
                          {u.zodpovedny}
                          {u.zastupca && <span className="text-xs text-slate-400"> (zástupce: {u.zastupca})</span>}
                        </>
                      ) : "—"}
                    </td>
                    <td className={"px-3 py-2 " + (overdue ? "text-red-600 font-medium" : "text-slate-500")}>{u.termin || "—"}</td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => onUpdate(u.id, { hotovo: !u.hotovo })}
                        className={"flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full border " + (u.hotovo ? "bg-green-50 text-green-700 border-green-200" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50")}
                      >
                        <CheckCircle2 size={14} /> {u.hotovo ? "Splněno" : "Otevřeno"}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <IconButton title="Upravit" onClick={() => setEditingUloha(u)}><Pencil size={16} /></IconButton>
                        <IconButton title="Smazat" onClick={() => setConfirmDelete(u)}><Trash2 size={16} /></IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editingUloha && (
        <UlohaEditModal
          uloha={editingUloha}
          onClose={() => setEditingUloha(null)}
          onSave={async (patch) => { await onUpdate(editingUloha.id, patch); setEditingUloha(null); }}
        />
      )}
      {confirmDelete && (
        <ModalShell title="Smazat úkol?" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-slate-600 mb-4">Opravdu chcete smazat tento úkol? Tuto akci nelze vrátit zpět.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDelete(null)} className="px-3 py-1.5 rounded-md text-sm border border-slate-200 text-slate-600">Zrušit</button>
            <button onClick={() => { onDelete(confirmDelete.id); setConfirmDelete(null); }} className="px-3 py-1.5 rounded-md text-sm bg-red-600 hover:bg-red-700 text-white">Smazat</button>
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
    if (!nazov.trim() && !email.trim()) { setFormError("Vyplňte název i e-mail dopravce."); return; }
    if (!nazov.trim()) { setFormError("Vyplňte název dopravce."); return; }
    if (!email.trim()) { setFormError("Vyplňte e-mail dopravce."); return; }
    setFormError("");
    onSave([...carriers, { ...EMPTY_CARRIER, id: uid(), nazov: nazov.trim(), email: email.trim() }]);
    setNazov(""); setEmail("");
  }
  function remove(id) { onSave(carriers.filter((c) => c.id !== id)); }
  async function exportToExcel() {
    const rows = carriers.map((c) => ({
      "Název": c.nazov,
      "E-mail": c.email,
      "Adresa": c.adresa,
      "ICO": c.ico,
      "DIC": c.dic,
      "Telefon": c.tel,
      "Web": c.web,
    }));
    await exportRowsToExcel(rows, "Dopravci", "Dopravci");
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Dopravci</h1>
        <button onClick={exportToExcel} disabled={carriers.length === 0} title={carriers.length === 0 ? "Seznam je prázdný" : "Exportovat do Excelu"} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-sm font-medium px-3 py-2 rounded-md">
          <Download size={16} /> Export do Excelu
        </button>
      </div>
      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
        <div className="flex gap-2 items-end flex-wrap">
          <label className="flex-1 min-w-[160px]"><span className="block text-xs font-medium text-slate-500 mb-1">Název dopravce</span><input value={nazov} onChange={(e) => setNazov(e.target.value)} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" /></label>
          <label className="flex-1 min-w-[160px]"><span className="block text-xs font-medium text-slate-500 mb-1">E-mail</span><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" /></label>
          <button onClick={add} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md flex items-center gap-1.5"><Plus size={16} /> Přidat</button>
        </div>
        {formError && <div className="mt-2 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={14} /> {formError}</div>}
        <p className="text-xs text-slate-400 mt-2">Po přidání klikněte na "Upravit" pro doplnění adresy, IČO, DIČ (používá se v CMR).</p>
      </div>
      {carriers.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500">Zatím žádný dopravce.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-100 text-slate-600 text-left"><th className="px-3 py-2 font-medium">Název</th><th className="px-3 py-2 font-medium">E-mail</th><th className="px-3 py-2"></th></tr></thead>
            <tbody>
              {carriers.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{c.nazov}</td>
                  <td className="px-3 py-2 text-slate-500">{c.email}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <IconButton title="Upravit" onClick={() => onEdit(c)}><Pencil size={16} /></IconButton>
                      <IconButton title="Smazat" onClick={() => remove(c.id)}><Trash2 size={16} /></IconButton>
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
  function update(i, key, val) {
    const next = emaily.slice();
    next[i] = { ...next[i], [key]: val };
    onChange(next);
  }
  function remove(i) {
    onChange(emaily.filter((_, idx) => idx !== i));
  }

  return (
    <div className="mb-3">
      <span className="block text-xs font-medium text-slate-500 mb-1">{caption || "Další e-maily podle účelu (např. Objednávky, Faktury) - při více adresách najednou je oddělte čárkou"}</span>
      {(emaily || []).length > 0 && (
        <div className="mb-1.5 space-y-1">
          {emaily.map((e, i) => (
            <div key={i} className="flex items-center gap-1.5 bg-slate-50 rounded-md px-1.5 py-1">
              <input value={e.label} onChange={(ev) => update(i, "label", ev.target.value)} className="w-32 border border-slate-200 rounded px-2 py-1 text-sm" />
              <input value={e.email} onChange={(ev) => update(i, "email", ev.target.value)} className="flex-1 border border-slate-200 rounded px-2 py-1 text-sm" />
              <button onClick={() => remove(i)} className="text-slate-400 hover:text-red-600 shrink-0"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Účel (např. Objednávky)" className="w-36 border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="email1@x.cz, email2@x.cz"
          className="flex-1 border border-slate-200 rounded-md px-2.5 py-1.5 text-sm"
        />
        <button onClick={add} className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium px-3 py-1.5 rounded-md flex items-center gap-1"><Plus size={14} /> Přidat</button>
      </div>
    </div>
  );
}

function CarrierModal({ carrier, onClose, onSave }) {
  const [f, setF] = useState({ ...EMPTY_CARRIER, ...carrier });
  return (
    <ModalShell title={"Upravit dopravce - " + carrier.nazov} onClose={onClose}>
      <Field label="Název" value={f.nazov} onChange={(v) => setF({ ...f, nazov: v })} />
      <Field label="E-mail" value={f.email} onChange={(v) => setF({ ...f, email: v })} type="email" />
      <Field label="Adresa" value={f.adresa} onChange={(v) => setF({ ...f, adresa: v })} textarea />
      <Field label="ICO" value={f.ico} onChange={(v) => setF({ ...f, ico: v })} />
      <Field label="DIC" value={f.dic} onChange={(v) => setF({ ...f, dic: v })} />
      <Field label="Telefon" value={f.tel} onChange={(v) => setF({ ...f, tel: v })} />
      <Field label="Web" value={f.web} onChange={(v) => setF({ ...f, web: v })} />
      <EmailListEditor emaily={f.emaily} onChange={(list) => setF({ ...f, emaily: list })} />
      <div className="flex justify-end mt-2"><button onClick={() => onSave(f)} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Uložit</button></div>
    </ModalShell>
  );
}

/* ---------------- Customers ---------------- */

function CustomersView({ customers, onSave, onEdit }) {
  const [nazov, setNazov] = useState("");
  const [formError, setFormError] = useState("");

  function add() {
    if (!nazov.trim()) { setFormError("Vyplňte název zákazníka."); return; }
    setFormError("");
    onSave([...customers, { ...EMPTY_CUSTOMER, id: uid(), nazov: nazov.trim() }]);
    setNazov("");
  }
  function remove(id) { onSave(customers.filter((c) => c.id !== id)); }
  async function exportToExcel() {
    const rows = customers.map((c) => ({
      "Název": c.nazov,
      "Adresa": c.adresa,
      "ICO": c.ico,
      "DIC": c.dic,
      "E-mail": c.email,
      "Položky v katalogu": (c.katalog || []).length,
    }));
    await exportRowsToExcel(rows, "Zákazníci", "Zákazníci");
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Zákazníci</h1>
        <button onClick={exportToExcel} disabled={customers.length === 0} title={customers.length === 0 ? "Seznam je prázdný" : "Exportovat do Excelu"} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-sm font-medium px-3 py-2 rounded-md">
          <Download size={16} /> Export do Excelu
        </button>
      </div>
      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
        <div className="flex gap-2 items-end flex-wrap">
          <label className="flex-1 min-w-[220px]"><span className="block text-xs font-medium text-slate-500 mb-1">Název zákazníka (odběratele)</span><input value={nazov} onChange={(e) => setNazov(e.target.value)} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" /></label>
          <button onClick={add} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md flex items-center gap-1.5"><Plus size={16} /> Přidat</button>
        </div>
        {formError && <div className="mt-2 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={14} /> {formError}</div>}
        <p className="text-xs text-slate-400 mt-2">Po přidání klikněte na "Upravit" pro doplnění fakturační adresy, IČO/DIČ a katalogu zboží.</p>
      </div>
      {customers.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500">Zatím žádný zákazník.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-100 text-slate-600 text-left"><th className="px-3 py-2 font-medium">Název</th><th className="px-3 py-2 font-medium">Adresa</th><th className="px-3 py-2 font-medium">Položky v katalogu</th><th className="px-3 py-2"></th></tr></thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{c.nazov}</td>
                  <td className="px-3 py-2 text-slate-500 whitespace-pre-wrap">{c.adresa}</td>
                  <td className="px-3 py-2 text-slate-500">{(c.katalog || []).length}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <IconButton title="Upravit" onClick={() => onEdit(c)}><Pencil size={16} /></IconButton>
                      <IconButton title="Smazat" onClick={() => remove(c.id)}><Trash2 size={16} /></IconButton>
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

function CatalogTable({ katalog, setKatalog, products }) {
  function update(i, key, val) {
    const next = katalog.slice();
    next[i] = { ...next[i], [key]: val };
    setKatalog(next);
  }
  function pickProdukt(i, produktId) {
    const p = (products || []).find((x) => x.id === produktId);
    const next = katalog.slice();
    next[i] = {
      ...next[i],
      produktId,
      artikel: p ? (p.cisloArtiklu || next[i].artikel) : next[i].artikel,
      popis: next[i].popis || (p ? productLabel(p) : next[i].popis),
    };
    setKatalog(next);
  }
  function remove(i) { setKatalog(katalog.filter((_, idx) => idx !== i)); }
  function add() { setKatalog([...katalog, { popis: "", artikel: "", produktId: "" }]); }
  return (
    <div className="mb-3">
      <span className="block text-xs font-medium text-slate-500 mb-1">Katalog zboží</span>
      <p className="text-xs text-slate-400 mb-1.5">EAN, obsah balení a RSPO se zadávají jednou u produktu ve Výrobě - zde jen propojíte produkt a doplníte název/číslo artiklu, jak je zná tento zákazník.</p>
      <div className="border border-slate-200 rounded-md overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-100 text-slate-600 text-left">
              <th className="px-2 py-1.5 w-48">Produkt z výroby</th>
              <th className="px-2 py-1.5">Popis zboží (pro zákazníka)</th>
              <th className="px-2 py-1.5 w-28">Číslo artiklu</th>
              <th className="px-2 py-1.5 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {katalog.map((k, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-1 py-1">
                  <select value={k.produktId || ""} onChange={(e) => pickProdukt(i, e.target.value)} className="w-full border border-slate-200 rounded px-1.5 py-1">
                    <option value="">-- nepropojeno --</option>
                    {(products || []).map((p) => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
                  </select>
                </td>
                <td className="px-1 py-1"><input value={k.popis} onChange={(e) => update(i, "popis", e.target.value)} className="w-full border border-slate-200 rounded px-1.5 py-1" /></td>
                <td className="px-1 py-1"><input value={k.artikel} onChange={(e) => update(i, "artikel", e.target.value)} className="w-full border border-slate-200 rounded px-1.5 py-1" /></td>
                <td className="px-1 py-1 text-center"><button onClick={() => remove(i)} className="text-slate-400 hover:text-red-600"><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={add} className="mt-1.5 text-xs text-teal-700 hover:text-teal-900 flex items-center gap-1"><Plus size={12} /> Přidat položku katalogu</button>
    </div>
  );
}

function CustomerModal({ customer, products, onClose, onSave }) {
  const [f, setF] = useState({ ...EMPTY_CUSTOMER, ...customer, katalog: customer.katalog || [] });
  return (
    <ModalShell title={"Upravit zákazníka - " + customer.nazov} onClose={onClose} wide>
      <Field label="Název" value={f.nazov} onChange={(v) => setF({ ...f, nazov: v })} />
      <Field label="Fakturační adresa (Abnehmer)" value={f.adresa} onChange={(v) => setF({ ...f, adresa: v })} textarea />
      <Field label="ICO" value={f.ico} onChange={(v) => setF({ ...f, ico: v })} />
      <Field label="DIČ / Ust.-Id Nr." value={f.dic} onChange={(v) => setF({ ...f, dic: v })} />
      <Field label="E-mail (komu se posílá dodací list - oddělte čárkou, pokud je více adres)" value={f.email} onChange={(v) => setF({ ...f, email: v })} />
      <EmailListEditor emaily={f.emaily} onChange={(list) => setF({ ...f, emaily: list })} />
      <CatalogTable katalog={f.katalog} setKatalog={(k) => setF({ ...f, katalog: k })} products={products} />
      <div className="flex justify-end mt-2"><button onClick={() => onSave(f)} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Uložit</button></div>
    </ModalShell>
  );
}

/* ---------------- Dodavatelia ---------------- */

function SuppliersView({ suppliers, onSave, onEdit }) {
  const [nazov, setNazov] = useState("");
  const [formError, setFormError] = useState("");

  function add() {
    if (!nazov.trim()) { setFormError("Vyplňte název dodavatele."); return; }
    setFormError("");
    onSave([...suppliers, { ...EMPTY_SUPPLIER, id: uid(), nazov: nazov.trim() }]);
    setNazov("");
  }
  function remove(id) { onSave(suppliers.filter((s) => s.id !== id)); }
  async function exportToExcel() {
    const rows = suppliers.map((s) => ({
      "Název": s.nazov,
      "Typ": materialTypLabel(s.typ),
      "Jazyk komunikace": (MATERIAL_JAZYK_OPTIONS.find((o) => o.value === s.jazyk) || {}).label || "Slovenština",
      "Adresa": s.adresa,
      "ICO": s.ico,
      "DIC": s.dic,
      "E-mail": s.email,
      "Telefon": s.tel,
      "Zboží v katalogu": (s.tovary || []).length,
    }));
    await exportRowsToExcel(rows, "Dodavatelé", "Dodavatelé");
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Dodavatelé</h1>
        <button onClick={exportToExcel} disabled={suppliers.length === 0} title={suppliers.length === 0 ? "Seznam je prázdný" : "Exportovat do Excelu"} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-sm font-medium px-3 py-2 rounded-md">
          <Download size={16} /> Export do Excelu
        </button>
      </div>
      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
        <div className="flex gap-2 items-end flex-wrap">
          <label className="flex-1 min-w-[220px]"><span className="block text-xs font-medium text-slate-500 mb-1">Název dodavatele</span><input value={nazov} onChange={(e) => setNazov(e.target.value)} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" /></label>
          <button onClick={add} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md flex items-center gap-1.5"><Plus size={16} /> Přidat</button>
        </div>
        {formError && <div className="mt-2 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={14} /> {formError}</div>}
        <p className="text-xs text-slate-400 mt-2">Po přidání klikněte na "Upravit" pro doplnění adresy (místo vyzvednutí), e-mailu, IČO, DIČ.</p>
      </div>
      {suppliers.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500">Zatím žádný dodavatel.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-100 text-slate-600 text-left"><th className="px-3 py-2 font-medium">Název</th><th className="px-3 py-2 font-medium">Typ</th><th className="px-3 py-2 font-medium">Adresa</th><th className="px-3 py-2 font-medium">Zboží</th><th className="px-3 py-2"></th></tr></thead>
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
                      <IconButton title="Smazat" onClick={() => remove(s.id)}><Trash2 size={16} /></IconButton>
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
      setImportMsg(`Naimportováno: ${added} nových, ${updated} aktualizovaných.`);
    } catch (err) {
      console.error(err);
      setImportError(err.message || "Nepodařilo se zpracovat soubor.");
    }
    setImportBusy(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="block text-xs font-medium text-slate-500">Zboží / materiály, které dodává</span>
        <div className="flex items-center gap-2">
          <button type="button" disabled={importBusy} onClick={() => fileInputRef.current && fileInputRef.current.click()} className="text-xs text-teal-700 hover:text-teal-900 flex items-center gap-1 disabled:opacity-50">
            <Upload size={12} /> {importBusy ? "Importuji..." : "Import z XLS"}
          </button>
          <input ref={fileInputRef} type="file" accept=".xls,.xlsx" className="hidden" onChange={handleImportFile} />
        </div>
      </div>
      {importError && <p className="text-xs text-red-600 mb-1">{importError}</p>}
      {importMsg && <p className="text-xs text-teal-700 mb-1">{importMsg}</p>}
      <div className="border border-slate-200 rounded-md overflow-hidden">
        <table className="w-full text-xs">
          <thead><tr className="bg-slate-100 text-slate-600 text-left"><th className="px-2 py-1.5">Název položky</th><th className="px-2 py-1.5 w-28">Artikl</th><th className="px-2 py-1.5 w-48">Balenie (napr. 25 kg karton, 40 kartonov/paleta)</th><th className="px-2 py-1.5 w-8"></th></tr></thead>
          <tbody>
            {tovary.map((t, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-1 py-1"><input value={t.popis} onChange={(e) => update(i, "popis", e.target.value)} className="w-full border border-slate-200 rounded px-1.5 py-1" /></td>
                <td className="px-1 py-1"><input value={t.artikel} onChange={(e) => update(i, "artikel", e.target.value)} className="w-full border border-slate-200 rounded px-1.5 py-1" /></td>
                <td className="px-1 py-1"><input value={t.balenie || ""} onChange={(e) => update(i, "balení", e.target.value)} className="w-full border border-slate-200 rounded px-1.5 py-1" /></td>
                <td className="px-1 py-1 text-center"><button onClick={() => remove(i)} className="text-slate-400 hover:text-red-600"><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={add} className="mt-1.5 text-xs text-teal-700 hover:text-teal-900 flex items-center gap-1"><Plus size={12} /> Přidat položku</button>
    </div>
  );
}

function SupplierModal({ supplier, onClose, onSave }) {
  const [f, setF] = useState({ ...EMPTY_SUPPLIER, ...supplier, typ: normalizeSupplierTyp(supplier.typ), jazyk: supplier.jazyk || "sk", tovary: normalizeTovary(supplier.tovary) });

  return (
    <ModalShell title={"Upravit dodavatele - " + supplier.nazov} onClose={onClose} wide>
      <Field label="Název" value={f.nazov} onChange={(v) => setF({ ...f, nazov: v })} />
      <MultiCheckField label="Typ dodavatele (co dodává - může být i obojí)" value={f.typ} onChange={(v) => setF({ ...f, typ: v })} options={MATERIAL_TYP_OPTIONS} />
      <SegmentedField label="Jazyk komunikace (předmět a text objednávkového e-mailu)" value={f.jazyk} onChange={(v) => setF({ ...f, jazyk: v })} options={MATERIAL_JAZYK_OPTIONS} />
      <Field label="Adresa (místo vyzvednutí)" value={f.adresa} onChange={(v) => setF({ ...f, adresa: v })} textarea />
      <Field label="ICO" value={f.ico} onChange={(v) => setF({ ...f, ico: v })} />
      <Field label="DIC" value={f.dic} onChange={(v) => setF({ ...f, dic: v })} />
      <Field label="E-mail" value={f.email} onChange={(v) => setF({ ...f, email: v })} type="email" />
      <Field label="Telefon" value={f.tel} onChange={(v) => setF({ ...f, tel: v })} />

      <SupplierGoodsTable tovary={f.tovary} setTovary={(t) => setF({ ...f, tovary: t })} />

      <EmailListEditor emaily={f.emaily} onChange={(list) => setF({ ...f, emaily: list })} />

      <div className="flex justify-end mt-2"><button onClick={() => onSave(f)} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Uložit</button></div>
    </ModalShell>
  );
}

/* ---------------- Designy a fotky ---------------- */

function DesignFormModal({ design, onClose, onSave }) {
  const [f, setF] = useState(() => ({ ...EMPTY_DESIGN, ...design, id: (design && design.id) || uid() }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function uploadTo(field, file) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const ext = (file.name.split(".").pop() || "dat").toLowerCase();
      const path = `${f.id}/${field}-${uid()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from(DESIGNS_BUCKET).upload(path, file, { contentType: file.type });
      if (uploadError) throw uploadError;
      setF((prev) => ({ ...prev, [field]: path, ...(field === "tlacoveDataPath" ? { tlacoveDataNazov: file.name } : {}) }));
    } catch (e) {
      console.error(e);
      setError("Nahrání souboru se nezdařilo, zkuste to znovu.");
    }
    setBusy(false);
  }

  function save() {
    if (!f.nazov.trim()) { setError("Vyplňte název designu."); return; }
    setError("");
    onSave({ ...f, nazov: f.nazov.trim() });
  }

  return (
    <ModalShell title={design ? "Upravit design" : "Nový design"} onClose={onClose}>
      <Field label="Název" value={f.nazov} onChange={(v) => setF({ ...f, nazov: v })} />
      <SelectField label="Kategorie" value={f.kategoria} onChange={(v) => setF({ ...f, kategoria: v })} options={DESIGN_KATEGORIE} />

      <label className="block mb-3">
        <span className="block text-xs font-medium text-slate-500 mb-1">Tisková data (PDF/AI)</span>
        <input type="file" disabled={busy} onChange={(e) => uploadTo("tlacoveDataPath", e.target.files[0])} className="w-full text-sm" />
        {f.tlacoveDataPath && (
          <button type="button" onClick={() => openDesignFile(f.tlacoveDataPath)} className="text-xs text-teal-700 hover:text-teal-900 mt-1">
            Nahráno{f.tlacoveDataNazov ? ": " + f.tlacoveDataNazov : ""} - otevřít
          </button>
        )}
      </label>
      <label className="block mb-3">
        <span className="block text-xs font-medium text-slate-500 mb-1">Náhled (obrázek)</span>
        <input type="file" accept="image/*" disabled={busy} onChange={(e) => uploadTo("nahladPath", e.target.files[0])} className="w-full text-sm" />
        {f.nahladPath && <button type="button" onClick={() => openDesignFile(f.nahladPath)} className="text-xs text-teal-700 hover:text-teal-900 mt-1">Nahráno - otevřít</button>}
      </label>
      <label className="block mb-3">
        <span className="block text-xs font-medium text-slate-500 mb-1">Fotka</span>
        <input type="file" accept="image/*" disabled={busy} onChange={(e) => uploadTo("fotkaPath", e.target.files[0])} className="w-full text-sm" />
        {f.fotkaPath && <button type="button" onClick={() => openDesignFile(f.fotkaPath)} className="text-xs text-teal-700 hover:text-teal-900 mt-1">Nahráno - otevřít</button>}
      </label>

      {error && <div className="mb-3 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={14} /> {error}</div>}
      <div className="flex justify-end mt-2">
        <button onClick={save} disabled={busy} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-md">
          {busy ? "Nahrávám..." : "Uložit"}
        </button>
      </div>
    </ModalShell>
  );
}

const DESIGN_KATEGORIA_COLORS = {
  kbelik: { dot: "bg-amber-500", head: "border-amber-300 text-amber-700", top: "border-t-amber-400" },
  sacky: { dot: "bg-teal-500", head: "border-teal-300 text-teal-700", top: "border-t-teal-400" },
  ine: { dot: "bg-slate-400", head: "border-slate-300 text-slate-600", top: "border-t-slate-400" },
};

function DesignsView({ designs, onSave, onUpdate, onDelete }) {
  const [showNew, setShowNew] = useState(false);
  const [editingDesign, setEditingDesign] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const grouped = DESIGN_KATEGORIE.map((k) => ({ ...k, items: designs.filter((d) => (d.kategoria || "kbelik") === k.value) }));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Designy a fotky</h1>
        <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md">
          <Plus size={16} /> Nový design
        </button>
      </div>
      <p className="text-xs text-slate-400 mb-4">Design (IML kbelíku nebo tisková data fólie sáčku) přiřaďte k produktům v sekci Produkty - jeden design může mít víc produktů (stejný obal, jiný karton/paleta).</p>

      {designs.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-slate-500">
          <Image size={28} className="mx-auto mb-3 text-slate-300" />
          Zatím žádné designy.
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.filter((g) => g.items.length > 0).map((g) => {
            const c = DESIGN_KATEGORIA_COLORS[g.value] || DESIGN_KATEGORIA_COLORS.ine;
            return (
              <div key={g.value}>
                <div className={"flex items-center gap-2 mb-3 pb-2 border-b-2 " + c.head}>
                  <span className={"w-2.5 h-2.5 rounded-full " + c.dot} />
                  <h2 className="text-sm font-bold uppercase tracking-wide">{g.label}</h2>
                  <span className="text-xs font-normal text-slate-400">({g.items.length})</span>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {g.items.map((d) => (
                    <div key={d.id} className={"bg-white border-x border-b border-t-4 border-slate-200 rounded-lg p-4 " + c.top}>
                      <div className="flex items-start justify-between mb-2">
                        <div className="font-medium">{d.nazov}</div>
                        <div className="flex gap-1">
                          <IconButton title="Upravit" onClick={() => setEditingDesign(d)}><Pencil size={16} /></IconButton>
                          <IconButton title="Smazat" onClick={() => setConfirmDelete(d)}><Trash2 size={16} /></IconButton>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 text-sm">
                        <button disabled={!d.tlacoveDataPath} onClick={() => openDesignFile(d.tlacoveDataPath)} className="text-left flex items-center gap-1.5 text-teal-700 hover:text-teal-900 disabled:text-slate-300 disabled:cursor-not-allowed">
                          <FileText size={14} /> Tisková data {d.tlacoveDataPath ? "" : "(chybí)"}
                        </button>
                        <button disabled={!d.nahladPath} onClick={() => openDesignFile(d.nahladPath)} className="text-left flex items-center gap-1.5 text-teal-700 hover:text-teal-900 disabled:text-slate-300 disabled:cursor-not-allowed">
                          <Image size={14} /> Náhled {d.nahladPath ? "" : "(chybí)"}
                        </button>
                        <button disabled={!d.fotkaPath} onClick={() => openDesignFile(d.fotkaPath)} className="text-left flex items-center gap-1.5 text-teal-700 hover:text-teal-900 disabled:text-slate-300 disabled:cursor-not-allowed">
                          <Camera size={14} /> Fotka {d.fotkaPath ? "" : "(chybí)"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showNew && <DesignFormModal onClose={() => setShowNew(false)} onSave={async (fields) => { await onSave(fields); setShowNew(false); }} />}
      {editingDesign && <DesignFormModal design={editingDesign} onClose={() => setEditingDesign(null)} onSave={async (fields) => { await onUpdate(editingDesign.id, fields); setEditingDesign(null); }} />}
      {confirmDelete && (
        <ModalShell title="Smazat design?" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-slate-600 mb-4">Opravdu chcete smazat design "{confirmDelete.nazov}"? Produkty, které na něj odkazují, o přiřazení přijdou.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDelete(null)} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
            <button onClick={() => { onDelete(confirmDelete.id); setConfirmDelete(null); }} className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5">
              <Trash2 size={16} /> Ano, smazat
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

/* ---------------- Navody ---------------- */

function NavodCard({ navod, onOpen, onDelete }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase.storage.from(NAVODY_BUCKET).createSignedUrl(navod.path, 3600);
      if (active && !error && data) setUrl(data.signedUrl);
    })();
    return () => { active = false; };
  }, [navod.path]);

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden group">
      <button type="button" onClick={() => onOpen(navod, url)} disabled={!url} className="block w-full text-left cursor-pointer disabled:cursor-wait">
        <div className="h-56 bg-slate-50 border-b border-slate-100 overflow-hidden relative">
          {url ? (
            <iframe src={url} title={navod.nazov} className="w-full h-full pointer-events-none" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-300"><FileText size={28} /></div>
          )}
          <div className="absolute inset-0 group-hover:bg-black/5 transition-colors" />
        </div>
      </button>
      <div className="flex items-center justify-between px-3 py-2 gap-2">
        <div className="font-medium text-sm truncate">{navod.nazov}</div>
        <IconButton title="Smazat" onClick={() => onDelete(navod)}><Trash2 size={16} /></IconButton>
      </div>
    </div>
  );
}

function NavodFormModal({ onClose, onSave }) {
  const [nazov, setNazov] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!nazov.trim()) { setError("Vyplňte název návodu."); return; }
    if (!file) { setError("Vyberte PDF soubor."); return; }
    setBusy(true);
    setError("");
    try {
      const id = uid();
      const path = `${id}/${file.name}`;
      const { error: uploadError } = await supabase.storage.from(NAVODY_BUCKET).upload(path, file, { contentType: file.type || "application/pdf" });
      if (uploadError) throw uploadError;
      await onSave({ id, nazov: nazov.trim(), path, fileName: file.name });
    } catch (e) {
      console.error(e);
      setError("Nahrání se nezdařilo, zkuste to znovu.");
    }
    setBusy(false);
  }

  return (
    <ModalShell title="Nový návod" onClose={onClose}>
      <Field label="Název" value={nazov} onChange={setNazov} />
      <label className="block mb-3">
        <span className="block text-xs font-medium text-slate-500 mb-1">PDF soubor</span>
        <input type="file" accept="application/pdf" disabled={busy} onChange={(e) => setFile(e.target.files[0])} className="w-full text-sm" />
      </label>
      {error && <div className="mb-3 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={14} /> {error}</div>}
      <div className="flex justify-end mt-2">
        <button onClick={save} disabled={busy} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-md">
          {busy ? "Nahrávám..." : "Uložit"}
        </button>
      </div>
    </ModalShell>
  );
}

function NavodyView({ navody, onSave, onDelete }) {
  const [showNew, setShowNew] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Návody</h1>
        <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md">
          <Plus size={16} /> Přidat návod
        </button>
      </div>

      {navody.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-slate-500">
          <BookOpen size={28} className="mx-auto mb-3 text-slate-300" />
          Zatím žádné návody.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {navody.map((n) => (
            <NavodCard key={n.id} navod={n} onOpen={(navod, url) => setViewing({ navod, url })} onDelete={() => setConfirmDelete(n)} />
          ))}
        </div>
      )}

      {showNew && (
        <NavodFormModal
          onClose={() => setShowNew(false)}
          onSave={async (fields) => { await onSave(fields); setShowNew(false); }}
        />
      )}

      {viewing && (
        <div className="fixed inset-0 bg-black/60 z-50 flex flex-col p-4">
          <div className="flex items-center justify-between mb-2 text-white">
            <div className="font-medium">{viewing.navod.nazov}</div>
            <button onClick={() => setViewing(null)} className="hover:text-slate-300"><X size={22} /></button>
          </div>
          <div className="flex-1 bg-white rounded-lg overflow-hidden">
            {viewing.url && <iframe src={viewing.url} title={viewing.navod.nazov} className="w-full h-full" />}
          </div>
        </div>
      )}

      {confirmDelete && (
        <ModalShell title="Smazat návod?" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-slate-600 mb-4">Opravdu chcete smazat návod "{confirmDelete.nazov}"?</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDelete(null)} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
            <button onClick={() => { onDelete(confirmDelete.id); setConfirmDelete(null); }} className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5">
              <Trash2 size={16} /> Ano, smazat
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

/* ---------------- Reklamace ---------------- */

function ReklamaceView({ reklamace, suppliers, currentUserName, onSave, onUpdate, onDelete }) {
  const [f, setF] = useState({ ...EMPTY_REKLAMACE, datum: todayStr(), zapisal: currentUserName || "" });
  const [formError, setFormError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const materialPicks = materialPicksForSupplier(f.dodavatelId, suppliers, MATERIAL_QUICK_PICKS);

  function pickSupplier(id) {
    const s = (suppliers || []).find((x) => x.id === id);
    setF((prev) => ({ ...prev, dodavatelId: id, dodavatel: s ? s.nazov : prev.dodavatel, material: "" }));
  }

  function add() {
    if (!f.material.trim()) { setFormError("Vyplňte materiál / položku."); return; }
    if (!f.mnozstvoCislo) { setFormError("Vyplňte množství."); return; }
    setFormError("");
    onSave({
      ...f,
      material: f.material.trim(),
      dodavatel: f.dodavatel.trim(),
      dovod: f.dovod.trim(),
      poznamka: f.poznamka.trim(),
      mnozstvo: [f.mnozstvoCislo, f.mnozstvoJednotka].filter(Boolean).join(" ").trim(),
    });
    setF({ ...EMPTY_REKLAMACE, datum: todayStr(), zapisal: currentUserName || "" });
  }

  const sorted = reklamace.slice().sort((a, b) => {
    if (!!(a.stav === "Vybavene") !== !!(b.stav === "Vybavene")) return a.stav === "Vybavene" ? 1 : -1;
    return 0;
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Reklamace</h1>
      </div>
      <p className="text-xs text-slate-400 mb-4">Poškozený materiál nebo obaly zjištěné např. při kontrole před výrobou (nesouvisí s konkrétním příjmem zboží) - čeká na vyzvednutí dodavatelem při další dodávce. Množství se automaticky odečte ze stavu zásob (jako výdej s důvodem "Znehodnotené").</p>
      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
        <div className="grid grid-cols-2 gap-x-3">
          <DateField label="Datum" value={f.datum} onChange={(v) => setF({ ...f, datum: v })} />
          <SelectField
            label="Dodavatel"
            value={f.dodavatelId}
            onChange={pickSupplier}
            options={[{ value: "", label: "-- vyberte / doplním ručně --" }, ...suppliers.map((s) => ({ value: s.id, label: s.nazov }))]}
          />
        </div>
        {!f.dodavatelId && (
          <Field label="Název dodavatele (zobrazení)" value={f.dodavatel} onChange={(v) => setF({ ...f, dodavatel: v })} />
        )}
        <label className="block mb-3">
          <span className="block text-xs font-medium text-slate-500 mb-1">Materiál / položka (např. Kbelíky)</span>
          <input
            list="reklamace-material-picks"
            value={f.material}
            onChange={(e) => setF({ ...f, material: e.target.value })}
            className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
          <datalist id="reklamace-material-picks">
            {materialPicks.map((m) => <option key={m} value={m} />)}
          </datalist>
        </label>
        <div className="mb-3">
          <span className="block text-xs font-medium text-slate-500 mb-1">Množství</span>
          <div className="flex gap-2 items-center flex-wrap">
            <input value={f.mnozstvoCislo} onChange={(e) => setF({ ...f, mnozstvoCislo: e.target.value })} inputMode="decimal" placeholder="např. 20" className="w-24 border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
            <select value={f.mnozstvoJednotka} onChange={(e) => setF({ ...f, mnozstvoJednotka: e.target.value })} className="border border-slate-200 rounded-md px-2.5 py-1.5 text-sm">
              {UNIT_QUICK_PICKS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
        <Field label="Důvod (např. poškozené při kontrole před výrobou)" value={f.dovod} onChange={(v) => setF({ ...f, dovod: v })} />
        <Field label="Poznámka" value={f.poznamka} onChange={(v) => setF({ ...f, poznamka: v })} textarea />
        <Field label="Zapsal" value={f.zapisal} onChange={(v) => setF({ ...f, zapisal: v })} />
        <button onClick={add} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md flex items-center gap-1.5"><Plus size={16} /> Přidat reklamaci</button>
        {formError && <div className="mt-2 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={14} /> {formError}</div>}
      </div>

      {sorted.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500">Zatím žádná reklamace.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-100 text-slate-600 text-left"><th className="px-3 py-2 font-medium">Datum</th><th className="px-3 py-2 font-medium">Dodavatel</th><th className="px-3 py-2 font-medium">Materiál</th><th className="px-3 py-2 font-medium">Množství</th><th className="px-3 py-2 font-medium">Důvod</th><th className="px-3 py-2 font-medium">Stav</th><th className="px-3 py-2"></th></tr></thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className={"border-t border-slate-100 " + (r.stav === "Vybavene" ? "opacity-50" : "")}>
                  <td className="px-3 py-2 text-slate-500">{r.datum || "—"}</td>
                  <td className="px-3 py-2">{r.dodavatel || "—"}</td>
                  <td className="px-3 py-2 font-medium">{r.material}</td>
                  <td className="px-3 py-2 text-slate-500">{r.mnozstvo}</td>
                  <td className="px-3 py-2 text-slate-500 whitespace-pre-wrap max-w-xs">{r.dovod}</td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => onUpdate(r.id, { stav: r.stav === "Vybavene" ? "Ceka na vyzdvihnutie" : "Vybavene" })}
                      className={"flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full border " + (r.stav === "Vybavene" ? "bg-green-50 text-green-700 border-green-200" : "bg-amber-50 text-amber-700 border-amber-200")}
                    >
                      <CheckCircle2 size={14} /> {r.stav === "Vybavene" ? "Vybaveno" : "Čeká na vyzvednutí"}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <IconButton title="Smazat" onClick={() => setConfirmDelete(r)}><Trash2 size={16} /></IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {confirmDelete && (
        <ModalShell title="Smazat reklamaci?" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-slate-600 mb-4">Opravdu chcete smazat tuto reklamaci? Tuto akci nelze vrátit zpět.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDelete(null)} className="px-3 py-1.5 rounded-md text-sm border border-slate-200 text-slate-600">Zrušit</button>
            <button onClick={() => { onDelete(confirmDelete.id); setConfirmDelete(null); }} className="px-3 py-1.5 rounded-md text-sm bg-red-600 hover:bg-red-700 text-white">Smazat</button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

/* ---------------- Produkty ---------------- */

function findSwPricelistProductColumns(rows) {
  if (!rows || !rows.length) return null;
  const LABELS = [
    { key: "nazov", match: /name/i },
    { key: "vaha", match: /weight/i },
    { key: "obsah", match: /content/i },
    { key: "snc", match: /snc/i },
    { key: "sw", match: /sage/i },
  ];
  let headerRowIdx = -1, bestCount = -1, cols = {};
  rows.forEach((row, ri) => {
    const rowCols = {};
    let count = 0;
    row.forEach((cell, ci) => {
      const s = String(cell);
      LABELS.forEach((l) => {
        if (rowCols[l.key] === undefined && l.match.test(s)) { rowCols[l.key] = ci; count++; }
      });
    });
    if (count > bestCount) { bestCount = count; headerRowIdx = ri; cols = rowCols; }
  });
  if (bestCount < 3 || cols.nazov === undefined) return null;
  return { headerRowIdx, cols };
}

function numEqApprox(a, b) {
  const na = parseFloat(String(a).replace(",", "."));
  const nb = parseFloat(String(b).replace(",", "."));
  if (isNaN(na) || isNaN(nb)) return false;
  return Math.abs(na - nb) < 0.001;
}

function guessProductMatch(products, row) {
  const nazovUpper = String(row.nazov || "").toUpperCase();
  const words = nazovUpper.split(/[^A-Z0-9]+/).filter(Boolean);
  const candidates = products.filter((p) => {
    const znackaUpper = String(p.znacka || "").toUpperCase().trim();
    if (!znackaUpper || !words.includes(znackaUpper)) return false;
    if (row.vaha !== "" && p.gramaz && !numEqApprox(row.vaha, p.gramaz)) return false;
    if (row.obsah !== "" && p.ksVKartone && !numEqApprox(row.obsah, p.ksVKartone)) return false;
    return true;
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function ArtiklMatchModal({ products, swPricelist, onClose, onApply }) {
  const info = useMemo(() => findSwPricelistProductColumns(swPricelist && swPricelist.rows), [swPricelist]);

  const dataRows = useMemo(() => {
    if (!info || !swPricelist || !swPricelist.rows) return [];
    const { headerRowIdx, cols } = info;
    return swPricelist.rows.slice(headerRowIdx + 1).map((row, i) => ({
      idx: headerRowIdx + 1 + i,
      nazov: row[cols.nazov],
      vaha: cols.vaha !== undefined ? row[cols.vaha] : "",
      obsah: cols.obsah !== undefined ? row[cols.obsah] : "",
      snc: cols.snc !== undefined ? row[cols.snc] : "",
      sw: cols.sw !== undefined ? row[cols.sw] : "",
    })).filter((r) => String(r.nazov || "").trim() && (String(r.snc || "").trim() || String(r.sw || "").trim()));
  }, [info, swPricelist]);

  const [selections, setSelections] = useState(() => {
    const initial = {};
    dataRows.forEach((r) => {
      const match = guessProductMatch(products, r);
      if (match) initial[r.idx] = match.id;
    });
    return initial;
  });

  const matchedCount = Object.values(selections).filter(Boolean).length;

  function apply() {
    const patchById = {};
    dataRows.forEach((r) => {
      const pid = selections[r.idx];
      if (pid) patchById[pid] = { cisloArtiklu: String(r.snc || "").trim(), cisloArtikluSW: String(r.sw || "").trim() };
    });
    const next = products.map((p) => (patchById[p.id] ? { ...p, ...patchById[p.id] } : p));
    onApply(next);
    onClose();
  }

  if (!info || !dataRows.length) {
    return (
      <ModalShell title="Doplnit artiklová čísla z ceníku" onClose={onClose}>
        <div className="text-sm text-slate-500">V nahraném ceníku Stenger Waffeln se nepodařilo najít sloupce s artiklovými čísly (Artikel No. SNC / Sage 100). Zkontrolujte, že je ceník nahraný v sekci "Ceník Stenger Waffeln".</div>
      </ModalShell>
    );
  }

  return (
    <ModalShell title="Doplnit artiklová čísla z ceníku" onClose={onClose} extraWide>
      <p className="text-xs text-slate-400 mb-3">Řádky, kde appka podle názvu, gramáže a ks v kartonu našla přesně jeden odpovídající produkt, jsou předvyplněné (zeleně). Zkontrolujte a zbytek doplňte ručně přes výběr, pak potvrďte.</p>
      <div className="overflow-auto max-h-[55vh] border border-slate-100 rounded-md mb-3">
        <table className="text-xs w-full">
          <thead>
            <tr className="bg-slate-100 text-slate-600 text-left sticky top-0">
              <th className="px-2 py-1.5">Artikel Name</th>
              <th className="px-2 py-1.5">Váha</th>
              <th className="px-2 py-1.5">Content</th>
              <th className="px-2 py-1.5">SNC</th>
              <th className="px-2 py-1.5">Sage 100</th>
              <th className="px-2 py-1.5">Produkt</th>
            </tr>
          </thead>
          <tbody>
            {dataRows.map((r) => (
              <tr key={r.idx} className="border-t border-slate-100">
                <td className="px-2 py-1 whitespace-nowrap">{r.nazov}</td>
                <td className="px-2 py-1 whitespace-nowrap">{r.vaha}</td>
                <td className="px-2 py-1 whitespace-nowrap">{r.obsah}</td>
                <td className="px-2 py-1 whitespace-nowrap">{r.snc}</td>
                <td className="px-2 py-1 whitespace-nowrap">{r.sw}</td>
                <td className="px-2 py-1">
                  <select
                    value={selections[r.idx] || ""}
                    onChange={(e) => setSelections((prev) => ({ ...prev, [r.idx]: e.target.value }))}
                    className={"border rounded-md px-1.5 py-1 text-xs max-w-[200px] " + (selections[r.idx] ? "border-teal-300 bg-teal-50" : "border-slate-200")}
                  >
                    <option value="">— nepřiřazeno —</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">{matchedCount} z {dataRows.length} řádků přiřazeno.</span>
        <button onClick={apply} disabled={matchedCount === 0} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md">Uložit přiřazená čísla</button>
      </div>
    </ModalShell>
  );
}

function ProductsView({ products, designs, swPricelist, onSave, onEdit }) {
  const [f, setF] = useState({ znacka: "", gramaz: "", ksVKartone: "", kartonovNaPalete: "", linka: "sacky" });
  const [formError, setFormError] = useState("");
  const [showArtiklMatch, setShowArtiklMatch] = useState(false);

  function add() {
    if (!f.znacka.trim()) { setFormError("Vyplňte značku/název produktu."); return; }
    setFormError("");
    onSave([...products, { ...EMPTY_PRODUCT, ...f, znacka: f.znacka.trim(), id: uid() }]);
    setF({ znacka: "", gramaz: "", ksVKartone: "", kartonovNaPalete: "", linka: "sacky" });
  }
  function remove(id) { onSave(products.filter((p) => p.id !== id)); }
  function changeDesign(id, designId) {
    onSave(products.map((p) => (p.id === id ? { ...p, designId } : p)));
  }
  async function exportToExcel() {
    const rows = products.map((p) => ({
      "Produkt": productLabel(p),
      "Linka": (PRODUCTION_LINKY.find((l) => l.value === p.linka) || {}).label || p.linka,
      "Gramáž": p.gramaz,
      "Ks v kartonu": p.ksVKartone,
      "Kartonů na paletě": p.kartonovNaPalete,
      "Design": (designs || []).find((d) => d.id === p.designId)?.nazov || "",
      "Naše artiklové číslo (SNC)": p.cisloArtiklu || "",
      "Artiklové číslo Stenger Waffeln (Sage 100)": p.cisloArtikluSW || "",
      "Položky v receptuře": (p.receptura || []).length,
    }));
    await exportRowsToExcel(rows, "Produkty", "Produkty");
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Produkty</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowArtiklMatch(true)} disabled={!swPricelist || !swPricelist.rows} title={!swPricelist || !swPricelist.rows ? "Nejprve nahrajte ceník v sekci Ceník Stenger Waffeln" : "Doplnit artiklová čísla z ceníku"} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-sm font-medium px-3 py-2 rounded-md">
            <Receipt size={16} /> Doplnit čísla z ceníku SW
          </button>
          <button onClick={exportToExcel} disabled={products.length === 0} title={products.length === 0 ? "Seznam je prázdný" : "Exportovat do Excelu"} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-sm font-medium px-3 py-2 rounded-md">
            <Download size={16} /> Export do Excelu
          </button>
        </div>
      </div>
      {showArtiklMatch && (
        <ArtiklMatchModal
          products={products}
          swPricelist={swPricelist}
          onClose={() => setShowArtiklMatch(false)}
          onApply={onSave}
        />
      )}
      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
        <div className="flex gap-2 items-end flex-wrap">
          <label className="min-w-[160px]"><span className="block text-xs font-medium text-slate-500 mb-1">Značka / název</span><input value={f.znacka} onChange={(e) => setF({ ...f, znacka: e.target.value })} placeholder="např. FUN" className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" /></label>
          <label className="w-24"><span className="block text-xs font-medium text-slate-500 mb-1">Gramáž</span><input value={f.gramaz} onChange={(e) => setF({ ...f, gramaz: e.target.value })} placeholder="250" className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" /></label>
          <label className="w-28"><span className="block text-xs font-medium text-slate-500 mb-1">Ks v kartonu</span><input value={f.ksVKartone} onChange={(e) => setF({ ...f, ksVKartone: e.target.value })} placeholder="24" className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" /></label>
          <label className="w-32"><span className="block text-xs font-medium text-slate-500 mb-1">Kartonů/paletu</span><input value={f.kartonovNaPalete} onChange={(e) => setF({ ...f, kartonovNaPalete: e.target.value })} placeholder="4" className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" /></label>
          <label className="w-28"><span className="block text-xs font-medium text-slate-500 mb-1">Linka</span>
            <select value={f.linka} onChange={(e) => setF({ ...f, linka: e.target.value })} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm">
              {PRODUCTION_LINKY.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </label>
          <button onClick={add} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md flex items-center gap-1.5"><Plus size={16} /> Přidat</button>
        </div>
        {formError && <div className="mt-2 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={14} /> {formError}</div>}
        <p className="text-xs text-slate-400 mt-2">Po přidání klikněte na "Upravit" pro doplnění receptury (suroviny na 1 paletu).</p>
      </div>
      {products.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500">Zatím žádný produkt.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-100 text-slate-600 text-left"><th className="px-3 py-2 font-medium">Produkt</th><th className="px-3 py-2 font-medium">Linka</th><th className="px-3 py-2 font-medium">Design</th><th className="px-3 py-2 font-medium">Č. SNC / SW</th><th className="px-3 py-2 font-medium">Receptura</th><th className="px-3 py-2"></th></tr></thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{productLabel(p)}</td>
                  <td className="px-3 py-2 text-slate-500">{(PRODUCTION_LINKY.find((l) => l.value === p.linka) || {}).label || p.linka}</td>
                  <td className="px-3 py-2">
                    <select value={p.designId || ""} onChange={(e) => changeDesign(p.id, e.target.value)} className="border border-slate-200 rounded-md px-2 py-1 text-xs max-w-[180px]">
                      <option value="">— žádný —</option>
                      {(designs || []).map((d) => <option key={d.id} value={d.id}>{d.nazov}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-slate-500 text-xs whitespace-nowrap">{p.cisloArtiklu || "—"} / {p.cisloArtikluSW || "—"}</td>
                  <td className="px-3 py-2 text-slate-500">{(p.receptura || []).length} polozka(y)</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <IconButton title="Upravit" onClick={() => onEdit(p)}><Pencil size={16} /></IconButton>
                      <IconButton title="Smazat" onClick={() => remove(p.id)}><Trash2 size={16} /></IconButton>
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
          <thead><tr className="bg-slate-100 text-slate-600 text-left"><th className="px-2 py-1.5">Materiál</th><th className="px-2 py-1.5 w-24">Množství</th><th className="px-2 py-1.5 w-24">Jednotka</th><th className="px-2 py-1.5 w-8"></th></tr></thead>
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
      <button onClick={add} className="mt-1.5 text-xs text-teal-700 hover:text-teal-900 flex items-center gap-1"><Plus size={12} /> Přidat surovinu</button>
    </div>
  );
}

function ProductModal({ product, existingReceipts, existingIssues, onClose, onSave }) {
  const [f, setF] = useState({ ...EMPTY_PRODUCT, ...product, receptura: product.receptura || [] });
  return (
    <ModalShell title={"Upravit produkt - " + productLabel(product)} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Značka / název" value={f.znacka} onChange={(v) => setF({ ...f, znacka: v })} />
        <SelectField label="Linka" value={f.linka} onChange={(v) => setF({ ...f, linka: v })} options={PRODUCTION_LINKY.map((l) => ({ value: l.value, label: l.label }))} />
      </div>
      <div className="grid grid-cols-3 gap-x-3">
        <Field label="Gramáž" value={f.gramaz} onChange={(v) => setF({ ...f, gramaz: v })} />
        <Field label="Ks v kartonu" value={f.ksVKartone} onChange={(v) => setF({ ...f, ksVKartone: v })} />
        <Field label="Kartonů na paletě" value={f.kartonovNaPalete} onChange={(v) => setF({ ...f, kartonovNaPalete: v })} />
      </div>
      <div className="text-xs text-slate-400 mb-3 -mt-2">
        Ks na paletě (dopočteno): {(parseFloat(f.ksVKartone) > 0 && parseFloat(f.kartonovNaPalete) > 0)
          ? Math.round(parseFloat(f.ksVKartone) * parseFloat(f.kartonovNaPalete))
          : "doplňte Ks v kartonu a Kartonů na paletě"}
      </div>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Naše artiklové číslo (SNC)" value={f.cisloArtiklu} onChange={(v) => setF({ ...f, cisloArtiklu: v })} />
        <Field label="Artiklové číslo Stenger Waffeln (Sage 100)" value={f.cisloArtikluSW} onChange={(v) => setF({ ...f, cisloArtikluSW: v })} />
      </div>
      <Field label="Obsah balení (inhlt, pro Lieferschein)" value={f.inhlt} onChange={(v) => setF({ ...f, inhlt: v })} textarea placeholder="např. 20 x 75 g Beutel, 1 PLT= 16 KRT" />
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="EAN karton" value={f.eanKarton} onChange={(v) => setF({ ...f, eanKarton: v })} />
        <Field label="EAN kus" value={f.eanUnit} onChange={(v) => setF({ ...f, eanUnit: v })} />
      </div>
      <ToggleField label="Obsahuje palmový olej (RSPO)" value={f.rspo} onChange={(v) => setF({ ...f, rspo: v })} yesLabel="Ano" noLabel="Ne" />
      <RecipeTable receptura={f.receptura} setReceptura={(r) => setF({ ...f, receptura: r })} existingReceipts={existingReceipts} existingIssues={existingIssues} />
      <div className="flex justify-end mt-2"><button onClick={() => onSave(f)} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Uložit</button></div>
    </ModalShell>
  );
}

/* ---------------- Pracovnici vo vyrobe ---------------- */

const WORKER_TYPY = [
  { value: "vyroba", label: "Vyroba" },
  { value: "sklad", label: "Sklad" },
  { value: "office", label: "Office" },
];

function WorkersView({ workers, onSave }) {
  const [meno, setMeno] = useState("");
  const [typ, setTyp] = useState("vyroba");
  const [zaskok, setZaskok] = useState(false);
  const [formError, setFormError] = useState("");

  function add() {
    if (!meno.trim()) { setFormError("Vyplňte jméno pracovníka."); return; }
    setFormError("");
    onSave([...workers, { id: uid(), meno: meno.trim(), typ, zaskok }]);
    setMeno("");
    setZaskok(false);
  }
  function remove(id) { onSave(workers.filter((w) => w.id !== id)); }
  function changeTyp(id, next) {
    onSave(workers.map((w) => (w.id === id ? { ...w, typ: next } : w)));
  }
  function toggleZaskok(id) {
    onSave(workers.map((w) => (w.id === id ? { ...w, zaskok: !w.zaskok } : w)));
  }
  async function resetPin(w) {
    if (!window.confirm(`Zresetovat PIN pro "${w.meno}"? Při dalším ťuknutí na tabletu si zvolí nový.`)) return;
    await supabase.rpc("dochadzka_reset_worker_pin", { p_worker_id: w.id });
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Pracovníci</h1>
      <p className="text-xs text-slate-400 mb-4">Tento seznam slouží k označení, kdo zapsal dávku na tabletu ve Výrobě nebo na Skladu (nejsou to přihlašovací účty - každý tablet používá jeden sdílený login, lidé si tam jen "odkliknou" své jméno). Typ určuje, na kterém tabletu se dané jméno nabízí k výběru ("Office" se na žádném tabletu nenabízí, slouží jen k evidenci). Každý s typem "Vyroba" se automaticky zobrazí i v appce Plán směn (plánování směn) - jména/přidávání/mazání se spravuje jen tady, appka si je jen načte. "Zástup" schová jméno na tabletu za tlačítko "+ zástup", aby nezabíralo místo mezi lidmi, co tam pracují běžně - stále jde vybrat, jen na jedno ťuknutí navíc.</p>
      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
        <div className="flex gap-2 items-end flex-wrap">
          <label className="flex-1 min-w-[220px]"><span className="block text-xs font-medium text-slate-500 mb-1">Jméno pracovníka</span><input value={meno} onChange={(e) => setMeno(e.target.value)} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" /></label>
          <label><span className="block text-xs font-medium text-slate-500 mb-1">Typ</span>
            <select value={typ} onChange={(e) => setTyp(e.target.value)} className="border border-slate-200 rounded-md px-2.5 py-1.5 text-sm">
              {WORKER_TYPY.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 pb-1.5">
            <input type="checkbox" checked={zaskok} onChange={(e) => setZaskok(e.target.checked)} />
            <span className="text-xs font-medium text-slate-500">Zástup</span>
          </label>
          <button onClick={add} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md flex items-center gap-1.5"><Plus size={16} /> Přidat</button>
        </div>
        {formError && <div className="mt-2 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={14} /> {formError}</div>}
      </div>
      {workers.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500">Zatím žádný pracovník.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-100 text-slate-600 text-left"><th className="px-3 py-2 font-medium">Jméno</th><th className="px-3 py-2 font-medium">Typ</th><th className="px-3 py-2 font-medium">Zástup</th><th className="px-3 py-2"></th></tr></thead>
            <tbody>
              {workers.map((w) => (
                <tr key={w.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{w.meno}</td>
                  <td className="px-3 py-2">
                    <select value={w.typ || "vyroba"} onChange={(e) => changeTyp(w.id, e.target.value)} className="border border-slate-200 rounded-md px-2 py-1 text-xs">
                      {WORKER_TYPY.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={!!w.zaskok} onChange={() => toggleZaskok(w.id)} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {(w.typ === "vyroba" || w.typ === "sklad") && (
                      <IconButton title="Resetovat PIN pro docházku" onClick={() => resetPin(w)}><KeyRound size={16} /></IconButton>
                    )}
                    <IconButton title="Smazat" onClick={() => remove(w.id)}><Trash2 size={16} /></IconButton>
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

/* ---------------- Audit log ---------------- */

const AUDIT_ENTITY_LABELS = {
  orders: "Objednávka",
  production_plan: "Výrobní plán",
  stock_issues: "Výdej ze skladu",
  goods_receipts: "Příjem zboží",
  products: "Produkt",
  customers: "Zákazník",
  suppliers: "Dodavatel",
};

const AUDIT_ACTION_LABELS = {
  insert: { text: "Vytvořeno", cls: "bg-emerald-100 text-emerald-700" },
  update: { text: "Upraveno", cls: "bg-amber-100 text-amber-800" },
  delete: { text: "Smazáno", cls: "bg-red-100 text-red-700" },
};

function auditRecordLabel(val) {
  if (!val || !val.data) return "";
  const d = val.data;
  return d.produktNazov || d.zakaznik || d.nazov || d.meno || d.popis || "";
}

function auditDiff(oldVal, newVal) {
  const before = (oldVal && oldVal.data) || {};
  const after = (newVal && newVal.data) || {};
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  return keys
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => ({ key: k, before: before[k], after: after[k] }));
}

function auditValueText(v) {
  if (v === undefined) return "-";
  if (v === null || v === "") return "(prázdné)";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function AuditLogView() {
  const [rows, setRows] = useState([]);
  const [names, setNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterEntity, setFilterEntity] = useState("vsetko");
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [logRes, profilesRes] = await Promise.all([
        supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(300),
        supabase.from("profiles").select("id, full_name"),
      ]);
      if (cancelled) return;
      if (logRes.error) {
        setError("Nepodařilo se načíst audit log.");
      } else {
        setRows(logRes.data || []);
      }
      if (!profilesRes.error) {
        setNames(Object.fromEntries((profilesRes.data || []).map((p) => [p.id, p.full_name])));
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = filterEntity === "vsetko" ? rows : rows.filter((r) => r.entity === filterEntity);

  if (loading) {
    return <div className="text-center text-slate-400 py-10"><Loader2 className="animate-spin mx-auto mb-2" size={24} /> Načítám...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-xl font-semibold">Audit log</h1>
        <select value={filterEntity} onChange={(e) => setFilterEntity(e.target.value)} className="border border-slate-200 rounded-md px-2.5 py-1.5 text-sm">
          <option value="vsetko">Všechny entity</option>
          {Object.entries(AUDIT_ENTITY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </div>
      <p className="text-xs text-slate-400 mb-4 max-w-2xl">
        Kdo, co a kdy změnil v klíčových tabulkách (objednávky, výroba, sklad, produkty, zákazníci, dodavatelé). Zapisuje se automaticky na úrovni databáze, nedá se to obejít ani smazat. Historie je vidět jen od zavedení audit logu, ne zpětně.
      </p>
      {error && <div className="mb-3 bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={16} /> {error}</div>}
      {filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-slate-400 text-sm">Zatím žádné zaznamenané změny.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-left">
                <th className="px-3 py-2 font-medium whitespace-nowrap">Datum a čas</th>
                <th className="px-3 py-2 font-medium">Entita</th>
                <th className="px-3 py-2 font-medium">Akce</th>
                <th className="px-3 py-2 font-medium">Záznam</th>
                <th className="px-3 py-2 font-medium">Kdo</th>
                <th className="px-3 py-2 font-medium">Zdroj</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const action = AUDIT_ACTION_LABELS[r.action] || { text: r.action, cls: "bg-slate-100 text-slate-600" };
                const label = auditRecordLabel(r.new_value) || auditRecordLabel(r.old_value);
                const who = r.changed_by ? (names[r.changed_by] || "Neznámý uživatel") : "Automatizace";
                const expanded = expandedId === r.id;
                const diff = r.action === "update" ? auditDiff(r.old_value, r.new_value) : [];
                return (
                  <React.Fragment key={r.id}>
                    <tr className="border-t border-slate-100 cursor-pointer hover:bg-slate-50" onClick={() => setExpandedId(expanded ? null : r.id)}>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-500">{formatDateTime(r.created_at)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{AUDIT_ENTITY_LABELS[r.entity] || r.entity}</td>
                      <td className="px-3 py-2"><span className={"text-xs font-bold px-2 py-0.5 rounded-full " + action.cls}>{action.text}</span></td>
                      <td className="px-3 py-2">{label || <span className="text-slate-400">{r.entity_id}</span>}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-500">{who}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-500">{r.source === "automation" ? "Automatizace" : "Uživatel"}</td>
                      <td className="px-3 py-2 text-right text-slate-400">{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</td>
                    </tr>
                    {expanded && (
                      <tr className="bg-slate-50">
                        <td colSpan={7} className="px-3 py-2">
                          {r.action === "update" ? (
                            diff.length === 0 ? (
                              <div className="text-xs text-slate-400 py-1">Žádná změněná pole (jen dotyk data).</div>
                            ) : (
                              <div className="space-y-1">
                                {diff.map((d) => (
                                  <div key={d.key} className="text-xs bg-white border border-slate-200 rounded-md px-3 py-1.5">
                                    <span className="font-semibold">{d.key}</span>: {auditValueText(d.before)} → <span className="text-teal-700 font-medium">{auditValueText(d.after)}</span>
                                  </div>
                                ))}
                              </div>
                            )
                          ) : (
                            <div className="text-xs text-slate-500 py-1">
                              {r.action === "insert" ? "Vytvořený záznam" : "Smazaný záznam"}: <span className="font-mono">{r.entity_id}</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
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
      "Číslo dopravy": o.cisloObjednavkyDopravy,
      "Dodavatel": o.dodavatel,
      "Adresa vyzvednutí": o.adresaVyzdvihnutia,
      "Popis materiálu": o.popisMaterialu,
      "Množství": o.mnozstvo,
      "Termín dodání": o.terminDodaniaNeurcity ? "Bude upřesněn" : o.terminDodania,
      "Způsob dopravy": (SPOSOB_DOPRAVY_OPTIONS.find((s) => s.value === o.sposobDopravy) || {}).label || "Objednáváme dopravu",
      "Datum vyzvednutí": o.sposobDopravy === "dodavatel" ? "" : (o.vyzdvihnutieNeurcite ? "Bude upřesněno" : o.datumVyzdvihnutia),
      "Dopravce": (carriers.find((c) => c.id === o.dopravcaId) || {}).nazov || "",
      "Název místa dodání": o.sposobDopravy === "vyzdvihnutie" ? "" : o.adresaDodaniaNazov,
      "Adresa dodania": o.sposobDopravy === "vyzdvihnutie" ? "" : o.adresaDodania,
      "Stav objednávky": o.stavObjednavky || "Neodoslana",
      "Stav dopravy": o.stavDopravy,
      "Poznámka": o.poznamka,
    }));
    await exportRowsToExcel(rows, "Objednávky surovin", "Objednavky_surovin_a_obalov");
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Objednávky surovin a obalů</h1>
        <div className="flex gap-2">
          <button onClick={exportToExcel} disabled={materialOrders.length === 0} title={materialOrders.length === 0 ? "Seznam je prázdný" : "Exportovat do Excelu"} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-sm font-medium px-3 py-2 rounded-md">
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
          Zatím žádné objednávky surovin/obalů.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-left">
                <th className="px-3 py-2 font-medium whitespace-nowrap">Číslo dopravy</th>
                <th className="px-3 py-2 font-medium">Dodavatel / adresa vyzvednutí</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">Termín dodání</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">Vyzdvihnutie</th>
                <th className="px-3 py-2 font-medium">Objednávka</th>
                <th className="px-3 py-2 font-medium">Doprava</th>
                <th className="px-3 py-2 font-medium text-right">Akce</th>
              </tr>
            </thead>
            <tbody>
              {materialOrders.map((o) => {
                const carrierMissing = carriers.length === 0;
                const supplier = suppliers.find((s) => s.id === o.dodavatelId);
                const supplierEmailMissing = !supplier || !(supplier.email || defaultEmailFor(supplier));
                return (
                  <tr key={o.id} onClick={() => onEdit(o)} className="border-t-2 border-slate-300 hover:brightness-95 cursor-pointer">
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{o.cisloObjednavkyDopravy}</td>
                    <td className="px-3 py-2">
                      <div>{o.dodavatel || <span className="text-slate-400">-</span>}</div>
                      <div className="text-xs text-slate-400">{o.adresaVyzdvihnutia}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {o.terminDodaniaNeurcity ? <span className="text-slate-500">Bude upřesněn</span> : (o.terminDodania || <span className="text-slate-400">-</span>)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {o.sposobDopravy === "dodavatel" ? (
                        <span className="text-slate-500">Dodavatel doručuje sám</span>
                      ) : o.vyzdvihnutieNeurcite ? (
                        <span className="text-slate-500">Bude upřesněno</span>
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
                          title={supplierEmailMissing ? "Doplňte e-mail dodavatele" : o.objednavkaOdoslanaInfo ? "Odesláno " + formatDateTime(o.objednavkaOdoslanaInfo.datum) : "Objednávka dodavateli"}
                          disabled={supplierEmailMissing}
                          sent={!!o.objednavkaOdoslanaInfo}
                          onClick={() => onSendSupplier(o)}
                        >
                          <Mail size={16} />
                        </IconButton>
                        <IconButton
                          title={o.sposobDopravy === "dodavatel" ? "Dodavatel doručuje zboží sám - doprava se neobjednává" : o.sposobDopravy === "vyzdvihnutie" ? "Osobní odběr - doprava se neobjednává" : carrierMissing ? "Nejprve přidejte dopravce v Nastavení" : o.dopravaOdoslanaInfo ? "Odesláno " + formatDateTime(o.dopravaOdoslanaInfo.datum) : "Objednávka dopravy"}
                          disabled={o.sposobDopravy !== "doprava" || carrierMissing}
                          sent={!!o.dopravaOdoslanaInfo}
                          onClick={() => onSend(o)}
                        >
                          <Truck size={16} />
                        </IconButton>
                        <IconButton title="Upravit" onClick={() => onEdit(o)}><Pencil size={16} /></IconButton>
                        <IconButton title="Smazat" onClick={() => setConfirmDelete(o)}><Trash2 size={16} /></IconButton>
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
        <ModalShell title="Smazat objednávku?" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-slate-600 mb-4">
            Opravdu chcete smazat objednávku <b>{confirmDelete.cisloObjednavkyDopravy}</b>
            {confirmDelete.dodavatel ? " (" + confirmDelete.dodavatel + ")" : ""}? Tuto akciu nie je mozne vratit spat.
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDelete(null)} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
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
  const [catalogSearch, setCatalogSearch] = useState("");
  const filteredTovary = catalogSearch.trim()
    ? supplierTovary.filter((t) => (t.popis || "").toLowerCase().includes(catalogSearch.trim().toLowerCase()))
    : supplierTovary;

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
      <span className="block text-xs font-medium text-slate-500 mb-1">Položky objednávky</span>
      {supplierTovary.length > 0 && (
        <>
          {supplierTovary.length > 8 && (
            <input
              value={catalogSearch}
              onChange={(e) => setCatalogSearch(e.target.value)}
              placeholder="Hledat v katalogu dodavatele..."
              className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-xs mb-1.5"
            />
          )}
          {filteredTovary.length === 0 ? (
            <div className="text-xs text-slate-400 mb-2">Nic nenalezeno.</div>
          ) : (
            <div className="mb-2 flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
              {filteredTovary.map((t, i) => (
                <button key={i} type="button" onClick={() => addFromCatalog(t)} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded-md">
                  + {t.popis}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {items.length > 0 && (
        <div className="border border-slate-200 rounded-md overflow-hidden mb-1.5">
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-100 text-slate-600 text-left"><th className="px-2 py-1.5">Popis</th><th className="px-2 py-1.5 w-24">Artikl</th><th className="px-2 py-1.5 w-16">Množství</th><th className="px-2 py-1.5 w-24">Jednotka</th><th className="px-2 py-1.5 w-8"></th></tr></thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-1 py-1"><input value={it.popis} onChange={(e) => update(i, "popis", e.target.value)} className="w-full border border-slate-200 rounded px-1.5 py-1" /></td>
                  <td className="px-1 py-1"><input value={it.artikel} onChange={(e) => update(i, "artikel", e.target.value)} className="w-full border border-slate-200 rounded px-1.5 py-1" /></td>
                  <td className="px-1 py-1"><input value={it.mnozstvoCislo !== undefined ? it.mnozstvoCislo : ""} onChange={(e) => updateMnozstvo(i, e.target.value, it.mnozstvoJednotka || "ks")} inputMode="decimal" placeholder="např. 2" className="w-full border border-slate-200 rounded px-1.5 py-1" /></td>
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
      <button onClick={addCustom} className="text-xs text-teal-700 hover:text-teal-900 flex items-center gap-1"><Plus size={12} /> Přidat vlastní položku</button>
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
    <ModalShell title={order ? "Upravit objednávku - " + order.cisloObjednavkyDopravy : "Nová objednávka surovin/obalů"} onClose={onClose} wide>
      <SelectField
        label="Dodavatel"
        value={f.dodavatelId}
        onChange={pickSupplier}
        options={[{ value: "", label: "-- vyberte / doplním ručně --" }, ...suppliers.map((s) => ({ value: s.id, label: s.nazov }))]}
      />
      <Field label="Název dodavatele (zobrazení)" value={f.dodavatel} onChange={(v) => setF({ ...f, dodavatel: v })} />

      <SegmentedField label="Způsob doručení" value={f.sposobDopravy} onChange={pickSposobDopravy} options={SPOSOB_DOPRAVY_OPTIONS} />

      {f.sposobDopravy !== "dodavatel" && (
        <Field label="Adresa vyzvednutí (u dodavatele)" value={f.adresaVyzdvihnutia} onChange={(v) => setF({ ...f, adresaVyzdvihnutia: v })} textarea />
      )}

      <MaterialOrderItemsTable items={f.polozky} setItems={(items) => setF({ ...f, polozky: items })} supplierTovary={supplierTovary} />
      <Field label="Popis materiálu / obalového materiálu (shrnutí, nepovinné, pokud jsou vyplněné položky)" value={f.popisMaterialu} onChange={(v) => setF({ ...f, popisMaterialu: v })} textarea />
      <Field label="Množství (shrnutí)" value={f.mnozstvo} onChange={(v) => setF({ ...f, mnozstvo: v })} />

      {f.sposobDopravy !== "vyzdvihnutie" && (
        <>
          <Field label="Název místa dodání (firma)" value={f.adresaDodaniaNazov} onChange={(v) => setF({ ...f, adresaDodaniaNazov: v })} />
          <div className="mb-1 flex flex-wrap gap-1.5">
            {COMPANY_DELIVERY_ADDRESSES.map((a) => (
              <button key={a} type="button" onClick={() => setF({ ...f, adresaDodania: a })} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded-md">{a}</button>
            ))}
          </div>
          <Field label="Adresa dodání (kam má dodavatel/dopravce zboží přivézt)" value={f.adresaDodania} onChange={(v) => setF({ ...f, adresaDodania: v })} textarea />
        </>
      )}

      <ToggleField label="Termín dodání od dodavatele" value={f.terminDodaniaNeurcity} onChange={(v) => setF({ ...f, terminDodaniaNeurcity: v })} yesLabel="Bude upřesněn dodavatelem" noLabel="Zadat datum" />
      {!f.terminDodaniaNeurcity && (
        <DateField label="Termín dodání" value={f.terminDodania} onChange={(v) => setF({ ...f, terminDodania: v })} />
      )}

      {f.sposobDopravy !== "dodavatel" && (
        <>
          <ToggleField label="Termín vyzvednutí" value={f.vyzdvihnutieNeurcite} onChange={(v) => setF({ ...f, vyzdvihnutieNeurcite: v })} yesLabel="Bude upřesněn" noLabel="Zadat datum" />
          {!f.vyzdvihnutieNeurcite && (
            <div className="grid grid-cols-2 gap-x-3">
              <DateField label="Datum vyzvednutí" value={f.datumVyzdvihnutia} onChange={(v) => setF({ ...f, datumVyzdvihnutia: v })} />
              <Field label="Čas vyzvednutí" value={f.casVyzdvihnutia} onChange={(v) => setF({ ...f, casVyzdvihnutia: v })} />
            </div>
          )}
        </>
      )}

      <Field label="Poznámka" value={f.poznamka} onChange={(v) => setF({ ...f, poznamka: v })} textarea />
      <div className="flex justify-end mt-2"><button onClick={() => onSave(f)} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Uložit</button></div>
    </ModalShell>
  );
}

function MaterialTransportModal({ order, carriers, suppliers, company, currentUserName, onClose, onSent, onUpdateCarrierEmails }) {
  const last = order.dopravaOdoslanaInfo;
  const [carrierId, setCarrierId] = useState(order.dopravcaId || defaultCarrierId(carriers));
  const carrier = carriers.find((c) => c.id === carrierId);
  const supplier = (suppliers || []).find((s) => s.id === order.dodavatelId);
  const materialTypStr = materialTypText(supplier ? supplier.typ : null, MATERIAL_ORDER_EMAIL_I18N.sk);
  const [to, setTo] = useState(last ? last.to : defaultEmailFor(carrier));
  const [manageEmails, setManageEmails] = useState(false);
  function pickCarrier(id) {
    const c = carriers.find((x) => x.id === id);
    setCarrierId(id);
    if (!last) {
      setTo(defaultEmailFor(c));
      const oldGreeting = `Dobrý den${carrier ? " " + carrier.nazov : ""},`;
      const newGreeting = `Dobrý den${c ? " " + c.nazov : ""},`;
      setBody((prev) => prev.replace(oldGreeting, newGreeting));
    }
  }
  const [subject, setSubject] = useState(last ? last.subject : `Objednávka přepravy č. ${order.cisloObjednavkyDopravy}`);
  const [body, setBody] = useState(
    last ? last.body :
    `Dobrý den${carrier ? " " + carrier.nazov : ""},\n\n` +
    `objednáváme přepravu ${materialTypStr} (objednávka č. ${order.cisloObjednavkyDopravy}).\n\n` +
    `VYZVEDNUTÍ:\n${order.dodavatel || "[dodavatel]"}\n${order.adresaVyzdvihnutia || ""}\n` +
    `Datum: ${order.vyzdvihnutieNeurcite ? "bude upřesněn" : (order.datumVyzdvihnutia || "[doplňte]")}${!order.vyzdvihnutieNeurcite && order.casVyzdvihnutia ? " čas: " + order.casVyzdvihnutia : ""}\n\n` +
    `ZBOŽÍ:\n${materialOrderItemsText(order)}\n\n` +
    `VYKLÁDKA:\n${order.adresaDodaniaNazov || company.nazov || ""}\n${order.adresaDodania || company.adresa || ""}\n\n` +
    (order.poznamka ? `Poznámka: ${order.poznamka}\n\n` : "") +
    `Děkujeme a těšíme se na spolupráci.\n\n` +
    `S pozdravem,\n${currentUserName || company.kontaktnaOsoba || ""}\n${company.nazov || ""}\n` +
    `${company.ico ? "IČ: " + company.ico + (company.dic ? "  DIČ: " + company.dic : "") + "\n" : ""}` +
    `${[company.email, company.tel].filter(Boolean).join("  ")}`
  );

  return (
    <ModalShell title={"Objednávka dopravy - " + order.cisloObjednavkyDopravy} onClose={onClose} extraWide>
      {last && <div className="mb-3 bg-emerald-50 text-emerald-800 text-xs px-3 py-2 rounded-md flex items-center gap-2"><CheckCircle2 size={14} /> Naposledy odesláno {formatDateTime(last.datum)} na {last.to}</div>}
      <SelectField label="Dopravce" value={carrierId} onChange={pickCarrier} options={carriers.map((c) => ({ value: c.id, label: `${c.nazov} (${c.email})` }))} />
      <div className="mb-2">
        <EmailQuickPicks emaily={generalPlusPurposeEmails(carrier)} value={to} onPick={setTo} />
        {carrier && (
          <button type="button" onClick={() => setManageEmails((v) => !v)} className="text-xs text-teal-700 hover:underline">
            {manageEmails ? "Skrýt správu e-mailů dopravce" : "Spravovat e-maily dopravce"}
          </button>
        )}
        {manageEmails && carrier && (
          <div className="mt-2 border border-slate-200 rounded-md p-2 bg-slate-50">
            <EmailListEditor emaily={carrier.emaily} onChange={(list) => onUpdateCarrierEmails(carrier.id, list)} />
          </div>
        )}
      </div>
      <Field label="E-mail (komu)" value={to} onChange={setTo} type="email" />
      <Field label="Předmět" value={subject} onChange={setSubject} />
      <Field label="Text zprávy" value={body} onChange={setBody} textarea rows={18} />
      <div className="flex justify-end gap-2 mt-2">
        <button onClick={onClose} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
        <a href={to ? buildMailto(to, subject, body) : "#"} onClick={() => to && onSent(carrierId, { subject, body, to, datum: new Date().toISOString() })} className={"bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5 " + (!to ? "opacity-50 pointer-events-none" : "")}>
          <Truck size={16} /> Odeslat dopravci
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
  const [to, setTo] = useState(last ? last.to : defaultEmailFor(supplier));
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
      {last && <div className="mb-3 bg-emerald-50 text-emerald-800 text-xs px-3 py-2 rounded-md flex items-center gap-2"><CheckCircle2 size={14} /> Naposledy odesláno {formatDateTime(last.datum)} na {last.to}</div>}
      {supplier && supplier.jazyk && supplier.jazyk !== "sk" && (
        <div className="mb-3 bg-amber-50 text-amber-800 text-xs px-3 py-2 rounded-md flex items-center gap-2">
          <AlertCircle size={14} /> Dodavatel ma nastaveny jazyk komunikacie: {(MATERIAL_JAZYK_OPTIONS.find((o) => o.value === supplier.jazyk) || {}).label}. Text nizsie je predvyplneny v tomto jazyku.
        </div>
      )}
      <EmailQuickPicks emaily={generalPlusPurposeEmails(supplier)} value={to} onPick={setTo} />
      <Field label="E-mail (komu)" value={to} onChange={setTo} type="email" />
      <Field label="Předmět" value={subject} onChange={setSubject} />
      <Field label="Text zprávy" value={body} onChange={setBody} textarea rows={18} />
      <div className="flex justify-end gap-2 mt-2">
        <button onClick={onClose} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
        <a href={to ? buildMailto(to, subject, body) : "#"} onClick={() => to && onSent({ subject, body, to, datum: new Date().toISOString() })} className={"bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5 " + (!to ? "opacity-50 pointer-events-none" : "")}>
          <Mail size={16} /> Odeslat dodavateli
        </a>
      </div>
    </ModalShell>
  );
}

/* ---------------- Faktura - dodatocne ocenenie prijmov tovaru ---------------- */

function InvoiceUploadModal({ receipts, company, suppliers, onClose, onApply, onAddToSupplierCatalog }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [extracted, setExtracted] = useState(null);
  const [matches, setMatches] = useState([]);
  const [kurz, setKurz] = useState(null);
  const [catalogSupplierId, setCatalogSupplierId] = useState("");
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogDone, setCatalogDone] = useState(false);
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
      const dLower = (data.dodavatel || "").trim().toLowerCase();
      const guessed = dLower
        ? (suppliers || []).find((s) => {
            const n = (s.nazov || "").trim().toLowerCase();
            return n && (n.includes(dLower) || dLower.includes(n));
          })
        : null;
      setCatalogSupplierId(guessed ? guessed.id : "");
      setCatalogDone(false);
    } catch (err) {
      console.error(err);
      setError(err.message || "Extrakce se nezdařila, zkuste to znovu.");
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
      if (!updates.length) throw new Error("Nevybrali jste žádnou shodu s příjmem zboží.");
      await onApply(updates);
      onClose();
    } catch (err) {
      console.error(err);
      setError(err.message || "Uložení se nezdařilo, zkuste to znovu.");
    }
    setBusy(false);
  }

  return (
    <ModalShell title="Nahrát fakturu" onClose={onClose} extraWide>
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
            <button onClick={onClose} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
            <button onClick={handleExtract} disabled={!file || busy} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />} {busy ? "Zpracovávám..." : "Extrahovat"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="bg-slate-50 rounded-md px-3 py-2 mb-3 text-sm">
            <div><b>Dodavatel:</b> {extracted.dodavatel || "-"}</div>
            <div><b>Číslo faktury:</b> {extracted.cisloFaktury || "-"}</div>
            <div><b>Datum:</b> {extracted.datumFaktury || "-"}</div>
            <div><b>Mena:</b> {extracted.mena}{kurz && extracted.mena !== "CZK" && ` - kurz ČNB ${kurz.rate} CZK/${extracted.mena} (platný pro ${kurz.validFor})`}</div>
          </div>
          <div className="bg-slate-50 rounded-md px-3 py-2 mb-3">
            <div className="text-xs font-medium text-slate-600 mb-1.5">Doplnit tyto položky do katalogu dodavatele (pro příště rychlejší výběr v Příjmu/Zásobách/Reklamacích)</div>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={catalogSupplierId}
                onChange={(e) => { setCatalogSupplierId(e.target.value); setCatalogDone(false); }}
                className="border border-slate-200 rounded-md px-2 py-1.5 text-sm"
              >
                <option value="">-- vyberte dodavatele --</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.nazov}</option>)}
              </select>
              <button
                type="button"
                disabled={!catalogSupplierId || catalogBusy}
                onClick={async () => {
                  setCatalogBusy(true);
                  await onAddToSupplierCatalog(catalogSupplierId, matches.map((m) => m.item.popis));
                  setCatalogBusy(false);
                  setCatalogDone(true);
                }}
                className="text-xs bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 font-medium px-3 py-1.5 rounded-md flex items-center gap-1.5"
              >
                {catalogBusy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Doplnit do katalogu
              </button>
              {catalogDone && <span className="text-xs text-emerald-700 flex items-center gap-1"><CheckCircle2 size={14} /> Hotovo</span>}
            </div>
          </div>
          {unpricedReceipts.length === 0 && (
            <div className="mb-3 bg-amber-50 text-amber-800 text-xs px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={14} /> Nenašel se žádný příjem zboží bez ceny k napárování. Zkontrolujte, zda je příjem už v systému zapsán.</div>
          )}
          <div className="border border-slate-200 rounded-md overflow-hidden mb-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-600 text-left">
                  <th className="px-2 py-1.5">Položka na faktuře</th>
                  <th className="px-2 py-1.5 w-24">Množství</th>
                  <th className="px-2 py-1.5 w-24">Cena/j.</th>
                  <th className="px-2 py-1.5 w-64">Napárovat na příjem zboží</th>
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
                          <optgroup label="Navrhovaná shoda">
                            {m.suggestions.map((r) => (
                              <option key={r.id} value={r.id}>{r.material} - {r.mnozstvo} - {r.datumPrijatia} ({r.dodavatel})</option>
                            ))}
                          </optgroup>
                        )}
                        <optgroup label="Všechny neoceněné příjmy">
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
            <button onClick={onClose} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
            <button onClick={handleApply} disabled={busy} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} {busy ? "Ukládám..." : "Uložit ceny"}
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
      "Datum přijetí": r.datumPrijatia,
      "Čas přijetí": r.casPrijatia,
      "Dodavatel": r.dodavatel,
      "Číslo objednávky": r.materialObjednavkaCislo,
      "Materiál": r.material,
      "Množství": r.mnozstvo,
      "Cena/j. (Kč)": r.cenaJednotkovaCzk || "",
      "Číslo faktury": r.fakturaCislo || "",
      "Stav": r.stavPrevzatia,
      "Převzal": r.prevzal,
      "Počáteční stav": r.pociatocnyStav ? "Ano" : "Nie",
    }));
    await exportRowsToExcel(rows, "Příjem zboží", "Prijem_tovaru");
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Příjem zboží na skladě</h1>
        <div className="flex gap-2">
          <button onClick={exportToExcel} disabled={receipts.length === 0} title={receipts.length === 0 ? "Seznam je prázdný" : "Exportovat do Excelu"} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-sm font-medium px-3 py-2 rounded-md">
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
          Zatím žádné záznamy o příjmu zboží.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-left">
                <th className="px-3 py-2 font-medium whitespace-nowrap">Přijato</th>
                <th className="px-3 py-2 font-medium">Dodavatel</th>
                <th className="px-3 py-2 font-medium">Materiál / množství</th>
                <th className="px-3 py-2 font-medium">Stav</th>
                <th className="px-3 py-2 font-medium">Převzal</th>
                <th className="px-3 py-2 font-medium text-right">Akce</th>
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
                    {r.pociatocnyStav && <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">Počáteční stav</span>}
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
                        <IconButton title={`Faktura ${r.fakturaCislo || ""} - cena ${r.cenaJednotkovaCzk} Kč/j.`} sent onClick={() => openInvoiceFile(r.fakturaPath)}>
                          <FileSpreadsheet size={16} />
                        </IconButton>
                      )}
                      <IconButton title="Upravit" onClick={() => onEdit(r)}><Pencil size={16} /></IconButton>
                      <IconButton title="Smazat" onClick={() => setConfirmDelete(r)}><Trash2 size={16} /></IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {confirmDelete && (
        <ModalShell title="Smazat záznam?" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-slate-600 mb-4">Opravdu chcete smazat tento záznam o příjmu zboží? Tuto akci nelze vrátit zpět.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDelete(null)} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
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
  const materialPicks = materialPicksForSupplier(f.dodavatelId, suppliers, MATERIAL_QUICK_PICKS);

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
      console.error(err);
      setPhotoError("Nahrání fotky se nezdařilo, zkuste to znovu.");
    }
    setPhotoUploading(false);
    if (e.target) e.target.value = "";
  }

  return (
    <ModalShell title={receipt ? "Upravit příjem" : "Nový příjem zboží"} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-x-3">
        <DateField label="Datum přijetí" value={f.datumPrijatia} onChange={(v) => setF({ ...f, datumPrijatia: v })} />
        <Field label="Čas přijetí" value={f.casPrijatia} onChange={(v) => setF({ ...f, casPrijatia: v })} />
      </div>
      <SelectField
        label="Dodavatel"
        value={f.dodavatelId}
        onChange={pickSupplier}
        options={[{ value: "", label: "-- vyberte / doplním ručně --" }, ...suppliers.map((s) => ({ value: s.id, label: s.nazov }))]}
      />
      <Field label="Název dodavatele (zobrazení)" value={f.dodavatel} onChange={(v) => setF({ ...f, dodavatel: v })} />
      {materialOrders.length > 0 && (
        <SelectField
          label="Související objednávka (Objednávky surovin a obalů) - nepovinné"
          value={f.materialObjednavkaId}
          onChange={pickMaterialOrder}
          options={[{ value: "", label: "-- žádná --" }, ...materialOrders.map((o) => ({ value: o.id, label: `${o.cisloObjednavkyDopravy} - ${o.dodavatel || ""}` }))]}
        />
      )}
      <label className="block mb-3">
        <span className="block text-xs font-medium text-slate-500 mb-1">Materiál / položka</span>
        <input
          list="goods-receipt-material-picks"
          value={f.material}
          onChange={(e) => setF({ ...f, material: e.target.value })}
          className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
        />
        <datalist id="goods-receipt-material-picks">
          {materialPicks.map((m) => <option key={m} value={m} />)}
        </datalist>
      </label>
      <div className="mb-3">
        <span className="block text-xs font-medium text-slate-500 mb-1">Množství</span>
        <div className="flex gap-2 items-center flex-wrap">
          <input
            value={f.mnozstvoCislo !== undefined && f.mnozstvoCislo !== "" ? f.mnozstvoCislo : ""}
            onChange={(e) => {
              const num = e.target.value;
              setF({ ...f, mnozstvoCislo: num, mnozstvo: [num, f.mnozstvoJednotka].filter(Boolean).join(" ").trim() });
            }}
            inputMode="decimal"
            placeholder="např. 20"
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
      <Field label="Číslo dodacího listu / faktury od dodavatele" value={f.cisloDokladu} onChange={(v) => setF({ ...f, cisloDokladu: v })} />
      <SelectField
        label="Stav při převzetí"
        value={f.stavPrevzatia}
        onChange={(v) => setF({ ...f, stavPrevzatia: v })}
        options={[
          { value: "V poriadku", label: "V poriadku" },
          { value: "Poskodene", label: "Poskodene" },
          { value: "Nekompletne", label: "Nekompletne" },
        ]}
      />
      <Field label="Poznámka" value={f.poznamka} onChange={(v) => setF({ ...f, poznamka: v })} textarea />
      <Field label="Převzal" value={f.prevzal} onChange={(v) => setF({ ...f, prevzal: v })} />
      <div className="mb-3">
        <span className="block text-xs font-medium text-slate-500 mb-1">Fotka (nepovinne)</span>
        <div className="flex items-center gap-2 flex-wrap">
          {f.photoPath && (
            <button type="button" onClick={() => openGoodsReceiptPhoto(f.photoPath)} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1.5 rounded-md flex items-center gap-1"><Camera size={12} /> Zobrazit fotku</button>
          )}
          <label className="text-xs bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-2.5 py-1.5 rounded-md cursor-pointer flex items-center gap-1">
            {photoUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            {f.photoPath ? "Nahradit fotku" : "Nahrát fotku"}
            <input type="file" accept="image/*" className="hidden" onChange={handlePhotoSelect} disabled={photoUploading} />
          </label>
        </div>
        {photoError && <div className="mt-1 text-xs text-red-700">{photoError}</div>}
      </div>
      <div className="flex justify-end mt-2"><button onClick={() => onSave({ ...f, id: formId })} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Uložit</button></div>
    </ModalShell>
  );
}

/* ---------------- Stav zasob ---------------- */

function formatCzk(n) {
  return Math.round(n).toLocaleString("sk-SK") + " Kč";
}

function StockView({ goodsReceipts, stockIssues, onNew, onNewTestProduction, onEdit, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(null);
  const stock = computeStockLevels(goodsReceipts, stockIssues);
  const celkovaHodnota = stock.reduce((sum, row) => sum + (row.hodnota || 0), 0);
  const pocetNeocenenych = stock.reduce((sum, row) => sum + row.neocenenePrijmy, 0);

  async function exportToExcel() {
    const stockRows = stock.map((row) => ({
      "Materiál": row.material,
      "Přijato": row.prijate,
      "Vydáno": row.vydane,
      "Aktuální stav": row.stav,
      "Jednotka": row.unit,
      "Průměrná cena (Kč)": row.priemernaCena !== null ? Math.round(row.priemernaCena * 100) / 100 : "",
      "Hodnota (Kč)": row.hodnota !== null ? Math.round(row.hodnota) : "",
      "Neoceněné příjmy": row.neocenenePrijmy,
    }));
    const issueRows = stockIssues.map((i) => ({
      "Datum": i.datum,
      "Čas": i.cas,
      "Materiál": i.material,
      "Množství": i.mnozstvo,
      "Důvod": i.dovod,
      "Zapsal": i.zapisal,
      "Nad stav": i.prekroceniePotvrdene ? "Ano" : "Nie",
    }));
    await exportSheetsToExcel(
      [
        { name: "Stav zásob", rows: stockRows },
        { name: "Poslední výdeje", rows: issueRows },
      ],
      "Stav_zasob"
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Stav zásob</h1>
        <div className="flex gap-2">
          <button onClick={exportToExcel} disabled={stock.length === 0 && stockIssues.length === 0} title={stock.length === 0 && stockIssues.length === 0 ? "Seznam je prázdný" : "Exportovat do Excelu"} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-sm font-medium px-3 py-2 rounded-md">
            <Download size={16} /> Export do Excelu
          </button>
          <button onClick={onNewTestProduction} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-3 py-2 rounded-md">
            <FlaskConical size={16} /> Testovací výroba
          </button>
          <button onClick={onNew} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md">
            <MinusCircle size={16} /> Zapisat vydaj
          </button>
        </div>
      </div>

      {stock.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-slate-500 mb-6">
          <Warehouse size={28} className="mx-auto mb-3 text-slate-300" />
          Zatím žádná data o zásobách.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto mb-6">
          <div className="flex items-center justify-between px-3 py-2.5 bg-slate-50 border-b border-slate-200 flex-wrap gap-2">
            <span className="text-sm text-slate-600">Celková hodnota skladu: <b className="text-slate-900">{formatCzk(celkovaHodnota)}</b></span>
            {pocetNeocenenych > 0 && (
              <span className="text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded-md flex items-center gap-1"><AlertCircle size={12} /> {pocetNeocenenych} prijem(ov) caka na fakturu - hodnota je neuplna</span>
            )}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-left">
                <th className="px-3 py-2 font-medium">Materiál</th>
                <th className="px-3 py-2 font-medium text-right">Přijato</th>
                <th className="px-3 py-2 font-medium text-right">Vydáno</th>
                <th className="px-3 py-2 font-medium text-right">Aktuální stav</th>
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

      <h2 className="text-sm font-semibold text-slate-500 mb-2">Poslední výdeje</h2>
      {stockIssues.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm">Zatím žádné záznamy.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-left">
                <th className="px-3 py-2 font-medium">Datum</th>
                <th className="px-3 py-2 font-medium">Materiál</th>
                <th className="px-3 py-2 font-medium">Množství</th>
                <th className="px-3 py-2 font-medium">Důvod</th>
                <th className="px-3 py-2 font-medium">Zapsal</th>
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
                    <IconButton title="Smazat" onClick={() => setConfirmDelete(i)}><Trash2 size={16} /></IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmDelete && (
        <ModalShell title="Smazat výdej?" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-slate-600 mb-4">Opravdu chcete smazat tento záznam o výdeji materiálu? Tuto akci nelze vrátit zpět.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDelete(null)} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
            <button onClick={() => { onDelete(confirmDelete.id); setConfirmDelete(null); }} className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5">
              <Trash2 size={16} /> Ano, zmazat
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

function StockIssueFormModal({ issue, suppliers, currentUserName, onClose, onSave }) {
  const [formId] = useState(() => (issue && issue.id) || uid());
  const [f, setF] = useState({
    ...EMPTY_STOCK_ISSUE,
    datum: todayStr(),
    zapisal: currentUserName || "",
    ...issue,
  });
  const materialPicks = allKnownMaterials(suppliers, MATERIAL_QUICK_PICKS);

  return (
    <ModalShell title={issue ? "Upravit výdej" : "Nový výdej materiálu"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-x-3">
        <DateField label="Datum" value={f.datum} onChange={(v) => setF({ ...f, datum: v })} />
        <Field label="Čas" value={f.cas} onChange={(v) => setF({ ...f, cas: v })} />
      </div>
      <label className="block mb-3">
        <span className="block text-xs font-medium text-slate-500 mb-1">Materiál / položka</span>
        <input
          list="stock-issue-material-picks"
          value={f.material}
          onChange={(e) => setF({ ...f, material: e.target.value })}
          className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
        />
        <datalist id="stock-issue-material-picks">
          {materialPicks.map((m) => <option key={m} value={m} />)}
        </datalist>
      </label>
      <div className="mb-3">
        <span className="block text-xs font-medium text-slate-500 mb-1">Množství</span>
        <div className="flex gap-2 items-center flex-wrap">
          <input
            value={f.mnozstvoCislo !== undefined && f.mnozstvoCislo !== "" ? f.mnozstvoCislo : ""}
            onChange={(e) => {
              const num = e.target.value;
              setF({ ...f, mnozstvoCislo: num, mnozstvo: [num, f.mnozstvoJednotka].filter(Boolean).join(" ").trim() });
            }}
            inputMode="decimal"
            placeholder="např. 20"
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
        label="Důvod"
        value={f.dovod}
        onChange={(v) => setF({ ...f, dovod: v })}
        options={STOCK_ISSUE_REASONS.map((d) => ({ value: d, label: d }))}
      />
      <Field label="Poznámka" value={f.poznamka} onChange={(v) => setF({ ...f, poznamka: v })} textarea />
      <Field label="Zapsal" value={f.zapisal} onChange={(v) => setF({ ...f, zapisal: v })} />
      <div className="flex justify-end mt-2"><button onClick={() => onSave({ ...f, id: formId })} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Uložit</button></div>
    </ModalShell>
  );
}

function TestProductionIssueModal({ suppliers, currentUserName, onClose, onSaveBatch }) {
  const [datum, setDatum] = useState(todayStr());
  const [nazovTestu, setNazovTestu] = useState("");
  const [zapisal, setZapisal] = useState(currentUserName || "");
  const [lines, setLines] = useState([{ material: "", mnozstvoCislo: "", mnozstvoJednotka: "ks" }]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const materialPicks = allKnownMaterials(suppliers, MATERIAL_QUICK_PICKS);

  function updateLine(i, patch) {
    setLines((prev) => prev.map((l, li) => (li === i ? { ...l, ...patch } : l)));
  }
  function addLine() { setLines((prev) => [...prev, { material: "", mnozstvoCislo: "", mnozstvoJednotka: "ks" }]); }
  function removeLine(i) { setLines((prev) => prev.filter((_, li) => li !== i)); }

  async function save() {
    const valid = lines.filter((l) => l.material.trim() && l.mnozstvoCislo);
    if (!valid.length) { setError("Vyplňte alespoň jeden materiál a množství."); return; }
    setError("");
    setBusy(true);
    const poznamka = nazovTestu.trim() ? `Testovací výroba: ${nazovTestu.trim()}` : "Testovací výroba";
    await onSaveBatch(valid.map((l) => ({
      datum,
      material: l.material.trim(),
      mnozstvoCislo: l.mnozstvoCislo,
      mnozstvoJednotka: l.mnozstvoJednotka,
      mnozstvo: [l.mnozstvoCislo, l.mnozstvoJednotka].filter(Boolean).join(" ").trim(),
      dovod: "Testovanie/vzorky",
      poznamka,
      zapisal,
    })));
    setBusy(false);
  }

  return (
    <ModalShell title="Testovací výroba - výdej materiálu" onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-x-3">
        <DateField label="Datum" value={datum} onChange={setDatum} />
        <Field label="Zapsal" value={zapisal} onChange={setZapisal} />
      </div>
      <Field label="Název testu / příchutě (nepovinné)" value={nazovTestu} onChange={setNazovTestu} />

      <div className="mb-2">
        <span className="block text-xs font-medium text-slate-500 mb-1">Materiály a obaly</span>
        <datalist id="test-production-material-picks">
          {materialPicks.map((m) => <option key={m} value={m} />)}
        </datalist>
        {lines.map((l, i) => (
          <div key={i} className="mb-2 border border-slate-100 rounded-md p-2">
            <div className="flex gap-2 items-center flex-wrap">
              <input list="test-production-material-picks" value={l.material} onChange={(e) => updateLine(i, { material: e.target.value })} placeholder="Materiál / položka" className="flex-1 min-w-[160px] border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
              <input value={l.mnozstvoCislo} onChange={(e) => updateLine(i, { mnozstvoCislo: e.target.value })} inputMode="decimal" placeholder="množství" className="w-24 border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
              <select value={l.mnozstvoJednotka} onChange={(e) => updateLine(i, { mnozstvoJednotka: e.target.value })} className="border border-slate-200 rounded-md px-2.5 py-1.5 text-sm">
                {UNIT_QUICK_PICKS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
              {lines.length > 1 && (
                <IconButton title="Odebrat řádek" onClick={() => removeLine(i)}><Trash2 size={16} /></IconButton>
              )}
            </div>
          </div>
        ))}
        <button type="button" onClick={addLine} className="text-xs text-teal-700 hover:text-teal-900 flex items-center gap-1"><Plus size={14} /> Přidat další materiál/obal</button>
      </div>

      {error && <div className="mb-3 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={14} /> {error}</div>}
      <div className="flex justify-end mt-2">
        <button onClick={save} disabled={busy} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-md">
          {busy ? "Ukládám..." : "Uložit výdej"}
        </button>
      </div>
    </ModalShell>
  );
}

/* ---------------- Vyrobny plan ---------------- */

function ProductionPlanView({ productionPlan, products, goodsReceipts, stockIssues, productionOutputs, prestavky, pauzy, dochadzkaNastavenia, ccpKontroly, workers, onNew, onEdit, onDelete, onDeleteOutput, onEditOutput, onDeletePrestavka, onUpdatePrestavka, onDeletePauza, onUpdatePauza, onUpdateDochadzkaNastavenia }) {
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmDeleteOutput, setConfirmDeleteOutput] = useState(null);
  const [confirmDeletePrestavka, setConfirmDeletePrestavka] = useState(null);
  const [editingPrestavka, setEditingPrestavka] = useState(null);
  const [confirmDeletePauza, setConfirmDeletePauza] = useState(null);
  const [editingPauza, setEditingPauza] = useState(null);
  const [showDochadzkaNastavenia, setShowDochadzkaNastavenia] = useState(false);
  const [filterLinka, setFilterLinka] = useState("vsetko");
  const [tab, setTab] = useState("plan");
  const [showOlderPlan, setShowOlderPlan] = useState(false);
  const [showOlderOutputs, setShowOlderOutputs] = useState(false);
  const [dochazkaMode, setDochazkaMode] = useState("prichod");
  const [dochazkaView, setDochazkaView] = useState("mesic");
  const [dochazkaMesic, setDochazkaMesic] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [expandedMeno, setExpandedMeno] = useState(null);

  // Zobrazuje sa len od vcerajska (aby sa nemuselo scrollovat cez tyzdne historie), buducnost
  // vzdy cela viditelna. Starsie zaznamy sa schovaju pod "Zobrazit starší" - export ostava
  // nezmeneny, vzdy exportuje uplne vsetko bez ohladu na tento filter.
  const dnesCutoff = new Date();
  dnesCutoff.setHours(0, 0, 0, 0);
  dnesCutoff.setDate(dnesCutoff.getDate() - 1);
  function jeStarsie(datumStr) {
    const d = parseSkDate(datumStr);
    return d ? d < dnesCutoff : false;
  }

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
    .sort((a, b) => {
      const aHotovo = (a.stavVyroby || "caka") === "hotovo" ? 1 : 0;
      const bHotovo = (b.stavVyroby || "caka") === "hotovo" ? 1 : 0;
      if (aHotovo !== bHotovo) return aHotovo - bHotovo;
      return (parseSkDate(a.datum) || 0) - (parseSkDate(b.datum) || 0);
    });
  const recentRows = rows.filter((r) => !jeStarsie(r.datum));
  const olderRows = rows.filter((r) => jeStarsie(r.datum));
  const recentOutputs = (productionOutputs || []).filter((o) => !jeStarsie(o.datum));
  const olderOutputs = (productionOutputs || []).filter((o) => jeStarsie(o.datum));

  async function exportOutputsToExcel() {
    const exportRows = (productionOutputs || []).map((o) => ({
      "Datum": o.datum,
      "Čas": o.cas,
      "Linka": (PRODUCTION_LINKY.find((l) => l.value === o.linka) || {}).label || o.linka,
      "Produkt": o.produktNazov,
      "Množství (palet)": o.mnozstvo,
      "Šarže": o.sarza,
      "Zapsala": o.zapisala,
    }));
    await exportRowsToExcel(exportRows, "Výrobní záznamy", "Vyrobne_zaznamy", 16);
  }

  function prestavkaHours(p) {
    const mins = durationMinutes(p.casZaciatku, p.casKonca);
    return mins === null ? 0 : mins / 60;
  }
  function jeChybajuciOdchod(p) {
    return !p.casKonca && p.datum !== todayStr();
  }
  function jeVMesiaci(datumStr, mesic) {
    const d = parseSkDate(datumStr);
    if (!d) return false;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` === mesic;
  }

  const vsetkyChybajuce = (prestavky || []).filter(jeChybajuciOdchod);
  const mesicPrestavky = (prestavky || []).filter((p) => jeVMesiaci(p.datum, dochazkaMesic));
  const dochadzkoveMena = Array.from(new Set([
    ...(workers || []).filter((w) => w.typ === "vyroba" || w.typ === "sklad").map((w) => w.meno),
    ...mesicPrestavky.map((p) => p.meno),
  ])).sort((a, b) => a.localeCompare(b));
  const workersByMeno = Object.fromEntries((workers || []).map((w) => [w.meno, w]));
  const dochadzkaVypocet = summarizeMonth(mesicPrestavky, pauzy, workersByMeno, dochadzkaNastavenia);
  const mesicSummary = dochadzkoveMena.map((meno) => {
    const zaznamy = mesicPrestavky.filter((p) => p.meno === meno).slice().sort((a, b) => (parseSkDate(a.datum) || 0) - (parseSkDate(b.datum) || 0));
    const v = dochadzkaVypocet[meno] || { celkemHod: 0, nocHod: 0, vikendHod: 0, sviatokHod: 0, prescasHod: 0 };
    return {
      meno,
      zaznamy,
      dni: new Set(zaznamy.map((p) => p.datum)).size,
      hodiny: v.celkemHod,
      nocHodiny: v.nocHod,
      vikendHodiny: v.vikendHod,
      sviatokHodiny: v.sviatokHod,
      prescasHodiny: v.prescasHod,
      chybajuce: zaznamy.filter(jeChybajuciOdchod).length,
    };
  }).filter((s) => s.zaznamy.length > 0 || dochazkaView === "mesic");

  const pauzyChybajuce = (pauzy || []).filter(jeChybajuciOdchod);
  const mesicPauzy = (pauzy || []).filter((p) => jeVMesiaci(p.datum, dochazkaMesic));
  const pauzoveMena = Array.from(new Set([
    ...(workers || []).filter((w) => w.typ === "vyroba" || w.typ === "sklad").map((w) => w.meno),
    ...mesicPauzy.map((p) => p.meno),
  ])).sort((a, b) => a.localeCompare(b));
  const pauzySummary = pauzoveMena.map((meno) => {
    const zaznamy = mesicPauzy.filter((p) => p.meno === meno).slice().sort((a, b) => (parseSkDate(a.datum) || 0) - (parseSkDate(b.datum) || 0));
    return {
      meno,
      zaznamy,
      dni: new Set(zaznamy.map((p) => p.datum)).size,
      hodiny: zaznamy.reduce((s, p) => s + prestavkaHours(p), 0),
      chybajuce: zaznamy.filter(jeChybajuciOdchod).length,
    };
  }).filter((s) => s.zaznamy.length > 0 || dochazkaView === "mesic");

  async function exportDochazkaToExcel() {
    const dennyRows = mesicPrestavky.slice().sort((a, b) => (parseSkDate(a.datum) || 0) - (parseSkDate(b.datum) || 0)).map((p) => ({
      "Jméno": p.meno,
      "Datum": p.datum,
      "Příchod": p.casZaciatku,
      "Odchod": p.casKonca || "",
      "Hodiny": p.casKonca ? Math.round(prestavkaHours(p) * 100) / 100 : "",
    }));
    const summaryRows = mesicSummary.map((s) => ({
      "Jméno": s.meno,
      "Počet dní": s.dni,
      "Celkem hodin": Math.round(s.hodiny * 100) / 100,
      "Noční hodiny": Math.round(s.nocHodiny * 100) / 100,
      "Víkendové hodiny": Math.round(s.vikendHodiny * 100) / 100,
      "Sváteční hodiny": Math.round(s.sviatokHodiny * 100) / 100,
      "Přesčas (nad 160h)": Math.round(s.prescasHodiny * 100) / 100,
      "Chybějící odchod": s.chybajuce,
    }));
    const pauzyRows = mesicPauzy.slice().sort((a, b) => (parseSkDate(a.datum) || 0) - (parseSkDate(b.datum) || 0)).map((p) => ({
      "Jméno": p.meno,
      "Datum": p.datum,
      "Začátek": p.casZaciatku,
      "Konec": p.casKonca || "",
      "Hodiny": p.casKonca ? Math.round(prestavkaHours(p) * 100) / 100 : "",
    }));
    await exportSheetsToExcel(
      [
        { name: "Docházka", rows: dennyRows, colWidth: 16 },
        { name: "Přestávky", rows: pauzyRows, colWidth: 16 },
        { name: "Souhrn", rows: summaryRows, colWidth: 16 },
      ],
      "Dochazka_" + dochazkaMesic
    );
  }

  async function exportCcpToExcel() {
    const exportRows = (ccpKontroly || [])
      .slice()
      .sort((a, b) => (b.datum + b.cas).localeCompare(a.datum + a.cas))
      .map((c) => ({
        "Datum": c.datum,
        "Čas": c.cas,
        "Typ kontroly": c.typ === "zaciatok_zmeny" ? "Začátek směny" : "Změna produktu",
        "Směna": c.smena === "den" ? "Denní" : c.smena === "noc" ? "Noční" : "",
        "Linka": (PRODUCTION_LINKY.find((l) => l.value === c.linka) || {}).label || c.linka || "",
        "Produkt": c.produktNazov || "",
        "Fe": (c.fe || "").toUpperCase(),
        "NonFe": (c.nonFe || "").toUpperCase(),
        "S/S": (c.ss || "").toUpperCase(),
        "Výsledek": c.vysledek === "neshoda" ? "NESHODA" : "OK",
        "Nápravné opatření": c.naprava || "",
        "Zkontrolovala": c.zkontrolovala,
      }));
    await exportRowsToExcel(exportRows, "CCP kontroly", "CCP_kontroly", 16);
  }

  async function exportPlanToExcel() {
    const exportRows = rows.map((r) => ({
      "Datum": r.datum,
      "Produkt": r.produktNazov,
      "Linka": (PRODUCTION_LINKY.find((l) => l.value === r.linka) || {}).label || r.linka,
      "Množství": r.mnozstvo,
      "Jednotka": r.mnozstvoJednotka === "kartonů" ? "kartonů" : "paliet",
      "Termín dodání": r.terminDodania,
      "Poznámka": r.poznamka,
    }));
    await exportRowsToExcel(exportRows, "Výrobní plán", "Vyrobny_plan", 16);
  }

  const printBody = rows
    .map((r) => `${r.datum}  ${r.produktNazov}  -  ${r.mnozstvo} ${r.mnozstvoJednotka === "kartonov" ? "kartonů" : "palet"}${r.poznamka ? "  (" + r.poznamka + ")" : ""}${r.terminDodania ? "  [termín: " + r.terminDodania + "]" : ""}`)
    .join("\n");

  function handlePrint() {
    setTimeout(() => window.print(), 50);
  }

  function renderPlanRow(r) {
    const shortages = shortagesFor(r);
    const zmenaAktivna = isPlanZmenaActive(r);
    const zmenaText = formatZmenaText(r);
    const jeHotovo = r.stavVyroby === "hotovo";
    return (
      <tr key={r.id} className={"border-t border-slate-100 " + (zmenaAktivna ? "bg-red-50" : jeHotovo ? "bg-emerald-50" : "")}>
        <td className="px-3 py-2 whitespace-nowrap">{r.datum}</td>
        <td className="px-3 py-2 font-medium">
          {r.produktNazov}
          {shortages.length > 0 && <AlertCircle size={14} className="inline-block ml-1.5 text-red-500 align-text-bottom" />}
          {zmenaAktivna && (
            <div className="text-xs font-normal text-red-600 mt-0.5">
              <span className="font-bold">Změněno:</span> {zmenaText}
            </div>
          )}
        </td>
        <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.mnozstvo} {r.mnozstvoJednotka === "kartonů" ? "kartonů" : "paliet"}</td>
        <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.terminDodania}</td>
        <td className="px-3 py-2 text-slate-500">{r.poznamka}</td>
        <td className="px-3 py-2"><Badge text={VYROBA_STATUS_LABELS[r.stavVyroby] || VYROBA_STATUS_LABELS.caka} map={STATUS_VYROBY} /></td>
        <td className="px-3 py-2 text-right">
          <div className="flex justify-end gap-1">
            <IconButton title="Upravit" onClick={() => onEdit(r)}><Pencil size={16} /></IconButton>
            <IconButton title="Smazat" onClick={() => setConfirmDelete(r)}><Trash2 size={16} /></IconButton>
          </div>
        </td>
      </tr>
    );
  }

  function renderOutputRow(o) {
    return (
      <tr key={o.id} className="border-t border-slate-100">
        <td className="px-3 py-2 whitespace-nowrap">{o.datum} {o.cas}</td>
        <td className="px-3 py-2 font-medium">
          {o.produktNazov}
          {o.pociatocnyStav && <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">Počáteční stav</span>}
        </td>
        <td className="px-3 py-2 text-slate-500">{o.mnozstvo} paliet</td>
        <td className="px-3 py-2 text-slate-500">{o.sarza}</td>
        <td className="px-3 py-2 text-slate-500">{o.zapisala}</td>
        <td className="px-3 py-2 text-right">
          <div className="flex justify-end gap-1">
            <IconButton title="Upravit" onClick={() => onEditOutput(o)}><Pencil size={16} /></IconButton>
            <IconButton title="Smazat" onClick={() => setConfirmDeleteOutput(o)}><Trash2 size={16} /></IconButton>
          </div>
        </td>
      </tr>
    );
  }

  const aktualnePrestavky = (prestavky || []).filter((p) => !p.casKonca);
  const PLAN_TAB_COLORS = {
    plan: "bg-rose-600 border-rose-600 shadow-rose-200",
    "záznamy": "bg-teal-600 border-teal-600 shadow-teal-200",
    prestavky: "bg-amber-600 border-amber-600 shadow-amber-200",
    ccp: "bg-indigo-600 border-indigo-600 shadow-indigo-200",
  };
  const PLAN_TABS = [
    { key: "plan", label: "Výrobní plán", icon: <ClipboardCheck size={18} /> },
    { key: "záznamy", label: "Výrobní záznamy", icon: <Factory size={18} /> },
    { key: "prestavky", label: "Docházka", icon: <Coffee size={18} />, badge: aktualnePrestavky.length || null },
    { key: "ccp", label: "CCP kontroly", icon: <ClipboardCheck size={18} /> },
  ];

  return (
    <div>
      <PrintDocument id="production-plan-print" title="Výrobní plán" subtitle="Stenger Czech s.r.o." body={printBody || "Žádné záznamy."} fontSize="15px" lineHeight={1.7} />
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-xl font-semibold">Vyroba</h1>
      </div>

      <div className="flex justify-center gap-3 mb-6">
        {PLAN_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              "flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold border-2 transition-all duration-150 " +
              (tab === t.key
                ? PLAN_TAB_COLORS[t.key] + " text-white shadow-lg -translate-y-0.5"
                : "bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-700")
            }
          >
            <span className={"flex items-center justify-center w-8 h-8 rounded-lg " + (tab === t.key ? "bg-white/20" : "bg-slate-100")}>
              {t.icon}
            </span>
            {t.label}
            {t.badge ? (
              <span className={"text-xs font-bold px-1.5 py-0.5 rounded-full " + (tab === t.key ? "bg-white text-slate-900" : "bg-amber-100 text-amber-700")}>{t.badge}</span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === "plan" && (
      <>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex gap-1.5 flex-wrap">
          {[{ value: "vsetko", label: "Vše" }, ...PRODUCTION_LINKY].map((l) => (
            <button key={l.value} onClick={() => setFilterLinka(l.value)} className={"text-sm px-3 py-1.5 rounded-md border " + (filterLinka === l.value ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>{l.label}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={exportPlanToExcel} disabled={rows.length === 0} title={rows.length === 0 ? "Plán je prázdný" : "Exportovat výrobní plán do Excelu"} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-sm font-medium px-3 py-2 rounded-md">
            <Download size={16} /> Export do Excelu
          </button>
          <button onClick={handlePrint} className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-3 py-2 rounded-md flex items-center gap-1.5"><Printer size={16} /> Tisknout</button>
          <button onClick={onNew} className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md">
            <Plus size={16} /> Nový záznam
          </button>
        </div>
      </div>

      {recentRows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-slate-500">
          <ClipboardCheck size={28} className="mx-auto mb-3 text-slate-300" />
          Zatím žádné aktuální záznamy výrobního plánu.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-left">
                <th className="px-3 py-2 font-medium">Datum</th>
                <th className="px-3 py-2 font-medium">Produkt</th>
                <th className="px-3 py-2 font-medium">Množství</th>
                <th className="px-3 py-2 font-medium">Termín dodání</th>
                <th className="px-3 py-2 font-medium">Poznámka</th>
                <th className="px-3 py-2 font-medium">Stav výroby</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {recentRows.map(renderPlanRow)}
            </tbody>
          </table>
        </div>
      )}

      {olderRows.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setShowOlderPlan((v) => !v)} className="text-xs text-slate-500 hover:text-slate-700 font-medium flex items-center gap-1">
            {showOlderPlan ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {showOlderPlan ? "Skrýt starší" : "Zobrazit starší"} ({olderRows.length})
          </button>
          {showOlderPlan && (
            <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto mt-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-100 text-slate-600 text-left">
                    <th className="px-3 py-2 font-medium">Datum</th>
                    <th className="px-3 py-2 font-medium">Produkt</th>
                    <th className="px-3 py-2 font-medium">Množství</th>
                    <th className="px-3 py-2 font-medium">Termín dodání</th>
                    <th className="px-3 py-2 font-medium">Poznámka</th>
                    <th className="px-3 py-2 font-medium">Stav výroby</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {olderRows.map(renderPlanRow)}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {confirmDelete && (
        <ModalShell title="Smazat záznam výroby?" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-slate-600 mb-4">Opravdu chcete smazat tento záznam výrobního plánu? Už zapsaný výdej materiálu se tím nezruší.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDelete(null)} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
            <button onClick={() => { onDelete(confirmDelete.id); setConfirmDelete(null); }} className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5">
              <Trash2 size={16} /> Ano, zmazat
            </button>
          </div>
        </ModalShell>
      )}
      </>
      )}

      {tab === "záznamy" && (
      <>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-slate-500">Výrobní záznamy (skutečná výroba)</h2>
        <button onClick={exportOutputsToExcel} className="text-xs text-teal-700 hover:text-teal-900 font-medium flex items-center gap-1"><Download size={14} /> Export do Excelu</button>
      </div>
      {recentOutputs.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm">Zatím žádné aktuální záznamy skutečné výroby.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-left">
                <th className="px-3 py-2 font-medium">Datum</th>
                <th className="px-3 py-2 font-medium">Produkt</th>
                <th className="px-3 py-2 font-medium">Množství</th>
                <th className="px-3 py-2 font-medium">Šarže</th>
                <th className="px-3 py-2 font-medium">Zapsala</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {recentOutputs.map(renderOutputRow)}
            </tbody>
          </table>
        </div>
      )}

      {olderOutputs.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setShowOlderOutputs((v) => !v)} className="text-xs text-slate-500 hover:text-slate-700 font-medium flex items-center gap-1">
            {showOlderOutputs ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {showOlderOutputs ? "Skrýt starší" : "Zobrazit starší"} ({olderOutputs.length})
          </button>
          {showOlderOutputs && (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden mt-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-100 text-slate-600 text-left">
                    <th className="px-3 py-2 font-medium">Datum</th>
                    <th className="px-3 py-2 font-medium">Produkt</th>
                    <th className="px-3 py-2 font-medium">Množství</th>
                    <th className="px-3 py-2 font-medium">Šarže</th>
                    <th className="px-3 py-2 font-medium">Zapsala</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {olderOutputs.map(renderOutputRow)}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {confirmDeleteOutput && (
        <ModalShell title="Smazat výrobní záznam?" onClose={() => setConfirmDeleteOutput(null)}>
          <p className="text-sm text-slate-600 mb-4">Opravdu chcete smazat tento záznam skutečné výroby? Zároveň se zruší i výdeje surovin, které při jeho uložení vznikly (oprava zásob).</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDeleteOutput(null)} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
            <button onClick={() => { onDeleteOutput(confirmDeleteOutput); setConfirmDeleteOutput(null); }} className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5">
              <Trash2 size={16} /> Ano, zmazat
            </button>
          </div>
        </ModalShell>
      )}
      </>
      )}

      {tab === "prestavky" && (
      <>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-slate-500">Docházka</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1.5">
            <button onClick={() => setDochazkaMode("prichod")} className={"text-xs px-2.5 py-1.5 rounded-md border " + (dochazkaMode === "prichod" ? "bg-amber-500 text-white border-amber-500" : "bg-white text-slate-700 border-slate-200")}>Příchod / odchod</button>
            <button onClick={() => setDochazkaMode("pauza")} className={"text-xs px-2.5 py-1.5 rounded-md border " + (dochazkaMode === "pauza" ? "bg-orange-500 text-white border-orange-500" : "bg-white text-slate-700 border-slate-200")}>Přestávky</button>
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => setDochazkaView("mesic")} className={"text-xs px-2.5 py-1.5 rounded-md border " + (dochazkaView === "mesic" ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>Měsíční přehled</button>
            <button onClick={() => setDochazkaView("denni")} className={"text-xs px-2.5 py-1.5 rounded-md border " + (dochazkaView === "denni" ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>Denní seznam</button>
          </div>
          <input type="month" value={dochazkaMesic} onChange={(e) => setDochazkaMesic(e.target.value)} className="text-xs border border-slate-200 rounded-md px-2 py-1.5" />
          <button onClick={exportDochazkaToExcel} disabled={mesicPrestavky.length === 0 && mesicPauzy.length === 0} className="text-xs text-teal-700 hover:text-teal-900 disabled:opacity-50 disabled:cursor-not-allowed font-medium flex items-center gap-1"><Download size={14} /> Export do Excelu</button>
          <IconButton title="Nastavení začátku směny" onClick={() => setShowDochadzkaNastavenia(true)}><Settings size={16} /></IconButton>
        </div>
      </div>

      {dochazkaMode === "prichod" && (
      <>
      {vsetkyChybajuce.length > 0 && (
        <div className="mb-2 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-md">
          <div className="flex items-center gap-2 font-semibold mb-1"><AlertCircle size={14} /> Nedokončené záznamy (chybí odchod):</div>
          <div className="flex flex-wrap gap-1.5">
            {vsetkyChybajuce.map((p) => (
              <button key={p.id} onClick={() => setEditingPrestavka(p)} className="bg-white border border-red-200 hover:bg-red-100 px-2 py-1 rounded-md">
                {p.meno} ({p.datum} {p.casZaciatku})
              </button>
            ))}
          </div>
        </div>
      )}
      {(() => {
        const aktualne = (prestavky || []).filter((p) => !p.casKonca && p.datum === todayStr());
        return aktualne.length > 0 && (
          <div className="mb-2 bg-amber-50 text-amber-800 text-xs px-3 py-2 rounded-md flex items-center gap-2">
            <AlertCircle size={14} /> Právě v práci: {aktualne.map((p) => p.meno).join(", ")}
          </div>
        );
      })()}

      {dochazkaView === "mesic" && mesicSummary.length > 0 && (() => {
        const firemnyPrescas = mesicSummary.reduce((s, r) => s + r.prescasHodiny, 0);
        const firemneChybajuce = mesicSummary.reduce((s, r) => s + r.chybajuce, 0);
        return (
          <div className="mb-2 bg-slate-50 border border-slate-200 text-slate-600 text-xs px-3 py-2 rounded-md flex flex-wrap gap-x-4 gap-y-1">
            <span><span className="font-semibold text-slate-700">{mesicSummary.length}</span> zaměstnanců</span>
            <span>Přesčasy celkem: <span className={"font-semibold " + (firemnyPrescas > 0 ? "text-amber-700" : "text-slate-500")}>{Math.round(firemnyPrescas * 10) / 10} h</span></span>
            <span>Chybějící odchody: <span className={"font-semibold " + (firemneChybajuce > 0 ? "text-red-700" : "text-slate-500")}>{firemneChybajuce}</span></span>
          </div>
        );
      })()}

      {dochazkaView === "mesic" ? (
        mesicSummary.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm">Za tento měsíc zatím žádné záznamy.</div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-100 text-slate-600 text-left">
                  <th className="px-3 py-2 font-medium">Jméno</th>
                  <th className="px-3 py-2 font-medium text-right">Počet dní</th>
                  <th className="px-3 py-2 font-medium text-right">Celkem hodin</th>
                  <th className="px-3 py-2 font-medium text-right">Noc</th>
                  <th className="px-3 py-2 font-medium text-right">Víkend</th>
                  <th className="px-3 py-2 font-medium text-right">Svátek</th>
                  <th className="px-3 py-2 font-medium text-right">Přesčas</th>
                  <th className="px-3 py-2 font-medium text-right">Chybějící odchod</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {mesicSummary.map((s) => (
                  <React.Fragment key={s.meno}>
                    <tr className="border-t border-slate-100 cursor-pointer hover:bg-slate-50" onClick={() => setExpandedMeno(expandedMeno === s.meno ? null : s.meno)}>
                      <td className="px-3 py-2 font-medium flex items-center gap-1.5">
                        {expandedMeno === s.meno ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {s.meno}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500">{s.dni}</td>
                      <td className="px-3 py-2 text-right text-slate-500">{Math.round(s.hodiny * 10) / 10}</td>
                      <td className="px-3 py-2 text-right text-slate-400">{Math.round(s.nocHodiny * 10) / 10}</td>
                      <td className="px-3 py-2 text-right text-slate-400">{Math.round(s.vikendHodiny * 10) / 10}</td>
                      <td className="px-3 py-2 text-right text-slate-400">{Math.round(s.sviatokHodiny * 10) / 10}</td>
                      <td className="px-3 py-2 text-right">
                        {s.prescasHodiny > 0 ? <span className="font-semibold text-amber-700">{Math.round(s.prescasHodiny * 10) / 10}</span> : <span className="text-slate-300">0</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {s.chybajuce > 0 ? <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">{s.chybajuce}</span> : <span className="text-slate-300">0</span>}
                      </td>
                      <td className="px-3 py-2"></td>
                    </tr>
                    {expandedMeno === s.meno && (
                      <tr className="bg-slate-50">
                        <td colSpan={9} className="px-3 py-2">
                          {s.zaznamy.length === 0 ? (
                            <div className="text-xs text-slate-400 py-2">Žádné záznamy v tomto měsíci.</div>
                          ) : (
                            <div className="space-y-1">
                              {(() => {
                                const typ = workersByMeno[s.meno]?.typ;
                                const zaciatokZmeny = typ === "sklad" ? dochadzkaNastavenia?.zaciatokSklad : typ === "vyroba" ? dochadzkaNastavenia?.zaciatokVyroba : null;
                                return s.zaznamy.map((p) => {
                                  const vypocet = computeDayHours(p, pauzy, zaciatokZmeny);
                                  const raw = shiftInterval(p.datum, p.casZaciatku, p.casKonca);
                                  const clamped = raw && clampShiftStart(raw, zaciatokZmeny);
                                  const orezano = raw && clamped && clamped.start.getTime() !== raw.start.getTime();
                                  return (
                                    <div key={p.id} className="flex items-center justify-between bg-white border border-slate-200 rounded-md px-3 py-1.5">
                                      <div className="text-xs text-slate-600">
                                        příchod do budovy {p.casZaciatku} - odchod {p.casKonca || <span className="text-red-600 font-medium">chybí odchod</span>} <span className="text-slate-400">({p.datum})</span>
                                        {vypocet && (
                                          <span className="text-slate-400">
                                            {" "}
                                            - k výplatě {formatMinutes(vypocet.totalMin)}
                                            {orezano && ` (počítáno od ${zaciatokZmeny})`}
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex gap-1">
                                        <IconButton title="Upravit" onClick={() => setEditingPrestavka(p)}><Pencil size={14} /></IconButton>
                                        <IconButton title="Smazat" onClick={() => setConfirmDeletePrestavka(p)}><Trash2 size={14} /></IconButton>
                                      </div>
                                    </div>
                                  );
                                });
                              })()}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (prestavky || []).length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm">Zatím žádné záznamy docházky.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-left">
                <th className="px-3 py-2 font-medium">Jméno</th>
                <th className="px-3 py-2 font-medium">Datum</th>
                <th className="px-3 py-2 font-medium">Příchod</th>
                <th className="px-3 py-2 font-medium">Odchod</th>
                <th className="px-3 py-2 font-medium">Trvání</th>
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
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{p.casKonca || <span className="text-amber-600 font-medium">probíhá</span>}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{mins !== null ? formatMinutes(mins) : "-"}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <IconButton title="Upravit" onClick={() => setEditingPrestavka(p)}><Pencil size={16} /></IconButton>
                        <IconButton title="Smazat" onClick={() => setConfirmDeletePrestavka(p)}><Trash2 size={16} /></IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </>
      )}

      {dochazkaMode === "pauza" && (
      <>
      {pauzyChybajuce.length > 0 && (
        <div className="mb-2 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-md">
          <div className="flex items-center gap-2 font-semibold mb-1"><AlertCircle size={14} /> Nedokončené přestávky (chybí konec):</div>
          <div className="flex flex-wrap gap-1.5">
            {pauzyChybajuce.map((p) => (
              <button key={p.id} onClick={() => setEditingPauza(p)} className="bg-white border border-red-200 hover:bg-red-100 px-2 py-1 rounded-md">
                {p.meno} ({p.datum} {p.casZaciatku})
              </button>
            ))}
          </div>
        </div>
      )}
      {(() => {
        const aktualne = (pauzy || []).filter((p) => !p.casKonca && p.datum === todayStr());
        return aktualne.length > 0 && (
          <div className="mb-2 bg-orange-50 text-orange-800 text-xs px-3 py-2 rounded-md flex items-center gap-2">
            <AlertCircle size={14} /> Právě na přestávce: {aktualne.map((p) => p.meno).join(", ")}
          </div>
        );
      })()}

      {dochazkaView === "mesic" ? (
        pauzySummary.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm">Za tento měsíc zatím žádné přestávky.</div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-100 text-slate-600 text-left">
                  <th className="px-3 py-2 font-medium">Jméno</th>
                  <th className="px-3 py-2 font-medium text-right">Počet dní</th>
                  <th className="px-3 py-2 font-medium text-right">Celkem hodin</th>
                  <th className="px-3 py-2 font-medium text-right">Chybějící konec</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {pauzySummary.map((s) => (
                  <React.Fragment key={s.meno}>
                    <tr className="border-t border-slate-100 cursor-pointer hover:bg-slate-50" onClick={() => setExpandedMeno(expandedMeno === s.meno ? null : s.meno)}>
                      <td className="px-3 py-2 font-medium flex items-center gap-1.5">
                        {expandedMeno === s.meno ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {s.meno}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500">{s.dni}</td>
                      <td className="px-3 py-2 text-right text-slate-500">{Math.round(s.hodiny * 10) / 10}</td>
                      <td className="px-3 py-2 text-right">
                        {s.chybajuce > 0 ? <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">{s.chybajuce}</span> : <span className="text-slate-300">0</span>}
                      </td>
                      <td className="px-3 py-2"></td>
                    </tr>
                    {expandedMeno === s.meno && (
                      <tr className="bg-slate-50">
                        <td colSpan={5} className="px-3 py-2">
                          {s.zaznamy.length === 0 ? (
                            <div className="text-xs text-slate-400 py-2">Žádné přestávky v tomto měsíci.</div>
                          ) : (
                            <div className="space-y-1">
                              {s.zaznamy.map((p) => {
                                const mins = durationMinutes(p.casZaciatku, p.casKonca);
                                return (
                                  <div key={p.id} className="flex items-center justify-between bg-white border border-slate-200 rounded-md px-3 py-1.5">
                                    <div className="text-xs text-slate-600">
                                      {p.datum}: {p.casZaciatku} - {p.casKonca || <span className="text-red-600 font-medium">chybí konec</span>}
                                      {mins !== null && <span className="text-slate-400"> ({formatMinutes(mins)})</span>}
                                    </div>
                                    <div className="flex gap-1">
                                      <IconButton title="Upravit" onClick={() => setEditingPauza(p)}><Pencil size={14} /></IconButton>
                                      <IconButton title="Smazat" onClick={() => setConfirmDeletePauza(p)}><Trash2 size={14} /></IconButton>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (pauzy || []).length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm">Zatím žádné přestávky.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-left">
                <th className="px-3 py-2 font-medium">Jméno</th>
                <th className="px-3 py-2 font-medium">Datum</th>
                <th className="px-3 py-2 font-medium">Začátek</th>
                <th className="px-3 py-2 font-medium">Konec</th>
                <th className="px-3 py-2 font-medium">Trvání</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {pauzy.slice(0, 50).map((p) => {
                const mins = durationMinutes(p.casZaciatku, p.casKonca);
                return (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium">{p.meno}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{p.datum}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{p.casZaciatku}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{p.casKonca || <span className="text-orange-600 font-medium">probíhá</span>}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{mins !== null ? formatMinutes(mins) : "-"}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <IconButton title="Upravit" onClick={() => setEditingPauza(p)}><Pencil size={16} /></IconButton>
                        <IconButton title="Smazat" onClick={() => setConfirmDeletePauza(p)}><Trash2 size={16} /></IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </>
      )}

      {confirmDeletePrestavka && (
        <ModalShell title="Smazat záznam docházky?" onClose={() => setConfirmDeletePrestavka(null)}>
          <p className="text-sm text-slate-600 mb-4">Opravdu chcete smazat záznam docházky pro "{confirmDeletePrestavka.meno}" ({confirmDeletePrestavka.datum})? Tuto akci nelze vrátit zpět.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDeletePrestavka(null)} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
            <button onClick={() => { onDeletePrestavka(confirmDeletePrestavka.id); setConfirmDeletePrestavka(null); }} className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5">
              <Trash2 size={16} /> Ano, zmazat
            </button>
          </div>
        </ModalShell>
      )}
      {editingPrestavka && (
        <PrestavkaEditModal
          prestavka={editingPrestavka}
          onClose={() => setEditingPrestavka(null)}
          onSave={(patch) => { onUpdatePrestavka(editingPrestavka.id, patch); setEditingPrestavka(null); }}
        />
      )}
      {confirmDeletePauza && (
        <ModalShell title="Smazat záznam přestávky?" onClose={() => setConfirmDeletePauza(null)}>
          <p className="text-sm text-slate-600 mb-4">Opravdu chcete smazat záznam přestávky pro "{confirmDeletePauza.meno}" ({confirmDeletePauza.datum})? Tuto akci nelze vrátit zpět.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDeletePauza(null)} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
            <button onClick={() => { onDeletePauza(confirmDeletePauza.id); setConfirmDeletePauza(null); }} className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5">
              <Trash2 size={16} /> Ano, zmazat
            </button>
          </div>
        </ModalShell>
      )}
      {editingPauza && (
        <PrestavkaEditModal
          prestavka={editingPauza}
          title={"Upravit přestávku - " + editingPauza.meno}
          onClose={() => setEditingPauza(null)}
          onSave={(patch) => { onUpdatePauza(editingPauza.id, patch); setEditingPauza(null); }}
        />
      )}
      {showDochadzkaNastavenia && (
        <DochadzkaNastaveniaModal
          nastavenia={dochadzkaNastavenia}
          onClose={() => setShowDochadzkaNastavenia(false)}
          onSave={(next) => { onUpdateDochadzkaNastavenia(next); setShowDochadzkaNastavenia(false); }}
        />
      )}
      </>
      )}

      {tab === "ccp" && (
      <>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-slate-500">CCP kontroly detektoru kovu</h2>
        <button onClick={exportCcpToExcel} disabled={(ccpKontroly || []).length === 0} className="text-xs text-teal-700 hover:text-teal-900 disabled:opacity-50 disabled:cursor-not-allowed font-medium flex items-center gap-1"><Download size={14} /> Export do Excelu</button>
      </div>
      {(ccpKontroly || []).length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm">Zatím žádné CCP kontroly.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-left">
                <th className="px-3 py-2 font-medium whitespace-nowrap">Datum</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">Čas</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">Typ</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">Linka</th>
                <th className="px-3 py-2 font-medium">Produkt</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">Fe / NonFe / S-S</th>
                <th className="px-3 py-2 font-medium">Výsledek</th>
                <th className="px-3 py-2 font-medium">Náprava</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">Zkontrolovala</th>
              </tr>
            </thead>
            <tbody>
              {ccpKontroly.slice().sort((a, b) => (b.datum + b.cas).localeCompare(a.datum + a.cas)).map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 whitespace-nowrap">{c.datum}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-500">{c.cas}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-500">
                    {c.typ === "zaciatok_zmeny" ? `Začátek směny${c.smena ? " (" + (c.smena === "den" ? "denní" : "noční") + ")" : ""}` : "Změna produktu"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-500">{(PRODUCTION_LINKY.find((l) => l.value === c.linka) || {}).label || c.linka || "-"}</td>
                  <td className="px-3 py-2">{c.produktNazov || "-"}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-500">{(c.fe || "").toUpperCase()} / {(c.nonFe || "").toUpperCase()} / {(c.ss || "").toUpperCase()}</td>
                  <td className="px-3 py-2">
                    <span className={"text-xs font-bold px-2 py-0.5 rounded-full " + (c.vysledek === "neshoda" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700")}>
                      {c.vysledek === "neshoda" ? "NESHODA" : "OK"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-500">{c.naprava || "-"}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-500">{c.zkontrolovala}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </>
      )}
    </div>
  );
}

function PrestavkaEditModal({ prestavka, title, onClose, onSave }) {
  const [f, setF] = useState({ datum: prestavka.datum || "", casZaciatku: prestavka.casZaciatku || "", casKonca: prestavka.casKonca || "" });
  const [error, setError] = useState("");

  function save() {
    if (!f.datum.trim()) { setError("Vyplňte datum."); return; }
    if (!f.casZaciatku.trim()) { setError("Vyplňte čas příchodu."); return; }
    setError("");
    onSave({ datum: f.datum.trim(), casZaciatku: f.casZaciatku.trim(), casKonca: f.casKonca.trim() });
  }

  return (
    <ModalShell title={title || "Upravit docházku - " + prestavka.meno} onClose={onClose}>
      <DateField label="Datum" value={f.datum} onChange={(v) => setF({ ...f, datum: v })} />
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Příchod (HH:MM)" value={f.casZaciatku} onChange={(v) => setF({ ...f, casZaciatku: v })} />
        <Field label="Odchod (HH:MM, nepovinné)" value={f.casKonca} onChange={(v) => setF({ ...f, casKonca: v })} />
      </div>
      {error && <div className="mb-3 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={14} /> {error}</div>}
      <div className="flex justify-end mt-2"><button onClick={save} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Uložit</button></div>
    </ModalShell>
  );
}

function DochadzkaNastaveniaModal({ nastavenia, onClose, onSave }) {
  const [f, setF] = useState({ zaciatokVyroba: nastavenia?.zaciatokVyroba || "06:00", zaciatokSklad: nastavenia?.zaciatokSklad || "06:00" });

  function save() {
    const zmeneno = f.zaciatokVyroba !== (nastavenia?.zaciatokVyroba || "06:00") || f.zaciatokSklad !== (nastavenia?.zaciatokSklad || "06:00");
    if (zmeneno && !window.confirm("Změna začátku směny přepočítá i už uzavřené měsíce zpětně (mzdové hodiny se počítají vždy naživo z aktuálního nastavení). Pokud jste už nějaký měsíc odeslali do mezd, jeho čísla se tímto změní. Opravdu pokračovat?")) {
      return;
    }
    onSave(f);
  }

  return (
    <ModalShell title="Nastavení začátku směny" onClose={onClose}>
      <p className="text-xs text-slate-500 mb-3">
        Pokud pracovník ťukne příchod dříve než je zde nastavený začátek směny (max. 4 hodiny předem), do mzdových hodin se počítá až od tohoto času. Platí pouze pro měsíční přehled a export - denní seznam nadále ukazuje přesné ťuknuté časy.
      </p>
      <div className="grid grid-cols-2 gap-x-3">
        <div className="mb-3">
          <label className="block text-xs font-medium text-slate-500 mb-1">Začátek směny - Výroba</label>
          <input type="time" value={f.zaciatokVyroba} onChange={(e) => setF({ ...f, zaciatokVyroba: e.target.value })} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm" />
        </div>
        <div className="mb-3">
          <label className="block text-xs font-medium text-slate-500 mb-1">Začátek směny - Sklad</label>
          <input type="time" value={f.zaciatokSklad} onChange={(e) => setF({ ...f, zaciatokSklad: e.target.value })} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm" />
        </div>
      </div>
      <div className="flex justify-end mt-2"><button onClick={save} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Uložit</button></div>
    </ModalShell>
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
  const [formError, setFormError] = useState("");

  const linkaProducts = products.filter((p) => p.linka === f.linka);
  const selectedProduct = products.find((p) => p.id === f.produktId);

  function save() {
    if (!f.produktId) { setFormError("Vyberte produkt."); return; }
    if (!f.mnozstvo || !f.mnozstvo.toString().trim()) { setFormError("Zadejte množství."); return; }
    setFormError("");
    onSave({ ...f, id: formId });
  }

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
    <ModalShell title={plan ? "Upravit záznam výroby" : "Nový záznam výroby"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-x-3">
        <DateField label="Datum výroby" value={f.datum} onChange={(v) => setF({ ...f, datum: v })} />
        <SelectField label="Linka" value={f.linka} onChange={(v) => setF({ ...f, linka: v, produktId: "", produktNazov: "" })} options={PRODUCTION_LINKY.map((l) => ({ value: l.value, label: l.label }))} />
      </div>
      <SelectField
        label="Produkt"
        value={f.produktId}
        onChange={pickProduct}
        options={[{ value: "", label: "Vyberte produkt..." }, ...linkaProducts.map((p) => ({ value: p.id, label: productLabel(p) }))]}
      />
      <div className="mb-3">
        <span className="block text-xs font-medium text-slate-500 mb-1">Množství</span>
        <div className="flex gap-2 items-center flex-wrap">
          <input
            value={f.mnozstvo}
            onChange={(e) => setF({ ...f, mnozstvo: e.target.value })}
            inputMode="decimal"
            placeholder="např. 30"
            className="w-24 border border-slate-200 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
          <div className="flex gap-1.5">
            {[{ value: "paliet", label: "paliet" }, { value: "kartonů", label: "kartonů" }].map((u) => (
              <button key={u.value} type="button" onClick={() => setF({ ...f, mnozstvoJednotka: u.value })} className={"text-xs px-2.5 py-1.5 rounded-md border " + (f.mnozstvoJednotka === u.value ? "bg-teal-700 text-white border-teal-700" : "bg-white text-slate-700 border-slate-200")}>{u.label}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-3">
        <DateField label="Termín dodání (nepovinné)" value={f.terminDodania} onChange={(v) => setF({ ...f, terminDodania: v })} />
        <Field label="Zapsal" value={f.zapisal} onChange={(v) => setF({ ...f, zapisal: v })} />
      </div>
      <Field label="Poznámka (např. označit GERWISCH, pěkné palety)" value={f.poznamka} onChange={(v) => setF({ ...f, poznamka: v })} textarea />
      {shortages.length > 0 && (
        <div className="mb-3 bg-amber-50 text-amber-800 text-xs px-3 py-2 rounded-md flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span>Mozny nedostatok materialu: {shortages.map((s) => s.material + " (" + s.mnozstvo + ")").join(", ")}</span>
        </div>
      )}
      {formError && <div className="mb-3 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={14} /> {formError}</div>}
      <div className="flex justify-end mt-2"><button onClick={save} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Uložit</button></div>
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
    <ModalShell title="Upravit výrobní záznam" onClose={onClose}>
      <DateField label="Datum výroby" value={f.datum} onChange={(v) => setF({ ...f, datum: v })} />
      <SelectField
        label="Produkt"
        value={f.produktId}
        onChange={pickProduct}
        options={products.map((p) => ({ value: p.id, label: productLabel(p) }))}
      />
      <Field label="Množství (palet)" value={f.mnozstvo} onChange={(v) => setF({ ...f, mnozstvo: parseFloat(String(v).replace(",", ".")) || 0 })} />
      <Field label="Šarže" value={f.sarza} onChange={(v) => setF({ ...f, sarza: v })} />
      <Field label="Zapsala" value={f.zapisala} onChange={(v) => setF({ ...f, zapisala: v })} />
      <p className="text-xs text-amber-600 mb-3">Pri ulozeni sa stare vydaje surovin zrusia a nahradia novymi podla upraveneho mnozstva/produktu.</p>
      <div className="flex justify-end mt-2"><button onClick={() => onSave(f)} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Uložit</button></div>
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
      <h1 className="text-xl font-semibold mb-4">Přehled</h1>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <DashboardCard icon={PackageX} label="Čeká na expedici" value={pendingExpedicia} tone="text-amber-500" onClick={onGoToRegister} />
        <DashboardCard icon={Truck} label="Dnes / zítra dodání" value={dueSoon} tone="text-red-500" onClick={onGoToRegister} />
        <DashboardCard icon={Factory} label="Dnešní výroba (palet)" value={todayVyroba} tone="text-teal-600" onClick={onGoToProduction} />
        <DashboardCard icon={AlertCircle} label="Kritické zásoby" value={criticalStock} tone="text-red-500" onClick={onGoToStock} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h2 className="text-sm font-semibold text-slate-500 mb-2">Nejbližší dodání</h2>
          {upcoming.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm">Žádné nadcházející dodání.</div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              {upcoming.map(({ o }) => (
                <div key={o.id} onClick={onGoToRegister} className="px-4 py-2.5 border-t border-slate-100 first:border-t-0 flex items-center justify-between cursor-pointer hover:bg-slate-50">
                  <div>
                    <div className="font-medium text-sm">{o.adresaDodaniaNazov || "-"}</div>
                    <div className="text-xs text-slate-400">{o.zakaznik}</div>
                  </div>
                  <div className="text-sm text-slate-600 whitespace-nowrap">{o.datumDodania}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="text-sm font-semibold text-slate-500 mb-2">Příjmy s problémem</h2>
          {problemReceipts.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm">Žádné problémy.</div>
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
          <h2 className="text-sm font-semibold text-slate-500">Stav zásob</h2>
          <button onClick={onGoToStock} className="text-xs text-teal-700 hover:text-teal-900 font-medium">Zobrazit vše</button>
        </div>
        {stock.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm">Zatím žádná data.</div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-100 text-slate-600 text-left"><th className="px-3 py-2 font-medium">Materiál</th><th className="px-3 py-2 font-medium text-right">Aktuální stav</th></tr></thead>
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
        <h1 className="text-xl font-semibold mb-4">Nastavení firmy</h1>
        <div className="bg-white border border-slate-200 rounded-lg p-5 max-w-lg">
          <dl className="grid grid-cols-1 gap-y-3 text-sm">
            <CompanyInfoRow label="Název společnosti" value={company.nazov} />
            <CompanyInfoRow label="Adresa (sklad / místo nakládky)" value={company.adresa} pre />
            <CompanyInfoRow label="ICO" value={company.ico} />
            <CompanyInfoRow label="DIC" value={company.dic} />
            <CompanyInfoRow label="Telefon" value={company.tel} />
            <CompanyInfoRow label="Kontaktní osoba" value={company.kontaktnaOsoba} />
            <CompanyInfoRow label="E-mail" value={company.email} />
            <CompanyInfoRow label="Anthropic API klíč" value={company.apiKey ? "•••• (nastaven)" : ""} />
            <CompanyInfoRow label="Poslední použité číslo objednávky" value={company.posledneCisloObjednavky} />
            <CompanyInfoRow label="Poslední použité číslo objednávky dopravy" value={company.posledneCisloDopravy} />
            <CompanyInfoRow label="Poslední použité číslo dodacího listu" value={company.posledneCisloDodaciehoListu} />
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
          {(company.nveEmailyExport || []).length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <div className="text-xs font-medium text-slate-500 mb-1.5">NVE list - preddefinovane emaily (Export mimo Nemecka)</div>
              <div className="space-y-1">
                {company.nveEmailyExport.map((e, i) => (
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
      <h1 className="text-xl font-semibold mb-4">Nastavení firmy</h1>
      <div className="bg-white border border-slate-200 rounded-lg p-5 max-w-lg">
        <Field label="Název společnosti" value={f.nazov} onChange={(v) => setF({ ...f, nazov: v })} />
        <Field label="Adresa (sklad / místo nakládky)" value={f.adresa} onChange={(v) => setF({ ...f, adresa: v })} textarea />
        <Field label="ICO" value={f.ico} onChange={(v) => setF({ ...f, ico: v })} />
        <Field label="DIC" value={f.dic} onChange={(v) => setF({ ...f, dic: v })} />
        <Field label="Telefon" value={f.tel} onChange={(v) => setF({ ...f, tel: v })} />
        <Field label="Kontaktní osoba" value={f.kontaktnaOsoba} onChange={(v) => setF({ ...f, kontaktnaOsoba: v })} />
        <Field label="E-mail" value={f.email} onChange={(v) => setF({ ...f, email: v })} />
        <Field label="Anthropic API klíč (pro AI extrakci z PDF, nepovinné)" value={f.apiKey || ""} onChange={(v) => setF({ ...f, apiKey: v })} type="password" />
        <EmailListEditor
          emaily={f.nveEmaily}
          onChange={(list) => setF({ ...f, nveEmaily: list })}
          caption="NVE list - přednastavené e-maily kolegům do Německa (např. Sklad DE) - při více adresách najednou je oddělte čárkou"
        />
        <EmailListEditor
          emaily={f.nveEmailyExport || []}
          onChange={(list) => setF({ ...f, nveEmailyExport: list })}
          caption="NVE list - přednastavené e-maily pro export mimo Německo - při více adresách najednou je oddělte čárkou"
        />
        <Field label="Poslední použité číslo objednávky (bez tečky/data - jen pořadové číslo)" value={String(f.posledneCisloObjednavky)} onChange={(v) => setF({ ...f, posledneCisloObjednavky: parseInt(v) || 0 })} />
        <div className="grid grid-cols-2 gap-x-3">
          <Field label="Poslední použité číslo objednávky dopravy" value={String(f.posledneCisloDopravy)} onChange={(v) => setF({ ...f, posledneCisloDopravy: parseInt(v) || 0 })} />
          <Field label="Poslední použité číslo dodacího listu" value={String(f.posledneCisloDodaciehoListu)} onChange={(v) => setF({ ...f, posledneCisloDodaciehoListu: parseInt(v) || 0 })} />
        </div>
        <div className="flex gap-2 mt-2">
          <button onClick={handleSave} disabled={saving} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-60">{saving ? "Ukládám..." : "Uložit"}</button>
          {company.nazov && (
            <button onClick={() => { setF(company); setEditing(false); }} className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-md">Zrušit</button>
          )}
        </div>
      </div>
      <p className="text-xs text-slate-400 mt-3 max-w-lg">
        Čísla objednávky dopravy a dodacího listu se při každé nové objednávce automaticky zvýší o 1 a připojí se k nim datum dodání (formát číslo/DDMM). Pokud potřebujete pokračovat v existující řadě čísel, nastavte zde poslední použité číslo.
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
        Ceník zatím není nahrán.
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
              <th className="px-2 py-1.5 whitespace-nowrap">Město</th>
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
      <h2 className="text-sm font-semibold mb-3">Rychlý výpočet ceny dopravy</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4">
        <Field label="Město dodání" value={mesto} onChange={setMesto} />
        <Field label="Počet paletových míst" value={pocet} onChange={setPocet} />
        <ToggleField label="Paletová výměna" value={vymena} onChange={setVymena} yesLabel="Ano" noLabel="Nie" />
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
          <thead><tr className="bg-slate-100 text-slate-600 text-left"><th className="px-3 py-2 font-medium">Soubor</th><th className="px-3 py-2 font-medium">Archivováno</th><th className="px-3 py-2"></th></tr></thead>
          <tbody>
            {pricelistArchive.map((entry) => (
              <tr key={entry.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{entry.file_name || entry.data.fileName || "cennik"}</td>
                <td className="px-3 py-2 text-slate-500">{formatDateTime(entry.archived_at)}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    <IconButton title="Zobrazit" onClick={() => setViewing(entry)}><ClipboardList size={16} /></IconButton>
                    <IconButton title="Obnovit jako aktuální" onClick={() => onRestore(entry)}><CheckCircle2 size={16} /></IconButton>
                    <IconButton title="Smazat natrvalo" onClick={() => onDeleteEntry(entry.id)}><Trash2 size={16} /></IconButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {viewing && (
        <ModalShell title={"Archivovaný ceník - " + (viewing.file_name || viewing.data.fileName || "")} onClose={() => setViewing(null)} wide>
          <PricelistTable pricelist={viewing.data} />
          <div className="flex justify-end mt-3">
            <button onClick={() => { onRestore(viewing); setViewing(null); }} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Obnovit jako aktuální</button>
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
      console.error(err);
      setError(err.message || "Nepodařilo se zpracovat soubor.");
    }
    setBusy(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Ceník dopravy</h1>
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

const SW_PRICELIST_YEAR_RE = /\b(19|20)\d{2}\b/;

function analyzeSwPricelistColumns(rows) {
  if (!rows || !rows.length) return { headerRowIdx: -1, colYear: {}, currentYear: null };
  let headerRowIdx = -1, bestCount = -1;
  rows.forEach((row, ri) => {
    const count = row.filter((c) => SW_PRICELIST_YEAR_RE.test(String(c))).length;
    if (count > bestCount) { bestCount = count; headerRowIdx = ri; }
  });
  if (bestCount <= 0) return { headerRowIdx: -1, colYear: {}, currentYear: null };
  const colYear = {};
  let lastYear = null;
  rows[headerRowIdx].forEach((cell, ci) => {
    const m = String(cell).match(SW_PRICELIST_YEAR_RE);
    if (m) lastYear = parseInt(m[0], 10);
    if (lastYear !== null) colYear[ci] = lastYear;
  });
  const years = Object.values(colYear);
  const currentYear = years.length ? Math.max(...years) : null;
  return { headerRowIdx, colYear, currentYear };
}

function SwPricelistTable({ swPricelist }) {
  const rows = swPricelist && swPricelist.rows;
  const [showOldYears, setShowOldYears] = useState(false);
  const { headerRowIdx, colYear, currentYear } = useMemo(() => analyzeSwPricelistColumns(rows), [rows]);

  if (!rows || !rows.length) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-slate-500">
        <FileSpreadsheet size={28} className="mx-auto mb-3 text-slate-300" />
        Cenik zatim neni nahrany.
      </div>
    );
  }

  const hasOldYears = currentYear != null && Object.values(colYear).some((y) => y < currentYear);
  const colCount = rows.reduce((max, r) => Math.max(max, r.length), 0);
  const visibleCols = [];
  for (let ci = 0; ci < colCount; ci++) {
    const y = colYear[ci];
    if (showOldYears || !hasOldYears || y == null || y === currentYear) visibleCols.push(ci);
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="text-sm text-slate-600">
          Nahrany subor: <b>{swPricelist.fileName}</b>
          {swPricelist.uploadedAt ? " (" + formatDateTime(swPricelist.uploadedAt) + ")" : ""}
        </div>
        <div className="flex items-center gap-3">
          {hasOldYears && (
            <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
              <input type="checkbox" checked={showOldYears} onChange={(e) => setShowOldYears(e.target.checked)} />
              Zobrazit i starsi ceny
            </label>
          )}
          <button onClick={() => openSwPricelistFile(swPricelist.path)} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-3 py-1.5 rounded-md">
            <Download size={16} /> Stahnout
          </button>
        </div>
      </div>
      {currentYear != null && (
        <div className="text-xs text-slate-400 mb-2">Aktualni ceny ({currentYear}) jsou zvyraznene rameckem.</div>
      )}
      <div className="overflow-auto max-h-[65vh] border border-slate-100 rounded-md">
        <table className="text-xs w-full">
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className={ri === (headerRowIdx >= 0 ? headerRowIdx : 0) ? "bg-slate-100 text-slate-600 font-medium sticky top-0" : "border-t border-slate-100"}>
                {visibleCols.map((ci) => {
                  const cell = row[ci];
                  const y = colYear[ci];
                  const isCurrent = currentYear != null && y === currentYear;
                  const isOld = y != null && currentYear != null && y < currentYear;
                  return (
                    <td
                      key={ci}
                      className={"px-2 py-1 whitespace-nowrap " + (isCurrent ? "border-l-2 border-r-2 border-teal-300 bg-teal-50/60" : isOld ? "text-slate-400" : "")}
                    >
                      {cell === "" || cell == null ? "" : String(cell)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SwPricelistArchiveSection({ swPricelistArchive, onRestore, onDeleteEntry }) {
  const [viewing, setViewing] = useState(null);
  if (!swPricelistArchive.length) return null;
  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold mb-2 text-slate-700">Archiv (predchozi verze)</h2>
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-100 text-slate-600 text-left"><th className="px-3 py-2 font-medium">Soubor</th><th className="px-3 py-2 font-medium">Archivovano</th><th className="px-3 py-2"></th></tr></thead>
          <tbody>
            {swPricelistArchive.map((entry) => (
              <tr key={entry.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{entry.file_name || entry.data.fileName || "cenik"}</td>
                <td className="px-3 py-2 text-slate-500">{formatDateTime(entry.archived_at)}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    <IconButton title="Zobrazit" onClick={() => setViewing(entry)}><ClipboardList size={16} /></IconButton>
                    <IconButton title="Stahnout" onClick={() => openSwPricelistFile(entry.data.path)}><Download size={16} /></IconButton>
                    <IconButton title="Obnovit jako aktualni" onClick={() => onRestore(entry)}><CheckCircle2 size={16} /></IconButton>
                    <IconButton title="Smazat natrvalo" onClick={() => onDeleteEntry(entry.id)}><Trash2 size={16} /></IconButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {viewing && (
        <ModalShell title={"Archivovany cenik - " + (viewing.file_name || viewing.data.fileName || "")} onClose={() => setViewing(null)} extraWide>
          <SwPricelistTable swPricelist={viewing.data} />
        </ModalShell>
      )}
    </div>
  );
}

function SwPricelistView({ swPricelist, swPricelistArchive, onUpload, onRestore, onDeleteArchiveEntry, cennikJinychZakazniku, onSaveCennikJinychZakazniku, products }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const buf = await file.arrayBuffer();
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buf, { type: "array" });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) throw new Error("Soubor neobsahuje zadny list.");
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      if (!rows.length) throw new Error("Soubor je prazdny.");

      const path = `${uid()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from(SW_PRICELIST_BUCKET).upload(path, file, { contentType: file.type });
      if (uploadError) throw uploadError;

      await onUpload({ path, fileName: file.name, rows, uploadedAt: new Date().toISOString() });
    } catch (err) {
      console.error(err);
      setError(err.message || "Nepodarilo se zpracovat soubor.");
    }
    setBusy(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Ceník pro Stenger Waffeln GmbH</h1>
        <label className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md cursor-pointer">
          <Upload size={16} /> Nahrat cenik (Excel)
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.ods,.csv" className="hidden" onChange={handleFile} disabled={busy} />
        </label>
      </div>
      <p className="text-xs text-slate-400 mb-3 max-w-2xl">
        Puvodni soubor se ulozi cely (jde kdykoliv stahnout) a zaroven se zobrazi jako prochazetelny nahled nize. Pri nahrani noveho souboru se ten predchozi automaticky presune do archivu.
      </p>
      {error && (
        <div className="mb-3 bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}
      {busy && (
        <div className="mb-3 text-sm text-slate-500 flex items-center gap-2">
          <Loader2 size={16} className="animate-spin" /> Zpracovavam soubor...
        </div>
      )}
      <SwPricelistTable swPricelist={swPricelist} />
      <SwPricelistArchiveSection swPricelistArchive={swPricelistArchive} onRestore={onRestore} onDeleteEntry={onDeleteArchiveEntry} />

      <div className="mt-10 pt-6 border-t border-slate-200">
        <h1 className="text-xl font-semibold mb-1">Ceník pro jiné zákazníky</h1>
        <p className="text-xs text-slate-400 mb-4 max-w-2xl">Ruční evidence artiklových čísel a cen pro ostatní zákazníky (mimo Stenger Waffeln GmbH výše).</p>
        <CennikJinychZakaznikuKalkulacka entries={cennikJinychZakazniku} />
        <CennikJinychZakaznikuView entries={cennikJinychZakazniku} onSave={onSaveCennikJinychZakazniku} products={products} />
      </div>
    </div>
  );
}

function CennikJinychZakaznikuKalkulacka({ entries }) {
  const [hladanie, setHladanie] = useState("");
  const [zakaznik, setZakaznik] = useState("");
  const q = hladanie.trim().toLowerCase();
  const z = zakaznik.trim().toLowerCase();
  const matches = (q || z)
    ? (entries || []).filter((e) => {
        const matchQ = !q || (e.cisloArtiklu || "").toLowerCase().includes(q) || (e.nazovProduktu || "").toLowerCase().includes(q);
        const matchZ = !z || (e.zakaznik || "").toLowerCase().includes(z);
        return matchQ && matchZ;
      })
    : [];

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4 max-w-2xl">
      <h2 className="text-sm font-semibold mb-3">Rychlé vyhledání ceny</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Artiklové číslo nebo název produktu" value={hladanie} onChange={setHladanie} />
        <Field label="Zákazník" value={zakaznik} onChange={setZakaznik} />
      </div>
      {(q || z) && (
        matches.length === 0 ? (
          <div className="mt-1 text-sm text-amber-700 flex items-center gap-1.5"><AlertCircle size={14} /> Nenalezeno.</div>
        ) : (
          <div className="mt-2 space-y-1">
            {matches.map((m) => (
              <div key={m.id} className="bg-slate-50 rounded-md px-3 py-1.5">
                <div className="text-sm flex items-center justify-between">
                  <span>{m.nazovProduktu || "-"} <span className="text-slate-400">({m.cisloArtiklu || "-"})</span> - {m.zakaznik}</span>
                  <span className="font-semibold text-teal-700">{formatEur(Number(String(m.cena).replace(",", ".")) || 0)}</span>
                </div>
                {m.poznamka && <div className="text-xs text-slate-500 mt-0.5">{m.poznamka}</div>}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

function emptyCennikEntryForm() {
  return { cisloArtiklu: "", nazovProduktu: "", zakaznik: "", cena: "", poznamka: "" };
}

function CennikJinychZakaznikuView({ entries, onSave, products }) {
  const [form, setForm] = useState(emptyCennikEntryForm());
  const [formError, setFormError] = useState("");
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  function add() {
    if (!form.cisloArtiklu.trim() && !form.nazovProduktu.trim()) { setFormError("Vyplňte artiklové číslo nebo název produktu."); return; }
    if (!form.zakaznik.trim()) { setFormError("Vyplňte zákazníka."); return; }
    if (!form.cena.trim()) { setFormError("Vyplňte cenu."); return; }
    setFormError("");
    onSave([...entries, { id: uid(), cisloArtiklu: form.cisloArtiklu.trim(), nazovProduktu: form.nazovProduktu.trim(), zakaznik: form.zakaznik.trim(), cena: form.cena.trim(), poznamka: form.poznamka.trim() }]);
    setForm(emptyCennikEntryForm());
  }
  function remove(id) { onSave(entries.filter((e) => e.id !== id)); setConfirmDelete(null); }
  function update(id, patch) { onSave(entries.map((e) => (e.id === id ? { ...e, ...patch } : e))); setEditing(null); }

  function zmenNazovProduktu(value) {
    const produkt = (products || []).find((p) => productLabel(p) === value);
    setForm((f) => ({ ...f, nazovProduktu: value, cisloArtiklu: produkt ? produkt.cisloArtiklu || f.cisloArtiklu : f.cisloArtiklu }));
  }

  const sorted = (entries || []).slice().sort((a, b) => (a.zakaznik || "").localeCompare(b.zakaznik || "") || (a.nazovProduktu || "").localeCompare(b.nazovProduktu || ""));

  return (
    <div>
      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
          <label><span className="block text-xs font-medium text-slate-500 mb-1">Artiklové číslo</span><input value={form.cisloArtiklu} onChange={(e) => setForm({ ...form, cisloArtiklu: e.target.value })} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" /></label>
          <label>
            <span className="block text-xs font-medium text-slate-500 mb-1">Název produktu</span>
            <input list="cennik-produkty-add" value={form.nazovProduktu} onChange={(e) => zmenNazovProduktu(e.target.value)} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" />
            <datalist id="cennik-produkty-add">
              {(products || []).map((p) => <option key={p.id} value={productLabel(p)} />)}
            </datalist>
          </label>
          <label><span className="block text-xs font-medium text-slate-500 mb-1">Zákazník</span><input value={form.zakaznik} onChange={(e) => setForm({ ...form, zakaznik: e.target.value })} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" /></label>
          <label><span className="block text-xs font-medium text-slate-500 mb-1">Cena (€)</span><input value={form.cena} onChange={(e) => setForm({ ...form, cena: e.target.value })} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" /></label>
        </div>
        <div className="mt-2">
          <label><span className="block text-xs font-medium text-slate-500 mb-1">Poznámka (např. "s dopravou", "bez dopravy", "palety za 12 EUR každá")</span><input value={form.poznamka} onChange={(e) => setForm({ ...form, poznamka: e.target.value })} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm" /></label>
        </div>
        <div className="mt-2 flex justify-end">
          <button onClick={add} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md flex items-center gap-1.5"><Plus size={16} /> Přidat</button>
        </div>
        {formError && <div className="mt-2 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={14} /> {formError}</div>}
      </div>
      {sorted.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500">Zatím žádné položky.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-left">
                <th className="px-3 py-2 font-medium">Artiklové číslo</th>
                <th className="px-3 py-2 font-medium">Název produktu</th>
                <th className="px-3 py-2 font-medium">Zákazník</th>
                <th className="px-3 py-2 font-medium text-right">Cena</th>
                <th className="px-3 py-2 font-medium">Poznámka</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => (
                <tr key={e.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{e.cisloArtiklu || "-"}</td>
                  <td className="px-3 py-2">{e.nazovProduktu || "-"}</td>
                  <td className="px-3 py-2">{e.zakaznik}</td>
                  <td className="px-3 py-2 text-right">{formatEur(Number(String(e.cena).replace(",", ".")) || 0)}</td>
                  <td className="px-3 py-2 text-slate-500">{e.poznamka || "-"}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <IconButton title="Upravit" onClick={() => setEditing(e)}><Pencil size={16} /></IconButton>
                      <IconButton title="Smazat" onClick={() => setConfirmDelete(e)}><Trash2 size={16} /></IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <CennikEntryEditModal entry={editing} products={products} onClose={() => setEditing(null)} onSave={(patch) => update(editing.id, patch)} />
      )}
      {confirmDelete && (
        <ModalShell title="Smazat položku ceníku?" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-slate-600 mb-4">Opravdu chcete smazat "{confirmDelete.nazovProduktu || confirmDelete.cisloArtiklu}" pro zákazníka "{confirmDelete.zakaznik}"? Tuto akci nelze vrátit zpět.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDelete(null)} className="text-sm text-slate-500 px-3 py-2">Zrušit</button>
            <button onClick={() => remove(confirmDelete.id)} className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5">
              <Trash2 size={16} /> Ano, smazat
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

function CennikEntryEditModal({ entry, products, onClose, onSave }) {
  const [f, setF] = useState({ cisloArtiklu: entry.cisloArtiklu || "", nazovProduktu: entry.nazovProduktu || "", zakaznik: entry.zakaznik || "", cena: entry.cena || "", poznamka: entry.poznamka || "" });
  const [error, setError] = useState("");

  function save() {
    if (!f.cisloArtiklu.trim() && !f.nazovProduktu.trim()) { setError("Vyplňte artiklové číslo nebo název produktu."); return; }
    if (!f.zakaznik.trim()) { setError("Vyplňte zákazníka."); return; }
    if (!f.cena.trim()) { setError("Vyplňte cenu."); return; }
    setError("");
    onSave({ cisloArtiklu: f.cisloArtiklu.trim(), nazovProduktu: f.nazovProduktu.trim(), zakaznik: f.zakaznik.trim(), cena: f.cena.trim(), poznamka: f.poznamka.trim() });
  }

  function zmenNazovProduktu(value) {
    const produkt = (products || []).find((p) => productLabel(p) === value);
    setF((prev) => ({ ...prev, nazovProduktu: value, cisloArtiklu: produkt ? produkt.cisloArtiklu || prev.cisloArtiklu : prev.cisloArtiklu }));
  }

  return (
    <ModalShell title="Upravit položku ceníku" onClose={onClose}>
      <Field label="Artiklové číslo" value={f.cisloArtiklu} onChange={(v) => setF({ ...f, cisloArtiklu: v })} />
      <label className="block mb-3">
        <span className="block text-xs font-medium text-slate-500 mb-1">Název produktu</span>
        <input list="cennik-produkty-edit" value={f.nazovProduktu} onChange={(e) => zmenNazovProduktu(e.target.value)} className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" />
        <datalist id="cennik-produkty-edit">
          {(products || []).map((p) => <option key={p.id} value={productLabel(p)} />)}
        </datalist>
      </label>
      <Field label="Zákazník" value={f.zakaznik} onChange={(v) => setF({ ...f, zakaznik: v })} />
      <Field label="Cena (€)" value={f.cena} onChange={(v) => setF({ ...f, cena: v })} />
      <Field label="Poznámka" value={f.poznamka} onChange={(v) => setF({ ...f, poznamka: v })} />
      {error && <div className="mb-3 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-md flex items-center gap-2"><AlertCircle size={14} /> {error}</div>}
      <div className="flex justify-end mt-2"><button onClick={save} className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-md">Uložit</button></div>
    </ModalShell>
  );
}
