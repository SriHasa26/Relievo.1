// Incident chat rooms. Supabase (db.assignments / db.channels) is the source of truth for WHO may be in a room;
// Nexconn only carries the messages. Every change here goes through the adapter, never Nexconn directly.
import { randomUUID } from "node:crypto";
import * as nexconn from "../integrations/nexconn.adapter";
import { getRepo, logEvent } from "../store/repo";
import { HttpError, activeAssignment, getIncident } from "./incidents";
import type { Incident, User } from "../types";

const channelFor = async (incidentId: string) => (await getRepo()).channel(incidentId);

/** Create the incident's group (once), add the coordinator and the volunteer, post the incident summary. */
export async function ensureRoomFor(incident: Incident, coordinatorId: string, volunteerId: string): Promise<string> {
  const repo = await getRepo();
  let channel = await channelFor(incident.id);
  if (!channel) {
    const groupId = randomUUID(); // opaque id, not derived from the incident id
    await nexconn.createGroup({
      groupId, name: `Incident: ${incident.category} · ${incident.address_text || incident.id.slice(0, 8)}`,
      ownerId: coordinatorId, memberIds: [volunteerId],
    });
    channel = { incident_id: incident.id, nexconn_channel_id: groupId };
    await repo.addChannel(channel);
    await logEvent(incident.id, null, "room_created");
    await nexconn.postSystemMessage({
      groupId,
      text: `Incident room opened. ${incident.category} request, urgency ${incident.urgency}, `
        + `${incident.people_affected ?? "unknown"} people. ${incident.original_text}`,
    });
  } else {
    await nexconn.addMember({ groupId: channel.nexconn_channel_id, userId: coordinatorId });
    await nexconn.addMember({ groupId: channel.nexconn_channel_id, userId: volunteerId });
  }
  return channel.nexconn_channel_id;
}

/** Remove a volunteer who declined or was replaced. */
export async function removeVolunteerFromRoom(incidentId: string, volunteerId: string): Promise<void> {
  const repo = await getRepo();
  for (const kind of ["operations", "citizen"] as const) {
    const channel = await repo.channel(incidentId, kind);
    if (channel) await nexconn.removeMember({ groupId: channel.nexconn_channel_id, userId: volunteerId });
  }
}

/**
 * Who may open the room: any coordinator, or the volunteer with an active assignment (approved or accepted).
 * Returns the group id after making sure the caller is a member of it.
 */
export async function roomAccess(
  user: User, incidentId: string,
): Promise<{ groupId: string; participants: Array<{ id: string; name: string; role: string }> }> {
  const incident = await getIncident(incidentId);
  const channel = await channelFor(incident.id);
  if (!channel) throw new HttpError(404, "No chat room for this incident yet. It opens when a volunteer is assigned.");

  const active = await activeAssignment(incident.id);
  const allowed = user.role === "coordinator" || (user.role === "volunteer" && active?.volunteer_id === user.id);
  if (!allowed) throw new HttpError(403, "You are not a member of this incident room");

  await nexconn.addMember({ groupId: channel.nexconn_channel_id, userId: user.id }); // idempotent
  // Names so the chat UI can label messages: all coordinators plus the active volunteer.
  const people = (await (await getRepo()).users()).filter((u) => u.role === "coordinator" || u.id === active?.volunteer_id);
  return {
    groupId: channel.nexconn_channel_id,
    participants: people.map((u) => ({ id: u.id, name: u.name, role: u.role })),
  };
}

/** Direct messages are only offered between coordinators and volunteers who work together. */
export async function chatContacts(user: User) {
  const repo = await getRepo();
  const users = await repo.users();
  const pub = (id: string) => {
    const u = users.find((x) => x.id === id)!;
    return { id: u.id, name: u.name, role: u.role };
  };
  if (user.role === "coordinator") {
    return users.filter((u) => u.role === "volunteer" && u.verified).map((u) => pub(u.id));
  }
  if (user.role === "volunteer") {
    const mine = await repo.assignments({ volunteer_id: user.id });
    const coordinatorIds = new Set(mine.filter((a) => a.status !== "declined").map((a) => a.assigned_by));
    return [...coordinatorIds].map(pub);
  }
  return [];
}

/** Issue a chat token for the caller only. userId comes from the verified session, never from the request body. */
export async function chatToken(user: User) {
  return nexconn.issueUserToken({ userId: user.id, name: user.name });
}

/**
 * Make sure the Nexconn group exists for every stored room, from the stored room id and the stored assignment.
 * Used for the seeded in-memory data (MOCK_DB=true) and by the Supabase seed script. Idempotent.
 * With MOCK_DB=false the rooms were created once by the seed script (or at assignment time) and are simply reused.
 */
export async function restoreRooms() {
  const repo = await getRepo();
  const [channels, incidents, assignments] = await Promise.all([repo.channels(), repo.incidents(), repo.assignments()]);
  for (const channel of channels) {
    const incident = incidents.find((i) => i.id === channel.incident_id);
    const citizenRoom = channel.kind === "citizen";
    const active = assignments.find((a) => a.incident_id === channel.incident_id
      && (citizenRoom ? ["accepted", "completed"] : ["approved", "accepted", "completed"]).includes(a.status));
    if (!incident || !active) continue;
    await nexconn.createGroup({
      groupId: channel.nexconn_channel_id, name: citizenRoom ? `Help: ${incident.category}` : `Incident: ${incident.category}`,
      ownerId: active.assigned_by, memberIds: citizenRoom ? [active.volunteer_id, incident.reporter_id] : [active.volunteer_id], mayExist: true,
    });
  }
}

/** At start-up: register every app user with Nexconn, so a direct message to someone who never logged in still works. */
export async function registerAllUsers() {
  const users = await (await getRepo()).users();
  await nexconn.registerUsers(users.map((u) => ({ userId: u.id, name: u.name })));
}


// ---------- Volunteer Hub: one persistent group with ALL volunteers and ALL coordinators ----------
// The id is a fixed opaque UUID (not derived from anything). Membership comes from the users table, never from the client.
export const VOLUNTEER_HUB_ID = "00000000-0000-4000-8000-0000000000a1";
let hubReady = false;
export const resetHubState = () => { hubReady = false; }; // tests only

const hubPeople = async () => (await (await getRepo()).users()).filter((u) => u.role === "volunteer" || u.role === "coordinator");

/** Create the Hub (idempotent) and make sure every volunteer and coordinator is in it. Called at start-up and on access. */
export async function ensureVolunteerHub() {
  const people = await hubPeople();
  const owner = people.find((u) => u.role === "coordinator") ?? people[0];
  if (!owner) return;
  await nexconn.createGroup({
    groupId: VOLUNTEER_HUB_ID, name: "Volunteer Hub", ownerId: owner.id,
    memberIds: people.filter((u) => u.id !== owner.id).map((u) => u.id), mayExist: true,
  });
  hubReady = true;
}

/** Post a system alert into the Hub (for example when an SOS starts). Never includes exact locations: unverified volunteers are members. */
export async function postHubAlert(text: string) {
  if (!hubReady) await ensureVolunteerHub();
  await nexconn.postSystemMessage({ groupId: VOLUNTEER_HUB_ID, text });
}

/** Volunteers (verified or not) and coordinators may open the Hub, with or without an assignment. */
export async function hubAccess(user: User) {
  if (user.role !== "volunteer" && user.role !== "coordinator") throw new HttpError(403, "The Volunteer Hub is for volunteers and coordinators");
  if (!hubReady) await ensureVolunteerHub();
  await nexconn.addMember({ groupId: VOLUNTEER_HUB_ID, userId: user.id }); // idempotent
  const people = await hubPeople();
  return { groupId: VOLUNTEER_HUB_ID, participants: people.map((u) => ({ id: u.id, name: u.name, role: u.role })) };
}


// ---------- Citizen channel: a SEPARATE group per incident (citizen + accepted volunteer + coordinator) ----------
// The operations room (coordinator + volunteer) is left exactly as it was. This one is created when a volunteer accepts.
export async function ensureCitizenRoom(incident: Incident, coordinatorId: string, volunteerId: string): Promise<string> {
  const repo = await getRepo();
  let channel = await repo.channel(incident.id, "citizen");
  if (!channel) {
    const groupId = randomUUID();
    await nexconn.createGroup({
      groupId, name: `Help: ${incident.category} · ${incident.address_text || incident.id.slice(0, 8)}`,
      ownerId: coordinatorId, memberIds: [incident.reporter_id, volunteerId],
    });
    channel = { incident_id: incident.id, nexconn_channel_id: groupId, kind: "citizen" };
    await repo.addChannel(channel);
    await logEvent(incident.id, null, "citizen_room_created");
    const volunteer = (await repo.users()).find((u) => u.id === volunteerId);
    await nexconn.postSystemMessage({
      groupId, text: `${volunteer?.name ?? "A volunteer"} accepted your request and is on the way. You can message them here.`,
    });
  } else {
    for (const userId of [coordinatorId, incident.reporter_id, volunteerId]) await nexconn.addMember({ groupId: channel.nexconn_channel_id, userId });
  }
  return channel.nexconn_channel_id;
}

/** Who may open the citizen channel: the reporting citizen, any coordinator, and the volunteer who accepted. Everyone else gets 403. */
export async function citizenRoomAccess(user: User, incidentId: string) {
  const repo = await getRepo();
  const incident = await getIncident(incidentId);
  const accepted = (await repo.assignments({ incident_id: incident.id })).filter((a) => a.status === "accepted");
  const allowed = user.role === "coordinator" || (user.role === "citizen" && incident.reporter_id === user.id)
    || (user.role === "volunteer" && accepted.some((a) => a.volunteer_id === user.id));
  if (!allowed) throw new HttpError(403, "You are not a member of this chat");
  const channel = await repo.channel(incident.id, "citizen");
  if (!channel) throw new HttpError(404, "Waiting for a volunteer to accept. The chat opens as soon as one does.");
  await nexconn.addMember({ groupId: channel.nexconn_channel_id, userId: user.id }); // idempotent
  const users = await repo.users();
  const people = users.filter((u) => u.id === incident.reporter_id || u.role === "coordinator" || accepted.some((a) => a.volunteer_id === u.id));
  return { groupId: channel.nexconn_channel_id, participants: people.map((u) => ({ id: u.id, name: u.name, role: u.role })) };
}

/** Rooms the person may open (for labels, unread counts and the Messages page). */
export async function listRooms(user: User) {
  const repo = await getRepo();
  const out: Array<{ kind: "hub" | "operations" | "citizen"; groupId: string; label: string; incident_id: string | null }> = [];
  if (user.role === "coordinator" || user.role === "volunteer") out.push({ kind: "hub", groupId: VOLUNTEER_HUB_ID, label: "Volunteer Hub", incident_id: null });
  const [channels, incidents, assignments] = await Promise.all([repo.channels(), repo.incidents(), repo.assignments()]);
  for (const c of channels) {
    const incident = incidents.find((i) => i.id === c.incident_id);
    if (!incident) continue;
    const kind = c.kind ?? "operations";
    const mine = assignments.filter((a) => a.incident_id === incident.id && a.volunteer_id === user.id);
    const ok = user.role === "coordinator"
      || (kind === "operations" && user.role === "volunteer" && mine.some((a) => ["approved", "accepted"].includes(a.status)))
      || (kind === "citizen" && user.role === "volunteer" && mine.some((a) => a.status === "accepted"))
      || (kind === "citizen" && user.role === "citizen" && incident.reporter_id === user.id);
    if (!ok) continue;
    const place = incident.address_text || incident.id.slice(0, 8);
    out.push({
      kind, groupId: c.nexconn_channel_id, incident_id: incident.id,
      label: kind === "citizen" ? (user.role === "citizen" ? `Your ${incident.category} request` : `Citizen chat: ${incident.category} · ${place}`) : `Incident room: ${incident.category} · ${place}`,
    });
  }
  return out;
}
