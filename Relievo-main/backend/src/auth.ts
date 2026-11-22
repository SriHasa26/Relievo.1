// Who is calling? Every API request except /health and /auth/* goes through requireAuth.
//   MOCK_DB=true : seeded accounts sign in with email + password and get an opaque session token (in memory).
//   MOCK_DB=false: the frontend signs in with Supabase Auth; the backend VERIFIES that JWT on every request with
//                  Supabase, then loads the role from the users table. The role never comes from the token or the client.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config";
import { getRepo } from "./store/repo";
import { createServiceClient } from "./store/supabaseRepo";
import type { Role, User } from "./types";

export type PublicUser = Omit<User, "password">;
export const toPublic = ({ password: _p, ...rest }: User): PublicUser => rest;

// ---- mock sessions ----
const sessions = new Map<string, string>(); // token -> user id

export async function login(email: string, password: string): Promise<{ token: string; user: PublicUser } | null> {
  const repo = await getRepo();
  if (config.mockDb) {
    const user = await repo.userByEmail(email);
    if (!user || user.password !== password) return null;
    const token = randomUUID();
    sessions.set(token, user.id);
    return { token, user: toPublic(user) };
  }
  // Supabase: the browser normally signs in itself. This server-side sign-in exists for scripts (the smoke test) and is
  // available only while DEMO_LOGIN=true. It returns the Supabase access token, which requireAuth verifies like any other.
  if (!config.demoLogin || !config.supabaseUrl || !config.supabaseAnonKey) return null;
  const anon = createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session) return null;
  const user = await repo.userById(data.user.id);
  return user ? { token: data.session.access_token, user: toPublic(user) } : null;
}

// ---- Supabase JWT verification (cached for a minute so each request does not call Supabase Auth) ----
let authClient: ReturnType<typeof createServiceClient> | null = null;
const verified = new Map<string, { userId: string; until: number }>();

async function userIdFromJwt(token: string): Promise<string | null> {
  const hit = verified.get(token);
  if (hit && hit.until > Date.now()) return hit.userId;
  authClient ??= createServiceClient();
  const { data, error } = await authClient.auth.getUser(token); // Supabase checks signature and expiry
  if (error || !data.user) return null;
  verified.set(token, { userId: data.user.id, until: Date.now() + 60_000 });
  return data.user.id;
}

async function userFromToken(token: string): Promise<User | null> {
  const userId = config.mockDb ? sessions.get(token) ?? null : await userIdFromJwt(token);
  return userId ? (await (await getRepo()).userById(userId)) : null;
}

export interface AuthedRequest extends Request {
  user?: User;
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    const user = token ? await userFromToken(token) : null;
    if (!user) return void res.status(401).json({ error: "Not signed in" });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export const requireRole = (...roles: Role[]) => (req: AuthedRequest, res: Response, next: NextFunction) => {
  if (!req.user || !roles.includes(req.user.role)) return void res.status(403).json({ error: "Not allowed for your role" });
  next();
};
