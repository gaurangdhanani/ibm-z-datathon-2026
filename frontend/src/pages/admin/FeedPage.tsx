import { useRef, useState } from "react";
import { Activity } from "lucide-react";

import { Badge, Chip, EmptyState, ErrorState, LoadingCards, OutcomeBar, PageHeader, cx } from "../../components/ui";
import { adminApi, useResource } from "../../lib/data";
import { dayLabel, formatTime } from "../../lib/format";
import type { FeedEntry, FeedFilter } from "../../lib/types";
import { ReasonList } from "../patient/reasons";

const FILTERS: Array<{ value: FeedFilter; label: string; empty: string }> = [
  { value: "flagged", label: "Flagged and denied", empty: "Nothing flagged yet. Fire a scenario from Demo control." },
  { value: "all", label: "Everything", empty: "No access has been logged yet." },
];

function Row({ entry, fresh }: { entry: FeedEntry; fresh: boolean }) {
  const denied = entry.outcome !== "allowed";
  const flagged = entry.risk_level === "medium" || entry.risk_level === "high";
  return (
    <li className={cx("flex gap-3 p-4", fresh && "fade-in bg-amber-50/70")}>
      <span
        aria-hidden
        className={cx("mt-2 h-2.5 w-2.5 shrink-0 rounded-full", denied ? "bg-red-600" : flagged ? "bg-amber-500" : "bg-emerald-600")}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="font-serif text-lg leading-tight text-ink">
            {entry.actor.name} <span className="text-base text-ink/60">on {entry.patient}'s vault</span>
          </p>
          <span className="text-sm text-ink/60">
            {dayLabel(entry.ts)} · {formatTime(entry.ts)}
          </span>
        </div>
        <p className="mt-0.5 text-sm text-ink/70">
          {entry.actor.role_label}
          {entry.actor.hospital && ` · ${entry.actor.hospital}`} · {entry.summary}
          {fresh && (
            <>
              {" "}
              <Badge status="pending">New</Badge>
            </>
          )}
        </p>
        <div className="mt-2">
          <OutcomeBar outcome={entry.outcome} risk={entry.risk_level} denyReason={entry.deny_reason} />
        </div>
        {entry.reasons.length > 0 && (
          <div className="mt-2 pl-1">
            <ReasonList reasons={entry.reasons} />
          </div>
        )}
      </div>
    </li>
  );
}

/** S1 live alert feed: every flagged or denied read across every patient, newest first. The admin
 *  event stream (lib/live.ts) refetches it the moment the rules decide, so a scenario fired on
 *  Demo control lands here and on the patient's phone at the same time. */
export default function FeedPage() {
  const [filter, setFilter] = useState<FeedFilter>("flagged");
  const feed = useResource(() => adminApi.getFeed(filter), [filter]);
  const seen = useRef<number | null>(null); // newest id on first load: anything above it is "New"
  if (seen.current === null && feed.data) seen.current = Math.max(0, ...feed.data.map((e) => e.id));
  const entries = feed.data ?? [];
  const current = FILTERS.find((f) => f.value === filter)!;

  return (
    <>
      <PageHeader
        title="Live alert feed"
        subtitle="Flagged and denied reads across every patient, the moment the access rules decide. Fire a scenario from Demo control and watch it land here and on the patient's phone."
        actions={
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm text-emerald-900 ring-1 ring-emerald-200">
            <Activity size={16} className="text-emerald-700" /> Live
          </span>
        }
      />
      <div className="flex gap-2" role="group" aria-label="Filter feed">
        {FILTERS.map((f) => (
          <Chip key={f.value} selected={filter === f.value} onClick={() => setFilter(f.value)}>
            {f.label}
          </Chip>
        ))}
      </div>
      <div className="mt-4">
        {feed.error && !feed.data ? (
          <ErrorState error={feed.error} onRetry={feed.reload} />
        ) : !feed.data ? (
          <LoadingCards />
        ) : entries.length === 0 ? (
          <EmptyState title={current.empty} />
        ) : (
          <ul className="divide-y divide-sage-200 rounded-2xl bg-cream ring-1 ring-sage-200">
            {entries.map((e) => (
              <Row key={e.id} entry={e} fresh={seen.current !== null && e.id > seen.current} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
