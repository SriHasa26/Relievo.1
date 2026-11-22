import "dotenv/config";

// A value still set to the placeholder text counts as "not configured".
const real = (v: string | undefined) => (v && !v.startsWith("paste") ? v : undefined);

/**
 * The Supabase API URL looks like https://<ref>.supabase.co. People often paste the dashboard link
 * (https://supabase.com/dashboard/project/<ref>) instead, so accept that too and derive the API URL.
 */
export function apiUrlFrom(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const m = /supabase\.com\/dashboard\/project\/([a-z0-9]+)/i.exec(value);
  return m ? `https://${m[1]}.supabase.co` : value.replace(/\/+$/, "");
}

const origin = (u: string) => u.trim().replace(/\/+$/, "");

/** How many reverse proxies sit in front of the API (Render's load balancer = 1). Express then reads the client IP from X-Forwarded-For. */
const trustProxy = (v: string | undefined): number | boolean => (v === "true" ? true : v === "false" ? false : Number.isInteger(Number(v)) && v !== undefined && v !== "" ? Number(v) : 1);

export const config = {
  trustProxy: trustProxy(process.env.TRUST_PROXY),
  port: Number(process.env.PORT ?? 4000), // Render sets PORT
  isProduction: process.env.NODE_ENV === "production",
  // Browser origins allowed to call the API: the deployed frontend(s), comma separated. Localhost is added outside production.
  frontendUrls: (process.env.FRONTEND_URL ?? "").split(",").map(origin).filter((u) => u && !u.startsWith("paste")),
  // Each flag defaults to true (safe for dev with no keys). ALL must be false for the demo.
  mockChat: (process.env.MOCK_CHAT ?? "true") === "true", // in-memory chat stub instead of Nexconn
  mockAi: (process.env.MOCK_AI ?? "true") === "true", // keyword "AI" instead of Gemini
  mockDb: (process.env.MOCK_DB ?? "true") === "true", // in-memory data + demo logins instead of Supabase
  nexconnApiDomain: real(process.env.NEXCONN_API_DOMAIN), // data-center host, e.g. api.sg-light-api.com
  nexconnApiDomainBackup: real(process.env.NEXCONN_API_DOMAIN_BACKUP), // optional failover host
  nexconnAppKey: real(process.env.NEXCONN_APP_KEY),
  nexconnAppSecret: real(process.env.NEXCONN_APP_SECRET), // backend only
  geminiApiKey: real(process.env.GEMINI_API_KEY),
  openrouterApiKey: real(process.env.OPENROUTER_API_KEY), // backend only
  openrouterModel: real(process.env.OPENROUTER_MODEL) ?? "particle-ai/particle-1:free",
  demoLogin: (process.env.DEMO_LOGIN ?? "true") === "true", // role switcher + shared demo password (synthetic accounts only)
  supabaseUrl: apiUrlFrom(real(process.env.SUPABASE_URL)),
  supabaseAnonKey: real(process.env.SUPABASE_ANON_KEY), // only used by the verify script (it plays the browser)
  supabaseServiceRoleKey: real(process.env.SUPABASE_SERVICE_ROLE_KEY), // backend only
};
