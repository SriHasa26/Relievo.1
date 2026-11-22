// Dispatch board: every unassigned (verified) incident in priority order, each with the best available volunteer from the
// existing explainable matching score. Conflicts are resolved greedily: the highest-priority incident picks first, and a
// volunteer is never suggested for two operations. A coordinator still approves every assignment (one by one or all at once).
import { getRepo, logEvent } from "../store/repo";
import { assignVolunteer, matchesFor } from "./dispatch";
import { HttpError, activeAssignment } from "./incidents";
import { byPriority, computePriority, levelRank } from "./priority";
import type { MatchResult } from "./matching";
import type { Incident, Urgency, User } from "../types";

/** Greedy conflict resolution. `items` must already be in priority order (most urgent first). Pure function. */
export function greedyAssign(items: Array<{ incident_id: string; ranked: MatchResult[] }>): Map<string, MatchResult | null> {
  const taken = new Set<string>();
  const out = new Map<string, MatchResult | null>();
  for (const { incident_id, ranked } of items) {
    const pick = ranked.find((m) => m.eligible && !taken.has(m.volunteer_id)) ?? null;
    if (pick) taken.add(pick.volunteer_id);
    out.set(incident_id, pick);
  }
  return out;
}

export interface BoardItem {
  incident: Incident;
  priority: ReturnType<typeof computePriority>;
  suggestion: MatchResult | null;
  /** Other eligible volunteers, best first, for a manual override. */
  options: MatchResult[];
}

export async function dispatchBoard(now = Date.now()): Promise<{ items: BoardItem[]; awaiting_review: number }> {
  const all = await (await getRepo()).incidents();
  const waiting: Array<{ incident: Incident; priority: ReturnType<typeof computePriority>; created_at: string }> = [];
  for (const incident of all.filter((i) => i.status === "verified")) {
    if (await activeAssignment(incident.id)) continue; // already has someone
    waiting.push({ incident, priority: computePriority(incident, now), created_at: incident.created_at });
  }
  waiting.sort(byPriority);

  const ranked = await Promise.all(waiting.map(async (w) => ({ incident_id: w.incident.id, ranked: await matchesFor(w.incident.id) })));
  const picks = greedyAssign(ranked);
  const items: BoardItem[] = waiting.map((w, i) => ({
    incident: w.incident, priority: w.priority, suggestion: picks.get(w.incident.id) ?? null,
    options: ranked[i]!.ranked.filter((m) => m.eligible).slice(0, 5),
  }));
  return { items, awaiting_review: all.filter((i) => i.status === "submitted").length };
}

export interface ApprovalResult { incident_id: string; volunteer_id: string; ok: boolean; error?: string }

/**
 * Approve several suggestions at once. Each pair goes through the same checks as a single approval (verified incident,
 * eligible volunteer), one volunteer can appear only once, and every success is logged in incident_events by assignVolunteer.
 */
export async function approveAll(coordinator: User, pairs: Array<{ incident_id: string; volunteer_id: string }>): Promise<ApprovalResult[]> {
  if (!Array.isArray(pairs) || pairs.length === 0) throw new HttpError(400, "Nothing to approve");
  const used = new Set<string>();
  const results: ApprovalResult[] = [];
  for (const p of pairs) {
    const base = { incident_id: String(p.incident_id), volunteer_id: String(p.volunteer_id) };
    if (used.has(base.volunteer_id)) { results.push({ ...base, ok: false, error: "This volunteer is already approved for another incident in this batch" }); continue; }
    try {
      await assignVolunteer(coordinator, base.incident_id, base.volunteer_id);
      used.add(base.volunteer_id);
      results.push({ ...base, ok: true });
    } catch (e) {
      results.push({ ...base, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

/** A coordinator sets (or clears) the priority level. The AI never does this, and an SOS always stays Critical. */
export async function setPriorityOverride(coordinator: User, incidentId: string, level: Urgency | null) {
  const repo = await getRepo();
  const incident = await repo.incident(incidentId);
  if (!incident) throw new HttpError(404, "Incident not found");
  if (level !== null && levelRank(level) < 0) throw new HttpError(400, "Invalid priority level");
  if (incident.is_sos && incident.sos_status === "active") throw new HttpError(409, "An SOS is always Critical");
  const from = incident.priority_override ?? null;
  incident.priority_override = level;
  await repo.saveIncident(incident);
  await logEvent(incident.id, coordinator.id, "priority_overridden", { from, to: level });
  return { incident, priority: computePriority(incident) };
}
