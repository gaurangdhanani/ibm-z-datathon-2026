/** Record pieces shared by the patient vault (P4/P5) and the hospital record view (H3). */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  ChevronDown,
  ClipboardList,
  ExternalLink,
  FileText,
  FlaskConical,
  Lock,
  Pill,
  ScanLine,
  StickyNote,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { formatDate, plural } from "../lib/format";
import { GROUP_BY_OPTIONS } from "../lib/types";
import type { GroupBy, RecordCategory, RecordContent, RecordGroup, RecordSummary } from "../lib/types";
import { Chip, EmptyState, IconTile, Skeleton, Tag, cx } from "./ui";

const CATEGORY_ICON: Record<RecordCategory, LucideIcon> = {
  imaging: ScanLine,
  lab: FlaskConical,
  note: StickyNote,
  prescription: Pill,
  discharge: ClipboardList,
  other: FileText,
};

export function RecordIcon({ category, size = 24 }: { category: RecordCategory; size?: number }) {
  const Icon = CATEGORY_ICON[category];
  return <Icon size={size} strokeWidth={1.7} />;
}

export function GroupByChips({ value, onChange }: { value: GroupBy; onChange: (by: GroupBy) => void }) {
  return (
    <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden" role="group" aria-label="Group records by">
      {GROUP_BY_OPTIONS.map((o) => (
        <Chip key={o.value} selected={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </Chip>
      ))}
    </div>
  );
}

/** Collapsible groups like "Knee · 2 records · Dr. Elena Vasquez". Key it by `by` to reset. */
export function RecordGroups({
  groups,
  hrefFor,
  selectedId,
}: {
  groups: RecordGroup[];
  hrefFor: (r: RecordSummary) => string;
  selectedId?: number;
}) {
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(groups.filter((g, i) => i === 0 || g.key === "organizing").map((g) => g.key)),
  );
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => {
        const expanded = open.has(g.key);
        return (
          <section key={g.key} className="rounded-2xl bg-cream/90 ring-1 ring-sage-200">
            <button
              type="button"
              onClick={() => toggle(g.key)}
              aria-expanded={expanded}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
            >
              <span className="min-w-0">
                <span className="font-serif text-lg text-ink">{g.label}</span>
                <span className="text-sm text-ink/60">
                  {" "}
                  · {plural(g.count, "record")}
                  {g.top_doctor ? ` · ${g.top_doctor}` : ""}
                </span>
              </span>
              <ChevronDown size={20} className={cx("shrink-0 transition", expanded && "rotate-180")} />
            </button>
            {expanded && (
              <div className="flex flex-col gap-2 px-2 pb-2">
                {g.records.map((r) => (
                  <RecordRow key={r.id} record={r} href={hrefFor(r)} active={r.id === selectedId} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

export function RecordRow({ record, href, active }: { record: RecordSummary; href: string; active?: boolean }) {
  const t = record.tags;
  return (
    <Link
      to={href}
      aria-current={active ? "true" : undefined}
      className={cx(
        "flex items-start gap-3 rounded-xl bg-white/70 p-3 ring-1 transition hover:bg-white",
        active ? "ring-2 ring-forest-700" : "ring-sage-200",
      )}
    >
      <IconTile>
        <RecordIcon category={record.category} />
      </IconTile>
      <div className="min-w-0 flex-1">
        <p className="font-serif text-[1.05rem] leading-snug text-ink">{record.title}</p>
        {t ? (
          <>
            <p className="mt-0.5 text-sm text-ink/70">{formatDate(t.date_of_service ?? record.created_at)}</p>
            {t.doctor && <p className="text-sm text-ink/70">{t.doctor}</p>}
            {t.labels.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {t.labels.map((label) => (
                  <Tag key={label}>{label}</Tag>
                ))}
              </div>
            )}
            {t.confidence < 0.5 && <p className="mt-1.5 text-xs text-amber-800">Add details to improve tags.</p>}
          </>
        ) : (
          <div className="mt-2 flex flex-col gap-1.5" aria-live="polite">
            <p className="text-sm text-ink/60">Organizing inside your vault…</p>
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        )}
      </div>
      <Lock size={20} className="mt-1 shrink-0 text-forest-900" aria-label="Encrypted" />
    </Link>
  );
}

function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return blob ? url : null;
}

/** Decrypted record body: text inline, images inline, PDFs in a new tab (the CSP blocks blob frames). */
export function RecordBody({ content }: { content: RecordContent }) {
  const { record, blob } = content;
  const url = useObjectUrl(blob);
  const [text, setText] = useState<string | null>(null);
  const isText = record.mime_type.startsWith("text/");

  useEffect(() => {
    if (blob && isText) blob.text().then(setText);
  }, [blob, isText]);

  if (!blob) {
    return (
      <EmptyState
        title="Content not available"
        hint="The vault returned no bytes for this record."
      />
    );
  }
  if (isText) {
    return text === null ? (
      <Skeleton className="h-24" />
    ) : (
      <p className="text-[0.95rem] leading-relaxed whitespace-pre-wrap text-ink">{text}</p>
    );
  }
  if (record.mime_type.startsWith("image/")) {
    return url ? <img src={url} alt={record.title} className="w-full rounded-xl" /> : <Skeleton className="h-48" />;
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-sm text-ink/70">PDF document.</p>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-cream px-4 py-2 text-sm font-medium text-forest-900 ring-1 ring-forest-800 hover:bg-white"
        >
          <ExternalLink size={16} /> Open PDF
        </a>
      )}
    </div>
  );
}
