import { defineConfig } from "@playwright/test";

// Runs against the real Nexconn (MOCK_CHAT=false in backend/.env, VITE_MOCK_CHAT=false in frontend/.env).
// It starts `npm run dev` from the repo root if nothing is listening on :5173 yet.
export default defineConfig({
  testDir: ".",
  testMatch: /(chat|fresh-flow)\.spec\.ts/,
  workers: 1,
  timeout: 360_000,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:5173", headless: true },
  webServer: {
    command: "npm run dev",
    cwd: "..",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
