// Incident group room: the backend checks membership and returns the group id; the chat itself goes through Nexconn.
import { useEffect, useState } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { Skeleton } from "@/components/kit";
import { api } from "@/lib/api";

interface Room { groupId: string; participants: Array<{ id: string; name: string; role: string }> }

export function RoomChat({ incidentId }: { incidentId: string }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Room>(`/api/incidents/${incidentId}/room`).then(setRoom).catch((e) => setError((e as Error).message));
  }, [incidentId]);

  if (error) return <p className="text-sm text-slate-600">Incident room unavailable: {error}</p>;
  if (!room) return <Skeleton className="h-80 rounded-2xl" />;
  const names = Object.fromEntries(room.participants.map((p) => [p.id, `${p.name} (${p.role})`]));
  return <ChatPanel title="Incident room" conversation={{ type: "group", id: room.groupId }} names={names} />;
}
