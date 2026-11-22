import { Link } from "react-router-dom";
import { StatusBadge, SyntheticBadge, UrgencyBadge } from "@/components/badges";
import { TiltCard, UrgencyGauge } from "@/components/kit";
import type { IncidentListItem } from "@/lib/types";
import { cn, label, timeAgo } from "@/lib/utils";

interface Props {
  incident: IncidentListItem;
  tilt?: boolean;            // 3D hover tilt (coordinator only; off for touch and reduced motion)
  selected?: boolean;        // highlighted because the map is flying to it
  fresh?: boolean;           // just arrived: drops in
  changed?: boolean;         // status or urgency changed: brief ember flash
  shake?: boolean;           // new critical card: gentle shake
  onSelect?: () => void;     // hover or focus
}

/** One incident in a list. */
export function IncidentRow({ incident: i, tilt, selected, fresh, changed, shake, onSelect }: Props) {
  const level = i.priority?.level ?? i.urgency;
  const waiting = i.priority?.waiting_minutes ?? 0;
  const emergency = (level === "critical" || i.is_sos === true) && (i.status === "submitted" || i.status === "verified");
  const row = (
    <Link to={`/incidents/${i.id}`} onMouseEnter={onSelect} onFocus={onSelect}
      className={cn("rr-card block p-3.5 transition-colors hover:border-[var(--brand)] focus-visible:border-[var(--brand)]",
        emergency && "card-critical", selected && "border-[var(--brand)]", fresh && "fresh-in", changed && "flash-change", shake && "shake-once")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display font-semibold capitalize">{label(i.category)}</span>
        {i.is_sos && i.sos_status !== "cancelled" && <span className="alert-tag">SOS</span>}
        <UrgencyBadge urgency={level} />
        <StatusBadge status={i.status} />
        {waiting > 0 && (
          <span className={cn("pill", waiting >= 30 ? "tone-amber" : "tone-gray")} title={i.priority?.escalated ? "Escalated: waiting too long" : "Waiting for a volunteer"}>
            {waiting >= 60 ? `${Math.floor(waiting / 60)} h ${waiting % 60} min` : `${waiting} min`} waiting{i.priority?.escalated ? " ↑" : ""}
          </span>
        )}
        {i.possible_duplicate_of && <span className="text-xs text-amber-800">possible duplicate</span>}
        {i.is_synthetic && <SyntheticBadge />}
        <span className="ml-auto text-xs text-slate-500">{timeAgo(i.created_at)}</span>
      </div>
      <div className="mt-1.5 flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm text-slate-700">{i.original_text}</p>
          <p className="mt-1 text-xs text-slate-500">
            {i.address_text || "Location on map"}
            {i.people_affected !== null && ` · ${i.people_affected} people`}
            {i.assignee && ` · ${i.assignee.name} (${i.assignee.status})`}
          </p>
        </div>
        {tilt && <div className="hidden sm:block"><UrgencyGauge urgency={level} size={52} /></div>}
      </div>
    </Link>
  );
  return tilt ? <TiltCard>{row}</TiltCard> : row;
}
