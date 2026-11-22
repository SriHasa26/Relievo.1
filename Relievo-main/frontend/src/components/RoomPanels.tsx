// Chat panels for the Volunteer Hub and the citizen channel. Access is decided by the backend (403 for non-members);
// the messages themselves travel through Nexconn via ChatPanel.
import { useEffect, useState } from "react";
import { Hourglass } from "lucide-react";
import { ChatPanel } from "@/components/ChatPanel";
import { Skeleton } from "@/components/kit";
import { api } from "@/lib/api";

interface Room { groupId: string; participants: Array<{ id: string; name: string; role: string }> }
const namesOf = (r: Room) => Object.fromEntries(r.participants.map((p) => [p.id, `${p.name} (${p.role})`]));

/** The persistent Volunteer Hub: all volunteers and coordinators, available with or without an assignment. */
export function HubChat() {
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api<Room>("/api/chat/hub").then(setRoom).catch((e: Error) => setError(e.message)); }, []);
  if (error) return <p role="alert" className="text-sm text-red-700">Volunteer Hub unavailable: {error}</p>;
  if (!room) return <Skeleton className="h-80 rounded-2xl" />;
  return <ChatPanel title="Volunteer Hub" conversation={{ type: "group", id: room.groupId }} names={namesOf(room)} />;
}

/** Chat between the citizen, the volunteer who accepted, and the coordinator, on the incident page. */
export function CitizenChat({ incidentId, ready, viewer }: { incidentId: string; ready: boolean; viewer: "citizen" | "volunteer" | "coordinator" }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!ready) return;
    api<Room>(`/api/incidents/${incidentId}/citizen-room`).then(setRoom).catch((e: Error) => setError(e.message));
  }, [incidentId, ready]);

  if (!ready) {
    return (
      <section aria-label="Chat with the volunteer" className="rr-card flex items-start gap-3 p-4">
        <Hourglass className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
        <div>
          <h2 className="font-display font-semibold">{viewer === "citizen" ? "Chat with your volunteer" : "Chat with the citizen"}</h2>
          <p className="text-sm muted">{viewer === "citizen"
            ? "No volunteer has accepted your request yet. Hang tight: the chat opens here as soon as one does."
            : "This chat opens when a volunteer accepts the assignment."}</p>
        </div>
      </section>
    );
  }
  if (error) return <p role="alert" className="text-sm text-red-700">Chat unavailable: {error}</p>;
  if (!room) return <Skeleton className="h-80 rounded-2xl" />;
  return <ChatPanel title={viewer === "citizen" ? "Chat with your volunteer" : "Chat with the citizen"} conversation={{ type: "group", id: room.groupId }} names={namesOf(room)} />;
}
