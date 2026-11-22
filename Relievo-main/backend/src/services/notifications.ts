// Notifications: one row per recipient. The frontend polls GET /api/notifications; High and Critical items pop up.
// Creating a notification must never break the action that caused it, so callers use `safely`.
import { getRepo, newId } from "../store/repo";
import { computePriority, isHighOrCritical } from "./priority";
import type { Notification, NotificationType, Urgency, User } from "../types";

export const safely = async (fn: () => Promise<unknown>) => {
  try { await fn(); } catch (e) { console.warn("notification failed:", (e as Error).message); }
};

export interface NotifyInput {
  type: NotificationType;
  priority: Urgency;
  incident_id?: string | null;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Create the same notification for each recipient (de-duplicated). */
export async function notifyUsers(recipients: User[], input: NotifyInput): Promise<void> {
  const repo = await getRepo();
  const seen = new Set<string>();
  for (const u of recipients) {
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    const n: Notification = {
      id: newId(), recipient_user_id: u.id, recipient_role: u.role, type: input.type, priority: input.priority,
      incident_id: input.incident_id ?? null, title: input.title, body: input.body, data: input.data ?? {},
      created_at: new Date().toISOString(), read_at: null,
    };
    await repo.addNotification(n);
  }
}

export const coordinators = async () => (await (await getRepo()).users()).filter((u) => u.role === "coordinator");
/** Verified volunteers see exact SOS details; unverified ones only get a generic alert. */
export const volunteers = async (verified: boolean) =>
  (await (await getRepo()).users()).filter((u) => u.role === "volunteer" && u.verified === verified);

export async function listNotifications(user: User) {
  const repo = await getRepo();
  // If the v3 migration has not been applied yet the table is missing: answer with an empty list instead of an error.
  const stored = await repo.notifications(user.id).catch((e: Error) => { console.warn("notifications unavailable:", e.message); return [] as Notification[]; });
  const all = stored.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 60);
  const unread = all.filter((n) => !n.read_at).length;
  let summary: { unassigned: number; awaiting_review: number; high_or_critical_open: number } | undefined;
  if (user.role === "coordinator") {
    const open = (await repo.incidents()).filter((i) => ["submitted", "verified"].includes(i.status));
    summary = {
      unassigned: open.filter((i) => i.status === "verified").length,
      awaiting_review: open.filter((i) => i.status === "submitted").length,
      high_or_critical_open: open.filter((i) => isHighOrCritical(computePriority(i).level)).length,
    };
  }
  return { items: all, unread, summary };
}

export async function markRead(user: User, ids: unknown) {
  const list = ids === "all" ? "all" : Array.isArray(ids) ? ids.map(String) : [];
  await (await getRepo()).markNotificationsRead(user.id, list);
}
