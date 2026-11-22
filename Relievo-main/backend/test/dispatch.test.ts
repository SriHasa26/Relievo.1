import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../src/store/store";
import { buildSeed, uid } from "../src/store/seedData";
import { assignVolunteer, matchesFor, reassignVolunteer, resolveIncident, respondToAssignment } from "../src/services/dispatch";
import { activeAssignment, canSee, incidentEvents } from "../src/services/incidents";

const user = (n: number) => db.users.find((u) => u.id === uid(n))!;
const coordinator = () => user(21);
const FOOD = uid(103); // verified, food
const RESCUE = uid(104); // verified, rescue
const incident = (id: string) => db.incidents.find((i) => i.id === id)!;
const sana = () => user(14);
const karthik = () => user(11);

beforeEach(() => resetDb(buildSeed()));

describe("matching list", () => {
  it("excludes busy Lakshmi and unverified Divya, with reasons", async () => {
    const m = await matchesFor(FOOD);
    expect(m.find((x) => x.volunteer_id === uid(15))).toMatchObject({ eligible: false });
    expect(m.find((x) => x.volunteer_id === uid(13))).toMatchObject({ eligible: false });
    expect(m.filter((x) => x.eligible).map((x) => x.volunteer_id)).toEqual(
      expect.arrayContaining([uid(11), uid(14)]),
    );
    expect(m[0]!.breakdown).not.toBeNull();
  });

  it("recommends the rescue-certified volunteer (Imran) for the critical rescue", async () => {
    const eligible = (await matchesFor(RESCUE)).filter((m) => m.eligible);
    expect(eligible[0]?.volunteer_id).toBe(uid(12));
  });

  it("shows nobody eligible for a rescue task when the only certified volunteer is busy", async () => {
    db.volunteerProfiles.find((p) => p.user_id === uid(12))!.availability = "busy";
    expect((await matchesFor(RESCUE)).some((m) => m.eligible)).toBe(false);
  });

  it("only serves verified incidents", async () => {
    await expect(matchesFor(uid(101))).rejects.toThrow(/verified/);
  });
});

describe("approve, accept, decline", () => {
  it("coordinator approval creates an approved assignment and logs it", async () => {
    const a = await assignVolunteer(coordinator(), FOOD, sana().id);
    expect(a.status).toBe("approved");
    expect(a.score_breakdown?.total).toBeGreaterThan(0);
    expect(incident(FOOD).status).toBe("assigned");
    expect((await incidentEvents(coordinator(), FOOD)).map((e) => e.action)).toContain("assigned");
  });

  it("refuses an ineligible volunteer even if the UI asks for one", async () => {
    await expect(assignVolunteer(coordinator(), FOOD, uid(15))).rejects.toThrow(/busy/);
    await expect(assignVolunteer(coordinator(), FOOD, uid(13))).rejects.toThrow(/unverified|verified/i);
    expect(incident(FOOD).status).toBe("verified");
  });

  it("volunteer accept moves the incident to in_progress", async () => {
    const a = await assignVolunteer(coordinator(), FOOD, sana().id);
    await respondToAssignment(sana(), a.id, true);
    expect(incident(FOOD).status).toBe("in_progress");
  });

  it("a decline returns the incident to the matching list without that volunteer", async () => {
    const a = await assignVolunteer(coordinator(), FOOD, sana().id);
    await respondToAssignment(sana(), a.id, false);
    expect(incident(FOOD).status).toBe("verified");
    const sanaRow = (await matchesFor(FOOD)).find((m) => m.volunteer_id === sana().id)!;
    expect(sanaRow).toMatchObject({ eligible: false, excluded_reason: "Declined this incident" });
    expect(await canSee(sana(), incident(FOOD))).toBe(false);
  });

  it("a volunteer cannot answer someone else's assignment", async () => {
    const a = await assignVolunteer(coordinator(), FOOD, sana().id);
    await expect(respondToAssignment(karthik(), a.id, true)).rejects.toThrow(/not found/i);
  });
});

describe("no conflicting assignments", () => {
  it("a volunteer at capacity is excluded and cannot be assigned", async () => {
    db.volunteerProfiles.find((p) => p.user_id === sana().id)!.capacity = 1; // already holds incident 105
    expect((await matchesFor(FOOD)).find((m) => m.volunteer_id === sana().id)!.excluded_reason).toMatch(/capacity/i);
    await expect(assignVolunteer(coordinator(), FOOD, sana().id)).rejects.toThrow(/capacity/i);
  });

  it("one active assignment per incident: a second assign is refused", async () => {
    await assignVolunteer(coordinator(), FOOD, sana().id);
    await expect(assignVolunteer(coordinator(), FOOD, karthik().id)).rejects.toThrow(/verified/);
  });
});

describe("reassign and resolve", () => {
  it("reassign replaces the volunteer and removes the old one's access", async () => {
    const first = await assignVolunteer(coordinator(), FOOD, sana().id);
    const second = await reassignVolunteer(coordinator(), first.id, karthik().id);
    expect(db.assignments.find((a) => a.id === first.id)!.status).toBe("reassigned");
    expect(second.status).toBe("approved");
    expect((await activeAssignment(FOOD))!.volunteer_id).toBe(karthik().id);
    expect(await canSee(sana(), incident(FOOD))).toBe(false);
    expect(await canSee(karthik(), incident(FOOD))).toBe(true);
  });

  it("resolve completes the assignment and frees the volunteer", async () => {
    const a = await assignVolunteer(coordinator(), FOOD, sana().id);
    await respondToAssignment(sana(), a.id, true);
    await resolveIncident(coordinator(), FOOD);
    expect(incident(FOOD).status).toBe("resolved");
    expect(db.assignments.find((x) => x.id === a.id)!.status).toBe("completed");
    expect((await incidentEvents(coordinator(), FOOD)).at(-1)!.action).toBe("resolved");
  });

  it("cannot resolve an incident that is not in progress", async () => {
    await expect(resolveIncident(coordinator(), FOOD)).rejects.toThrow(/in-progress/);
  });
});
