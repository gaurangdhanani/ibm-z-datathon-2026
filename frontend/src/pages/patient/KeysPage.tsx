import { useState } from "react";
import { Link } from "react-router";
import { ArrowRight, Building2, Clock, KeyRound, Shield, ShieldAlert } from "lucide-react";

import {
  Badge,
  Banner,
  Button,
  Card,
  ErrorState,
  IconTile,
  PageHeader,
  SectionTitle,
  Skeleton,
} from "../../components/ui";
import { patientApi, useResource } from "../../lib/data";
import { formatDate, formatWhen } from "../../lib/format";
import type { Hospital, PatientRequest, RequestStatus } from "../../lib/types";
import { GrantSheet, KeySwapSheet } from "./KeyFlows";

const REQUEST_BADGE: Record<RequestStatus, Parameters<typeof Badge>[0]["status"]> = {
  pending: "pending",
  approved: "active",
  denied: "revoked",
  cancelled: "neutral",
};

/** `from` is captured when the swap starts: the vault refetches mid-animation and would show B as the old holder. */
type Flow = { kind: "grant" | "swap"; preselect: Hospital | null; requestId: number | null; from: Hospital | null } | null;

/** P7 who has my key, P8 grant, P9 approve/deny requests, P10 move hospitals. */
export default function KeysPage() {
  const vault = useResource(() => patientApi.getVault(), []);
  const requests = useResource(() => patientApi.getRequests(), []);
  const hospitals = useResource(() => patientApi.listHospitals(), []);
  const [flow, setFlow] = useState<Flow>(null);
  const [denying, setDenying] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const grant = vault.data?.current_grant ?? null;
  const pending = (requests.data ?? []).filter((r) => r.status === "pending");
  const decided = (requests.data ?? []).filter((r) => r.status !== "pending").slice(0, 3);

  function approve(r: PatientRequest) {
    setActionError(null);
    setFlow({ kind: grant ? "swap" : "grant", preselect: r.hospital, requestId: r.id, from: grant?.hospital ?? null });
  }

  async function deny(r: PatientRequest) {
    setDenying(r.id);
    setActionError(null);
    try {
      await patientApi.decideRequest(r.id, "deny");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not deny the request");
    } finally {
      setDenying(null);
    }
  }

  async function submit(h: Hospital) {
    if (flow?.requestId) return patientApi.decideRequest(flow.requestId, "approve");
    return flow?.kind === "swap" ? patientApi.transfer(h.id) : patientApi.grant(h.id);
  }

  return (
    <>
      <PageHeader title="Who has my key" subtitle="You control who can access your vault." />

      <SectionTitle className="mt-2">Current holder</SectionTitle>
      {vault.error ? (
        <ErrorState error={vault.error} onRetry={vault.reload} />
      ) : !vault.data ? (
        <Skeleton className="h-36 rounded-2xl" />
      ) : grant ? (
        <>
          <Card className="p-4">
            <div className="flex items-start gap-3">
              <IconTile>
                <Building2 size={24} strokeWidth={1.7} />
              </IconTile>
              <div className="min-w-0 flex-1">
                <p className="font-serif text-xl leading-tight text-ink">{grant.hospital.name}</p>
                <p className="text-sm text-ink/70">Granted {formatDate(grant.granted_at)}</p>
                {grant.frozen_at && <p className="text-sm text-amber-800">Frozen {formatWhen(grant.frozen_at)}</p>}
                <p className="mt-1 text-xs text-ink/50">Vault key v{vault.data.key_version}</p>
              </div>
              <Badge status={grant.status === "frozen" ? "frozen" : "active"}>
                {grant.status === "frozen" ? "Frozen" : "Active"}
              </Badge>
            </div>
            {grant.status === "frozen" && (
              <p className="mt-3 text-sm text-ink/80">
                Their reads are blocked.{" "}
                <Link to="/patient/alerts" className="font-medium text-forest-800 underline">
                  Review it in Alerts
                </Link>
              </p>
            )}
          </Card>
          <Button
            size="lg"
            className="mt-3 w-full"
            onClick={() => setFlow({ kind: "swap", preselect: null, requestId: null, from: grant.hospital })}
            disabled={!hospitals.data}
          >
            <ArrowRight size={20} /> Move to another hospital
          </Button>
        </>
      ) : (
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <IconTile>
              <KeyRound size={24} strokeWidth={1.7} />
            </IconTile>
            <p className="text-sm text-ink/80">No hospital holds a key. Only you can open your vault.</p>
          </div>
          <Button
            size="lg"
            className="mt-4 w-full"
            onClick={() => setFlow({ kind: "grant", preselect: null, requestId: null, from: null })}
            disabled={!hospitals.data}
          >
            Give a hospital access
          </Button>
        </Card>
      )}

      <SectionTitle>Access requests</SectionTitle>
      {actionError && (
        <div className="mb-2">
          <Banner tone="danger">{actionError}</Banner>
        </div>
      )}
      {requests.error && !requests.data ? (
        <ErrorState error={requests.error} onRetry={requests.reload} />
      ) : !requests.data ? (
        <Skeleton className="h-32 rounded-2xl" />
      ) : pending.length === 0 ? (
        <p className="rounded-2xl bg-cream/70 px-4 py-3 text-sm text-ink/70 ring-1 ring-sage-200">
          No pending requests. Hospitals can ask for access; only you decide.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {pending.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex items-start gap-3">
                <IconTile>
                  <Building2 size={24} strokeWidth={1.7} />
                </IconTile>
                <div className="min-w-0">
                  <p className="font-serif text-lg leading-tight text-ink">{r.hospital.name} requests access</p>
                  <p className="text-sm text-ink/75">{r.reason}</p>
                  <p className="mt-1 text-xs text-ink/55">
                    {r.requested_by} · {formatWhen(r.created_at)}
                  </p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button onClick={() => approve(r)} disabled={denying === r.id || !hospitals.data}>
                  Approve
                </Button>
                <Button variant="danger-outline" onClick={() => deny(r)} disabled={denying === r.id}>
                  {denying === r.id ? "Denying…" : "Deny"}
                </Button>
              </div>
              <p className="mt-2 text-center text-xs text-ink/60">You will confirm before access changes.</p>
            </Card>
          ))}
        </div>
      )}
      {decided.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-sm text-ink/70">
          {decided.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 px-1">
              <span className="truncate">{r.hospital.name}</span>
              <Badge status={REQUEST_BADGE[r.status]}>{r.status[0].toUpperCase() + r.status.slice(1)}</Badge>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle>Previous holders</SectionTitle>
      {vault.data && vault.data.past_grants.length === 0 ? (
        <div className="flex items-center gap-3 rounded-2xl bg-cream/70 px-4 py-3 ring-1 ring-sage-200">
          <Clock size={22} className="shrink-0 text-ink/60" />
          <p className="text-sm text-ink/70">
            No previous holders.
            <br />
            <span className="text-xs">Past hospitals will appear here.</span>
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {vault.data?.past_grants.map((g) => (
            <div key={g.id} className="flex items-center gap-3 rounded-2xl bg-cream/70 px-4 py-3 ring-1 ring-sage-200">
              <Building2 size={22} className="shrink-0 text-ink/50" />
              <div className="min-w-0 flex-1">
                <p className="text-ink">{g.hospital.name}</p>
                <p className="text-xs text-ink/60">
                  {formatDate(g.granted_at)} – {g.ended_at ? formatDate(g.ended_at) : "now"} · key destroyed
                </p>
              </div>
              <Badge status="revoked">{g.status === "transferred" ? "Moved away" : "Revoked"}</Badge>
            </div>
          ))}
        </div>
      )}

      <Link
        to="/patient/alerts"
        className="mt-4 flex items-center gap-3 rounded-2xl bg-cream/90 px-4 py-3 ring-1 ring-sage-200 hover:bg-cream"
      >
        {vault.data?.emergency ? (
          <ShieldAlert size={24} className="shrink-0 text-red-700" />
        ) : (
          <Shield size={24} className="shrink-0 text-ink/70" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block font-serif text-lg text-ink">Emergency access</span>
          <span className="block text-sm text-ink/70">
            {vault.data?.emergency
              ? `${vault.data.emergency.hospital.name} until ${formatWhen(vault.data.emergency.expires_at)}`
              : "No emergency access active."}
          </span>
        </span>
        <ArrowRight size={18} className="shrink-0 text-ink/60" />
      </Link>

      {hospitals.data && (
        <>
          <GrantSheet
            open={flow?.kind === "grant"}
            hospitals={hospitals.data}
            preselect={flow?.kind === "grant" ? flow.preselect : null}
            onSubmit={submit}
            onClose={() => setFlow(null)}
          />
          {flow?.kind === "swap" && flow.from && (
            <KeySwapSheet
              open
              from={flow.from}
              hospitals={hospitals.data}
              preselect={flow.preselect}
              onSubmit={submit}
              onClose={() => setFlow(null)}
            />
          )}
        </>
      )}
    </>
  );
}
