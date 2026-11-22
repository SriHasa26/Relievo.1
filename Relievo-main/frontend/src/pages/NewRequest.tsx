import { useState } from "react";
import { Check, CircleAlert, MapPin, Send } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { LocationPicker } from "@/components/MapView";
import { NeuToggle, SuccessCheck, useToast } from "@/components/kit";
import { VoiceButton } from "@/components/VoiceButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { useLargeText } from "@/lib/prefs";
import { PLACES } from "@/lib/places";

export default function NewRequest() {
  const navigate = useNavigate();
  const [large, setLarge] = useLargeText();
  const [text, setText] = useState("");
  const [people, setPeople] = useState("");
  const [place, setPlace] = useState("");
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const toast = useToast();

  // Stepwise feel: the stepper lights up as each part is filled in (all fields stay on one page).
  const steps: Array<[string, boolean]> = [
    ["Describe", text.trim().length > 0], ["People", people !== ""], ["Location", loc !== null], ["Review", text.trim().length > 0 && loc !== null],
  ];

  const pickPlace = (name: string) => {
    setPlace(name);
    const p = PLACES.find((x) => x.name === name);
    if (p) setLoc({ lat: p.lat, lng: p.lng });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loc) return setError("Please choose a location on the map or from the list.");
    setBusy(true);
    setError("");
    try {
      const incident = await api<{ id: string }>("/api/incidents", {
        body: { text, people_affected: people, lat: loc.lat, lng: loc.lng, address_text: place },
      });
      setSent(true);
      toast("Your request was sent");
      setTimeout(() => navigate(`/incidents/${incident.id}`), 900);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="relative mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">Request emergency help</h1>
      <p className="text-sm text-slate-600">
        Describe what is happening. A coordinator will review your request. This is not a replacement for official
        emergency services: if life is in immediate danger, call your local emergency number.
      </p>
      <label className="flex items-center gap-3 text-sm font-medium">
        <NeuToggle checked={large} onChange={setLarge} label="Large text" />
        Large text
      </label>

      <ol aria-label="Progress" className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {steps.map(([name, done], i) => (
          <li key={name} className="flex items-center gap-2 text-xs font-semibold">
            <span className={`step-dot ${done ? "done" : ""}`}>{done ? <Check className="size-3.5" aria-hidden /> : i + 1}</span>
            <span className={done ? "" : "muted"}>{name}</span>
            {i < steps.length - 1 && <span aria-hidden className="h-px w-3 sm:w-8" style={{ background: "var(--border)" }} />}
          </li>
        ))}
      </ol>

      <Card>
        <CardHeader><CardTitle>What do you need?</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <label className="block">
            <span className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">Describe the emergency
              <VoiceButton getText={() => text} onText={setText} />
            </span>
            <textarea
              required rows={5} value={text} onChange={(e) => setText(e.target.value)}
              placeholder="e.g. Water is entering our ground floor. Six people, including an elderly person. We need drinking water."
              className="mt-1 w-full rounded-lg border border-slate-300 p-3 text-base" aria-invalid={Boolean(error) && !text.trim()}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Number of people affected</span>
            <input type="number" min={0} value={people} onChange={(e) => setPeople(e.target.value)}
              className="mt-1 w-32 rounded border border-slate-300 p-2" />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><MapPin className="size-4" aria-hidden />Where are you?</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <label className="block">
            <span className="text-sm font-medium">Pick a known place</span>
            <select value={place} onChange={(e) => pickPlace(e.target.value)} className="mt-1 block w-full rounded border border-slate-300 p-2">
              <option value="">Choose…</option>
              {PLACES.map((p) => <option key={p.name}>{p.name}</option>)}
            </select>
          </label>
          <p className="text-sm text-slate-600">…or click the exact spot on the map.</p>
          <LocationPicker value={loc} onChange={(lat, lng) => setLoc({ lat, lng })} />
          {loc && <p className="text-xs text-slate-500">Selected: {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}</p>}
        </CardContent>
      </Card>

      {text.trim() && loc && (
        <Card className="fresh-in">
          <CardHeader><CardTitle>Review before sending</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="line-clamp-3">{text}</p>
            <p className="muted">{people ? `${people} people` : "Number of people not given"} · {place || `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`}</p>
          </CardContent>
        </Card>
      )}
      {error && (
        <p role="alert" key={error} className="shake-once flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
          <CircleAlert className="size-4 shrink-0" aria-hidden />{error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={busy}><Send className="size-4" aria-hidden />{busy ? "Sending…" : "Send request"}</Button>
      {sent && (
        <div aria-live="polite" className="toast absolute inset-0 z-[1000] grid place-items-center rounded-2xl" style={{ background: "color-mix(in srgb, var(--surface) 94%, transparent)" }}>
          <div className="flex flex-col items-center gap-3 px-4">
            <SuccessCheck size={64} /><p className="text-lg font-bold">Request sent</p>
            <ol className="space-y-1 text-sm muted">
              {[["Request submitted", true], ["AI analysis (suggestion only)", false], ["Coordinator verification", false], ["Volunteer assigned", false]].map(([t, on]) => (
                <li key={String(t)} className="flex items-center gap-2"><i aria-hidden className={`led ${on ? "tone-green led-glow" : "tone-gray"}`} />{t}</li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </form>
  );
}
