// Section 2: the six modules as tilt cards that animate in on scroll. Descriptions are deliberately plain and honest.
import { Activity, BrainCircuit, Boxes, LifeBuoy, MessagesSquare, Route, type LucideIcon } from "lucide-react";
import { TiltCard } from "@/components/kit";
import { useReveal } from "@/components/landing/hooks";

const MODULES: Array<{ name: string; icon: LucideIcon; text: string }> = [
  { name: "SmartSOS", icon: LifeBuoy, text: "Citizens describe an emergency in plain text, pick a place or drop a pin. A large-text mode keeps the form easy to read." },
  { name: "CrisisMind", icon: BrainCircuit, text: "AI extracts category, urgency, people and needs and shows them next to the original report. It only suggests; a coordinator verifies." },
  { name: "ResponderMatch", icon: Route, text: "Ranks volunteers with a visible score, S = 0.35D + 0.30K + 0.20A + 0.15C. Busy or unverified volunteers are excluded." },
  { name: "RelayRooms", icon: MessagesSquare, text: "A chat room per incident for the coordinator and the approved volunteer, plus direct messages, built on the Nexconn Chat SDK." },
  { name: "ResourceBridge", icon: Boxes, text: "A small list of relief stock that a coordinator can allocate to an incident. Kept minimal in this demo." },
  { name: "ImpactTrace", icon: Activity, text: "A status timeline per incident and a small dashboard, both computed from the incident event log." },
];

function ModuleCard({ name, icon: Icon, text, i }: (typeof MODULES)[number] & { i: number }) {
  const ref = useReveal<HTMLDivElement>(0.15);
  return (
    <div ref={ref} className="reveal" style={{ "--d": `${(i % 3) * 90}ms` } as React.CSSProperties}>
      <TiltCard className="rr-card h-full p-5">
        <span className="grid size-11 place-items-center rounded-xl" style={{ background: "var(--pill-ember-bg)", color: "var(--pill-ember-fg)" }}>
          <Icon className="size-6" aria-hidden />
        </span>
        <h3 className="mt-4 text-xl font-bold">{name}</h3>
        <p className="mt-2 text-sm muted">{text}</p>
      </TiltCard>
    </div>
  );
}

export function Capabilities() {
  return (
    <section id="capabilities" className="land-section">
      <div className="mx-auto w-full max-w-6xl px-4 py-16">
        <p className="eyebrow">What it can do</p>
        <h2 className="mt-2 max-w-2xl text-3xl font-bold sm:text-5xl">Six modules, one human-approved flow.</h2>
        <p className="mt-3 max-w-2xl muted">Each module does one job. None of them dispatches anyone on its own.</p>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m, i) => <ModuleCard key={m.name} {...m} i={i} />)}
        </div>
      </div>
    </section>
  );
}
