import { createApp } from "./app";
import { config } from "./config";
import { ensureVolunteerHub, registerAllUsers, restoreRooms } from "./services/rooms";
import { runEscalationCheck } from "./services/escalation";

/** A production deploy must never run on mock data, mock chat or the dev store. Fail fast with a clear message. */
function assertProductionConfig() {
  if (!config.isProduction) return;
  const problems: string[] = [];
  if (config.mockDb) problems.push("MOCK_DB must be false (Supabase)");
  if (config.mockChat) problems.push("MOCK_CHAT must be false (Nexconn)");
  if (config.mockAi) problems.push("MOCK_AI must be false (OpenRouter)");
  if (!config.mockDb && (!config.supabaseUrl || !config.supabaseServiceRoleKey)) problems.push("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  if (!config.mockChat && (!config.nexconnAppKey || !config.nexconnAppSecret || !config.nexconnApiDomain)) problems.push("NEXCONN_APP_KEY, NEXCONN_APP_SECRET and NEXCONN_API_DOMAIN are required");
  if (config.frontendUrls.length === 0) problems.push("FRONTEND_URL is required (CORS)");
  if (problems.length > 0) {
    console.error(`Refusing to start in production:\n - ${problems.join("\n - ")}`);
    process.exit(1);
  }
}
assertProductionConfig();

createApp().listen(config.port, () => {
  console.log(`Relievo API listening on port ${config.port}  (MOCK_CHAT=${config.mockChat} MOCK_AI=${config.mockAi} MOCK_DB=${config.mockDb})`);
  if (config.mockChat || config.mockAi || config.mockDb) console.log("MOCK flags are on. Set MOCK_CHAT, MOCK_AI and MOCK_DB to false for the demo.");

  // Escalate incidents nobody has taken for too long (once each), every minute.
  setInterval(() => { void runEscalationCheck().catch((e: Error) => console.warn("escalation check failed:", e.message)); }, 60_000);

  // Chat set-up runs in the background so a slow Nexconn never delays or blocks the server from starting.
  // Both steps are safe to repeat on every restart: they reuse the stored room ids and only add what is missing.
  void (async () => {
    await registerAllUsers() // every user known to Nexconn, so a direct message to a never-logged-in user works
      .then(() => console.log("Chat users registered"))
      .catch((e: Error) => console.warn("Chat user registration failed:", e.message));
    await restoreRooms() // groups for the rooms already stored (seeded ones included); never creates a second room
      .then(() => console.log("Stored chat rooms checked"))
      .catch((e: Error) => console.warn("Chat rooms check failed:", e.message));
    await ensureVolunteerHub() // the persistent Volunteer Hub: all volunteers + coordinators
      .then(() => console.log("Volunteer Hub ready"))
      .catch((e: Error) => console.warn("Volunteer Hub set-up failed:", e.message));
  })();
});
