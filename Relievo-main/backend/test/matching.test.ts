import { describe, expect, it } from "vitest";
import { distanceKm, rankVolunteers, scoreVolunteer, WEIGHTS, type Candidate } from "../src/services/matching";
import type { Category } from "../src/types";

const here = { lat: 17.4, lng: 78.47 };
const incident = (category: Category) => ({ category, ...here });

const candidate = (over: {
  id?: string; verified?: boolean; skills?: string[]; qualifications?: string[];
  availability?: "available" | "busy" | "offline"; capacity?: number; active?: number; lat?: number; lng?: number;
}): Candidate => ({
  user: { id: over.id ?? "v", name: over.id ?? "v", verified: over.verified ?? true },
  profile: {
    user_id: over.id ?? "v", skills: over.skills ?? [], qualifications: over.qualifications ?? [],
    availability: over.availability ?? "available", capacity: over.capacity ?? 1,
    lat: over.lat ?? here.lat, lng: over.lng ?? here.lng,
  },
  activeCount: over.active ?? 0,
});

describe("haversine", () => {
  it("is 0 for the same point and about 10.6 km for 0.1 degree of longitude at 17.4N", () => {
    expect(distanceKm(here, here)).toBe(0);
    expect(distanceKm({ lat: 17.4, lng: 78.4 }, { lat: 17.4, lng: 78.5 })).toBeCloseTo(10.6, 0);
  });
});

describe("score S = 0.35D + 0.30K + 0.20A + 0.15C", () => {
  it("weights are exactly 0.35 / 0.30 / 0.20 / 0.15", () => {
    expect(WEIGHTS).toEqual({ D: 0.35, K: 0.3, A: 0.2, C: 0.15 });
  });

  it("a perfect candidate scores 100", () => {
    const b = scoreVolunteer(incident("medical"), candidate({ skills: ["first_aid"], qualifications: ["medical"] }));
    expect(b).toMatchObject({ D: 100, K: 100, A: 100, C: 100, total: 100 });
  });

  it("combines the components with the specified weights", () => {
    // ~5 km away (D~50), 1 of 2 food skills (K=50), holding 1 task of capacity 2 (A=60, C=50)
    const c = candidate({ skills: ["logistics"], capacity: 2, active: 1, lat: here.lat + 0.045 });
    const b = scoreVolunteer(incident("food"), c);
    expect(b.K).toBe(50);
    expect(b.A).toBe(60);
    expect(b.C).toBe(50);
    expect(b.D).toBeGreaterThan(49);
    expect(b.D).toBeLessThan(51);
    expect(b.total).toBeCloseTo(0.35 * b.D + 0.3 * 50 + 0.2 * 60 + 0.15 * 50, 0);
  });

  it("distance suitability reaches 0 at 10 km and beyond", () => {
    const b = scoreVolunteer(incident("other"), candidate({ skills: ["general"], lat: here.lat + 0.2 }));
    expect(b.D).toBe(0);
  });
});

describe("hard exclusions", () => {
  it("never ranks busy or unverified volunteers, even when they are closest and best skilled", () => {
    const ranked = rankVolunteers(incident("food"), [
      candidate({ id: "busy", skills: ["food", "logistics"], availability: "busy" }),
      candidate({ id: "unverified", skills: ["food", "logistics"], verified: false }),
      candidate({ id: "far-ok", skills: ["logistics"], lat: here.lat + 0.05 }),
    ]);
    expect(ranked[0]!.volunteer_id).toBe("far-ok");
    expect(ranked[0]!.eligible).toBe(true);
    const busy = ranked.find((r) => r.volunteer_id === "busy")!;
    const unverified = ranked.find((r) => r.volunteer_id === "unverified")!;
    expect(busy.eligible).toBe(false);
    expect(busy.excluded_reason).toMatch(/busy/);
    expect(unverified.eligible).toBe(false);
    expect(unverified.excluded_reason).toMatch(/unverified/i);
  });

  it("medical and rescue tasks need the verified qualification", () => {
    const ranked = rankVolunteers(incident("medical"), [
      candidate({ id: "no-qual", skills: ["first_aid"] }),
      candidate({ id: "qualified", skills: ["first_aid"], qualifications: ["medical"] }),
    ]);
    expect(ranked.find((r) => r.volunteer_id === "no-qual")!.eligible).toBe(false);
    expect(ranked[0]!.volunteer_id).toBe("qualified");
    const rescue = rankVolunteers(incident("rescue"), [candidate({ skills: ["rescue"], qualifications: ["medical"] })]);
    expect(rescue[0]!.eligible).toBe(false);
  });

  it("excludes volunteers at capacity and those who declined this incident", () => {
    const ranked = rankVolunteers(
      incident("other"),
      [candidate({ id: "full", skills: ["general"], capacity: 1, active: 1 }), candidate({ id: "declined", skills: ["general"] })],
      ["declined"],
    );
    expect(ranked.every((r) => !r.eligible)).toBe(true);
  });

  it("explains each eligible match in plain language", () => {
    const [r] = rankVolunteers(incident("water"), [candidate({ skills: ["water_supply", "logistics"] })]);
    expect(r!.reason).toMatch(/km away/);
    expect(r!.reason).toMatch(/all the skills/);
  });
});
