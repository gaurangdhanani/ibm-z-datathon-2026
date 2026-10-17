/** The right-hand column of the hospital workspace (mockup page 3): H6 request access with a
 *  patient lookup, the emergency entry point for clinicians (page 4), and recent requests. */
import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, CheckCircle2, CircleX, Clock, Info, KeyRound, Search, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconTile,
  Input,
  LoadingCards,
  SyntheticBadge,
  Textarea,
  cx,
} from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { hospitalApi, usePolling, useResource } from "../../lib/data";
import { timeAgo } from "../../lib/format";
import { KEY_STATUS_LABEL } from "../../lib/types";
import type { LookupResult, RequestStatus } from "../../lib/types";
import { BreakGlassButton, canBreakGlass } from "./BreakGlass";

const STATUS: Record<RequestStatus, { label: string; status: "waiting" | "active" | "revoked" | "neutral"; icon: LucideIcon }> = {
  pending: { label: "Pending", status: "waiting", icon: Clock },
  approved: { label: "Approved", status: "active", icon: CheckCircle2 },
  denied: { label: "Denied", status: "revoked", icon: CircleX },
  cancelled: { label: "Cancelled", status: "neutral", icon: CircleX },
};

const MIN_REASON = 10;

/** Icon tile, serif title and a one-line subtitle: the header of every hospital card. */
export function CardHeading({
  icon,
  title,
  subtitle,
  aside,
}: {
  icon: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <IconTile className="h-11 w-11 text-forest-800">{icon}</IconTile>
      <div className="min-w-0 flex-1">
        <h2 className="font-serif text-xl leading-tight text-ink">{title}</h2>
        {subtitle && <p className="text-sm text-ink/65">{subtitle}</p>}
      </div>
      {aside}
    </div>
  );
}

export function RequestAccessCard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<LookupResult | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const matches = useResource(() => hospitalApi.lookupPatient(debounced), [debounced], { live: false });
  // "No active grant" or "Key held": the hospital's own patient list says which.
  const held = useResource(() => hospitalApi.getPatients(""), []);
  const heldStatus = selected ? held.data?.find((p) => p.patient_id === selected.patient_id)?.key_status : undefined;
  const clinician = canBreakGlass(user?.staff_role);

  function clear() {
    setSelected(null);
    setQuery("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      await hospitalApi.requestAccess(selected.patient_id, reason);
      setSent(`Request sent to ${selected.full_name}. They decide on their phone.`);
      clear();
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the request");
    } finally {
      setBusy(false);
    }
  }

  const reasonShort = reason.trim().length < MIN_REASON;

  return (
    <Card>
      <CardHeading
        icon={<KeyRound size={22} strokeWidth={1.7} />}
        title="Request patient access"
        subtitle="Send a request to access a patient's records"
      />
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label htmlFor="lookup" className="sr-only">
          Patient name or ID
        </label>
        <div className="relative">
          <Search size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink/50" />
          <Input
            id="lookup"
            type="search"
            autoComplete="off"
            placeholder="Search by name or patient ID"
            className="pl-10 pr-9"
            value={selected ? `${selected.full_name} · ${selected.mrn}` : query}
            onChange={(e) => {
              setSelected(null);
              setQuery(e.target.value);
            }}
          />
          {(selected || query) && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={clear}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1 text-ink/50 hover:bg-sage-100"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {!selected && debounced.trim().length >= 2 && (
          <ul className="flex flex-col gap-1" aria-label="Matching patients">
            {matches.data?.length === 0 && <li className="text-sm text-ink/60">No patient found.</li>}
            {matches.data?.map((m) => (
              <li key={m.patient_id}>
                <button
                  type="button"
                  onClick={() => setSelected(m)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ring-1 ring-sage-200 hover:bg-white"
                >
                  <Avatar tone="light" name={m.full_name} className="h-8 w-8 text-xs" />
                  <span className="font-medium text-ink">{m.full_name}</span>
                  <span className="text-ink/60">{m.mrn}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {selected && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white/70 p-3 ring-1 ring-sage-200">
            <Avatar tone="light" name={selected.full_name} className="h-12 w-12" />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-serif text-lg leading-tight text-ink">
                {selected.full_name} <SyntheticBadge />
              </p>
              <p className="text-sm text-ink/70">
                Patient ID: {selected.mrn}
                <span aria-hidden className="mx-1.5 text-ink/30">
                  |
                </span>
                {heldStatus ? `Key ${KEY_STATUS_LABEL[heldStatus].toLowerCase()}` : "No active grant"}
              </p>
            </div>
            <BreakGlassButton
              patientId={selected.patient_id}
              patientName={selected.full_name}
              mrn={selected.mrn}
              onDone={() => navigate(`/hospital/patients/${selected.patient_id}`)}
            />
          </div>
        )}
        {selected && clinician && (
          <p className="flex items-center gap-2 rounded-lg bg-sage-50 px-3 py-2 text-xs text-ink/70">
            <Info size={16} className="shrink-0 text-ink/50" />
            <span>
              <span className="font-semibold text-ink">ER staff only.</span> Use emergency access only for immediate
              patient care.
            </span>
          </p>
        )}

        <label htmlFor="reason" className="text-sm font-medium text-ink">
          Reason
        </label>
        <Textarea
          id="reason"
          placeholder="e.g. Continuity of care, surgical consultation…"
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <p className={cx("text-xs", reasonShort && reason ? "text-amber-800" : "text-ink/50")}>
          At least {MIN_REASON} characters. The patient sees this.
        </p>
        {error && <Banner tone="danger">{error}</Banner>}
        {sent && <Banner tone="success">{sent}</Banner>}
        <Button type="submit" size="lg" disabled={!selected || reasonShort || busy}>
          {busy ? "Sending…" : "Send request"} <ArrowRight size={18} />
        </Button>
      </form>
    </Card>
  );
}

export function RecentRequestsCard() {
  const requests = useResource(() => hospitalApi.getRequests(), []);
  usePolling(requests.reload, 3000); // VLT-5: polling, no hospital stream for request decisions

  return (
    <Card>
      <CardHeading
        icon={<Clock size={22} strokeWidth={1.7} />}
        title="Recent requests"
        aside={
          <span className="flex items-center gap-1.5 pt-1 text-xs text-ink/60">
            <span aria-hidden className="h-2 w-2 rounded-full bg-emerald-600" /> Live updates
          </span>
        }
      />
      {requests.error && !requests.data ? (
        <ErrorState error={requests.error} onRetry={requests.reload} />
      ) : !requests.data ? (
        <LoadingCards count={2} />
      ) : requests.data.length === 0 ? (
        <EmptyState title="No requests yet" hint="Requests you send show up here with the patient's decision." />
      ) : (
        <ul className="divide-y divide-sage-200">
          {requests.data.map((r) => {
            const s = STATUS[r.status];
            const Icon = s.icon;
            return (
              <li key={r.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{r.patient.full_name}</p>
                  <p className="truncate text-xs text-ink/60">{r.reason}</p>
                </div>
                <Badge status={s.status}>
                  <Icon size={13} className="mr-1" /> {s.label}
                </Badge>
                <span className="w-20 shrink-0 text-right text-xs text-ink/60">{timeAgo(r.created_at)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
