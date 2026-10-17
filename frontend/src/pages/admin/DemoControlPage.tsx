import { useState } from "react";
import { Crosshair, Play, RotateCcw } from "lucide-react";

import { Badge, Banner, Button, Card, ConfirmDialog, ErrorState, LoadingCards, PageHeader, RiskBadge, cx } from "../../components/ui";
import { adminApi, useResource } from "../../lib/data";
import type { Scenario, ScenarioResult } from "../../lib/types";
import { ReasonList } from "../patient/reasons";

const OUTCOME: Record<ScenarioResult["outcome"], { label: string; status: "active" | "revoked" | "frozen" }> = {
  allowed: { label: "Allowed", status: "active" },
  denied: { label: "Denied", status: "revoked" },
  frozen: { label: "Blocked and frozen", status: "frozen" },
};

function ResultCard({ result }: { result: ScenarioResult }) {
  const o = OUTCOME[result.outcome];
  return (
    <div
      className={cx(
        "mt-3 rounded-xl border p-3 text-sm",
        result.outcome === "frozen" ? "border-amber-300 bg-amber-50" : result.outcome === "denied" ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50",
      )}
      role="status"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge status={o.status}>{o.label}</Badge>
        <RiskBadge level={result.risk_level} />
        <span className="text-ink/80">
          {result.actor} · {result.summary}
        </span>
      </div>
      <p className="mt-2 text-ink/80">What the hospital screen says: "{result.message}"</p>
      {result.reasons.length > 0 && (
        <div className="mt-2">
          <p className="mb-1 text-xs font-medium tracking-wide text-ink/60 uppercase">What the patient is told</p>
          <ReasonList reasons={result.reasons} />
        </div>
      )}
    </div>
  );
}

function ScenarioCard({ scenario, result, busy, onFire }: { scenario: Scenario; result?: ScenarioResult; busy: boolean; onFire: () => void }) {
  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl leading-tight text-ink">{scenario.title}</h2>
          <p className="mt-0.5 text-xs text-ink/60">
            As {scenario.actor} · expected: {scenario.expected}
          </p>
        </div>
        <Button onClick={onFire} disabled={busy || !scenario.ready} title={scenario.ready ? "Fire this scenario" : scenario.hint ?? ""}>
          <Play size={16} /> {busy ? "Firing…" : "Fire"}
        </Button>
      </div>
      <p className="mt-2 text-sm text-ink/80">{scenario.description}</p>
      {scenario.hint && (
        <div className="mt-2">
          <Banner tone={scenario.ready ? "info" : "warning"}>{scenario.hint}</Banner>
        </div>
      )}
      {result && <ResultCard result={result} />}
    </Card>
  );
}

/** S5 attacker panel: fire the rule-based scenarios server-side as their persona, then watch the
 *  patient's phone react. S6 reset reloads the seed without signing anyone out. */
export default function DemoControlPage() {
  const scenarios = useResource(() => adminApi.getScenarios(), []);
  const [results, setResults] = useState<Record<string, ScenarioResult>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  async function fire(s: Scenario) {
    setBusy(s.id);
    setError(null);
    try {
      const result = await adminApi.runScenario(s.id);
      setResults((r) => ({ ...r, [s.id]: result }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That scenario failed to run.");
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    setBusy("reset");
    setError(null);
    try {
      await adminApi.reset();
      setResults({});
      setResetDone(true);
      setConfirmReset(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Demo control"
        subtitle="Attacker panel: each card fires a real read through the broker as that staff member. Keep Maya's phone open on Alerts."
        actions={
          <Button variant="danger-outline" onClick={() => setConfirmReset(true)} disabled={busy !== null}>
            <RotateCcw size={16} /> Reset demo
          </Button>
        }
      />
      {error && (
        <div className="mb-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}
      {resetDone && (
        <div className="mb-4">
          <Banner tone="success">Demo data reset: Maya's vault is back at Northside with Riverbend's request pending. Nobody was signed out.</Banner>
        </div>
      )}
      {scenarios.error && !scenarios.data ? (
        <ErrorState error={scenarios.error} onRetry={scenarios.reload} />
      ) : !scenarios.data ? (
        <LoadingCards count={4} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {scenarios.data.map((s) => (
            <ScenarioCard key={s.id} scenario={s} result={results[s.id]} busy={busy === s.id} onFire={() => fire(s)} />
          ))}
        </div>
      )}
      <p className="mt-4 flex items-center gap-2 text-sm text-ink/60">
        <Crosshair size={16} /> Rules (RUL-1): clerical role on a sensitive record freezes the key at once (HIGH); off-hours and
        emergency reads are allowed but flagged (MEDIUM); a revoked or missing key is denied.
      </p>
      <ConfirmDialog
        open={confirmReset}
        title="Reset the demo data?"
        confirmLabel="Reset"
        tone="danger"
        busy={busy === "reset"}
        error={error}
        onCancel={() => setConfirmReset(false)}
        onConfirm={reset}
      >
        Every vault, grant, alert and log entry goes back to the seed. Signed-in devices stay signed in.
      </ConfirmDialog>
    </>
  );
}
