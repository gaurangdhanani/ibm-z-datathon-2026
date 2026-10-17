import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  AlertTriangle,
  Bone,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock,
  FileText,
  Info,
  KeyRound,
  Lock,
  ShieldAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { CATEGORY_LABEL, GroupByChips, RecordBody, RecordGroups, RecordIcon, SensitivePill } from "../../components/records";
import {
  Avatar,
  Card,
  EmptyState,
  ErrorState,
  IconTile,
  LoadingCards,
  Pill,
  SensitivityBadge,
  Skeleton,
  SyntheticBadge,
  cx,
} from "../../components/ui";
import { ApiError } from "../../lib/api";
import { hospitalApi, useResource } from "../../lib/data";
import { ageOn, countdown, formatDate } from "../../lib/format";
import type { BlockedCode, GroupBy, HospitalPatient, Reason, RecordSummary } from "../../lib/types";
import { ReasonList } from "../patient/reasons";
import { BreakGlassButton } from "./BreakGlass";

/** Calm access states (mockup page 5) plus the "no key" entry point for H6 and H7. */
const CALM: Record<BlockedCode, { border: string; icon: LucideIcon; iconClass: string; title: string; body: string }> = {
  access_frozen: {
    border: "border-amber-400",
    icon: Lock,
    iconClass: "lock-close text-amber-500",
    title: "Access paused",
    body: "Paused by the patient's security system. The patient may restore access.",
  },
  access_revoked: {
    border: "border-red-400",
    icon: KeyRound,
    iconClass: "key-crack text-red-500",
    title: "Your key no longer works",
    body: "The patient has revoked your hospital's access.",
  },
  no_grant: {
    border: "border-sage-300",
    icon: KeyRound,
    iconClass: "text-ink/50",
    title: "No key for this patient",
    body: "Your hospital doesn't hold a key to this patient's vault. Ask the patient for access, or use emergency access for immediate care.",
  },
};

type Blocked = { code: BlockedCode; recordId: number | null; reasons: Reason[] };

function blockedFrom(error: Error | null, recordId: number | null = null): Blocked | null {
  if (error instanceof ApiError && error.code && error.code in CALM) {
    return { code: error.code as BlockedCode, recordId, reasons: error.reasons };
  }
  return null;
}

function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span className="font-semibold">{countdown(until, now)}</span>;
}

function Sep() {
  return (
    <span aria-hidden className="mx-2 text-ink/30">
      |
    </span>
  );
}

const ACCESS_LABEL: Record<HospitalPatient["key_status"] | "revoked", string> = {
  active: "Active access",
  frozen: "Access paused",
  emergency: "Emergency access",
  revoked: "Access revoked",
};

/** Avatar, name, "Patient ID | DOB (age) | access state", and the right-hand pills. */
function PatientHeader({ patient, blocked }: { patient: HospitalPatient; blocked: Blocked | null }) {
  const state =
    blocked?.code === "access_frozen" ? "frozen" : blocked?.code === "access_revoked" ? "revoked" : patient.key_status;
  return (
    <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-center gap-4">
        <Avatar tone="light" name={patient.full_name} className="h-14 w-14 text-lg" />
        <div>
          <h1 className="flex flex-wrap items-center gap-2 font-serif text-[1.75rem] leading-tight text-ink">
            {patient.full_name} <SyntheticBadge />
          </h1>
          <p className="mt-1 text-sm text-ink/70">
            Patient ID: {patient.mrn}
            <Sep />
            DOB: {formatDate(patient.date_of_birth)} (age {ageOn(patient.date_of_birth)})
            <Sep />
            {ACCESS_LABEL[state]}
          </p>
        </div>
      </div>

      {state === "emergency" ? (
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex flex-wrap gap-2">
            <Pill tone="warning" icon={<Clock size={16} />}>
              Emergency access
              {patient.emergency_expires_at && (
                <>
                  {" "}
                  · <Countdown until={patient.emergency_expires_at} /> remaining
                </>
              )}
            </Pill>
            <Pill tone="warning" icon={<ShieldAlert size={16} />}>
              AI risk: Medium
            </Pill>
          </div>
          <span className="flex items-center gap-1.5 text-sm text-emerald-800">
            <CheckCircle2 size={16} /> Patient notified.
          </span>
        </div>
      ) : state === "frozen" ? (
        <div className="flex flex-wrap gap-2">
          {blocked?.recordId != null && (
            <Pill tone="danger" icon={<ShieldAlert size={16} />}>
              AI risk: High
            </Pill>
          )}
          <Pill tone="warning" icon={<AlertTriangle size={16} />}>
            Access paused
          </Pill>
        </div>
      ) : state === "active" ? (
        <div className="flex items-center gap-3 rounded-xl bg-forest-50 px-4 py-3 text-ink ring-1 ring-forest-100">
          <Lock size={22} className="shrink-0 text-forest-800" />
          <span className="font-serif text-lg leading-snug">Every record you open is logged and visible to the patient.</span>
        </div>
      ) : null}
    </div>
  );
}

/** Mockup page 4, screen 6: what a blocked read of a sensitive record looks like to the snooper. */
function SnoopingAttempt({ record, reasons }: { record: RecordSummary; reasons: Reason[] }) {
  return (
    <div className="w-full max-w-3xl">
      <div className={cx("grid gap-3", reasons.length > 0 && "md:grid-cols-2")}>
        <div className="flex items-center gap-3 rounded-2xl bg-cream p-4 ring-1 ring-sage-200">
          <IconTile>
            <RecordIcon category={record.category} />
          </IconTile>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-ink/60">Attempted record</p>
            <p className="flex flex-wrap items-center gap-2 font-serif text-xl leading-tight text-ink">
              {record.title}
              {record.sensitivity === 3 && <SensitivePill />}
            </p>
            <p className="text-sm text-ink/70">
              {CATEGORY_LABEL[record.category]} · {formatDate(record.tags?.date_of_service ?? record.created_at)}
            </p>
          </div>
        </div>
        {reasons.length > 0 && (
          <div className="rounded-2xl bg-cream p-4 ring-1 ring-sage-200">
            <p className="mb-2 font-semibold text-ink">Reason for block</p>
            <ReasonList reasons={reasons} />
          </div>
        )}
      </div>
      <div role="status" className="mt-3 flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-red-900">
        <CircleAlert size={22} className="shrink-0 text-red-700" />
        <div>
          <p className="font-serif text-lg leading-tight">Patient alerted · Attempt logged as denied.</p>
          <p className="text-sm text-red-900/80">No content displayed.</p>
        </div>
      </div>
    </div>
  );
}

/** H4 paused and H5 revoked (page 5), the no-key entry point (page 4): a calm panel over a
 *  greyed-out workspace, never any record content. A patient's freeze cannot be broken through. */
function AccessBlocked({
  blocked,
  record,
  patientId,
  onEmergency,
}: {
  blocked: Blocked;
  record: RecordSummary | null;
  patientId: number;
  onEmergency: () => void;
}) {
  const calm = CALM[blocked.code];
  const Icon = calm.icon;
  return (
    <div className="relative mt-4 min-h-[30rem] overflow-hidden">
      <div aria-hidden className="absolute inset-0 grid gap-4 opacity-60 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,0.9fr)]">
        {[6, 5, 6].map((n, col) => (
          <div key={col} className="flex flex-col gap-3 rounded-2xl bg-cream/70 p-4 ring-1 ring-sage-200">
            {Array.from({ length: n }, (_, i) => (
              <Skeleton key={i} className="h-7" />
            ))}
          </div>
        ))}
      </div>
      <div className="relative flex flex-col items-center gap-4 px-2 py-8">
        {record && <SnoopingAttempt record={record} reasons={blocked.reasons} />}
        <section
          role="alert"
          className={cx("flex w-full max-w-md flex-col items-center gap-3 rounded-2xl border-2 bg-cream p-8 text-center shadow-lg", calm.border)}
        >
          <Icon size={56} strokeWidth={1.5} className={calm.iconClass} />
          <h2 className="font-serif text-3xl text-ink">{calm.title}</h2>
          <p className="text-ink/75">{calm.body}</p>
          {blocked.code === "access_revoked" && <Pill tone="danger">AI risk: High</Pill>}
          {blocked.code === "no_grant" ? (
            <>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                <BreakGlassButton patientId={patientId} patientName={null} onDone={onEmergency} />
                <Link
                  to="/hospital"
                  className="inline-flex items-center justify-center rounded-lg bg-cream px-4 py-2 text-sm font-medium text-forest-900 ring-1 ring-forest-800 hover:bg-white"
                >
                  Request access
                </Link>
              </div>
              <p className="text-xs text-ink/55">This attempt was logged and is visible to the patient.</p>
            </>
          ) : (
            <>
              <p className="text-xs text-ink/55">Attempt logged · Patient notified</p>
              <Link
                to="/hospital"
                className="mt-1 inline-flex items-center justify-center rounded-lg bg-forest-800 px-5 py-2 text-sm font-medium text-white hover:bg-forest-900"
              >
                Back to patients
              </Link>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Viewer({ recordId, onBlocked }: { recordId: number; onBlocked: (blocked: Blocked) => void }) {
  const content = useResource(
    () =>
      hospitalApi.readRecord(recordId).catch((err: Error) => {
        const blocked = blockedFrom(err, recordId);
        if (blocked) onBlocked(blocked);
        throw err;
      }),
    [recordId],
    { live: false },
  );
  if (content.error) return blockedFrom(content.error) ? null : <ErrorState error={content.error} onRetry={content.reload} />;
  if (!content.data) return <Skeleton className="h-48" />;
  const { record } = content.data;
  return (
    <>
      <h2 className="font-serif text-2xl leading-tight text-ink">{record.title}</h2>
      <p className="mt-1 text-sm text-ink/70">
        {CATEGORY_LABEL[record.category]} · {formatDate(record.tags?.date_of_service ?? record.created_at)}
        {record.source_hospital && ` · ${record.source_hospital}`}
      </p>
      <div className="mt-4 border-t border-sage-200 pt-4">
        <RecordBody content={content.data} />
      </div>
    </>
  );
}

function Details({ record }: { record: RecordSummary }) {
  const t = record.tags;
  const rows: Array<[string, ReactNode]> = [
    ["Doctor", t?.doctor ?? "—"],
    ["Type", t?.record_type ?? CATEGORY_LABEL[record.category]],
    ["Body part", t?.body_part ?? "—"],
    ["Condition", t?.condition ?? "—"],
    ["Date", formatDate(t?.date_of_service ?? record.created_at)],
    ["Sensitivity", <SensitivityBadge level={record.sensitivity} />],
  ];
  return (
    <dl className="divide-y divide-sage-200 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-3 py-2">
          <dt className="text-ink/60">{label}</dt>
          <dd className="text-right text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Pager({ index, total, hrefAt }: { index: number; total: number; hrefAt: (i: number) => string }) {
  const link = (i: number, label: string, Icon: LucideIcon) =>
    i < 0 || i >= total ? (
      <span aria-disabled className="rounded-md p-1 text-ink/30">
        <Icon size={18} />
      </span>
    ) : (
      <Link to={hrefAt(i)} aria-label={label} className="rounded-md p-1 text-ink/70 hover:bg-sage-100">
        <Icon size={18} />
      </Link>
    );
  return (
    <div className="flex items-center gap-2 text-xs text-ink/60">
      <span>
        Record {index + 1} of {total}
      </span>
      <span className="flex rounded-lg ring-1 ring-sage-200">
        {link(index - 1, "Previous record", ChevronLeft)}
        {link(index + 1, "Next record", ChevronRight)}
      </span>
    </div>
  );
}

function CardTitle({ icon, children, className }: { icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <h2 className={cx("flex items-center gap-2 font-serif text-lg text-ink", className)}>
      <span className="text-forest-800">{icon}</span>
      {children}
    </h2>
  );
}

/** H3 patient records (mockup page 3): header, grouping tabs, then Records · Record viewer ·
 *  Record details. H4/H5 and the snooping attempt replace the workspace with a calm panel. */
export default function PatientRecordsPage() {
  const params = useParams();
  const patientId = Number(params.patientId);
  const recordId = params.recordId ? Number(params.recordId) : null;
  const navigate = useNavigate();
  const [by, setBy] = useState<GroupBy>("body_part");
  const view = useResource(() => hospitalApi.getPatientGroups(patientId, by), [patientId, by]);
  const [readBlocked, setReadBlocked] = useState<Blocked | null>(null);

  // A blocked read drops the selected record from the URL, so a later restore (which refetches
  // the view over the event stream) shows the list again without silently re-opening the record.
  useEffect(() => {
    if (view.data && !view.error) setReadBlocked(null);
  }, [view.data, view.error]);

  const blocked = readBlocked ?? blockedFrom(view.error);
  const patient = view.data?.patient;
  const all = (view.data?.groups ?? []).flatMap((g) => g.records);
  const index = recordId === null ? -1 : all.findIndex((r) => r.id === recordId);
  const current = index >= 0 ? all[index] : null;
  const attempted = blocked?.recordId != null ? (all.find((r) => r.id === blocked.recordId) ?? null) : null;
  const hrefFor = (r: RecordSummary) => `/hospital/patients/${patientId}/records/${r.id}`;

  return (
    <>
      <Link to="/hospital" className="-ml-1 inline-flex items-center gap-1 text-sm text-ink/70 hover:text-ink">
        <ChevronLeft size={18} /> My patients
      </Link>

      {patient && <PatientHeader patient={patient} blocked={blocked} />}

      {blocked ? (
        <AccessBlocked
          blocked={blocked}
          record={attempted}
          patientId={patientId}
          onEmergency={() => {
            setReadBlocked(null);
            view.reload();
          }}
        />
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
          <div className="mt-5 flex flex-wrap items-end justify-between gap-3 border-b border-sage-200">
            <GroupByChips variant="tabs" value={by} onChange={setBy} />
            {current && (
              <div role="status" className="mb-2 flex items-center gap-3 rounded-lg bg-forest-50 px-3 py-1.5 text-xs text-ink/80">
                <span className="flex items-center gap-1">
                  <CheckCircle2 size={14} className="text-emerald-700" /> Access checked
                </span>
                <span aria-hidden>·</span>
                <span className="flex items-center gap-1">
                  <CheckCircle2 size={14} className="text-emerald-700" /> Logged before display
                </span>
              </div>
            )}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,0.9fr)]">
            <Card className="p-4">
              <CardTitle icon={<Bone size={20} />} className="mb-3">
                Records
              </CardTitle>
              {all.length === 0 ? (
                <EmptyState title="This vault has no records yet" />
              ) : (
                <RecordGroups key={by} variant="hospital" groups={view.data!.groups} selectedId={recordId ?? undefined} hrefFor={hrefFor} />
              )}
            </Card>

            <Card className="self-start p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <CardTitle icon={<FileText size={20} />}>Record viewer</CardTitle>
                {current && <Pager index={index} total={all.length} hrefAt={(i) => hrefFor(all[i])} />}
              </div>
              {recordId ? (
                <Viewer
                  key={recordId}
                  recordId={recordId}
                  onBlocked={(b) => {
                    setReadBlocked(b);
                    navigate(`/hospital/patients/${patientId}`, { replace: true });
                  }}
                />
              ) : (
                <EmptyState title="Select a record to open it" hint="Opening a record decrypts it through the broker and logs the read." />
              )}
            </Card>

            <Card className="self-start p-4">
              <CardTitle icon={<Info size={20} />} className="mb-3">
                Record details
              </CardTitle>
              {current ? <Details record={current} /> : <p className="text-sm text-ink/60">Details appear once a record is open.</p>}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
