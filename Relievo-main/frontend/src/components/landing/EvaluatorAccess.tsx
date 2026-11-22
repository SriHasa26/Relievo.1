// "Evaluator access": visible without signing in. One synthetic account per role, with copy buttons and one-click sign-in.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Copy, HeartHandshake, Home, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import { GlassCard, useToast } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { EVALUATOR_ACCOUNTS, EVALUATOR_PASSWORD } from "@/lib/evaluator";
import { HOME, type Role } from "@/lib/types";

const ICON: Record<Role, LucideIcon> = { citizen: Home, volunteer: HeartHandshake, coordinator: ShieldCheck, ngo: Users };

function CopyButton({ text, what }: { text: string; what: string }) {
  const [done, setDone] = useState(false);
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch { // clipboard blocked (older browser / insecure page): fall back to a temporary textarea
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch { toast("Could not copy. Select the text and copy it by hand.", "error"); return; }
      document.body.removeChild(ta);
    }
    setDone(true);
    toast(`Copied ${what}`);
    setTimeout(() => setDone(false), 1500);
  };
  return (
    <button type="button" onClick={() => void copy()} aria-label={`Copy ${what}`}
      className="rr-btn inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold">
      {done ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}{done ? "Copied" : "Copy"}
    </button>
  );
}

export function EvaluatorAccess() {
  const { signIn, backend } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<Role | null>(null);
  const [error, setError] = useState("");

  const go = async (role: Role, email: string) => {
    setError(""); setBusy(role);
    try {
      const u = await signIn(email, EVALUATOR_PASSWORD);
      navigate(HOME[u.role]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <GlassCard className="p-5 sm:p-6" id="evaluator">
      <h3 className="font-display text-lg font-semibold">Evaluator access</h3>
      <p className="mt-1 text-sm muted">
        Synthetic demo accounts, one per role, for reviewers. They hold sample data only and are not real people or real emergencies.
        Password for all four: <code className="rounded px-1.5 py-0.5 font-mono text-xs" style={{ background: "var(--surface-2)" }}>{EVALUATOR_PASSWORD}</code>
      </p>
      {backend === "checking" && <p className="mt-2 text-sm text-brand" role="status">Waking up the server (free hosting sleeps when idle). Sign-in works as soon as it answers, usually within a minute.</p>}
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {EVALUATOR_ACCOUNTS.map(({ role, name, email, note }) => {
          const Icon = ICON[role];
          return (
            <li key={role} className="rr-card flex flex-col gap-2 p-3.5">
              <p className="flex items-center gap-2 font-semibold capitalize"><Icon className="size-4 text-brand" aria-hidden />{role}<span className="text-xs font-normal muted normal-case">· {name}</span></p>
              <p className="text-xs muted">{note}</p>
              <div className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate text-xs" title={email}>{email}</code><CopyButton text={email} what={`${role} login`} /></div>
              <div className="flex items-center gap-2"><code className="min-w-0 flex-1 text-xs">{EVALUATOR_PASSWORD}</code><CopyButton text={EVALUATOR_PASSWORD} what={`${role} passcode`} /></div>
              <Button size="sm" disabled={busy !== null} onClick={() => void go(role, email)}>
                {busy === role ? "Signing in…" : `Sign in as ${role}`}
              </Button>
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </GlassCard>
  );
}
