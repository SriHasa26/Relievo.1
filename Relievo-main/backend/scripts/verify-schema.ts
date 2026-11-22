// Tells you whether the v3 migration (supabase/migrations/0003_v3_notifications_sos_rooms.sql) has been applied.
//   npm run verify:schema -w backend
// Read-only. Prints PASS / FAIL per object and what to do. Never prints keys.
export {}; // module (top-level await)
process.env.MOCK_DB = "false";

const { config } = await import("../src/config");
const { createServiceClient } = await import("../src/store/supabaseRepo");

if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
  console.log("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env. Nothing was checked.");
  process.exit(2);
}
const sb = createServiceClient();

const checks: Array<[string, string, string]> = [
  ["table notifications", "notifications", "id,recipient_user_id,recipient_role,type,priority,incident_id,title,body,data,created_at,read_at"],
  ["table sos_audio", "sos_audio", "incident_id,mime,duration_s,size_bytes,transcript,data_base64,created_at"],
  ["incidents.is_sos / sos_status / sos_approximate / priority_override", "incidents", "is_sos,sos_status,sos_approximate,priority_override"],
  ["incident_channels.kind", "incident_channels", "incident_id,kind,nexconn_channel_id"],
];

let missing = 0;
for (const [label, table, columns] of checks) {
  const { error } = await sb.from(table).select(columns).limit(1);
  if (error) { missing++; console.log(`FAIL  ${label}: ${error.message}`); } else console.log(`PASS  ${label}`);
}

// The (incident_id, kind) key: try to add a second room kind for an existing room and roll it back.
const { data: ch } = await sb.from("incident_channels").select("incident_id").limit(1);
if (ch && ch[0]) {
  const probe = `schema-probe-${Date.now()}`;
  const { error } = await sb.from("incident_channels").insert({ incident_id: ch[0].incident_id, kind: "citizen", nexconn_channel_id: probe });
  if (error) { missing++; console.log(`FAIL  incident_channels allows a second room per incident: ${error.message}`); }
  else { await sb.from("incident_channels").delete().eq("nexconn_channel_id", probe); console.log("PASS  incident_channels allows a second room per incident"); }
} else {
  console.log("SKIP  incident_channels key check (no rooms stored yet)");
}

console.log(missing === 0
  ? "\nMigration 0003 is applied."
  : `\n${missing} check(s) failed. Paste supabase/migrations/0003_v3_notifications_sos_rooms.sql (the last block of supabase/all_migrations.sql) into the Supabase SQL editor and run it, then run this again.`);
process.exit(missing === 0 ? 0 : 1);
