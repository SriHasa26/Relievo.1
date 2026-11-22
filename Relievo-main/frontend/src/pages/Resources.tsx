// Minimal ResourceBridge: see relief stock; a coordinator allocates some of it to one open incident.
import { useCallback, useEffect, useState } from "react";
import { Boxes, Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, useToast } from "@/components/kit";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { IncidentListItem } from "@/lib/types";
import { label } from "@/lib/utils";

interface ResourceRow {
  id: string; name: string; resource_type: string; quantity: number; unit: string;
  organisation: string; distance_km: number | null; relevant: boolean | null;
}

export default function Resources() {
  const { user } = useAuth();
  const isCoordinator = user?.role === "coordinator";
  const [incidents, setIncidents] = useState<IncidentListItem[]>([]);
  const [incidentId, setIncidentId] = useState("");
  const [rows, setRows] = useState<ResourceRow[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const toast = useToast();

  const loadRows = useCallback(() => {
    const q = incidentId ? `?incident_id=${incidentId}` : "";
    api<ResourceRow[]>(`/api/resources${q}`).then(setRows).catch(() => setRows([]));
  }, [incidentId]);
  useEffect(loadRows, [loadRows]);

  useEffect(() => {
    if (!isCoordinator) return;
    api<IncidentListItem[]>("/api/incidents").then((all) =>
      setIncidents(all.filter((i) => ["verified", "assigned", "in_progress"].includes(i.status))));
  }, [isCoordinator]);

  const allocate = async (r: ResourceRow) => {
    setMessage("");
    try {
      await api(`/api/resources/${r.id}/allocate`, { body: { incident_id: incidentId, quantity: Number(qty[r.id] ?? 0) } });
      setMessage(`Allocated ${qty[r.id]} ${r.unit} of ${r.name}.`);
      toast("Resources reserved for the incident");
      setQty((q) => ({ ...q, [r.id]: "" }));
      loadRows();
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2 text-2xl font-bold"><Boxes className="size-6 text-brand" aria-hidden />Relief resources</h1>
      <p className="text-xs text-amber-800">Synthetic demo stock from a synthetic NGO.</p>

      {isCoordinator && (
        <label className="block text-sm">
          Allocate to incident
          <select value={incidentId} onChange={(e) => setIncidentId(e.target.value)}
            className="mt-1 block w-full max-w-xl rounded border border-slate-300 p-2">
            <option value="">Choose an open incident…</option>
            {incidents.map((i) => (
              <option key={i.id} value={i.id}>
                {label(i.category)} · {i.urgency} · {i.address_text || i.id.slice(0, 8)} ({label(i.status)})
              </option>
            ))}
          </select>
        </label>
      )}
      {message && <p role="status" className="text-sm text-brand">{message}</p>}

      <div className="stagger grid gap-3 md:grid-cols-2">
        {rows.length === 0 && <div className="md:col-span-2"><EmptyState icon={<Package className="size-6" />} title="No resources listed" /></div>}
        {rows.map((r) => (
          <Card key={r.id} className={r.relevant ? "border-green-500 border-2" : ""}>
            <CardHeader>
              <CardTitle>
                {r.name} {r.relevant && <Badge tone="green">fits this incident</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>{r.quantity} {r.unit} available · {label(r.resource_type)} · {r.organisation}</p>
              {r.distance_km !== null && <p className="text-slate-500">{r.distance_km} km from the incident</p>}
              {isCoordinator && (
                <div className="flex gap-2">
                  <input type="number" min={1} max={r.quantity} placeholder="Quantity" value={qty[r.id] ?? ""}
                    onChange={(e) => setQty((q) => ({ ...q, [r.id]: e.target.value }))}
                    className="w-28 rounded border border-slate-300 p-1.5" aria-label={`Quantity of ${r.name}`} />
                  <Button size="sm" disabled={!incidentId || !qty[r.id]} onClick={() => allocate(r)}>Allocate</Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
