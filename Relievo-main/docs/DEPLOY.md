# Deploying Relievo: Render (backend) + Vercel (frontend)

Order matters: **Supabase ready → Render (backend) → Vercel (frontend) → set `FRONTEND_URL` on Render → smoke test.**
All demo data is synthetic. Never paste real keys into git, chat or screenshots.

## 0. One-time prerequisites
1. **GitHub repo.** The project has no remote yet. Create a **private** empty repo on GitHub, then in the project folder:
   `git remote add origin https://github.com/<you>/<repo>.git` and `git push -u origin main`.
   `.env` files are git-ignored (checked: no key appears in the tree or history).
2. **Supabase** project: SQL editor → run `supabase/all_migrations.sql` once.
3. **Seed once** (see section 5). Supabase free projects pause after ~1 week of inactivity: open the dashboard if it did.
4. Know your **Nexconn data center** (Console → Key Management). This guide uses Singapore (`api.sg-light-api.com`, `SG`).

## 1. Environment variables

### Backend on Render
| Name | Secret? | Where the value comes from | Production value |
|---|---|---|---|
| `NODE_VERSION` | no | fixed | `22` |
| `NODE_ENV` | no | fixed | `production` (the server refuses to start with any mock flag on) |
| `MOCK_CHAT` | no | fixed | `false` |
| `MOCK_AI` | no | fixed | `false` |
| `MOCK_DB` | no | fixed | `false` |
| `DEMO_LOGIN` | no | fixed | `true` (role switcher + shared demo password for the synthetic accounts; `false` for anything public) |
| `FRONTEND_URL` | no | your Vercel URL, set in step 4 | `https://<project>.vercel.app` (no trailing slash; comma-separate several) |
| `NEXCONN_APP_KEY` | **yes** | Nexconn Console → Key Management | your App Key |
| `NEXCONN_APP_SECRET` | **YES, never in the frontend** | Nexconn Console → Key Management | your App Secret |
| `NEXCONN_API_DOMAIN` | no | data center host | `api.sg-light-api.com` |
| `NEXCONN_API_DOMAIN_BACKUP` | no | optional | `api-b.sg-light-api.com` |
| `OPENROUTER_API_KEY` | **yes** | openrouter.ai → Keys | your key |
| `OPENROUTER_MODEL` | no | picked from OpenRouter's free list | `particle-ai/particle-1:free` |
| `GEMINI_API_KEY` | yes | not used yet | leave unset |
| `SUPABASE_URL` | no | Supabase → Project Settings → API (Project URL) | `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | no (public key) | Supabase → Project Settings → API Keys | publishable / anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | **YES, backend only** | Supabase → Project Settings → API Keys | `sb_secret_…` or the service_role key |
| `PORT` | no | **Render sets it**; do not add it | |

### Frontend on Vercel (every `VITE_` value is public: it ends up in the browser bundle)
| Name | Where the value comes from | Production value |
|---|---|---|
| `VITE_API_BASE_URL` | your Render URL from step 2 | `https://<service>.onrender.com` (no trailing slash) |
| `VITE_NEXCONN_APP_KEY` | Nexconn Console (App Key only, never the Secret) | your App Key |
| `VITE_NEXCONN_AREA_CODE` | your data center | `SG` |
| `VITE_SUPABASE_URL` | same as `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | same as `SUPABASE_ANON_KEY` | publishable / anon key |
| `VITE_MOCK_CHAT` | fixed | `false` (a production build uses real chat unless this is exactly `true`) |

Vite bakes these in at **build time**: after changing one, redeploy the frontend.

## 2. Backend on Render
1. render.com → **New +** → **Blueprint** → connect GitHub → pick the repo. Render reads `render.yaml`.
2. Render asks for the values marked `sync: false`. Fill them in from the table. For `FRONTEND_URL` enter the placeholder
   `https://placeholder.invalid` for now (the server needs *some* value to start).
3. **Apply**. First build takes a few minutes. When it is live open `https://<service>.onrender.com/health`: you should see
   `{"ok":true,"status":"ok","mockChat":false,"mockAi":false,"mockDb":false,...}`.

Manual alternative (no Blueprint): **New + → Web Service** → repo → Runtime **Node**, Region **Singapore** (or near Supabase),
Instance **Free**, Build command `npm ci --workspace=backend`, Start command `npm run start -w backend`,
Health check path `/health`, then add the variables above.

In the logs you should see `Chat users registered` and `Stored chat rooms checked`. Both run in the background after the server
is already listening, are safe on every restart, and reuse the stored room ids (nothing is duplicated).

## 3. Frontend on Vercel
1. vercel.com → **Add New… → Project** → import the repo.
2. **Root Directory:** `frontend`. Keep **Include source files outside of the Root Directory** switched **on** (the repo is an npm workspace).
3. Framework Preset **Vite**. Build command `npm run build`, Output directory `dist`, Install command `cd .. && npm ci`
   (these come from `frontend/vercel.json`; if the install step fails, clear the Install Command override and let Vercel detect it).
4. **Environment Variables:** add the six `VITE_` values above (all environments).
5. **Deploy.** Deep links such as `/login` work because of the SPA rewrite in `frontend/vercel.json`.

## 4. Tell the backend where the frontend is
Render → your service → **Environment** → set `FRONTEND_URL` to the Vercel URL (e.g. `https://reliefrelay.vercel.app`) → Save
(Render redeploys). Browsers from other origins, including Vercel preview URLs, are refused by CORS; add a preview URL to
`FRONTEND_URL` (comma separated) if you need one.

## 5. Seed the production database (once)
Render's free tier has no shell, so run the seed from your computer against the same Supabase/Nexconn/OpenRouter values:
```
npm install
npm run seed:supabase -w backend
```
(your local `backend/.env` must hold the production values, `MOCK_DB=false`). It creates the Auth users (password `demo1234`),
the rows, one stored AI analysis per seeded incident and the seeded Nexconn rooms. It takes about a minute and is safe to repeat.
It does not delete extra incidents created later (for example by test runs).

## 6. Smoke test (from your computer)
```
npm run smoke -- https://<service>.onrender.com https://<project>.vercel.app
```
It checks `/health`, that no mock flag is on, a demo login, two authenticated API calls, a refused anonymous call, CORS, that the
frontend serves the app and a deep link, and that the bundle points at your backend. It prints only PASS/FAIL.

## 7. Before the demo
- **Warm up the backend 5 minutes before.** A free Render service sleeps after about 15 minutes idle and the first request then
  takes 30-60 seconds. Open `https://<service>.onrender.com/health` (or run the smoke test) at T-5 min, and again at T-1 min.
- Open Supabase once that day (a paused project needs a click to wake).

## 8. Post-deploy checklist (two browsers)
Use two different browser profiles (or one normal and one private window).
1. Browser A: open the Vercel URL → **Coordinator Priya**. The yellow banner says synthetic demo data and does **not** say MOCK.
2. Browser B: **Asha Rao** (citizen) → New request → submit a short report with a place. You land on the report page.
3. A: Command centre → open it. The original text sits beside the AI suggestion with the label "AI via OpenRouter" (or "Fallback").
   Click **Verify incident**.
4. A: Responder dispatch shows ranked volunteers with D/K/A/C; busy and unverified ones are excluded with reasons. **Approve assignment**.
5. B: sign out, **Sana Khan** (volunteer) → **Accept** (use whoever was approved).
6. A and B: open the incident → "Chat: connected". Send a message each way: it appears live. Refresh both: history stays.
7. A: Messages → direct message to the volunteer; B replies.
8. A: Resources → allocate to the incident; incident page → **Mark resolved**; check the timeline and **Impact**.
9. Authorisation: a third profile as another volunteer (or the citizen) opening the same incident URL does not see the room.

If something fails: Render → Logs (backend) and the browser console (frontend). Nexconn problems show in the chat panel as
"Chat problem" with a Retry button.

## 9. v3 upgrade (notifications, SOS, citizen chat, Volunteer Hub)
1. Supabase → SQL editor → paste and run `supabase/migrations/0003_v3_notifications_sos_rooms.sql` (also the last block of `supabase/all_migrations.sql`). It is idempotent.
2. From your computer: `npm run verify:schema -w backend` should print "Migration 0003 is applied."
3. Deploy backend (Render) and frontend (Vercel) as usual. Until step 1 is done the existing features keep working; notifications, SOS and the citizen chat need the migration.
4. Before recording or submitting: `npm run reset:demo -w backend` puts the demo back to the seed data.

`TRUST_PROXY` (optional, default `1`): how many reverse proxies sit in front of the API. Render's load balancer is one hop, so the rate limiter reads the real client IP from `X-Forwarded-For`. If a CDN is ever added in front, raise it.
