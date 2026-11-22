import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../src/store/store";
import { buildSeed, uid } from "../src/store/seedData";
import { mockGroupMembers, resetMockNexconn } from "../src/integrations/nexconn.adapter";
import { assignVolunteer, reassignVolunteer, respondToAssignment } from "../src/services/dispatch";
import { chatContacts, chatToken, roomAccess } from "../src/services/rooms";

const user = (n: number) => db.users.find((u) => u.id === uid(n))!;
const FOOD = uid(103);
const coordinator = () => user(21);
const sana = () => user(14);
const karthik = () => user(11);

beforeEach(() => {
  resetDb(buildSeed());
  resetMockNexconn();
});

describe("incident rooms", () => {
  it("assignment creates the room with only the coordinator and the volunteer", async () => {
    await assignVolunteer(coordinator(), FOOD, sana().id);
    const channel = db.channels.find((c) => c.incident_id === FOOD)!;
    expect(channel).toBeDefined();
    expect(mockGroupMembers(channel.nexconn_channel_id).sort()).toEqual([coordinator().id, sana().id].sort());
    expect(db.events.some((e) => e.incident_id === FOOD && e.action === "room_created")).toBe(true);
  });

  it("only the coordinator and the assigned volunteer may get the room", async () => {
    await assignVolunteer(coordinator(), FOOD, sana().id);
    await expect(roomAccess(coordinator(), FOOD)).resolves.toHaveProperty("groupId");
    await expect(roomAccess(sana(), FOOD)).resolves.toHaveProperty("groupId");
    await expect(roomAccess(karthik(), FOOD)).rejects.toThrow(/not a member/);
    await expect(roomAccess(user(3), FOOD)).rejects.toThrow(/not a member/); // citizen
  });

  it("no room before assignment", async () => {
    await expect(roomAccess(coordinator(), FOOD)).rejects.toThrow(/No chat room/);
  });

  it("decline removes the volunteer from the room and from access", async () => {
    const a = await assignVolunteer(coordinator(), FOOD, sana().id);
    await respondToAssignment(sana(), a.id, false);
    const groupId = db.channels.find((c) => c.incident_id === FOOD)!.nexconn_channel_id;
    expect(mockGroupMembers(groupId)).not.toContain(sana().id);
    await expect(roomAccess(sana(), FOOD)).rejects.toThrow(/not a member/);
  });

  it("reassign swaps the volunteer in the same room", async () => {
    const a = await assignVolunteer(coordinator(), FOOD, sana().id);
    await reassignVolunteer(coordinator(), a.id, karthik().id);
    const groupId = db.channels.find((c) => c.incident_id === FOOD)!.nexconn_channel_id;
    const members = mockGroupMembers(groupId);
    expect(members).toContain(karthik().id);
    expect(members).not.toContain(sana().id);
    expect(db.channels.filter((c) => c.incident_id === FOOD)).toHaveLength(1);
  });
});

describe("token and contacts", () => {
  it("issues a token for the caller only", async () => {
    const t = await chatToken(sana());
    expect(t.userId).toBe(sana().id);
  });

  it("citizens get no DM contacts; volunteers only see coordinators they work with; coordinators see verified volunteers", async () => {
    expect(await chatContacts(user(1))).toEqual([]);
    expect((await chatContacts(sana())).map((c) => c.id).sort()).toEqual([uid(21), uid(22)]); // Sana worked with both seeded coordinators
    const ids = (await chatContacts(coordinator())).map((c) => c.id);
    expect(ids).toContain(sana().id);
    expect(ids).not.toContain(uid(13)); // unverified Divya
    expect((await chatContacts(coordinator())).every((c) => c.role === "volunteer")).toBe(true);
  });
});
