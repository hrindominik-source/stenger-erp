// Integracny test hr-legislativa (migracia 74): kontrolu spusti len jednatel
// alebo planovac (service role); vytvori pripomienky revizii. Zdroje su
// vypnute - test nevolá e-Sbirku. Proti LOKALNEMU Supabase.
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

describe.skipIf(!enabled)("hr-legislativa (lokalny Supabase)", { timeout: 120000 }, () => {
  let service, password;
  const client = () => createClient(URL_, ANON, { auth: { persistSession: false } });
  async function invoke(c, body) {
    const { data, error } = await c.functions.invoke("hr-legislativa", { body });
    if (data) return { status: 200, ...data };
    return { status: error.context.status, ...(await error.context.json()) };
  }

  beforeAll(async () => {
    service = createClient(URL_, SERVICE, { auth: { persistSession: false } });
    [, password] = fs.readFileSync(path.join(root, "supabase/seed.sql"), "utf8").match(/hr\.admin@test\.local \/ (\S+)/);
  });

  it("personalistka nie, jednatel a planovac ano; vypnuty zdroj sa nevola", async () => {
    const p = client();
    await signInAal2(p, service, "personalistka@test.local", password);
    expect((await invoke(p, { action: "check" })).status).toBe(403);
    const admin = client();
    await signInAal2(admin, service, "hr.admin@test.local", password);
    const r = await invoke(admin, { action: "check" });
    expect(r).toMatchObject({ ok: true, results: {} });
    expect((await invoke(service, { action: "check" }))).toMatchObject({ ok: true });
    const { data: w } = await service.from("hr_legislation_watch").select("enabled, last_checked_at").eq("id", "ZP_262_2006").single();
    expect(w).toEqual({ enabled: false, last_checked_at: null });
    const { data: n } = await service.from("hr_notifications").select("id").eq("event_type", "REVISION_DUE").is("resolved_at", null);
    expect(n.length).toBeGreaterThan(0); // polrocna revizia (lokalne nepotvrdena)
  });
});
