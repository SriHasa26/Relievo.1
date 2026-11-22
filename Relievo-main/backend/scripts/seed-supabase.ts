// Seeds your Supabase project with the synthetic demo data, then prepares everything the demo needs:
//   1. Supabase Auth users (one per demo account, password "demo1234"), 2. all table rows,
//   3. an AI analysis for every seeded incident (stored, so the demo needs no live AI calls for them),
//   4. the Nexconn groups for seeded rooms, and every user registered with Nexconn (skipped when MOCK_CHAT=true).
// Run the migrations first (supabase/all_migrations.sql in the SQL editor), then:   npm run seed:supabase -w backend
// Safe to run again: rows are upserted by id.
export {}; // module (top-level await)
process.env.MOCK_DB = "false"; // this script only makes sense against Supabase
process.env.MOCK_AI = "false"; // use the real AI chain for the stored analyses (falls back to keywords if it fails)

const { config } = await import("../src/config");
const { createServiceClient } = await import("../src/store/supabaseRepo");
const { buildSeed, DEMO_PASSWORD } = await import("../src/store/seedData");
const { extractIncident } = await import("../src/services/extraction");
const { registerAllUsers, restoreRooms, ensureVolunteerHub } = await import("../src/services/rooms");

if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
  throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env first.");
}
const sb = createServiceClient();
const seed = buildSeed();

// 1. Auth users. We ask Supabase to use our ids; if it assigns different ones we remap them below.
const idMap = new Map<string, string>();
for (const u of seed.users) {
  const { data, error } = await sb.auth.admin.createUser({
    id: u.id, email: u.email, password: u.password ?? DEMO_PASSWORD, email_confirm: true,
  } as Parameters<typeof sb.auth.admin.createUser>[0]);
  if (error) {
    if (!/already|exists|registered/i.test(error.message)) throw new Error(`createUser ${u.email}: ${error.message}`);
    // Already created by an earlier run: find its id.
    const { data: list } = await sb.auth.admin.listUsers({ perPage: 200 });
    const existing = list?.users.find((x) => x.email === u.email);
    if (!existing) throw new Error(`createUser ${u.email}: exists but cannot be found`);
    idMap.set(u.id, existing.id);
  } else {
    idMap.set(u.id, data.user.id);
  }
}
const remapped = [...idMap].filter(([a, b]) => a !== b).length;
let json = JSON.stringify(seed);
for (const [oldId, newId] of idMap) if (oldId !== newId) json = json.split(oldId).join(newId);
const data = JSON.parse(json) as typeof seed;
console.log(`auth users ready: ${idMap.size}${remapped ? ` (${remapped} got new ids from Supabase)` : " (ids kept)"}`);

// 2. Rows. Passwords never go into the users table.
const upsert = async (table: string, rows: object[], onConflict?: string) => {
  const { error } = await sb.from(table).upsert(rows, onConflict ? { onConflict } : undefined);
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`seeded ${table}: ${rows.length}`);
};
await upsert("users", data.users.map(({ password: _p, ...u }) => u));
await upsert("volunteer_profiles", data.volunteerProfiles);
await upsert("organisations", data.organisations);
await upsert("incidents", data.incidents);

// 3. AI analysis only for seeded incidents that have NONE stored yet (the extraction service spaces calls 3 s apart).
//    Re-running the seed never calls the AI again for an incident that already has a stored analysis.
const { data: stored, error: storedError } = await sb.from("incident_ai_analysis").select("incident_id");
if (storedError) throw new Error(`incident_ai_analysis: ${storedError.message}`);
const haveAnalysis = new Set((stored ?? []).map((r) => String(r.incident_id)));
const analyses = [];
for (const incident of data.incidents) {
  if (haveAnalysis.has(incident.id)) { console.log(`analysis for ${incident.id.slice(-3)}: kept (already stored, no AI call)`); continue; }
  const ai = await extractIncident(incident.original_text);
  analyses.push({ incident_id: incident.id, ...ai });
  console.log(`analysis for ${incident.id.slice(-3)}: ${ai.source} (${ai.model_version})`);
}
if (analyses.length) await upsert("incident_ai_analysis", analyses);

await upsert("assignments", data.assignments);
await upsert("resources", data.resources);
await upsert("resource_allocations", data.allocations);
await upsert("incident_events", data.events);
await upsert("incident_channels", data.channels);

// 4. Nexconn: register users and create the groups for the seeded rooms (real chat only).
if (!config.mockChat) {
  await registerAllUsers();
  await restoreRooms();
  await ensureVolunteerHub().catch((e: Error) => console.log(`Volunteer Hub skipped: ${e.message}`));
  console.log("Nexconn: users registered, seeded rooms created, Volunteer Hub checked");
} else {
  console.log("MOCK_CHAT=true: Nexconn step skipped");
}
console.log(`Done. Demo accounts use password "${DEMO_PASSWORD}". All rows are synthetic.`);
