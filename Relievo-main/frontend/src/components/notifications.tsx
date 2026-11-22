// Bell + panel, the red alert popup (queued) and the coordinator login summary. Motion is switched off by CSS under reduced motion.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CalendarClock, Check, MessageSquare, Siren, TriangleAlert, UserCheck, UserX, X, type LucideIcon } from "lucide-react";
import { SosAudioPlayer } from "@/components/SosAudio";
import { useToast } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useNotifications } from "@/lib/notifications";
import type { AppNotification, NotificationType } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";

const ICON: Record<NotificationType, LucideIcon> = {
  new_incident: TriangleAlert, sos: Siren, sos_audio: Siren, sos_cancelled: Check, priority_alert: TriangleAlert,
  assignment_offer: UserCheck, volunteer_accepted: UserCheck, volunteer_declined: UserX, escalation: CalendarClock,
  hub_alert: Siren, chat_message: MessageSquare,
};
const loud = (n: AppNotification) => n.priority === "critical" || n.priority === "high";
const levelLabel = (n: AppNotification) => (n.priority === "critical" ? "CRITICAL" : "HIGH");

function useOpenIncident() {
  const navigate = useNavigate();
  const { markRead } = useNotifications();
  return (n: AppNotification) => {
    void markRead([n.id]);
    if (n.incident_id) navigate(`/incidents/${n.incident_id}`);
    else if (typeof n.data.conversation === "string") navigate("/messages");
  };
}

/* ---------- bell with unread badge and the notification centre ---------- */
export function NotificationBell() {
  const { items, unread, markAllRead, respondOffer, answered } = useNotifications();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const openIt = useOpenIncident();

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const respond = async (n: AppNotification, accept: boolean) => {
    const problem = await respondOffer(n, accept);
    if (problem) toast(problem, "error"); else toast(accept ? "Assignment accepted" : "Assignment declined");
  };

  // High / Critical unread items are pinned at the top and styled red.
  const pinned = items.filter((n) => !n.read_at && loud(n));
  const rest = items.filter((n) => !pinned.includes(n));
  const row = (n: AppNotification) => {
    const Icon = ICON[n.type] ?? Bell;
    const isLoud = loud(n);
    return (
      <li key={n.id} className={cn("rounded-xl border p-2.5 text-sm", !n.read_at && "font-medium", isLoud && !n.read_at && "alert-row")}
        style={isLoud && !n.read_at ? { borderColor: "#ef4444", background: "color-mix(in srgb, #ef4444 12%, var(--surface))" } : { background: "var(--surface)" }}>
        <div className="flex items-start gap-2">
          <Icon className={cn("mt-0.5 size-4 shrink-0", isLoud && !n.read_at ? "text-red-500" : "text-brand")} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-1.5">
              {isLoud && !n.read_at && <span className="alert-tag !text-[0.65rem] !py-0">{levelLabel(n)}</span>}
              <span className="break-words">{n.title}</span>
              {!n.read_at && <i aria-label="unread" className="led tone-ember led-glow" />}
            </p>
            {n.body && <p className="line-clamp-2 text-xs muted">{n.body}</p>}
            <p className="mt-0.5 text-[0.7rem] muted">{timeAgo(n.created_at)}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {n.type === "assignment_offer" && user?.role === "volunteer" && !answered.has(n.id) && (
                <>
                  <Button size="sm" onClick={() => void respond(n, true)}>Accept</Button>
                  <Button size="sm" variant="outline" onClick={() => void respond(n, false)}>Decline</Button>
                </>
              )}
              {(n.incident_id || n.type === "chat_message") && (
                <Button size="sm" variant="outline" onClick={() => { setOpen(false); openIt(n); }}>{n.type === "chat_message" ? "Open messages" : "Open incident"}</Button>
              )}
            </div>
          </div>
        </div>
      </li>
    );
  };

  return (
    <div ref={box} className="relative">
      <button type="button" className="theme-toggle relative" aria-label={`Notifications, ${unread} unread`} aria-expanded={open} aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}>
        <Bell className="size-4" aria-hidden />
        {unread > 0 && (
          <span aria-hidden className="absolute -right-1 -top-1 grid min-w-[1.15rem] place-items-center rounded-full px-1 text-[0.65rem] font-bold leading-[1.15rem]"
            style={{ background: pinned.length ? "#dc2626" : "var(--brand-solid)", color: pinned.length ? "#fff" : "var(--brand-ink)" }}>{unread > 99 ? "99+" : unread}</span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Notification centre" className="glass absolute right-0 z-[1200] mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-2xl p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display font-semibold">Notifications</h2>
            <button type="button" className="text-xs font-semibold text-brand underline" onClick={() => void markAllRead()}>Mark all read</button>
          </div>
          {items.length === 0 && <p className="py-6 text-center text-sm muted">Nothing yet. Alerts and messages appear here.</p>}
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {pinned.map(row)}
            {rest.map(row)}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ---------- red alert popup (High / Critical), queued ---------- */
export function AlertModal() {
  const { popup, queued, dismissPopup, respondOffer, answered } = useNotifications();
  const toast = useToast();
  const openIt = useOpenIncident();
  const { dismissPopup: dismiss } = useNotifications();
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!popup) return;
    primary.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") dismissPopup(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [popup, dismissPopup]);

  if (!popup) return null;
  const transcript = typeof popup.data.transcript === "string" ? popup.data.transcript : "";
  const generic = popup.data.generic === true; // unverified volunteers: no exact location, no audio
  return (
    <>
      <div aria-hidden className="alert-glow" />
      <div className="fixed inset-0 z-[3000] grid place-items-center p-4" style={{ background: "rgb(0 0 0 / 0.55)" }}>
        <div role="alertdialog" aria-modal="true" aria-labelledby="alert-title" className="alert-banner w-full max-w-lg p-5" style={{ background: "color-mix(in srgb, #ef4444 14%, var(--surface))" }}>
          <div className="flex items-center gap-2">
            <span className="alert-tag">{levelLabel(popup)}</span>
            {popup.type === "sos" || popup.type === "sos_audio" ? <span className="pill tone-red"><i className="led led-glow led-pulse" aria-hidden />SOS</span> : null}
            {queued > 0 && <span className="ml-auto text-xs muted">{queued} more alert{queued === 1 ? "" : "s"} waiting</span>}
          </div>
          <h2 id="alert-title" className="mt-3 text-xl font-bold">{popup.title}</h2>
          {popup.body && <p className="mt-1 text-sm">{popup.body}</p>}
          {transcript && <blockquote className="mt-3 rounded-lg border-l-4 px-3 py-2 text-sm" style={{ borderColor: "#ef4444", background: "var(--surface)" }}>&ldquo;{transcript}&rdquo;</blockquote>}
          {popup.data.has_audio === true && popup.incident_id && !generic && <div className="mt-3"><SosAudioPlayer incidentId={popup.incident_id} /></div>}
          <div className="mt-5 flex flex-wrap gap-2">
            {popup.incident_id && !generic && (
              <button ref={primary} type="button" className="rr-btn btn-physical h-11 px-5 text-sm" onClick={() => { openIt(popup); dismiss(); }}>Open incident</button>
            )}
            {popup.type === "assignment_offer" && !answered.has(popup.id) && (
              <>
                <Button size="lg" onClick={() => void respondOffer(popup, true).then((e) => { if (e) toast(e, "error"); else { toast("Assignment accepted"); dismiss(); } })}>Accept</Button>
                <Button size="lg" variant="outline" onClick={() => void respondOffer(popup, false).then((e) => { if (e) toast(e, "error"); else { toast("Assignment declined"); dismiss(); } })}>Decline</Button>
              </>
            )}
            <Button ref={popup.incident_id && !generic ? undefined : primary} variant="outline" size="lg" onClick={dismissPopup}>
              <X className="size-4" aria-hidden />Dismiss
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------- coordinator: summary right after login ---------- */
export function LoginSummary() {
  const { summary, summaryOpen, closeSummary, popup } = useNotifications();
  const navigate = useNavigate();
  if (!summaryOpen || !summary || popup) return null; // alerts first; the summary waits behind them
  const go = () => { closeSummary(); navigate("/dispatch"); };
  return (
    <div className="fixed inset-0 z-[2900] grid place-items-center p-4" style={{ background: "rgb(0 0 0 / 0.5)" }}>
      <div role="dialog" aria-modal="true" aria-labelledby="summary-title" className="glass w-full max-w-md rounded-2xl p-5">
        <h2 id="summary-title" className="font-display text-xl font-bold">While you were away</h2>
        <ul className="mt-3 space-y-2 text-sm">
          <li className="flex items-center gap-2"><i className="led tone-red led-glow" aria-hidden /><b>{summary.high_or_critical_open}</b> open High / Critical incident(s)</li>
          <li className="flex items-center gap-2"><i className="led tone-ember" aria-hidden /><b>{summary.unassigned}</b> verified incident(s) without a volunteer</li>
          <li className="flex items-center gap-2"><i className="led tone-gray" aria-hidden /><b>{summary.awaiting_review}</b> report(s) waiting for verification</li>
        </ul>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button size="lg" onClick={go}>Open dispatch board</Button>
          <Button size="lg" variant="outline" onClick={closeSummary}>Close</Button>
        </div>
      </div>
    </div>
  );
}
