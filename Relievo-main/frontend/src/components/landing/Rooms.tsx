// Section 4: real-time rooms, with an animated chat mock (text only). The conversation is scripted sample content.
import { useEffect, useState } from "react";
import { Lock, MessagesSquare, Users, History } from "lucide-react";
import { prefersReducedMotion } from "@/components/kit";
import { useInView, useReveal } from "@/components/landing/hooks";

const SCRIPT: Array<{ from: "coord" | "vol"; text: string }> = [
  { from: "coord", text: "Sana, the water tanker can reach Lane 4 in about 20 minutes." },
  { from: "vol", text: "Accepted. I am 3.8 km away and leaving now." },
  { from: "coord", text: "Two elderly neighbours are weak. Please check them first." },
  { from: "vol", text: "Understood. I will update here when I arrive." },
  { from: "vol", text: "Arrived. Water handed over, everyone is stable." },
  { from: "coord", text: "Thank you. I am marking this incident resolved." },
];
const NAME = { coord: "Coordinator (sample)", vol: "Volunteer (sample)" } as const;

const POINTS = [
  { icon: MessagesSquare, title: "One room per incident", text: "Opened when the volunteer accepts. Group chat for the coordinator and the approved volunteer." },
  { icon: Users, title: "Direct messages", text: "Private coordinator-to-volunteer conversations, limited to people who work together." },
  { icon: Lock, title: "Membership from the database", text: "The backend derives who may join from the approved assignment and issues the chat tokens." },
  { icon: History, title: "History stays", text: "Messages are kept by the Nexconn Chat SDK, so a refresh or a reconnect does not lose the thread." },
];

function ChatMock() {
  const [ref, seen] = useInView<HTMLDivElement>(0.35);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion()) { setCount(SCRIPT.length); return; }
    if (!seen) return;
    const t = setTimeout(() => setCount((c) => (c >= SCRIPT.length ? 0 : c + 1)), count >= SCRIPT.length ? 4500 : 1500);
    return () => clearTimeout(t);
  }, [seen, count]);

  const next = SCRIPT[count];
  return (
    <div ref={ref} className="rr-card overflow-hidden" style={{ boxShadow: "var(--shadow-float)" }}>
      <div className="glass flex items-center gap-2 rounded-none border-x-0 border-t-0 px-4 py-3 shadow-none">
        <MessagesSquare className="size-4 text-brand" aria-hidden />
        <span className="font-display font-semibold">Incident room</span>
        <span className="ml-auto flex items-center gap-1.5 text-xs muted"><i className="led led-glow tone-green" aria-hidden />Connected</span>
      </div>
      <div className="h-80 space-y-2 overflow-hidden p-3" aria-label="Animated example conversation" role="img">
        {SCRIPT.slice(0, count).map((m, i) => (
          <div key={i} className={`flex ${m.from === "coord" ? "justify-end" : "justify-start"}`}>
            <div className={`bubble max-w-[82%] rounded-2xl px-3 py-1.5 text-sm ${m.from === "coord" ? "bubble-mine rounded-br-sm" : "bubble-theirs rounded-bl-sm"}`}>
              <div className="text-xs font-semibold opacity-80">{NAME[m.from]}</div>{m.text}
            </div>
          </div>
        ))}
        {next && count > 0 && !prefersReducedMotion() && (
          <div className={`flex ${next.from === "coord" ? "justify-end" : "justify-start"}`}>
            <span className="typing rounded-2xl px-3 py-2 muted" aria-hidden style={{ background: "var(--surface-2)" }}><i /><i /><i /></span>
          </div>
        )}
      </div>
      <p className="border-t px-4 py-2 text-xs muted">Sample conversation with synthetic content.</p>
    </div>
  );
}

export function Rooms() {
  const left = useReveal<HTMLDivElement>(0.2);
  return (
    <section id="rooms" className="land-section mesh">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 py-16 lg:grid-cols-2">
        <div ref={left} className="reveal">
          <p className="eyebrow">Real-time rooms</p>
          <h2 className="mt-2 text-3xl font-bold sm:text-5xl">Everyone on an incident, in one room.</h2>
          <p className="mt-3 muted">Incident chat is powered by the Nexconn Chat SDK. Our backend decides who belongs in a room; Nexconn carries the conversation.</p>
          <ul className="mt-6 space-y-3">
            {POINTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg" style={{ background: "var(--pill-teal-bg)", color: "var(--pill-teal-fg)" }}><Icon className="size-5" aria-hidden /></span>
                <span><span className="block font-semibold">{title}</span><span className="block text-sm muted">{text}</span></span>
              </li>
            ))}
          </ul>
        </div>
        <ChatMock />
      </div>
    </section>
  );
}
