// Integration checks against your REAL Supabase project (after migrations + seed). Prints PASS / FAIL per check.
//   npm run verify:supabase -w backend
// It plays the browser too (anon key + sign-in), so it can show what is enforced by RLS and what only by the backend.
// It writes and removes one throw-away incident. It never prints keys or tokens.
export {}; // module (top-level await)
process.env.MOCK_DB = "false";

const { createClient } = await import("@supabase/supabase-js");
const { config } = await import("../src/config");
const { createServiceClient, createSupabaseRepo } = await import("../src/store/supabaseRepo");
const { buildSeed, uid, DEMO_PASSWORD } = await import("../src/store/seedData");

if (!config.supabaseUrl || !config.supabaseServiceRoleKey || !config.supabaseAnonKey) {
  console.log("Missing SUPABASE_URL, SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY in backend/.env. Nothing was checked.");
  process.exit(2);
}

let failures = 0;
async function check(name: string, fn: () => Promise<boolean | void>) {
  try {
    const ok = (await fn()) !== false;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) failures++;
  } catch (e) {
    failures++;
    console.log(`FAIL  ${name}: ${(e as Error).message}`);
  }
}

const service = createServiceClient();
const repo = createSupabaseRepo(service);
const seed = buildSeed();

/** A browser-like client signed in as one demo account (anon key + password). RLS applies to it. */
async function browserAs(email: string) {
  const sb = createClient(config.supabaseUrl!, config.supabaseAnonKey!, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password: DEMO_PASSWORD });
  if (error || !data.session) throw new Error(`sign-in as ${email} failed: ${error?.message}`);
  return { sb, token: data.session.access_token, userId: data.user.id };
}
const emailOf = (n: number) => seed.users.find((u) => u.id === uid(n))!.email;

// ---- data layer ----
await check("seed rows are present (users, incidents, events, channels)", async () => {
  const [u, i, e, c] = await Promise.all([repo.users(), repo.incidents(), repo.events(), repo.channels()]);
  return u.length === seed.users.length && i.length === seed.incidents.length && e.length >= seed.events.length && c.length >= 3;
});
await check("every seeded incident has a stored AI analysis with a provider", async () => {
  const a = await repo.analyses();
  return a.length >= seed.incidents.length && a.every((x) => ["openrouter", "gemini", "fallback", "mock"].includes(x.source));
});
await check("repository round trip: add, save, read, event order", async () => {
  const id = crypto.randomUUID();
  const base = seed.incidents[0]!;
  await repo.addIncident({ ...base, id, original_text: "verify-supabase throw-away", status: "submitted", created_at: new Date().toISOString() });
  await repo.saveIncident({ ...(await repo.incident(id))!, status: "verified" });
  const read = await repo.incident(id);
  await repo.addEvent({ id: crypto.randomUUID(), incident_id: id, actor_id: null, action: "x1", meta: {}, created_at: new Date().toISOString() });
  const events = await repo.events({ incident_id: id });
  await service.from("incidents").delete().eq("id", id); // events cascade
  return read?.status === "verified" && events.length === 1 && Boolean(read.created_at.endsWith("Z"));
});
await check("only one active assignment per incident (database rule)", async () => {
  const active = seed.assignments.find((a) => a.status === "approved")!;
  const dup = { ...active, id: crypto.randomUUID(), volunteer_id: uid(11) };
  try { await repo.addAssignment(dup); await service.from("assignments").delete().eq("id", dup.id); return false; } catch { return true; }
});

// ---- auth ----
await check("backend can verify a demo user's JWT and load the role from the users table", async () => {
  const { token, userId } = await browserAs(emailOf(21));
  const { data, error } = await service.auth.getUser(token);
  const row = await repo.userById(userId);
  return !error && data.user?.id === userId && row?.role === "coordinator";
});
await check("a forged / garbage token is rejected", async () => {
  const { data, error } = await service.auth.getUser("not-a-real-token");
  return Boolean(error) || !data.user;
});

// ---- RLS (enforced by Postgres; the backend uses the service role and re-checks the same rules in code) ----
await check("RLS: anonymous visitor sees no incidents", async () => {
  const anon = createClient(config.supabaseUrl!, config.supabaseAnonKey!, { auth: { persistSession: false } });
  const { data } = await anon.from("incidents").select("id");
  return (data ?? []).length === 0;
});
await check("RLS: citizen sees only their own incidents", async () => {
  const { sb, userId } = await browserAs(emailOf(1));
  const { data } = await sb.from("incidents").select("id,reporter_id");
  const own = seed.incidents.filter((i) => i.reporter_id === uid(1)).length;
  return (data ?? []).length === own && (data ?? []).every((r) => r.reporter_id === userId);
});
await check("RLS: coordinator sees all incidents", async () => {
  const { sb } = await browserAs(emailOf(21));
  const { data } = await sb.from("incidents").select("id");
  return (data ?? []).length >= seed.incidents.length;
});
await check("RLS: volunteer sees only incidents they are assigned to", async () => {
  const { sb } = await browserAs(emailOf(11)); // Karthik: assigned to incident 106 only
  const { data } = await sb.from("incidents").select("id");
  return (data ?? []).length === 1 && data![0]!.id === uid(106);
});
await check("RLS: a citizen cannot write events or change an incident", async () => {
  const { sb, userId } = await browserAs(emailOf(1));
  const ev = await sb.from("incident_events").insert({ incident_id: uid(101), actor_id: userId, action: "forged", meta: {} });
  const up = await sb.from("incidents").update({ status: "resolved" }).eq("id", uid(101)).select();
  return Boolean(ev.error) && (up.data ?? []).length === 0;
});

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
