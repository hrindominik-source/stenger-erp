// Edge Function: proxy k verejnemu CNB API (ktore nema CORS hlavicky, takze
// appka naň nemoze zavolat priamo z prehliadaca). Vracia oficialny denny kurz
// CNB pre danu menu a datum (ak na dany den kurz nevysiel - vikend/sviatok -
// CNB API samo vrati posledny platny kurz, vid pole "validFor" v odpovedi).
//
// Volanie: GET /functions/v1/cnb-rate?date=YYYY-MM-DD&currency=EUR

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const date = url.searchParams.get("date");
  const currency = (url.searchParams.get("currency") || "EUR").toUpperCase();

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: "Chyba alebo neplatny parameter 'date' (ocakavany format YYYY-MM-DD)." }, 400);
  }
  if (currency === "CZK") {
    return json({ rate: 1, currencyCode: "CZK", validFor: date });
  }

  try {
    const cnbRes = await fetch(`https://api.cnb.cz/cnbapi/exrates/daily?date=${date}&lang=EN`);
    if (!cnbRes.ok) {
      return json({ error: `CNB API vratilo chybu (HTTP ${cnbRes.status}).` }, 502);
    }
    const data = await cnbRes.json();
    const found = (data.rates || []).find((r: { currencyCode: string }) => r.currencyCode === currency);
    if (!found) {
      return json({ error: `Mena "${currency}" sa v kurzoch CNB nenasla.` }, 404);
    }
    return json({ rate: found.rate / found.amount, currencyCode: found.currencyCode, validFor: found.validFor });
  } catch (e) {
    return json({ error: `Nepodarilo sa nacitat kurz z CNB: ${String(e)}` }, 500);
  }
});
