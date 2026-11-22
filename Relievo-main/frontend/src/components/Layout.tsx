import type { ReactNode } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { BarChart3, Boxes, HeartHandshake, LayoutDashboard, ListChecks, LogOut, MessageSquare, PlusCircle, Route, ShieldAlert, Users, type LucideIcon } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { HOME, type Role, type User } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NeuToggle, SkeletonList, ThemeToggle } from "@/components/kit";
import { AlertModal, LoginSummary, NotificationBell } from "@/components/notifications";
import { SosButton } from "@/components/Sos";
import { isMockChat } from "@/integrations/nexconnClient";
import { NotificationsProvider, useNotifications } from "@/lib/notifications";
import { useLargeText } from "@/lib/prefs";
import { cn } from "@/lib/utils";

const NAV: Record<Role, Array<[string, string, LucideIcon]>> = {
  citizen: [["/citizen", "My requests", ListChecks], ["/citizen/new", "New request", PlusCircle]],
  volunteer: [["/volunteer", "My assignments", HeartHandshake], ["/hub", "Volunteer Hub", Users], ["/messages", "Messages", MessageSquare]],
  coordinator: [["/coordinator", "Command centre", LayoutDashboard], ["/dispatch", "Dispatch board", Route], ["/hub", "Volunteer Hub", Users], ["/messages", "Messages", MessageSquare], ["/impact", "Impact", BarChart3], ["/resources", "Resources", Boxes]],
  ngo: [["/resources", "Resources", Boxes]],
};

/** Small unread-count badge used on nav links. */
export const CountBadge = ({ n, label }: { n: number; label: string }) =>
  n > 0 ? (
    <span aria-label={`${n} unread ${label}`} className="ml-0.5 grid min-w-[1.15rem] place-items-center rounded-full px-1 text-[0.65rem] font-bold leading-[1.15rem]"
      style={{ background: "var(--brand-solid)", color: "var(--brand-ink)" }}>{n > 99 ? "99+" : n}</span>
  ) : null;

function Shell({ user }: { user: User }) {
  const { signOut } = useAuth();
  const [large, setLarge] = useLargeText();
  const { pathname } = useLocation();
  const { chatUnread, chatUnreadTotal, rooms } = useNotifications();
  const hubId = rooms.find((r) => r.kind === "hub")?.groupId;

  return (
    <div className="app-root mesh" data-role={user.role}>
      <header className="glass sticky top-0 z-[1100] rounded-none border-x-0 border-t-0">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
          <Link to={HOME[user.role]} className="flex items-center gap-2 font-display text-lg font-bold" style={{ color: "var(--text)" }}>
            <ShieldAlert className="size-6 text-brand" aria-hidden /> Relievo
          </Link>
          <nav aria-label="Main" className="order-last flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
            {NAV[user.role].map(([to, text, Icon]) => (
              <NavLink key={to} to={to} end
                className={({ isActive }) => cn("flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
                  isActive ? "bg-[var(--pill-ember-bg)] font-semibold text-[var(--pill-ember-fg)]" : "hover:bg-[var(--surface-2)]")}>
                <Icon className="size-4" aria-hidden />{text}
                {to === "/messages" && <CountBadge n={chatUnreadTotal} label="chats" />}
                {to === "/hub" && hubId && <CountBadge n={chatUnread[`group:${hubId}`] ?? 0} label="Hub chats" />}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
            {isMockChat && <span className="pill tone-amber whitespace-nowrap" title="Chat is simulated, not Nexconn">MOCK CHAT</span>}
            {user.role === "citizen" && <SosButton />}
            {user.role !== "ngo" && <NotificationBell />}
            <ThemeToggle />
            <label className="flex items-center gap-2 whitespace-nowrap text-sm font-medium">
              Large text
              <NeuToggle checked={large} onChange={setLarge} label="Large text" />
            </label>
            <span className="hidden items-center gap-1.5 text-sm md:flex">{user.name} <Badge tone="ember">{user.role}</Badge></span>
            <Button variant="outline" size="sm" className="whitespace-nowrap" onClick={signOut}><LogOut className="size-4" aria-hidden />Sign out</Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <div key={pathname} className="page-enter"><Outlet /></div>
      </main>
      <AlertModal />
      <LoginSummary />
    </div>
  );
}

export function Layout() {
  const { user, loading } = useAuth();
  if (loading) return <div className="app-root p-6"><SkeletonList rows={3} /></div>;
  if (!user) return <Navigate to="/login" replace />;
  // The provider lives here, so notifications and the single chat connection start right after sign-in and stop at sign-out.
  return <NotificationsProvider><Shell user={user} /></NotificationsProvider>;
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  if (user && !roles.includes(user.role)) return <Navigate to={HOME[user.role]} replace />;
  return <>{children}</>;
}
