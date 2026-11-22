import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, db } from "../src/store/store";
import { buildSeed, uid } from "../src/store/seedData";
import {
  canSee, HttpError, incidentDetail, incidentEvents, submitIncident, verifyIncident,
} from "../src/services/incidents";

const user = (n: number) => db.users.find((u) => u.id === uid(n))!;
const citizen = () => user(1);
const coordinator = () => user(21);

beforeEach(() => resetDb(buildSeed()));

describe("intake", () => {
  it("stores original text beside the AI extraction and logs events", async () => {
    const text = "Water is entering our ground floor. There are six people in the house, including an elderly person.";
    const inc = await submitIncident(citizen(), { text, lat: 17.45, lng: 78.55 });
    expect(inc.status).toBe("submitted");
    expect(inc.original_text).toBe(text);
    const analysis = db.analyses.find((a) => a.incident_id === inc.id)!;
    expect(analysis.extracted_data.requires_human_verification).toBe(true);
    const actions = (await incidentEvents(citizen(), inc.id)).map((e) => e.action);
    expect(actions).toEqual(["submitted", "ai_analyzed"]);
  });

  it("rejects an empty report", async () => {
    await expect(submitIncident(citizen(), { text: "  ", lat: 1, lng: 1 })).rejects.toBeInstanceOf(HttpError);
  });

  it("flags a same-category report within 2 km as a possible duplicate", async () => {
    // seeded incident 107 is a resolved water report, so use an open one: 101 (water, submitted)
    const near = await submitIncident(citizen(), { text: "We need drinking water, no water since morning", lat: 17.4105, lng: 78.4805 });
    expect(near.possible_duplicate_of).toBe(uid(101));
  });

  it("citizens only see their own incidents; hides AI analysis and assignees", async () => {
    expect(await canSee(citizen(), db.incidents.find((i) => i.id === uid(101))!)).toBe(true);
    expect(await canSee(citizen(), db.incidents.find((i) => i.id === uid(102))!)).toBe(false); // Ravi's
    const detail = await incidentDetail(citizen(), uid(101));
    expect(detail.analysis).toBeNull();
    expect(detail.assignments).toEqual([]);
  });
});

describe("verify / reject", () => {
  it("verifies with edits and logs edited + verified", async () => {
    const out = await verifyIncident(coordinator(), uid(101), { decision: "verify", edits: { urgency: "critical", people_affected: 7 } });
    expect(out.status).toBe("verified");
    expect(out.urgency).toBe("critical");
    const actions = (await incidentEvents(coordinator(), uid(101))).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["edited", "verified"]));
  });

  it("requires a reason to reject, then logs rejected", async () => {
    await expect(verifyIncident(coordinator(), uid(102), { decision: "reject" })).rejects.toThrow(HttpError);
    await verifyIncident(coordinator(), uid(102), { decision: "reject", reason: "Duplicate of another request" });
    expect(db.incidents.find((i) => i.id === uid(102))!.status).toBe("rejected");
    expect((await incidentEvents(coordinator(), uid(102))).at(-1)!.action).toBe("rejected");
  });

  it("cannot verify an incident twice", async () => {
    await verifyIncident(coordinator(), uid(101), { decision: "verify" });
    await expect(verifyIncident(coordinator(), uid(101), { decision: "verify" })).rejects.toThrow(/already/);
  });
});
