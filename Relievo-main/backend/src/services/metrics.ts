// ImpactTrace: every number here is computed from incidents + the incident_events audit trail.
// The demo data is synthetic; the dashboard says so.
import { getRepo } from "../store/repo";
import type { IncidentEvent } from "../types";
import type { IncidentStatus } from "../types";

const minutes = (from: string, to: string) => (new Date(to).getTime() - new Date(from).getTime()) / 60_000;
const average = (nums: number[]) => (nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null);

/** First time each action happened per incident. */
function firstEventTimes(events: IncidentEvent[]) {
  const byIncident = new Map<string, Map<string, string>>();
  for (const e of events) {
    const actions = byIncident.get(e.incident_id) ?? new Map<string, string>();
    const existing = actions.get(e.action);
    if (!existing || e.created_at < existing) actions.set(e.action, e.created_at);
    byIncident.set(e.incident_id, actions);
  }
  return byIncident;
}

export async function computeMetrics(now = Date.now()) {
  const repo = await getRepo();
  const [incidents, assignments, allocations, events] = await Promise.all([
    repo.incidents(), repo.assignments(), repo.allocations(), repo.events(),
  ]);
  const times = firstEventTimes(events);
  const gap = (id: string, from: string, to: string) => {
    const a = times.get(id)?.get(from);
    const b = times.get(id)?.get(to);
    return a && b ? minutes(a, b) : null;
  };
  const ids = incidents.map((i) => i.id);
  const nonNull = (xs: Array<number | null>) => xs.filter((x): x is number => x !== null);

  const statusCounts = Object.fromEntries(
    (["submitted", "verified", "assigned", "in_progress", "resolved", "rejected"] as IncidentStatus[])
      .map((s) => [s, incidents.filter((i) => i.status === s).length]),
  ) as Record<IncidentStatus, number>;

  // Verified but nobody has been approved yet: the queue that must not be forgotten.
  const unassigned = incidents
    .filter((i) => i.status === "verified")
    .map((i) => {
      const since = times.get(i.id)?.get("verified") ?? i.created_at;
      return { id: i.id, category: i.category, urgency: i.urgency, waiting_minutes: Math.round(minutes(since, new Date(now).toISOString())) };
    })
    .sort((a, b) => b.waiting_minutes - a.waiting_minutes);

  const handled = incidents.filter((i) => i.status !== "rejected").length;
  const volunteersDeployed = new Set(
    assignments.filter((a) => a.status === "accepted" || a.status === "completed").map((a) => a.volunteer_id),
  ).size;

  return {
    total_incidents: incidents.length,
    status_counts: statusCounts,
    awaiting_review: statusCounts.submitted,
    unassigned_incidents: unassigned,
    avg_minutes_to_verify: average(nonNull(ids.map((id) => gap(id, "submitted", "verified")))),
    avg_minutes_to_assign: average(nonNull(ids.map((id) => gap(id, "verified", "assigned")))),
    resolution_rate: handled ? Math.round((statusCounts.resolved / handled) * 100) : 0,
    volunteers_deployed: volunteersDeployed,
    resources_allocated_units: allocations.reduce((n, a) => n + a.allocated_quantity, 0),
    resources_allocations: allocations.length,
    events_recorded: events.length,
    synthetic: incidents.every((i) => i.is_synthetic),
  };
}
