import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../src/store/store";
import { buildSeed, uid } from "../src/store/seedData";
import { computeMetrics } from "../src/services/metrics";
import { allocateResource, listResources } from "../src/services/resources";
import { incidentEvents } from "../src/services/incidents";

const coordinator = () => db.users.find((u) => u.id === uid(21))!;
const WATER_STOCK = uid(51);

beforeEach(() => resetDb(buildSeed()));

describe("impact metrics (computed from incident_events)", () => {
  it("matches the seeded timeline", async () => {
    const m = await computeMetrics();
    expect(m.total_incidents).toBe(8);
    expect(m.awaiting_review).toBe(2); // 101, 102
    expect(m.unassigned_incidents.map((u) => u.id).sort()).toEqual([uid(103), uid(104)]);
    expect(m.avg_minutes_to_verify).toBeCloseTo(15, 0);
    expect(m.avg_minutes_to_assign).toBeCloseTo(18.3, 0);
    expect(m.status_counts.resolved).toBe(1);
    expect(m.volunteers_deployed).toBe(2); // Karthik (accepted) + Sana (completed)
    expect(m.resources_allocated_units).toBe(50);
    expect(m.synthetic).toBe(true);
  });

  it("changes when new events are logged", async () => {
    const before = (await computeMetrics()).events_recorded;
    await allocateResource(coordinator(), WATER_STOCK, uid(103), 5);
    expect((await computeMetrics()).events_recorded).toBe(before + 1);
    expect((await computeMetrics()).resources_allocated_units).toBe(55);
  });
});

describe("resource allocation", () => {
  it("reduces stock, records the allocation and logs a timeline event", async () => {
    const stock = db.resources.find((r) => r.id === WATER_STOCK)!.quantity;
    await allocateResource(coordinator(), WATER_STOCK, uid(103), 10);
    expect(db.resources.find((r) => r.id === WATER_STOCK)!.quantity).toBe(stock - 10);
    expect((await incidentEvents(coordinator(), uid(103))).at(-1)!.action).toBe("resource_allocated");
  });

  it("refuses more than the available quantity, bad quantities and closed incidents", async () => {
    await expect(allocateResource(coordinator(), WATER_STOCK, uid(103), 9999)).rejects.toThrow(/available/);
    await expect(allocateResource(coordinator(), WATER_STOCK, uid(103), 0)).rejects.toThrow(/positive/);
    await expect(allocateResource(coordinator(), WATER_STOCK, uid(107), 1)).rejects.toThrow(/open/); // resolved
    await expect(allocateResource(coordinator(), WATER_STOCK, uid(101), 1)).rejects.toThrow(/verified/); // not verified yet
  });

  it("flags stock that fits the incident and shows its distance", async () => {
    const list = await listResources(uid(107)); // water incident
    expect(list.find((r) => r.id === WATER_STOCK)!.relevant).toBe(true);
    expect(list.find((r) => r.resource_type === "food")!.relevant).toBe(false);
    expect(list[0]!.distance_km).not.toBeNull();
  });
});
