// Reusable visual components. Styles live in src/theme.css; nothing here touches data or the API.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { CircleAlert, Check, Moon, Sun, X } from "lucide-react";
import { useTheme } from "@/lib/prefs";
import { cn } from "@/lib/utils";

/* ---------- motion preference ---------- */
const RM_QUERY = "(prefers-reduced-motion: reduce)";
const FINE_QUERY = "(hover: hover) and (pointer: fine)";
const matches = (q: string) => typeof window !== "undefined" && window.matchMedia?.(q).matches;
export const prefersReducedMotion = () => matches(RM_QUERY);
export const hasFinePointer = () => matches(FINE_QUERY);

/* ---------- GlassCard: floating panels only (blurred, with a solid fallback) ---------- */
export const GlassCard = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("glass rounded-2xl", className)} {...p} />
);

/* ---------- NeuToggle: soft switch (role=switch) ---------- */
export function NeuToggle({
  checked, onChange, label, className,
}: { checked: boolean; onChange: (on: boolean) => void; label: string; className?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={cn("neu-switch", className)} />
  );
}

/* NeuSegmented: soft 3-way selector (radio group) */
export function NeuSegmented<T extends string>({
  value, onChange, options, label,
}: { value: T; onChange: (v: T) => void; options: Array<[T, string]>; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="neu-segment">
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

/* NeuMeter: soft progress meter, 0-100 */
export const NeuMeter = ({ value, label }: { value: number; label: string }) => (
  <div className="neu-meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}>
    <i style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
  </div>
);

/* ---------- TiltCard: 3D tilt on hover, fine pointers only, never with reduced motion ---------- */
export function TiltCard({ children, className, max = 5 }: { children: ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const enabled = useRef(hasFinePointer() && !prefersReducedMotion());
  const move = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || !enabled.current) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `rotateY(${(x * max * 2).toFixed(2)}deg) rotateX(${(-y * max * 2).toFixed(2)}deg) translateZ(6px)`;
  };
  const reset = () => { if (ref.current) ref.current.style.transform = ""; };
  return (
    <div className="tilt-wrap">
      <div ref={ref} className={cn("tilt", className)} onPointerMove={move} onPointerLeave={reset}>{children}</div>
    </div>
  );
}

/* ---------- StatusPill: LED + label. Tone decides colour; `glow` makes the LED shine (critical) ---------- */
export type Tone = "gray" | "teal" | "green" | "amber" | "red" | "ember";
export function StatusPill({ tone = "gray", glow, pulse, children, className }: {
  tone?: Tone; glow?: boolean; pulse?: boolean; children: ReactNode; className?: string;
}) {
  return (
    <span className={cn("pill", `tone-${tone}`, className)}>
      <i aria-hidden className={cn("led", glow && "led-glow", glow && pulse && "led-pulse")} />
      {children}
    </span>
  );
}

/* ---------- UrgencyGauge: half-circle dial, needle on low / medium / high / critical ---------- */
const LEVELS = ["low", "medium", "high", "critical"] as const;
const GAUGE_COLORS = ["#9a9fa6", "#14b8a6", "#f5a524", "#ef4444"];
export function UrgencyGauge({ urgency, size = 72 }: { urgency: (typeof LEVELS)[number]; size?: number }) {
  const idx = LEVELS.indexOf(urgency);
  const angle = -80 + idx * (160 / 3); // needle sweep -80deg .. +80deg
  const arc = (i: number) => {
    const a0 = Math.PI * (1 - i / 4), a1 = Math.PI * (1 - (i + 1) / 4);
    const pt = (a: number) => `${(50 + 38 * Math.cos(a)).toFixed(2)} ${(50 - 38 * Math.sin(a)).toFixed(2)}`;
    return `M ${pt(a0)} A 38 38 0 0 1 ${pt(a1)}`;
  };
  return (
    <svg viewBox="0 0 100 62" width={size} height={size * 0.62} role="img" aria-label={`Urgency dial: ${urgency}`}>
      <path d="M 8 50 A 42 42 0 0 1 92 50" fill="none" stroke="var(--surface-2)" strokeWidth="12" strokeLinecap="round" />
      {LEVELS.map((l, i) => (
        <path key={l} d={arc(i)} fill="none" stroke={GAUGE_COLORS[i]} strokeWidth="8" strokeOpacity={i <= idx ? 1 : 0.28} />
      ))}
      <g className="gauge-needle" style={{ transform: `rotate(${angle}deg)` }}>
        <line x1="50" y1="50" x2="50" y2="18" stroke="var(--text)" strokeWidth="3" strokeLinecap="round" />
      </g>
      <circle cx="50" cy="50" r="5" fill="var(--text)" stroke="var(--surface)" strokeWidth="2" />
    </svg>
  );
}

/* ---------- AnimatedNumber: counts up visually; the DOM text is always the final value ---------- */
export function AnimatedNumber({ value, suffix = "", duration = 800 }: { value: number; suffix?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion() || shown.current === value) { shown.current = value; el.classList.remove("count--anim"); return; }
    const from = shown.current, start = performance.now();
    let raf = 0;
    el.classList.add("count--anim");
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.dataset.live = `${Math.round(from + (value - from) * eased)}${suffix}`;
      if (t < 1) raf = requestAnimationFrame(tick);
      else { shown.current = value; el.classList.remove("count--anim"); }
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); shown.current = value; el.classList.remove("count--anim"); };
  }, [value, suffix, duration]);
  return <span ref={ref} data-live={`0${suffix}`}>{value}{suffix}</span>;
}

/* ---------- ThemeToggle: light / dark (system default, choice remembered) ---------- */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button type="button" className={cn("theme-toggle", className)} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}
      onClick={() => setTheme(next)}>
      {theme === "dark" ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
    </button>
  );
}

/* ---------- Skeleton ---------- */
export const Skeleton = ({ className, style }: { className?: string; style?: CSSProperties }) => (
  <div aria-hidden className={cn("skeleton h-4 w-full", className)} style={style} />
);
export const SkeletonList = ({ rows = 3 }: { rows?: number }) => (
  <div className="space-y-2" role="status" aria-label="Loading">
    {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
  </div>
);

/* ---------- Toasts (with an animated success check) ---------- */
type ToastKind = "success" | "error";
interface ToastItem { id: number; kind: ToastKind; text: string }
const ToastCtx = createContext<(text: string, kind?: ToastKind) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export const SuccessCheck = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="none">
    <circle cx="12" cy="12" r="11" fill="#16a34a" />
    <path className="check-path" d="M6.5 12.5l3.5 3.5 7.5-8" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const push = useCallback((text: string, kind: ToastKind = "success") => {
    const id = next.current++;
    setItems((x) => [...x.slice(-2), { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {/* aria-live region without role="status" so it does not collide with in-page status messages */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[2000] flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div key={t.id} className="toast glass pointer-events-auto flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium" style={{ color: "var(--text)" }}>
            {t.kind === "success" ? <SuccessCheck /> : <CircleAlert className="size-5 text-red-500" aria-hidden />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- small helpers ---------- */
export const EmptyState = ({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) => (
  <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed px-6 py-10 text-center" style={{ color: "var(--muted)" }}>
    <div aria-hidden className="grid size-12 place-items-center rounded-full" style={{ background: "var(--surface-2)" }}>{icon}</div>
    <p className="font-semibold" style={{ color: "var(--text)" }}>{title}</p>
    {hint && <p className="max-w-sm text-sm">{hint}</p>}
  </div>
);

export const Tick = () => <Check className="size-4" aria-hidden />;

/* ---------- AlertBanner: emergency state for critical incidents (red edge glow + banner). Motion is switched off by CSS under reduced motion. ---------- */
export function AlertBanner({ title, detail, more, onOpen, onDismiss }: {
  title: string; detail: string; more?: number; onOpen: () => void; onDismiss: () => void;
}) {
  return (
    <>
      <div aria-hidden className="alert-glow" />
      <div role="alert" className="alert-banner relative z-[1060] flex flex-wrap items-center gap-3 p-3 sm:p-4">
        <span className="alert-tag">CRITICAL</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display font-bold">{title}</p>
          <p className="line-clamp-2 text-sm muted">{detail}{more ? ` · +${more} more critical` : ""}</p>
        </div>
        <button type="button" onClick={onOpen} className="rr-btn btn-brand h-10 rounded-md px-4 text-sm font-semibold">Open incident</button>
        <button type="button" onClick={onDismiss} aria-label="Dismiss alert" className="rr-btn grid size-10 place-items-center rounded-md border">
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </>
  );
}
