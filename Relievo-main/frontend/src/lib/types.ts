// Shapes returned by the backend API (kept in sync by hand with backend/src/types.ts).
export type Role = "citizen" | "volunteer" | "coordinator" | "ngo";

export interface User {
  id: string; name: string; email: string; role: Role; phone: string; verified: boolean; is_synthetic: boolean;
}
export interface DemoUser extends User { password: string }

export const HOME: Record<Role, string> = {
  citizen: "/citizen", volunteer: "/volunteer", coordinator: "/coordinator", ngo: "/resources",
};

export type Category = "medical" | "food" | "water" | "shelter" | "rescue" | "other";
export type Urgency = "low" | "medium" | "high" | "critical";
export type IncidentStatus = "submitted" | "verified" | "assigned" | "in_progress" | "resolved" | "rejected";
export type AssignmentStatus = "approved" | "accepted" | "declined" | "reassigned" | "completed";

export interface Incident {
  id: string; reporter_id: string; original_text: string; title: string;
  category: Category; urgency: Urgency; people_affected: number | null;
  needs: string[]; vulnerable_persons: string[];
  lat: number; lng: number; address_text: string;
  status: IncidentStatus; reject_reason: string | null; possible_duplicate_of: string | null;
  is_synthetic: boolean; created_at: string;
  is_sos?: boolean; sos_status?: "active" | "cancelled" | null; sos_approximate?: boolean; priority_override?: Urgency | null;
}
export interface IncidentListItem extends Incident {
  priority: Priority;
  assignee: { id: string; name: string; status: AssignmentStatus; assignment_id: string } | null;
}

export interface Extraction {
  category: Category; urgency: Urgency; people_affected: number | null;
  needs: string[]; vulnerable_persons: string[]; missing_info: string[]; summary: string;
  requires_human_verification: true;
}
export interface Analysis {
  incident_id: string; extracted_data: Extraction; confidence: number; model_version: string;
  source: "openrouter" | "gemini" | "fallback" | "mock";
}

export interface ScoreBreakdown { D: number; K: number; A: number; C: number; total: number; distance_km: number }
export interface Assignment {
  id: string; incident_id: string; volunteer_id: string; assigned_by: string; status: AssignmentStatus;
  score_breakdown: ScoreBreakdown | null; created_at: string; responded_at: string | null;
  volunteer_name: string; assigned_by_name: string;
}
export interface IncidentDetailData {
  incident: Incident;
  priority: Priority;
  sos: { status: "active" | "cancelled"; approximate: boolean; has_audio: boolean; transcript: string; duration_s: number } | null;
  reporter: { id: string; name: string } | null;
  analysis: Analysis | null;
  assignments: Assignment[];
  allocations: Array<{ id: string; resource_name: string; allocated_quantity: number }>;
  has_room: boolean;
  has_citizen_room?: boolean;
}
export interface IncidentEvent {
  id: string; incident_id: string; actor_id: string | null; actor_name: string;
  action: string; meta: Record<string, unknown>; created_at: string;
}
export interface MatchResult {
  volunteer_id: string; name: string; eligible: boolean; excluded_reason: string | null;
  breakdown: ScoreBreakdown | null; reason: string;
}

// ---- v3: priority, notifications, SOS ----
export interface Priority {
  level: Urgency; score: number; reasons: string[]; waiting_minutes: number;
  escalated: boolean; overridden: boolean; is_sos: boolean;
}
export type NotificationType =
  | "new_incident" | "sos" | "sos_audio" | "sos_cancelled" | "priority_alert" | "assignment_offer"
  | "volunteer_accepted" | "volunteer_declined" | "escalation" | "hub_alert" | "chat_message";
export interface AppNotification {
  id: string; recipient_user_id: string | null; recipient_role: Role | null; type: NotificationType;
  priority: Urgency; incident_id: string | null; title: string; body: string;
  data: Record<string, unknown>; created_at: string; read_at: string | null;
}

export interface ChatRoom { kind: "hub" | "operations" | "citizen"; groupId: string; label: string; incident_id: string | null }
