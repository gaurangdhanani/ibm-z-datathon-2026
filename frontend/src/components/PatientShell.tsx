import { useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { AlertTriangle, Bell, ChevronRight, Clock, Folder, KeyRound, LogOut } from "lucide-react";

import { BRAND } from "../lib/brand";
import { patientApi, useResource } from "../lib/data";
import { useAuth } from "../lib/auth";
import { MockDataPill } from "./AppShell";
import { Avatar, cx } from "./ui";

const TABS = [
  { to: "/patient", label: "Vault", icon: Folder, match: (p: string) => p === "/patient" || p.startsWith("/patient/records") },
  { to: "/patient/access", label: "Keys", icon: KeyRound, match: (p: string) => p.startsWith("/patient/access") },
  { to: "/patient/history", label: "History", icon: Clock, match: (p: string) => p.startsWith("/patient/history") },
  { to: "/patient/alerts", label: "Alerts", icon: Bell, match: (p: string) => p.startsWith("/patient/alerts") },
];

/** Phone-first patient layout from the mockup: brand header, page, four-tab bottom bar. */
export function PatientShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const alerts = useResource(() => patientApi.getAlerts(), []);
  if (!user) return null;

  const open = (alerts.data ?? []).filter((a) => a.status === "open");
  const top = open.find((a) => a.risk_level === "high") ?? open[0];

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col bg-sage-200 sm:shadow-xl">
      <header className="flex items-center justify-between gap-3 px-5 pt-5 pb-1">
        <Link to="/patient" className="font-serif text-[1.75rem] leading-none text-ink">
          {BRAND}
        </Link>
        <div className="relative flex items-center gap-2">
          <MockDataPill />
          <button
            type="button"
            aria-label="Account menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-800"
          >
            <Avatar name={user.full_name} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} aria-hidden />
              <div role="menu" className="absolute top-12 right-0 z-40 w-56 rounded-2xl bg-cream p-2 shadow-lg ring-1 ring-sage-200">
                <div className="px-3 py-2">
                  <p className="font-medium text-ink">{user.full_name}</p>
                  <p className="text-xs text-ink/60">Patient</p>
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
      </header>

      {top && !pathname.startsWith("/patient/alerts") && (
        <Link
          to="/patient/alerts"
          className={cx(
            "mx-5 mt-3 flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm shadow-sm",
            top.risk_level === "high" ? "border-amber-400 bg-amber-100 text-amber-950" : "border-amber-200 bg-amber-50 text-amber-950",
          )}
        >
          <AlertTriangle size={20} className="shrink-0 text-amber-600" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{top.title}</span>
            <span className="block truncate text-amber-900/80">{top.summary}</span>
          </span>
          <ChevronRight size={18} className="shrink-0" />
        </Link>
      )}

      <main className="flex-1 px-5 pt-3 pb-28">
        <Outlet />
      </main>

      <nav
        aria-label="Patient"
        className="fixed inset-x-0 bottom-0 z-20 mx-auto grid max-w-[480px] grid-cols-4 border-t border-sage-300 bg-cream pb-[env(safe-area-inset-bottom)]"
      >
        {TABS.map(({ to, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <NavLink
              key={to}
              to={to}
              aria-current={active ? "page" : undefined}
              className={cx(
                "relative flex flex-col items-center gap-1 py-2.5 text-xs",
                active ? "font-semibold text-forest-900" : "text-ink/60 hover:text-ink",
              )}
            >
              <Icon size={24} strokeWidth={active ? 2.4 : 1.8} />
              {label}
              {label === "Alerts" && open.length > 0 && (
                <span className="absolute top-1.5 left-1/2 ml-2 min-w-5 rounded-full bg-red-600 px-1.5 text-[11px] leading-5 font-semibold text-white">
                  {open.length}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
