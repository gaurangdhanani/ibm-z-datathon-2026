import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router";
import { Search } from "lucide-react";

import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingCards,
  PageHeader,
  Textarea,
  cx,
} from "../../components/ui";
import { hospitalApi, usePolling, useResource } from "../../lib/data";
import { formatWhen } from "../../lib/format";
import type { LookupResult, RequestStatus } from "../../lib/types";
import { BreakGlassButton } from "./BreakGlass";

const STATUS: Record<RequestStatus, { label: string; status: "pending" | "active" | "revoked" | "neutral" }> = {
  pending: { label: "Pending", status: "pending" },
  approved: { label: "Approved", status: "active" },
  denied: { label: "Denied", status: "revoked" },
  cancelled: { label: "Cancelled", status: "neutral" },
};

const MIN_REASON = 10;

/** H6: find a patient, ask for access with a reason; status updates while the page is open. */
export default function RequestsPage() {
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
  const requests = useResource(() => hospitalApi.getRequests(), []);
  usePolling(requests.reload, 3000); // VLT-5: polling, no hospital stream

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      await hospitalApi.requestAccess(selected.patient_id, reason);
      setSent(`Request sent to ${selected.full_name}. They decide on their phone.`);
      setSelected(null);
      setQuery("");
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the request");
    } finally {
      setBusy(false);
    }
  }

  const reasonShort = reason.trim().length < MIN_REASON;

  return (
    <>
      <PageHeader title="Access requests" subtitle="Hospitals can only ask. The patient decides." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Request access to a patient">
          <form onSubmit={submit} className="flex flex-col gap-3">
            <label htmlFor="lookup" className="text-sm font-medium text-ink">
              Patient name or MRN
            </label>
            <div className="flex items-center gap-2">
              <Search size={18} className="text-ink/50" />
              <Input
                id="lookup"
                type="search"
                autoComplete="off"
                placeholder="e.g. Maya Chen or MRN-100-2231"
                value={selected ? `${selected.full_name} · ${selected.mrn}` : query}
                onChange={(e) => {
                  setSelected(null);
                  setQuery(e.target.value);
                }}
              />
            </div>
            {!selected && debounced.trim().length >= 2 && (
              <ul className="flex flex-col gap-1" aria-label="Matching patients">
                {matches.data?.length === 0 && <li className="text-sm text-ink/60">No patient found.</li>}
                {matches.data?.map((m) => (
                  <li key={m.patient_id}>
                    <button
                      type="button"
                      onClick={() => setSelected(m)}
                      className="w-full rounded-lg px-3 py-2 text-left text-sm ring-1 ring-sage-200 hover:bg-white"
                    >
                      <span className="font-medium text-ink">{m.full_name}</span>{" "}
                      <span className="text-ink/60">{m.mrn}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <label htmlFor="reason" className="text-sm font-medium text-ink">
              Reason <span className="font-normal text-ink/60">(the patient sees this)</span>
            </label>
            <Textarea
              id="reason"
              placeholder="e.g. New patient, cardiology consult"
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className={cx("text-xs", reasonShort && reason ? "text-amber-800" : "text-ink/50")}>
              At least {MIN_REASON} characters.
            </p>
            {error && <Banner tone="danger">{error}</Banner>}
            {sent && <Banner tone="success">{sent}</Banner>}
            <Button type="submit" disabled={!selected || reasonShort || busy}>
              {busy ? "Sending…" : "Request access"}
            </Button>
            {selected && (
              <div className="flex flex-wrap items-center gap-3 border-t border-sage-200 pt-3 text-sm text-ink/70">
                <span>Can't wait for the patient?</span>
                <BreakGlassButton
                  patientId={selected.patient_id}
                  patientName={selected.full_name}
                  onDone={() => navigate(`/hospital/patients/${selected.patient_id}`)}
                />
              </div>
            )}
          </form>
        </Card>

        <Card title="Your hospital's requests">
          {requests.error && !requests.data ? (
            <ErrorState error={requests.error} onRetry={requests.reload} />
          ) : !requests.data ? (
            <LoadingCards count={2} />
          ) : requests.data.length === 0 ? (
            <EmptyState title="No requests yet" />
          ) : (
            <ul className="divide-y divide-sage-200">
              {requests.data.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">
                      {r.patient.full_name} <span className="text-xs font-normal text-ink/60">{r.patient.mrn}</span>
                    </p>
                    <p className="text-sm text-ink/75">{r.reason}</p>
                    <p className="text-xs text-ink/55">
                      {r.requested_by} · {formatWhen(r.created_at)}
                    </p>
                  </div>
                  <Badge status={STATUS[r.status].status}>{STATUS[r.status].label}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
