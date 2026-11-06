// Cista logika PDA skenovania (bez Reactu/Supabase) - kvoli testom.
//
// Paleta = SSCC kod (00) + produktovy kod (01/02, 15/17, 10, 37), v
// lubovolnom poradi. Rozpracovana ("pending") paleta drzi to, co uz bolo
// naskenovane; ked su obe casti, vrati sa hotova paleta na ulozenie.

export const EMPTY_PENDING = { sscc: null, rawSscc: "", produkt: null };

function produktFrom(parsed) {
  return {
    gtin: parsed.gtin,
    gtinAi: parsed.gtinAi,
    bbd: parsed.bbd || null,
    bbdAi: parsed.bbdAi || null,
    sarza: parsed.batch != null ? parsed.batch : null,
    mnozstvo: parsed.count != null ? parsed.count : null,
    raw: parsed.normalized,
  };
}

function sameProdukt(a, b) {
  return a.gtin === b.gtin && a.bbd === b.bbd && a.sarza === b.sarza && a.mnozstvo === b.mnozstvo;
}

// pending: aktualna rozpracovana paleta, parsed: vysledok parseGs1Detail(),
// ssccVoVydajke: Set SSCC, ktore uz v tejto vydajke su (ulozene aj prave sa ukladajuce).
// Vracia { pending, status: "error"|"info"|"wait"|"ready", message, pallet? }.
export function mergeScan(pending, parsed, ssccVoVydajke) {
  const p = pending || EMPTY_PENDING;
  if (!parsed.ok) return { pending: p, status: "error", message: parsed.errors[0] || "Neplatný kód." };

  const next = { ...p };
  if (parsed.sscc) {
    if (ssccVoVydajke && ssccVoVydajke.has(parsed.sscc)) {
      return { pending: p, status: "error", message: `SSCC ${parsed.sscc} už je v této výdejce.` };
    }
    if (p.sscc && p.sscc !== parsed.sscc) {
      return { pending: p, status: "error", message: `Rozpracovaná paleta už má SSCC ${p.sscc}. Naskenujte k ní produktový kód, nebo ji zrušte.` };
    }
    next.sscc = parsed.sscc;
    next.rawSscc = parsed.normalized;
  }
  if (parsed.gtin) {
    const prod = produktFrom(parsed);
    if (p.produkt && !sameProdukt(p.produkt, prod)) {
      return { pending: p, status: "error", message: "Rozpracovaná paleta už má jiný produktový kód. Naskenujte SSCC, nebo ji zrušte." };
    }
    next.produkt = prod;
  }

  if (next.sscc && next.produkt) {
    const pr = next.produkt;
    const pallet = {
      sscc: next.sscc,
      gtin: pr.gtin,
      bbd: pr.bbd,
      bbd_ai: pr.bbdAi,
      sarza: pr.sarza,
      mnozstvo: pr.mnozstvo,
      raw_sscc: next.rawSscc,
      raw_produkt: pr.raw,
    };
    const warnings = [...parsed.warnings];
    if (!pr.bbd) warnings.push("Produktový kód nemá datum BBD (15/17).");
    if (pr.mnozstvo == null) warnings.push("Produktový kód nemá množství (37).");
    return { pending: EMPTY_PENDING, status: "ready", message: "Paleta kompletní, ukládám…", pallet, warnings };
  }

  const repeated = (parsed.sscc && p.sscc === parsed.sscc && !parsed.gtin) || (parsed.gtin && p.produkt && !parsed.sscc);
  if (repeated) return { pending: next, status: "info", message: parsed.sscc ? "SSCC už načteno – naskenujte produktový kód." : "Produktový kód už načten – naskenujte SSCC." };
  return { pending: next, status: "wait", message: next.sscc ? "SSCC načteno – naskenujte produktový kód." : "Produktový kód načten – naskenujte SSCC." };
}

// Supabase/PostgREST chyba -> zrozumitelna hlaska. Triggre v
// supabase/2026-10-13_pda.sql hlasia chyby s prefixom "PDA_...: text".
export function pdaErrorMessage(error) {
  if (!error) return "";
  const msg = String(error.message || error);
  const m = msg.match(/PDA_[A-Z_]+:\s*(.*)$/);
  if (m) return m[1];
  if (error.code === "23505" && /vydajka_id_sscc|pda_palety_vydajka_id_sscc_key/.test(msg)) return "Toto SSCC už je v této výdejce.";
  if (error.code === "42501" || /row-level security/i.test(msg)) return "Nemáte oprávnění k této operaci.";
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return "Bez připojení k síti – nic nebylo uloženo.";
  return msg;
}

export function isPrimaryKeyConflict(error) {
  return !!error && error.code === "23505" && /_pkey/.test(String(error.message || ""));
}

// Unikatne ID bez crypto.randomUUID (ten v starsom Chrome na PDA nemusi byt).
export function pdaId() {
  const c = typeof crypto !== "undefined" ? crypto : null;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = Array.prototype.map.call(bytes, (b) => (b < 16 ? "0" : "") + b.toString(16)).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Suhrn palet podla GTIN + BBD + sarze (pre zhrnutie pred dokoncenim aj Office).
export function summarizePallets(pallets) {
  const map = new Map();
  for (const p of pallets) {
    const key = [p.gtin || "", p.bbd || "", p.sarza || ""].join("|");
    const row = map.get(key) || { gtin: p.gtin || "", bbd: p.bbd || "", sarza: p.sarza || "", palet: 0, mnozstvo: 0, mnozstvoNeuplne: false };
    row.palet += 1;
    if (p.mnozstvo == null) row.mnozstvoNeuplne = true;
    else row.mnozstvo += Number(p.mnozstvo);
    map.set(key, row);
  }
  return Array.from(map.values()).sort((a, b) => (a.gtin + a.bbd).localeCompare(b.gtin + b.bbd));
}
