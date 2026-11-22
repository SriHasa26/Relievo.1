// All demo data. Everything here is SYNTHETIC (is_synthetic = true) and shown as such in the UI.
// Used by the in-memory store (MOCK_DB) and by scripts/seed-supabase.ts.
import { keywordExtract } from "../services/extraction";
import type {
  Assignment, AiAnalysis, Incident, IncidentChannel, IncidentEvent, Notification, Organisation,
  Resource, ResourceAllocation, SosAudio, User, VolunteerProfile,
} from "../types";

export const DEMO_PASSWORD = "demo1234";
export const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export interface SeedData {
  users: User[];
  volunteerProfiles: VolunteerProfile[];
  organisations: Organisation[];
  incidents: Incident[];
  analyses: AiAnalysis[];
  assignments: Assignment[];
  resources: Resource[];
  allocations: ResourceAllocation[];
  events: IncidentEvent[];
  channels: IncidentChannel[];
  notifications: Notification[]; // empty in the seed; filled while the app runs
  sosAudio: SosAudio[];
}

export function buildSeed(now = Date.now()): SeedData {
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  const user = (n: number, name: string, role: User["role"], verified = true): User => ({
    id: uid(n), name, role, verified, is_synthetic: true, password: DEMO_PASSWORD,
    email: `${role}${n}@demo.reliefrelay.test`, phone: `+91-00000-000${n}`,
  });

  const users: User[] = [
    user(1, "Asha Rao", "citizen"), user(2, "Ravi Kumar", "citizen"), user(3, "Meena Iyer", "citizen"),
    user(11, "Karthik Reddy", "volunteer"), // medical, available
    user(12, "Imran Sheikh", "volunteer"), // rescue-certified, verified and AVAILABLE (the critical rescue can be matched)
    user(13, "Divya Nair", "volunteer", false), // UNVERIFIED (kept for contrast)
    user(14, "Sana Khan", "volunteer"), // logistics, available
    user(15, "Lakshmi Rao", "volunteer"), // verified but BUSY (kept for contrast)
    user(21, "Coordinator Priya", "coordinator"), user(22, "Coordinator Arjun", "coordinator"),
    user(31, "Hope Relief Trust (NGO)", "ngo"),
  ];

  const vp = (n: number, skills: string[], qualifications: string[],
    availability: VolunteerProfile["availability"], capacity: number, lat: number, lng: number): VolunteerProfile =>
    ({ user_id: uid(n), skills, qualifications, availability, capacity, lat, lng });
  const volunteerProfiles = [
    vp(11, ["first_aid", "logistics"], ["medical"], "available", 2, 17.4065, 78.4772),
    vp(12, ["rescue", "logistics"], ["rescue_certified"], "available", 1, 17.401, 78.47),
    vp(13, ["general", "first_aid"], [], "available", 1, 17.395, 78.49),
    vp(14, ["logistics", "water_supply", "food", "shelter"], [], "available", 2, 17.43, 78.44),
    vp(15, ["general", "food"], [], "busy", 1, 17.41, 78.46),
  ];

  const organisations: Organisation[] = [
    { id: uid(41), name: "Hope Relief Trust (synthetic)", verification_status: "verified", is_synthetic: true },
  ];
  const res = (n: number, type: Resource["resource_type"], name: string, quantity: number, unit: string,
    lat: number, lng: number): Resource =>
    ({ id: uid(n), organisation_id: uid(41), resource_type: type, name, quantity, unit, lat, lng });
  const resources = [
    res(51, "water", "Drinking water packs", 200, "packs", 17.42, 78.46),
    res(52, "food", "Dry ration kits", 80, "kits", 17.42, 78.46),
    res(53, "medicine", "First-aid kits + ORS", 40, "kits", 17.42, 78.46),
    res(54, "shelter", "Tarpaulin shelter kits", 30, "kits", 17.42, 78.46),
  ];

  // [incident no, reporter no, text, address, lat, lng, status, minutes ago submitted]
  const raw: Array<[number, number, string, string, number, number, Incident["status"], number]> = [
    [101, 1, "Water is entering our ground floor. There are six people in the house, including an elderly person. We need help and drinking water.", "Lane 4, Riverside Colony", 17.41, 78.48, "submitted", 12],
    [102, 2, "My father is diabetic and has run out of insulin. He is feeling very weak and dizzy. Please send someone with medicine.", "Block C, Hill View Apartments", 17.398, 78.465, "submitted", 25],
    [103, 3, "Our family of 4 has had no food for two days. There are two small children. The roads are flooded and shops are closed.", "Old Bazaar Road", 17.415, 78.472, "verified", 95],
    [104, 1, "An old woman is trapped on the roof of her house, the water level is rising fast. We cannot get her down.", "Canal Street 9", 17.402, 78.483, "verified", 140],
    [105, 2, "Our house collapsed in the rain. 12 people including children need a shelter and blankets tonight.", "Temple Ward", 17.425, 78.45, "assigned", 180],
    [106, 3, "My neighbour has a deep leg wound and is bleeding. We have no first aid. 1 person injured.", "Market Lane", 17.407, 78.476, "in_progress", 240],
    [107, 1, "No drinking water for 20 people in our lane since yesterday. Tanker cannot reach us.", "Garden Lane", 17.433, 78.442, "resolved", 600],
    [108, 2, "help", "Unknown", 17.39, 78.46, "rejected", 300],
  ];

  const incidents: Incident[] = [];
  const analyses: AiAnalysis[] = [];
  for (const [n, reporter, text, address, lat, lng, status, minsAgo] of raw) {
    const { extraction, confidence } = keywordExtract(text);
    incidents.push({
      id: uid(n), reporter_id: uid(reporter), original_text: text,
      title: extraction.summary, category: extraction.category, urgency: extraction.urgency,
      people_affected: extraction.people_affected, needs: extraction.needs,
      vulnerable_persons: extraction.vulnerable_persons, lat, lng, address_text: address,
      status,
      reject_reason: status === "rejected" ? "Not enough information to act on; reporter unreachable." : null,
      possible_duplicate_of: null, is_synthetic: true, created_at: ago(minsAgo),
    });
    analyses.push({ incident_id: uid(n), extracted_data: extraction, confidence, model_version: "keyword-v1", source: "mock" });
  }

  // Assignments: 105 awaits Sana's answer; 106 accepted by Karthik; 107 completed by Sana.
  const asg = (n: number, inc: number, vol: number, status: Assignment["status"], coord: number, minsAgo: number): Assignment => ({
    id: uid(n), incident_id: uid(inc), volunteer_id: uid(vol), assigned_by: uid(coord), status,
    score_breakdown: { D: 80, K: 100, A: 100, C: 100, total: 93, distance_km: 2 },
    created_at: ago(minsAgo), responded_at: status === "approved" ? null : ago(minsAgo - 5),
  });
  const assignments = [
    asg(201, 105, 14, "approved", 21, 150),
    asg(202, 106, 11, "accepted", 21, 215),
    asg(203, 107, 14, "completed", 22, 560),
  ];

  const allocations: ResourceAllocation[] = [
    { id: uid(301), incident_id: uid(107), resource_id: uid(51), allocated_quantity: 50, allocated_by: uid(22), created_at: ago(520) },
  ];

  // Timeline: every incident gets submitted + ai_analyzed; later steps depend on its status.
  const events: IncidentEvent[] = [];
  let e = 400;
  const ev = (inc: number, actor: number | null, action: string, minsAgo: number, meta: Record<string, unknown> = {}) =>
    events.push({ id: uid(e++), incident_id: uid(inc), actor_id: actor === null ? null : uid(actor), action, meta, created_at: ago(minsAgo) });
  for (const [n, reporter, , , , , , minsAgo] of raw) {
    ev(n, reporter, "submitted", minsAgo);
    ev(n, null, "ai_analyzed", minsAgo - 0.2, { source: "mock" });
  }
  ev(103, 21, "verified", 80);
  ev(104, 21, "verified", 120);
  ev(105, 21, "verified", 165); ev(105, 21, "assigned", 150, { volunteer_id: uid(14) }); ev(105, 21, "room_created", 150);
  ev(106, 22, "verified", 230); ev(106, 22, "assigned", 215, { volunteer_id: uid(11) });
  ev(106, 22, "room_created", 215); ev(106, 11, "accepted", 210);
  ev(107, 22, "verified", 585); ev(107, 22, "assigned", 560, { volunteer_id: uid(14) });
  ev(107, 14, "accepted", 555); ev(107, 22, "resource_allocated", 520, { resource_id: uid(51), quantity: 50 });
  ev(107, 22, "resolved", 420);
  ev(108, 21, "rejected", 290, { reason: "Not enough information to act on; reporter unreachable." });

  // Chat rooms exist for incidents that were assigned (created in the mock adapter at startup).
  const channels: IncidentChannel[] = [105, 106, 107].map((n) => ({
    incident_id: uid(n), nexconn_channel_id: `room-${uid(n)}`,
  }));

  return { users, volunteerProfiles, organisations, incidents, analyses, assignments, resources, allocations, events, channels, notifications: [], sosAudio: [] };
}
