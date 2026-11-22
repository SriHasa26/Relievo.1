import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../src/store/store";
import { buildSeed, uid } from "../src/store/seedData";
import { mockGroupMembers, resetMockNexconn } from "../src/integrations/nexconn.adapter";
import { assignVolunteer, reassignVolunteer, respondToAssignment } from "../src/services/dispatch";
import { VOLUNTEER_HUB_ID, citizenRoomAccess, ensureVolunteerHub, hubAccess, listRooms, postHubAlert, resetHubState, roomAccess } from "../src/services/rooms";

const user = (n: number) => db.users.find((u) => u.id === uid(n))!;
const FOOD = uid(103); // reported by Meena Iyer (citizen 3)
const meena = () => user(3);
const priya = () => user(21);
const sana = () => user(14);
const karthik = () => user(11);

beforeEach(() => {
  resetDb(buildSeed());
  resetMockNexconn();
  resetHubState();
});

async function accepted(volunteer = sana()) {
  const a = await assignVolunteer(priya(), FOOD, volunteer.id);
  await respondToAssignment(volunteer, a.id, true);
  return a;
}

describe("citizen channel (separate from the operations room)", () => {
  it("shows a waiting state until a volunteer accepts", async () => {
    await assignVolunteer(priya(), FOOD, sana().id); // approved, not yet accepted
    await expect(citizenRoomAccess(meena(), FOOD)).rejects.toThrow(/waiting for a volunteer/i);
  });

  it("is created when a volunteer accepts, with citizen + volunteer + coordinator; the operations room stays coordinator + volunteer", async () => {
    await accepted();
    const citizenRoom = db.channels.find((c) => c.incident_id === FOOD && c.kind === "citizen")!;
    const opsRoom = db.channels.find((c) => c.incident_id === FOOD && c.kind !== "citizen")!;
    expect(citizenRoom.nexconn_channel_id).not.toBe(opsRoom.nexconn_channel_id);
    expect(mockGroupMembers(citizenRoom.nexconn_channel_id).sort()).toEqual([meena().id, priya().id, sana().id].sort());
    expect(mockGroupMembers(opsRoom.nexconn_channel_id).sort()).toEqual([priya().id, sana().id].sort());
    expect(db.events.some((e) => e.incident_id === FOOD && e.action === "citizen_room_created")).toBe(true);
  });

  it("only the reporting citizen, the accepted volunteer and coordinators may open it (403 otherwise)", async () => {
    await accepted();
    for (const ok of [meena(), sana(), priya()]) await expect(citizenRoomAccess(ok, FOOD)).resolves.toHaveProperty("groupId");
    await expect(citizenRoomAccess(user(1), FOOD)).rejects.toThrow(/not a member/i);   // another citizen
    await expect(citizenRoomAccess(karthik(), FOOD)).rejects.toThrow(/not a member/i); // a volunteer who did not accept
    await expect(citizenRoomAccess(user(31), FOOD)).rejects.toThrow(/not a member/i);  // NGO
  });

  it("the citizen cannot open the operations room", async () => {
    await accepted();
    await expect(roomAccess(meena(), FOOD)).rejects.toThrow(/not a member/i);
  });

  it("a replaced volunteer leaves both rooms and the new one joins when they accept", async () => {
    const a = await accepted();
    const citizenRoom = db.channels.find((c) => c.incident_id === FOOD && c.kind === "citizen")!;
    const next = await reassignVolunteer(priya(), a.id, karthik().id);
    expect(mockGroupMembers(citizenRoom.nexconn_channel_id)).not.toContain(sana().id);
    await respondToAssignment(karthik(), next.id, true);
    expect(mockGroupMembers(citizenRoom.nexconn_channel_id)).toContain(karthik().id);
    await expect(citizenRoomAccess(sana(), FOOD)).rejects.toThrow(/not a member/i);
  });

  it("lists rooms per person", async () => {
    await accepted();
    expect((await listRooms(meena())).map((r) => r.kind)).toEqual(["citizen"]);
    expect((await listRooms(sana())).map((r) => r.kind).sort()).toEqual(["citizen", "hub", "operations", "operations"]); // the seed also has Sana on incident 105
    expect((await listRooms(user(31))).length).toBe(0);
  });
});

describe("Volunteer Hub", () => {
  it("contains every volunteer and every coordinator, created idempotently", async () => {
    await ensureVolunteerHub();
    await ensureVolunteerHub();
    const want = db.users.filter((u) => u.role === "volunteer" || u.role === "coordinator").map((u) => u.id).sort();
    expect(mockGroupMembers(VOLUNTEER_HUB_ID).sort()).toEqual(want);
  });

  it("volunteers (even unverified ones) and coordinators can open it, with or without an assignment; others cannot", async () => {
    for (const u of [karthik(), user(13), priya()]) await expect(hubAccess(u)).resolves.toMatchObject({ groupId: VOLUNTEER_HUB_ID });
    await expect(hubAccess(meena())).rejects.toThrow(/volunteers and coordinators/i);
    await expect(hubAccess(user(31))).rejects.toThrow();
  });

  it("alerts can be posted to it (system message)", async () => {
    await expect(postHubAlert("SOS alert: test")).resolves.toBeUndefined();
  });
});
