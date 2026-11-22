import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CountBadge } from "@/components/Layout";
import { DirectMessages } from "@/components/DirectMessages";
import { HubChat } from "@/components/RoomPanels";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/lib/notifications";

type Tab = "direct" | "hub" | "rooms";

export default function Messages({ initialTab = "direct" }: { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const { chatUnread, rooms } = useNotifications();
  const navigate = useNavigate();
  const hub = rooms.find((r) => r.kind === "hub");
  const incidentRooms = rooms.filter((r) => r.kind !== "hub");
  const directUnread = Object.entries(chatUnread).filter(([k]) => k.startsWith("direct:")).reduce((a, [, n]) => a + n, 0);
  const roomUnread = incidentRooms.reduce((a, r) => a + (chatUnread[`group:${r.groupId}`] ?? 0), 0);

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Messages</h1>
      <div role="tablist" aria-label="Chat boxes" className="flex flex-wrap gap-2">
        <Button role="tab" aria-selected={tab === "direct"} size="sm" variant={tab === "direct" ? "default" : "outline"} onClick={() => setTab("direct")}>
          Direct messages {tab !== "direct" && <CountBadge n={directUnread} label="direct chats" />}
        </Button>
        <Button role="tab" aria-selected={tab === "hub"} size="sm" variant={tab === "hub" ? "default" : "outline"} onClick={() => setTab("hub")}>
          Volunteer Hub {tab !== "hub" && hub && <CountBadge n={chatUnread[`group:${hub.groupId}`] ?? 0} label="Hub chats" />}
        </Button>
        <Button role="tab" aria-selected={tab === "rooms"} size="sm" variant={tab === "rooms" ? "default" : "outline"} onClick={() => setTab("rooms")}>
          Incident rooms {tab !== "rooms" && <CountBadge n={roomUnread} label="room chats" />}
        </Button>
      </div>

      {tab === "direct" && (<><p className="text-sm text-slate-600">Private messages between coordinators and volunteers.</p><DirectMessages /></>)}
      {tab === "hub" && (<><p className="text-sm text-slate-600">One room for every volunteer and coordinator. Coordinators can broadcast here.</p><HubChat /></>)}
      {tab === "rooms" && (
        <ul className="space-y-2">
          {incidentRooms.length === 0 && <li className="text-sm text-slate-600">No incident rooms yet. They open when a volunteer is assigned or accepts.</li>}
          {incidentRooms.map((r) => (
            <li key={r.groupId}>
              <button type="button" onClick={() => r.incident_id && navigate(`/incidents/${r.incident_id}`)}
                className="rr-card flex w-full items-center gap-2 p-3 text-left text-sm hover:border-[var(--brand)]">
                <span className="flex-1">{r.label}</span><CountBadge n={chatUnread[`group:${r.groupId}`] ?? 0} label="chats" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
