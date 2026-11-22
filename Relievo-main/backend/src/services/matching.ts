// ResponderMatch: deterministic, explainable volunteer ranking. No AI involved.
//   S = 0.35*D + 0.30*K + 0.20*A + 0.15*C      (each component 0-100)
//   D distance suitability: 100 at 0 km, falling linearly to 0 at MAX_KM
//   K skill relevance: share of the skills this category needs that the volunteer has (25 if only "general")
//   A availability: 100 if free right now, 60 if available but already holding a task
//   C capacity: free slots as a percentage of the volunteer's capacity
// Hard exclusions (never ranked): unverified, busy/offline, at capacity, missing a required
// qualification for medical/rescue tasks, or already declined this incident.
import type { Category, Incident, ScoreBreakdown, User, VolunteerProfile } from "../types";

export const WEIGHTS = { D: 0.35, K: 0.3, A: 0.2, C: 0.15 } as const;
export const MAX_KM = 10;

const REQUIRED_SKILLS: Record<Category, string[]> = {
  medical: ["first_aid"],
  food: ["food", "logistics"],
  water: ["water_supply", "logistics"],
  shelter: ["shelter", "logistics"],
  rescue: ["rescue"],
  other: ["general"],
};
const REQUIRED_QUALIFICATION: Partial<Record<Category, string>> = {
  medical: "medical",
  rescue: "rescue_certified",
};

export interface LatLng { lat: number; lng: number }

/** Haversine great-circle distance in km. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export interface Candidate {
  user: Pick<User, "id" | "name" | "verified">;
  profile: VolunteerProfile;
  activeCount: number; // assignments currently approved or accepted
}

export interface MatchResult {
  volunteer_id: string;
  name: string;
  eligible: boolean;
  excluded_reason: string | null;
  breakdown: ScoreBreakdown | null;
  reason: string; // plain-language explanation for the coordinator
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function scoreVolunteer(
  incident: Pick<Incident, "category" | "lat" | "lng">, c: Candidate,
): ScoreBreakdown {
  const km = distanceKm(incident, c.profile);
  const D = Math.max(0, 100 * (1 - km / MAX_KM));

  const needed = REQUIRED_SKILLS[incident.category];
  const covered = needed.filter((s) => c.profile.skills.includes(s)).length;
  let K = (100 * covered) / needed.length;
  if (covered === 0 && c.profile.skills.includes("general")) K = 25;

  const A = c.activeCount === 0 ? 100 : 60;
  const C = (100 * (c.profile.capacity - c.activeCount)) / c.profile.capacity;

  const total = WEIGHTS.D * D + WEIGHTS.K * K + WEIGHTS.A * A + WEIGHTS.C * C;
  return { D: round1(D), K: round1(K), A: round1(A), C: round1(C), total: round1(total), distance_km: round1(km) };
}

export function exclusionReason(
  incident: Pick<Incident, "category">, c: Candidate, declined = false,
): string | null {
  if (!c.user.verified) return "Not verified: unverified volunteers cannot be assigned";
  if (c.profile.availability !== "available") return `Currently ${c.profile.availability}`;
  if (declined) return "Declined this incident";
  if (c.activeCount >= c.profile.capacity) return "At capacity: already holding an active assignment";
  const qualification = REQUIRED_QUALIFICATION[incident.category];
  if (qualification && !c.profile.qualifications.includes(qualification)) {
    return `Needs a verified "${qualification}" qualification for ${incident.category} tasks`;
  }
  return null;
}

function explain(b: ScoreBreakdown, c: Candidate): string {
  const skills = b.K >= 100 ? "has all the skills needed" : b.K > 25 ? "has some of the skills needed" : b.K > 0 ? "is a general volunteer" : "has no matching skills";
  const load = c.activeCount === 0 ? "is free right now" : `already has ${c.activeCount} active task(s) but has capacity`;
  return `${b.distance_km} km away, ${skills}, ${load}.`;
}

/** Eligible volunteers ranked best-first, then excluded ones with the reason. */
export function rankVolunteers(
  incident: Pick<Incident, "category" | "lat" | "lng">,
  candidates: Candidate[],
  declinedIds: string[] = [],
): MatchResult[] {
  const results = candidates.map((c): MatchResult => {
    const excluded = exclusionReason(incident, c, declinedIds.includes(c.user.id));
    if (excluded) {
      return { volunteer_id: c.user.id, name: c.user.name, eligible: false, excluded_reason: excluded, breakdown: null, reason: excluded };
    }
    const breakdown = scoreVolunteer(incident, c);
    return { volunteer_id: c.user.id, name: c.user.name, eligible: true, excluded_reason: null, breakdown, reason: explain(breakdown, c) };
  });
  const eligible = results.filter((r) => r.eligible).sort((a, b) => b.breakdown!.total - a.breakdown!.total);
  return [...eligible, ...results.filter((r) => !r.eligible)];
}
