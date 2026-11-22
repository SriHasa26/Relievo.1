// Checks the REAL Nexconn server API end to end (MOCK_CHAT is forced to false for this script).
// Needs NEXCONN_APP_KEY, NEXCONN_APP_SECRET and NEXCONN_API_DOMAIN in backend/.env.
//   npm run verify:nexconn -w backend
// It prints PASS / FAIL per check and never prints keys, secrets or tokens.
// It creates real (small, synthetic) groups in your Nexconn app. Safe to re-run.
export {}; // makes this file a module (top-level await)
process.env.MOCK_CHAT = "false";

const { randomUUID } = await import("node:crypto");
const { config } = await import("../src/config");
const nexconn = await import("../src/integrations/nexconn.adapter");
const store = await import("../src/store/store"); // use store.db: it is replaced by resetDb
const { buildSeed, uid } = await import("../src/store/seedData");
const { assignVolunteer } = await import("../src/services/dispatch");
const { roomAccess } = await import("../src/services/rooms");

let failures = 0;
async function check(name: string, fn: () => Promise<boolean | void>) {
  try {
    const ok = (await fn()) !== false;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) failures++;
  } catch (e) {
    failures++;
    console.log(`FAIL  ${name}: ${(e as Error).message}`); // adapter errors never contain secrets
  }
}

if (!config.nexconnAppKey || !config.nexconnAppSecret || !config.nexconnApiDomain) {
  console.log("Missing NEXCONN_APP_KEY, NEXCONN_APP_SECRET or NEXCONN_API_DOMAIN in backend/.env. Nothing was checked.");
  process.exit(2);
}

store.resetDb(buildSeed());
const user = (n: number) => store.db.users.find((u) => u.id === uid(n))!;
const priya = user(21), sana = user(14), karthik = user(11), imran = user(12);
let token = "";

await check("issue a token for the coordinator", async () => {
  token = (await nexconn.issueUserToken({ userId: priya.id, name: priya.name })).token;
  return token.length > 10 && !token.startsWith("mock-token.");
});
await check("issue a token for the volunteer", async () => {
  const t = (await nexconn.issueUserToken({ userId: sana.id, name: sana.name })).token;
  return t.length > 10 && t !== token;
});

const groupId = randomUUID();
await check("create a group with coordinator as owner and volunteer as member", async () => {
  await nexconn.createGroup({ groupId, name: "ReliefRelay verify script", ownerId: priya.id, memberIds: [sana.id] });
});
await check("add a member", async () => { await nexconn.addMember({ groupId, userId: karthik.id }); });
await check("post a system message", async () => { await nexconn.postSystemMessage({ groupId, text: "verify-nexconn script: hello" }); });
await check("remove a member", async () => { await nexconn.removeMember({ groupId, userId: karthik.id }); });

// App-level membership: assign Sana to a verified incident (creates a real room), then ask who may open it.
const incidentId = uid(103);
await check("assignment creates the real incident room", async () => {
  await assignVolunteer(priya, incidentId, sana.id);
  return store.db.channels.some((c) => c.incident_id === incidentId);
});
await check("coordinator may open the room", async () => { await roomAccess(priya, incidentId); });
await check("assigned volunteer may open the room", async () => { await roomAccess(sana, incidentId); });
await check("a non-member volunteer is refused (403)", async () => {
  try { await roomAccess(imran, incidentId); return false; } catch (e) { return (e as { status?: number }).status === 403; }
});
await check("a citizen is refused (403)", async () => {
  try { await roomAccess(user(3), incidentId); return false; } catch (e) { return (e as { status?: number }).status === 403; }
});

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
