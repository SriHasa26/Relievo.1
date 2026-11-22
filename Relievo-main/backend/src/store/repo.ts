// The data-access layer. Services only talk to this interface, never to arrays or to Supabase directly.
//   MOCK_DB=true  -> memoryRepo.ts   (in-memory, seeded, resets on restart; used by the unit tests)
//   MOCK_DB=false -> supabaseRepo.ts (Supabase Postgres with the service-role key, backend only)
// "save*" writes the whole object back (update by id); "add*" inserts a new row.
import { randomUUID } from "node:crypto";
import { config } from "../config";
import type {
  AiAnalysis, Assignment, ChannelKind, Incident, IncidentChannel, IncidentEvent, Notification, Organisation, Resource,
  ResourceAllocation, SosAudio, User, VolunteerProfile,
} from "../types";

export interface Repo {
  // users and volunteers
  users(): Promise<User[]>;
  userById(id: string): Promise<User | null>;
  userByEmail(email: string): Promise<User | null>; // mock login only
  volunteerProfiles(): Promise<VolunteerProfile[]>;
  saveVolunteerProfile(profile: VolunteerProfile): Promise<void>;
  // incidents and their AI analysis
  incidents(): Promise<Incident[]>;
  incident(id: string): Promise<Incident | null>;
  addIncident(incident: Incident): Promise<void>;
  saveIncident(incident: Incident): Promise<void>;
  analysis(incidentId: string): Promise<AiAnalysis | null>;
  analyses(): Promise<AiAnalysis[]>;
  saveAnalysis(analysis: AiAnalysis): Promise<void>;
  // assignments
  assignments(filter?: { incident_id?: string; volunteer_id?: string }): Promise<Assignment[]>;
  assignment(id: string): Promise<Assignment | null>;
  addAssignment(assignment: Assignment): Promise<void>;
  saveAssignment(assignment: Assignment): Promise<void>;
  // resources and allocations
  organisations(): Promise<Organisation[]>;
  resources(): Promise<Resource[]>;
  resource(id: string): Promise<Resource | null>;
  saveResource(resource: Resource): Promise<void>;
  allocations(filter?: { incident_id?: string }): Promise<ResourceAllocation[]>;
  addAllocation(allocation: ResourceAllocation): Promise<void>;
  // audit trail (append-only)
  events(filter?: { incident_id?: string }): Promise<IncidentEvent[]>;
  addEvent(event: IncidentEvent): Promise<void>;
  // chat room ids (Nexconn group id per incident)
  channels(): Promise<IncidentChannel[]>;
  channel(incidentId: string, kind?: ChannelKind): Promise<IncidentChannel | null>; // kind defaults to "operations"
  addChannel(channel: IncidentChannel): Promise<void>;
  // notifications (one row per recipient)
  notifications(userId: string): Promise<Notification[]>;
  addNotification(n: Notification): Promise<void>;
  markNotificationsRead(userId: string, ids: string[] | "all"): Promise<void>;
  // SOS audio (private)
  sosAudio(incidentId: string): Promise<SosAudio | null>;
  saveSosAudio(a: SosAudio): Promise<void>;
}

let current: Repo | null = null;

/** The repository for the current MOCK_DB setting. Created on first use. */
export async function getRepo(): Promise<Repo> {
  if (!current) {
    current = config.mockDb
      ? (await import("./memoryRepo")).memoryRepo
      : (await import("./supabaseRepo")).createSupabaseRepo();
  }
  return current;
}

export const newId = () => randomUUID();

/** Append-only audit trail. Every state change in the app calls this. */
export async function logEvent(incidentId: string, actorId: string | null, action: string, meta: Record<string, unknown> = {}) {
  const event: IncidentEvent = {
    id: newId(), incident_id: incidentId, actor_id: actorId, action, meta, created_at: new Date().toISOString(),
  };
  await (await getRepo()).addEvent(event);
  return event;
}

/** Swap the repository (tests only). */
export function setRepo(repo: Repo | null) {
  current = repo;
}
