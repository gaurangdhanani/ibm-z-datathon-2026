import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";

import { api } from "../lib/api";
import { STAFF_ROLE_LABEL, homeFor, useAuth } from "../lib/auth";
import type { Persona, User } from "../lib/auth";
import { BRAND } from "../lib/brand";
import { Avatar, Banner, Button, Card, FullPage, Input, Spinner } from "../components/ui";

const DEMO_PASSWORD = "medvault-demo";

/** P1 demo login (one click per persona) and H1 staff login (email + password) on one page. */
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
  const landing = (u: User) => (from && from.startsWith(homeFor(u)) ? from : homeFor(u));
  if (user) return <Navigate to={landing(user)} replace />;

  async function signIn(key: string, action: () => Promise<User>) {
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
  const patients = demo.filter((p) => p.role === "patient");
  const admins = demo.filter((p) => p.role === "admin");
  const hospitals = [...new Set(demo.filter((p) => p.role === "staff").map((p) => p.hospital_name))];

  const personaButton = (p: Persona) => (
    <button
      key={p.key}
      type="button"
      disabled={busy !== null}
      onClick={() => void signIn(p.key, () => demoLogin(p.key))}
      className="flex items-center gap-3 rounded-xl border border-sage-200 bg-white/70 px-3 py-2 text-left hover:border-forest-700 hover:bg-forest-50 disabled:opacity-60"
    >
      <Avatar name={p.full_name} className="h-9 w-9 text-xs" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink">{p.full_name}</span>
        <span className="block text-xs text-ink/60">
          {p.staff_role ? STAFF_ROLE_LABEL[p.staff_role] : p.description}
        </span>
      </span>
      {busy === p.key && <Spinner label="" />}
    </button>
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="mb-8 text-center">
        <h1 className="font-serif text-4xl text-forest-900">{BRAND}</h1>
        <p className="mt-2 text-ink/70">
          Your medical records, encrypted. You hold the key; hospitals borrow it.
        </p>
      </div>

      {error && (
        <div className="mb-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      {personas === null ? (
        <Spinner label="Loading demo accounts" />
      ) : demo.length > 0 ? (
        <>
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-ink/60 uppercase">
            Demo accounts · one click to sign in
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card title="Patients">
              <div className="flex flex-col gap-2">{patients.map(personaButton)}</div>
            </Card>
            {hospitals.map((hospital) => (
              <Card key={hospital ?? "staff"} title={hospital ?? "Hospital staff"}>
                <div className="flex flex-col gap-2">
                  {demo.filter((p) => p.role === "staff" && p.hospital_name === hospital).map(personaButton)}
                </div>
              </Card>
            ))}
            {admins.length > 0 && (
              <Card title="Demo control">
                <div className="flex flex-col gap-2">{admins.map(personaButton)}</div>
              </Card>
            )}
          </div>
        </>
      ) : null}

      <Card title="Hospital staff sign-in" className="mt-6">
        <form onSubmit={submitStaff} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <Input
            type="email"
            name="email"
            autoComplete="username"
            placeholder="name@hospital.example"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Button type="submit" disabled={busy !== null}>
            {busy === "staff" ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        {demo.length > 0 && (
          <p className="mt-3 text-xs text-ink/60">
            Demo: any account above, e.g. <code>elena.vasquez@northside.example</code>, password{" "}
            <code>{DEMO_PASSWORD}</code>.
          </p>
        )}
      </Card>
    </div>
  );
}
