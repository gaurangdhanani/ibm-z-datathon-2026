import { useState } from "react";
import { AlertTriangle, BellOff, Info, ShieldAlert } from "lucide-react";

import { Badge, Banner, Button, ConfirmDialog, EmptyState, ErrorState, LoadingCards, PageHeader, cx } from "../../components/ui";
import { patientApi, useResource } from "../../lib/data";
import { dayLabel, formatTime, formatWhen } from "../../lib/format";
import type { AlertDecision, EmergencyInfo, PatientAlert } from "../../lib/types";
import { ReasonList } from "./reasons";

const DECISION_TEXT: Record<AlertDecision, string> = {
  restore: "You restored access",
  keep_frozen: "You kept access frozen",
  looks_fine: "You marked this as fine",
  freeze: "You froze access",
};

/** Decisions that change access ask first; the others apply straight away. */
const CONFIRM: Partial<Record<AlertDecision, { title: string; body: string; label: string }>> = {
  restore: {
    title: "Restore this hospital's access?",
    body: "They will be able to open your records again. Every open stays in your access history.",
    label: "Restore access",
  },
  freeze: {
    title: "Freeze this hospital's access?",
    body: "Their reads are blocked until you restore access. They are not told why.",
    label: "Freeze access",
  },
};

function AlertCard({
  alert,
  busy,
  onDecide,
}: {
  alert: PatientAlert;
  busy: boolean;
  onDecide: (decision: AlertDecision) => void;
}) {
  const high = alert.risk_level === "high";
  const frozenStill = alert.status === "acknowledged" && (alert.decision === "keep_frozen" || alert.decision === "freeze");
  return (
    <article className={cx("rounded-2xl border p-4 shadow-sm", high ? "border-amber-300 bg-amber-50" : "border-amber-200 bg-amber-50/60")}>
      <div className="flex items-start gap-3">
        <AlertTriangle size={30} className="shrink-0 text-amber-500" fill="currentColor" stroke="white" />
        <div className="min-w-0">
          <h2 className="font-serif text-xl leading-tight text-ink">{alert.title}</h2>
          <p className="mt-1 text-[0.95rem] text-ink/85">{alert.summary}</p>
          <p className="mt-1 text-xs text-ink/55">
            {dayLabel(alert.created_at)} at {formatTime(alert.created_at)}
          </p>
        </div>
      </div>
      {alert.reasons.length > 0 && (
        <div className="mt-3 border-t border-amber-200 pt-3">
          <ReasonList reasons={alert.reasons} />
        </div>
      )}
      {alert.status === "open" && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {high ? (
            <>
              <Button onClick={() => onDecide("restore")} disabled={busy}>
                Restore access
              </Button>
              <Button variant="secondary" onClick={() => onDecide("keep_frozen")} disabled={busy}>
                Keep frozen
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => onDecide("looks_fine")} disabled={busy}>
                Looks fine
              </Button>
              <Button variant="danger-outline" onClick={() => onDecide("freeze")} disabled={busy}>
                Freeze access
              </Button>
            </>
          )}
        </div>
      )}
      {frozenStill && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-sm text-ink/70">Access is still frozen.</span>
          <Button variant="secondary" onClick={() => onDecide("restore")} disabled={busy}>
            Restore access
          </Button>
        </div>
      )}
    </article>
  );
}

function EmergencyCard({ emergency, onEnd }: { emergency: EmergencyInfo; onEnd: () => void }) {
  return (
    <article className="rounded-2xl border border-red-300 bg-red-50 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <ShieldAlert size={30} className="shrink-0 text-red-700" />
        <div className="min-w-0">
          <h2 className="font-serif text-xl leading-tight text-red-800">Emergency access active</h2>
          <p className="mt-1 text-[0.95rem] text-ink/85">
            {emergency.staff_name} · {emergency.hospital.name}
          </p>
          <p className="text-[0.95rem] text-ink/85">Reason given: "{emergency.justification}"</p>
          <p className="text-[0.95rem] text-ink/85">Expires {formatWhen(emergency.expires_at)}</p>
        </div>
      </div>
      <Button variant="danger-outline" size="lg" className="mt-4 w-full" onClick={onEnd}>
        End emergency access now
      </Button>
    </article>
  );
}

type Pending = { kind: "alert"; alert: PatientAlert; decision: AlertDecision } | { kind: "emergency"; emergency: EmergencyInfo };

/** P12 alerts with patient decisions, P13 emergency access notice. */
export default function AlertsPage() {
  const alerts = useResource(() => patientApi.getAlerts(), []);
  const vault = useResource(() => patientApi.getVault(), []);
  const [confirming, setConfirming] = useState<Pending | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(id: number, action: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await action();
      setConfirming(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Nothing changed.");
    } finally {
      setBusyId(null);
    }
  }

  function decide(alert: PatientAlert, decision: AlertDecision) {
    if (CONFIRM[decision]) setConfirming({ kind: "alert", alert, decision });
    else void run(alert.id, () => patientApi.decideAlert(alert.id, decision));
  }

  const active = (alerts.data ?? []).filter((a) => a.status !== "resolved");
  const earlier = (alerts.data ?? []).filter((a) => a.status === "resolved");
  const emergency = vault.data?.emergency ?? null;
  const confirm = confirming?.kind === "alert" ? CONFIRM[confirming.decision]! : null;

  return (
    <>
      <PageHeader title="Alerts" />
      {error && !confirming && (
        <div className="mb-3">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      {alerts.error && !alerts.data ? (
        <ErrorState error={alerts.error} onRetry={alerts.reload} />
      ) : !alerts.data ? (
        <LoadingCards count={2} />
      ) : (
        <div className="flex flex-col gap-4">
          {emergency && <EmergencyCard emergency={emergency} onEnd={() => setConfirming({ kind: "emergency", emergency })} />}
          {active.map((a) => (
            <AlertCard key={a.id} alert={a} busy={busyId === a.id} onDecide={(d) => decide(a, d)} />
          ))}
          {!emergency && active.length === 0 && (
            <EmptyState
              icon={<BellOff size={28} />}
              title="No alerts"
              hint="If anyone opens your records in an unusual way, you'll be told here right away."
            />
          )}
          <p className="flex items-center gap-2 text-sm text-ink/70">
            <Info size={18} /> Access changes require confirmation.
          </p>

          {earlier.length > 0 && (
            <section>
              <h2 className="mb-2 font-serif text-xl text-ink">Earlier</h2>
              <ul className="divide-y divide-sage-200 rounded-2xl bg-cream px-4 ring-1 ring-sage-200">
                {earlier.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                    <span className="min-w-0">
                      <span className="block truncate text-ink">{a.title}</span>
                      <span className="block text-xs text-ink/60">
                        {dayLabel(a.created_at)} · {a.decision ? DECISION_TEXT[a.decision] : "Closed after you moved hospitals"}
                      </span>
                    </span>
                    <Badge status={a.risk_level === "high" ? "frozen" : "neutral"}>{a.risk_level === "high" ? "High" : "Medium"}</Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirming?.kind === "alert"}
        title={confirm?.title ?? ""}
        confirmLabel={confirm?.label ?? ""}
        tone={confirming?.kind === "alert" && confirming.decision === "freeze" ? "danger" : "primary"}
        busy={busyId !== null}
        error={error}
        onCancel={() => setConfirming(null)}
        onConfirm={() =>
          confirming?.kind === "alert" &&
          run(confirming.alert.id, () => patientApi.decideAlert(confirming.alert.id, confirming.decision))
        }
      >
        {confirm?.body}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirming?.kind === "emergency"}
        title="End emergency access now?"
        confirmLabel="End emergency access"
        tone="danger"
        busy={busyId !== null}
        error={error}
        onCancel={() => setConfirming(null)}
        onConfirm={() =>
          confirming?.kind === "emergency" &&
          run(confirming.emergency.id, () => patientApi.endEmergency(confirming.emergency.id))
        }
      >
        The emergency team loses access straight away. Everything they opened stays in your access history.
      </ConfirmDialog>
    </>
  );
}
