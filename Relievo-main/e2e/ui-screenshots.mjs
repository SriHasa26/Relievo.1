// Screenshots of the landing page (every section) and each role's main screens, in light and dark, at 1440 and 390 px,
// into docs/ui-screenshots/ (JPEG, synthetic data only).
// Needs the app running against MOCK data:  MOCK_CHAT=true MOCK_AI=true MOCK_DB=true VITE_MOCK_CHAT=true npm run dev
// Run (from the repo root):  node e2e/ui-screenshots.mjs
import { chromium } from "@playwright/test";
import fs from "node:fs";

const OUT = process.env.OUT ?? "docs/ui-screenshots";
const BASE = process.env.BASE_URL ?? "http://localhost:5173";
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const jpg = { type: "jpeg", quality: 78 };

/** Alerts and the coordinator summary are part of the product; dismiss them when they block a click (the alert itself is captured separately). */
async function dismissPopups(page) {
  await page.addLocatorHandler(page.getByRole("alertdialog"), async () => {
    for (let i = 0; i < 12 && (await page.getByRole("alertdialog").count()) > 0; i++) {
      await page.getByRole("alertdialog").getByRole("button", { name: "Dismiss", exact: true }).click();
      await page.waitForTimeout(150);
    }
  });
  await page.addLocatorHandler(page.getByRole("dialog", { name: "While you were away" }), async () => {
    await page.getByRole("dialog", { name: "While you were away" }).getByRole("button", { name: "Close" }).click();
  });
}
async function login(page, name) {
  await dismissPopups(page);
  await page.goto(`${BASE}/login`);
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await page.waitForURL((u) => !u.pathname.includes("login"));
}

for (const theme of ["dark", "light"]) {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const tag = `${theme}-${w}`;
    if (process.env.ONLY && !process.env.ONLY.split(",").includes(tag)) continue; // e.g. ONLY=light-390 re-takes just that set
    const snap = async (page, name) => {
      await page.waitForTimeout(900);
      for (let i = 0; i < 10; i++) { // popups are part of the product but would cover the screen being documented
        const alert = page.getByRole("alertdialog"), summary = page.getByRole("dialog", { name: "While you were away" });
        if (await alert.count()) await alert.getByRole("button", { name: "Dismiss", exact: true }).click({ timeout: 2000 }).catch(() => undefined);
        else if (await summary.count()) await summary.getByRole("button", { name: "Close" }).click({ timeout: 2000 }).catch(() => undefined);
        else break;
        await page.waitForTimeout(250);
      }
      await page.screenshot({ path: `${OUT}/${tag}-${name}.jpg`, fullPage: true, ...jpg });
      console.log("shot", `${tag}-${name}`);
    };
    const ctx = async (reduced) => {
      const c = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: reduced ? "reduce" : "no-preference", permissions: ["microphone", "geolocation"], geolocation: { latitude: 17.41, longitude: 78.48 } });
      await c.addInitScript((t) => { try { localStorage.setItem("rr-theme", t); } catch { /* ignore */ } }, theme);
      return c;
    };

    // ---- landing (motion on, so the 3D workflow is the real scroll-driven scene on desktop) ----
    let c = await ctx(false), p = await c.newPage();
    p.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
    await p.goto(`${BASE}/login`);
    await p.waitForTimeout(1600);
    await p.screenshot({ path: `${OUT}/${tag}-landing-1-hero.jpg`, ...jpg });
    for (const [id, name] of [["capabilities", "2-capabilities"], ["rooms", "4-rooms"], ["signin", "5-signin"]]) {
      await p.locator(`#${id}`).scrollIntoViewIfNeeded();
      await p.waitForTimeout(1500);
      await p.locator(`#${id}`).screenshot({ path: `${OUT}/${tag}-landing-${name}.jpg`, ...jpg });
    }
    const top = await p.locator("#workflow").evaluate((e) => e.getBoundingClientRect().top + scrollY);
    if (w >= 768) {
      for (const [k, name] of [[0.12, "3a-workflow"], [0.5, "3b-workflow"], [0.88, "3c-workflow"]]) {
        await p.evaluate(([t, k]) => scrollTo(0, t + k * (document.querySelector("#workflow").offsetHeight - innerHeight)), [top, k]);
        await p.waitForTimeout(1600);
        await p.screenshot({ path: `${OUT}/${tag}-landing-${name}.jpg`, ...jpg });
      }
    } else {
      await p.locator("#workflow").scrollIntoViewIfNeeded();
      await p.waitForTimeout(1500);
      await p.locator("#workflow").screenshot({ path: `${OUT}/${tag}-landing-3-workflow.jpg`, ...jpg });
    }
    await p.locator("footer").scrollIntoViewIfNeeded();
    await p.locator("footer").screenshot({ path: `${OUT}/${tag}-landing-6-footer.jpg`, ...jpg });
    await c.close();

    // ---- citizen ----
    c = await ctx(true); p = await c.newPage();
    await login(p, "Asha Rao");
    await p.getByRole("heading", { name: "My requests" }).waitFor();
    await snap(p, "citizen-1-requests"); // includes the big EMERGENCY SOS button
    await p.goto(`${BASE}/citizen/new`);
    await p.getByPlaceholder(/Water is entering/).fill("Water is entering our ground floor. Six people need drinking water.");
    await p.getByLabel("Number of people affected").fill("6");
    await p.getByLabel("Pick a known place").selectOption("Riverside Colony");
    await snap(p, "citizen-2-new-request");
    await p.goto(`${BASE}/citizen`);
    await p.goto(`${BASE}/citizen`);
    await p.getByTestId("sos-button").first().click();
    await p.getByTestId("sos-screen").waitFor();
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `${OUT}/${tag}-citizen-4-sos.jpg`, ...jpg });
    console.log("shot", `${tag}-citizen-4-sos`);
    await p.getByRole("button", { name: "I am safe / cancel SOS" }).first().click();
    await p.getByRole("button", { name: "Close" }).last().click();
    const mine = await p.locator('a[href^="/incidents/"]').first().getAttribute("href");
    if (mine) { await p.goto(`${BASE}${mine}`); await snap(p, "citizen-3-incident"); }
    await c.close();

    // ---- coordinator ----
    c = await ctx(true); p = await c.newPage();
    await login(p, "Coordinator Priya");
    await p.getByRole("alertdialog").waitFor({ timeout: 8000 }).catch(() => undefined);
    if (await p.getByRole("alertdialog").count()) { await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/${tag}-coord-0-red-alert.jpg`, ...jpg }); console.log("shot", `${tag}-coord-0-red-alert`); }
    await p.getByRole("button", { name: /Everything/ }).click();
    await snap(p, "coord-1-command-centre");
    const hrefs = await p.locator('a[href^="/incidents/"]').evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    const seen = new Set();
    for (const href of hrefs) {
      await p.goto(`${BASE}${href}`);
      await p.waitForTimeout(500);
      const feature =
        (await p.getByRole("button", { name: "Verify incident" }).count()) ? "coord-2-verify"
          : (await p.getByRole("button", { name: "Approve assignment" }).count()) ? "coord-3-matching"
            : (await p.getByLabel("Message").count()) ? "coord-4-incident-chat" : null;
      if (feature && !seen.has(feature)) { seen.add(feature); await snap(p, feature); }
    }
    for (const [path, name] of [["/dispatch", "coord-9-dispatch-board"], ["/hub", "coord-10-volunteer-hub"], ["/impact", "coord-5-impact"], ["/resources", "coord-6-resources"], ["/messages", "coord-7-messages"]]) {
      await p.goto(`${BASE}${path}`);
      await snap(p, name);
    }
    await p.goto(`${BASE}/coordinator`);
    await p.getByRole("switch", { name: "Large text" }).click();
    await snap(p, "coord-8-large-text");
    await c.close();

    // ---- volunteer ----
    c = await ctx(true); p = await c.newPage();
    await login(p, "Sana Khan");
    await snap(p, "vol-1-assignments");
    const v = await p.locator('a[href^="/incidents/"]').first().getAttribute("href").catch(() => null);
    if (v) { await p.goto(`${BASE}${v}`); await snap(p, "vol-2-incident"); }
    await c.close();
  }
}
await browser.close();
