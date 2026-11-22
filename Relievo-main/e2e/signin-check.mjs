// Sign-in check for any deployment (local or live). Prints PASS/FAIL per role for: the Evaluator access panel,
// the demo role switcher, and the email form. Also simulates a cold start (first /api/health and demo-users calls fail).
//   BASE_URL=https://relievo-omega.vercel.app node e2e/signin-check.mjs      (default http://localhost:5173)
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const ROLES = [["citizen", "Asha Rao", "citizen1"], ["volunteer", "Sana Khan", "volunteer14"], ["coordinator", "Coordinator Priya", "coordinator21"], ["ngo", "Hope Relief Trust", "ngo31"]];
const b = await chromium.launch();
let fails = 0;

async function attempt(label, role, act, { coldStart = false } = {}) {
  const c = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await c.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message.slice(0, 100)));
  if (coldStart) {
    const failed = { h: false, d: false };
    await p.route(/\/api\/health$/, (r) => (failed.h ? r.continue() : ((failed.h = true), r.abort())));
    await p.route(/\/api\/auth\/demo-users$/, (r) => (failed.d ? r.continue() : ((failed.d = true), r.abort())));
  }
  await p.goto(`${BASE}/login`);
  await p.waitForTimeout(coldStart ? 500 : 2500);
  await act(p);
  let ok = false;
  try { await p.waitForURL((u) => !u.pathname.includes("login"), { timeout: 60_000 }); ok = true; } catch { /* stays on landing */ }
  if (!ok) fails++;
  console.log(ok ? "PASS" : "FAIL", label.padEnd(26), role.padEnd(12), ok ? p.url().replace(BASE, "") : (await p.getByRole("alert").allInnerTexts()).join(" ").slice(0, 120), errs.join(" | "));
  await c.close();
}

for (const [role, name, em] of ROLES) {
  await attempt("evaluator panel", role, (p) => p.getByRole("button", { name: `Sign in as ${role}` }).click());
  await attempt("demo role switcher", role, (p) => p.getByRole("button", { name: new RegExp(`^${name}`) }).click());
  await attempt("email + password", role, async (p) => {
    await p.getByLabel("Email").fill(`${em}@demo.reliefrelay.test`);
    await p.getByLabel("Password").fill("demo1234");
    await p.locator("#signin form").getByRole("button", { name: "Sign in" }).click();
  });
}
await attempt("cold start + switcher", "coordinator", (p) => p.getByRole("button", { name: /^Coordinator Priya/ }).click(), { coldStart: true });
await b.close();
console.log(fails === 0 ? "\nAll sign-in checks passed." : `\n${fails} sign-in check(s) failed.`);
process.exit(fails ? 1 : 0);
