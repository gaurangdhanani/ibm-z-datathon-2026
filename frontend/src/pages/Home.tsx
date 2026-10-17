import { Link, Navigate } from "react-router";

import { homeFor, useAuth } from "../lib/auth";
import { Card, FullPage, Spinner } from "../components/ui";

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
