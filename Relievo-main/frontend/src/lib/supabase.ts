// Supabase client for SIGN-IN only (public anon key). All data access goes through our backend API.
// The session is kept in sessionStorage, so each browser tab is its own login (two tabs = two people).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Accept the API URL (https://<ref>.supabase.co) or the dashboard link people often paste instead. */
function apiUrl(value: string | undefined): string | undefined {
  if (!value || value.startsWith("paste")) return undefined;
  const m = /supabase\.com\/dashboard\/project\/([a-z0-9]+)/i.exec(value);
  return m ? `https://${m[1]}.supabase.co` : value.replace(/\/+$/, "");
}

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    const url = apiUrl(import.meta.env.VITE_SUPABASE_URL as string | undefined);
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    if (!url || !key || key.startsWith("paste")) throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in frontend/.env");
    client = createClient(url, key, { auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true } });
  }
  return client;
}
