// Datova vrstva PDA / Expedice. Obrazovky (PdaMobileView, PdaOfficeView)
// nevolaju Supabase priamo, ale cez toto API - vdaka tomu testovaci rezim
// (?pda=test, pdaMockApi.js) bezi nad simulovanou databazou v prehliadaci
// a NIKDY nezapisuje do Supabase.
//
// Vsetky metody vracaju { data, error } (rovnaky tvar ako supabase-js).

export function createSupabasePdaApi(supabase) {
  return {
    isDemo: false,

    listWorkers() {
      return supabase.from("workers").select("*");
    },

    listOpenVydajky() {
      return supabase
        .from("pda_vydajky")
        .select("*, pda_palety(count)")
        .eq("stav", "rozpracovana")
        .order("created_at", { ascending: false });
    },

    findVydajkyByLs(cislo) {
      return supabase.from("pda_vydajky").select("id, stav, created_at").eq("cislo_lieferschein", cislo);
    },

    createVydajka(row) {
      return supabase.from("pda_vydajky").insert(row).select().single();
    },

    getVydajka(id) {
      return supabase.from("pda_vydajky").select("*").eq("id", id).maybeSingle();
    },

    loadPalety(vydajkaId) {
      return supabase.from("pda_palety").select("*").eq("vydajka_id", vydajkaId).order("created_at", { ascending: false });
    },

    // [{ vydajka_id, pda_vydajky: { stav, cislo_lieferschein } }]
    findSscc(sscc) {
      return supabase.from("pda_palety").select("vydajka_id, pda_vydajky(stav, cislo_lieferschein)").eq("sscc", sscc);
    },

    insertPaleta(payload) {
      return supabase.from("pda_palety").insert(payload).select().single();
    },

    getPaleta(id) {
      return supabase.from("pda_palety").select("*").eq("id", id).maybeSingle();
    },

    deletePaleta(id) {
      return supabase.from("pda_palety").delete().eq("id", id).select();
    },

    deleteVydajka(id) {
      return supabase.from("pda_vydajky").delete().eq("id", id).select();
    },

    finishVydajka(id, dokoncil) {
      return supabase.from("pda_vydajky").update({ stav: "dokoncena", dokoncil }).eq("id", id).eq("stav", "rozpracovana").select().maybeSingle();
    },

    reopenVydajka(id) {
      return supabase.from("pda_vydajky").update({ stav: "rozpracovana" }).eq("id", id).select().maybeSingle();
    },

    // Office prehlad - po strankach (PostgREST vracia max. 1000 riadkov).
    listVydajkyOd(odIso) {
      return fetchAll(() => {
        let q = supabase.from("pda_vydajky").select("*");
        if (odIso) q = q.gte("created_at", odIso);
        return q.order("created_at", { ascending: false }).order("id");
      });
    },

    listPaletyOd(odIso) {
      return fetchAll(() => {
        let q = supabase.from("pda_palety").select("*, pda_vydajky!inner(created_at)");
        if (odIso) q = q.gte("pda_vydajky.created_at", odIso);
        return q.order("created_at", { ascending: true }).order("id");
      });
    },

    // Realtime - zavola onChange pri akejkolvek zmene; vracia odhlasenie.
    subscribe(onChange) {
      const channel = supabase
        .channel("pda-office")
        .on("postgres_changes", { event: "*", schema: "public", table: "pda_vydajky" }, onChange)
        .on("postgres_changes", { event: "*", schema: "public", table: "pda_palety" }, onChange)
        .subscribe();
      return () => supabase.removeChannel(channel);
    },
  };
}

async function fetchAll(build) {
  const PAGE = 1000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) return { data: null, error };
    out.push(...(data || []));
    if (!data || data.length < PAGE) return { data: out, error: null };
  }
}
