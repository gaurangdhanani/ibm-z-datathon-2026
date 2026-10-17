import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router";
import type { ReactNode } from "react";

import { BRAND } from "../lib/brand";
import { STAFF_ROLE_LABEL, useAuth } from "../lib/auth";
import type { Role } from "../lib/auth";
import { useLiveEvents } from "../lib/live";
import { Avatar, Button, FullPage, Spinner } from "./ui";

const NAV: Record<Exclude<Role, "patient">, Array<{ to: string; label: string; end?: boolean }>> = {
  staff: [
    { to: "/hospital", label: "My patients", end: true },
    { to: "/hospital/requests", label: "Access requests" },
  ],
  admin: [
    { to: "/admin", label: "Demo control", end: true },
    { to: "/admin/feed", label: "Live feed" },
    { to: "/admin/metrics", label: "Dashboard" },
  ],
};

/** Route wrapper: redirects anonymous users to /login and wrong roles to /forbidden. */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <FullPage>
        <Spinner />
      </FullPage>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!roles.includes(user.role)) return <Navigate to="/forbidden" replace />;
  return <>{children}</>;
}

/** Desktop shell for hospital staff and demo control. Patients get PatientShell. */
export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  // VLT-9: staff hear about their own access; demo control hears everything (S1 live feed).
  useLiveEvents(
    user?.role === "staff" ? "/api/hospital/events" : user?.role === "admin" ? "/api/admin/events" : null,
  );
  if (!user || user.role === "patient") return null;

  const subtitle =
    user.role === "staff"
      ? `${user.staff_role ? STAFF_ROLE_LABEL[user.staff_role] : "Staff"} · ${user.hospital_name}`
      : "Demo control";

  return (
    <div className="min-h-screen">
      <header className="border-b border-sage-200 bg-cream">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <NavLink to="/" className="font-serif text-2xl text-forest-900">
            {BRAND}
          </NavLink>
          <nav className="flex flex-wrap gap-1 text-sm">
            {NAV[user.role].map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 ${isActive ? "bg-forest-800 font-medium text-white" : "text-ink/70 hover:bg-sage-100"}`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <Avatar name={user.full_name} className="h-9 w-9 text-xs" />
            <div className="leading-tight">
              <div className="font-medium">{user.full_name}</div>
              <div className="text-xs text-ink/60">{subtitle}</div>
            </div>
            <Button
              variant="ghost"
              onClick={() => logout().then(() => navigate("/login", { replace: true }))}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
