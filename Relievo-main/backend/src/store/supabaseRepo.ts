// Supabase (Postgres) implementation of Repo. Uses the SERVICE-ROLE key, so it bypasses RLS:
// the backend itself enforces who may see and do what (see services/*). Backend only, never the frontend.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config";
import type { Repo } from "./repo";
import type { Assignment, IncidentEvent, Notification, ResourceAllocation, SosAudio, User } from "../types";

type Row = Record<string, unknown>;

export function createServiceClient(): SupabaseClient {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error("MOCK_DB=false needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env");
  }
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Postgres returns timestamps as "...+00:00"; the app uses "...Z" so strings sort and compare consistently. */
const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);

export function createSupabaseRepo(sb: SupabaseClient = createServiceClient()): Repo {
  const fail = (what: string, error: { message: string }): never => { throw new Error(`Supabase ${what}: ${error.message}`); };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function select<T = Row>(table: string, build?: (q: any) => any): Promise<T[]> {
    const query = sb.from(table).select("*");
    const { data, error } = await (build ? build(query) : query);
    if (error) fail(`select ${table}`, error);
    return (data ?? []) as T[];
  }
  const one = async <T = Row>(table: string, key: string, value: string): Promise<T | null> => {
    const { data, error } = await sb.from(table).select("*").eq(key, value).maybeSingle();
    if (error) fail(`select ${table}`, error);
    return (data as T | null) ?? null;
  };
  const insert = async (table: string, row: object) => {
    const { error } = await sb.from(table).insert(row);
    if (error) fail(`insert ${table}`, error);
  };
  const update = async (table: string, key: string, value: string, row: object) => {
    const { error } = await sb.from(table).update(row).eq(key, value);
    if (error) fail(`update ${table}`, error);
  };

  const toUser = (r: Row): User => ({
    id: String(r.id), name: String(r.name), email: String(r.email ?? ""), role: r.role as User["role"],
    phone: String(r.phone ?? ""), verified: Boolean(r.verified), is_synthetic: Boolean(r.is_synthetic),
  });
  const toAssignment = (r: Row): Assignment => ({
    ...(r as unknown as Assignment), created_at: iso(r.created_at)!, responded_at: iso(r.responded_at),
  });
  const toEvent = (r: Row): IncidentEvent => ({ ...(r as unknown as IncidentEvent), created_at: iso(r.created_at)! });
  const toAllocation = (r: Row): ResourceAllocation => ({ ...(r as unknown as ResourceAllocation), created_at: iso(r.created_at)! });
  const toIncident = (r: Row) => ({ ...(r as unknown as import("../types").Incident), created_at: iso(r.created_at)! });
  const toAnalysis = (r: Row) => ({ ...(r as unknown as import("../types").AiAnalysis), confidence: Number(r.confidence) });

  return {
    users: async () => (await select("users")).map(toUser),
    userById: async (id) => { const r = await one("users", "id", id); return r ? toUser(r) : null; },
    userByEmail: async (email) => { const r = await one("users", "email", email); return r ? toUser(r) : null; },
    volunteerProfiles: async () => select("volunteer_profiles"),
    saveVolunteerProfile: async (p) => update("volunteer_profiles", "user_id", p.user_id, p),

    incidents: async () => (await select("incidents")).map(toIncident),
    incident: async (id) => { const r = await one("incidents", "id", id); return r ? toIncident(r) : null; },
    addIncident: async (i) => insert("incidents", i),
    saveIncident: async (i) => update("incidents", "id", i.id, i),
    analysis: async (incidentId) => { const r = await one("incident_ai_analysis", "incident_id", incidentId); return r ? toAnalysis(r) : null; },
    analyses: async () => (await select("incident_ai_analysis")).map(toAnalysis),
    saveAnalysis: async (a) => {
      const { error } = await sb.from("incident_ai_analysis").upsert(a);
      if (error) fail("upsert incident_ai_analysis", error);
    },

    assignments: async (f) => (await select("assignments", (q) => {
      if (f?.incident_id) q = q.eq("incident_id", f.incident_id);
      if (f?.volunteer_id) q = q.eq("volunteer_id", f.volunteer_id);
      return q.order("created_at");
    })).map(toAssignment),
    assignment: async (id) => { const r = await one("assignments", "id", id); return r ? toAssignment(r) : null; },
    addAssignment: async (a) => insert("assignments", a),
    saveAssignment: async (a) => update("assignments", "id", a.id, a),

    organisations: async () => select("organisations"),
    resources: async () => select("resources"),
    resource: async (id) => one("resources", "id", id) as never,
    saveResource: async (r) => update("resources", "id", r.id, r),
    allocations: async (f) => (await select("resource_allocations", (q) => (f?.incident_id ? q.eq("incident_id", f.incident_id) : q))).map(toAllocation),
    addAllocation: async (a) => insert("resource_allocations", a),

    events: async (f) => (await select("incident_events", (q) => (f?.incident_id ? q.eq("incident_id", f.incident_id) : q).order("created_at"))).map(toEvent),
    addEvent: async (e) => insert("incident_events", e),

    channels: async () => select("incident_channels"),
    channel: async (incidentId, kind = "operations") => {
      const { data, error } = await sb.from("incident_channels").select("*").eq("incident_id", incidentId).eq("kind", kind).maybeSingle();
      if (error) {
        // The v3 migration (adds the `kind` column) is not applied yet: the only room that can exist is the operations room.
        if (/kind/i.test(error.message)) {
          if (kind !== "operations") return null;
          const legacy = await sb.from("incident_channels").select("*").eq("incident_id", incidentId).maybeSingle();
          if (legacy.error) fail("select incident_channels", legacy.error);
          return (legacy.data as never) ?? null;
        }
        fail("select incident_channels", error);
      }
      return (data as never) ?? null;
    },
    addChannel: async (c) => insert("incident_channels", c),

    notifications: async (userId) => (await select("notifications", (q) => q.eq("recipient_user_id", userId).order("created_at", { ascending: false }).limit(100)))
      .map((r) => ({ ...(r as unknown as Notification), created_at: iso(r.created_at)!, read_at: iso(r.read_at) })),
    addNotification: async (n) => insert("notifications", n),
    markNotificationsRead: async (userId, ids) => {
      let q = sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("recipient_user_id", userId).is("read_at", null);
      if (ids !== "all") q = q.in("id", ids);
      const { error } = await q;
      if (error) fail("update notifications", error);
    },

    sosAudio: async (incidentId) => {
      const r = await one("sos_audio", "incident_id", incidentId);
      return r ? ({ ...(r as unknown as SosAudio), created_at: iso(r.created_at)!, duration_s: Number(r.duration_s) }) : null;
    },
    saveSosAudio: async (a) => {
      const { error } = await sb.from("sos_audio").upsert(a);
      if (error) fail("upsert sos_audio", error);
    },
  };
}
