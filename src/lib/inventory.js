export const UNIT_QUICK_PICKS = ["ks", "kg", "kartonov", "balikov", "paliet", "m", "l", "sudov"];

function parseQty(record) {
  if (typeof record.mnozstvoCislo === "number" && !isNaN(record.mnozstvoCislo)) {
    return { num: record.mnozstvoCislo, unit: (record.mnozstvoJednotka || "").trim() };
  }
  const m = String(record.mnozstvo || "").match(/^([\d.,]+)\s*(.*)$/);
  if (!m) return null;
  const num = parseFloat(m[1].replace(",", "."));
  if (isNaN(num)) return null;
  return { num, unit: (m[2] || "").trim() };
}

// Hodnota skladu sa pocita ako vazeny priemer ceny zo vsetkych ocenenych prijmov
// (nie FIFO vrstvy - na tuto velkost prevadzky staci a je to jednoduchsie na udrzbu).
// Prijmy bez ceny (faktura este nedorazila) sa do priemeru nezapocitavaju, len sa
// spocitaju do "neocenenePrijmy", aby bolo v UI vidno, ze hodnota je neuplna.
export function computeStockLevels(receipts, issues) {
  const byKey = {};

  function add(record, sign) {
    const qty = parseQty(record);
    if (!qty || !record.material) return;
    const key = record.material.trim().toLowerCase() + "|" + qty.unit.toLowerCase();
    if (!byKey[key]) {
      byKey[key] = {
        material: record.material.trim(),
        unit: qty.unit,
        prijate: 0,
        vydane: 0,
        hodnotaPrijate: 0,
        mnozstvoOcenene: 0,
        neocenenePrijmy: 0,
      };
    }
    if (sign > 0) {
      byKey[key].prijate += qty.num;
      const cena = typeof record.cenaJednotkovaCzk === "number" && !isNaN(record.cenaJednotkovaCzk) ? record.cenaJednotkovaCzk : null;
      if (cena !== null) {
        byKey[key].hodnotaPrijate += cena * qty.num;
        byKey[key].mnozstvoOcenene += qty.num;
      } else {
        byKey[key].neocenenePrijmy += 1;
      }
    } else {
      byKey[key].vydane += qty.num;
    }
  }

  (receipts || []).forEach((r) => add(r, 1));
  (issues || []).forEach((i) => add(i, -1));

  return Object.values(byKey)
    .map((row) => {
      const stav = row.prijate - row.vydane;
      const priemernaCena = row.mnozstvoOcenene > 0 ? row.hodnotaPrijate / row.mnozstvoOcenene : null;
      const hodnota = priemernaCena !== null ? Math.round(stav * priemernaCena * 100) / 100 : null;
      return { ...row, stav, priemernaCena, hodnota };
    })
    .sort((a, b) => a.material.localeCompare(b.material) || a.unit.localeCompare(b.unit));
}

// Vypocita stav zasob hotovych vyrobkov (v paletach) na sklade:
// vyrobene (production_outputs) minus expedovane (expedicia_zaznamy).
export function computeFinishedGoodsStock(outputs, dispatches) {
  const byProduct = {};

  function ensure(produktId, produktNazov) {
    if (!byProduct[produktId]) {
      byProduct[produktId] = { produktId, produktNazov, vyrobene: 0, expedovane: 0 };
    }
    if (produktNazov) byProduct[produktId].produktNazov = produktNazov;
    return byProduct[produktId];
  }

  (outputs || []).forEach((o) => {
    if (!o.produktId) return;
    ensure(o.produktId, o.produktNazov).vyrobene += parseFloat(o.mnozstvo) || 0;
  });
  (dispatches || []).forEach((d) => {
    if (!d.produktId) return;
    ensure(d.produktId, d.produktNazov).expedovane += parseFloat(d.pocetPaliet) || 0;
  });

  return Object.values(byProduct)
    .map((row) => ({ ...row, stav: Math.round((row.vyrobene - row.expedovane) * 1000) / 1000 }))
    .sort((a, b) => a.produktNazov.localeCompare(b.produktNazov));
}

// Zistuje, ci by pripocitanie "adding" k "currentTotal" prekrocilo "planned".
// Ak plan nie je zadany (0/prazdny) alebo sa nic nepridava, kontrola sa neaplikuje.
export function wouldExceed(currentTotal, adding, planned) {
  const plan = parseFloat(planned) || 0;
  const add = parseFloat(String(adding).replace(",", ".")) || 0;
  if (plan <= 0 || add <= 0) return false;
  return (parseFloat(currentTotal) || 0) + add > plan;
}

// Pre kazdu potrebnu surovinu (z computeProductionIssues) dopocita dostupne mnozstvo
// zo stavu zasob a vrati len tie, kde potrebne mnozstvo presahuje dostupne.
export function materialShortages(requiredIssues, stock) {
  return (requiredIssues || [])
    .map((ri) => {
      const row = (stock || []).find(
        (r) => r.material.trim().toLowerCase() === ri.material.trim().toLowerCase() && r.unit.toLowerCase() === (ri.mnozstvoJednotka || "").trim().toLowerCase()
      );
      return { ...ri, dostupne: row ? row.stav : 0 };
    })
    .filter((ri) => ri.mnozstvoCislo > ri.dostupne);
}

// Navrhne, ktore existujuce (este neocenene) prijmy tovaru najlepsie zodpovedaju
// polozke z faktury - podla zhody dodavatela a podobnosti nazvu materialu. Office
// si z navrhov vyberie/potvrdi spravny prijem rucne (nespoliehame sa na automat).
export function suggestReceiptMatches(item, dodavatelNazov, receipts) {
  const popisLower = (item.popis || "").trim().toLowerCase();
  const dodLower = (dodavatelNazov || "").trim().toLowerCase();
  return (receipts || [])
    .filter((r) => r.cenaJednotkovaCzk === "" || r.cenaJednotkovaCzk === undefined || r.cenaJednotkovaCzk === null)
    .map((r) => {
      let score = 0;
      const dodReceipt = (r.dodavatel || "").trim().toLowerCase();
      if (dodLower && dodReceipt && (dodReceipt.includes(dodLower) || dodLower.includes(dodReceipt))) score += 5;
      const matLower = (r.material || "").trim().toLowerCase();
      if (matLower && popisLower) {
        if (matLower === popisLower) score += 10;
        else if (popisLower.includes(matLower) || matLower.includes(popisLower)) score += 3;
        else {
          const firstWord = popisLower.split(/\s+/)[0];
          if (firstWord && firstWord.length > 2 && matLower.includes(firstWord)) score += 1;
        }
      }
      return { receipt: r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.receipt);
}

// Materialy pouzite v minulosti (v prijmoch/vydajoch), ktore este nie su medzi
// "presets" (rychle tlacidla) - aby sa dali vybrat presne rovnakym pravopisom
// namiesto rucneho pretypovania (preklep by inak vytvoril novu, oddelenu polozku zasob).
export function extraKnownMaterials(receipts, issues, presets) {
  const known = new Set();
  (receipts || []).forEach((r) => r.material && known.add(r.material.trim()));
  (issues || []).forEach((i) => i.material && known.add(i.material.trim()));
  const presetSet = new Set((presets || []).map((p) => p.toLowerCase()));
  return Array.from(known)
    .filter((m) => m && !presetSet.has(m.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
}

function supplierMaterialName(t) {
  return typeof t === "string" ? t : (t && t.popis) || "";
}

// Polozky z katalogu (Dodavatele -> tovary) konkretneho dodavatela - pouziva sa
// namiesto celeho zoznamu materialov, aby vyber ponukal len to, co dany dodavatel
// realne dodava. Ak dodavatel nema katalog vyplneny, vrati sa zjednoteny zoznam
// vsetkych znamych materialov (fallback), aby vyber nezostal prazdny.
export function materialPicksForSupplier(dodavatelId, suppliers, fallbackPresets) {
  const supplier = (suppliers || []).find((s) => s.id === dodavatelId);
  if (supplier && Array.isArray(supplier.tovary) && supplier.tovary.length) {
    const names = supplier.tovary.map(supplierMaterialName).map((n) => n.trim()).filter(Boolean);
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
  }
  return allKnownMaterials(suppliers, fallbackPresets);
}

// Zjednoteny zoznam materialov zo vsetkych katalogov dodavatelov + zakladne presets -
// jediny "spravny" zoznam nazvov pouzivany vsade (Prijem zbozi, Zasoby, Reklamace),
// namiesto nekontrolovaneho dopisovania z historie zapisu (viz extraKnownMaterials vyssie).
export function allKnownMaterials(suppliers, fallbackPresets) {
  const set = new Set((fallbackPresets || []).map((p) => p.trim()).filter(Boolean));
  (suppliers || []).forEach((s) => {
    (s.tovary || []).forEach((t) => {
      const name = supplierMaterialName(t).trim();
      if (name) set.add(name);
    });
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function paletyEkvivalent(planRow, product) {
  const mnozstvo = parseFloat(String(planRow.mnozstvo).replace(",", ".")) || 0;
  if (planRow.mnozstvoJednotka === "kartonov") {
    const kartonovNaPalete = parseFloat(product && product.kartonovNaPalete) || 1;
    return mnozstvo / kartonovNaPalete;
  }
  return mnozstvo;
}

// Vypocita mnozstvo surovin (podla receptury produktu na 1 paletu) potrebne pre riadok
// vyrobneho planu - vysledok je pripraveny na vlozenie ako stock_issues zaznamy.
export function computeProductionIssues(planRow, product) {
  if (!product || !Array.isArray(product.receptura)) return [];
  const palety = paletyEkvivalent(planRow, product);
  return product.receptura
    .filter((r) => r.material && r.mnozstvo)
    .map((r) => {
      const perPaleta = parseFloat(String(r.mnozstvo).replace(",", ".")) || 0;
      const total = Math.round(perPaleta * palety * 1000) / 1000;
      const jednotka = (r.jednotka || "").trim();
      return {
        material: r.material.trim(),
        mnozstvoCislo: total,
        mnozstvoJednotka: jednotka,
        mnozstvo: [total, jednotka].filter(Boolean).join(" ").trim(),
      };
    });
}
