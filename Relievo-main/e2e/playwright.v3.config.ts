import { defineConfig } from "@playwright/test";

// v3 feature tests (SOS, notifications, priority, dispatch board, citizen chat, Volunteer Hub, evaluator sign-in).
// They run against the MOCK stack (in-memory data, mock chat, keyword AI), so no keys, no AI quota and no real Nexconn/Supabase data are used.
// Chromium gets a fake microphone and pre-granted permissions; window.SpeechRecognition is replaced by a scripted fake in the tests.
export default defineConfig({
  testDir: ".",
  testMatch: /v3\.spec\.ts/,
  workers: 1,
  timeout: 120_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
    permissions: ["microphone", "geolocation"],
    geolocation: { latitude: 17.41, longitude: 78.48 },
    launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
  },
  webServer: {
    command: "npm run dev",
    cwd: "..",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 120_000,
    env: { MOCK_CHAT: "true", MOCK_AI: "true", MOCK_DB: "true", VITE_MOCK_CHAT: "true" },
  },
});
