// Edge Function: precita schranku s fakturami dodavatelov (IMAP, len na citanie),
// kazde nove PDF ulozi do bucketu "invoices", AI z neho vytiahne udaje a zapise
// zaznam do public.prijate_faktury so stavom KE_KONTROLE. Kancelaria ho potom
// v Prijme tovaru skontroluje a napáruje na prijmy (ceny do skladu a inventury).
//
// Spusta ju pg_cron (hlavicka x-inbox-token, overi sa proti vault cez RPC)
// alebo prihlaseny pouzivatel s rolou office (tlacidlo "Zkontrolovat poštu").
// Nasadzuje sa s --no-verify-jwt (cron nema JWT), overenie je nizsie.
//
// Secrets: INBOX_IMAP_HOST, INBOX_IMAP_USER, INBOX_IMAP_PASSWORD,
// volitelne INBOX_IMAP_PORT (993), INBOX_OD (DD.MM.RRRR, inak posledne 7 dni).
// API kluc Claude sa berie z Nastavenia firmy (company.data.apiKey).

import { ImapFlow } from "npm:imapflow@1.7.8";
import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import { processInbox, extractInvoice, sinceFromEnv } from "./inbox.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-inbox-token",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // overenie: token z cronu alebo prihlaseny office
  let povolene = false;
  const token = req.headers.get("x-inbox-token");
  if (token) {
    const { data } = await svc.rpc("invoice_inbox_token_ok", { p_token: token });
    povolene = data === true;
  } else {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (jwt) {
      const { data: u } = await svc.auth.getUser(jwt);
      if (u && u.user) {
        const { data: prof } = await svc.from("profiles").select("role").eq("id", u.user.id).single();
        povolene = !!prof && prof.role === "office";
      }
    }
  }
  if (!povolene) return json({ error: "Nepovolený přístup." }, 401);

  const host = Deno.env.get("INBOX_IMAP_HOST");
  const user = Deno.env.get("INBOX_IMAP_USER");
  const pass = Deno.env.get("INBOX_IMAP_PASSWORD");
  if (!host || !user || !pass) return json({ error: "Schránka není nastavená (INBOX_IMAP_HOST / USER / PASSWORD)." }, 500);

  const { data: comp } = await svc.from("company").select("data").eq("id", 1).single();
  const apiKey = comp && comp.data && comp.data.apiKey;
  if (!apiKey) return json({ error: "Chybí Anthropic API klíč v Nastavení firmy." }, 500);

  const port = Number(Deno.env.get("INBOX_IMAP_PORT") || 993);
  // limit funkcie je 150 s; nove PDF sa po 90 s uz nezacne (AI citanie trva do ~30 s)
  const deadline = Date.now() + 90_000;
  const log = (m: string) => console.log("[invoice-inbox] " + m);
  const imap = new ImapFlow({ host, port, secure: port === 993, auth: { user, pass }, logger: false, connectionTimeout: 20_000, greetingTimeout: 15_000, socketTimeout: 60_000 });
  try {
    log("pripajam " + host);
    await imap.connect();
    log("pripojene");
    const summary = await processInbox({
      imap,
      deadline,
      log,
      since: sinceFromEnv(Deno.env.get("INBOX_OD")),
      extract: (bytes: Uint8Array) => extractInvoice(bytes, apiKey),
      store: {
        async existingIds(ids: string[]) {
          const { data, error } = await svc.from("prijate_faktury").select("id").in("id", ids);
          if (error) throw error;
          return new Set((data || []).map((r: { id: string }) => r.id));
        },
        async uploadPdf(path: string, bytes: Uint8Array) {
          const { error } = await svc.storage.from("invoices").upload(path, bytes, { contentType: "application/pdf", upsert: true });
          if (error) throw error;
        },
        async insert(row: { id: string }) {
          const { error } = await svc.from("prijate_faktury").upsert({ id: row.id, data: row }, { onConflict: "id", ignoreDuplicates: true });
          if (error) throw error;
        },
      },
    });
    log(`hotovo: ${JSON.stringify(summary)}`);
    return json({ ok: true, ...summary });
  } catch (e) {
    console.error(e);
    return json({ error: "Čtení schránky selhalo: " + String((e && (e as Error).message) || e) }, 500);
  } finally {
    try {
      await imap.logout();
    } catch {
      // spojenie uz mohlo byt zavrete
    }
  }
});
