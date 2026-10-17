import { useState } from "react";
import { Lock, UploadCloud } from "lucide-react";

import { GroupByChips, RecordGroups } from "../../components/records";
import { Button, EmptyState, ErrorState, LoadingCards, PageHeader, Skeleton, SyntheticBadge } from "../../components/ui";
import { patientApi, useResource } from "../../lib/data";
import { formatWhen } from "../../lib/format";
import { GROUP_BY_OPTIONS } from "../../lib/types";
import type { GroupBy, RecordGroup, VaultSummary } from "../../lib/types";
import { UploadSheet } from "./UploadSheet";

const GROUP_KEY = "onetrace.groupBy";

function savedGroupBy(): GroupBy {
  try {
    const saved = localStorage.getItem(GROUP_KEY);
    if (GROUP_BY_OPTIONS.some((o) => o.value === saved)) return saved as GroupBy;
  } catch {
    /* storage blocked: use the default */
  }
  return "body_part";
}

/** All five groupings up front so switching chips is instant (P4). */
async function loadAllGroups(): Promise<Record<GroupBy, RecordGroup[]>> {
  const pairs = await Promise.all(
    GROUP_BY_OPTIONS.map(async (o) => [o.value, await patientApi.getGroups(o.value)] as const),
  );
  return Object.fromEntries(pairs) as Record<GroupBy, RecordGroup[]>;
}

function VaultHeader({ vault }: { vault: VaultSummary }) {
  const grant = vault.current_grant;
  return (
    <section className="flex items-center gap-4 rounded-2xl bg-forest-800 p-5 text-white shadow-sm">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10">
        <Lock size={28} />
      </span>
      <div className="min-w-0">
        <p className="font-serif text-xl">Your vault · Encrypted</p>
        {!grant && <p className="text-sm text-white/85">Only you hold keys.</p>}
        {grant?.status === "active" && <p className="text-sm text-white/85">Only you and {grant.hospital.name} hold keys.</p>}
        {grant?.status === "frozen" && (
          <>
            <p className="text-sm text-white/85">Only you hold a working key.</p>
            <p className="text-sm font-medium text-amber-300">{grant.hospital.name} · access frozen</p>
          </>
        )}
        {vault.emergency && (
          <p className="text-sm font-medium text-red-200">
            Emergency access: {vault.emergency.hospital.name} until {formatWhen(vault.emergency.expires_at)}
          </p>
        )}
        <p className="mt-1 flex items-center gap-2 text-xs text-white/60">
          <SyntheticBadge /> Key v{vault.key_version}
        </p>
      </div>
    </section>
  );
}

/** P2 My vault, P3 upload entry point, P4 group-by views. */
export default function VaultPage() {
  const vault = useResource(() => patientApi.getVault(), []);
  const groups = useResource(loadAllGroups, []);
  const [by, setBy] = useState<GroupBy>(savedGroupBy);
  const [uploading, setUploading] = useState(false);

  function choose(next: GroupBy) {
    setBy(next);
    try {
      localStorage.setItem(GROUP_KEY, next);
    } catch {
      /* not remembered; fine */
    }
  }

  return (
    <>
      <PageHeader title="My vault" />
      {vault.data ? (
        <VaultHeader vault={vault.data} />
      ) : vault.error ? (
        <ErrorState error={vault.error} onRetry={vault.reload} />
      ) : (
        <Skeleton className="h-28 rounded-2xl" />
      )}

      <Button size="lg" className="mt-4 w-full" onClick={() => setUploading(true)}>
        <UploadCloud size={22} /> Upload record
      </Button>

      <div className="mt-4">
        <GroupByChips value={by} onChange={choose} />
      </div>

      <div className="mt-3">
        {groups.error && !groups.data ? (
          <ErrorState error={groups.error} onRetry={groups.reload} />
        ) : !groups.data ? (
          <LoadingCards />
        ) : groups.data[by].length === 0 ? (
          <EmptyState title="No records yet — upload your first one" hint="Records are encrypted and organized inside your vault." />
        ) : (
          <RecordGroups key={by} groups={groups.data[by]} hrefFor={(r) => `/patient/records/${r.id}`} />
        )}
      </div>

      <UploadSheet open={uploading} onClose={() => setUploading(false)} />
    </>
  );
}
