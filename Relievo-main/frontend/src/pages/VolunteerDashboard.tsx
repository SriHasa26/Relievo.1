import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ClipboardList, X } from "lucide-react";
import { StatusBadge, UrgencyBadge } from "@/components/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, NeuSegmented, SkeletonList, useToast } from "@/components/kit";
import { api } from "@/lib/api";
import type { IncidentListItem } from "@/lib/types";
import { label } from "@/lib/utils";

type Availability = "available" | "busy" | "offline";

export default function VolunteerDashboard() {
  const [items, setItems] = useState<IncidentListItem[] | null>(null);
  const toast = useToast();
  const [availability, setAvailability] = useState<Availability>("available");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<IncidentListItem[]>("/api/incidents").then(setItems).catch(() => undefined);
    api<{ availability: Availability }>("/api/volunteers/me").then((p) => setAvailability(p.availability)).catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const respond = async (assignmentId: string, accept: boolean) => {
    setError("");
    try { await api(`/api/assignments/${assignmentId}/respond`, { body: { accept } }); toast(accept ? "Assignment accepted" : "Assignment declined"); load(); }
    catch (e) { setError((e as Error).message); }
  };
  const changeAvailability = async (value: Availability) => {
    setAvailability(value);
    await api("/api/volunteers/me", { method: "PATCH", body: { availability: value } });
  };

  const all = items ?? [];
  // Active SOS alerts nobody has taken yet (the server only lists them for VERIFIED volunteers)
  const sosAlerts = all.filter((i) => i.is_sos && i.sos_status === "active" && !i.assignee);
  const pending = all.filter((i) => i.assignee?.status === "approved");
  const rest = all.filter((i) => i.assignee?.status !== "approved" && !sosAlerts.includes(i));

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">My assignments</h1>
      <div className="rr-card space-y-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <i aria-hidden className={`led ${availability === "available" ? "tone-green led-glow" : availability === "busy" ? "tone-amber" : "tone-gray"}`} />
            My availability
          </span>
          <NeuSegmented label="My availability" value={availability} onChange={(v) => void changeAvailability(v)}
            options={[["available", "Available"], ["busy", "Busy"], ["offline", "Offline"]]} />
        </div>
        <p className="text-xs text-slate-500">Busy or offline volunteers are not offered new assignments.</p>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {items === null && <SkeletonList rows={2} />}

      {sosAlerts.length > 0 && <h2 className="font-display text-lg font-semibold text-red-700">SOS alerts</h2>}
      <div className="space-y-3">
        {sosAlerts.map((i) => (
          <Link key={i.id} to={`/incidents/${i.id}`} className="rr-card card-critical block p-3.5">
            <div className="flex flex-wrap items-center gap-2"><span className="alert-tag">SOS</span><span className="font-display font-semibold">Citizen needs urgent help</span>
              <span className="text-sm text-slate-500">{i.address_text}</span></div>
            <p className="mt-1 text-sm">Open to hear the recording and see the location. A coordinator decides who goes.</p>
          </Link>
        ))}
      </div>

      {pending.length > 0 && <h2 className="font-display text-lg font-semibold">Waiting for your answer</h2>}
      <div className="stagger space-y-3">
        {pending.map((i) => (
          <Card key={i.id} className="border-amber-400 border-2">
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display font-semibold capitalize">{label(i.category)}</span>
                <UrgencyBadge urgency={i.urgency} />
                <span className="text-sm text-slate-500">{i.address_text}{i.people_affected !== null && ` · ${i.people_affected} people`}</span>
              </div>
              <p className="text-sm">{i.original_text}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="lg" className="flex-1 sm:flex-none" onClick={() => respond(i.assignee!.assignment_id, true)}><Check className="size-4" aria-hidden />Accept</Button>
                <Button size="lg" variant="outline" className="flex-1 sm:flex-none" onClick={() => respond(i.assignee!.assignment_id, false)}><X className="size-4" aria-hidden />Decline</Button>
                <Link to={`/incidents/${i.id}`}><Button size="lg" variant="ghost">Details</Button></Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {rest.length > 0 && <h2 className="font-display text-lg font-semibold">Current and past</h2>}
      <div className="stagger space-y-3">
        {rest.map((i) => (
          <Link key={i.id} to={`/incidents/${i.id}`} className="rr-card block p-3.5 transition-colors hover:border-[var(--brand)]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display font-semibold capitalize">{label(i.category)}</span>
              <UrgencyBadge urgency={i.urgency} />
              <StatusBadge status={i.status} />
              {i.assignee && <Badge>{i.assignee.status}</Badge>}
            </div>
            <p className="mt-1 text-sm text-slate-700">{i.original_text}</p>
          </Link>
        ))}
      </div>
      {items !== null && items.length === 0 && (
        <EmptyState icon={<ClipboardList className="size-6" />} title="No assignments yet" hint="When a coordinator approves you for an incident it appears here." />
      )}
    </div>
  );
}
