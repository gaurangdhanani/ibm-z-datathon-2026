import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { ArrowRight, HeartPulse, Leaf, Shield, Stethoscope, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { api } from "../lib/api";
import { STAFF_ROLE_LABEL, homeFor, useAuth } from "../lib/auth";
import type { Persona, User as SessionUser } from "../lib/auth";
import { BRAND } from "../lib/brand";
import { Banner, Button, FullPage, Input, Spinner, cx } from "../components/ui";

const DEMO_PASSWORD = "onetrace-demo";

function personaIcon(p: Persona): LucideIcon {
  if (p.role === "admin") return Shield;
  if (p.staff_role === "physician") return Stethoscope;
  if (p.staff_role === "nurse") return HeartPulse;
  return User;
}

function personaSubtitle(p: Persona): string {
  if (p.role === "staff") return `${p.staff_role ? STAFF_ROLE_LABEL[p.staff_role] : "Staff"} · ${p.hospital_name ?? ""}`;
  if (p.role === "admin") return "Demo control";
  return p.description;
}

/** Staff login from mockup page 3: brand panel on the left, demo accounts and the email form on
 *  the right. P1 one-click personas (patients, staff, demo control) and H1 email + password. */
export default function LoginPage() {
  const { user, loading, login, demoLogin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // persona key or "staff" while signing in

  useEffect(() => {
    api<Persona[]>("/api/auth/personas")
      .then(setPersonas)
      .catch(() => setPersonas([]));
  }, []);

  if (loading) {
    return (
      <FullPage>
        <Spinner />
      </FullPage>
    );
  }
  // Only return to a remembered page if it belongs to this role; otherwise a patient who signed
  // out on /patient/alerts would send the next staff sign-in straight to "Not allowed".
  const from = (location.state as { from?: string } | null)?.from;
  const landing = (u: SessionUser) => (from && from.startsWith(homeFor(u)) ? from : homeFor(u));
  if (user) return <Navigate to={landing(user)} replace />;

  async function signIn(key: string, action: () => Promise<SessionUser>) {
    setBusy(key);
    setError(null);
    try {
      const signedIn = await action();
      navigate(landing(signedIn), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setBusy(null);
    }
  }

  function submitStaff(event: FormEvent) {
    event.preventDefault();
    void signIn("staff", () => login(email.trim(), password));
  }

  const demo = personas ?? [];
  const sections: Array<[string, Persona[]]> = [
    ["Patients", demo.filter((p) => p.role === "patient")],
    ["Hospital staff", demo.filter((p) => p.role === "staff")],
    ["Demo control", demo.filter((p) => p.role === "admin")],
  ];

  const personaButton = (p: Persona) => {
    const Icon = personaIcon(p);
    return (
      <button
        key={p.key}
        type="button"
        disabled={busy !== null}
        onClick={() => void signIn(p.key, () => demoLogin(p.key))}
        className={cx(
          "flex w-full items-center gap-3 rounded-xl border bg-white/80 px-3 py-2.5 text-left transition",
          "hover:border-forest-700 hover:bg-forest-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-800",
          "disabled:opacity-60",
          busy === p.key ? "border-forest-700 bg-forest-50" : "border-sage-200",
        )}
      >
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sage-100 text-forest-900">
          <Icon size={22} strokeWidth={1.8} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-serif text-lg leading-tight text-ink">{p.full_name}</span>
          <span className="block truncate text-xs text-ink/60">{personaSubtitle(p)}</span>
        </span>
        {busy === p.key && <Spinner label="" />}
      </button>
    );
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4 sm:p-8">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-3xl bg-cream shadow-xl ring-1 ring-sage-200 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)]">
        <aside className="relative overflow-hidden border-b border-sage-200 bg-sage-50 p-8 md:border-r md:border-b-0 md:p-10">
          <div className="relative z-10 flex h-full flex-col justify-center">
            <h1 className="font-serif text-5xl text-forest-900">{BRAND}</h1>
            <p className="mt-3 max-w-[14rem] text-lg leading-snug text-ink/70">Transparent access for better care</p>
          </div>
          <Leaf aria-hidden size={260} strokeWidth={0.6} className="absolute -bottom-16 -left-10 text-forest-700/15" />
        </aside>

        <section className="p-6 sm:p-10">
          <h2 className="font-serif text-3xl text-forest-900">Sign in to your account</h2>
          <p className="mt-1 text-sm text-ink/70">Select a demo account or enter your credentials</p>

          {error && (
            <div className="mt-4">
              <Banner tone="danger">{error}</Banner>
            </div>
          )}

          <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="flex flex-col gap-4" aria-label="Demo accounts">
              {personas === null ? (
                <Spinner label="Loading demo accounts" />
              ) : demo.length === 0 ? (
                <p className="text-sm text-ink/60">Demo accounts are switched off on this server.</p>
              ) : (
                sections
                  .filter(([, list]) => list.length > 0)
                  .map(([title, list]) => (
                    <div key={title}>
                      <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink/60 uppercase">{title}</h3>
                      <div className="flex flex-col gap-2">{list.map(personaButton)}</div>
                    </div>
                  ))
              )}
            </div>

            <form onSubmit={submitStaff} className="flex flex-col gap-3 lg:border-l lg:border-sage-200 lg:pl-8" aria-label="Hospital staff sign-in">
              <p className="text-sm text-ink/70">Or sign in with your email</p>
              <label htmlFor="login-email" className="mt-2 text-sm font-medium text-ink">
                Email
              </label>
              <Input
                id="login-email"
                type="email"
                name="email"
                autoComplete="username"
                placeholder="name@hospital.example"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <label htmlFor="login-password" className="mt-1 text-sm font-medium text-ink">
                Password
              </label>
              <Input
                id="login-password"
                type="password"
                name="password"
                autoComplete="current-password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <Button type="submit" size="lg" className="mt-3" disabled={busy !== null}>
                {busy === "staff" ? "Signing in…" : "Sign in"} <ArrowRight size={18} />
              </Button>
              {demo.length > 0 && (
                <p className="text-xs text-ink/60">
                  Demo: any staff account, e.g. <code>elena.vasquez@northside.example</code>, password{" "}
                  <code>{DEMO_PASSWORD}</code>.
                </p>
              )}
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
