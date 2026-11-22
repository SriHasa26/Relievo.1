// End-to-end check of the real-Nexconn chat with two (and then three) separate browser contexts.
// Seeded data (synthetic): incident 106 has a real room, coordinator Priya and volunteer Karthik are on it.
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";

const INCIDENT = "00000000-0000-4000-8000-000000000106";
const SHOTS = "screenshots";
const stamp = Date.now().toString(36);
const msg = (label: string) => `e2e ${label} ${stamp}`;

let browser: Browser;
let coordCtx: BrowserContext, volCtx: BrowserContext;
let coord: Page, vol: Page;

async function login(page: Page, name: RegExp) {
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
  await expect(page.getByRole("heading", { name: "Demo role switcher" })).toHaveCount(0);
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const connected = (page: Page) => expect(page.getByText("Chat: connected").first()).toBeVisible({ timeout: 60_000 });
async function send(page: Page, text: string) {
  await page.getByLabel("Message").first().fill(text);
  await page.getByRole("button", { name: "Send" }).first().click();
  await expect(page.getByText(text)).toBeVisible();
}
const apiStatus = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    // Mock sessions keep the token under "rr-token"; Supabase keeps it in its own "sb-...-auth-token" entry.
    const key = Object.keys(sessionStorage).find((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
    const token = key ? (JSON.parse(sessionStorage.getItem(key)!) as { access_token: string }).access_token : sessionStorage.getItem("rr-token");
    const res = await fetch(p, { headers: { Authorization: `Bearer ${token}` } });
    return res.status;
  }, path);

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser: b }) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  browser = b;
  // The backend answers only after the seeded rooms exist in Nexconn.
  await expect.poll(async () => {
    try { return (await (await fetch("http://localhost:4000/api/health")).json() as { mockChat: boolean }).mockChat; }
    catch { return "down"; }
  }, { timeout: 90_000, message: "backend must be up with MOCK_CHAT=false" }).toBe(false);

  coordCtx = await browser.newContext();
  volCtx = await browser.newContext();
  coord = await coordCtx.newPage();
  vol = await volCtx.newPage();
  await login(coord, /^Coordinator Priya/);
  await login(vol, /^Karthik Reddy/);
  await coord.goto(`/incidents/${INCIDENT}`);
  await vol.goto(`/incidents/${INCIDENT}`);
  await connected(coord);
  await connected(vol);
});

test.afterAll(async () => { await coordCtx?.close(); await volCtx?.close(); });

test("1 incident room: live delivery both ways", async () => {
  await send(coord, msg("room coord->vol"));
  await expect(vol.getByText(msg("room coord->vol"))).toBeVisible({ timeout: 30_000 });
  await send(vol, msg("room vol->coord"));
  await expect(coord.getByText(msg("room vol->coord"))).toBeVisible({ timeout: 30_000 });
  await shot(coord, "01-room-coordinator");
  await shot(vol, "01-room-volunteer");
});

test("2 history survives a reload", async () => {
  await coord.reload();
  await vol.reload();
  await connected(coord);
  await connected(vol);
  for (const page of [coord, vol]) {
    await expect(page.getByText(msg("room coord->vol"))).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(msg("room vol->coord"))).toBeVisible();
  }
  await shot(coord, "02-history-coordinator");
  await shot(vol, "02-history-volunteer");
});

test("3 direct messages both ways", async () => {
  await coord.goto("/messages");
  await vol.goto("/messages");
  await coord.getByRole("button", { name: "Karthik Reddy" }).click();
  await connected(coord);
  await connected(vol);
  await send(coord, msg("dm coord->vol"));
  await expect(vol.getByText(msg("dm coord->vol"))).toBeVisible({ timeout: 30_000 });
  await send(vol, msg("dm vol->coord"));
  await expect(coord.getByText(msg("dm vol->coord"))).toBeVisible({ timeout: 30_000 });
  await shot(coord, "03-dm-coordinator");
  await shot(vol, "03-dm-volunteer");
});

test("4 offline: disconnected state, retry, messages flow again", async () => {
  // Messages page (direct chat). The incident page is not used here: it replaces itself with a
  // "Failed to fetch" error while offline, which hides the chat panel (reported separately).
  await coord.goto("/messages");
  await vol.goto("/messages");
  await coord.getByRole("button", { name: "Karthik Reddy" }).click();
  await connected(coord);
  await connected(vol);

  await volCtx.setOffline(true);
  // The SDK notices a dead connection by heartbeat, about 50 s after the network drops.
  await expect(vol.getByText(/Chat: (disconnected|connecting)/).first()).toBeVisible({ timeout: 120_000 });
  await shot(vol, "04-offline-state");

  // A send while offline must fail visibly and offer Retry.
  await vol.getByLabel("Message").first().fill(msg("offline attempt"));
  await vol.getByRole("button", { name: "Send" }).first().click();
  await expect(vol.getByRole("button", { name: "Retry" }).first()).toBeVisible({ timeout: 30_000 });
  await shot(vol, "04-offline-retry-button");

  await volCtx.setOffline(false);
  await expect(vol.getByText("Chat: connected").first()).toBeVisible({ timeout: 120_000 });
  await vol.getByRole("button", { name: "Retry" }).first().click();
  await connected(vol);

  await send(coord, msg("after online coord->vol"));
  await expect(vol.getByText(msg("after online coord->vol"))).toBeVisible({ timeout: 30_000 });
  await send(vol, msg("after online vol->coord"));
  await expect(coord.getByText(msg("after online vol->coord"))).toBeVisible({ timeout: 30_000 });
  await shot(vol, "04-back-online");
});

test("4b incident page stays mounted offline and shows a banner with retry", async () => {
  await vol.goto(`/incidents/${INCIDENT}`);
  await connected(vol);
  await volCtx.setOffline(true);
  await expect(vol.getByText(/Could not refresh this incident/)).toBeVisible({ timeout: 30_000 });
  await expect(vol.getByLabel("Message").first()).toBeVisible(); // chat panel is still there
  await shot(vol, "04b-incident-offline-banner");
  await volCtx.setOffline(false);
  await vol.getByRole("button", { name: "Retry" }).first().click();
  await expect(vol.getByText(/Could not refresh this incident/)).toHaveCount(0, { timeout: 30_000 });
});

test("5 authorisation: unassigned volunteer and the citizen are refused", async () => {
  const cases: Array<[string, RegExp]> = [["unassigned-volunteer", /^Sana Khan/], ["citizen", /^Meena Iyer/]];
  for (const [label, name] of cases) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, name);
    expect(await apiStatus(page, `/api/incidents/${INCIDENT}/room`), `${label}: API status`).toBe(403);
    await page.goto(`/incidents/${INCIDENT}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByLabel("Message"), `${label}: no chat input in the UI`).toHaveCount(0);
    await expect(page.getByText("Incident room")).toHaveCount(0);
    await shot(page, `05-refused-${label}`);
    await ctx.close();
  }
});
