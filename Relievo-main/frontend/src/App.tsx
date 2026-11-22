import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Layout, RequireRole } from "@/components/Layout";
import CommandCentre from "@/pages/CommandCentre";
import DispatchBoard from "@/pages/DispatchBoard";
import Impact from "@/pages/Impact";
import IncidentDetail from "@/pages/IncidentDetail";
import IncidentList from "@/pages/IncidentList";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import VolunteerDashboard from "@/pages/VolunteerDashboard";
import Resources from "@/pages/Resources";
import Messages from "@/pages/Messages";
import Hub from "@/pages/Hub";
import NewRequest from "@/pages/NewRequest";
import { useAuth } from "@/lib/auth";
import { HOME } from "@/lib/types";

// Dev-only gallery: `import.meta.env.DEV` is false in production builds, so the page is tree-shaken out.
const UiKit = import.meta.env.DEV ? lazy(() => import("@/pages/UiKit")) : null;

function Home() {
  const { user } = useAuth();
  return <Navigate to={user ? HOME[user.role] : "/login"} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/welcome" element={<Landing />} />
      {UiKit && <Route path="/ui-kit" element={<Suspense fallback={null}><UiKit /></Suspense>} />}
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/citizen" element={<RequireRole roles={["citizen"]}><IncidentList title="My requests" /></RequireRole>} />
        <Route path="/citizen/new" element={<RequireRole roles={["citizen"]}><NewRequest /></RequireRole>} />
        <Route path="/incidents/:id" element={<IncidentDetail />} />
        <Route path="/volunteer" element={<RequireRole roles={["volunteer"]}><VolunteerDashboard /></RequireRole>} />
        <Route path="/coordinator" element={<RequireRole roles={["coordinator"]}><CommandCentre /></RequireRole>} />
        <Route path="/dispatch" element={<RequireRole roles={["coordinator"]}><DispatchBoard /></RequireRole>} />
        <Route path="/impact" element={<RequireRole roles={["coordinator"]}><Impact /></RequireRole>} />
        <Route path="/hub" element={<RequireRole roles={["coordinator", "volunteer"]}><Hub /></RequireRole>} />
        <Route path="/messages" element={<RequireRole roles={["coordinator", "volunteer"]}><Messages /></RequireRole>} />
        <Route path="/resources" element={<RequireRole roles={["coordinator", "ngo"]}><Resources /></RequireRole>} />
      </Route>
    </Routes>
  );
}
