import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../src/store/store";
import { buildSeed, uid } from "../src/store/seedData";
import { resetMockNexconn } from "../src/integrations/nexconn.adapter";
import { submitIncident, verifyIncident } from "../src/services/incidents";
import { assignVolunteer, respondToAssignment } from "../src/services/dispatch";
import { listNotifications, markRead } from "../src/services/notifications";
import { runEscalationCheck } from "../src/services/escalation";
import { consume, resetRateLimits } from "../src/ratelimit";

const user = (n: number) => db.users.find((u) => u.id === uid(n))!;
const citizen = () => user(1);
const priya = () => user(21);
const arjun = () => user(22);
const sana = () => user(14);

beforeEach(() => {
  resetDb(buildSeed());
  resetMockNexconn();
  resetRateLimits();
});

describe("notifications", () => {
  it("a new incident notifies every coordinator", async () => {
    const i = await submitIncident(citizen(), { text: "Water is entering our house, 6 people, an elderly person is weak", lat: 17.41, lng: 78.48 });
    for (const c of [priya(), arjun()]) {
      const n = (await listNotifications(c)).items.find((x) => x.incident_id === i.id);
      expect(n?.type).toBe("new_incident");
      expect(n?.read_at).toBeNull();
    }
    expect((await listNotifications(citizen())).items).toHaveLength(0);
  });

  it("assignment sends an offer to the volunteer; accepting notifies the coordinators", async () => {
    await assignVolunteer(priya(), uid(103), sana().id);
    const offer = (await listNotifications(sana())).items.find((n) => n.type === "assignment_offer")!;
    expect(offer.data.assignment_id).toBeTruthy();
    await respondToAssignment(sana(), String(offer.data.assignment_id), true);
    expect((await listNotifications(priya())).items.some((n) => n.type === "volunteer_accepted")).toBe(true);
  });

  it("declining notifies the coordinators with high priority", async () => {
    await assignVolunteer(priya(), uid(103), sana().id);
    const offer = (await listNotifications(sana())).items.find((n) => n.type === "assignment_offer")!;
    await respondToAssignment(sana(), String(offer.data.assignment_id), false);
    const n = (await listNotifications(arjun())).items.find((x) => x.type === "volunteer_declined")!;
    expect(n.priority).toBe("high");
  });

  it("verifying a High/Critical incident alerts available verified volunteers", async () => {
    const i = await submitIncident(citizen(), { text: "Person is bleeding heavily and unconscious, 1 person", lat: 17.41, lng: 78.48 });
    await verifyIncident(priya(), i.id, { decision: "verify", edits: { urgency: "critical" } });
    const karthik = (await listNotifications(user(11))).items.find((n) => n.incident_id === i.id);
    expect(karthik?.type).toBe("priority_alert");
    expect((await listNotifications(user(13))).items.some((n) => n.incident_id === i.id)).toBe(false); // unverified volunteer: nothing
  });

  it("markRead only touches the caller's own notifications", async () => {
    await submitIncident(citizen(), { text: "No food for two days, 4 people", lat: 17.41, lng: 78.48 });
    const before = await listNotifications(priya());
    await markRead(priya(), "all");
    expect((await listNotifications(priya())).unread).toBe(0);
    expect(before.unread).toBeGreaterThan(0);
    expect((await listNotifications(arjun())).unread).toBeGreaterThan(0);
  });

  it("escalation alerts coordinators once for an incident unassigned too long", async () => {
    const first = await runEscalationCheck(Date.now());
    expect(first).toBeGreaterThan(0); // the seed has old unassigned incidents
    expect(await runEscalationCheck(Date.now())).toBe(0); // only once each
    expect((await listNotifications(priya())).items.some((n) => n.type === "escalation")).toBe(true);
  });
});

describe("rate limiter", () => {
  it("allows up to the limit, then returns the seconds to wait", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) expect(consume("k", 60_000, 3, t + i)).toBe(0);
    expect(consume("k", 60_000, 3, t + 10)).toBeGreaterThan(0);
    expect(consume("k", 60_000, 3, t + 61_000)).toBe(0); // the window has passed
  });
  it("keeps keys separate", () => {
    consume("a", 60_000, 1);
    expect(consume("b", 60_000, 1)).toBe(0);
  });
});
