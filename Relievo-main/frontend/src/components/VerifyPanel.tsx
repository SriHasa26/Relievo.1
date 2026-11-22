// Coordinator review: the citizen's original text on the left, the AI suggestion on the right (editable).
import { useState } from "react";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UrgencyGauge, useToast } from "@/components/kit";
import { api } from "@/lib/api";
import type { Category, IncidentDetailData, Urgency } from "@/lib/types";

const CATEGORIES: Category[] = ["medical", "food", "water", "shelter", "rescue", "other"];
const URGENCIES: Urgency[] = ["low", "medium", "high", "critical"];

const AI_LABEL = { openrouter: "AI via OpenRouter", gemini: "AI via Gemini", fallback: "Fallback", mock: "Mock AI" } as const;

export function ReportVsAi({ data }: { data: IncidentDetailData }) {
  const { incident, analysis } = data;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Original report (as written)</CardTitle></CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap">{incident.original_text}</p>
          <p className="mt-3 text-xs text-slate-500">
            {data.reporter && `Reported by ${data.reporter.name} · `}{incident.address_text || "pin on map"}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            AI suggestion <Badge tone="amber">needs human verification</Badge>
            {analysis && <Badge tone="teal">{AI_LABEL[analysis.source]}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {analysis ? (
            <>
              <p className="field-pop shimmer-in" style={{ "--d": "100ms" } as React.CSSProperties}><b>Category:</b> {analysis.extracted_data.category}</p>
              <div className="field-pop shimmer-in flex items-center gap-3" style={{ "--d": "300ms" } as React.CSSProperties}><p><b>Urgency:</b> {analysis.extracted_data.urgency}</p><UrgencyGauge urgency={analysis.extracted_data.urgency} size={56} /></div>
              <p className="field-pop shimmer-in" style={{ "--d": "500ms" } as React.CSSProperties}><b>People:</b> {analysis.extracted_data.people_affected ?? "unknown"}</p>
              <p className="field-pop shimmer-in" style={{ "--d": "700ms" } as React.CSSProperties}><b>Needs:</b> {analysis.extracted_data.needs.join(", ") || "none detected"}</p>
              <p className="field-pop shimmer-in" style={{ "--d": "900ms" } as React.CSSProperties}><b>Vulnerable:</b> {analysis.extracted_data.vulnerable_persons.join(", ") || "none detected"}</p>
              {analysis.extracted_data.missing_info.length > 0 && (
                <p className="text-amber-800"><b>Missing:</b> {analysis.extracted_data.missing_info.join("; ")}</p>
              )}
              <p className="pt-2 text-xs text-slate-500">
                Model: {analysis.model_version} · confidence {Math.round(analysis.confidence * 100)}%.
                AI is decision support only.
              </p>
            </>
          ) : <p>No analysis stored.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

export function VerifyPanel({ data, onDone }: { data: IncidentDetailData; onDone: () => void }) {
  const { incident } = data;
  const [category, setCategory] = useState<Category>(incident.category);
  const [urgency, setUrgency] = useState<Urgency>(incident.urgency);
  const [people, setPeople] = useState(incident.people_affected?.toString() ?? "");
  const [needs, setNeeds] = useState(incident.needs.join(", "));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const toast = useToast();

  const send = async (decision: "verify" | "reject") => {
    setBusy(true);
    setError("");
    try {
      await api(`/api/incidents/${incident.id}/verify`, {
        body: {
          decision, reason,
          edits: {
            category, urgency,
            people_affected: people === "" ? null : Number(people),
            needs: needs.split(",").map((s) => s.trim()).filter(Boolean),
          },
        },
      });
      toast(decision === "verify" ? "Incident approved for dispatch" : "Incident rejected");
      if (decision === "verify") { setConfirmed(true); setTimeout(onDone, 900); } else onDone(); // let the confirmed state show briefly
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const field = "mt-1 block rounded border border-slate-300 p-2 text-sm";
  return (
    <Card>
      <CardHeader><CardTitle>Verify this incident</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-600">Edit anything the AI got wrong, then verify or reject. Nothing is dispatched until you do.</p>
        <div className="flex flex-wrap gap-4">
          <label className="text-sm">Category
            <select className={field} value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="text-sm">Urgency
            <select className={field} value={urgency} onChange={(e) => setUrgency(e.target.value as Urgency)}>
              {URGENCIES.map((u) => <option key={u}>{u}</option>)}
            </select>
          </label>
          <label className="text-sm">People affected
            <input className={`${field} w-28`} type="number" min={0} value={people} onChange={(e) => setPeople(e.target.value)} />
          </label>
          <label className="min-w-48 flex-1 text-sm">Needs (comma separated)
            <input className={`${field} w-full`} value={needs} onChange={(e) => setNeeds(e.target.value)} />
          </label>
        </div>
        <label className="block text-sm">Reject reason (required only to reject)
          <input className={`${field} w-full`} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex gap-2">
          <Button variant="physical" size="lg" disabled={busy || confirmed} className={confirmed ? "btn-confirmed" : ""} onClick={() => send("verify")}>{confirmed ? <><Check className="size-4" aria-hidden />Verified</> : "Verify incident"}</Button>
          <Button size="lg" disabled={busy} variant="destructive" onClick={() => send("reject")}>Reject</Button>
        </div>
      </CardContent>
    </Card>
  );
}
