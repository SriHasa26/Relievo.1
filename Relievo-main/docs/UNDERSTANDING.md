# Relievo: Understanding and Build Plan

Hackathon: Nexconn Build Challenge 2026, Humanitarian & Social Good. Deadline 22 Nov 2026.
Source: `docs/ReliefRelay_Blueprint.pdf` (all pages, including the six-module page). No docs sites were consulted. Every Nexconn call is behind an adapter and marked as a placeholder.

---

## 1. Summary

Relievo is a disaster-response coordination app. A citizen types (or dictates) an emergency request. Gemini turns the free text into structured fields (category, people affected, needs, vulnerable persons, urgency) and the original text stays beside it. A human coordinator verifies or rejects the incident. The system then ranks volunteers with a transparent formula (distance, skills, availability, capacity). Busy or unverified volunteers are never eligible. The coordinator approves an assignment. Approval opens an incident chat room, built on the Nexconn Chat SDK, for the coordinator and the assigned volunteer, plus private coordinator-volunteer direct messages. Every step is written to an `incident_events` table. That table drives the status timeline and an impact dashboard. AI only suggests; a person verifies and approves.

## 2. Happy path (10 steps; **[NX]** = uses Nexconn)

1. Citizen logs in and submits a request: text (optionally voice-to-text), location (map pin or seeded place), people affected, large-text toggle available. Status `Submitted`; event `submitted`.
2. Backend stores the original report and calls Gemini for structured JSON (validated, with a fallback). Event `ai_analyzed`.
3. Coordinator opens the queue and sees the original report next to the AI extraction, the urgency and the missing-info prompts. The coordinator edits fields if needed, then **verifies** (or rejects with a reason). Status `Verified`; event `verified`.
4. Backend computes ranked volunteer matches (deterministic, with a per-component score breakdown). Hard-excluded volunteers are shown greyed with the reason.
5. Coordinator **approves** one volunteer (or reassigns). Status `Assigned`; event `assigned`. **[NX]** In the same backend call: create the incident group (if missing), add the coordinator and the volunteer, post a system message with the incident summary.
6. Volunteer logs in, sees the assignment, accepts. Status `In Progress`; event `accepted`. The volunteer is now `busy`. **[NX]**
7. **[NX]** Volunteer and coordinator exchange messages in the incident room. The client got its token from `POST /api/chat/token`. This is the demo proof point: two separate accounts, real SDK.
8. **[NX]** Coordinator opens a direct message to the volunteer from the incident page (private channel, not the group).
9. (SHOULD) Coordinator allocates a listed resource to the incident. Event `resource_allocated`.
10. Coordinator marks `Resolved`; event `resolved`; the volunteer is freed. Timeline and impact dashboard update from `incident_events`. The citizen sees the final status.

## 3. Actors and roles

| Role | Can see | Can do |
|---|---|---|
| **Citizen** | Only their own requests, status and timeline (no chat access) | Submit request, toggle large text, view status |
| **Volunteer** | Own profile; incidents they are assigned to; those incidents' rooms; DMs with coordinators | Toggle availability, accept/decline, post in room, DM coordinator |
| **Coordinator** | All incidents, AI output, map, matches, volunteers, metrics, all rooms | Verify/reject, approve/reassign, change status, post in rooms, DM volunteers, allocate resources |
| **NGO** | (SHOULD) own organisation's resources | (SHOULD) list resources. NGO portal and NGO rooms are **CUT**. NGO is a seeded role that only owns resource rows. |

## 4. Data model

**Supabase (source of truth)**

| Table | Key fields |
|---|---|
| `profiles` | id (= auth user id), name, role (`citizen`/`volunteer`/`coordinator`/`ngo`), phone, verified, is_synthetic |
| `volunteer_profiles` | user_id, skills text[], qualifications text[] (e.g. `first_aid`, `rescue_certified`), availability (`available`/`busy`/`offline`), capacity (max concurrent, default 1), lat, lng, verified |
| `incidents` | id, reporter_id, original_text, title, category, urgency, people_affected, lat, lng, address_text, status (`submitted`/`verified`/`assigned`/`in_progress`/`resolved`/`rejected`), reject_reason, possible_duplicate_of, is_synthetic, created_at |
| `incident_ai_analysis` | incident_id, extracted_data jsonb, missing_info text[], confidence, model_version, source (`gemini`/`fallback`/`mock`) |
| `assignments` | id, incident_id, volunteer_id, assigned_by, status (`proposed`/`approved`/`accepted`/`declined`/`reassigned`/`completed`), score_breakdown jsonb, timestamps |
| `incident_channels` | incident_id, nexconn_group_id (unique per incident) |
| `incident_events` | id, incident_id, actor_id, action, meta jsonb, created_at. Append-only |
| `resources` (SHOULD) | id, org_name, type, quantity, unit, lat, lng |
| `resource_allocations` (SHOULD) | incident_id, resource_id, quantity, allocated_by |

`organisations` is **dropped**; `org_name` is a plain column on `resources`. `users` is merged into `profiles` (Supabase Auth already owns identity).

**Nexconn (conversation layer only)**: user chat identities and tokens; the group per incident and its member list; message bodies and history; direct (one-to-one) conversations. Nothing operational is stored there. If Nexconn and Supabase disagree, Supabase wins and the backend re-syncs membership.

## 5. MUST scope: backend endpoints and frontend screens

All routes require a Supabase JWT (verified in middleware), except health.

**Backend (Express)**

| Method + path | Who | Purpose |
|---|---|---|
| GET `/api/health` | none | liveness, reports `MOCK_MODE` |
| GET `/api/me` | any | profile and role |
| POST `/api/incidents` | citizen | create, run AI, log events |
| GET `/api/incidents` | role-scoped | list (citizen: own; volunteer: assigned; coordinator: all) |
| GET `/api/incidents/:id` | role-scoped | incident, AI analysis, assignment, channel id |
| POST `/api/incidents/:id/reanalyze` | coordinator | re-run Gemini |
| POST `/api/incidents/:id/verify` | coordinator | `{decision: verify\|reject, edits?, reason?}` |
| GET `/api/incidents/:id/matches` | coordinator | ranked volunteers with breakdown and exclusion reasons |
| POST `/api/incidents/:id/assign` | coordinator | `{volunteerId}`: approve, creates or joins group, system message |
| POST `/api/assignments/:id/reassign` | coordinator | `{newVolunteerId}`: remove old member, add new |
| POST `/api/assignments/:id/respond` | volunteer | `{accept\|decline}` |
| POST `/api/incidents/:id/status` | coordinator | `in_progress`/`resolved` (valid transitions only) |
| GET `/api/incidents/:id/events` | role-scoped | timeline |
| POST `/api/chat/token` | any | issues the Nexconn user token for the caller |
| GET `/api/incidents/:id/room` | member only | returns `groupId` after a membership check |
| GET `/api/chat/contacts` | volunteer/coordinator | allowed DM counterparts only |
| PATCH `/api/volunteers/me` | volunteer | availability toggle |
| GET `/api/volunteers` | coordinator | list |
| GET `/api/metrics` | coordinator | computed from `incident_events` |

SHOULD adds `GET /api/resources`, `POST /api/resources/:id/allocate`.

**Frontend screens (React + Vite + TS)**

1. Login (with demo-account quick-picks, labelled synthetic).
2. Citizen: New Request (text, voice button as SHOULD, location picker, large-text toggle) and My Requests with status and timeline.
3. Coordinator Command Centre: incident queue, Leaflet map, headline metrics.
4. Incident Detail (shared by roles, views differ): original vs AI side by side, verify/reject, ranked matches with breakdown, assign, timeline, room chat panel, DM panel.
5. Volunteer Dashboard: availability toggle, assignment card with accept/decline, link to the room, DM panel.
6. Impact Dashboard: counts, median time to verify and to assign, unresolved and delayed incidents, resolution rate, all labelled "synthetic demo data".

## 6. The two adapter files

Shape is final; every body is `MOCK_MODE` implementation plus `// TODO(nexconn): paste real SDK call here`.

**`backend/src/integrations/nexconn.adapter.ts`**

| Function | Input | Output |
|---|---|---|
| `issueUserToken` | `{userId: string, name: string}` | `Promise<{token: string; userId: string}>` |
| `createGroup` | `{groupId: string, name: string, ownerId: string, memberIds: string[]}` | `Promise<{groupId: string}>` (idempotent: returns the existing group if present) |
| `addGroupMembers` | `{groupId: string, userIds: string[]}` | `Promise<void>` |
| `removeGroupMembers` | `{groupId: string, userIds: string[]}` | `Promise<void>` |
| `postSystemMessage` | `{groupId: string, text: string}` | `Promise<{messageId: string}>` |

**`frontend/src/integrations/nexconnClient.ts`**

| Function | Input | Output |
|---|---|---|
| `initNexconn` | `{appKey: string}` | `void` |
| `connectNexconn` | `{token: string}` | `Promise<{userId: string}>` |
| `disconnectNexconn` | none | `Promise<void>` |
| `onConnectionStatus` | `(s: 'connecting'\|'connected'\|'disconnected') => void` | `() => void` (unsubscribe) |
| `joinRoom` | `{groupId: string}` | `Promise<void>` |
| `leaveRoom` | `{groupId: string}` | `Promise<void>` |
| `sendGroupMessage` | `{groupId: string, text: string}` | `Promise<ChatMessage>` |
| `sendDirectMessage` | `{toUserId: string, text: string}` | `Promise<ChatMessage>` |
| `onMessage` | `(m: ChatMessage) => void` | `() => void` (unsubscribe) |
| `getHistory` | `{conversation: {type:'group'\|'direct'; id: string}, limit: number, before?: number}` | `Promise<ChatMessage[]>` |

`ChatMessage = { id; conversation: {type; id}; senderId; text; sentAt: number; isSystem?: boolean }`. This is our own type, so the UI never sees SDK types.

Mock mode: backend keeps groups, members and tokens in memory. Frontend mock uses `BroadcastChannel` plus `localStorage`, so two tabs of the same origin behave like two accounts.

## 7. Scope for 30-36 hours (challenged)

**Realistic constraint: today is 20 Nov and the deadline is 22 Nov. The calendar window is about 48 hours, so 30-36 working hours leaves almost no slack for sleep, deployment bugs or the video.** Plan on 28 hours of building and keep 6-8 for deploy, demo recording and the writeup.

**MUST** (your list, with three adjustments)
- Intake form, large-text toggle, Gemini JSON extraction with original beside it, verify/reject.
- Deterministic matching with breakdown and hard exclusions, coordinator approval, reassignment.
- Incident group room plus coordinator-volunteer DM between two logged-in accounts, via the adapter.
- `incident_events` timeline, minimal impact dashboard, Leaflet map.
- *Added:* volunteer accept/decline (it is the only way to reach `In Progress`, and one endpoint).
- *Added:* seed script and a `/api/health` with mode indicator (the demo is un-runnable without them).
- *Added:* a deterministic keyword fallback extractor, because Gemini failing live must not stop the demo.

**SHOULD**: Web Speech voice input (about 1 hour, Chrome only); resource list with one allocate action; same-category-within-2 km duplicate flag (a single SQL query and a badge; I moved it up from CUT-adjacent because it makes the AI story richer for almost no cost); Dockerless deploy polish.

**CUT**: clustering/hotspots, image sharing, NGO rooms/portal, community channels, low-stock alerts, Call SDK, custom WebSocket chat, organisations table, Nominatim geocoding (stretch only).

**Challenge to your scope:** one thing is risky. "Reassignment" with Nexconn means removing a member from a live group, which is the least predictable SDK behaviour. Keep it in MUST but build it last in that group, and cut it to "reassign = add new volunteer, mark old as reassigned" if removal misbehaves.

## 8. Top 8 risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Token authorisation:** a client could request a token for another user | Backend derives `userId` only from the verified Supabase JWT; never accepts a userId in the body. Token TTL short; App Secret backend-only. |
| 2 | **Group membership authorisation:** joining a room one is not assigned to | Backend adds members only for coordinator + approved volunteer. `/room` re-checks `assignments`. Group ids are opaque (uuid), not guessable. Remember Nexconn itself is the final gate, so membership is the real control. |
| 3 | **DM leakage:** DMs are not group-scoped, so any user holding a counterpart's id might message them | Opaque ids; UI lists only `/chat/contacts`; document as a known limit; check Nexconn for a server-side allow-list during integration. |
| 4 | **Supabase RLS vs Nexconn drift** (assignment changed, member not removed) | One service function `setAssignment()` does DB write then adapter call; adapter failure logs an `event` with `chat_sync_failed` and surfaces a "Retry sync" button; `POST /api/incidents/:id/resync` rebuilds membership from `assignments`. Supabase is authoritative. |
| 5 | **Gemini rate limits / malformed JSON** | Response schema + zod validation, one retry, then keyword fallback with `source='fallback'` shown in UI; the coordinator can always edit fields; pre-cache the demo scenario's output. |
| 6 | **Two-account live demo** fails (sessions clash, one browser) | Two browser profiles (or normal + incognito) with pre-seeded logins; Supabase session per profile; rehearse; record a backup video before the deadline; `MOCK_MODE` is never an excuse in the final video (must be false). |
| 7 | **Deployment** (CORS, env vars, Render cold start, Vercel/Render URLs) | Deploy the skeleton by hour ~10, not the last day; one `/api/health` check; ping Render before the demo; keep a local run as backup. |
| 8 | **Unknown real SDK shape** (methods differ from our adapter, web SDK needs different init, permissions for group creation) | Adapter isolates it; budget a dedicated 3-hour integration spike as soon as real keys exist; if server-side group creation is not available, fall back to client-side group creation by the coordinator, still through the adapter. |

## 9. Inconsistencies, ambiguity, unrealism in the blueprint

- **Google Maps vs your Leaflet decision:** the blueprint stack says Google Maps; we use Leaflet and OSM.
- **48-hour roadmap vs your 30-36 h** (and the real 2-day calendar window): the roadmap is over-scoped for us. The phase estimates (6 + 10 + 12) leave almost nothing for deployment.
- **Blueprint file is not in `docs/`:** it was on the Desktop; copied to `docs/ReliefRelay_Blueprint.pdf`.
- **Team size:** the blueprint says 2-4, your prompt left `[FILL IN]` blank. The estimates here assume the scope is shared reasonably well; solo needs the SHOULD list dropped.
- **The "A" (availability) score component is degenerate:** busy/unverified are hard-excluded, so every eligible volunteer is "available". Proposed definition: A = 100 if `available` and no active assignment; 60 if `available` but has an assignment below capacity; hard-excluded otherwise. **C (capacity)** is undefined in the blueprint; proposed C = `100 * (capacity - active_assignments) / capacity`, which duplicates A. Alternative: C = fit of volunteer's equipment/transport to need. I propose the first and flag it as an open question.
- **D normalisation not specified:** proposed `D = max(0, 100 * (1 - km / 10))` (10 km radius). **K:** share of required skills covered, 100 if all, partial otherwise, with a medical/rescue gate (needs the qualification, otherwise hard-excluded).
- **Blueprint says citizens "receive status updates"** but never says how: I assume polling the status endpoint. No push, no SMS.
- **"Direct channels" are not group-scoped,** so enforcing "coordinator-volunteer only" is a UI and backend-list rule rather than a hard guarantee (risk 3).
- **Duplicate detection, clusters and "priority recommendations"** appear in CrisisMind as differentiators but are tagged Supporting/Stretch in the table; contradictory priority. Treated as SHOULD/CUT.
- **Impact language:** the blueprint warns against unsupported claims, so the dashboard must say "synthetic demo data" everywhere. Metrics like "unused/expired stock" and "resource fulfilment" need data we won't have.
- **Blueprint's lifecycle numbering** continues from 8 to 19 across two lists (cosmetic). It also lists "Community channels" and "Group channels" twice. Cosmetic only.
- **Hackathon rules link** exists in the blueprint, but I was told not to browse. The "judging criteria are unpublished" assumption is taken as given.

## 10. Open questions (most blocking first)

1. **Team size?** (the prompt left it blank). It changes how much SHOULD we attempt and whether work can be parallel.
2. **Do you already have the Nexconn app key/secret, and which Web SDK package/version will you use?** The whole chat story depends on the real integration; if you can paste even one real init+send snippet, the adapter will be right first time.
3. **Can the backend create groups and add members via a server API, or only a client SDK?** This decides the shape of `nexconn.adapter.ts` and the whole membership model.
4. **Citizens: logged-in accounts, or anonymous submit with a tracking code?** I recommend logged-in seeded accounts (matches RLS and is less code). Anonymous is more realistic but costs about 2-3 hours.
5. **Supabase project already created?** If not, I will provide SQL migrations plus a seed script and you run them in the SQL editor.
6. **OK with my definitions for A, C, D and K** (section 9)? Weights stay exactly as specified.
7. **Where will you deploy** (Vercel + Render as in the blueprint, or something else), and do you have those accounts ready?
8. **Is the demo a recorded video, a live judging session, or both?** It decides how much we invest in a rehearsed script and the backup recording.
