import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart3, CircleCheck, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AnimatedNumber, NeuMeter, Skeleton } from "@/components/kit";
import { api } from "@/lib/api";
import type { IncidentStatus, Urgency } from "@/lib/types";
import { label } from "@/lib/utils";

interface Metrics {
  total_incidents: number;
  status_counts: Record<IncidentStatus, number>;
  awaiting_review: number;
  unassigned_incidents: Array<{ id: string; category: string; urgency: Urgency; waiting_minutes: number }>;
  avg_minutes_to_verify: number | null;
  avg_minutes_to_assign: number | null;
  resolution_rate: number;
  volunteers_deployed: number;
  resources_allocated_units: number;
  resources_allocations: number;
  events_recorded: number;
  synthetic: boolean;
}

function Tile({ title, value, suffix = "", note }: { title: string; value: number | null; suffix?: string; note?: string }) {
  return (
    <Card>
      <CardContent>
        <p className="text-sm text-slate-500">{title}</p>
        <p className="font-display text-3xl font-bold">{value === null ? "n/a" : <AnimatedNumber value={value} suffix={suffix} />}</p>
        {note && <p className="text-xs text-slate-500">{note}</p>}
      </CardContent>
    </Card>
  );
}

export default function Impact() {
  const [m, setM] = useState<Metrics | null>(null);

  useEffect(() => {
    const load = () => api<Metrics>("/api/metrics").then(setM).catch(() => undefined);
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  if (!m) return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>;
  const statuses = Object.entries(m.status_counts) as Array<[IncidentStatus, number]>;
  const max = Math.max(1, ...statuses.map(([, n]) => n));

  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2 text-2xl font-bold"><BarChart3 className="size-6 text-brand" aria-hidden />Impact dashboard</h1>
      {m.synthetic && (
        <p className="flex flex-wrap items-center gap-2 text-sm muted">
          <span className="pill tone-amber">Demo data</span>
          Computed from the incident event log. Not real-world results.
        </p>
      )}
      <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile title="Incidents" value={m.total_incidents} />
        <Tile title="Awaiting review" value={m.awaiting_review} note="submitted, not yet verified" />
        <Tile title="Avg time to verify" value={m.avg_minutes_to_verify} suffix=" min" note="submitted → verified" />
        <Tile title="Avg time to assign" value={m.avg_minutes_to_assign} suffix=" min" note="verified → volunteer approved" />
        <Tile title="Resolution rate" value={m.resolution_rate} suffix="%" note="resolved / not rejected" />
        <Tile title="Volunteers deployed" value={m.volunteers_deployed} />
        <Tile title="Resources allocated" value={m.resources_allocated_units} note={`${m.resources_allocations} allocations`} />
        <Tile title="Events recorded" value={m.events_recorded} note="audit trail entries" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Incidents by status</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {statuses.map(([status, n]) => (
              <div key={status} className="flex items-center gap-2 text-sm">
                <span className="w-24 capitalize">{label(status)}</span>
                <div className="flex-1">{n === 0 ? <div className="h-3.5" /> : <NeuMeter value={(n / max) * 100} label={`${label(status)} incidents`} />}</div>
                <span className="w-6 text-right font-medium">{n}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Verified but unassigned</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {m.awaiting_review > 0 && (
              <p className="flex items-center gap-2 rounded-lg bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900">
                <TriangleAlert className="size-4 shrink-0" aria-hidden />{m.awaiting_review} report(s) still waiting for a coordinator to verify.
              </p>
            )}
            {m.unassigned_incidents.length === 0 && (
              <p className="flex items-center gap-2 text-sm text-slate-600"><CircleCheck className="size-4 text-green-500" aria-hidden />None. Every verified incident has a volunteer.</p>
            )}
            {m.unassigned_incidents.map((u) => (
              <Link key={u.id} to={`/incidents/${u.id}`} className="flex items-center gap-2 rounded-lg border p-2.5 text-sm transition-colors hover:border-[var(--brand)]">
                <span className="capitalize">{u.category}</span>
                <Badge tone={u.urgency === "critical" ? "red" : "amber"}>{u.urgency}</Badge>
                <span className={`ml-auto font-semibold ${u.waiting_minutes > 30 ? "text-red-700" : "text-slate-500"}`}>waiting {u.waiting_minutes} min</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
