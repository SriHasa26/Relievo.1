import cors from "cors";
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { config } from "./config";
import { login, requireAuth, requireRole, toPublic, type AuthedRequest } from "./auth";
import { getRepo } from "./store/repo";
import { LIMITS, rateLimit } from "./ratelimit";
import { listNotifications, markRead } from "./services/notifications";
import { DEMO_PASSWORD } from "./store/seedData";
import {
  assignVolunteer, matchesFor, reassignVolunteer, resolveIncident, respondToAssignment, setAvailability, volunteerProfile,
} from "./services/dispatch";
import { chatContacts, chatToken, citizenRoomAccess, hubAccess, listRooms, roomAccess } from "./services/rooms";
import { approveAll, dispatchBoard, setPriorityOverride } from "./services/board";
import { attachSosAudio, cancelSos, getSosAudio, sosInfo, startSos } from "./services/sos";
import { computeMetrics } from "./services/metrics";
import { allocateResource, listResources } from "./services/resources";
import {
  HttpError, incidentDetail, incidentEvents, listIncidents, submitIncident, verifyIncident,
} from "./services/incidents";

type Handler = (req: AuthedRequest, res: Response) => unknown | Promise<unknown>;
/** Lets handlers throw HttpError (sync or async) and have it turned into a JSON error response. */
const wrap = (fn: Handler): RequestHandler => (req, res, next) => {
  Promise.resolve(fn(req as AuthedRequest, res)).catch(next);
};

const param = (req: Request, name: string) => String(req.params[name]);

export function createApp() {
  const app = express();
  // Behind Render's proxy the socket address is the proxy, so req.ip must come from X-Forwarded-For. TRUST_PROXY = number of proxy hops (default 1).
  app.set("trust proxy", config.trustProxy);
  // CORS: only the deployed frontend (FRONTEND_URL) and, outside production, localhost. Requests without an
  // Origin header (curl, server-to-server, health checks) are not browser requests and are let through.
  const allowed = (origin: string) =>
    config.frontendUrls.includes(origin.replace(/\/+$/, ""))
    || (!config.isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  app.use(cors({ origin: (origin, cb) => cb(null, !origin || allowed(origin)) }));
  // Small bodies everywhere; only the SOS audio upload (base64 clip + transcript) may be larger.
  app.use((req, res, next) => (req.path.endsWith("/sos-audio") ? express.json({ limit: "3mb" }) : express.json())(req, res, next));

  // Liveness + which mock flags are on. No secrets. /health is for Render's health check, /api/health for the frontend.
  const health = (_req: Request, res: Response) => res.json({
    ok: true, status: "ok", mockChat: config.mockChat, mockAi: config.mockAi, mockDb: config.mockDb,
    mockMode: config.mockChat || config.mockAi || config.mockDb,
    ai: { openrouter: Boolean(config.openrouterApiKey), gemini: Boolean(config.geminiApiKey) },
  });
  app.get("/health", health);
  app.get("/api/health", health);

  // ---- auth (mock accounts) ----
  // MOCK_DB: demo sessions. With Supabase the browser signs in with Supabase Auth itself; this is only a scripting helper (DEMO_LOGIN).
  app.post("/api/auth/login", rateLimit(LIMITS.login), wrap(async (req, res) => {
    const result = await login(String(req.body?.email ?? ""), String(req.body?.password ?? ""));
    if (!result) return void res.status(401).json({ error: "Wrong email or password" });
    res.json(result);
  }));

  // Role switcher on the login page: the SYNTHETIC demo accounts and their shared demo password.
  // Turn off with DEMO_LOGIN=false for anything public.
  app.get("/api/auth/demo-users", wrap(async (_req, res) => {
    if (!config.demoLogin) return void res.status(404).json({ error: "Not available" });
    const users = (await (await getRepo()).users()).filter((u) => u.is_synthetic);
    res.json(users.map((u) => ({ ...toPublic(u), password: DEMO_PASSWORD })));
  }));

  app.get("/api/me", requireAuth, (req: AuthedRequest, res) => res.json(toPublic(req.user!)));

  // ---- incidents ----
  app.post("/api/incidents", requireAuth, requireRole("citizen"), rateLimit(LIMITS.submit), wrap(async (req, res) => {
    const b = req.body ?? {};
    const incident = await submitIncident(req.user!, {
      text: String(b.text ?? ""), lat: Number(b.lat), lng: Number(b.lng),
      address_text: b.address_text ? String(b.address_text) : "",
      people_affected: b.people_affected === "" || b.people_affected == null ? null : Number(b.people_affected),
    });
    res.status(201).json(incident);
  }));

  app.get("/api/incidents", requireAuth, wrap(async (req, res) => res.json(await listIncidents(req.user!))));
  app.get("/api/incidents/:id", requireAuth, wrap(async (req, res) => {
    const detail = await incidentDetail(req.user!, param(req, "id"));
    res.json({ ...detail, sos: await sosInfo(req.user!, detail.incident) });
  }));

  // ---- EMERGENCY SOS (the incident is created first; audio and transcript are attached afterwards) ----
  app.post("/api/sos", requireAuth, requireRole("citizen"), rateLimit(LIMITS.sos), wrap(async (req, res) => {
    const b = req.body ?? {};
    const { incident, existing } = await startSos(req.user!, {
      lat: b.lat == null ? undefined : Number(b.lat), lng: b.lng == null ? undefined : Number(b.lng),
      address_text: typeof b.address_text === "string" ? b.address_text : undefined,
    });
    res.status(existing ? 200 : 201).json({ incident, existing });
  }));
  app.post("/api/incidents/:id/sos-audio", requireAuth, requireRole("citizen"), rateLimit(LIMITS.sosAudio), wrap(async (req, res) => {
    res.status(201).json(await attachSosAudio(req.user!, param(req, "id"), req.body ?? {}));
  }));
  app.get("/api/incidents/:id/sos-audio", requireAuth, wrap(async (req, res) => {
    const clip = await getSosAudio(req.user!, param(req, "id"));
    res.setHeader("Cache-Control", "private, no-store");
    res.type(clip.mime).send(clip.buffer);
  }));
  app.post("/api/incidents/:id/sos-cancel", requireAuth, requireRole("citizen"), wrap(async (req, res) => {
    res.json(await cancelSos(req.user!, param(req, "id")));
  }));
  app.get("/api/incidents/:id/events", requireAuth, wrap(async (req, res) => res.json(await incidentEvents(req.user!, param(req, "id")))));

  app.post("/api/incidents/:id/verify", requireAuth, requireRole("coordinator"), wrap(async (req, res) => {
    const b = req.body ?? {};
    if (b.decision !== "verify" && b.decision !== "reject") throw new HttpError(400, "decision must be verify or reject");
    res.json(await verifyIncident(req.user!, param(req, "id"), { decision: b.decision, reason: b.reason, edits: b.edits }));
  }));

  // ---- dispatch (ResponderMatch) ----
  app.get("/api/incidents/:id/matches", requireAuth, requireRole("coordinator"), wrap(async (req, res) => res.json(await matchesFor(param(req, "id")))));

  app.post("/api/incidents/:id/assign", requireAuth, requireRole("coordinator"), wrap(async (req, res) => {
    res.status(201).json(await assignVolunteer(req.user!, param(req, "id"), String(req.body?.volunteerId ?? "")));
  }));

  app.post("/api/assignments/:id/reassign", requireAuth, requireRole("coordinator"), wrap(async (req, res) => {
    res.json(await reassignVolunteer(req.user!, param(req, "id"), String(req.body?.volunteerId ?? "")));
  }));

  app.post("/api/assignments/:id/respond", requireAuth, requireRole("volunteer"), wrap(async (req, res) => {
    res.json(await respondToAssignment(req.user!, param(req, "id"), req.body?.accept === true));
  }));

  app.post("/api/incidents/:id/status", requireAuth, requireRole("coordinator"), wrap(async (req, res) => {
    if (req.body?.status !== "resolved") throw new HttpError(400, "Only status=resolved can be set here");
    res.json(await resolveIncident(req.user!, param(req, "id")));
  }));

  // ---- dispatch board (priority order, greedy volunteer suggestions; every assignment still needs a coordinator) ----
  app.get("/api/dispatch/board", requireAuth, requireRole("coordinator"), wrap(async (_req, res) => res.json(await dispatchBoard())));
  app.post("/api/dispatch/approve-all", requireAuth, requireRole("coordinator"), wrap(async (req, res) => {
    res.json(await approveAll(req.user!, Array.isArray(req.body?.pairs) ? req.body.pairs : []));
  }));
  app.post("/api/incidents/:id/priority", requireAuth, requireRole("coordinator"), wrap(async (req, res) => {
    const level = req.body?.level === null || req.body?.level === "auto" ? null : req.body?.level;
    res.json(await setPriorityOverride(req.user!, param(req, "id"), level));
  }));

  app.get("/api/volunteers/me", requireAuth, requireRole("volunteer"), wrap(async (req, res) => res.json(await volunteerProfile(req.user!.id))));
  app.patch("/api/volunteers/me", requireAuth, requireRole("volunteer"), wrap(async (req, res) => {
    res.json(await setAvailability(req.user!, req.body?.availability));
  }));

  // ---- rooms and chat (Nexconn via the adapter) ----
  // Token is always issued for the signed-in user only.
  app.post("/api/chat/token", requireAuth, rateLimit(LIMITS.chatToken), wrap(async (req, res) => res.json(await chatToken(req.user!))));
  app.get("/api/incidents/:id/room", requireAuth, wrap(async (req, res) => res.json(await roomAccess(req.user!, param(req, "id")))));
  app.get("/api/incidents/:id/citizen-room", requireAuth, wrap(async (req, res) => res.json(await citizenRoomAccess(req.user!, param(req, "id")))));
  app.get("/api/chat/rooms", requireAuth, wrap(async (req, res) => res.json(await listRooms(req.user!))));
  app.get("/api/chat/hub", requireAuth, wrap(async (req, res) => res.json(await hubAccess(req.user!))));
  app.get("/api/chat/contacts", requireAuth, wrap(async (req, res) => res.json(await chatContacts(req.user!))));

  // ---- notifications (the frontend polls this while the tab is visible) ----
  app.get("/api/notifications", requireAuth, wrap(async (req, res) => res.json(await listNotifications(req.user!))));
  app.post("/api/notifications/read", requireAuth, wrap(async (req, res) => {
    await markRead(req.user!, req.body?.all === true ? "all" : req.body?.ids);
    res.json({ ok: true });
  }));

  // ---- resources and impact ----
  app.get("/api/resources", requireAuth, requireRole("coordinator", "ngo"), wrap(async (req, res) => {
    res.json(await listResources(typeof req.query.incident_id === "string" ? req.query.incident_id : undefined));
  }));
  app.post("/api/resources/:id/allocate", requireAuth, requireRole("coordinator"), wrap(async (req, res) => {
    const b = req.body ?? {};
    res.status(201).json(await allocateResource(req.user!, param(req, "id"), String(b.incident_id ?? ""), Number(b.quantity)));
  }));
  app.get("/api/metrics", requireAuth, requireRole("coordinator"), wrap(async (_req, res) => res.json(await computeMetrics())));

  // ---- error handler ----
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  });

  return app;
}
