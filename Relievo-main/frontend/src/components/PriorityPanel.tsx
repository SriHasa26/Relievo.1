// "Why this priority" + the coordinator's override. The AI's urgency is only one input (see docs/PRIORITY.md).
import { useState } from "react";
import { UrgencyBadge } from "@/components/badges";
import { useToast } from "@/components/kit";
import { api } from "@/lib/api";
import type { IncidentDetailData, Urgency } from "@/lib/types";

const LEVELS: Array<Urgency | "auto"> = ["auto", "low", "medium", "high", "critical"];

export function PriorityPanel({ data, canOverride, onChange }: { data: IncidentDetailData; canOverride: boolean; onChange: () => void }) {
  const { priority, incident } = data;
  const toast = useToast();
  const [error, setError] = useState("");
  const locked = incident.is_sos === true && incident.sos_status === "active";
  const set = async (value: string) => {
    setError("");
    try {
      await api(`/api/incidents/${incident.id}/priority`, { body: { level: value } });
      toast(value === "auto" ? "Priority is automatic again" : `Priority set to ${value}`);
      onChange();
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <details className="rr-card p-3 text-sm">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 font-semibold">
        Priority <UrgencyBadge urgency={priority.level} />
        {priority.overridden && <span className="pill tone-ember">set by coordinator</span>}
        {priority.escalated && <span className="pill tone-amber">escalated by waiting time</span>}
      </summary>
      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs muted">{priority.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      {canOverride && (
        <label className="mt-2 flex items-center gap-2 text-xs">Override level
          <select aria-label="Priority override" disabled={locked} value={incident.priority_override ?? "auto"} className="rounded border px-1.5 py-1"
            onChange={(e) => void set(e.target.value)}>
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          {locked && <span className="muted">An SOS is always Critical.</span>}
        </label>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
    </details>
  );
}
