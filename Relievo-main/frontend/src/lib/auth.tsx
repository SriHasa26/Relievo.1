import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, hasMockToken, setToken, setTokenProvider } from "./api";
import { resetChat } from "./chat";
import { supabase } from "./supabase";
import type { User } from "./types";

export type BackendState = "checking" | "ready" | "down";

interface AuthState {
  user: User | null;
  loading: boolean;
  /** "checking" while the API is waking up (free hosting sleeps when idle), "down" if it never answered. */
  backend: BackendState;
  /** Try to reach the API again after "down". */
  wake: () => void;
  signIn: (email: string, password: string) => Promise<User>;
  signOut: () => void;
}
const AuthContext = createContext<AuthState | null>(null);

// The backend tells us which sign-in to use: demo sessions (MOCK_DB=true) or Supabase Auth (MOCK_DB=false).
// This is decided ONCE per page load, from /api/health, and retried while the API is asleep. Sign-in always waits for
// the answer: guessing "demo mode" while the server was still waking up used to send Supabase deployments down the wrong path.
let useSupabase = false;
let modePromise: Promise<boolean> | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

function detectMode(): Promise<boolean> {
  modePromise ??= (async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const health = await withTimeout(api<{ mockDb?: boolean }>("/api/health"), 20_000);
        useSupabase = health.mockDb === false;
        if (useSupabase) setTokenProvider(async () => (await supabase().auth.getSession()).data.session?.access_token ?? null);
        return useSupabase;
      } catch {
        if (attempt >= 14) { modePromise = null; throw new Error("The server did not answer."); }
        await sleep(Math.min(6000, 1500 + attempt * 800));
      }
    }
  })();
  return modePromise;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [backend, setBackend] = useState<BackendState>("checking");

  const boot = useCallback(async () => {
    setBackend("checking");
    try {
      const sb = await detectMode();
      setBackend("ready");
      if (sb) {
        const { data } = await supabase().auth.getSession();
        if (data.session) setUser(await api<User>("/api/me"));
      } else if (hasMockToken()) {
        setUser(await api<User>("/api/me"));
      }
    } catch {
      setBackend((b) => (b === "ready" ? b : "down"));
      if (!useSupabase) setToken(null); // not signed in (or the session is no longer valid): show the landing page
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void boot(); }, [boot]);

  const signIn = useCallback(async (email: string, password: string) => {
    let sb: boolean;
    try { sb = await detectMode(); } catch {
      throw new Error("The server is not reachable yet. It may be waking up: wait a few seconds and try again.");
    }
    setBackend("ready");
    if (sb) {
      const { error } = await supabase().auth.signInWithPassword({ email, password });
      if (error) throw new Error("Wrong email or password");
      const me = await api<User>("/api/me");
      setUser(me);
      return me;
    }
    const res = await api<{ token: string; user: User }>("/api/auth/login", { body: { email, password } });
    setToken(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const signOut = useCallback(() => {
    void resetChat();
    if (useSupabase) void supabase().auth.signOut(); else setToken(null);
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, loading, backend, wake: () => void boot(), signIn, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
