// The public route. Signed-in visitors go straight to their home; everyone else sees the landing page
// (its last section holds the demo role switcher and the email sign-in form).
import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { HOME } from "@/lib/types";
import Landing from "@/pages/Landing";

export default function Login() {
  const { user } = useAuth();
  if (user) return <Navigate to={HOME[user.role]} replace />;
  return <Landing />;
}
