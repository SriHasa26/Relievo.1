import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app";
import { resetRateLimits } from "../src/ratelimit";

// The API runs behind Render's proxy: every request's socket address is the proxy. The rate limiter must use the client IP from
// X-Forwarded-For, otherwise all visitors would share one counter and be limited together.
let server: Server;
let base = "";
beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });
beforeEach(() => resetRateLimits());

const login = (forwardedFor: string) => fetch(`${base}/api/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": forwardedFor },
  body: JSON.stringify({ email: "nobody@example.test", password: "wrong" }),
}).then((r) => r.status);

describe("rate limiter behind a proxy", () => {
  it("counts each client IP separately (X-Forwarded-For), so one noisy visitor does not block the others", async () => {
    let last = 0;
    for (let i = 0; i < 41; i++) last = await login("203.0.113.7");
    expect(last).toBe(429); // the 41st request from the same client is refused (limit 40 per 10 minutes)
    expect(await login("198.51.100.9")).toBe(401); // a different client is untouched (wrong password, not limited)
  });

  it("returns the friendly message with a Retry-After header", async () => {
    for (let i = 0; i < 40; i++) await login("203.0.113.50");
    const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.50" }, body: "{}" });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(((await res.json()) as { error: string }).error).toMatch(/Please wait/);
  });
});
