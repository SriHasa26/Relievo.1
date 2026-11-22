// Section 5 of the landing page: the demo role switcher and the email form (same behaviour as before, new look).
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HeartHandshake, Home, KeyRound, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import { EvaluatorAccess } from "@/components/landing/EvaluatorAccess";
import { GlassCard } from "@/components/kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { HOME, type DemoUser, type Role } from "@/lib/types";

const ROLE_ORDER: Role[] = ["citizen", "volunteer", "coordinator", "ngo"];
const ROLE_ICON: Record<Role, LucideIcon> = { citizen: Home, volunteer: HeartHandshake, coordinator: ShieldCheck, ngo: Users };

export function SignInSection() {
  const { signIn, backend, wake } = useAuth();
  const navigate = useNavigate();
  const [demoUsers, setDemoUsers] = useState<DemoUser[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  // Load the demo accounts once the API answers; retry a few times so one slow request never leaves the list empty.
  useEffect(() => {
    if (backend !== "ready") return;
    let cancelled = false;
    (async () => {
      for (let i = 0; i < 5 && !cancelled; i++) {
        try { const list = await api<DemoUser[]>("/api/auth/demo-users"); if (!cancelled) setDemoUsers(list); return; }
        catch { await new Promise((r) => setTimeout(r, 2000)); }
      }
    })();
    return () => { cancelled = true; };
  }, [backend]);

  const go = async (e: string, p: string) => {
    setError("");
    try {
      const u = await signIn(e, p);
      navigate(HOME[u.role]);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <section id="signin" className="land-section mesh">
      <div className="mx-auto w-full max-w-4xl px-4 py-16">
        <p className="eyebrow">Try it</p>
        <h2 className="mt-2 text-3xl font-bold sm:text-4xl">Sign in</h2>
        <p className="mt-2 muted">Pick a demo account, or use your own email. Each browser tab keeps its own login, so open two tabs to be two people.</p>

        <div className="mt-6"><EvaluatorAccess /></div>

        <GlassCard className="mt-6 p-5 sm:p-6">
          <h3 className="font-display text-lg font-semibold">Demo role switcher</h3>
          <p className="mb-4 mt-1 text-sm muted">One click signs in as that account.</p>
          {demoUsers.length === 0 && backend === "checking" && <p className="text-sm text-brand" role="status">Waking up the server (free hosting sleeps when idle). This can take up to a minute…</p>}
          {demoUsers.length === 0 && backend === "down" && (
            <p className="flex flex-wrap items-center gap-2 text-sm muted">The server did not answer. <Button size="sm" variant="outline" onClick={wake}>Try again</Button></p>
          )}
          {demoUsers.length === 0 && backend === "ready" && <p className="text-sm muted">Demo accounts unavailable (demo logins are switched off on this server). Use the email form below.</p>}
          <div className="space-y-4">
            {ROLE_ORDER.map((role) => {
              const Icon = ROLE_ICON[role];
              const users = demoUsers.filter((u) => u.role === role);
              if (users.length === 0) return null;
              return (
                <div key={role}>
                  <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide muted">
                    <Icon className="size-3.5" aria-hidden />{role}
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {users.map((u) => (
                      <Button key={u.id} variant="outline" className="h-11" onClick={() => go(u.email, u.password)}>
                        {u.name}
                        {role === "volunteer" && !u.verified && <Badge tone="amber">unverified</Badge>}
                      </Button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>

        <GlassCard className="mt-6 p-5 sm:p-6">
          <h3 className="flex items-center gap-2 font-display text-lg font-semibold"><KeyRound className="size-4" aria-hidden />Sign in with email</h3>
          <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void go(email, password); }}>
            <input className="min-w-0 flex-1 basis-48 rounded-md border px-3 py-2" placeholder="Email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="min-w-0 flex-1 basis-48 rounded-md border px-3 py-2" type="password" placeholder="Password" aria-label="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <Button type="submit">Sign in</Button>
          </form>
          {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
        </GlassCard>
      </div>
    </section>
  );
}
