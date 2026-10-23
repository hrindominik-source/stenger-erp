// Spolocne pomocne funkcie pre HR Edge Functions (hr-finalize-pdf,
// hr-signed-original). Prihlaseny pouzivatel sa overuje JEHO tokenom (RLS +
// hr_get_permissions); zapis do DB/uloziska robi service role, lebo DB
// prijme finalne PDF a podpisany original len od servera.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";

export const BUCKET = "hr-dokumenty";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function authorize(req: Request, anyOf: string[]) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) throw new HttpError(401, "Chybi prihlaseni.");
  const url = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data: u, error: uErr } = await userClient.auth.getUser();
  if (uErr || !u?.user) throw new HttpError(401, "Neplatne prihlaseni.");
  const { data: perms, error: pErr } = await userClient.rpc("hr_get_permissions");
  if (pErr) throw new HttpError(403, "Opravneni nelze overit.");
  const list: string[] = perms || [];
  if (!list.includes("HR_ADMIN") && !anyOf.some((p) => list.includes(p))) throw new HttpError(403, "Neopravneno.");
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  return { user: u.user, userClient, service };
}

// Dokument musi byt viditelny POD PRAVAMI POUZIVATELA (RLS vratane
// klasifikacie citlivosti) - service role sa pouzije az potom.
export async function loadVisibleDocument(userClient: SupabaseClient, service: SupabaseClient, documentId: string) {
  const { data: visible } = await userClient.from("hr_documents").select("id").eq("id", documentId).maybeSingle();
  if (!visible) throw new HttpError(404, "Dokument nenalezen.");
  const { data: doc, error } = await service.from("hr_documents").select("*").eq("id", documentId).single();
  if (error || !doc) throw new HttpError(404, "Dokument nenalezen.");
  return doc;
}

export async function download(service: SupabaseClient, path: string) {
  const { data, error } = await service.storage.from(BUCKET).download(path);
  if (error || !data) throw new HttpError(404, `Soubor nelze nacist: ${path}`);
  return new Uint8Array(await data.arrayBuffer());
}

export async function extractPdfPages(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return Array.isArray(text) ? text : [text];
}

export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "Pouze POST." }, 405);
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Interni chyba serveru." }, 500);
    }
  };
}

// Relacia prihlaseneho pouzivatela (claim session_id z JWT, ktory uz overil
// authorize()); pouziva sa na vazbu podpisoveho tokenu na relaciu HR.
export function sessionIdFromRequest(req: Request): string {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/, "");
  try {
    const part = jwt.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
    const sid = JSON.parse(atob(part + "=".repeat((4 - (part.length % 4)) % 4))).session_id;
    if (typeof sid === "string" && /^[0-9a-f-]{36}$/.test(sid)) return sid;
  } catch { /* nizsie */ }
  throw new HttpError(401, "Přihlášení HR nemá relaci – přihlaste se znovu.");
}

// Typ nahraneho skenu podla obsahu (nie podla nazvu/MIME z prehliadaca).
export function scanType(bytes: Uint8Array): { ext: string; mime: string } | null {
  const b = bytes;
  if (b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { ext: "pdf", mime: "application/pdf" };
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: "png", mime: "image/png" };
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  return null;
}
export const MAX_SCAN_BYTES = 15_000_000;
export const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
