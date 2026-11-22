import { History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/kit";
import type { IncidentEvent } from "@/lib/types";

const TEXT: Record<string, string> = {
  submitted: "Request submitted",
  ai_analyzed: "AI analysis completed (suggestion only)",
  duplicate_flagged: "Flagged as a possible duplicate",
  edited: "Coordinator edited the AI fields",
  verified: "Verified by coordinator",
  rejected: "Rejected by coordinator",
  assigned: "Volunteer assigned (approved by coordinator)",
  reassigned: "Reassigned to another volunteer",
  declined: "Volunteer declined",
  accepted: "Volunteer accepted. Work in progress",
  room_created: "Incident chat room created",
  resource_allocated: "Relief resource allocated",
  resolved: "Marked resolved",
  priority_overridden: "Coordinator changed the priority",
  sos_started: "EMERGENCY SOS started",
  sos_audio_added: "SOS recording and transcript received",
  sos_cancelled: "SOS cancelled: citizen is safe",
  escalated: "Escalated: waiting too long without a volunteer",
  citizen_room_created: "Chat with the citizen opened",
};

export function Timeline({ events }: { events: IncidentEvent[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Status timeline</CardTitle></CardHeader>
      <CardContent>
        {events.length === 0 && <EmptyState icon={<History className="size-6" />} title="No events yet" />}
        {/* Stacked 3D look: older entries tilt back slightly; the newest sits flat and carries the lit LED. */}
        <ol className="timeline-3d space-y-3 border-l-2 border-slate-200 pl-5">
          {events.map((e, idx) => (
            <li key={e.id} className="relative rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm"
              style={{ "--rx": `${Math.min(4, (events.length - 1 - idx) * 0.5)}deg` } as React.CSSProperties}>
              <i aria-hidden className={`led absolute -left-[1.85rem] top-3.5 tone-blue ${idx === events.length - 1 ? "led-glow" : ""}`} />
              <p className="text-sm font-medium">{TEXT[e.action] ?? e.action}</p>
              <p className="text-xs text-slate-500">
                {e.actor_name} · {new Date(e.created_at).toLocaleString()}
                {typeof e.meta.reason === "string" && ` · "${e.meta.reason}"`}
              </p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
