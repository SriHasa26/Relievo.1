// Puts the demo back to its original state. Run it before recording the video and before submitting:
//   npm run reset:demo -w backend
// It REMOVES everything created after the seed (incidents, SOS recordings, assignments, resource allocations, events,
// extra chat-room rows and ALL notifications) and RESTORES the seeded rows (statuses, volunteers' availability, stock, timeline,
// and fresh "minutes ago" times). Stored AI analyses are kept: nothing is sent to the AI. Existing Nexconn rooms are reused
// (nothing is deleted in Nexconn; stored room ids are kept and their members are re-checked).
// Supabase Auth accounts are not touched. Never prints keys.
//   npm run reset:demo -w backend -- --dry-run     only PRINTS what it would delete (counts per table); changes nothing.
export {}; // module (top-level await)

const { config } = await import("../src/config");

if (config.mockDb) {
  console.log("MOCK_DB=true: the in-memory demo data resets by itself every time the backend restarts. Nothing to do.");
  process.exit(0);
}
const { createServiceClient } = await import("../src/store/supabaseRepo");
const { buildSeed } = await import("../src/store/seedData");

if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
  console.log("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env. Nothing was changed.");
  process.exit(2);
}
const DRY = process.argv.includes("--dry-run");
const sb = createServiceClient();
const seed = buildSeed();
const list = (ids: string[]) => `(${ids.join(",")})`;
const ok = (msg: string) => console.log(`done  ${msg}`);
const warn = (msg: string) => console.log(`warn  ${msg}`);
const check = (what: string, error: { message: string } | null) => { if (error) throw new Error(`${what}: ${error.message}`); };

// Did the v3 migration run? (decides whether the new columns exist)
const probe = await sb.from("incidents").select("is_sos").limit(1);
const migrated = !probe.error;
if (!migrated) warn("the v3 migration (0003) is not applied yet: restoring the original tables only. Run `npm run verify:schema -w backend`.");


const count = async (table: string, build: (q: any) => any): Promise<number> => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { count: n, error } = await build(sb.from(table).select("*", { count: "exact", head: true }));
  if (error) throw new Error(`${table}: ${error.message}`);
  return n ?? 0;
};
const seedIncidentIds = seed.incidents.map((i) => i.id);

if (DRY) {
  console.log("DRY RUN: nothing will be changed. What `reset:demo` would remove:\n");
  const rows: Array<[string, number]> = [];
  rows.push(["incidents created after the seed", await count("incidents", (q) => q.not("id", "in", list(seedIncidentIds)))]);
  rows.push(["  their assignments (cascade)", await count("assignments", (q) => q.not("incident_id", "in", list(seedIncidentIds)))]);
  rows.push(["  their events (cascade)", await count("incident_events", (q) => q.not("incident_id", "in", list(seedIncidentIds)))]);
  rows.push(["  their resource allocations (cascade)", await count("resource_allocations", (q) => q.not("incident_id", "in", list(seedIncidentIds)))]);
  rows.push(["  their AI analyses (cascade)", await count("incident_ai_analysis", (q) => q.not("incident_id", "in", list(seedIncidentIds)))]);
  rows.push(["  their chat-room rows (cascade)", await count("incident_channels", (q) => q.not("incident_id", "in", list(seedIncidentIds)))]);
  rows.push(["extra assignments on seeded incidents", await count("assignments", (q) => q.in("incident_id", seedIncidentIds).not("id", "in", list(seed.assignments.map((a) => a.id))))]);
  rows.push(["extra allocations on seeded incidents", await count("resource_allocations", (q) => q.in("incident_id", seedIncidentIds).not("id", "in", list(seed.allocations.map((a) => a.id))))]);
  rows.push(["extra events on seeded incidents", await count("incident_events", (q) => q.in("incident_id", seedIncidentIds).not("id", "in", list(seed.events.map((e) => e.id))))]);
  if (migrated) {
    rows.push(["notifications (all)", await count("notifications", (q) => q.neq("id", "00000000-0000-0000-0000-000000000000"))]);
    rows.push(["citizen chat-room rows", await count("incident_channels", (q) => q.neq("kind", "operations"))]);
    rows.push(["SOS audio clips", await count("sos_audio", (q) => q.neq("incident_id", "00000000-0000-0000-0000-000000000000"))]);
  }
  for (const [label, n] of rows) console.log(`${String(n).padStart(5)}  ${label}`);
  console.log(`\nIt would then restore ${seed.incidents.length} incidents, ${seed.assignments.length} assignments, ${seed.events.length} events, ${seed.resources.length} resources and ${seed.volunteerProfiles.length} volunteer profiles from the seed.`);
  console.log("Stored AI analyses of seeded incidents are kept. Nexconn is not touched. Nothing was changed.");
  process.exit(0);
}

// 1. notifications: all of them (they only describe activity that is being reset)
if (migrated) {
  const { error } = await sb.from("notifications").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  check("notifications", error);
  ok("notifications cleared");
}

// 2. incidents created after the seed (their assignments, events, allocations, analyses, SOS audio and room rows cascade)
{
  const { data, error } = await sb.from("incidents").delete().not("id", "in", list(seedIncidentIds)).select("id");
  check("incidents", error);
  ok(`removed ${data?.length ?? 0} incident(s) created after the seed`);
}

// 3. extra rows on the seeded incidents
async function prune(table: string, keep: string[], what: string) {
  const { data, error } = await sb.from(table).delete().in("incident_id", seedIncidentIds).not("id", "in", list(keep)).select("id");
  check(table, error);
  ok(`removed ${data?.length ?? 0} extra ${what}`);
}
await prune("assignments", seed.assignments.map((a) => a.id), "assignment(s) on seeded incidents");
await prune("resource_allocations", seed.allocations.map((a) => a.id), "allocation(s)");
await prune("incident_events", seed.events.map((e) => e.id), "timeline event(s)");
if (migrated) {
  const { data, error } = await sb.from("incident_channels").delete().neq("kind", "operations").select("incident_id");
  check("incident_channels", error);
  ok(`removed ${data?.length ?? 0} citizen chat room row(s) (the Nexconn groups are left alone)`);
  await sb.from("sos_audio").delete().in("incident_id", seedIncidentIds); // none expected
}

// 4. restore the seeded rows
const upsert = async (table: string, rows: object[], onConflict?: string) => {
  const { error } = await sb.from(table).upsert(rows, onConflict ? { onConflict } : undefined);
  check(table, error);
  ok(`restored ${table}: ${rows.length}`);
};
// users and profiles are tied to Supabase Auth accounts: restore only the ones that exist (run `npm run seed:supabase -w backend` once to create new seed accounts)
const { data: existingUsers, error: usersError } = await sb.from("users").select("id");
check("users", usersError);
const known = new Set((existingUsers ?? []).map((u) => String(u.id)));
const newAccounts = seed.users.filter((u) => !known.has(u.id));
if (newAccounts.length) warn(`${newAccounts.length} seed account(s) do not exist yet (${newAccounts.map((u) => u.name).join(", ")}): run \`npm run seed:supabase -w backend\` once.`);
await upsert("users", seed.users.filter((u) => known.has(u.id)).map(({ password: _p, ...u }) => u));
await upsert("volunteer_profiles", seed.volunteerProfiles.filter((p) => known.has(p.user_id)));
await upsert("organisations", seed.organisations);
const incidents = migrated
  ? seed.incidents.map((i) => ({ ...i, is_sos: false, sos_status: null, sos_approximate: false, priority_override: null }))
  : seed.incidents;
await upsert("incidents", incidents);
await upsert("assignments", seed.assignments);
await upsert("resources", seed.resources);
await upsert("resource_allocations", seed.allocations);
await upsert("incident_events", seed.events);

// stored AI analyses stay as they are; only a missing one is restored (from the seed, without calling the AI)
{
  const { data, error } = await sb.from("incident_ai_analysis").select("incident_id");
  check("incident_ai_analysis", error);
  const have = new Set((data ?? []).map((r) => String(r.incident_id)));
  const missing = seed.analyses.filter((a) => !have.has(a.incident_id));
  if (missing.length) await upsert("incident_ai_analysis", missing);
  else ok("kept the stored AI analyses (no AI calls)");
}

// room ids: keep the ones already stored (they point at existing Nexconn groups); add a seeded one only if its row is missing
{
  const { data, error } = await sb.from("incident_channels").select("incident_id").in("incident_id", seedIncidentIds);
  check("incident_channels", error);
  const have = new Set((data ?? []).map((r) => String(r.incident_id)));
  const missing = seed.channels.filter((c) => !have.has(c.incident_id)).map((c) => (migrated ? { ...c, kind: "operations" } : c));
  if (missing.length) { const { error: e } = await sb.from("incident_channels").insert(missing); check("incident_channels", e); }
  ok(`kept ${have.size} stored room id(s)${missing.length ? `, added ${missing.length}` : ""}`);
}

// 5. Nexconn: reuse the existing rooms and the Volunteer Hub (re-checks members; creates nothing that already exists)
if (!config.mockChat) {
  try {
    const { restoreRooms, ensureVolunteerHub } = await import("../src/services/rooms");
    await restoreRooms();
    await ensureVolunteerHub();
    ok("Nexconn rooms and the Volunteer Hub re-checked (existing ones reused)");
  } catch (e) {
    warn(`Nexconn check skipped: ${(e as Error).message}`);
  }
}
console.log("\nDemo reset. All data is synthetic. Supabase Auth accounts were not touched.");
