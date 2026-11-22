// Which conversations are open on screen right now. Used so a message in a room you are looking at is not announced as a notification.
import type { Conversation } from "@/integrations/nexconnClient";

const open = new Map<string, number>(); // key -> how many panels show it
export const convKey = (c: Conversation) => `${c.type}:${c.id}`;
export function setViewing(key: string) { open.set(key, (open.get(key) ?? 0) + 1); }
export function clearViewing(key: string) {
  const n = (open.get(key) ?? 1) - 1;
  if (n <= 0) open.delete(key); else open.set(key, n);
}
export const isViewing = (key: string) => (open.get(key) ?? 0) > 0;
