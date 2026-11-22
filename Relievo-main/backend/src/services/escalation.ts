// Waiting-time escalation: an incident nobody has taken for too long is flagged once and coordinators are alerted.
// (The priority score itself also rises with waiting time; see priority.ts.)
import { getRepo, logEvent } from "../store/repo";
import { coordinators, notifyUsers } from "./notifications";
import { AGING_AFTER_MINUTES, computePriority } from "./priority";

export async function runEscalationCheck(now = Date.now()): Promise<number> {
  const repo = await getRepo();
  let count = 0;
  for (const incident of await repo.incidents()) {
    if (!["submitted", "verified"].includes(incident.status)) continue;
    const p = computePriority(incident, now);
    if (p.waiting_minutes < AGING_AFTER_MINUTES) continue;
    const already = (await repo.events({ incident_id: incident.id })).some((e) => e.action === "escalated");
    if (already) continue;
    await logEvent(incident.id, null, "escalated", { waiting_minutes: p.waiting_minutes, level: p.level });
    await notifyUsers(await coordinators(), {
      type: "escalation", priority: p.level === "low" || p.level === "medium" ? "high" : p.level, incident_id: incident.id,
      title: `Unassigned for ${p.waiting_minutes} min: ${incident.category}${incident.address_text ? ` · ${incident.address_text}` : ""}`,
      body: incident.status === "submitted" ? "Still waiting for verification." : "Verified but no volunteer is assigned yet.",
    });
    count++;
  }
  return count;
}
