// Integracny test bezpecnosti uctov (migracia 73, hr-ucty): neuspesne
// prihlasenie zapise Auth hook; jednatel ukonci pristup odchadzajucemu
// pouzivatelovi (koniec HR, zrusene relacie, zablokovany ucet). Proti
// LOKALNEMU Supabase. Docasny pouzivatel s vymyslenymi udajmi.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { signInAal2 } from "./itTotp.js";

const URL_ = process.env.LOCAL_SUPABASE_URL;
const ANON = process.env.LOCAL_SUPABASE_ANON_KEY;
const SERVICE = process.env.LOCAL_SUPABASE_SERVICE_KEY;
const enabled = !!(URL_ && ANON && SERVICE && /^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_ || ""));
const root = path.resolve(__dirname, "../../..");
const run = Date.now().toString(36);

describe.skipIf(!enabled)("ucty: neuspesne prihlasenia a odchod (lokalny Supabase)", { timeout: 120000 }, () => {
  let service, password, userId;
  const email = `odchod.${run}@test.local`;
  const userPass = `heslo-${run}-lokal`;
  const client = () => createClient(URL_, ANON, { auth: { persistSession: false } });

  async function invoke(c, body) {
    const { data, error } = await c.functions.invoke("hr-ucty", { body });
    if (data) return { status: 200, ...data };
    return { status: error.context.status, ...(await error.context.json()) };
  }

  beforeAll(async () => {
    service = createClient(URL_, SERVICE, { auth: { persistSession: false } });
    [, password] = fs.readFileSync(path.join(root, "supabase/seed.sql"), "utf8").match(/hr\.admin@test\.local \/ (\S+)/);
    const { data, error } = await service.auth.admin.createUser({ email, password: userPass, email_confirm: true });
    if (error) throw error;
    userId = data.user.id;
    const { error: pErr } = await service.from("hr_permissions").insert({ id: `p-odchod-${run}`, user_email: email, profile: "VLASTNI",
      permissions: ["HR_VIEW_BASIC"], note: "IT test odchodu" });
    if (pErr) throw pErr;
  });
  afterAll(async () => {
    if (userId) await service.auth.admin.updateUserById(userId, { ban_duration: "none" });
  });

  it("neuspesne prihlasenie zapise server (hook), uspesne nie", async () => {
    const bad = await client().auth.signInWithPassword({ email, password: "zle-heslo" });
    expect(bad.error).toBeTruthy();
    const ok = await client().auth.signInWithPassword({ email, password: userPass });
    expect(ok.error).toBeNull();
    const { data } = await service.from("hr_login_failures").select("kind").eq("user_id", userId);
    expect(data).toEqual([{ kind: "PASSWORD" }]);
  });

  it("odchod: len jednatel; koniec HR, zrusene relacie, zablokovany ucet, audit", async () => {
    const user = client();
    expect((await user.auth.signInWithPassword({ email, password: userPass })).error).toBeNull();
    // personalistka (nie jednatel) nesmie
    const p = client();
    await signInAal2(p, service, "personalistka@test.local", password);
    expect((await invoke(p, { action: "offboard_user", user_email: email, reason: "Skončení spolupráce" })).status).toBe(403);

    const admin = client();
    await signInAal2(admin, service, "hr.admin@test.local", password);
    expect((await invoke(admin, { action: "offboard_user", user_email: email, reason: "x" })).status).toBe(422);
    expect((await invoke(admin, { action: "offboard_user", user_email: "hr.admin@test.local", reason: "Sám sebe" })).status).toBe(403);
    expect(await invoke(admin, { action: "offboard_user", user_email: email, reason: "Skončení spolupráce" })).toMatchObject({ ok: true });

    const { data: perm } = await service.from("hr_permissions").select("valid_until, note").eq("id", `p-odchod-${run}`).single();
    expect(perm.note).toMatch(/^Odchod:/);
    expect(perm.valid_until < new Date().toISOString().slice(0, 10)).toBe(true);
    // relacia neplati - obnovenie tokenu zlyha, nove prihlasenie tiez (ban)
    expect((await user.auth.refreshSession()).error).toBeTruthy();
    expect((await client().auth.signInWithPassword({ email, password: userPass })).error).toBeTruthy();
    const { data: u } = await service.auth.admin.getUserById(userId);
    expect(u.user.banned_until).toBeTruthy();
    const { data: logs } = await service.from("audit_log").select("new_value").eq("entity", "auth_user").eq("entity_id", userId);
    expect(logs.some((l) => l.new_value?.offboarded)).toBe(true);
  });
});
