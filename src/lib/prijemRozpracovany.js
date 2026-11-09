// Rozpracovany prijem zdielany medzi zariadeniami (bez Reactu/Supabase - kvoli testom).
// Tablet odfoti dodaci list, PDA naskenuje palety; spajaju sa cez jeden riadok
// v tabulke prijem_rozpracovany. Ziadna cast sa pri spajani nestrati.

// Stav formulara -> data riadku. verzia sa meni pri kazdom ulozeni.
export function snapshotPrijmu({ f, dodak, dodakIdx, riadky, skeny, rozpracovana, paletyDodavky }, { verzia, ulozil, cas }) {
  return {
    f,
    dodak: dodak || null,
    dodakIdx: dodakIdx ?? null,
    riadky: riadky || [],
    skeny: rozpracovana ? [...(skeny || []), rozpracovana] : skeny || [],
    paletyDodavky: paletyDodavky || [],
    verzia,
    ulozil: ulozil || "",
    cas: cas || "",
  };
}

const prazdne = (v) => v === undefined || v === null || String(v).trim() === "";

function rovnakySken(a, b) {
  if (a.sscc || b.sscc) return a.sscc === b.sscc;
  return JSON.stringify(a) === JSON.stringify(b);
}

// Spoji aktualny formular s ulozenym rozpracovanym prijmom.
// Polia formulara: vyplnene teraz (nie predvolene) vyhravaju, prazdne sa doplnia.
// Palety: zjednotenie podla SSCC. Dodaci list: ak ho formular nema, vezme sa ulozeny.
export function zlucPrijem(aktualny, ulozeny, predvoleneF) {
  const f = { ...ulozeny.f };
  for (const [k, v] of Object.entries(aktualny.f || {})) {
    const jePredvolene = predvoleneF && predvoleneF[k] === v;
    if (!prazdne(v) && (!jePredvolene || prazdne(f[k]))) f[k] = v;
  }
  const skeny = [...(aktualny.skeny || [])];
  for (const s of ulozeny.skeny || []) if (!skeny.some((x) => rovnakySken(x, s))) skeny.push(s);
  const dodakZoStareho = !aktualny.dodak && !!ulozeny.dodak;
  const palety = [...(aktualny.paletyDodavky || [])];
  for (const p of ulozeny.paletyDodavky || []) if (!palety.some((x) => JSON.stringify(x) === JSON.stringify(p))) palety.push(p);
  return {
    f,
    dodak: dodakZoStareho ? ulozeny.dodak : aktualny.dodak || null,
    dodakIdx: dodakZoStareho ? ulozeny.dodakIdx ?? null : aktualny.dodakIdx ?? null,
    riadky: dodakZoStareho ? ulozeny.riadky || [] : aktualny.riadky || [],
    skeny,
    paletyDodavky: palety,
  };
}

// Kratky popis do zoznamu "Čeká na dokončení".
export function popisRozpracovaneho(d) {
  const f = d.f || {};
  const casti = [f.dodavatel || (d.dodak && d.dodak.dodavatel) || "Neznámý dodavatel"];
  const doklad = f.cisloDokladu || (d.dodak && d.dodak.cisloDokladu);
  if (doklad) casti.push("DL " + doklad);
  const n = (d.skeny || []).length;
  casti.push(n ? `${n} pal. naskenováno` : "bez skenu");
  casti.push(d.dodak ? "dodací list ✓" : "bez dodacího listu");
  return casti.join(" · ");
}
