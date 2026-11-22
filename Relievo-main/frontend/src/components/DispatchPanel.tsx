// Coordinator dispatch: ranked volunteers with the full score breakdown, approve / reassign / resolve.
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NeuMeter, useToast } from "@/components/kit";
import { api } from "@/lib/api";
import type { Assignment, IncidentDetailData, MatchResult, ScoreBreakdown } from "@/lib/types";

const WEIGHTS = { D: 0.35, K: 0.3, A: 0.2, C: 0.15 } as const;
const PARTS: Array<[keyof typeof WEIGHTS, string]> = [
  ["D", "Distance"], ["K", "Skills"], ["A", "Availability"], ["C", "Capacity"],
];

function Breakdown({ b }: { b: ScoreBreakdown }) {
  return (
    <div className="grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4">
      {PARTS.map(([k, name]) => (
        <div key={k} className="space-y-1 rounded-lg bg-slate-50 p-2">
          <div className="text-slate-500">{name} ({k})</div>
          <div className="font-semibold">{b[k]}</div>
          <NeuMeter value={b[k]} label={`${name} score`} />
          <div className="text-slate-500">×{WEIGHTS[k]} = {(b[k] * WEIGHTS[k]).toFixed(1)}</div>
        </div>
      ))}
    </div>
  );
}

function MatchList({ matches, onPick, verb }: { matches: MatchResult[]; onPick: (id: string) => void; verb: string }) {
  const eligible = matches.filter((m) => m.eligible);
  const excluded = matches.filter((m) => !m.eligible);
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Score S = 0.35·D + 0.30·K + 0.20·A + 0.15·C, each 0-100. Busy, unverified, at-capacity or unqualified volunteers are excluded.
      </p>
      {eligible.length === 0 && <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">No eligible volunteer right now. See why below.</p>}
      {eligible.map((m, idx) => (
        <div key={m.volunteer_id} className="space-y-2 rounded border border-slate-200 p-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={idx === 0 ? "green" : "gray"}>#{idx + 1}</Badge>
            <span className="font-medium">{m.name}</span>
            <span className="text-sm font-semibold">S = {m.breakdown!.total}</span>
            <Button variant="physical" size="sm" className="ml-auto h-9 px-4" onClick={() => onPick(m.volunteer_id)}>{verb}</Button>
          </div>
          <p className="text-sm text-slate-700">{m.reason}</p>
          <Breakdown b={m.breakdown!} />
        </div>
      ))}
      {excluded.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-xs font-semibold uppercase text-slate-500">Not eligible</h4>
          {excluded.map((m) => (
            <p key={m.volunteer_id} className="rounded bg-slate-50 p-2 text-sm text-slate-500">
              <span className="font-medium">{m.name}</span>: {m.excluded_reason}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function DispatchPanel({ data, onChange }: { data: IncidentDetailData; onChange: () => void }) {
  const { incident } = data;
  const active: Assignment | undefined = data.assignments.find((a) => a.status === "approved" || a.status === "accepted");
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [showReassign, setShowReassign] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  const wantMatches = incident.status === "verified" || showReassign;

  const loadMatches = useCallback(() => {
    api<MatchResult[]>(`/api/incidents/${incident.id}/matches`).then(setMatches).catch((e) => setError((e as Error).message));
  }, [incident.id]);
  useEffect(() => { if (wantMatches) loadMatches(); }, [wantMatches, loadMatches]);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setError("");
    try { await fn(); setShowReassign(false); toast(done); onChange(); } catch (e) { setError((e as Error).message); loadMatches(); }
  };

  if (!["verified", "assigned", "in_progress"].includes(incident.status)) return null;

  return (
    <Card>
      <CardHeader><CardTitle>Responder dispatch</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

        {incident.status === "verified" && (
          <MatchList matches={matches} verb="Approve assignment"
            onPick={(volunteerId) => run(() => api(`/api/incidents/${incident.id}/assign`, { body: { volunteerId } }), "Assignment approved")} />
        )}

        {active && (
          <div className="space-y-2">
            <p>
              <b>{active.volunteer_name}</b>{" "}
              <Badge tone={active.status === "accepted" ? "green" : "amber"}>
                {active.status === "accepted" ? "accepted" : "waiting for volunteer to accept"}
              </Badge>
            </p>
            {active.score_breakdown && <Breakdown b={active.score_breakdown} />}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowReassign((v) => !v)}>
                {showReassign ? "Cancel reassign" : "Reassign"}
              </Button>
              {incident.status === "in_progress" && (
                <Button size="sm" onClick={() => run(() => api(`/api/incidents/${incident.id}/status`, { body: { status: "resolved" } }), "Incident closed")}>
                  Mark resolved
                </Button>
              )}
            </div>
            {showReassign && (
              <MatchList matches={matches} verb="Reassign to this volunteer"
                onPick={(volunteerId) => run(() => api(`/api/assignments/${active.id}/reassign`, { body: { volunteerId } }), "Volunteer changed")} />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
