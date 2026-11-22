// Stylised, lightweight hero visual (inline SVG, no map tiles): radar sweep, pulsing incident pings,
// volunteer dots travelling along lines to incidents, and floating status chips. Purely decorative and illustrative.
import { prefersReducedMotion } from "@/components/kit";

interface Ping { x: number; y: number; critical?: boolean; color: string; d: string }
const PINGS: Ping[] = [
  { x: 410, y: 190, critical: true, color: "#ef4444", d: "0s" },
  { x: 180, y: 250, color: "#f5a524", d: "0.8s" },
  { x: 450, y: 400, color: "#14b8a6", d: "1.4s" },
  { x: 250, y: 440, color: "#f5a524", d: "0.3s" },
];
// each route: volunteer start -> incident
const ROUTES = [
  { id: "r1", d: "M 90 120 C 200 150, 320 150, 410 190" },
  { id: "r2", d: "M 520 300 C 500 340, 480 370, 450 400" },
  { id: "r3", d: "M 110 480 C 160 470, 210 455, 250 440" },
];

function Chip({ className, d, children }: { className: string; d: string; children: React.ReactNode }) {
  return (
    <div className={`chip-float glass absolute z-10 flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold ${className}`}
      style={{ "--d": d } as React.CSSProperties}>
      {children}
    </div>
  );
}

export function HeroMap() {
  const still = prefersReducedMotion();
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[34rem]">
      <svg viewBox="0 0 600 600" className="h-full w-full rounded-[2rem]" role="img"
        aria-label="Stylised map: incidents pulse, volunteers move toward them, a radar sweeps the area. Illustration only, not live data.">
        <defs>
          <radialGradient id="hm-bg" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stopColor="var(--surface-2)" /><stop offset="100%" stopColor="var(--surface)" />
          </radialGradient>
          <linearGradient id="hm-sweep" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#f2733a" stopOpacity="0" /><stop offset="100%" stopColor="#f2733a" stopOpacity="0.38" />
          </linearGradient>
        </defs>
        <rect width="600" height="600" rx="32" fill="url(#hm-bg)" stroke="var(--border)" />
        {/* city grid, river and main roads */}
        <g stroke="var(--border)" strokeWidth="1" opacity="0.7">
          {Array.from({ length: 11 }, (_, i) => <line key={`v${i}`} x1={50 + i * 50} y1="20" x2={50 + i * 50} y2="580" />)}
          {Array.from({ length: 11 }, (_, i) => <line key={`h${i}`} x1="20" y1={50 + i * 50} x2="580" y2={50 + i * 50} />)}
        </g>
        <path d="M -10 330 C 120 280, 220 380, 330 330 S 520 260, 610 320" fill="none" stroke="#14b8a6" strokeOpacity="0.28" strokeWidth="22" strokeLinecap="round" />
        <path d="M 40 560 L 200 380 L 340 300 L 560 60" fill="none" stroke="var(--muted)" strokeOpacity="0.35" strokeWidth="3" />
        <path d="M 60 90 L 300 300 L 540 540" fill="none" stroke="var(--muted)" strokeOpacity="0.25" strokeWidth="3" />
        {/* radar */}
        <g fill="none" stroke="var(--brand)" strokeOpacity="0.4">
          <circle cx="300" cy="300" r="90" /><circle cx="300" cy="300" r="170" /><circle cx="300" cy="300" r="250" />
        </g>
        <g className="radar-sweep"><path d="M 300 300 L 550 300 A 250 250 0 0 0 487 132 Z" fill="url(#hm-sweep)" /></g>
        <circle cx="300" cy="300" r="5" fill="var(--brand)" />
        {/* volunteer routes */}
        {ROUTES.map((r) => <path key={r.id} id={r.id} d={r.d} fill="none" stroke="var(--led-teal)" strokeOpacity="0.55" strokeWidth="2" strokeDasharray="6 8" />)}
        {ROUTES.map((r, i) => (
          <circle key={`v-${r.id}`} r="6" fill="var(--led-teal)" stroke="var(--surface)" strokeWidth="2" className="vol-dot">
            {still ? <set attributeName="cx" to={[410, 450, 250][i]} /> : null}
            {still ? <set attributeName="cy" to={[190, 400, 440][i]} /> : <animateMotion dur={`${6 + i * 1.5}s`} repeatCount="indefinite" begin={`${i * 0.8}s`} path={r.d} />}
          </circle>
        ))}
        {/* incident pings */}
        {PINGS.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="12" fill="none" stroke={p.color} strokeWidth="3" className={`ping-dot ${p.critical ? "ping-critical" : ""}`} style={{ "--d": p.d } as React.CSSProperties} />
            <circle cx={p.x} cy={p.y} r={p.critical ? 9 : 7} fill={p.color} stroke="var(--surface)" strokeWidth="2" />
          </g>
        ))}
      </svg>
      <Chip className="left-[4%] top-[8%]" d="0s"><i className="led led-glow tone-red" aria-hidden />Critical · water · Lane 4</Chip>
      <Chip className="right-[2%] top-[38%]" d="1.2s"><i className="led led-glow tone-teal" aria-hidden />Verified by coordinator</Chip>
      <Chip className="bottom-[10%] left-[8%]" d="2.2s"><i className="led led-glow tone-ember" aria-hidden />Match S = 71.3 · 3.8 km</Chip>
      <Chip className="bottom-[4%] right-[6%]" d="3s"><i className="led led-glow tone-green" aria-hidden />Room open</Chip>
      <p className="mt-2 text-center text-xs muted">Stylised illustration, not live data.</p>
    </div>
  );
}
