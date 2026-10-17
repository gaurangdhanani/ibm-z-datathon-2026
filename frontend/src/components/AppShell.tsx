import { useState } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router";
import type { ReactNode } from "react";
import { ChevronDown, LogOut } from "lucide-react";

import { BRAND } from "../lib/brand";
import { STAFF_ROLE_LABEL, useAuth } from "../lib/auth";
import type { Role } from "../lib/auth";
import { useLiveEvents } from "../lib/live";
import { Avatar, FullPage, Spinner, cx } from "./ui";

const NAV: Record<Exclude<Role, "patient">, Array<{ to: string; label: string; end?: boolean }>> = {
  // The hospital workspace is one screen (mockup page 3): patients, requests and lookups together.
  staff: [{ to: "/hospital", label: "My patients", end: true }],
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

/** Desktop shell for hospital staff and demo control (mockup page 3: brand left, account menu
 *  right with name, role and hospital). Patients get PatientShell. */
export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  // VLT-9: staff hear about their own access; demo control hears everything (S1 live feed).
  useLiveEvents(
    user?.role === "staff" ? "/api/hospital/events" : user?.role === "admin" ? "/api/admin/events" : null,
  );
  if (!user || user.role === "patient") return null;

  const subtitle =
    user.role === "staff"
      ? `${user.staff_role ? STAFF_ROLE_LABEL[user.staff_role] : "Staff"} · ${user.hospital_name}`
      : "Demo control";
  const items = NAV[user.role];

  return (
    <div className="min-h-screen">
      <header className="border-b border-sage-200 bg-cream">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <NavLink to="/" className="font-serif text-2xl text-forest-900">
            {BRAND}
          </NavLink>
          {items.length > 1 && (
            <nav className="flex flex-wrap gap-1 text-sm">
              {items.map((item) => (
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
          )}
          <div className="relative ml-auto">
            <button
              type="button"
              aria-label="Account menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              className={cx(
                "flex items-center gap-3 rounded-xl px-2 py-1 text-left hover:bg-sage-100",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-800",
              )}
            >
              <Avatar name={user.full_name} className="h-9 w-9 text-xs" />
              <span className="leading-tight">
                <span className="flex items-center gap-1 text-sm font-medium text-ink">
                  {user.full_name}
                  <ChevronDown size={14} className={cx("transition", menuOpen && "rotate-180")} />
                </span>
                <span className="block text-xs text-ink/60">{subtitle}</span>
              </span>
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} aria-hidden />
                <div role="menu" className="absolute top-12 right-0 z-40 w-56 rounded-2xl bg-cream p-2 shadow-lg ring-1 ring-sage-200">
                  <div className="px-3 py-2">
                    <p className="font-medium text-ink">{user.full_name}</p>
                    <p className="text-xs text-ink/60">{subtitle}</p>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => logout().then(() => navigate("/login", { replace: true }))}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-ink hover:bg-sage-100"
                  >
                    <LogOut size={16} /> Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
