// Edge Function: precita dodaci list (fotka/PDF v bucketu goods-receipt-photos)
// cez Claude a vrati polozky so sarzou a DMT pre prijem tovaru.
//
// Vola ju prihlaseny pouzivatel s rolou sklad alebo office. API kluc Claude
// sa berie z Nastavenia firmy (company.data.apiKey) - sklad ho nevidi, preto
// to nejde priamo z prehliadaca. Nasadzuje sa s --no-verify-jwt, overenie je nizsie.
//
// Body: { path: "<formId>/dodak.jpg", materialy: string[], katalog: [{ dodavatel, materialy }], dodavatelia: string[] }

import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import { extractDodak, mediaTypePodlaCesty } from "./dodak.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const MAX_BYTES = 10 * 1024 * 1024;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  let povolene = false;
  if (jwt) {
    const { data: u } = await svc.auth.getUser(jwt);
    if (u && u.user) {
      const { data: prof } = await svc.from("profiles").select("role").eq("id", u.user.id).single();
      povolene = !!prof && (prof.role === "sklad" || prof.role === "office");
    }
  }
  if (!povolene) return json({ error: "Nepovolený přístup." }, 401);

  let body: { path?: string; materialy?: unknown; katalog?: unknown; dodavatelia?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Neplatný požadavek." }, 400);
  }
  const path = String(body.path || "");
  const mediaType = mediaTypePodlaCesty(path);
  if (!/^[\w-]+\/dodak\.\w+$/.test(path) || !mediaType) return json({ error: "Neplatný soubor dodacího listu." }, 400);
  const strList = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []);

  const { data: comp } = await svc.from("company").select("data").eq("id", 1).single();
  const apiKey = comp && comp.data && comp.data.apiKey;
  if (!apiKey) return json({ error: "Chybí Anthropic API klíč v Nastavení firmy." }, 500);

  const { data: file, error: dlErr } = await svc.storage.from("goods-receipt-photos").download(path);
  if (dlErr || !file) return json({ error: "Dodací list se nepodařilo načíst ze skladu souborů." }, 404);
  if (file.size > MAX_BYTES) return json({ error: "Soubor je příliš velký (max 10 MB)." }, 400);

  try {
    const vysledok = await extractDodak({
      bytes: new Uint8Array(await file.arrayBuffer()),
      mediaType,
      apiKey,
      materialy: strList(body.materialy),
      katalog: (Array.isArray(body.katalog) ? body.katalog : [])
        .map((k: { dodavatel?: unknown; materialy?: unknown }) => ({ dodavatel: String((k && k.dodavatel) || ""), materialy: strList(k && k.materialy) }))
        .filter((k: { dodavatel: string }) => k.dodavatel),
      dodavatelia: strList(body.dodavatelia),
    });
    console.log(`[dodak-extract] ${path}: ${vysledok.jeDodak ? vysledok.polozky.length + " polozky" : "nie je dodak"}`);
    return json({ ok: true, ...vysledok });
  } catch (e) {
    console.error(e);
    return json({ error: "Čtení dodacího listu selhalo: " + String((e && (e as Error).message) || e) }, 500);
  }
});
