// Incident priority: explainable and deterministic (see docs/PRIORITY.md). Pure functions, no database access.
// AI is only an input (its urgency is one of the signals); a coordinator can override the level, and an SOS is always Critical.
import type { Incident, Urgency } from "../types";

export const LEVELS: Urgency[] = ["low", "medium", "high", "critical"];
export const levelRank = (l: Urgency) => LEVELS.indexOf(l);

/** Points per urgency (the AI's suggestion, or the coordinator's edit of it). */
export const URGENCY_POINTS: Record<Urgency, number> = { low: 5, medium: 25, high: 45, critical: 70 };
export const VULNERABLE_POINTS = 10;
export const AGING_POINTS = 20; // one level step
export const AGING_AFTER_MINUTES = 30; // an unassigned incident escalates after this long
/** Minimum score of each level (also the thresholds that turn points into a level). */
export const LEVEL_FLOOR: Record<Urgency, number> = { low: 0, medium: 25, high: 45, critical: 70 };
export const SOS_SCORE_BASE = 1000;

export interface Priority {
  level: Urgency;
  score: number;          // higher = more urgent; used to sort queues
  reasons: string[];      // every contribution, in plain words
  waiting_minutes: number; // only counted while the incident is unassigned
  escalated: boolean;     // waiting-time aging moved it up
  overridden: boolean;    // a coordinator chose the level
  is_sos: boolean;
}

type Input = Pick<Incident, "urgency" | "vulnerable_persons" | "people_affected" | "status" | "created_at"> &
  Partial<Pick<Incident, "is_sos" | "sos_status" | "priority_override">>;

const peoplePoints = (n: number | null) => (n === null ? 0 : n >= 10 ? 15 : n >= 5 ? 10 : n >= 2 ? 5 : 0);
export const levelFromPoints = (p: number): Urgency => (p >= LEVEL_FLOOR.critical ? "critical" : p >= LEVEL_FLOOR.high ? "high" : p >= LEVEL_FLOOR.medium ? "medium" : "low");
const UNASSIGNED = ["submitted", "verified"];

export function computePriority(i: Input, now = Date.now()): Priority {
  const reasons: string[] = [];
  const waiting = UNASSIGNED.includes(i.status) ? Math.max(0, Math.round((now - new Date(i.created_at).getTime()) / 60_000)) : 0;

  let points = URGENCY_POINTS[i.urgency];
  reasons.push(`urgency ${i.urgency}: ${points}`);
  if (i.vulnerable_persons.length > 0) { points += VULNERABLE_POINTS; reasons.push(`vulnerable person(s): +${VULNERABLE_POINTS}`); }
  const pp = peoplePoints(i.people_affected);
  if (pp > 0) { points += pp; reasons.push(`${i.people_affected} people affected: +${pp}`); }
  const escalated = waiting >= AGING_AFTER_MINUTES;
  if (escalated) { points += AGING_POINTS; reasons.push(`waiting ${waiting} min without a volunteer: +${AGING_POINTS} (one level up)`); }

  if (i.is_sos && i.sos_status !== "cancelled") {
    reasons.unshift("SOS: always Critical");
    return { level: "critical", score: SOS_SCORE_BASE + points, reasons, waiting_minutes: waiting, escalated, overridden: false, is_sos: true };
  }
  if (i.priority_override) {
    reasons.unshift(`coordinator set the level to ${i.priority_override}`);
    return {
      level: i.priority_override, score: LEVEL_FLOOR[i.priority_override] + Math.min(points, 99) / 100,
      reasons, waiting_minutes: waiting, escalated: false, overridden: true, is_sos: false,
    };
  }
  return { level: levelFromPoints(points), score: points, reasons, waiting_minutes: waiting, escalated, overridden: false, is_sos: false };
}

/** Sort comparator: most urgent first; ties go to whoever has waited longer. */
export const byPriority = (a: { priority: Priority; created_at: string }, b: { priority: Priority; created_at: string }) =>
  b.priority.score - a.priority.score || a.created_at.localeCompare(b.created_at);

export const isHighOrCritical = (level: Urgency) => levelRank(level) >= levelRank("high");
