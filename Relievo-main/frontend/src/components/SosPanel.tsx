// SOS block on the incident page: status, approximate-location note, audio player (never autoplays) and transcript.
// Only people allowed to see the audio (coordinators, verified volunteers, the citizen) receive `has_audio`.
import { useState } from "react";
import { MapPin, ShieldCheck, Siren } from "lucide-react";
import { SosAudioPlayer } from "@/components/SosAudio";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { IncidentDetailData } from "@/lib/types";

export function SosPanel({ data, isOwner, onChange }: { data: IncidentDetailData; isOwner: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sos = data.sos;
  if (!sos) return null;

  const safe = async () => {
    setBusy(true); setError("");
    try { await api(`/api/incidents/${data.incident.id}/sos-cancel`, { body: {} }); onChange(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <section aria-label="Emergency SOS" className="rr-card space-y-3 p-4" style={{ borderColor: "#ef4444", boxShadow: "0 0 0 1px #ef4444" }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="alert-tag"><Siren className="mr-1 inline size-3.5" aria-hidden />EMERGENCY SOS</span>
        <span className="pill tone-red">{sos.status === "active" ? "active" : "cancelled: marked safe"}</span>
      </div>
      {sos.approximate && (
        <p className="flex items-start gap-2 text-sm"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
          Approximate location: the device location was not available, so this is the citizen&apos;s last known place.</p>
      )}
      {sos.has_audio ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Recorded message{sos.duration_s ? ` (${Math.round(sos.duration_s)} s)` : ""}</p>
          <SosAudioPlayer incidentId={data.incident.id} />
          {sos.transcript && <blockquote className="rounded-lg border-l-4 px-3 py-2 text-sm" style={{ borderColor: "#ef4444", background: "var(--surface-2)" }}>&ldquo;{sos.transcript}&rdquo;</blockquote>}
        </div>
      ) : <p className="text-sm muted">No recording yet. It appears here as soon as it is sent.</p>}
      {isOwner && sos.status === "active" && (
        <Button variant="outline" disabled={busy} onClick={() => void safe()}><ShieldCheck className="size-4" aria-hidden />I am safe / cancel SOS</Button>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </section>
  );
}
