import { StatusPill, type Tone } from "@/components/kit";
import type { IncidentStatus, Urgency } from "@/lib/types";
import { label } from "@/lib/utils";

// LED colours: critical = glowing red, verified = blue, resolved = green.
const STATUS_TONE: Record<IncidentStatus, Tone> = {
  submitted: "gray", verified: "teal", assigned: "ember", in_progress: "amber", resolved: "green", rejected: "gray",
};
const URGENCY_TONE: Record<Urgency, Tone> = { low: "gray", medium: "teal", high: "amber", critical: "red" };

export const StatusBadge = ({ status }: { status: IncidentStatus }) => (
  <StatusPill tone={STATUS_TONE[status]} glow={status === "verified" || status === "resolved"}>{label(status)}</StatusPill>
);
export const UrgencyBadge = ({ urgency }: { urgency: Urgency }) => (
  <StatusPill tone={URGENCY_TONE[urgency]} glow={urgency === "critical"} pulse={urgency === "critical"}>{urgency}</StatusPill>
);
export const SyntheticBadge = () => <StatusPill tone="amber">synthetic</StatusPill>;

export const URGENCY_COLOR: Record<Urgency, string> = {
  low: "#9a9fa6", medium: "#14b8a6", high: "#f5a524", critical: "#ef4444",
};
