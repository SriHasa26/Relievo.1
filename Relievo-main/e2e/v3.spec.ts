// v3 feature tests. One browser context with several pages: each tab keeps its own login (sessionStorage) and mock chat
// travels between tabs of one browser through a BroadcastChannel.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

let ctx: BrowserContext;

/** Popups (red alerts, the coordinator summary) are part of the product. Tests that are not about them let Playwright dismiss them when they block a click. */
async function login(page: Page, name: RegExp, opts: { autoDismiss?: boolean } = {}) {
  if (opts.autoDismiss) {
    await page.addLocatorHandler(page.getByRole("alertdialog"), async () => {
      // alerts are queued: dismiss until none is left
      for (let i = 0; i < 12 && (await page.getByRole("alertdialog").count()) > 0; i++) {
        await page.getByRole("alertdialog").getByRole("button", { name: "Dismiss", exact: true }).click();
        await page.waitForTimeout(150);
      }
    });
    await page.addLocatorHandler(page.getByRole("dialog", { name: "While you were away" }), async () => {
      await page.getByRole("dialog", { name: "While you were away" }).getByRole("button", { name: "Close" }).click();
    });
  }
  await page.goto("/login");
  await page.getByRole("button", { name }).click();
  await page.waitForURL((u) => !u.pathname.includes("login"));
}
/** The chat card whose title is `title` (several chat panels can be on one page). */
const panel = (page: Page, title: RegExp) => page.getByRole("heading", { name: title, level: 3 }).locator('xpath=ancestor::div[contains(concat(" ",normalize-space(@class)," ")," rr-card ")][1]');
async function say(page: Page, title: RegExp, text: string) {
  const p = panel(page, title);
  await expect(p.getByText("Chat: connected")).toBeVisible({ timeout: 30_000 });
  await p.getByLabel("Message").fill(text);
  await p.getByRole("button", { name: "Send" }).click();
  await expect(p.getByText(text)).toBeVisible();
}
const newPage = async () => ctx.newPage();

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext({
    permissions: ["microphone", "geolocation"], geolocation: { latitude: 17.41, longitude: 78.48 },
  });
  // A scripted fake of the Web Speech API: says "water is rising help us" a moment after start().
  await ctx.addInitScript(() => {
    class FakeSR {
      lang = ""; continuous = false; interimResults = false;
      onresult: ((e: unknown) => void) | null = null; onerror: ((e: unknown) => void) | null = null; onend: (() => void) | null = null;
      timers: number[] = [];
      start() {
        this.timers.push(window.setTimeout(() => this.onresult?.({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: "water is" } }] }), 300));
        this.timers.push(window.setTimeout(() => this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "water is rising help us" } }] }), 800));
      }
      stop() { this.timers.forEach(clearTimeout); window.setTimeout(() => this.onend?.(), 30); }
      abort() { this.stop(); }
    }
    (window as unknown as Record<string, unknown>).SpeechRecognition = FakeSR;
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeSR;
  });
});
test.afterAll(async () => { await ctx?.close(); });

test("SOS: Critical incident reaches the coordinator within ~10 s, audio is attached and plays", async () => {
  const coord = await newPage();
  await login(coord, /^Coordinator Priya/);
  const citizen = await newPage();
  await login(citizen, /^Asha Rao/);

  await citizen.getByTestId("sos-button").first().click();
  await expect(citizen.getByTestId("sos-screen")).toBeVisible();
  await expect(citizen.getByText("We are alerting responders").first()).toBeVisible();
  await expect(citizen.getByTestId("sos-screen").getByText(/112 in India/)).toBeVisible();
  await expect(citizen.getByTestId("sos-transcript")).toContainText("water is rising help us", { timeout: 15_000 });

  // the coordinator gets the red popup for the SOS itself (poll is every 5 s)
  await expect(coord.getByRole("alertdialog")).toContainText("EMERGENCY SOS", { timeout: 12_000 });
  await coord.getByRole("alertdialog").getByRole("button", { name: "Dismiss", exact: true }).click();

  await citizen.getByRole("button", { name: "Stop recording" }).click();
  await expect(citizen.getByText("Responders have your message.")).toBeVisible({ timeout: 20_000 });

  // a second alert says the audio is available, with a player that does not autoplay
  const dialog = coord.getByRole("alertdialog");
  await expect(dialog).toContainText("audio available", { timeout: 12_000 });
  await expect(dialog).toContainText("water is rising help us");
  await dialog.getByRole("button", { name: "Play SOS audio" }).click();
  const audio = dialog.locator("audio");
  await expect(audio).toBeVisible();
  expect(await audio.evaluate((a: HTMLAudioElement) => a.paused)).toBe(true); // never autoplays
  expect(await audio.evaluate((a: HTMLAudioElement) => a.src.startsWith("blob:"))).toBe(true);
  await dialog.getByRole("button", { name: "Dismiss", exact: true }).click();

  // one active SOS per citizen: a second tap resumes the same one
  await citizen.getByRole("button", { name: "Close SOS screen" }).click();
  await citizen.getByTestId("sos-button").first().click();
  await expect(citizen.getByText(/already have an active SOS/)).toBeVisible();
  await citizen.getByRole("button", { name: "I am safe / cancel SOS" }).first().click();
  await expect(citizen.getByText("Marked safe.")).toBeVisible();
  await coord.close(); await citizen.close();
});

test("evaluator access: all four roles sign in from the panel without any prior login", async () => {
  for (const [role, home] of [["citizen", "/citizen"], ["volunteer", "/volunteer"], ["coordinator", "/coordinator"], ["ngo", "/resources"]] as const) {
    const page = await newPage();
    await page.goto("/login");
    await expect(page.locator("#evaluator")).toContainText("Synthetic demo accounts");
    await expect(page.locator("#evaluator").getByRole("button", { name: /^Copy .*login$/ }).first()).toBeVisible();
    await page.locator("#evaluator").getByRole("button", { name: `Sign in as ${role}` }).click();
    await page.waitForURL((u) => u.pathname === home);
    await page.close();
  }
});

test("queue is ordered by priority (SOS and Critical on top) and can be filtered by priority", async () => {
  const coord = await newPage();
  await login(coord, /^Coordinator Priya/, { autoDismiss: true });
  await coord.getByRole("button", { name: /Everything/ }).click();
  const rows = coord.locator('a[href^="/incidents/"]');
  await expect(rows.first()).toContainText("critical");
  await expect(rows.nth(1)).toContainText("critical");
  await coord.getByLabel("Filter by priority").selectOption("high");
  const high = await rows.allInnerTexts();
  expect(high.length).toBeGreaterThan(0);
  for (const t of high) expect(t).toMatch(/\bhigh\b/);
  await coord.close();
});

test("dispatch board -> volunteer accepts from the notification -> citizen and volunteer chat both ways", async () => {
  const coord = await newPage();
  await login(coord, /^Coordinator Priya/, { autoDismiss: true });
  await coord.goto("/dispatch");
  const food = coord.locator("section", { hasText: "Our family of 4" });
  await expect(food).toContainText("Suggested:");
  const volunteerName = /Suggested: ([A-Z][a-z]+ [A-Z][a-z]+)/.exec(await food.innerText())![1]!;
  await coord.getByRole("button", { name: /Approve all suggested/ }).click();
  await coord.getByRole("button", { name: "Confirm and approve" }).click();
  await expect(coord.getByText(/assignments? approved/)).toBeVisible();
  await expect(coord.locator("section", { hasText: "Our family of 4" })).toHaveCount(0); // gone from the board

  // the volunteer: bell badge, then Accept from the notification panel
  const vol = await newPage();
  await login(vol, new RegExp(`^${volunteerName}`), { autoDismiss: true });
  const bell = vol.getByRole("button", { name: /^Notifications, [1-9]\d* unread/ });
  await expect(bell).toBeVisible({ timeout: 15_000 });
  await bell.click();
  await vol.getByRole("dialog", { name: "Notification centre" }).getByRole("button", { name: "Accept", exact: true }).first().click();
  await expect(vol.getByText("Assignment accepted")).toBeVisible();

  // the citizen who reported it: waiting state is gone, the chat is there
  const citizen = await newPage();
  await login(citizen, /^Meena Iyer/, { autoDismiss: true });
  await citizen.locator('a[href^="/incidents/"]').filter({ hasText: "Our family of 4" }).click();
  await expect(citizen.getByRole("heading", { name: "Chat with your volunteer" })).toBeVisible({ timeout: 15_000 });
  const incidentPath = new URL(citizen.url()).pathname;
  await vol.goto(incidentPath);
  await say(vol, /Chat with the citizen/, "Water and food are on the way, 20 minutes");
  await expect(panel(citizen, /Chat with your volunteer/).getByText("Water and food are on the way, 20 minutes")).toBeVisible({ timeout: 15_000 });
  await say(citizen, /Chat with your volunteer/, "Thank you, we are at the first floor");
  await expect(panel(vol, /Chat with the citizen/).getByText("Thank you, we are at the first floor")).toBeVisible({ timeout: 15_000 });
  // the citizen cannot see the operations room
  await expect(citizen.getByText("Incident room")).toHaveCount(0);
  await coord.close(); await vol.close(); await citizen.close();
});

test("Volunteer Hub: a coordinator broadcast reaches a volunteer, with an unread badge", async () => {
  const vol = await newPage();
  await login(vol, /^Sana Khan/, { autoDismiss: true });
  const coord = await newPage();
  await login(coord, /^Coordinator Priya/, { autoDismiss: true });
  await coord.getByRole("link", { name: /Volunteer Hub/ }).click();
  await say(coord, /^Volunteer Hub/, "Hub broadcast: shelter kits arrive at 5 pm");
  // the volunteer is on another page: the Hub link shows an unread count
  await expect(vol.getByLabel(/unread Hub chats/)).toBeVisible({ timeout: 15_000 });
  await vol.getByRole("link", { name: /Volunteer Hub/ }).click();
  await expect(vol.getByText("Hub broadcast: shelter kits arrive at 5 pm")).toBeVisible({ timeout: 15_000 });
  await coord.close(); await vol.close();
});
