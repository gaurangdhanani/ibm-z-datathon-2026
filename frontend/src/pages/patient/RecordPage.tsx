import { Link, useParams } from "react-router";
import { ChevronLeft, ShieldCheck, Sparkles } from "lucide-react";

import { RecordBody } from "../../components/records";
import { Card, ErrorState, SensitivityBadge, Skeleton, Tag } from "../../components/ui";
import { patientApi, useResource } from "../../lib/data";
import { formatDate } from "../../lib/format";

/** P5: open one record. Decrypted only through the broker; the read shows up in Access history. */
export default function RecordPage() {
  const id = Number(useParams().recordId);
  const content = useResource(() => patientApi.readRecord(id), [id], { live: false });
  const record = content.data?.record;
  const tags = record?.tags;

  return (
    <>
      <Link to="/patient" className="-ml-1 inline-flex items-center gap-1 text-sm text-ink/70 hover:text-ink">
        <ChevronLeft size={18} /> My vault
      </Link>

      {content.error ? (
        <div className="mt-4">
          <ErrorState error={content.error} onRetry={content.reload} />
        </div>
      ) : !record ? (
        <div className="mt-4 flex flex-col gap-3">
          <Skeleton className="h-9 w-3/4" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <>
          <h1 className="mt-3 font-serif text-[1.75rem] leading-tight text-ink">{record.title}</h1>
          <p className="mt-1 text-sm text-ink/70">
            {formatDate(tags?.date_of_service ?? record.created_at)}
            {tags?.doctor && ` · ${tags.doctor}`}
            {record.source_hospital && ` · ${record.source_hospital}`}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <SensitivityBadge level={record.sensitivity} />
            {tags?.labels.map((label) => <Tag key={label}>{label}</Tag>)}
          </div>
          {tags && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-ink/60">
              <Sparkles size={14} />
              {tags.tagger === "patient_edit" ? "Tags edited by you" : "Tagged inside your vault"}
              {tags.condition && ` · ${tags.condition}`}
              {tags.body_part && ` · ${tags.body_part}`}
              {` · ${tags.record_type}`}
            </p>
          )}

          <Card className="mt-4">
            <RecordBody content={content.data!} />
          </Card>

          <p className="mt-3 flex items-center gap-1.5 text-xs text-ink/60">
            <ShieldCheck size={14} /> Decrypted for you just now. This view is in your access history.
          </p>
        </>
      )}
    </>
  );
}
