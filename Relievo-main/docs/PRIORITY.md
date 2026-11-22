# How Relievo decides what is urgent

Priority is **explainable and deterministic**: the same incident at the same moment always gets the same level, and every
point can be traced to a reason shown in the app. Code: `backend/src/services/priority.ts` (tests: `backend/test/priority.test.ts`).

**AI is only an input.** Its urgency suggestion is one signal among several. A human coordinator can override the level.
Nothing in this model dispatches anyone: assigning a volunteer always needs a coordinator's approval.

## Levels

`Critical > High > Medium > Low`

## Score

| Signal | Points |
|---|---|
| Urgency: low / medium / high / critical (the AI suggestion, or the coordinator's edit of it) | 5 / 25 / 45 / 70 |
| Any vulnerable person mentioned (elderly, child, disabled, pregnant, ...) | +10 |
| People affected: 2-4 / 5-9 / 10 or more | +5 / +10 / +15 |
| Waiting time: still unassigned (submitted or verified) after 30 minutes | +20 (one level step) |

Level from points: **70 or more = Critical**, **45-69 = High**, **25-44 = Medium**, below 25 = Low.

## Rules that override the score

1. **SOS is always Critical.** An active SOS gets score 1000 + its points, so it sorts above everything. Nothing (not the AI, not the
   transcript analysis) can lower it. The SOS path never waits for AI, speech recognition or an audio upload.
2. **Coordinator override.** A coordinator may set the level explicitly (incident page, "Priority"). The override is logged in
   `incident_events` (`priority_overridden`) and replaces the computed level. An active SOS cannot be overridden down.
3. **Waiting-time aging.** Once an unassigned incident has waited 30 minutes it moves up one level (+20 points), and coordinators get
   an `escalation` notification once. An incident with a volunteer assigned no longer ages.

## Ordering

Queues sort by score, highest first; ties go to whoever has waited longer. SOS and Critical incidents are therefore pinned at the top.

## Dispatch board (greedy conflict resolution)

The dispatch board lists every verified incident that has no volunteer, in priority order, with the best available volunteer from the
existing explainable matching score (`S = 0.35D + 0.30K + 0.20A + 0.15C`; busy, unverified, at-capacity or unqualified volunteers are
excluded). To avoid suggesting one volunteer for two operations, the highest-priority incident **picks first** and a volunteer already
suggested is skipped for the incidents below it. If nobody eligible is left, the incident shows "no eligible volunteer" and stays on the board.

The coordinator approves each suggestion individually, or uses **Approve all suggested** (one confirmation). Every approval goes through
the same server-side checks as a single assignment and is logged in `incident_events`. A manual override (choose another volunteer) and
reassignment remain available.

## Notifications

High and Critical incidents trigger a red popup (queued if several) for coordinators; verified volunteers are alerted when a
High/Critical incident is verified and for every SOS. See `docs/UNDERSTANDING.md` and the README feature guide.
