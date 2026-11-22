import { getRepo, logEvent, newId } from "../store/repo";
import { extractIncident, CATEGORIES, URGENCIES } from "./extraction";
import { distanceKm } from "./matching";
import { coordinators, notifyUsers, safely, volunteers } from "./notifications";
import { computePriority, isHighOrCritical } from "./priority";
import type { AiAnalysis, Assignment, Category, Incident, Urgency, User } from "../types";

/** An error that carries an HTTP status, so routes can reply with the right code. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const ACTIVE_ASSIGNMENT = ["approved", "accepted"] as const;
export const isActive = (a: Assignment) => (ACTIVE_ASSIGNMENT as readonly string[]).includes(a.status);
export const activeAssignment = async (incidentId: string): Promise<Assignment | undefined> =>
  (await (await getRepo()).assignments({ incident_id: incidentId })).find(isActive);

export async function getIncident(id: string): Promise<Incident> {
  const incident = await (await getRepo()).incident(id);
  if (!incident) throw new HttpError(404, "Incident not found");
  return incident;
}

/** Who may see an incident: reporter, any coordinator, or a volunteer who was assigned to it. */
export async function canSee(user: User, incident: Incident): Promise<boolean> {
  if (user.role === "coordinator") return true;
  if (user.role === "citizen") return incident.reporter_id === user.id;
  if (user.role === "volunteer") {
    // A verified volunteer may see an active SOS (the point is to get responders there fast); unverified ones never do.
    if (incident.is_sos && incident.sos_status === "active" && user.verified) return true;
    const mine = await (await getRepo()).assignments({ incident_id: incident.id, volunteer_id: user.id });
    return mine.some((a) => ["approved", "accepted", "completed"].includes(a.status)); // declined / replaced volunteers lose access
  }
  return false;
}

export async function assertCanSee(user: User, incident: Incident) {
  if (!(await canSee(user, incident))) throw new HttpError(403, "You do not have access to this incident");
}

// ---------- submit ----------

export interface SubmitInput {
  text: string;
  lat: number;
  lng: number;
  address_text?: string;
  people_affected?: number | null;
}

export async function submitIncident(user: User, input: SubmitInput): Promise<Incident> {
  const text = input.text?.trim();
  if (!text) throw new HttpError(400, "Please describe the emergency");
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) throw new HttpError(400, "Location is required");

  const repo = await getRepo();
  const ai = await extractIncident(text);
  const x = ai.extracted_data;
  const formPeople = input.people_affected ?? null;

  const incident: Incident = {
    id: newId(), reporter_id: user.id, original_text: text, title: x.summary,
    category: x.category, urgency: x.urgency,
    people_affected: formPeople !== null && formPeople >= 0 ? Math.floor(formPeople) : x.people_affected,
    needs: x.needs, vulnerable_persons: x.vulnerable_persons,
    lat: input.lat, lng: input.lng, address_text: input.address_text?.trim() ?? "",
    status: "submitted", reject_reason: null,
    possible_duplicate_of: await findPossibleDuplicate(x.category, input.lat, input.lng),
    is_synthetic: user.is_synthetic, created_at: new Date().toISOString(),
  };
  await repo.addIncident(incident);
  await repo.saveAnalysis({ incident_id: incident.id, ...ai });

  await logEvent(incident.id, user.id, "submitted");
  await logEvent(incident.id, null, "ai_analyzed", { source: ai.source });
  if (incident.possible_duplicate_of) {
    await logEvent(incident.id, null, "duplicate_flagged", { of: incident.possible_duplicate_of });
  }
  await safely(async () => {
    const p = computePriority(incident);
    await notifyUsers(await coordinators(), {
      type: "new_incident", priority: p.level, incident_id: incident.id,
      title: `New ${incident.category} request${incident.address_text ? ` · ${incident.address_text}` : ""}`,
      body: incident.original_text.slice(0, 220), data: { level: p.level },
    });
  });
  return incident;
}

/** Simple duplicate hint: same category, within 2 km, still open, in the last 24 h. */
async function findPossibleDuplicate(category: Category, lat: number, lng: number): Promise<string | null> {
  const dayAgo = Date.now() - 24 * 3_600_000;
  const open = ["submitted", "verified", "assigned", "in_progress"];
  const match = (await (await getRepo()).incidents()).find(
    (i) => i.category === category && open.includes(i.status) && new Date(i.created_at).getTime() > dayAgo
      && distanceKm({ lat, lng }, i) <= 2,
  );
  return match?.id ?? null;
}

// ---------- verify / reject / edit ----------

export interface VerifyInput {
  decision: "verify" | "reject";
  reason?: string;
  edits?: { category?: Category; urgency?: Urgency; people_affected?: number | null; needs?: string[] };
}

export async function verifyIncident(coordinator: User, incidentId: string, input: VerifyInput): Promise<Incident> {
  const repo = await getRepo();
  const incident = await getIncident(incidentId);
  if (incident.status !== "submitted") throw new HttpError(409, `Incident is already ${incident.status}`);

  if (input.decision === "reject") {
    if (!input.reason?.trim()) throw new HttpError(400, "A reason is required to reject");
    incident.status = "rejected";
    incident.reject_reason = input.reason.trim();
    await repo.saveIncident(incident);
    await logEvent(incident.id, coordinator.id, "rejected", { reason: incident.reject_reason });
    return incident;
  }

  const e = input.edits ?? {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const apply = <K extends "category" | "urgency" | "people_affected" | "needs">(key: K, value: Incident[K] | undefined) => {
    if (value === undefined) return;
    if (JSON.stringify(incident[key]) === JSON.stringify(value)) return;
    changes[key] = { from: incident[key], to: value };
    incident[key] = value;
  };
  if (e.category !== undefined && !CATEGORIES.includes(e.category)) throw new HttpError(400, "Invalid category");
  if (e.urgency !== undefined && !URGENCIES.includes(e.urgency)) throw new HttpError(400, "Invalid urgency");
  if (e.people_affected != null && (!Number.isInteger(e.people_affected) || e.people_affected < 0)) {
    throw new HttpError(400, "People affected must be a whole number");
  }
  apply("category", e.category);
  apply("urgency", e.urgency);
  apply("people_affected", e.people_affected);
  apply("needs", e.needs);

  incident.status = "verified";
  await repo.saveIncident(incident);
  if (Object.keys(changes).length > 0) await logEvent(incident.id, coordinator.id, "edited", { changes });
  await logEvent(incident.id, coordinator.id, "verified");
  await safely(async () => { // High / Critical incidents also alert the available verified volunteers (a coordinator still approves who goes)
    const p = computePriority(incident);
    if (!isHighOrCritical(p.level) || incident.is_sos) return;
    const profiles = await repo.volunteerProfiles();
    const free = (await volunteers(true)).filter((v) => profiles.find((x) => x.user_id === v.id)?.availability === "available");
    await notifyUsers(free, {
      type: "priority_alert", priority: p.level, incident_id: incident.id,
      title: `${p.level === "critical" ? "Critical" : "High-priority"} incident needs responders`,
      body: `${incident.category} · ${incident.address_text || "location on map"} · ${incident.people_affected ?? "unknown"} people`,
    });
  });
  return incident;
}

// ---------- read models ----------

/** id -> display name for every user, loaded once per request. */
async function nameLookup() {
  const names = new Map((await (await getRepo()).users()).map((u) => [u.id, u.name]));
  return (id: string | null) => (id ? names.get(id) ?? "Unknown" : "System");
}

export async function listIncidents(user: User) {
  const repo = await getRepo();
  const [all, assignments, nameOf] = await Promise.all([repo.incidents(), repo.assignments(), nameLookup()]);
  const out = [];
  const now = Date.now();
  for (const i of [...all].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    if (!(await canSee(user, i))) continue;
    const forIncident = assignments.filter((x) => x.incident_id === i.id);
    // Coordinators see the active assignee; a volunteer sees their own assignment on the incident.
    const a = user.role === "volunteer"
      ? [...forIncident].reverse().find((x) => x.volunteer_id === user.id)
      : user.role === "coordinator" ? forIncident.find(isActive) : undefined;
    out.push({
      ...i, priority: computePriority(i, now),
      assignee: a ? { id: a.volunteer_id, name: nameOf(a.volunteer_id), status: a.status, assignment_id: a.id } : null,
    });
  }
  return out;
}

export async function incidentDetail(user: User, incidentId: string) {
  const repo = await getRepo();
  const incident = await getIncident(incidentId);
  await assertCanSee(user, incident);
  const isCoordinator = user.role === "coordinator";
  const nameOf = await nameLookup();
  const analysis: AiAnalysis | null = isCoordinator ? await repo.analysis(incident.id) : null;
  const assignments = (await repo.assignments({ incident_id: incident.id }))
    .filter((a) => isCoordinator || a.volunteer_id === user.id) // citizens see none; volunteers only their own
    .map((a) => ({ ...a, volunteer_name: nameOf(a.volunteer_id), assigned_by_name: nameOf(a.assigned_by) }));
  const resources = await repo.resources();
  const allocations = isCoordinator
    ? (await repo.allocations({ incident_id: incident.id })).map((a) => ({
      ...a, resource_name: resources.find((r) => r.id === a.resource_id)?.name ?? "?",
    })) : [];
  return {
    incident, priority: computePriority(incident),
    reporter: isCoordinator ? { id: incident.reporter_id, name: nameOf(incident.reporter_id) } : null,
    analysis, assignments, allocations,
    has_room: (await repo.channel(incident.id)) !== null,
    has_citizen_room: (await repo.channel(incident.id, "citizen")) !== null,
  };
}

export async function incidentEvents(user: User, incidentId: string) {
  const incident = await getIncident(incidentId);
  await assertCanSee(user, incident);
  const nameOf = await nameLookup();
  return (await (await getRepo()).events({ incident_id: incident.id }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((e) => ({ ...e, actor_name: nameOf(e.actor_id) }));
}
