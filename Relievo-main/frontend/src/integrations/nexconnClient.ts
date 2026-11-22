// The ONLY frontend file that talks to Nexconn. Nothing else may import the Nexconn SDK.
// VITE_MOCK_CHAT=true  -> MOCK implementation below (no network).
// VITE_MOCK_CHAT=false -> the real @nexconn/chat Web SDK (names verified against its installed type definitions).
//
// MOCK: messages live in localStorage and are announced through a BroadcastChannel, so two browser
// tabs on the same origin (each signed in as a different account, see sessionStorage in lib/api.ts)
// behave like two devices chatting. This is NOT real Nexconn: it must be off (VITE_MOCK_CHAT=false) for the demo.

import {
  AreaCode, BaseChannel, ChannelType, ConnectionStatus as NcStatus, ConnectionStatusHandler, DirectChannel,
  GroupChannel, MessageHandler, MessageType, NCEngine, SendTextMessageParams,
  type Message as NcMessage,
} from "@nexconn/chat";

export type ConversationType = "group" | "direct";
/** For direct conversations, `id` is the OTHER person's user id. For groups it is the group id. */
export interface Conversation { type: ConversationType; id: string }
export interface ChatMessage {
  id: string;
  conversation: Conversation;
  senderId: string;
  text: string;
  sentAt: number; // epoch ms
  isSystem?: boolean;
}
export type ConnectionStatus = "connecting" | "connected" | "disconnected";

// Development: mock unless VITE_MOCK_CHAT=false. Production build: real chat unless VITE_MOCK_CHAT=true is set on purpose.
const MOCK = import.meta.env.PROD ? import.meta.env.VITE_MOCK_CHAT === "true" : import.meta.env.VITE_MOCK_CHAT !== "false";
export const isMockChat = MOCK;

// ---------------- mock internals ----------------
interface RawMessage {
  id: string; kind: ConversationType; target: string; // group id, or the recipient's user id
  senderId: string; text: string; sentAt: number; isSystem?: boolean;
}
const STORE_KEY = "rr-mock-chat";
const mock = {
  me: null as string | null,
  joined: new Set<string>(),
  messageListeners: new Set<(m: ChatMessage) => void>(),
  statusListeners: new Set<(s: ConnectionStatus) => void>(),
  channel: null as BroadcastChannel | null,
};

const readStore = (): RawMessage[] => {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]") as RawMessage[]; } catch { return []; }
};
const writeStore = (all: RawMessage[]) => {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(all.slice(-500))); } catch { /* storage full or blocked */ }
};

/** Turn a stored message into what this viewer should see (direct: the "other person" is the conversation id). */
function toChatMessage(raw: RawMessage, me: string): ChatMessage {
  const conversation: Conversation = raw.kind === "group"
    ? { type: "group", id: raw.target }
    : { type: "direct", id: raw.senderId === me ? raw.target : raw.senderId };
  return { id: raw.id, conversation, senderId: raw.senderId, text: raw.text, sentAt: raw.sentAt, isSystem: raw.isSystem };
}

function deliver(raw: RawMessage) {
  const me = mock.me;
  if (!me) return;
  // Mock only: every tab hears every group (the real service delivers to members only). The UI filters by conversation, and the
  // app-level notification listener needs rooms the tab is not currently showing.
  const relevant = raw.kind === "group" ? true : raw.target === me || raw.senderId === me;
  if (!relevant) return;
  const msg = toChatMessage(raw, me);
  mock.messageListeners.forEach((l) => l(msg));
}

function setStatus(s: ConnectionStatus) {
  mock.statusListeners.forEach((l) => l(s));
}

function mockSend(kind: ConversationType, target: string, text: string): ChatMessage {
  if (!mock.me) throw new Error("Not connected to chat");
  const raw: RawMessage = {
    id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, kind, target, senderId: mock.me, text, sentAt: Date.now(),
  };
  writeStore([...readStore(), raw]);
  mock.channel?.postMessage(raw); // other tabs
  deliver(raw); // this tab (a BroadcastChannel never echoes to its own instance)
  return toChatMessage(raw, mock.me);
}

// ---------------- real SDK helpers ----------------
// Nexconn ids are letters and digits only, so our UUIDs are sent without dashes. We remember the original
// spelling so incoming messages map back to our ids.
const SYSTEM_USER_ID = "reliefrelaysystem";
const idMap = new Map<string, string>();
const toNex = (id: string) => { const n = id.replace(/[^A-Za-z0-9]/g, ""); idMap.set(n, id); return n; };
const fromNex = (n: string) => idMap.get(n)
  ?? n.replace(/^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/i, "$1-$2-$3-$4-$5");

const real = {
  me: null as string | null,
  started: false,
  messageListeners: new Set<(m: ChatMessage) => void>(),
  statusListeners: new Set<(s: ConnectionStatus) => void>(),
};

function realStatus(status: NcStatus): ConnectionStatus {
  if (status === NcStatus.CONNECTED) return "connected";
  if (status === NcStatus.CONNECTING) return "connecting";
  return "disconnected";
}

/** Turn an SDK message into our own ChatMessage. Returns null for non-text messages. */
function fromNcMessage(m: NcMessage, me: string): ChatMessage | null {
  if (m.messageType !== MessageType.TEXT) return null;
  const { channelType, channelId } = m.channelIdentifier;
  const senderId = fromNex(m.senderUserId);
  const conversation: Conversation = channelType === ChannelType.GROUP
    ? { type: "group", id: fromNex(channelId) }
    : { type: "direct", id: senderId === me ? fromNex(channelId) : senderId };
  return {
    id: m.messageId, conversation, senderId, text: String((m.content as { text?: string }).text ?? ""),
    sentAt: m.sentTime, isSystem: m.senderUserId === SYSTEM_USER_ID,
  };
}

const channelFor = (c: Conversation) => (c.type === "group" ? new GroupChannel(toNex(c.id)) : new DirectChannel(toNex(c.id)));

async function realSend(conversation: Conversation, text: string): Promise<ChatMessage> {
  const me = real.me;
  if (!me) throw new Error("Not connected to chat");
  const res = await channelFor(conversation).sendMessage(new SendTextMessageParams({ text }));
  const sent = res.isOk && res.data ? fromNcMessage(res.data, me) : null;
  if (!sent) throw new Error(`Message not sent (code ${res.code})`);
  return { ...sent, conversation }; // for direct messages the conversation id is the other person
}

// ---------------- public API ----------------

export function initNexconn(config: { appKey: string }): void {
  if (MOCK) {
    if (!mock.channel && typeof BroadcastChannel !== "undefined") {
      mock.channel = new BroadcastChannel("reliefrelay-mock-chat");
      mock.channel.onmessage = (e: MessageEvent<RawMessage>) => deliver(e.data);
    }
    return;
  }
  if (real.started) return; // the SDK must be initialised exactly once
  if (!config.appKey) throw new Error("VITE_NEXCONN_APP_KEY is not set");
  const area = (import.meta.env.VITE_NEXCONN_AREA_CODE as keyof typeof AreaCode | undefined) ?? "SG";
  NCEngine.initialize({ appKey: config.appKey, areaCode: AreaCode[area] ?? AreaCode.SG });
  // Register listeners before connecting, as the docs advise.
  NCEngine.addConnectionStatusHandler("reliefrelay", new ConnectionStatusHandler({
    onConnectionStatusChanged: ({ status }) => real.statusListeners.forEach((l) => l(realStatus(status))),
  }));
  NCEngine.addMessageHandler("reliefrelay", new MessageHandler({
    onMessageReceived: ({ messages }) => {
      if (!real.me) return;
      for (const raw of messages) {
        const m = fromNcMessage(raw, real.me);
        if (m) real.messageListeners.forEach((l) => l(m));
      }
    },
  }));
  real.started = true;
}

export async function connectNexconn(input: { token: string }): Promise<{ userId: string }> {
  if (MOCK) {
    setStatus("connecting");
    const m = /^mock-token\.(.+)$/.exec(input.token);
    if (!m?.[1]) { setStatus("disconnected"); throw new Error("Invalid chat token"); }
    mock.me = m[1];
    setStatus("connected");
    return { userId: mock.me };
  }
  const res = await NCEngine.connect({ token: input.token });
  if (!res.isOk || !res.data) throw new Error(`Could not connect to chat (code ${res.code})`);
  real.me = fromNex(res.data.userId);
  return { userId: real.me };
}

export async function disconnectNexconn(): Promise<void> {
  if (MOCK) {
    mock.me = null;
    mock.joined.clear();
    setStatus("disconnected");
    return;
  }
  await NCEngine.disconnect();
  real.me = null;
}

export function onConnectionStatus(handler: (s: ConnectionStatus) => void): () => void {
  if (MOCK) {
    mock.statusListeners.add(handler);
    return () => { mock.statusListeners.delete(handler); };
  }
  real.statusListeners.add(handler);
  return () => { real.statusListeners.delete(handler); };
}

/** Join a group room. The backend has already checked and recorded this user's membership. */
export async function joinRoom(input: { groupId: string }): Promise<void> {
  if (MOCK) { mock.joined.add(input.groupId); return; }
  // Real Nexconn: membership is managed by our backend through the server API (group join), so the client
  // has nothing to do. We only remember the id spelling for incoming messages.
  toNex(input.groupId);
}

export async function leaveRoom(input: { groupId: string }): Promise<void> {
  if (MOCK) { mock.joined.delete(input.groupId); return; }
  // Real Nexconn: nothing to do. Closing the screen does not remove the user from the group.
}

export async function sendGroupMessage(input: { groupId: string; text: string }): Promise<ChatMessage> {
  if (MOCK) return mockSend("group", input.groupId, input.text);
  return realSend({ type: "group", id: input.groupId }, input.text);
}

export async function sendDirectMessage(input: { toUserId: string; text: string }): Promise<ChatMessage> {
  if (MOCK) return mockSend("direct", input.toUserId, input.text);
  return realSend({ type: "direct", id: input.toUserId }, input.text);
}

/** Subscribe to incoming messages (groups already joined, and direct messages to me). Returns unsubscribe. */
export function onMessage(handler: (m: ChatMessage) => void): () => void {
  if (MOCK) {
    mock.messageListeners.add(handler);
    return () => { mock.messageListeners.delete(handler); };
  }
  real.messageListeners.add(handler);
  return () => { real.messageListeners.delete(handler); };
}

/** Load recent history for one conversation, oldest first. */
export async function getHistory(input: { conversation: Conversation; limit: number; before?: number }): Promise<ChatMessage[]> {
  if (MOCK) {
    const me = mock.me;
    if (!me) return [];
    const { conversation, limit, before } = input;
    return readStore()
      .filter((r) => (before === undefined || r.sentAt < before))
      .filter((r) => conversation.type === "group"
        ? r.kind === "group" && r.target === conversation.id
        : r.kind === "direct" && ((r.senderId === me && r.target === conversation.id) || (r.senderId === conversation.id && r.target === me)))
      .sort((a, b) => a.sentAt - b.sentAt)
      .slice(-limit)
      .map((r) => toChatMessage(r, me));
  }
  const me = real.me;
  if (!me) throw new Error("Not connected to chat");
  const query = BaseChannel.createMessagesQuery({
    channelIdentifier: channelFor(input.conversation).identifier,
    startTime: input.before ?? Date.now(), pageSize: Math.min(Math.max(input.limit, 1), 100), isAscending: false,
  });
  const res = await query.loadNextPage();
  if (!res.isOk || !res.data) throw new Error(`Could not load chat history (code ${res.code})`);
  return res.data.data
    .map((m) => fromNcMessage(m, me))
    .filter((m): m is ChatMessage => m !== null)
    .sort((a, b) => a.sentAt - b.sentAt);
}
