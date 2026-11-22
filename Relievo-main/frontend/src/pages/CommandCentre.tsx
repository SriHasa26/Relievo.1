import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Inbox, Radio } from "lucide-react";
import { IncidentRow } from "@/components/IncidentRow";
import { IncidentMap } from "@/components/MapView";
import { AlertBanner, EmptyState, GlassCard, Skeleton } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { IncidentListItem } from "@/lib/types";
import { label } from "@/lib/utils";

const POLL_MS = 10_000;
type Filter = "review" | "open" | "all";
const fingerprint = (i: IncidentListItem) => `${i.status}|${i.urgency}|${i.assignee?.status ?? ""}`;

export default function CommandCentre() {
  const navigate = useNavigate();
  const [items, setItems] = useState<IncidentListItem[] | null>(null);
  const [filter, setFilter] = useState<Filter>("review");
  const [prio, setPrio] = useState<"all" | "critical" | "high" | "medium" | "low">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const seen = useRef<Map<string, string> | null>(null); // id -> fingerprint from the previous load

  const load = useCallback(() => {
    api<IncidentListItem[]>("/api/incidents").then((next) => {
      const prev = seen.current;
      if (prev) { // not the first load: flag what is new or changed so it animates in
        const f = new Set(next.filter((i) => !prev.has(i.id)).map((i) => i.id));
        const c = new Set(next.filter((i) => prev.has(i.id) && prev.get(i.id) !== fingerprint(i)).map((i) => i.id));
        if (f.size || c.size) {
          setFresh(f); setChanged(c);
          setTimeout(() => { setFresh(new Set()); setChanged(new Set()); }, 4000);
        }
      }
      seen.current = new Map(next.map((i) => [i.id, fingerprint(i)]));
      setItems(next);
    }).catch(() => undefined);
  }, []);

  // Light live feel: poll every 10 s, only while the tab is visible; refresh at once when it becomes visible again.
  useEffect(() => {
    load();
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => { stop(); timer = setInterval(load, POLL_MS); };
    const stop = () => { if (timer) clearInterval(timer); timer = undefined; };
    const onVis = () => { if (document.visibilityState === "visible") { load(); start(); } else stop(); };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  const list = items ?? [];
  const visible = list
    .filter((i) =>
      filter === "all" ? true
        : filter === "review" ? i.status === "submitted"
          : ["submitted", "verified", "assigned", "in_progress"].includes(i.status))
    .filter((i) => prio === "all" || i.priority.level === prio)
    // priority score first (SOS and Critical are pinned at the top), then whoever has waited longer
    .sort((a, b) => b.priority.score - a.priority.score || a.created_at.localeCompare(b.created_at));

  const tabs: Array<[Filter, string]> = [["review", "Needs review"], ["open", "All open"], ["all", "Everything"]];
  const needsReview = list.filter((i) => i.status === "submitted").length;

  // Emergency state: critical incidents that still wait for a human (not yet assigned).
  const critical = list.filter((i) => i.priority.level === "critical" && (i.status === "submitted" || i.status === "verified") && !dismissed.has(i.id));
  const top = critical[0];

  return (
    <div className="space-y-4">
      {top && (
        <AlertBanner
          title={`${label(top.category)} emergency${top.address_text ? ` · ${top.address_text}` : ""}`}
          detail={top.original_text} more={critical.length - 1}
          onOpen={() => navigate(`/incidents/${top.id}`)}
          onDismiss={() => setDismissed((d) => new Set([...d, ...critical.map((c) => c.id)]))} />
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <h1 className="flex items-center gap-2 text-2xl font-bold"><Radio className="size-6 text-brand" aria-hidden />Command centre</h1>
          <div className="flex flex-wrap gap-2">
            {tabs.map(([f, text]) => (
              <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
                {text}{f === "review" && ` (${needsReview})`}
              </Button>
            ))}
            <select aria-label="Filter by priority" value={prio} onChange={(e) => setPrio(e.target.value as typeof prio)} className="h-8 rounded-md border px-2 text-sm">
              <option value="all">All priorities</option><option value="critical">Critical</option><option value="high">High</option>
              <option value="medium">Medium</option><option value="low">Low</option>
            </select>
          </div>
          <div className="stagger space-y-3">
            {items === null && [0, 1, 2].map((n) => <Skeleton key={n} className="h-24 rounded-2xl" />)}
            {items !== null && visible.length === 0 && <EmptyState icon={<Inbox className="size-6" />} title="Nothing in this view" hint="New citizen requests appear here, most urgent first." />}
            {visible.map((i) => (
              <IncidentRow key={i.id} incident={i} tilt selected={selected === i.id}
                fresh={fresh.has(i.id)} changed={changed.has(i.id)} shake={fresh.has(i.id) && i.priority.level === "critical"}
                onSelect={() => setSelected(i.id)} />
            ))}
          </div>
        </section>
        <section className="lg:sticky lg:top-24 lg:self-start">
          <div className="float-map relative">
            <IncidentMap incidents={list} selectedId={selected} onSelect={(id) => navigate(`/incidents/${id}`)} height={520} />
            <GlassCard className="map-overlay">
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="flex items-center gap-1"><i className="led tone-red led-glow led-pulse" aria-hidden />critical</span>
                <span className="flex items-center gap-1"><i className="led tone-amber" aria-hidden />high</span>
                <span className="flex items-center gap-1"><i className="led tone-teal" aria-hidden />medium</span>
                <span className="flex items-center gap-1"><i className="led tone-gray" aria-hidden />low</span>
                <span className="flex items-center gap-1"><i aria-hidden className="inline-block size-3 rounded-full border border-dashed" style={{ borderColor: "var(--led-ember)" }} />cluster</span>
              </span>
            </GlassCard>
          </div>
          <p className="mt-2 text-xs text-slate-500">Hover or focus a request to fly to it. Click a dot to open the incident. Dashed rings show clusters of open incidents.</p>
        </section>
      </div>
    </div>
  );
}
