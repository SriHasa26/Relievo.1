// EMERGENCY SOS for citizens. One tap:
//   1. the Critical incident is created at once (location from the device when available, otherwise the last known place) and
//      responders are alerted by the backend;
//   2. THEN recording and live transcription run; the citizen sees a clear "recording, we are alerting responders" screen;
//   3. when it ends (Stop, silence or 45 s) the clip and transcript are uploaded to the same incident and responders are told again.
// The SOS never waits for speech recognition, the microphone or the upload.
import { useCallback, useEffect, useRef, useState } from "react";
import { CircleCheck, Loader2, MapPin, Mic, ShieldCheck, Siren, Square, X } from "lucide-react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { MAX_RECORD_SECONDS, VOICE_LANGS, useVoiceInput, type VoiceLang } from "@/lib/useVoiceInput";
import type { Incident } from "@/lib/types";
import { cn } from "@/lib/utils";

type Phase = "idle" | "starting" | "active" | "uploading" | "done" | "cancelled" | "error";

const EMERGENCY_LINE = "If life is in immediate danger, call your local emergency number (112 in India).";

/** Device location with a short time limit; null when unavailable or denied (the server then falls back and marks it approximate). */
const getPosition = (ms: number) => new Promise<{ lat: number; lng: number } | null>((resolve) => {
  if (!navigator.geolocation) return resolve(null);
  const guard = setTimeout(() => resolve(null), ms + 500);
  navigator.geolocation.getCurrentPosition(
    (p) => { clearTimeout(guard); resolve({ lat: p.coords.latitude, lng: p.coords.longitude }); },
    () => { clearTimeout(guard); resolve(null); },
    { timeout: ms, maximumAge: 300_000, enableHighAccuracy: false },
  );
});

const toBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
  r.onerror = () => reject(new Error("Could not read the recording"));
  r.readAsDataURL(blob);
});

export function SosButton({ variant = "nav" }: { variant?: "nav" | "big" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" data-testid="sos-button" onClick={() => setOpen(true)}
        className={cn("sos-btn inline-flex items-center justify-center gap-2 font-extrabold uppercase tracking-wide",
          variant === "big" ? "h-16 w-full rounded-2xl px-6 text-xl sm:w-auto" : "h-10 rounded-lg px-3 text-xs sm:text-sm")}>
        <Siren className={variant === "big" ? "size-6" : "size-4"} aria-hidden />Emergency SOS
      </button>
      {/* a portal: the nav button lives inside the blurred header, which would otherwise trap this fixed full-screen layer */}
      {open && createPortal(<SosFlow onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function SosFlow({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [incident, setIncident] = useState<Incident | null>(null);
  const [existing, setExisting] = useState(false);
  const [approximate, setApproximate] = useState(false);
  const [message, setMessage] = useState("");
  const uploaded = useRef(false);
  const creating = useRef<Promise<{ incident: Incident; existing: boolean }> | null>(null); // one request even if React re-runs the effect
  const voice = useVoiceInput({ recordAudio: true });

  const upload = useCallback(async (id: string) => {
    if (uploaded.current || !voice.audio) return;
    uploaded.current = true;
    setPhase("uploading");
    try {
      await api(`/api/incidents/${id}/sos-audio`, {
        body: { audio_base64: await toBase64(voice.audio.blob), mime: voice.audio.mime, duration_s: voice.audio.seconds, transcript: voice.transcript || voice.interim },
      });
      setPhase("done");
    } catch (e) {
      uploaded.current = false;
      setMessage((e as Error).message);
      setPhase("error");
    }
  }, [voice.audio, voice.transcript, voice.interim]);

  // the tap: create the SOS first, start listening in the same moment (keeps the browser's user-gesture permission)
  useEffect(() => {
    creating.current ??= (async () => {
      const pos = await getPosition(2500);
      return api<{ incident: Incident; existing: boolean }>("/api/sos", { body: pos ?? {} });
    })();
    void voice.start(); // recording + live transcript run alongside; they never delay the alert
    creating.current.then(({ incident: inc, existing: was }) => {
      setIncident(inc); setExisting(was); setApproximate(inc.sos_approximate === true); setPhase("active");
    }).catch((e: Error) => { setMessage(e.message); setPhase("error"); voice.stop(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // when listening has ended and a clip exists, send it to the same incident
  useEffect(() => {
    if (incident && !voice.listening && voice.audio && !uploaded.current && (phase === "active" || phase === "uploading" || phase === "done")) void upload(incident.id);
  }, [incident, voice.listening, voice.audio, phase, upload]);

  // listening ended with nothing recorded (denied microphone, unsupported, silence): the alert already went out
  useEffect(() => {
    if (phase === "active" && incident && !voice.listening && !voice.audio && voice.seconds > 0) setPhase("done");
    if (phase === "active" && incident && !voice.listening && !voice.audio && voice.error) setPhase("done");
  }, [phase, incident, voice.listening, voice.audio, voice.seconds, voice.error]);

  const cancel = async () => {
    voice.stop();
    if (!incident) return onClose();
    try { await api(`/api/incidents/${incident.id}/sos-cancel`, { body: {} }); setPhase("cancelled"); }
    catch (e) { setMessage((e as Error).message); setPhase("error"); }
  };

  const recording = voice.listening;
  return (
    <div className="fixed inset-0 z-[3500] grid place-items-center overflow-y-auto p-4" style={{ background: "rgb(20 0 0 / 0.78)" }}>
      <div role="dialog" aria-modal="true" aria-labelledby="sos-title" data-testid="sos-screen"
        className="w-full max-w-lg rounded-3xl border-2 p-5 sm:p-7" style={{ background: "var(--surface)", borderColor: "#ef4444", boxShadow: "0 0 0 6px rgb(239 68 68 / 0.25)" }}>
        <div className="flex items-center gap-2">
          <span className="alert-tag">EMERGENCY SOS</span>
          <button type="button" onClick={onClose} aria-label="Close SOS screen" className="rr-btn ml-auto grid size-9 place-items-center rounded-full border"><X className="size-4" aria-hidden /></button>
        </div>

        {phase === "starting" && (
          <div className="mt-5 flex items-center gap-3" role="status"><Loader2 className="size-6 animate-spin" aria-hidden /><p id="sos-title" className="text-lg font-bold">Alerting responders…</p></div>
        )}

        {(phase === "active" || phase === "uploading") && (
          <div className="mt-4 space-y-4">
            <h2 id="sos-title" className="text-2xl font-extrabold">{recording ? "Recording. We are alerting responders." : "We are alerting responders."}</h2>
            <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--pill-green-fg)" }}>
              <CircleCheck className="size-4" aria-hidden />{existing ? "You already have an active SOS. Responders have it." : "Your SOS was sent. Coordinators and verified volunteers have been alerted."}
            </p>
            {approximate && <p className="flex items-start gap-2 text-sm"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />We could not get your exact location, so responders see an approximate place. Tell them where you are in your message.</p>}

            <div className="rounded-2xl p-4" style={{ background: "var(--surface-2)" }}>
              {recording ? (
                <p className="flex items-center gap-2 font-bold" role="status"><i className="led led-glow led-pulse tone-red" aria-hidden />Recording… {voice.seconds}s / {MAX_RECORD_SECONDS}s</p>
              ) : phase === "uploading" ? (
                <p className="flex items-center gap-2 font-bold" role="status"><Loader2 className="size-4 animate-spin" aria-hidden />Sending your recording…</p>
              ) : (
                <p className="text-sm muted">{voice.error ? voice.error.message : "Not recording."}</p>
              )}
              <p className="mt-2 min-h-[2.5rem] text-sm" aria-live="polite" data-testid="sos-transcript">
                {voice.transcript}{voice.interim ? <span className="muted"> {voice.interim}</span> : null}
                {!voice.transcript && !voice.interim && recording ? <span className="muted">Speak now. What you say appears here.</span> : null}
              </p>
              {voice.error && recording && <p className="mt-1 text-xs text-red-700">{voice.error.message}</p>}
              <label className="mt-2 flex items-center gap-2 text-xs muted">Language
                <select aria-label="SOS voice language" value={voice.lang} disabled={recording} onChange={(e) => voice.setLang(e.target.value as VoiceLang)} className="rounded border px-1.5 py-1">
                  {VOICE_LANGS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                </select>
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              {recording && <Button size="lg" onClick={voice.stop} className="h-12"><Square className="size-4" aria-hidden />Stop recording</Button>}
              <Button size="lg" variant="outline" className="h-12" onClick={() => void cancel()}><ShieldCheck className="size-4" aria-hidden />I am safe / cancel SOS</Button>
            </div>
          </div>
        )}

        {phase === "done" && (
          <div className="mt-4 space-y-3">
            <h2 id="sos-title" className="text-2xl font-extrabold">Responders have your message.</h2>
            {existing && <p className="text-sm font-semibold">You already have an active SOS. Responders have it.</p>}
            <p className="text-sm">{voice.audio ? "Your recording and what you said were sent to coordinators and verified volunteers." : "Responders were alerted. The recording could not be sent" + (voice.error ? `: ${voice.error.message}` : ".")}</p>
            <div className="flex flex-wrap gap-2">
              {incident && <Link to={`/incidents/${incident.id}`} onClick={onClose}><Button size="lg">Follow my SOS</Button></Link>}
              {incident && <Button size="lg" variant="outline" onClick={() => void cancel()}><ShieldCheck className="size-4" aria-hidden />I am safe / cancel SOS</Button>}
              <Button size="lg" variant="outline" onClick={onClose}>Close</Button>
            </div>
          </div>
        )}

        {phase === "cancelled" && (
          <div className="mt-4 space-y-3">
            <h2 id="sos-title" className="text-2xl font-extrabold">Marked safe.</h2>
            <p className="text-sm">Responders were told you are safe and the SOS has ended.</p>
            <Button size="lg" onClick={onClose}>Close</Button>
          </div>
        )}

        {phase === "error" && (
          <div className="mt-4 space-y-3">
            <h2 id="sos-title" className="text-2xl font-extrabold">Something went wrong.</h2>
            <p role="alert" className="text-sm text-red-700">{message || "The SOS could not be sent."}</p>
            <p className="text-sm font-semibold">Please call your local emergency number now.</p>
            <Button size="lg" onClick={onClose}>Close</Button>
          </div>
        )}

        <p className="mt-5 flex items-start gap-2 rounded-xl p-3 text-sm font-semibold" style={{ background: "var(--pill-amber-bg)", color: "var(--pill-amber-fg)" }}>
          <Mic className="mt-0.5 size-4 shrink-0" aria-hidden />{EMERGENCY_LINE}
        </p>
      </div>
    </div>
  );
}
