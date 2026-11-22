// Dispatch board: unassigned (verified) incidents in priority order, each with the best available volunteer recommended by the
// explainable matching score. The highest priority picks first, so no volunteer is suggested twice. A coordinator approves every
// suggestion (one by one or all at once) and can override who goes.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CircleCheck, ClipboardCheck, Route, UserX } from "lucide-react";
import { UrgencyBadge } from "@/components/badges";
import { EmptyState, SkeletonList, UrgencyGauge, useToast } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { Incident, MatchResult, Priority } from "@/lib/types";
import { label } from "@/lib/utils";

interface Item { incident: Incident; priority: Priority; suggestion: MatchResult | null; options: MatchResult[] }
interface Board { items: Item[]; awaiting_review: number }
interface Result { incident_id: string; volunteer_id: string; ok: boolean; error?: string }

export default function DispatchBoard() {
  const toast = useToast();
  const [board, setBoard] = useState<Board | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({}); // incident id -> volunteer id picked by hand
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => api<Board>("/api/dispatch/board").then(setBoard).catch((e: Error) => setError(e.message)), []);
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 10_000);
    return () => clearInterval(t);
  }, [load]);

  const current = (it: Item): MatchResult | null =>
    choice[it.incident.id] ? it.options.find((o) => o.volunteer_id === choice[it.incident.id]) ?? it.suggestion : it.suggestion;
  const pairs = (board?.items ?? []).flatMap((it) => { const m = current(it); return m ? [{ incident_id: it.incident.id, volunteer_id: m.volunteer_id, name: m.name, incident: it }] : []; });
  // a manual choice can pick someone suggested elsewhere; those pairs must stay unique
  const duplicates = new Set(pairs.map((p) => p.volunteer_id).filter((v, i, a) => a.indexOf(v) !== i));

  const approveOne = async (it: Item) => {
    const m = current(it);
    if (!m) return;
    setBusy(true); setError("");
    try {
      await api(`/api/incidents/${it.incident.id}/assign`, { body: { volunteerId: m.volunteer_id } });
      toast(`Assignment approved: ${m.name}`);
      await load();
    } catch (e) { setError((e as Error).message); await load(); }
    finally { setBusy(false); }
  };

  const approveAll = async () => {
    setBusy(true); setError("");
    try {
      const results = await api<Result[]>("/api/dispatch/approve-all", { body: { pairs: pairs.map(({ incident_id, volunteer_id }) => ({ incident_id, volunteer_id })) } });
      const ok = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      toast(`${ok} assignment${ok === 1 ? "" : "s"} approved`, failed.length ? "error" : "success");
      if (failed.length) setError(`${failed.length} could not be approved: ${failed.map((f) => f.error).join("; ")}`);
      setConfirm(false);
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Route className="size-6 text-brand" aria-hidden />Dispatch board</h1>
        <Button size="lg" variant="physical" className="ml-auto" disabled={busy || pairs.length === 0 || duplicates.size > 0} onClick={() => setConfirm(true)}>
          <ClipboardCheck className="size-4" aria-hidden />Approve all suggested ({pairs.length})
        </Button>
      </div>
      <p className="text-sm muted">
        Most urgent first. The highest priority picks first, so no volunteer is suggested twice. Nothing is assigned until you approve it.
        {board && board.awaiting_review > 0 && <> <Link className="underline" to="/coordinator">{board.awaiting_review} report(s) still need verification</Link> before they can be dispatched.</>}
      </p>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{error}</p>}
      {duplicates.size > 0 && <p role="alert" className="text-sm text-red-700">The same volunteer is chosen for two incidents. Pick a different one to approve all at once.</p>}
      {board === null && <SkeletonList rows={3} />}
      {board && board.items.length === 0 && <EmptyState icon={<CircleCheck className="size-6" />} title="Every verified incident has a volunteer" hint="New verified incidents appear here in priority order." />}

      <div className="stagger space-y-3">
        {board?.items.map((it, idx) => {
          const m = current(it);
          return (
            <section key={it.incident.id} aria-label={`${label(it.incident.category)} incident ${idx + 1}`}
              className={`rr-card space-y-2 p-4 ${it.priority.level === "critical" ? "card-critical" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="grid size-7 place-items-center rounded-full text-xs font-bold" style={{ background: "var(--brand-solid)", color: "var(--brand-ink)" }}>{idx + 1}</span>
                {it.priority.is_sos && <span className="alert-tag">SOS</span>}
                <span className="font-display text-lg font-semibold capitalize">{label(it.incident.category)}</span>
                <UrgencyBadge urgency={it.priority.level} />
                <span className="text-xs muted">waiting {it.priority.waiting_minutes} min{it.priority.escalated ? " (escalated)" : ""}</span>
                <span className="ml-auto"><UrgencyGauge urgency={it.priority.level} size={48} /></span>
              </div>
              <p className="line-clamp-2 text-sm">{it.incident.original_text}</p>
              <p className="text-xs muted">{it.incident.address_text || "Location on map"}{it.incident.people_affected !== null && ` · ${it.incident.people_affected} people`} · why: {it.priority.reasons.join("; ")}</p>

              {m ? (
                <div className="flex flex-wrap items-center gap-3 rounded-xl p-3" style={{ background: "var(--surface-2)" }}>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">Suggested: {m.name} <span className="text-sm">S = {m.breakdown!.total}</span></p>
                    <p className="text-xs muted">{m.reason}</p>
                    {it.options.length > 1 && (
                      <label className="mt-1 flex items-center gap-2 text-xs">Choose another
                        <select aria-label={`Volunteer for incident ${idx + 1}`} value={m.volunteer_id} className="rounded border px-1.5 py-1"
                          onChange={(e) => setChoice((c) => ({ ...c, [it.incident.id]: e.target.value }))}>
                          {it.options.map((o) => <option key={o.volunteer_id} value={o.volunteer_id}>{o.name} (S = {o.breakdown!.total})</option>)}
                        </select>
                      </label>
                    )}
                  </div>
                  <Button variant="physical" disabled={busy} onClick={() => void approveOne(it)}>Approve {m.name}</Button>
                </div>
              ) : (
                <p className="flex items-center gap-2 rounded-xl p-3 text-sm" style={{ background: "var(--pill-amber-bg)", color: "var(--pill-amber-fg)" }}>
                  <UserX className="size-4" aria-hidden />No eligible volunteer right now (busy, unverified, at capacity or unqualified). It stays on the board.
                </p>
              )}
              <div className="flex gap-2"><Link to={`/incidents/${it.incident.id}`}><Button size="sm" variant="outline">Open incident</Button></Link></div>
            </section>
          );
        })}
      </div>

      {confirm && (
        <div className="fixed inset-0 z-[2800] grid place-items-center p-4" style={{ background: "rgb(0 0 0 / 0.5)" }}>
          <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="glass w-full max-w-md rounded-2xl p-5">
            <h2 id="confirm-title" className="font-display text-xl font-bold">Approve {pairs.length} assignment{pairs.length === 1 ? "" : "s"}?</h2>
            <ul className="mt-3 space-y-1 text-sm">
              {pairs.map((p) => <li key={p.incident_id}><b>{p.name}</b> → {label(p.incident.incident.category)} · {p.incident.incident.address_text || "map"}</li>)}
            </ul>
            <p className="mt-3 text-xs muted">Each is checked again on the server. Volunteers are then asked to accept.</p>
            <div className="mt-4 flex gap-2">
              <Button size="lg" variant="physical" disabled={busy} onClick={() => void approveAll()}>Confirm and approve</Button>
              <Button size="lg" variant="outline" onClick={() => setConfirm(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
