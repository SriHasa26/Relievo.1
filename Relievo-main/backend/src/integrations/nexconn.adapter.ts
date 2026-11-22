// The ONLY backend file that talks to Nexconn (server API). Nothing else may import Nexconn.
// MOCK_CHAT=true  -> in-memory stub (no network).
// MOCK_CHAT=false -> the real Nexconn Platform Chat API (REST + SHA1 signature, per docs.nexconn.ai/platform-chat-api).
// NEXCONN_APP_SECRET is used only here to sign requests. It is never logged or returned.
import { createHash, randomBytes } from "node:crypto";
import { config } from "../config";

export interface UserToken { userId: string; token: string }

/** Nexconn ids allow letters and digits only, so our UUIDs lose their dashes. The frontend client does the same. */
export const nexId = (id: string) => id.replace(/[^A-Za-z0-9]/g, "");

/** The sender used for system messages (incident summary). It is registered on first use. */
export const SYSTEM_USER_ID = "reliefrelaysystem";

// ---- in-memory mock state (MOCK_CHAT only) ----
interface MockGroup { name: string; ownerId: string; members: Set<string>; systemMessages: string[] }
const mockGroups = new Map<string, MockGroup>();

export function resetMockNexconn() {
  mockGroups.clear();
}
/** Test/debug helper for the mock only. Not part of the real adapter surface. */
export function mockGroupMembers(groupId: string): string[] {
  return [...(mockGroups.get(groupId)?.members ?? [])];
}

const useMock = () => config.mockChat;

// ---- real server API ----
class NexconnApiError extends Error {
  constructor(public path: string, public httpStatus: number, public code: number | undefined) {
    super(`Nexconn ${path} failed (http ${httpStatus}, code ${code ?? "n/a"})`); // never includes headers or secrets
  }
}

/** Signed POST. Tries the primary domain, then the optional backup domain when the primary is unreachable. */
async function callNexconn<T = unknown>(path: string, body: unknown): Promise<T> {
  const { nexconnAppKey: appKey, nexconnAppSecret: secret, nexconnApiDomain: primary, nexconnApiDomainBackup: backup } = config;
  if (!appKey || !secret || !primary) {
    throw new Error("Nexconn is not configured: set NEXCONN_APP_KEY, NEXCONN_APP_SECRET and NEXCONN_API_DOMAIN");
  }
  let lastError: unknown;
  for (const host of [primary, backup].filter((h): h is string => Boolean(h))) {
    const nonce = randomBytes(8).toString("hex"); // 16 chars, limit is 18
    const timestamp = String(Date.now());
    const signature = createHash("sha1").update(secret + nonce + timestamp).digest("hex");
    try {
      const res = await fetch(`https://${host}${path}`, {
        method: "POST",
        headers: { "App-Key": appKey, Nonce: nonce, Timestamp: timestamp, Signature: signature, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      const json = (await res.json().catch(() => ({}))) as { code?: number; result?: T };
      if (!res.ok || json.code !== 0) throw new NexconnApiError(path, res.status, json.code);
      return json.result as T;
    } catch (e) {
      if (e instanceof NexconnApiError) throw e; // a real answer from Nexconn: do not retry on the backup
      lastError = e; // network error or timeout: try the backup domain
    }
  }
  throw new Error(`Nexconn ${path} unreachable: ${(lastError as Error)?.message ?? "unknown error"}`);
}

async function registerUser(userId: string, name: string): Promise<string> {
  const result = await callNexconn<{ userId: string; accessToken: string }>("/v4/auth/access-token/issue", {
    userId: nexId(userId), name: name.slice(0, 64) || "user",
  });
  return result.accessToken;
}

/** Group members must be registered before they can be added. Re-registering an existing user is harmless. */
async function ensureRegistered(userIds: string[]) {
  for (const id of new Set(userIds)) await registerUser(id, id);
}

// ---- adapter functions ----

/** Issue a chat token for one app user. The frontend uses it to connect. */
export async function issueUserToken(input: { userId: string; name: string }): Promise<UserToken> {
  if (useMock()) return { userId: input.userId, token: `mock-token.${input.userId}` };
  return { userId: input.userId, token: await registerUser(input.userId, input.name) };
}

/** Register many users at once (start-up). A failure for one user does not stop the others. */
export async function registerUsers(users: Array<{ userId: string; name: string }>): Promise<{ registered: number; failed: number }> {
  if (useMock()) return { registered: users.length, failed: 0 };
  let registered = 0;
  let failed = 0;
  for (const u of users) {
    try { await registerUser(u.userId, u.name); registered++; } catch { failed++; }
  }
  return { registered, failed };
}

/** Create a group chat room. Idempotent: if the group already exists, make sure the members are in it. */
export async function createGroup(input: {
  groupId: string; name: string; ownerId: string; memberIds: string[];
  /** Set when the group probably exists already (start-up restore): try joining first, create only if that fails. */
  mayExist?: boolean;
}): Promise<{ groupId: string }> {
  if (useMock()) {
    if (!mockGroups.has(input.groupId)) {
      mockGroups.set(input.groupId, {
        name: input.name, ownerId: input.ownerId,
        members: new Set([input.ownerId, ...input.memberIds]), systemMessages: [],
      });
    }
    return { groupId: input.groupId };
  }
  const members = input.memberIds.filter((m) => m !== input.ownerId);
  await ensureRegistered([input.ownerId, ...members]);
  if (input.mayExist) {
    try { await addMembers(input.groupId, [input.ownerId, ...members]); return { groupId: input.groupId }; } catch { /* does not exist yet: create it */ }
  }
  try {
    await callNexconn("/v4/group-channel/create", {
      channelId: nexId(input.groupId), name: input.name.slice(0, 64), owner: nexId(input.ownerId), userIds: members.map(nexId),
    });
  } catch (createError) {
    // The group may already exist (for example a retry after a half-finished earlier attempt): try joining instead.
    try { await addMembers(input.groupId, [input.ownerId, ...members]); } catch { throw createError; }
  }
  return { groupId: input.groupId };
}

async function addMembers(groupId: string, userIds: string[]) {
  await callNexconn("/v4/group-channel/join", { channelId: nexId(groupId), userIds: userIds.map(nexId) });
}

export async function addMember(input: { groupId: string; userId: string }): Promise<void> {
  if (useMock()) {
    const group = mockGroups.get(input.groupId);
    if (!group) throw new Error(`Unknown group ${input.groupId}`);
    group.members.add(input.userId);
    return;
  }
  await ensureRegistered([input.userId]);
  await addMembers(input.groupId, [input.userId]);
}

export async function removeMember(input: { groupId: string; userId: string }): Promise<void> {
  if (useMock()) {
    mockGroups.get(input.groupId)?.members.delete(input.userId);
    return;
  }
  await callNexconn("/v4/group-channel/leave", { channelId: nexId(input.groupId), userIds: [nexId(input.userId)] });
}

/** Post a message from the system (e.g. the incident summary) into the group. */
export async function postSystemMessage(input: { groupId: string; text: string }): Promise<{ messageId: string }> {
  if (useMock()) {
    const group = mockGroups.get(input.groupId);
    if (!group) throw new Error(`Unknown group ${input.groupId}`);
    group.systemMessages.push(input.text);
    return { messageId: `mock-msg-${group.systemMessages.length}` };
  }
  // The server API lets a non-member send into a group, but the sender must be a registered user.
  await registerUser(SYSTEM_USER_ID, "Relievo");
  await callNexconn("/v4/group-channel/message/send", {
    fromUserId: SYSTEM_USER_ID,
    toChannelIds: [nexId(input.groupId)],
    messageType: "RC:TxtMsg",
    content: JSON.stringify({ content: input.text }),
    shouldPersist: 1,
  });
  return { messageId: "sent" }; // the response carries no message id we rely on
}
