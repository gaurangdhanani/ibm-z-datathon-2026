import { useState } from "react";
import { CheckCircle2, ChevronDown, ShieldX, User } from "lucide-react";

import { Chip, EmptyState, ErrorState, LoadingCards, OutcomeBar, PageHeader, cx } from "../../components/ui";
import { patientApi, useResource } from "../../lib/data";
import { dayLabel, formatTime } from "../../lib/format";
import type { AccessEntry, AuditVerify, LogFilter } from "../../lib/types";
import { ReasonList } from "./reasons";

const FILTERS: Array<{ value: LogFilter; label: string; empty: string }> = [
  { value: "all", label: "All", empty: "No one has opened your vault yet." },
  { value: "denied", label: "Denied", empty: "No denied attempts. Nobody has been blocked." },
  { value: "flagged", label: "Flagged", empty: "Nothing unusual. Flagged access shows up here." },
];

function VerifiedBadge({ verify }: { verify: AuditVerify | undefined }) {
  if (!verify) return null;
  return verify.valid ? (
    <span
      title={`Hash chain checked: ${verify.entries} entries`}
      className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-sm text-emerald-900 ring-1 ring-emerald-200"
    >
      <CheckCircle2 size={18} className="text-emerald-700" /> History verified
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1.5 text-sm font-medium text-red-900 ring-1 ring-red-300">
      <ShieldX size={18} /> History tampered at entry #{verify.first_broken_entry}
    </span>
  );
}

function Entry({ entry }: { entry: AccessEntry }) {
  const [open, setOpen] = useState(false);
  const denied = entry.outcome !== "allowed";
  const flagged = entry.risk_level === "medium" || entry.risk_level === "high";
  return (
    <li className="relative flex gap-3 py-3 pl-5">
      <span
        aria-hidden
        className={cx(
          "absolute top-6 left-0 h-2.5 w-2.5 rounded-full",
          denied ? "bg-red-600" : flagged ? "bg-amber-500" : "bg-emerald-600",
        )}
      />
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink/80 text-white">
        <User size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="font-serif text-lg leading-tight text-ink">{entry.actor.name}</p>
          <span className="shrink-0 text-sm text-ink/70">{formatTime(entry.ts)}</span>
        </div>
        <p className="text-sm text-ink/70">
          {entry.actor.role_label}
          {entry.actor.hospital && ` · ${entry.actor.hospital}`}
        </p>
        <p className="mt-0.5 text-sm text-ink">{entry.summary}</p>
        <div className="mt-2">
          <OutcomeBar outcome={entry.outcome} risk={entry.risk_level} denyReason={entry.deny_reason} />
        </div>
        {entry.reasons.length > 0 && (
          <div className="mt-2 rounded-lg bg-white/60 ring-1 ring-sage-200">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-ink"
            >
              <ChevronDown size={16} className={cx("transition", open && "rotate-180")} />
              Why {denied ? "it was blocked" : "flagged"}
            </button>
            {open && (
              <div className="px-3 pb-3">
                <ReasonList reasons={entry.reasons} />
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/** P11: every access attempt, newest first, grouped by day. Live via the data bus (SSE in VLT-9). */
export default function HistoryPage() {
  const [filter, setFilter] = useState<LogFilter>("all");
  const log = useResource(() => patientApi.getAccessLog(filter), [filter]);
  const verify = useResource(() => patientApi.verifyHistory(), []);

  const days: Array<{ label: string; entries: AccessEntry[] }> = [];
  for (const entry of log.data ?? []) {
    const label = dayLabel(entry.ts);
    if (days[days.length - 1]?.label !== label) days.push({ label, entries: [] });
    days[days.length - 1].entries.push(entry);
  }
  const current = FILTERS.find((f) => f.value === filter)!;

  return (
    <>
      <PageHeader title="Access history" actions={<VerifiedBadge verify={verify.data} />} />
      <div className="flex gap-2" role="group" aria-label="Filter history">
        {FILTERS.map((f) => (
          <Chip key={f.value} selected={filter === f.value} onClick={() => setFilter(f.value)}>
            {f.label}
          </Chip>
        ))}
      </div>

      <div className="mt-4">
        {log.error && !log.data ? (
          <ErrorState error={log.error} onRetry={log.reload} />
        ) : !log.data ? (
          <LoadingCards />
        ) : days.length === 0 ? (
          <EmptyState title={current.empty} />
        ) : (
          days.map((day) => (
            <section key={day.label} className="mb-4">
              <h2 className="mb-2 font-serif text-xl text-ink">{day.label}</h2>
              <ul className="divide-y divide-sage-200 rounded-2xl bg-cream px-4 ring-1 ring-sage-200">
                {day.entries.map((e) => (
                  <Entry key={e.id} entry={e} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </>
  );
}
