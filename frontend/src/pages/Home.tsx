import { useState } from "react";
import { Link, Navigate } from "react-router";

import { homeFor, useAuth } from "../lib/auth";
import { USE_MOCK } from "../lib/data";
import { resetMock } from "../lib/mock";
import { Banner, Button, Card, EmptyState, FullPage, PageHeader, Spinner } from "../components/ui";

/** "/" sends each role to its home. */
export function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <FullPage>
        <Spinner />
      </FullPage>
    );
  }
  return <Navigate to={user ? homeFor(user) : "/login"} replace />;
}

/** Stand-in for a screen another ticket delivers; keeps every route reachable from day one. */
export function Placeholder({ title, ticket, hint }: { title: string; ticket: string; hint?: string }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState title={`Coming in ${ticket}`} hint={hint} />
    </>
  );
}

export function AdminHome() {
  const [done, setDone] = useState(false);
  return (
    <>
      <PageHeader title="Demo control" subtitle="Attacker panel, scenarios and demo reset" />
      {USE_MOCK && (
        <Card title="Mock data" className="mb-4">
          <p className="text-sm text-ink/75">
            Patient and hospital screens run on mock data in this browser until their endpoints
            exist. Reset it to the seeded demo state (Maya's vault at Northside, Riverbend's pending
            request).
          </p>
          <div className="mt-3 flex items-center gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                resetMock();
                setDone(true);
              }}
            >
              Reset mock data
            </Button>
            {done && <Banner tone="success">Mock data reset.</Banner>}
          </div>
        </Card>
      )}
      <EmptyState title="Coming in S5 / S6" />
    </>
  );
}

export function Forbidden() {
  return (
    <FullPage>
      <Card title="Not allowed">
        <p className="text-sm text-ink/70">Your account cannot open this page.</p>
        <Link to="/" className="mt-3 inline-block text-sm font-medium text-forest-800 hover:underline">
          Back to my home
        </Link>
      </Card>
    </FullPage>
  );
}

export function NotFound() {
  return (
    <FullPage>
      <Card title="Page not found">
        <p className="text-sm text-ink/70">Nothing lives at this address.</p>
        <Link to="/" className="mt-3 inline-block text-sm font-medium text-forest-800 hover:underline">
          Back to my home
        </Link>
      </Card>
    </FullPage>
  );
}
