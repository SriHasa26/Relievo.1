// Mic button + language selector for any text box. While listening, the live transcript is written into the box
// (after whatever was already there) and stays editable. Clear messages for: unsupported browser, permission denied, no speech.
import { useRef } from "react";
import { Mic, Square } from "lucide-react";
import { VOICE_LANGS, useVoiceInput, type VoiceLang } from "@/lib/useVoiceInput";
import { cn } from "@/lib/utils";

export function VoiceButton({ getText, onText, className }: { getText: () => string; onText: (text: string) => void; className?: string }) {
  const base = useRef("");
  const voice = useVoiceInput({
    onText: (t) => onText(`${base.current}${base.current && t ? " " : ""}${t}`),
  });
  const toggle = () => {
    if (voice.listening) return voice.stop();
    base.current = getText().trim();
    void voice.start();
  };
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={toggle} aria-pressed={voice.listening}
          aria-label={voice.listening ? "Stop voice typing" : "Start voice typing"} title={voice.listening ? "Stop voice typing" : "Voice typing"}
          className={cn("rr-btn grid size-10 shrink-0 place-items-center rounded-full border", voice.listening && "btn-brand")}
          style={voice.listening ? { boxShadow: "0 0 0 4px color-mix(in srgb, var(--brand-solid) 30%, transparent)" } : undefined}>
          {voice.listening ? <Square className="size-4" aria-hidden /> : <Mic className="size-4" aria-hidden />}
        </button>
        <select aria-label="Voice language" value={voice.lang} onChange={(e) => voice.setLang(e.target.value as VoiceLang)}
          disabled={voice.listening} className="h-10 rounded-md border px-1.5 text-xs">
          {VOICE_LANGS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
      </div>
      <p aria-live="polite" className="min-h-[1rem] text-xs">
        {voice.listening ? <span className="text-brand">Listening… speak now ({voice.seconds}s)</span>
          : voice.error ? <span className="text-red-700">{voice.error.message}</span> : null}
      </p>
    </div>
  );
}
