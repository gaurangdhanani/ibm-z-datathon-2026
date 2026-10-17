import { useState } from "react";
import { Link, useParams } from "react-router";
import { Ban, ChevronLeft, Eye, KeyRound, Lock } from "lucide-react";

import { GroupByChips, RecordBody, RecordGroups } from "../../components/records";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  LoadingCards,
  SensitivityBadge,
  Skeleton,
  SyntheticBadge,
  Tag,
  cx,
} from "../../components/ui";
import { ApiError } from "../../lib/api";
import { hospitalApi, useResource } from "../../lib/data";
import { formatDate } from "../../lib/format";
import type { BlockedCode, GroupBy } from "../../lib/types";
import { KEY_STATUS } from "./PatientsPage";

const BLOCKED: Record<BlockedCode, { tone: string; icon: typeof Lock; title: string; body: string }> = {
  access_frozen: {
    tone: "border-amber-300 bg-amber-50 text-amber-950",
    icon: Lock,
    title: "Access frozen",
    body: "Access frozen by the patient's security system after unusual activity. The patient has been notified.",
  },
  access_revoked: {
    tone: "border-red-300 bg-red-50 text-red-950",
    icon: Ban,
    title: "Access revoked",
    body: "This patient moved their records to another hospital. Your key no longer works.",
  },
  no_grant: {
    tone: "border-sage-300 bg-cream text-ink",
    icon: KeyRound,
    title: "No key for this patient",
    body: "Your hospital doesn't hold a key to this patient's vault. You can ask them for access.",
  },
};

function blockedCode(error: Error | null): BlockedCode | null {
  return error instanceof ApiError && error.code && error.code in BLOCKED ? (error.code as BlockedCode) : null;
}

/** H4 frozen and H5 revoked: a full panel, never any record content. */
function AccessBlocked({ code }: { code: BlockedCode }) {
  const b = BLOCKED[code];
  const Icon = b.icon;
  return (
    <div role="alert" className={cx("flex flex-col items-center gap-3 rounded-2xl border p-10 text-center", b.tone)}>
      <Icon size={40} />
      <h2 className="font-serif text-2xl">{b.title}</h2>
      <p className="max-w-md">{b.body}</p>
      <p className="text-xs opacity-70">This attempt was logged and is visible to the patient.</p>
      {code === "no_grant" && (
        <Link to="/hospital/requests" className="font-medium text-forest-800 underline">
          Request access
        </Link>
      )}
    </div>
  );
}

function Viewer({ recordId, onBlocked }: { recordId: number; onBlocked: (code: BlockedCode) => void }) {
  const content = useResource(
    () =>
      hospitalApi.readRecord(recordId).catch((err: Error) => {
        const code = blockedCode(err);
        if (code) onBlocked(code);
        throw err;
      }),
    [recordId],
    { live: false },
  );
  if (content.error) return blockedCode(content.error) ? null : <ErrorState error={content.error} onRetry={content.reload} />;
  if (!content.data) return <Skeleton className="h-48" />;
  const { record } = content.data;
  return (
    <>
      <h2 className="font-serif text-2xl leading-tight text-ink">{record.title}</h2>
      <p className="mt-1 text-sm text-ink/70">
        {formatDate(record.tags?.date_of_service ?? record.created_at)}
        {record.tags?.doctor && ` · ${record.tags.doctor}`}
        {record.source_hospital && ` · ${record.source_hospital}`}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <SensitivityBadge level={record.sensitivity} />
        {record.tags?.labels.map((l) => <Tag key={l}>{l}</Tag>)}
      </div>
      <div className="mt-4 border-t border-sage-200 pt-4">
        <RecordBody content={content.data} />
      </div>
    </>
  );
}

/** H3 patient record view with grouping and a viewer panel; H4/H5 when the key no longer works. */
export default function PatientRecordsPage() {
  const params = useParams();
  const patientId = Number(params.patientId);
  const recordId = params.recordId ? Number(params.recordId) : null;
  const [by, setBy] = useState<GroupBy>("body_part");
  const view = useResource(() => hospitalApi.getPatientGroups(patientId, by), [patientId, by]);
  const [readBlocked, setReadBlocked] = useState<{ recordId: number; code: BlockedCode } | null>(null);

  const blocked = blockedCode(view.error) ?? (readBlocked?.recordId === recordId ? readBlocked.code : null);
  const patient = view.data?.patient;

  return (
    <>
      <Link to="/hospital" className="-ml-1 inline-flex items-center gap-1 text-sm text-ink/70 hover:text-ink">
        <ChevronLeft size={18} /> My patients
      </Link>

      {blocked ? (
        <div className="mt-4">
          <AccessBlocked code={blocked} />
        </div>
      ) : view.error && !view.data ? (
        <div className="mt-4">
          <ErrorState error={view.error} onRetry={view.reload} />
        </div>
      ) : !patient ? (
        <div className="mt-4">
          <LoadingCards count={2} />
        </div>
      ) : (
        <>
          <Card className="mt-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <h1 className="font-serif text-[1.75rem] leading-tight text-ink">{patient.full_name}</h1>
              <Badge status={KEY_STATUS[patient.key_status].status}>Key {KEY_STATUS[patient.key_status].label.toLowerCase()}</Badge>
              <SyntheticBadge />
            </div>
            <p className="mt-1 text-sm text-ink/70">
              {patient.mrn} · Born {formatDate(patient.date_of_birth)}
            </p>
          </Card>

          <p className="mt-3 flex items-center gap-2 rounded-lg bg-sky-50 px-4 py-2.5 text-sm text-sky-950 ring-1 ring-sky-200">
            <Eye size={18} className="shrink-0" /> Every record you open is logged and visible to the patient.
          </p>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div>
              <GroupByChips value={by} onChange={setBy} />
              <div className="mt-3">
                {view.data!.groups.length === 0 ? (
                  <EmptyState title="This vault has no records yet" />
                ) : (
                  <RecordGroups
                    key={by}
                    groups={view.data!.groups}
                    selectedId={recordId ?? undefined}
                    hrefFor={(r) => `/hospital/patients/${patientId}/records/${r.id}`}
                  />
                )}
              </div>
            </div>
            <Card className="self-start lg:sticky lg:top-4">
              {recordId ? (
                <Viewer
                  key={recordId}
                  recordId={recordId}
                  onBlocked={(code) => setReadBlocked({ recordId, code })}
                />
              ) : (
                <EmptyState title="Select a record to open it" hint="Opening a record decrypts it through the broker and logs the read." />
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
