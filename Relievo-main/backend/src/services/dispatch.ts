// Dispatch workflow: ranked matches -> coordinator approves -> volunteer accepts/declines -> resolve.
// The AI never assigns anyone. Only a coordinator's approve/reassign call creates an assignment.
import { getRepo, logEvent, newId } from "../store/repo";
import { HttpError, activeAssignment, getIncident, isActive } from "./incidents";
import { ensureCitizenRoom, ensureRoomFor, removeVolunteerFromRoom } from "./rooms";
import { rankVolunteers, type Candidate, type MatchResult } from "./matching";
import { coordinators, notifyUsers, safely } from "./notifications";
import { computePriority } from "./priority";
import type { Assignment, Availability, Incident, User } from "../types";

/** Tell a volunteer a coordinator approved them for an incident (they accept or decline from the notification or the dashboard). */
async function offerNotification(incident: Incident, assignment: Assignment, volunteerId: string) {
  await safely(async () => {
    const volunteer = (await (await getRepo()).users()).find((u) => u.id === volunteerId);
    if (!volunteer) return;
    await notifyUsers([volunteer], {
      type: "assignment_offer", priority: computePriority(incident).level, incident_id: incident.id,
      title: `Assignment offer: ${incident.category}${incident.address_text ? ` · ${incident.address_text}` : ""}`,
      body: incident.original_text.slice(0, 200), data: { assignment_id: assignment.id },
    });
  });
}

/**
 * Chat is secondary to the assignment: if Nexconn fails, the assignment (Supabase) still stands.
 * The failure is logged on the timeline so a coordinator can see it and retry; see risk 4 in docs.
 */
async function syncChat(incidentId: string, step: () => Promise<unknown>) {
  try {
    await step();
  } catch (err) {
    await logEvent(incidentId, null, "chat_sync_failed", { error: (err as Error).message });
  }
}

async function allCandidates(): Promise<Candidate[]> {
  const repo = await getRepo();
  const [profiles, users, assignments] = await Promise.all([repo.volunteerProfiles(), repo.users(), repo.assignments()]);
  const out: Candidate[] = [];
  for (const profile of profiles) {
    const user = users.find((u) => u.id === profile.user_id && u.role === "volunteer");
    if (user) out.push({ user, profile, activeCount: assignments.filter((a) => a.volunteer_id === user.id && isActive(a)).length });
  }
  return out;
}

/** Ranked volunteers for an incident (the person currently assigned is left out, so this also serves reassignment). */
export async function matchesFor(incidentId: string): Promise<MatchResult[]> {
  const incident = await getIncident(incidentId);
  if (!["verified", "assigned", "in_progress"].includes(incident.status)) {
    throw new HttpError(409, "Matching is available only for verified incidents");
  }
  const current = (await activeAssignment(incident.id))?.volunteer_id;
  const candidates = (await allCandidates()).filter((c) => c.user.id !== current);
  const declined = (await (await getRepo()).assignments({ incident_id: incident.id }))
    .filter((a) => a.status === "declined").map((a) => a.volunteer_id);
  return rankVolunteers(incident, candidates, declined);
}

/** Server-side re-check of the hard rules, so a stale or tampered UI cannot assign an ineligible volunteer. */
async function pickEligible(incident: Incident, volunteerId: string): Promise<MatchResult> {
  const match = (await matchesFor(incident.id)).find((m) => m.volunteer_id === volunteerId);
  if (!match) throw new HttpError(404, "Volunteer not found");
  if (!match.eligible) throw new HttpError(409, `Cannot assign ${match.name}: ${match.excluded_reason}`);
  return match;
}

async function createAssignment(coordinator: User, incident: Incident, match: MatchResult): Promise<Assignment> {
  const assignment: Assignment = {
    id: newId(), incident_id: incident.id, volunteer_id: match.volunteer_id, assigned_by: coordinator.id,
    status: "approved", score_breakdown: match.breakdown, created_at: new Date().toISOString(), responded_at: null,
  };
  const repo = await getRepo();
  await repo.addAssignment(assignment); // the database allows only one active assignment per incident
  incident.status = "assigned";
  await repo.saveIncident(incident);
  return assignment;
}

/** Coordinator approves a volunteer for a verified incident. */
export async function assignVolunteer(coordinator: User, incidentId: string, volunteerId: string): Promise<Assignment> {
  const incident = await getIncident(incidentId);
  if (incident.status !== "verified") throw new HttpError(409, `Incident is ${incident.status}; it must be verified (and unassigned) to assign`);
  const match = await pickEligible(incident, volunteerId);
  const assignment = await createAssignment(coordinator, incident, match);
  await logEvent(incident.id, coordinator.id, "assigned", { volunteer_id: volunteerId, score: match.breakdown?.total });
  await offerNotification(incident, assignment, volunteerId);
  await syncChat(incident.id, () => ensureRoomFor(incident, coordinator.id, volunteerId));
  return assignment;
}

/** Coordinator replaces the current volunteer with another eligible one. */
export async function reassignVolunteer(coordinator: User, assignmentId: string, newVolunteerId: string): Promise<Assignment> {
  const repo = await getRepo();
  const old = await repo.assignment(assignmentId);
  if (!old || (old.status !== "approved" && old.status !== "accepted")) throw new HttpError(404, "No active assignment to reassign");
  if (old.volunteer_id === newVolunteerId) throw new HttpError(400, "Choose a different volunteer");
  const incident = await getIncident(old.incident_id);
  const match = await pickEligible(incident, newVolunteerId);
  old.status = "reassigned";
  old.responded_at = new Date().toISOString();
  await repo.saveAssignment(old); // must happen before the new one is added (one active assignment per incident)
  const assignment = await createAssignment(coordinator, incident, match);
  await logEvent(incident.id, coordinator.id, "reassigned", {
    from_volunteer_id: old.volunteer_id, volunteer_id: newVolunteerId, score: match.breakdown?.total,
  });
  await offerNotification(incident, assignment, newVolunteerId);
  await syncChat(incident.id, async () => {
    await removeVolunteerFromRoom(incident.id, old.volunteer_id);
    await ensureRoomFor(incident, coordinator.id, newVolunteerId);
  });
  return assignment;
}

async function tellCoordinators(incident: Incident, volunteer: User, accepted: boolean) {
  await safely(async () => {
    await notifyUsers(await coordinators(), {
      type: accepted ? "volunteer_accepted" : "volunteer_declined",
      priority: accepted ? "medium" : "high", incident_id: incident.id,
      title: `${volunteer.name} ${accepted ? "accepted" : "declined"} the ${incident.category} assignment`,
      body: accepted ? "The incident room is open." : "The incident is back in the dispatch list.",
    });
  });
}

/** Volunteer answers an approved assignment. A decline puts the incident back in the matching list. */
export async function respondToAssignment(volunteer: User, assignmentId: string, accept: boolean): Promise<Assignment> {
  const repo = await getRepo();
  const assignment = await repo.assignment(assignmentId);
  if (!assignment || assignment.volunteer_id !== volunteer.id) throw new HttpError(404, "Assignment not found");
  if (assignment.status !== "approved") throw new HttpError(409, `Assignment is already ${assignment.status}`);
  const incident = await getIncident(assignment.incident_id);
  assignment.responded_at = new Date().toISOString();

  if (accept) {
    assignment.status = "accepted";
    incident.status = "in_progress";
    await repo.saveAssignment(assignment);
    await repo.saveIncident(incident);
    await logEvent(incident.id, volunteer.id, "accepted");
    await tellCoordinators(incident, volunteer, true);
    // the citizen gets their own chat with the volunteer who accepted (separate from the operations room)
    await syncChat(incident.id, () => ensureCitizenRoom(incident, assignment.assigned_by, volunteer.id));
  } else {
    assignment.status = "declined";
    incident.status = "verified"; // back to the coordinator's matching list
    await repo.saveAssignment(assignment);
    await repo.saveIncident(incident);
    await logEvent(incident.id, volunteer.id, "declined");
    await tellCoordinators(incident, volunteer, false);
    await syncChat(incident.id, () => removeVolunteerFromRoom(incident.id, volunteer.id));
  }
  return assignment;
}

/** Coordinator confirms resolution. Frees the volunteer (their active count drops). */
export async function resolveIncident(coordinator: User, incidentId: string): Promise<Incident> {
  const repo = await getRepo();
  const incident = await getIncident(incidentId);
  if (incident.status !== "in_progress") throw new HttpError(409, "Only an in-progress incident can be resolved");
  const active = await activeAssignment(incident.id);
  if (active) {
    active.status = "completed";
    active.responded_at = active.responded_at ?? new Date().toISOString();
    await repo.saveAssignment(active);
  }
  incident.status = "resolved";
  await repo.saveIncident(incident);
  await logEvent(incident.id, coordinator.id, "resolved");
  return incident;
}

export async function setAvailability(volunteer: User, availability: Availability) {
  const repo = await getRepo();
  const profile = (await repo.volunteerProfiles()).find((p) => p.user_id === volunteer.id);
  if (!profile) throw new HttpError(404, "Volunteer profile not found");
  if (!["available", "busy", "offline"].includes(availability)) throw new HttpError(400, "Invalid availability");
  profile.availability = availability;
  await repo.saveVolunteerProfile(profile);
  return profile;
}

export const volunteerProfile = async (volunteerId: string) =>
  (await (await getRepo()).volunteerProfiles()).find((p) => p.user_id === volunteerId) ?? null;
