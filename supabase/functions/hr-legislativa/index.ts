// Sledovanie legislativy a revizii (migracia 74, balik H).
// { action: "check" } - jednatel (HR_ADMIN, aal2) alebo planovac na serveri
//   (Authorization: Bearer <service role>):
//   1. pripomienky revizii (hr_revision_notify);
//   2. pre kazdy zapnuty zdroj stiahne obsah, spocita odtlacok a zapise ho
//      (hr_legislation_record) - pri zmene upozornenie jednatelovi.
// Nic sa nemeni automaticky. Zdroj je obmedzeny na e-Sbirku (DB check).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { json, handle, HttpError, authorize } from "../_shared/hrServer.ts";
import { fingerprint } from "../_shared/hr/legislationFingerprint.js";

const MAX_BYTES = 5_000_000;

async function callerService(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const service = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, { auth: { persistSession: false } });
  if (auth === `Bearer ${serviceKey}`) return service; // planovac na serveri
  const { service: s } = await authorize(req, []); // len HR_ADMIN
  return s;
}

async function check(req: Request) {
  const service = await callerService(req);
  const { data: reminders, error: rErr } = await service.rpc("hr_revision_notify");
  if (rErr) throw new HttpError(500, rErr.message);
  const { data: watches, error: wErr } = await service.from("hr_legislation_watch").select("*").eq("enabled", true);
  if (wErr) throw new HttpError(500, wErr.message);
  const results: Record<string, string> = {};
  for (const w of watches || []) {
    let fp: string | null = null;
    let err: string | null = null;
    try {
      const res = await fetch(w.source_url, { redirect: "error", signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.length > MAX_BYTES) throw new Error("Odpověď je příliš velká.");
      if (!text.trim()) throw new Error("Prázdná odpověď.");
      fp = await fingerprint(text, res.headers.get("content-type") || "");
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    const { data: outcome, error: recErr } = await service.rpc("hr_legislation_record", {
      p_id: w.id, p_fingerprint: fp, p_version_label: fp ? fp.slice(0, 12) : null, p_error: err,
    });
    if (recErr) throw new HttpError(500, recErr.message);
    results[w.id] = outcome;
  }
  return json({ ok: true, reminders, results });
}

Deno.serve(handle(async (req) => {
  const body = await req.json().catch(() => ({}));
  switch (body.action) {
    case "check": return check(req);
    default: throw new HttpError(400, "Neznama akce.");
  }
}));
