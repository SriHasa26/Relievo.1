// Basic abuse protection for the public write endpoints. The demo accounts and their password are public, so a stranger
// could otherwise burn the free AI quota or flood Nexconn. Simple fixed-window counters in memory, per IP and per user.
// A friendly 429 message tells the person how long to wait. (One Render instance, so in-memory is enough.)
import type { NextFunction, Response } from "express";
import type { AuthedRequest } from "./auth";

interface Rule { name: string; windowMs: number; perIp: number; perUser: number }

const hits = new Map<string, number[]>(); // "rule|ip:1.2.3.4" or "rule|user:<id>" -> timestamps in the window

/** Returns 0 when allowed, otherwise the number of seconds until the oldest hit leaves the window. */
export function consume(key: string, windowMs: number, max: number, now = Date.now()): number {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return Math.max(1, Math.ceil((recent[0]! + windowMs - now) / 1000));
  }
  recent.push(now);
  hits.set(key, recent);
  return 0;
}

export function resetRateLimits() {
  hits.clear();
}

setInterval(() => { // keep memory bounded
  const now = Date.now();
  for (const [k, v] of hits) if (v.every((t) => now - t > 3_600_000)) hits.delete(k);
}, 600_000).unref();

export const rateLimit = (rule: Rule) => (req: AuthedRequest, res: Response, next: NextFunction) => {
  const ip = req.ip ?? "unknown";
  const waits = [consume(`${rule.name}|ip:${ip}`, rule.windowMs, rule.perIp)];
  if (req.user) waits.push(consume(`${rule.name}|user:${req.user.id}`, rule.windowMs, rule.perUser));
  const wait = Math.max(...waits);
  if (wait > 0) {
    res.setHeader("Retry-After", String(wait));
    return void res.status(429).json({
      error: `You are doing that very often. Please wait ${wait < 90 ? `${wait} seconds` : `${Math.ceil(wait / 60)} minutes`} and try again. This limit protects the demo's shared AI and chat quota.`,
      retry_after_seconds: wait,
    });
  }
  next();
};

/** Limits per rule. Generous for real use, tight enough to stop a script. */
export const LIMITS = {
  submit: { name: "submit", windowMs: 10 * 60_000, perIp: 20, perUser: 8 },
  sos: { name: "sos", windowMs: 10 * 60_000, perIp: 12, perUser: 5 },
  sosAudio: { name: "sos-audio", windowMs: 10 * 60_000, perIp: 20, perUser: 8 },
  chatToken: { name: "chat-token", windowMs: 10 * 60_000, perIp: 80, perUser: 30 },
  login: { name: "login", windowMs: 10 * 60_000, perIp: 40, perUser: 40 },
} satisfies Record<string, Rule>;
