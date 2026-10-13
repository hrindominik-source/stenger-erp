// Tok ukladania PDA vydajky - bez Reactu, nad lubovolnym PDA API
// (pda/pdaApi.js = Supabase, pda/pdaMockApi.js = test). Pouziva ho
// PdaMobileView a testuju ho pdaFlow.test.js (vypadky siete, opakovane
// odoslanie, duplicity, neuplne palety).

import { pdaErrorMessage, isPrimaryKeyConflict } from "./pdaScan.js";

const PALETA_STLPCE = ["id", "vydajka_id", "sscc", "gtin", "bbd", "bbd_ai", "sarza", "mnozstvo", "raw_sscc", "raw_produkt", "pracovnik", "data"];

// Chyba, pri ktorej opakovanie nepomoze (pravidlo DB, nie siet).
function jeDefinitivna(error) {
  if (!error) return false;
  return /PDA_/.test(String(error.message || "")) || ["23505", "23514", "42501", "P0001"].includes(error.code);
}

// Ulozi paletu. Paleta je ulozena LEN ak DB vrati ulozeny riadok.
// Vysledok:
//   { outcome: "ok", data, warning? }        - DB potvrdila
//   { outcome: "rejected", message }         - pravidlo DB (duplicita, dokoncena...) - neopakovat
//   { outcome: "retry", message }            - siet/neznamy stav - riadok ostava "Neuloženo", mozno opakovat
export async function savePalletFlow(api, row) {
  // Prijemnejsia hlaska vopred - tvrda kontrola je v DB triggri. Ak tento
  // dotaz zlyha (siet), pokracuje sa insertom a rozhodne DB.
  const { data: dup } = await api.findSscc(row.sscc);
  const ine = (dup || []).filter((d) => d.vydajka_id !== row.vydajka_id && d.pda_vydajky);
  const dokoncena = ine.find((d) => d.pda_vydajky.stav === "dokoncena");
  if (dokoncena) {
    return { outcome: "rejected", message: `SSCC …${row.sscc.slice(-6)} už je v dokončené výdejce LS ${dokoncena.pda_vydajky.cislo_lieferschein}.` };
  }

  const payload = {};
  for (const k of PALETA_STLPCE) payload[k] = row[k] === undefined ? null : row[k];
  let { data, error } = await api.insertPaleta(payload);

  if (error && isPrimaryKeyConflict(error)) {
    // Opakovane odoslanie toho isteho ID - prvy pokus uz v DB je (odpoved sa stratila).
    const res = await api.getPaleta(row.id);
    if (res.data && res.data.sscc === row.sscc && res.data.vydajka_id === row.vydajka_id) {
      data = res.data;
      error = null;
    } else if (res.error) {
      // Overenie zlyhalo (siet) - stav nevieme, riadok ostava na opakovanie.
      return { outcome: "retry", message: pdaErrorMessage(res.error) };
    }
  }
  if (error || !data) {
    const message = pdaErrorMessage(error) || "Databáze uložení nepotvrdila.";
    return { outcome: jeDefinitivna(error) ? "rejected" : "retry", message };
  }
  if (data.id !== row.id || data.sscc !== row.sscc) {
    return { outcome: "retry", message: "Databáze vrátila jiný záznam - zkuste znovu." };
  }
  const rozpracovana = ine.find((d) => d.pda_vydajky.stav === "rozpracovana");
  return {
    outcome: "ok",
    data,
    warning: rozpracovana ? `SSCC je i v rozpracované výdejce LS ${rozpracovana.pda_vydajky.cislo_lieferschein}.` : "",
  };
}

// Zalozenie vydajky. row.id musi volajuci drzat rovnake pri opakovani, kym
// DB zalozenie nepotvrdi - ak sa odpoved stratila, opakovanie nájde uz
// ulozenu vydajku namiesto zalozenia druhej s rovnakym LS.
export async function createVydajkaFlow(api, row) {
  const { data, error } = await api.createVydajka(row);
  if (data && !error && data.id === row.id) return { ok: true, data };
  if (error && isPrimaryKeyConflict(error)) {
    const res = await api.getVydajka(row.id);
    if (res.data && res.data.cislo_lieferschein === row.cislo_lieferschein) return { ok: true, data: res.data };
  }
  return { ok: false, retry: !jeDefinitivna(error), message: pdaErrorMessage(error) || "Výdejka nebyla uložena." };
}

// Zmazanie palety - uspech len ak DB vrati prave 1 zmazany riadok, alebo ak
// overenie ukaze, ze paleta uz neexistuje (odpoved predchadzajuceho pokusu
// sa stratila).
export async function deletePalletFlow(api, id) {
  const { data, error } = await api.deletePaleta(id);
  if (!error && data && data.length === 1) return { ok: true };
  if (!error || !jeDefinitivna(error)) {
    const res = await api.getPaleta(id);
    if (!res.error && !res.data) return { ok: true };
  }
  return { ok: false, message: pdaErrorMessage(error) || "Databáze smazání nepotvrdila." };
}

// Dokoncenie vydajky - uspech len ak DB vrati (alebo pri overeni ukaze)
// vydajku v stave "dokoncena".
export async function finishFlow(api, vydajkaId, dokoncil) {
  const { data, error } = await api.finishVydajka(vydajkaId, dokoncil);
  if (!error && data && data.stav === "dokoncena") return { ok: true, data };
  if (!error || !jeDefinitivna(error)) {
    // Odpoved sa mohla stratit, alebo vydajka uz bola dokoncena predtym.
    const res = await api.getVydajka(vydajkaId);
    if (res.data && res.data.stav === "dokoncena") return { ok: true, data: res.data };
  }
  return { ok: false, message: pdaErrorMessage(error) || "Databáze dokončení nepotvrdila - zkuste znovu." };
}

// Spoji palety nacitane z DB s lokalnymi riadkami. Lokalne riadky, ktore
// este nie su potvrdene (Ukládám / Neuloženo / Mažu), sa nesmu stratit, ak
// nacitanie dobehne az po naskenovani (pomala siet).
export function mergeLoadedRows(prev, loaded) {
  const fromDb = (loaded || []).map((r) => ({ ...r, _status: "ok" }));
  const local = (prev || []).filter((r) => r._status !== "ok");
  const localIds = new Set(local.map((r) => r.id));
  return [...local, ...fromDb.filter((r) => !localIds.has(r.id))];
}

// Ci mozno dokoncit vydajku - rows: [{ _status: ok|saving|error|deleting }].
export function canFinish({ rows, pending, online }) {
  const r = rows || [];
  const ulozene = r.filter((x) => x._status === "ok").length;
  if (pending && (pending.sscc || pending.produkt)) return { ok: false, reason: "Dokončete nebo zrušte rozpracovanou paletu." };
  if (r.some((x) => x._status === "saving" || x._status === "error")) return { ok: false, reason: "Některé palety nejsou uložené." };
  if (r.some((x) => x._status === "deleting")) return { ok: false, reason: "Probíhá mazání palety." };
  if (!online) return { ok: false, reason: "Bez připojení." };
  if (!ulozene) return { ok: false, reason: "Výdejka nemá žádnou uloženou paletu." };
  return { ok: true, reason: "" };
}
