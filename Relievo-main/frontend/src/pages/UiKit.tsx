// Dev-only component gallery (route /ui-kit exists only when running `vite` in development; it is not in production builds).
import { useState } from "react";
import { Inbox } from "lucide-react";
import {
  AnimatedNumber, EmptyState, GlassCard, NeuMeter, NeuSegmented, NeuToggle, Skeleton, StatusPill, TiltCard,
  UrgencyGauge, useToast,
} from "@/components/kit";
import { Button } from "@/components/ui/button";

export default function UiKit() {
  const [on, setOn] = useState(true);
  const [seg, setSeg] = useState("available");
  const [n, setN] = useState(42);
  const toast = useToast();
  return (
    <div className="app-root mesh min-h-screen space-y-8 p-6">
      <h1 className="text-3xl font-bold">UI kit (dev only)</h1>
      <section className="space-y-2"><h2 className="font-semibold">StatusPill</h2>
        <div className="flex flex-wrap gap-2">
          <StatusPill tone="red" glow pulse>critical</StatusPill><StatusPill tone="teal" glow>verified</StatusPill>
          <StatusPill tone="green" glow>resolved</StatusPill><StatusPill tone="amber">in progress</StatusPill>
          <StatusPill tone="ember">assigned</StatusPill><StatusPill>submitted</StatusPill>
        </div></section>
      <section className="space-y-2"><h2 className="font-semibold">UrgencyGauge</h2>
        <div className="flex gap-6">{(["low", "medium", "high", "critical"] as const).map((u) => <UrgencyGauge key={u} urgency={u} size={96} />)}</div></section>
      <section className="space-y-3"><h2 className="font-semibold">Neumorphic controls</h2>
        <div className="flex flex-wrap items-center gap-6">
          <NeuToggle checked={on} onChange={setOn} label="Demo switch" />
          <NeuSegmented label="Demo availability" value={seg} onChange={setSeg} options={[["available", "Available"], ["busy", "Busy"], ["offline", "Offline"]]} />
          <div className="w-64"><NeuMeter value={72} label="Demo meter" /></div>
        </div></section>
      <section className="space-y-2"><h2 className="font-semibold">Buttons, AnimatedNumber, Toast</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="physical" size="lg">Approve assignment</Button>
          <Button variant="outline">Outline</Button>
          <span className="text-4xl font-bold"><AnimatedNumber value={n} /></span>
          <Button size="sm" onClick={() => setN((x) => x + 17)}>+17</Button>
          <Button size="sm" onClick={() => toast("Incident verified")}>Success toast</Button>
          <Button size="sm" variant="destructive" onClick={() => toast("Something failed", "error")}>Error toast</Button>
        </div></section>
      <section className="grid gap-4 md:grid-cols-3"><h2 className="font-semibold md:col-span-3">GlassCard / TiltCard / Skeleton / EmptyState</h2>
        <GlassCard className="p-4">Glass panel (blur with solid fallback)</GlassCard>
        <TiltCard className="rr-card p-4">Tilt card: hover with a mouse</TiltCard>
        <div className="space-y-2"><Skeleton /><Skeleton className="w-2/3" /><Skeleton className="h-12" /></div>
        <div className="md:col-span-3"><EmptyState icon={<Inbox className="size-6" />} title="Nothing here yet" hint="Empty states explain what will appear." /></div>
      </section>
    </div>
  );
}
