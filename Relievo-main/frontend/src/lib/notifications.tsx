// App-level notifications: polls the backend every 5 s while the tab is visible (and at once on login and on tab focus),
// and turns incoming Nexconn messages for rooms the person is NOT looking at into chat notifications.
// ONE Nexconn connection is opened here, after sign-in (ensureConnected is shared with the chat panels).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { ensureConnected } from "@/lib/chat";
import { convKey, isViewing } from "@/lib/chatState";
import { useAuth } from "@/lib/auth";
import { onMessage, type ChatMessage } from "@/integrations/nexconnClient";
import type { AppNotification, ChatRoom } from "@/lib/types";

const POLL_MS = 5000;

interface Summary { unassigned: number; awaiting_review: number; high_or_critical_open: number }
interface State {
  /** Backend notifications plus chat notifications created in this tab, newest first. */
  items: AppNotification[];
  unread: number;
  /** Unread chat messages per conversation key ("group:<id>" or "direct:<userId>"). */
  chatUnread: Record<string, number>;
  chatUnreadTotal: number;
  /** Rooms this person may open (Hub, incident rooms, citizen chats), for labels and unread counts. */
  rooms: ChatRoom[];
  /** The alert currently shown as a modal (High / Critical), and how many more are queued behind it. */
  popup: AppNotification | null;
  queued: number;
  /** Coordinators get one summary popup after login. */
  summary: Summary | null;
  summaryOpen: boolean;
  closeSummary: () => void;
  dismissPopup: () => void;
  markRead: (ids: string[]) => Promise<void>;
  markAllRead: () => Promise<void>;
  clearChat: (key: string) => void;
  /** Accept or decline an assignment offer straight from its notification. Resolves to an error message, or null on success. */
  respondOffer: (n: AppNotification, accept: boolean) => Promise<string | null>;
  /** Offers already answered in this session (their buttons go away). */
  answered: Set<string>;
  refresh: () => Promise<void>;
}
const Ctx = createContext<State | null>(null);

const alertRank = (n: AppNotification) => (n.type === "sos" || n.type === "sos_audio" ? 0 : n.priority === "critical" ? 1 : 2);
const isLoud = (n: AppNotification) => n.priority === "critical" || n.priority === "high";
const CHAT_TITLE_FALLBACK = "New chat message";

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [server, setServer] = useState<AppNotification[]>([]);
  const [chat, setChat] = useState<AppNotification[]>([]);
  const [chatUnread, setChatUnread] = useState<Record<string, number>>({});
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<AppNotification[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const popped = useRef(new Set<string>()); // alerts already shown as a popup in this session
  const firstLoad = useRef(true);
  const labels = useRef(new Map<string, string>()); // conversation key -> readable name
  const me = useRef<string | null>(null);

  const polling = useRef(false); // never stack requests (a slow or offline connection would pile them up)
  const refresh = useCallback(async () => {
    if (polling.current || navigator.onLine === false) return;
    polling.current = true;
    try {
      const res = await api<{ items: AppNotification[]; unread: number; summary?: Summary }>("/api/notifications");
      setServer(res.items);
      if (res.summary) setSummary(res.summary);
      const fresh = res.items.filter((n) => !n.read_at && isLoud(n) && !popped.current.has(n.id));
      if (fresh.length) {
        fresh.forEach((n) => popped.current.add(n.id));
        // SOS first, then Critical, then High; oldest first within a group, so the most urgent alert is the one on screen
        setQueue((q) => [...q, ...fresh].sort((a, b) => alertRank(a) - alertRank(b) || a.created_at.localeCompare(b.created_at)));
      }
      if (firstLoad.current) { // right after login
        firstLoad.current = false;
        if (user?.role === "coordinator" && res.summary && (res.summary.unassigned > 0 || res.summary.high_or_critical_open > 0 || fresh.length > 0)) setSummaryOpen(true);
      }
    } catch { /* offline, or the server is waking up: the next poll tries again */ }
    finally { polling.current = false; }
  }, [user?.role]);

  // Poll while the tab is visible; fetch immediately on mount (login) and whenever the tab regains focus.
  useEffect(() => {
    if (!user) return;
    void refresh();
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => { stop(); timer = setInterval(() => void refresh(), POLL_MS); };
    const stop = () => { if (timer) clearInterval(timer); timer = undefined; };
    const wake = () => { if (document.visibilityState === "visible") { void refresh(); start(); } else stop(); };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => { stop(); document.removeEventListener("visibilitychange", wake); window.removeEventListener("focus", wake); };
  }, [user, refresh]);

  // The one app-level chat connection: messages for rooms that are not open become notifications.
  useEffect(() => {
    if (!user) return;
    let off: (() => void) | undefined;
    let cancelled = false;
    ensureConnected().then(async (id) => {
      if (cancelled) return;
      me.current = id;
      api<Array<{ id: string; name: string }>>("/api/chat/contacts").then((c) => c.forEach((x) => labels.current.set(`direct:${x.id}`, x.name))).catch(() => undefined);
      api<ChatRoom[]>("/api/chat/rooms").then((r) => { setRooms(r); r.forEach((x) => labels.current.set(`group:${x.groupId}`, x.label)); }).catch(() => undefined);
      off = onMessage((m: ChatMessage) => {
        if (m.senderId === me.current || m.isSystem) return;
        const key = convKey(m.conversation);
        if (isViewing(key) && document.visibilityState === "visible") return;
        if (!labels.current.has(key)) api<ChatRoom[]>("/api/chat/rooms").then((r) => { setRooms(r); r.forEach((x) => labels.current.set(`group:${x.groupId}`, x.label)); }).catch(() => undefined);
        const label = labels.current.get(key);
        setChatUnread((u) => ({ ...u, [key]: (u[key] ?? 0) + 1 }));
        const note: AppNotification = {
          id: `chat-${m.id}`, recipient_user_id: null, recipient_role: null, type: "chat_message", priority: "low", incident_id: null,
          title: label ? (m.conversation.type === "direct" ? `Message from ${label}` : `New message in ${label}`) : CHAT_TITLE_FALLBACK,
          body: m.text.slice(0, 160), data: { conversation: key }, created_at: new Date(m.sentAt).toISOString(), read_at: null,
        };
        setChat((c) => [note, ...c].slice(0, 30));
      });
    }).catch(() => undefined);
    return () => { cancelled = true; off?.(); };
  }, [user]);

  const dismissPopup = useCallback(() => {
    setQueue((q) => {
      const [first, ...rest] = q;
      if (first) void api("/api/notifications/read", { body: { ids: [first.id] } }).then(() => refresh()).catch(() => undefined);
      return rest;
    });
  }, [refresh]);

  const markRead = useCallback(async (ids: string[]) => {
    const real = ids.filter((id) => !id.startsWith("chat-"));
    if (real.length) await api("/api/notifications/read", { body: { ids: real } }).catch(() => undefined);
    setChat((c) => c.map((n) => (ids.includes(n.id) ? { ...n, read_at: new Date().toISOString() } : n)));
    setServer((s) => s.map((n) => (ids.includes(n.id) ? { ...n, read_at: new Date().toISOString() } : n)));
  }, []);
  const markAllRead = useCallback(async () => {
    await api("/api/notifications/read", { body: { all: true } }).catch(() => undefined);
    const at = new Date().toISOString();
    setServer((s) => s.map((n) => ({ ...n, read_at: n.read_at ?? at })));
    setChat((c) => c.map((n) => ({ ...n, read_at: n.read_at ?? at })));
    setChatUnread({});
  }, []);
  const clearChat = useCallback((key: string) => {
    setChatUnread((u) => { if (!u[key]) return u; const { [key]: _gone, ...rest } = u; return rest; });
    setChat((c) => c.map((n) => (n.data.conversation === key ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)));
  }, []);

  const respondOffer = useCallback(async (n: AppNotification, accept: boolean) => {
    try {
      await api(`/api/assignments/${String(n.data.assignment_id)}/respond`, { body: { accept } });
      setAnswered((a) => new Set([...a, n.id]));
      await markRead([n.id]);
      await refresh();
      return null;
    } catch (e) {
      const msg = (e as Error).message;
      if (/already/i.test(msg)) setAnswered((a) => new Set([...a, n.id])); // answered elsewhere (for example on the dashboard)
      return msg;
    }
  }, [markRead, refresh]);

  // reset when the person signs out (the provider unmounts) so the next login starts clean
  useEffect(() => () => { popped.current.clear(); firstLoad.current = true; }, [user?.id]);

  const value = useMemo<State>(() => {
    const items = [...server, ...chat].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const chatTotal = Object.values(chatUnread).reduce((a, b) => a + b, 0);
    return {
      items, unread: items.filter((n) => !n.read_at).length, chatUnread, chatUnreadTotal: chatTotal, rooms,
      popup: queue[0] ?? null, queued: Math.max(0, queue.length - 1),
      summary, summaryOpen, closeSummary: () => setSummaryOpen(false), dismissPopup, markRead, markAllRead, clearChat, refresh, respondOffer, answered,
    };
  }, [server, chat, chatUnread, rooms, answered, respondOffer, queue, summary, summaryOpen, dismissPopup, markRead, markAllRead, clearChat, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNotifications() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useNotifications outside NotificationsProvider");
  return ctx;
}
