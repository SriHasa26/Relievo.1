# Relievo

AI-assisted disaster-response coordination. Citizens report, a coordinator verifies and approves explainable
volunteer matches, and responders talk in incident rooms built on the Nexconn Chat SDK.
Hackathon: Nexconn Build Challenge 2026 (Humanitarian & Social Good).
Plan: [docs/UNDERSTANDING.md](docs/UNDERSTANDING.md) · Rules: [CLAUDE.md](CLAUDE.md) · Deploy: [docs/DEPLOY.md](docs/DEPLOY.md)

> AI is decision support. A human coordinator verifies every incident and approves every assignment.
> All demo data is synthetic and labelled so.

## Evaluator access (synthetic demo accounts)

The landing page has an **Evaluator access** panel (also in the nav) with one account per role, copy buttons and one-click sign-in.
All four share the password `demo1234`. They hold synthetic sample data only.

| Role | Email |
|---|---|
| Citizen | `citizen1@demo.reliefrelay.test` |
| Volunteer | `volunteer14@demo.reliefrelay.test` |
| Coordinator | `coordinator21@demo.reliefrelay.test` |
| NGO | `ngo31@demo.reliefrelay.test` |

Check sign-in on any deployment: `BASE_URL=https://<your-vercel-url> node e2e/signin-check.mjs` (prints PASS/FAIL per role).

## Feature guide (v3)

| Feature | Who | Where |
|---|---|---|
| **EMERGENCY SOS**: one tap creates a Critical, SOS-flagged incident at once (device location, or the last known place marked approximate), alerts every coordinator and verified volunteer, then records audio with a live transcript (Stop, silence or 45 s) and uploads it to the same incident. "I am safe / cancel SOS" ends it. One active SOS per citizen. | Citizen | red button in the nav and on My requests |
| **Voice-to-text** with English (India), Hindi and Telugu | everyone | mic button on the New request description, the citizen chat, incident chat, Volunteer Hub and direct messages |
| **Notifications**: bell, unread badge, notification centre; High/Critical items pop up as a red alert (queued, no sound, honours reduced motion); coordinators get a summary right after login | coordinator, volunteer, citizen | header bell; polls every 5 s while the tab is visible |
| **Priority queue**: SOS and Critical pinned on top, waiting timers, filter by priority and status; explainable score ([docs/PRIORITY.md](docs/PRIORITY.md)) | coordinator | Command centre |
| **Dispatch board**: unassigned incidents in priority order with the best available volunteer, no volunteer suggested twice; approve one by one or **Approve all suggested**; manual override | coordinator | Dispatch board |
| **Citizen chat**: a separate Nexconn group per incident (citizen + accepted volunteer + coordinator), opens when a volunteer accepts | citizen, volunteer, coordinator | below the status timeline |
| **Volunteer Hub**: one persistent group with all volunteers and coordinators | volunteer, coordinator | nav "Volunteer Hub", Messages tab |

**Good to know**
- **First load can take about a minute.** The free Render server sleeps when idle; the landing page says "Waking up the server" and sign-in
  works as soon as it answers. Open the site (or `/health` on the API) a few minutes before a demo.
- **Voice input works in Chrome and Edge** (HTTPS or localhost). Other browsers get a clear message and can still type.
- **Evaluators:** use the *Evaluator access* panel on the landing page (see below). All accounts are synthetic.

Voice input uses the browser's Web Speech API, which works in **Chrome and Edge** (HTTPS or localhost). Other browsers get a clear message and can
still type; in an SOS the audio is recorded even when transcription is unavailable.

Tools:

```bash
npm run verify:schema -w backend   # has supabase/migrations/0003 been applied?
npm run reset:demo -w backend      # put the live demo back to the seed (run before recording / submitting)
npm run e2e:v3       # v3 feature tests on the mock stack (fake microphone, scripted speech recognition)
npm run e2e:chat                   # real Nexconn / Supabase chat tests (set MOCK_AI=true to save AI quota)
```

Abuse protection: per-IP and per-user rate limits on incident submit, SOS, SOS audio, chat token and login, with a friendly message
(the demo accounts and their password are public).

## Run (mock flags, no keys needed)

```bash
npm install
cp backend/.env.example backend/.env      # MOCK_CHAT, MOCK_AI, MOCK_DB all true
cp frontend/.env.example frontend/.env
npm run dev                               # API :4000, web :5173 (Vite proxies /api)
npm test                                  # 48 backend unit tests
npm run typecheck
```

Open http://localhost:5173 and use the **demo role switcher** (all passwords `demo1234`).
Data lives in memory and resets when the backend restarts.

### Two-account demo (chat)
Each browser **tab** keeps its own login (sessionStorage). Open two tabs on the same origin, e.g.
Coordinator Priya in one and Sana Khan (volunteer) in the other. The mock chat links the tabs through
`BroadcastChannel`. In real mode the same two-tab setup works through Nexconn.

### Suggested click-through
1. Citizen Asha: *New request*, send the text, see the report.
2. Coordinator: *Command centre* → open it → compare original vs AI → edit → **Verify**.
3. *Responder dispatch*: ranked volunteers with the D/K/A/C breakdown; busy and unverified volunteers are excluded with reasons. **Approve**.
4. Volunteer Sana: **Accept**. Both open the incident: group room and a direct message.
5. Coordinator: allocate stock on *Resources*, **Mark resolved**, then see the timeline and *Impact*.

## Matching (ResponderMatch)
`S = 0.35·D + 0.30·K + 0.20·A + 0.15·C`, each 0-100 (`backend/src/services/matching.ts`).
D = 100 at 0 km falling to 0 at 10 km (Haversine). K = share of the category's skills the volunteer has.
A = 100 if free, 60 if already holding a task. C = free slots / capacity.
Excluded outright: unverified, busy/offline, at capacity, declined this incident, and no `medical` /
`rescue_certified` qualification for medical / rescue tasks.

## Layout
```
backend/   Express + TS. services/ (extraction, matching, incidents, dispatch, rooms, resources, metrics)
           integrations/nexconn.adapter.ts   <- only backend file that touches Nexconn
frontend/  React + Vite + Tailwind. integrations/nexconnClient.ts   <- only frontend file that touches Nexconn
supabase/  migrations (schema + RLS)
```

## Status
Done: real Nexconn chat behind the two adapters (`MOCK_CHAT=false`), intake, mock/keyword AI with schema validation, verify/reject/edit, matching and dispatch,
accept/decline/reassign/resolve, rooms + DMs (mock), resources, impact, timeline, event log.

Not wired yet (by design):
- Gemini (`geminiExtract` in `extraction.ts` is a placeholder; the chain skips it).
- Supabase has not been run against a real project yet (see "Supabase and AI" below for what is verified).
- Voice input (SHOULD), deployment.

Known mock limits: system messages posted by the backend adapter do not appear in the frontend mock chat.
Seeded demo: 4 volunteers (the brief said 3; a fourth available one makes the matching list meaningful).

## Real Nexconn chat (MOCK_CHAT=false)
Backend `.env`: `NEXCONN_APP_KEY`, `NEXCONN_APP_SECRET`, `NEXCONN_API_DOMAIN` (your data center host), `MOCK_CHAT=false`.
Frontend `.env`: `VITE_NEXCONN_APP_KEY`, `VITE_NEXCONN_AREA_CODE` (same data center), `VITE_MOCK_CHAT=false`.
Server check: `npm run verify:nexconn -w backend` (prints PASS/FAIL, creates small synthetic groups).

Manual check with two browsers (use two different browser profiles, or one normal and one private window):
1. Mock flags off, `npm run dev`. Browser A: log in as Coordinator Priya. Browser B: log in as Sana Khan (volunteer). Each must log in once so Nexconn knows the user.
2. A: verify incident "water/food" and approve Sana. B: accept. Both open the incident: "Chat: connected" shows.
3. A sends a message in the incident room: B sees it live. B replies: A sees it.
4. Open Messages on both: A sends Sana a direct message, B replies.
5. Refresh both browsers: the history is still there.
6. Browser C (or B after a decline/reassign): log in as Karthik, open the same incident URL: the room is refused (403).
7. Stop the backend, reload: a red "Chat problem" message with a Retry button appears; restart and press Retry.

## Automated chat check (real Nexconn)
`npm run e2e:chat` drives two browser contexts (Coordinator Priya and volunteer Karthik on seeded incident 106) plus a
third for the refusal checks. Needs `MOCK_CHAT=false` / `VITE_MOCK_CHAT=false` in your `.env` files. First time only:
`cd e2e && npm install && npx playwright install chromium`. Screenshots go to `e2e/screenshots/` (git-ignored).
Stop any dev server that is already running with mock flags first: the test refuses to run against `MOCK_CHAT=true`.

## Supabase and AI (MOCK_DB=false, MOCK_AI=false)
Data access goes through one interface, `backend/src/store/repo.ts`: `memoryRepo.ts` (MOCK_DB=true) or `supabaseRepo.ts`
(MOCK_DB=false, service-role key, backend only). Setup:
1. Supabase SQL editor: paste and run `supabase/all_migrations.sql` once.
2. `backend/.env`: `SUPABASE_URL` (https://&lt;ref&gt;.supabase.co), `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `MOCK_DB=false`;
   `frontend/.env`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
3. `npm run seed:supabase -w backend` (creates Auth users with password `demo1234`, rows, stored AI analyses, Nexconn rooms).
4. `npm run verify:supabase -w backend` (data layer, JWT check and RLS checks, PASS/FAIL).

Who enforces what: the **backend** (service-role key, bypasses RLS) enforces every rule in the API: role checks, who may see an
incident, hard matching exclusions, one active assignment, room membership, token userId from the verified JWT.
**RLS** protects the same data against direct access with the anon key (citizens: own incidents; volunteers: assigned
incidents; coordinators: all; nobody can write events/assignments/channels/allocations from a browser).
The database also enforces one active assignment per incident (unique index).

AI order: OpenRouter (`OPENROUTER_MODEL`, then `openrouter/free`) -> Gemini (only if `GEMINI_API_KEY`; not implemented yet) -> keyword
extractor. Answers are cached by report text, calls are at least 3 s apart, and the seed script stores an analysis for every seeded
incident. The coordinator sees "AI via OpenRouter" / "Fallback" next to the AI suggestion. Output is always validated and
`requires_human_verification` stays true.

`DEMO_LOGIN=true` (default) shows the role switcher with the shared demo password for the synthetic accounts. Set it to `false`
for anything public.
