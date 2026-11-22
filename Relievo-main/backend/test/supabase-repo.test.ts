// Runs the real service code on top of SupabaseRepo, with a small in-memory fake standing in for the supabase-js client.
// This checks our row mapping and call patterns. It does NOT prove anything about a real Supabase project:
// for that run `npm run verify:supabase -w backend`.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSeed, uid } from "../src/store/seedData";
import { setRepo } from "../src/store/repo";
import { createSupabaseRepo } from "../src/store/supabaseRepo";
import { assignVolunteer, matchesFor, respondToAssignment, resolveIncident } from "../src/services/dispatch";
import { incidentEvents, listIncidents, submitIncident, verifyIncident } from "../src/services/incidents";
import { allocateResource } from "../src/services/resources";
import { computeMetrics } from "../src/services/metrics";
import type { User } from "../src/types";
import { resetMockNexconn } from "../src/integrations/nexconn.adapter";

type Row = Record<string, unknown>;
const PK: Record<string, string> = { users: "id", volunteer_profiles: "user_id", incident_ai_analysis: "incident_id", incident_channels: "incident_id" };

/** Just enough of the supabase-js query builder: select/insert/update/upsert + eq/order/maybeSingle. */
function fakeClient(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    const pk = PK[table] ?? "id";
    let op: "select" | "insert" | "update" | "upsert" = "select";
    let payload: Row | Row[] = {};
    const filters: Array<[string, unknown]> = [];
    let orderBy: string | null = null;
    let single = false;
    const run = () => {
      // like the real table: `kind` defaults to "operations", and the key of incident_channels is (incident_id, kind)
      const val = (r: Row, k: string) => (k === "kind" && r[k] === undefined && table === "incident_channels" ? "operations" : r[k]);
      const same = (a: Row, b: Row) => (table === "incident_channels" ? a.incident_id === b.incident_id && val(a, "kind") === val(b, "kind") : a[pk] === b[pk]);
      const match = (r: Row) => filters.every(([k, v]) => val(r, k) === v);
      if (op === "insert") {
        for (const r of [payload].flat()) {
          if (rows.some((x) => same(x, r))) return { data: null, error: { message: `duplicate key ${table}` } };
          rows.push(structuredClone(r));
        }
        return { data: null, error: null };
      }
      if (op === "upsert") {
        for (const r of [payload].flat()) {
          const i = rows.findIndex((x) => same(x, r));
          if (i >= 0) rows[i] = structuredClone(r); else rows.push(structuredClone(r));
        }
        return { data: null, error: null };
      }
      if (op === "update") {
        for (const r of rows.filter(match)) Object.assign(r, structuredClone(payload));
        return { data: null, error: null };
      }
      let out = rows.filter(match).map((r) => structuredClone(r));
      // like Postgres: timestamps come back as "+00:00", not "Z"
      out = out.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k.endsWith("_at") && typeof v === "string" ? v.replace("Z", "+00:00") : v])));
      if (orderBy) out.sort((a, b) => String(a[orderBy!]).localeCompare(String(b[orderBy!])));
      return { data: single ? out[0] ?? null : out, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q, eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
      order: (c: string) => { orderBy = c; return q; }, maybeSingle: () => { single = true; return q; },
      insert: (p: Row | Row[]) => { op = "insert"; payload = p; return q; },
      update: (p: Row) => { op = "update"; payload = p; return q; },
      upsert: (p: Row | Row[]) => { op = "upsert"; payload = p; return q; },
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve),
    };
    return q;
  };
  return { from };
}

function loadFake() {
  const seed = buildSeed();
  return {
    users: seed.users.map(({ password: _p, ...u }) => ({ ...u })),
    volunteer_profiles: seed.volunteerProfiles, organisations: seed.organisations, incidents: seed.incidents,
    incident_ai_analysis: seed.analyses, assignments: seed.assignments, resources: seed.resources,
    resource_allocations: seed.allocations, incident_events: seed.events, incident_channels: seed.channels,
  } as unknown as Record<string, Row[]>;
}

let tables: Record<string, Row[]>;
beforeEach(() => {
  resetMockNexconn();
  tables = loadFake();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setRepo(createSupabaseRepo(fakeClient(tables) as any));
});
afterEach(() => setRepo(null));

const user = (n: number) => tables.users!.find((u) => u.id === uid(n)) as unknown as User;

describe("services on top of SupabaseRepo (fake client)", () => {
  it("runs the whole workflow and writes every state change back", async () => {
    const citizen = user(1), coordinator = user(21), sana = user(14);
    const inc = await submitIncident(citizen, { text: "No food for two days, family of 4 with two children", lat: 17.416, lng: 78.473 });
    expect(tables.incidents!.some((i) => i.id === inc.id)).toBe(true);
    expect(tables.incident_ai_analysis!.some((a) => a.incident_id === inc.id)).toBe(true);

    await verifyIncident(coordinator, inc.id, { decision: "verify" });
    expect(tables.incidents!.find((i) => i.id === inc.id)!.status).toBe("verified");

    const ranked = await matchesFor(inc.id);
    expect(ranked[0]!.eligible).toBe(true);
    const a = await assignVolunteer(coordinator, inc.id, sana.id);
    expect(tables.assignments!.find((x) => x.id === a.id)!.status).toBe("approved");
    expect(tables.incident_channels!.some((c) => c.incident_id === inc.id)).toBe(true); // room id stored

    await respondToAssignment(sana, a.id, true);
    await allocateResource(coordinator, uid(52), inc.id, 5);
    expect(tables.resources!.find((r) => r.id === uid(52))!.quantity).toBe(75);
    await resolveIncident(coordinator, inc.id);
    expect(tables.assignments!.find((x) => x.id === a.id)!.status).toBe("completed");

    const actions = (await incidentEvents(coordinator, inc.id)).map((e) => e.action);
    expect(actions).toEqual(["submitted", "ai_analyzed", "duplicate_flagged", "verified", "assigned", "room_created", "accepted", "citizen_room_created", "resource_allocated", "resolved"]);
  });

  it("normalises timestamps and exposes the same read models", async () => {
    const list = await listIncidents(user(21));
    expect(list).toHaveLength(8);
    expect(list.every((i) => i.created_at.endsWith("Z"))).toBe(true);
    const m = await computeMetrics();
    expect(m.total_incidents).toBe(8);
    expect(m.avg_minutes_to_verify).toBeCloseTo(15, 0);
  });
});
