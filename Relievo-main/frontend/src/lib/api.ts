// Tiny fetch wrapper. The session lives in sessionStorage so each browser TAB is its own login:
// that is what lets two tabs act as two accounts for the chat demo.
const configured = import.meta.env.VITE_API_BASE_URL as string | undefined;
const BASE = configured && !configured.startsWith("paste") ? configured : ""; // "" = Vite dev proxy

// Where the API token comes from. Default: the mock session token. With Supabase, auth.tsx swaps in a provider
// that returns the current (auto-refreshed) Supabase access token.
let tokenProvider: () => Promise<string | null> = async () => sessionStorage.getItem("rr-token");
export const setTokenProvider = (fn: () => Promise<string | null>) => { tokenProvider = fn; };
export const hasMockToken = () => Boolean(sessionStorage.getItem("rr-token"));
export const setToken = (t: string | null) =>
  t ? sessionStorage.setItem("rr-token", t) : sessionStorage.removeItem("rr-token");

/** Fetch a protected binary (for example SOS audio) with the session token and return it as a Blob. */
export async function apiBlob(path: string): Promise<Blob> {
  const token = await tokenProvider();
  const res = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return res.blob();
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await tokenProvider();
  const res = await fetch(`${BASE}${path}`, {
    method: options.method ?? (options.body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}
