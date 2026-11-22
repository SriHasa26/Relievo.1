import { Cpu, MessagesSquare, Scale, ScanText } from "lucide-react";
import { HeroMap } from "@/components/landing/HeroMap";
import { Button } from "@/components/ui/button";

const POINTS = [
  { icon: ScanText, title: "Smart intake", text: "Plain-language reports with a large-text friendly form." },
  { icon: Cpu, title: "AI triage", text: "AI extracts category, urgency and needs. It only suggests." },
  { icon: Scale, title: "Explainable dispatch", text: "Every match shows its score breakdown. A coordinator approves." },
  { icon: MessagesSquare, title: "Real-time incident rooms", text: "One chat room per incident, plus direct messages." },
];

const delay = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

export function Hero() {
  return (
    <section id="top" className="land-section mesh overflow-hidden">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 py-14 lg:grid-cols-2">
        <div>
          <p className="eyebrow hero-rise">Disaster-response coordination</p>
          <h1 className="hero-rise mt-3 text-4xl font-bold leading-[1.05] sm:text-6xl" style={delay(80)}>
            From emergency signals to <span className="text-brand">coordinated, human-approved</span> action.
          </h1>
          <p className="hero-rise mt-5 max-w-xl text-lg muted" style={delay(180)}>
            Citizen reports become structured incidents. AI suggests, a human coordinator verifies and approves every
            assignment, and responders talk in a room built for that incident.
          </p>
          <div className="hero-rise mt-7 flex flex-wrap gap-3" style={delay(280)}>
            <a href="#signin"><Button size="lg">Try the demo</Button></a>
            <a href="#workflow"><Button size="lg" variant="outline">See how it works</Button></a>
          </div>
          <ul className="mt-9 grid gap-3 sm:grid-cols-2">
            {POINTS.map(({ icon: Icon, title, text }, i) => (
              <li key={title} className="hero-rise rr-card flex gap-3 p-3" style={delay(380 + i * 90)}>
                <span className="grid size-9 shrink-0 place-items-center rounded-lg" style={{ background: "var(--pill-ember-bg)", color: "var(--pill-ember-fg)" }}>
                  <Icon className="size-5" aria-hidden />
                </span>
                <span><span className="block text-sm font-semibold">{title}</span><span className="block text-xs muted">{text}</span></span>
              </li>
            ))}
          </ul>
        </div>
        <div className="hero-rise" style={delay(200)}><HeroMap /></div>
      </div>
    </section>
  );
}
