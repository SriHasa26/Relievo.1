export type Role = "citizen" | "volunteer" | "coordinator" | "ngo";
export type Category = "medical" | "food" | "water" | "shelter" | "rescue" | "other";
export type Urgency = "low" | "medium" | "high" | "critical";
export type IncidentStatus =
  | "submitted" | "verified" | "assigned" | "in_progress" | "resolved" | "rejected";
export type Availability = "available" | "busy" | "offline";
// approved = coordinator picked them, volunteer has not answered yet
export type AssignmentStatus = "approved" | "accepted" | "declined" | "reassigned" | "completed";

export interface User {
  id: string;
  name: string;
  email: string;
  password?: string; // MOCK_DB demo accounts only; with Supabase the password lives in Supabase Auth
  role: Role;
  phone: string;
  verified: boolean;
  is_synthetic: boolean;
}

export interface VolunteerProfile {
  user_id: string;
  skills: string[];
  qualifications: string[]; // e.g. "medical", "rescue_certified"
  availability: Availability;
  capacity: number; // max concurrent active assignments
  lat: number;
  lng: number;
}

export interface Organisation {
  id: string;
  name: string;
  verification_status: "verified" | "pending";
  is_synthetic: boolean;
}

export interface Incident {
  id: string;
  reporter_id: string;
  original_text: string; // never overwritten: coordinator compares it with the AI output
  title: string;
  category: Category;
  urgency: Urgency;
  people_affected: number | null;
  needs: string[];
  vulnerable_persons: string[];
  lat: number;
  lng: number;
  address_text: string;
  status: IncidentStatus;
  reject_reason: string | null;
  possible_duplicate_of: string | null;
  is_synthetic: boolean;
  created_at: string;
  // v3 (optional so older rows and tests still type-check; the migration gives the columns defaults)
  is_sos?: boolean;
  sos_status?: "active" | "cancelled" | null;
  sos_approximate?: boolean;
  priority_override?: Urgency | null; // an explicit coordinator choice; replaces the computed level
}

export interface Extraction {
  category: Category;
  urgency: Urgency;
  people_affected: number | null;
  needs: string[];
  vulnerable_persons: string[];
  missing_info: string[];
  summary: string;
  requires_human_verification: true;
}

export interface AiAnalysis {
  incident_id: string;
  extracted_data: Extraction;
  confidence: number;
  model_version: string;
  source: "openrouter" | "gemini" | "fallback" | "mock"; // which provider answered
}

export interface ScoreBreakdown {
  D: number; K: number; A: number; C: number; total: number;
  distance_km: number;
}

export interface Assignment {
  id: string;
  incident_id: string;
  volunteer_id: string;
  assigned_by: string;
  status: AssignmentStatus;
  score_breakdown: ScoreBreakdown | null;
  created_at: string;
  responded_at: string | null;
}

export interface Resource {
  id: string;
  organisation_id: string;
  resource_type: "food" | "water" | "medicine" | "shelter";
  name: string;
  quantity: number;
  unit: string;
  lat: number;
  lng: number;
}

export interface ResourceAllocation {
  id: string;
  incident_id: string;
  resource_id: string;
  allocated_quantity: number;
  allocated_by: string;
  created_at: string;
}

export interface IncidentEvent {
  id: string;
  incident_id: string;
  actor_id: string | null; // null = system
  action: string;
  meta: Record<string, unknown>;
  created_at: string;
}

export type ChannelKind = "operations" | "citizen";
export interface IncidentChannel {
  incident_id: string;
  nexconn_channel_id: string;
  kind?: ChannelKind; // defaults to "operations"
}

export type NotificationType =
  | "new_incident" | "sos" | "sos_audio" | "sos_cancelled" | "priority_alert" | "assignment_offer"
  | "volunteer_accepted" | "volunteer_declined" | "escalation" | "hub_alert";
export interface Notification {
  id: string;
  recipient_user_id: string | null;
  recipient_role: Role | null;
  type: NotificationType;
  priority: Urgency;
  incident_id: string | null;
  title: string;
  body: string;
  data: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
}

/** A recorded SOS clip. Stored privately; only the backend can read it and only authorised roles are served it. */
export interface SosAudio {
  incident_id: string;
  mime: string;
  duration_s: number;
  size_bytes: number;
  transcript: string;
  data_base64: string;
  created_at: string;
}
