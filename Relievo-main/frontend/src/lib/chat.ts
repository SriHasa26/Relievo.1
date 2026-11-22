// Connects this browser tab to chat once: asks OUR backend for a token (it knows who we are),
// then hands it to the Nexconn client adapter. No Nexconn types or SDK calls live here.
import { connectNexconn, disconnectNexconn, initNexconn } from "@/integrations/nexconnClient";
import { api } from "./api";

let connecting: Promise<string> | null = null;

export function ensureConnected(): Promise<string> {
  if (!connecting) {
    connecting = (async () => {
      const { token } = await api<{ token: string; userId: string }>("/api/chat/token", { method: "POST", body: {} });
      initNexconn({ appKey: (import.meta.env.VITE_NEXCONN_APP_KEY as string | undefined) ?? "" });
      const { userId } = await connectNexconn({ token });
      return userId;
    })().catch((err) => { connecting = null; throw err; });
  }
  return connecting;
}

export async function resetChat() {
  connecting = null;
  await disconnectNexconn().catch(() => undefined);
}
