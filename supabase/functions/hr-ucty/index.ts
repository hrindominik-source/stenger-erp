// Odchod pouzivatela (migracia 73, balik G).
// { action: "offboard_user", user_email, reason } - len jednatel (HR_ADMIN, aal2):
//   koniec pristupu do HR, zrusenie relacii (hr_offboard_user) a zablokovanie
//   uctu (admin API). Jednatela a seba nie - tych riesi IT serverovo.
import { json, handle, HttpError, authorize } from "../_shared/hrServer.ts";

// ~100 rokov: Auth nema "navzdy"; odblokovanie = IT (ban_duration "none")
const BAN = "876000h";

async function offboardUser(req: Request, body: any) {
  const { user, service } = await authorize(req, []);
  const email = String(body.user_email || "").trim().toLowerCase();
  const reason = String(body.reason || "").trim();
  if (reason.length < 5) throw new HttpError(422, "Uveďte důvod (alespoň 5 znaků).");
  if (email === String(user.email || "").toLowerCase()) throw new HttpError(403, "Vlastní přístup v aplikaci neukončíte.");
  const { data: list, error: lErr } = await service.auth.admin.listUsers({ perPage: 1000 });
  if (lErr) throw new HttpError(500, "Uživatele nelze načíst.");
  const target = list.users.find((x: any) => String(x.email || "").toLowerCase() === email);
  if (!target) throw new HttpError(404, "Uživatel nemá účet.");
  const { error: oErr } = await service.rpc("hr_offboard_user", { p_user_id: target.id, p_actor: user.id, p_reason: reason });
  if (oErr) throw new HttpError(403, oErr.message);
  const { error: bErr } = await service.auth.admin.updateUserById(target.id, { ban_duration: BAN });
  if (bErr) throw new HttpError(500, "Přístup do HR ukončen, ale účet se nepodařilo zablokovat – kontaktujte IT.");
  return json({ ok: true });
}

Deno.serve(handle(async (req) => {
  const body = await req.json().catch(() => ({}));
  switch (body.action) {
    case "offboard_user": return offboardUser(req, body);
    default: throw new HttpError(400, "Neznama akce.");
  }
}));
