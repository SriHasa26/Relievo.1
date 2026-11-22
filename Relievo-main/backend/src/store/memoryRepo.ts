// In-memory implementation of Repo. Objects are returned by reference, so "save" has nothing to do.
import { db } from "./store";
import type { Repo } from "./repo";

const same = <T extends object>(filter: Partial<T> | undefined, row: T) =>
  Object.entries(filter ?? {}).every(([k, v]) => v === undefined || (row as Record<string, unknown>)[k] === v);

export const memoryRepo: Repo = {
  users: async () => db.users,
  userById: async (id) => db.users.find((u) => u.id === id) ?? null,
  userByEmail: async (email) => db.users.find((u) => u.email === email) ?? null,
  volunteerProfiles: async () => db.volunteerProfiles,
  saveVolunteerProfile: async () => undefined,

  incidents: async () => db.incidents,
  incident: async (id) => db.incidents.find((i) => i.id === id) ?? null,
  addIncident: async (i) => { db.incidents.push(i); },
  saveIncident: async () => undefined,
  analysis: async (incidentId) => db.analyses.find((a) => a.incident_id === incidentId) ?? null,
  analyses: async () => db.analyses,
  saveAnalysis: async (a) => {
    const i = db.analyses.findIndex((x) => x.incident_id === a.incident_id);
    if (i >= 0) db.analyses[i] = a; else db.analyses.push(a);
  },

  assignments: async (f) => db.assignments.filter((a) => same(f, a)),
  assignment: async (id) => db.assignments.find((a) => a.id === id) ?? null,
  addAssignment: async (a) => { db.assignments.push(a); },
  saveAssignment: async () => undefined,

  organisations: async () => db.organisations,
  resources: async () => db.resources,
  resource: async (id) => db.resources.find((r) => r.id === id) ?? null,
  saveResource: async () => undefined,
  allocations: async (f) => db.allocations.filter((a) => same(f, a)),
  addAllocation: async (a) => { db.allocations.push(a); },

  events: async (f) => db.events.filter((e) => same(f, e)),
  addEvent: async (e) => { db.events.push(e); },

  channels: async () => db.channels,
  channel: async (incidentId, kind = "operations") =>
    db.channels.find((c) => c.incident_id === incidentId && (c.kind ?? "operations") === kind) ?? null,
  addChannel: async (c) => { db.channels.push(c); },

  notifications: async (userId) => db.notifications.filter((n) => n.recipient_user_id === userId),
  addNotification: async (n) => { db.notifications.push(n); },
  markNotificationsRead: async (userId, ids) => {
    const at = new Date().toISOString();
    for (const n of db.notifications) {
      if (n.recipient_user_id === userId && !n.read_at && (ids === "all" || ids.includes(n.id))) n.read_at = at;
    }
  },

  sosAudio: async (incidentId) => db.sosAudio.find((a) => a.incident_id === incidentId) ?? null,
  saveSosAudio: async (a) => {
    const i = db.sosAudio.findIndex((x) => x.incident_id === a.incident_id);
    if (i >= 0) db.sosAudio[i] = a; else db.sosAudio.push(a);
  },
};
