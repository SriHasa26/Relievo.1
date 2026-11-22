import { defineConfig } from "vitest/config";

// Unit tests must never reach real Nexconn, Gemini or Supabase, whatever backend/.env says.
export default defineConfig({
  test: { env: { MOCK_CHAT: "true", MOCK_AI: "true", MOCK_DB: "true" } },
});
