// The whole demo path with NEW data and separate browser contexts:
// citizen submits -> coordinator verifies -> matching recommends -> coordinator approves -> volunteer accepts ->
// a real Nexconn room exists -> both chat -> coordinator allocates a resource and resolves -> timeline + impact show it.
// Run with the real flags (MOCK_CHAT=false, VITE_MOCK_CHAT=false; MOCK_DB=false and MOCK_AI=false when Supabase/OpenRouter are set up).
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";

const SHOTS = "screenshots";
const stamp = `fresh${Date.now().toString(36)}`;
const REPORT = `No drinking water for 5 people in our lane since this morning, an elderly neighbour is also weak (${stamp})`;

let citizenCtx: BrowserContext, coordCtx: BrowserContext, volCtx: BrowserContext;
let citizen: Page, coord: Page, vol: Page;
let incidentId = "";
let volunteerName = "";
let eventsBefore = 0, unitsBefore = 0;

const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
async function login(page: Page, name: RegExp, home: RegExp) {
  // Alerts and the coordinator summary are part of the product (v3); these older tests are not about them, so dismiss them when they block a click.
  await page.addLocatorHandler(page.getByRole("alertdialog"), async () => {
    for (let i = 0; i < 12 && (await page.getByRole("alertdialog").count()) > 0; i++) {
      await page.getByRole("alertdialog").getByRole("button", { name: "Dismiss", exact: true }).click();
      await page.waitForTimeout(150);
    }
  });
  await page.addLocatorHandler(page.getByRole("dialog", { name: "While you were away" }), async () => {
    await page.getByRole("dialog", { name: "While you were away" }).getByRole("button", { name: "Close" }).click();
  });
  await page.goto("/login");
  await page.getByRole("button", { name }).click();
  await page.waitForURL(home);
}
const tile = async (page: Page, title: string) =>
  Number(await page.getByText(title, { exact: true }).locator("xpath=following-sibling::p[1]").innerText());
const connected = (page: Page) => expect(page.getByText("Chat: connected").first()).toBeVisible({ timeout: 60_000 });
async function send(page: Page, text: string) {
  await page.getByLabel("Message").first().fill(text);
  await page.getByRole("button", { name: "Send" }).first().click();
  await expect(page.getByText(text)).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const health = await (await fetch("http://localhost:4000/api/health")).json() as { mockChat: boolean; mockDb: boolean; mockAi: boolean };
  expect(health.mockChat, "the backend must run with MOCK_CHAT=false").toBe(false);
  console.log(`flags: MOCK_DB=${health.mockDb} MOCK_AI=${health.mockAi} MOCK_CHAT=${health.mockChat}`);
  citizenCtx = await browser.newContext();
  coordCtx = await browser.newContext();
  volCtx = await browser.newContext();
  [citizen, coord, vol] = [await citizenCtx.newPage(), await coordCtx.newPage(), await volCtx.newPage()];
  await login(coord, /^Coordinator Priya/, /coordinator/);
  await coord.goto("/impact");
  eventsBefore = await tile(coord, "Events recorded");
  unitsBefore = await tile(coord, "Resources allocated");
});
test.afterAll(async () => { await citizenCtx?.close(); await coordCtx?.close(); await volCtx?.close(); });

test("F1 citizen submits a new report", async () => {
  await login(citizen, /^Asha Rao/, /citizen/);
  await citizen.goto("/citizen/new");
  await citizen.getByPlaceholder(/Water is entering/).fill(REPORT);
  await citizen.getByLabel("Number of people affected").fill("5");
  await citizen.getByLabel("Pick a known place").selectOption("Old Bazaar Road");
  await citizen.getByRole("button", { name: "Send request" }).click();
  await citizen.waitForURL(/\/incidents\/[0-9a-f-]{36}/, { timeout: 60_000 }); // AI extraction happens during submit
  incidentId = citizen.url().split("/").pop()!;
  await expect(citizen.getByText(stamp).first()).toBeVisible();
  await shot(citizen, "F1-citizen-submitted");
});

test("F2 coordinator sees report beside AI output (with provider label) and verifies", async () => {
  await coord.goto(`/incidents/${incidentId}`);
  await expect(coord.getByText(stamp).first()).toBeVisible();
  await expect(coord.getByText("AI suggestion")).toBeVisible();
  await expect(coord.getByText(/AI via OpenRouter|AI via Gemini|Fallback|Mock AI/).first()).toBeVisible();
  await expect(coord.getByText("needs human verification").first()).toBeVisible();
  console.log("AI label:", await coord.getByText(/AI via OpenRouter|AI via Gemini|Fallback|Mock AI/).first().innerText());
  await shot(coord, "F2-coordinator-review");
  await coord.getByRole("button", { name: "Verify incident" }).click();
  await expect(coord.getByText("Responder dispatch")).toBeVisible({ timeout: 30_000 });
});

test("F3 matching recommends; coordinator approves the top volunteer", async () => {
  await expect(coord.getByText(/S = \d/).first()).toBeVisible({ timeout: 30_000 });
  const firstCard = coord.locator("div.rounded.border", { has: coord.getByRole("button", { name: "Approve assignment" }) }).first();
  volunteerName = (await firstCard.locator("span.font-medium").first().innerText()).trim();
  console.log("top recommendation:", volunteerName);
  await shot(coord, "F3-matching");
  await coord.getByRole("button", { name: "Approve assignment" }).first().click();
  await expect(coord.getByText("waiting for volunteer to accept")).toBeVisible({ timeout: 60_000 });
  await shot(coord, "F3-approved");
});

test("F4 volunteer accepts and a real room exists", async () => {
  await login(vol, new RegExp(`^${volunteerName}`), /volunteer/);
  const accept = vol.locator(`xpath=//p[contains(., '${stamp}')]/following-sibling::div//button[normalize-space()='Accept']`);
  await expect(accept).toBeVisible({ timeout: 30_000 });
  await accept.click();
  await expect(accept).toHaveCount(0, { timeout: 30_000 });
  await coord.reload();
  await expect(coord.getByText("Incident chat room created")).toBeVisible({ timeout: 30_000 });
  await shot(vol, "F4-volunteer-accepted");
});

test("F5 both exchange messages in the new room", async () => {
  await vol.goto(`/incidents/${incidentId}`);
  await coord.goto(`/incidents/${incidentId}`);
  await connected(vol);
  await connected(coord);
  const a = `fresh room coord->vol ${stamp}`, b = `fresh room vol->coord ${stamp}`;
  await send(coord, a);
  await expect(vol.getByText(a)).toBeVisible({ timeout: 30_000 });
  await send(vol, b);
  await expect(coord.getByText(b)).toBeVisible({ timeout: 30_000 });
  await shot(coord, "F5-room-coordinator");
  await shot(vol, "F5-room-volunteer");
});

test("F6 coordinator allocates a resource and resolves", async () => {
  await coord.goto("/resources");
  await coord.getByLabel("Allocate to incident").selectOption(incidentId);
  const card = coord.locator("div.rounded-lg", { hasText: "fits this incident" }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole("spinbutton").fill("5");
  await card.getByRole("button", { name: "Allocate" }).click();
  await expect(coord.getByRole("status")).toContainText("Allocated 5");
  await shot(coord, "F6-allocated");
  await coord.goto(`/incidents/${incidentId}`);
  await coord.getByRole("button", { name: "Mark resolved" }).click();
  await expect(coord.getByText("Marked resolved")).toBeVisible({ timeout: 30_000 });
});

test("F7 timeline and impact pages show the new events", async () => {
  await coord.goto(`/incidents/${incidentId}`);
  for (const text of [
    "Request submitted", "AI analysis completed", "Verified by coordinator", "Volunteer assigned",
    "Incident chat room created", "Volunteer accepted", "Relief resource allocated", "Marked resolved",
  ]) await expect(coord.getByText(text).first(), `timeline: ${text}`).toBeVisible();
  await shot(coord, "F7-timeline");
  await coord.goto("/impact");
  await expect.poll(() => tile(coord, "Events recorded")).toBeGreaterThanOrEqual(eventsBefore + 8);
  await expect.poll(() => tile(coord, "Resources allocated")).toBe(unitsBefore + 5);
  await shot(coord, "F7-impact");
});
