import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../src/store/store";
import { buildSeed, uid } from "../src/store/seedData";
import { resetMockNexconn } from "../src/integrations/nexconn.adapter";
import { AGING_AFTER_MINUTES, byPriority, computePriority, levelFromPoints } from "../src/services/priority";
import { approveAll, dispatchBoard, greedyAssign, setPriorityOverride } from "../src/services/board";
import type { MatchResult } from "../src/services/matching";
import type { Incident } from "../src/types";

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);
const base = (over: Partial<Incident> = {}): Incident => ({
  id: "i", reporter_id: "r", original_text: "t", title: "t", category: "water", urgency: "medium", people_affected: null,
  needs: [], vulnerable_persons: [], lat: 17.4, lng: 78.4, address_text: "", status: "verified", reject_reason: null,
  possible_duplicate_of: null, is_synthetic: true, created_at: new Date(NOW - 5 * 60_000).toISOString(), ...over,
});

describe("priority scoring", () => {
  it("maps points to levels at the documented thresholds", () => {
    expect([4, 5, 24, 25, 44, 45, 69, 70].map(levelFromPoints)).toEqual(["low", "low", "low", "medium", "medium", "high", "high", "critical"]);
  });

  it("the AI urgency is an input: higher urgency gives a higher score", () => {
    const levels = (["low", "medium", "high", "critical"] as const).map((urgency) => computePriority(base({ urgency }), NOW).level);
    expect(levels).toEqual(["low", "medium", "high", "critical"]);
  });

  it("vulnerable persons and people affected add points and are explained", () => {
    const plain = computePriority(base({ urgency: "high" }), NOW);
    const vulnerable = computePriority(base({ urgency: "high", vulnerable_persons: ["elderly"] }), NOW);
    expect(vulnerable.score - plain.score).toBe(10);
    const many = computePriority(base({ urgency: "high", vulnerable_persons: ["elderly"], people_affected: 12 }), NOW);
    expect(many.level).toBe("critical"); // 45 + 10 + 15 = 70
    expect(many.reasons.join(" ")).toMatch(/vulnerable/);
    expect(many.reasons.join(" ")).toMatch(/12 people/);
  });

  it("an unassigned incident escalates one level after the waiting threshold", () => {
    const young = computePriority(base({ urgency: "medium", created_at: new Date(NOW - (AGING_AFTER_MINUTES - 1) * 60_000).toISOString() }), NOW);
    const old = computePriority(base({ urgency: "medium", created_at: new Date(NOW - (AGING_AFTER_MINUTES + 1) * 60_000).toISOString() }), NOW);
    expect(young.level).toBe("medium");
    expect(old.level).toBe("high");
    expect(old.escalated).toBe(true);
    expect(old.waiting_minutes).toBe(AGING_AFTER_MINUTES + 1);
  });

  it("an incident that already has a volunteer does not age", () => {
    const p = computePriority(base({ status: "in_progress", urgency: "medium", created_at: new Date(NOW - 600 * 60_000).toISOString() }), NOW);
    expect(p.level).toBe("medium");
    expect(p.waiting_minutes).toBe(0);
  });

  it("an SOS is always Critical and sorts above everything else", () => {
    const sos = computePriority(base({ urgency: "low", is_sos: true, sos_status: "active" }), NOW);
    expect(sos.level).toBe("critical");
    expect(sos.is_sos).toBe(true);
    const critical = computePriority(base({ urgency: "critical", vulnerable_persons: ["child"], people_affected: 30 }), NOW);
    expect(sos.score).toBeGreaterThan(critical.score);
    expect(computePriority(base({ urgency: "low", is_sos: true, sos_status: "cancelled" }), NOW).level).toBe("low");
  });

  it("a coordinator override replaces the computed level (and is flagged)", () => {
    const p = computePriority(base({ urgency: "low", priority_override: "high" }), NOW);
    expect(p.level).toBe("high");
    expect(p.overridden).toBe(true);
    expect(p.reasons[0]).toMatch(/coordinator/);
  });

  it("queue order: SOS, then Critical, then by score; ties go to whoever waited longer", () => {
    const rows = [
      base({ id: "a", urgency: "high" }),
      base({ id: "b", urgency: "critical" }),
      base({ id: "c", urgency: "low", is_sos: true, sos_status: "active" }),
      base({ id: "d", urgency: "high", created_at: new Date(NOW - 20 * 60_000).toISOString() }),
    ].map((i) => ({ id: i.id, created_at: i.created_at, priority: computePriority(i, NOW) }));
    expect(rows.sort(byPriority).map((r) => r.id)).toEqual(["c", "b", "d", "a"]);
  });
});

const m = (id: string, eligible = true): MatchResult => ({
  volunteer_id: id, name: id, eligible, excluded_reason: eligible ? null : "busy",
  breakdown: eligible ? { D: 1, K: 1, A: 1, C: 1, total: 1, distance_km: 1 } : null, reason: "",
});

describe("greedy conflict resolution", () => {
  it("the highest-priority incident picks first and nobody is suggested twice", () => {
    const out = greedyAssign([
      { incident_id: "sos", ranked: [m("v1"), m("v2")] },
      { incident_id: "high", ranked: [m("v1"), m("v2"), m("v3")] },
      { incident_id: "low", ranked: [m("v1"), m("v2"), m("v3")] },
    ]);
    expect(out.get("sos")?.volunteer_id).toBe("v1");
    expect(out.get("high")?.volunteer_id).toBe("v2");
    expect(out.get("low")?.volunteer_id).toBe("v3");
  });

  it("leaves an incident without a suggestion when every candidate is taken or ineligible", () => {
    const out = greedyAssign([
      { incident_id: "a", ranked: [m("v1")] },
      { incident_id: "b", ranked: [m("v1"), m("v9", false)] },
    ]);
    expect(out.get("a")?.volunteer_id).toBe("v1");
    expect(out.get("b")).toBeNull();
  });
});

describe("dispatch board", () => {
  beforeEach(() => { resetDb(buildSeed()); resetMockNexconn(); });
  const priya = () => db.users.find((u) => u.id === uid(21))!;

  it("lists verified, unassigned incidents most urgent first, each with a distinct suggested volunteer", async () => {
    const board = await dispatchBoard();
    expect(board.items.map((i) => i.incident.id)).toEqual([uid(104), uid(103)]); // critical rescue before high food
    // the critical rescue picks first and gets the rescue-certified Imran; the food request gets someone else
    expect(board.items[0]!.suggestion?.volunteer_id).toBe(uid(12));
    const picks = board.items.map((i) => i.suggestion?.volunteer_id).filter(Boolean);
    expect(picks).toHaveLength(2);
    expect(new Set(picks).size).toBe(picks.length);
    expect(board.items[1]!.options.length).toBeGreaterThan(0);
    // hard exclusions still apply: the busy and the unverified volunteer are never suggested
    expect(picks).not.toContain(uid(15));
    expect(picks).not.toContain(uid(13));
  });

  it("'Approve all' assigns every suggestion after the usual checks and logs each one", async () => {
    const board = await dispatchBoard();
    const pairs = board.items.filter((i) => i.suggestion).map((i) => ({ incident_id: i.incident.id, volunteer_id: i.suggestion!.volunteer_id }));
    const results = await approveAll(priya(), pairs);
    expect(results.every((r) => r.ok)).toBe(true);
    for (const p of pairs) {
      expect(db.incidents.find((i) => i.id === p.incident_id)!.status).toBe("assigned");
      expect(db.events.some((e) => e.incident_id === p.incident_id && e.action === "assigned")).toBe(true);
    }
    expect((await dispatchBoard()).items).toHaveLength(0); // both incidents now have a volunteer
  });

  it("approving the same volunteer for two incidents in one batch fails for the second", async () => {
    const results = await approveAll(priya(), [
      { incident_id: uid(103), volunteer_id: uid(14) }, { incident_id: uid(104), volunteer_id: uid(14) },
    ]);
    expect(results.map((r) => r.ok)).toEqual([true, false]);
  });

  it("an ineligible volunteer is refused even if the client sends them", async () => {
    const [r] = await approveAll(priya(), [{ incident_id: uid(104), volunteer_id: uid(13) }]);
    expect(r!.ok).toBe(false);
    expect(r!.error).toMatch(/verified/i);
  });

  it("a coordinator can override the priority, which is logged; an active SOS cannot be lowered", async () => {
    const res = await setPriorityOverride(priya(), uid(103), "critical");
    expect(res.priority.level).toBe("critical");
    expect(res.priority.overridden).toBe(true);
    expect(db.events.some((e) => e.incident_id === uid(103) && e.action === "priority_overridden")).toBe(true);
    db.incidents.find((i) => i.id === uid(103))!.is_sos = true;
    db.incidents.find((i) => i.id === uid(103))!.sos_status = "active";
    await expect(setPriorityOverride(priya(), uid(103), "low")).rejects.toThrow(/always Critical/);
  });
});
