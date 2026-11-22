// Shared voice input: live speech-to-text (Web Speech API) plus, optionally, a separate audio recording (MediaRecorder).
// The recording is independent of the transcription, so a clip exists even when transcription fails or is unsupported.
// Works on HTTPS (Vercel) and localhost. Speech recognition is available in Chrome and Edge; other browsers get a clear message.
import { useCallback, useEffect, useRef, useState } from "react";

export const VOICE_LANGS = [["en-IN", "English (India)"], ["hi-IN", "Hindi"], ["te-IN", "Telugu"]] as const;
export type VoiceLang = (typeof VOICE_LANGS)[number][0];
export const MAX_RECORD_SECONDS = 45;
export const MAX_AUDIO_BYTES = 1_400_000; // below the backend cap

export type VoiceErrorKind = "unsupported" | "denied" | "no-speech" | "no-mic" | "network" | "other";
export interface VoiceError { kind: VoiceErrorKind; message: string }
export interface RecordedAudio { blob: Blob; mime: string; seconds: number }

// Minimal typings for the (prefixed) Web Speech API.
interface SRResult { isFinal: boolean; 0: { transcript: string } }
interface SREvent { resultIndex: number; results: ArrayLike<SRResult> }
interface SR {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: SREvent) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type SRCtor = new () => SR;
const speechCtor = (): SRCtor | null => {
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
const canRecordAudio = () => typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

const MESSAGES: Record<VoiceErrorKind, string> = {
  unsupported: "Voice typing is not supported in this browser. Please use Chrome or Edge, or type your message.",
  denied: "Microphone permission was denied. Allow the microphone for this site in your browser settings, then try again.",
  "no-speech": "No speech was detected. Check your microphone and try again.",
  "no-mic": "No microphone was found on this device.",
  network: "The speech service could not be reached. Voice typing needs an internet connection.",
  other: "Voice input stopped unexpectedly. You can type instead.",
};
const err = (kind: VoiceErrorKind): VoiceError => ({ kind, message: MESSAGES[kind] });

export interface VoiceOptions {
  /** Also record the audio with MediaRecorder (SOS). Plain dictation into a text box leaves this off. */
  recordAudio?: boolean;
  /** Called with the full text so far (final + interim) whenever it changes. */
  onText?: (text: string) => void;
  /** Called once when listening ends (stop, silence or the time limit). */
  onEnd?: () => void;
}

export function useVoiceInput(options: VoiceOptions = {}) {
  const [lang, setLang] = useState<VoiceLang>(() => {
    try { const v = localStorage.getItem("rr-voice-lang"); if (v === "hi-IN" || v === "te-IN" || v === "en-IN") return v; } catch { /* ignore */ }
    return "en-IN";
  });
  const [listening, setListening] = useState(false);
  const [finalText, setFinalText] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<VoiceError | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [audio, setAudio] = useState<RecordedAudio | null>(null);

  const opts = useRef(options);
  opts.current = options;
  const rec = useRef<SR | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);
  const finalRef = useRef("");
  const ending = useRef(false);
  const gen = useRef(0); // bumped when the component unmounts, so a pending microphone request is discarded
  const active = useRef(false); // true from a successful start until finish() ran once

  const supported = speechCtor() !== null;

  const cleanup = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  const finish = useCallback(() => {
    if (!active.current) return;
    active.current = false;
    cleanup();
    setListening(false);
    setInterim("");
    ending.current = false;
    opts.current.onEnd?.();
  }, [cleanup]);

  /** Stop listening (also called automatically on silence and at the time limit). */
  const stop = useCallback(() => {
    if (ending.current) return;
    ending.current = true;
    try { rec.current?.stop(); } catch { /* already stopped */ }
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    else finish();
  }, [finish]);

  const start = useCallback(async () => {
    if (listening) return;
    setError(null); setAudio(null); setSeconds(0); setInterim("");
    finalRef.current = ""; setFinalText(""); chunks.current = []; ending.current = false;
    const myGen = ++gen.current;
    const wantAudio = Boolean(opts.current.recordAudio);
    const SRClass = speechCtor();
    if (!SRClass && !wantAudio) { setError(err("unsupported")); return; }

    // 1. recognition first, synchronously, so it still counts as a response to the tap
    let recognitionRunning = false;
    if (SRClass) {
      const r = new SRClass();
      r.lang = lang; r.continuous = true; r.interimResults = true;
      r.onresult = (e) => {
        let live = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i]!;
          if (res.isFinal) finalRef.current += `${finalRef.current ? " " : ""}${res[0].transcript.trim()}`;
          else live += res[0].transcript;
        }
        setFinalText(finalRef.current);
        setInterim(live);
        opts.current.onText?.(`${finalRef.current}${live ? `${finalRef.current ? " " : ""}${live}` : ""}`);
      };
      r.onerror = (e) => {
        const kind: VoiceErrorKind = e.error === "not-allowed" || e.error === "service-not-allowed" ? "denied"
          : e.error === "no-speech" ? "no-speech" : e.error === "audio-capture" ? "no-mic" : e.error === "network" ? "network"
            : e.error === "aborted" ? "other" : "other";
        if (e.error !== "aborted") setError(err(kind));
      };
      r.onend = () => { // silence, the user pressed stop, or an error: wrap up (the recorder follows)
        if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop(); else finish();
      };
      rec.current = r;
      try { r.start(); recognitionRunning = true; } catch { setError(err("other")); }
    } else {
      setError(err("unsupported")); // non-fatal: the clip is still recorded below
    }

    // 2. separate audio recording
    let recording = false;
    if (wantAudio) {
      if (!canRecordAudio()) { if (!recognitionRunning) return; }
      else {
        try {
          const s = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (myGen !== gen.current) { s.getTracks().forEach((t) => t.stop()); return; } // started again or unmounted meanwhile
          stream.current = s;
          const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported?.(m)) ?? "";
          const mr = new MediaRecorder(s, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32_000 });
          mr.ondataavailable = (ev) => { if (ev.data.size > 0) chunks.current.push(ev.data); };
          mr.onstop = () => {
            const type = mr.mimeType || mime || "audio/webm";
            const blob = new Blob(chunks.current, { type });
            const secs = Math.min(MAX_RECORD_SECONDS, Math.round((Date.now() - startedAt.current) / 1000));
            if (blob.size > 0) setAudio({ blob, mime: type, seconds: secs });
            finish();
          };
          mr.start(1000);
          recorder.current = mr;
          recording = true;
        } catch (e) {
          const name = (e as DOMException).name;
          setError(err(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" ? "no-mic" : "other"));
          if (!recognitionRunning) return;
        }
      }
    }
    if (!recognitionRunning && !recording) return;

    startedAt.current = Date.now();
    active.current = true;
    setListening(true);
    timer.current = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt.current) / 1000);
      setSeconds(s);
      if (s >= MAX_RECORD_SECONDS) stop();
    }, 250);
  }, [lang, listening, finish, stop]);

  const changeLang = useCallback((l: VoiceLang) => {
    setLang(l);
    try { localStorage.setItem("rr-voice-lang", l); } catch { /* ignore */ }
  }, []);

  useEffect(() => () => { // leaving the page: release the microphone
    gen.current++;
    try { rec.current?.abort(); } catch { /* ignore */ }
    if (recorder.current && recorder.current.state !== "inactive") { recorder.current.onstop = null; recorder.current.stop(); }
    stream.current?.getTracks().forEach((t) => t.stop());
    if (timer.current) clearInterval(timer.current);
  }, []);

  return { supported, lang, setLang: changeLang, listening, transcript: finalText, interim, error, seconds, audio, start, stop };
}
