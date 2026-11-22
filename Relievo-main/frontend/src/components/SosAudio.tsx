// Audio player for a recorded SOS clip. The clip is private: it is fetched through the API with the session token
// (only authorised roles are served it), turned into a local object URL, and NEVER autoplays.
import { useEffect, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { apiBlob } from "@/lib/api";

export function SosAudioPlayer({ incidentId }: { incidentId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const load = async () => {
    setBusy(true); setError("");
    try { setUrl(URL.createObjectURL(await apiBlob(`/api/incidents/${incidentId}/sos-audio`))); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  if (url) return <audio controls preload="metadata" src={url} aria-label="SOS audio" className="w-full" />;
  return (
    <div className="space-y-1">
      <button type="button" onClick={() => void load()} disabled={busy}
        className="rr-btn btn-brand inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-semibold">
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
        {busy ? "Loading audio…" : "Play SOS audio"}
      </button>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
