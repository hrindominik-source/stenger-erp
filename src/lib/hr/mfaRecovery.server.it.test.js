// Integracny test obnovy dvojfazoveho prihlasenia (migracia 69, hr-mfa):
// zalozny kod zrusi vlastny faktor; jednatel zrusi faktor personalistky a
// uctovnicky, nie jednatela; kazdy reset v audite a upozorneniach. Proti
// LOKALNEMU Supabase.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { signInAal2 } from "./itTotp.js";

const URL_ = process.env.LOCAL_SUPABASE_URL;
const ANON = process.env.LOCAL_SUPABASE_ANON_KEY;
const SERVICE = process.env.LOCAL_SUPABASE_SERVICE_KEY;
const enabled = !!(URL_ && ANON && SERVICE && /^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_ || ""));
const root = path.resolve(__dirname, "../../..");

describe.skipIf(!enabled)("obnova MFA (lokalny Supabase)", { timeout: 120000 }, () => {
  let service, password;
  const client = () => createClient(URL_, ANON, { auth: { persistSession: false } });

  async function invoke(c, body) {
    const { data, error } = await c.functions.invoke("hr-mfa", { body });
    if (data) return { status: 200, ...data };
    return { status: error.context.status, ...(await error.context.json()) };
  }
  async function factorsOf(email) {
    const { data } = await service.auth.admin.listUsers({ perPage: 1000 });
    const u = data.users.find((x) => x.email === email);
    const { data: f } = await service.auth.admin.mfa.listFactors({ userId: u.id });
    return { id: u.id, count: (f.factors || []).length };
  }

  beforeAll(async () => {
    service = createClient(URL_, SERVICE, { auth: { persistSession: false } });
    [, password] = fs.readFileSync(path.join(root, "supabase/seed.sql"), "utf8").match(/hr\.admin@test\.local \/ (\S+)/);
  });

  it("zalozny kod: zrusi vlastny faktor, druhy raz neplati, jednatel dostane upozornenie", async () => {
    const p = client();
    await signInAal2(p, service, "personalistka@test.local", password);
    const { data: codes, error } = await p.rpc("hr_mfa_generate_recovery_codes");
    expect(error).toBeNull();
    expect(codes).toHaveLength(10);

    // novy pristroj: len heslo (aal1)
    const p2 = client();
    expect((await p2.auth.signInWithPassword({ email: "personalistka@test.local", password })).error).toBeNull();
    expect((await invoke(p2, { action: "use_recovery_code", code: "00000-00000" })).status).toBe(403);
    expect((await factorsOf("personalistka@test.local")).count).toBe(1);
    const r = await invoke(p2, { action: "use_recovery_code", code: codes[0] });
    expect(r).toMatchObject({ status: 200, ok: true });
    const { id, count } = await factorsOf("personalistka@test.local");
    expect(count).toBe(0);
    expect((await invoke(p2, { action: "use_recovery_code", code: codes[0] })).status).toBe(403);
    // po zruseni moze hned zaregistrovat novu aplikaciu
    expect((await p2.auth.mfa.enroll({ factorType: "totp", friendlyName: `it-${Date.now()}` })).error).toBeNull();

    const { data: n } = await service.from("hr_notifications").select("data").eq("event_type", "MFA_RESET").eq("entity_id", id)
      .order("created_at", { ascending: false }).limit(1).single();
    expect(n.data).toMatchObject({ method: "ZALOZNI_KOD", email: "personalistka@test.local" });
    await service.from("hr_mfa_recovery_failures").delete().eq("user_id", id);
  });

  it("anonym zalozny kod nepouzije", async () => {
    expect((await invoke(client(), { action: "use_recovery_code", code: "AAAAA-AAAAA" })).status).toBe(401);
  });

  it("jednatel zrusi overenie personalistke a uctovnicke (s dovodom), nie jednatelovi; personalistka nikomu", async () => {
    const admin = client();
    await signInAal2(admin, service, "hr.admin@test.local", password);
    const ucetni = client();
    await signInAal2(ucetni, service, "ucetni@test.local", password);
    expect((await factorsOf("ucetni@test.local")).count).toBe(1);

    expect((await invoke(admin, { action: "reset_user", user_email: "ucetni@test.local", reason: " " })).status).toBe(422);
    const r = await invoke(admin, { action: "reset_user", user_email: "ucetni@test.local", reason: "Ztracený telefon (IT test)" });
    expect(r).toMatchObject({ status: 200, ok: true, removed: 1 });
    const { id, count } = await factorsOf("ucetni@test.local");
    expect(count).toBe(0);
    const { data: a } = await service.from("audit_log").select("new_value, changed_by").eq("entity", "auth_mfa").eq("entity_id", id)
      .eq("action", "delete").order("created_at", { ascending: false }).limit(1).single();
    expect(a.new_value).toMatchObject({ method: "JEDNATEL", reason: "Ztracený telefon (IT test)" });
    expect(a.changed_by).toBe((await factorsOf("hr.admin@test.local")).id);

    // jednatela (aj seba) len IT serverovo
    expect((await invoke(admin, { action: "reset_user", user_email: "hr.admin@test.local", reason: "x" })).status).toBe(403);
    expect((await factorsOf("hr.admin@test.local")).count).toBe(1);

    // personalistka (aal2) resetovat nemoze
    const p = client();
    await signInAal2(p, service, "personalistka@test.local", password);
    expect((await invoke(p, { action: "reset_user", user_email: "ucetni@test.local", reason: "x" })).status).toBe(403);
    // jednatel bez overenia kodom (aal1) tiez nie
    const adminAal1 = client();
    await adminAal1.auth.signInWithPassword({ email: "hr.admin@test.local", password });
    expect((await invoke(adminAal1, { action: "reset_user", user_email: "personalistka@test.local", reason: "x" })).status).toBe(403);
    expect((await factorsOf("personalistka@test.local")).count).toBe(1);
  });
});
