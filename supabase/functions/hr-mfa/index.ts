// Obnova dvojfazoveho prihlasenia (migracia 69).
// { action: "use_recovery_code", code }      - prihlaseny heslom (aal1): platny
//   zalozny kod zrusi jeho faktor -> v aplikacii si zaregistruje novy.
// { action: "reset_user", user_email, reason } - len jednatel (HR_ADMIN, aal2):
//   zrusi faktor personalistky alebo uctovnicky. Jednatela len serverovo (IT).
// Kazdy reset: audit + upozornenie jednatelovi (hr_mfa_log_reset).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { json, handle, HttpError, authorize } from "../_shared/hrServer.ts";

const RESETTABLE_PROFILES = ["PERSONALISTA", "UCTOVNIK_EXT"];

function serviceClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}

async function deleteFactors(service: any, userId: string) {
  const { data, error } = await service.auth.admin.mfa.listFactors({ userId });
  if (error) throw new HttpError(500, "Overeni nelze nacist.");
  for (const f of data?.factors || []) {
    const { error: dErr } = await service.auth.admin.mfa.deleteFactor({ id: f.id, userId });
    if (dErr) throw new HttpError(500, "Overeni nelze zrusit.");
  }
  return (data?.factors || []).length;
}

async function useRecoveryCode(req: Request, body: any) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) throw new HttpError(401, "Chybi prihlaseni.");
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data: u, error: uErr } = await userClient.auth.getUser();
  if (uErr || !u?.user) throw new HttpError(401, "Neplatne prihlaseni.");
  const code = String(body.code || "").trim();
  if (!code) throw new HttpError(422, "Zadejte záložní kód.");
  const service = serviceClient();
  const { data: ok, error } = await service.rpc("hr_mfa_consume_recovery_code", { p_user_id: u.user.id, p_code: code });
  if (error) throw new HttpError(429, error.message);
  if (!ok) throw new HttpError(403, "Záložní kód neplatí nebo už byl použit.");
  await deleteFactors(service, u.user.id);
  const { error: lErr } = await service.rpc("hr_mfa_log_reset", { p_user_id: u.user.id, p_actor: u.user.id, p_method: "ZALOZNI_KOD", p_reason: "Použit záložní kód" });
  if (lErr) throw new HttpError(500, lErr.message);
  return json({ ok: true });
}

async function resetUser(req: Request, body: any) {
  // prazdny zoznam = prejde len HR_ADMIN (jednatel; bez aal2 nema ziadne opravnenia)
  const { user, service } = await authorize(req, []);
  const email = String(body.user_email || "").trim().toLowerCase();
  const reason = String(body.reason || "").trim();
  if (!reason) throw new HttpError(422, "Uveďte důvod zrušení ověření.");
  if (email === String(user.email || "").toLowerCase()) throw new HttpError(403, "Vlastní ověření jednatele ruší jen IT serverově.");
  const { data: row } = await service.from("hr_permissions").select("profile").eq("user_email", email).maybeSingle();
  if (!row || !RESETTABLE_PROFILES.includes(row.profile)) {
    throw new HttpError(403, "V aplikaci lze zrušit ověření jen personalistce a externí účetní. Jednatele ruší IT serverově.");
  }
  const { data: list, error: lErr } = await service.auth.admin.listUsers({ perPage: 1000 });
  if (lErr) throw new HttpError(500, "Uživatele nelze načíst.");
  const target = list.users.find((x: any) => String(x.email || "").toLowerCase() === email);
  if (!target) throw new HttpError(404, "Uživatel nemá účet.");
  const removed = await deleteFactors(service, target.id);
  const { error: logErr } = await service.rpc("hr_mfa_log_reset", { p_user_id: target.id, p_actor: user.id, p_method: "JEDNATEL", p_reason: reason });
  if (logErr) throw new HttpError(500, logErr.message);
  return json({ ok: true, removed });
}

Deno.serve(handle(async (req) => {
  const body = await req.json().catch(() => ({}));
  switch (body.action) {
    case "use_recovery_code": return useRecoveryCode(req, body);
    case "reset_user": return resetUser(req, body);
    default: throw new HttpError(400, "Neznama akce.");
  }
}));
