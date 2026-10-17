import { useState } from "react";
import { Link } from "react-router";
import { Info, Search, Users } from "lucide-react";

import { Card, EmptyState, ErrorState, Input, LoadingCards, StatusDot } from "../../components/ui";
import { hospitalApi, useResource } from "../../lib/data";
import { formatDate } from "../../lib/format";
import { KEY_STATUS_LABEL } from "../../lib/types";
import type { HospitalPatient } from "../../lib/types";
import { CardHeading, RecentRequestsCard, RequestAccessCard } from "./RequestAccess";

const DOT: Record<HospitalPatient["key_status"], "active" | "frozen" | "pending"> = {
  active: "active",
  frozen: "frozen",
  emergency: "pending",
};

/** Hospital workspace (mockup page 3): H2 my patients on the left, H6 request access and the
 *  recent requests on the right. One screen, no tabs. */
export default function PatientsPage() {
  const [query, setQuery] = useState("");
  const patients = useResource(() => hospitalApi.getPatients(query), [query]);
  const rows = patients.data ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)]">
      <Card className="self-start">
        <CardHeading icon={<Users size={22} strokeWidth={1.7} />} title="My patients" subtitle="Patients you have access to" />
        <div className="relative">
          <Search size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink/50" />
          <Input
            type="search"
            aria-label="Search patients"
            placeholder="Search patients…"
            className="pl-10"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="mt-3">
          {patients.error && !patients.data ? (
            <ErrorState error={patients.error} onRetry={patients.reload} />
          ) : !patients.data ? (
            <LoadingCards count={2} />
          ) : rows.length === 0 ? (
            <EmptyState
              title={query ? "No patients match that search" : "No patients have given you a key yet"}
              hint="Ask a patient for access; they approve it on their phone."
            />
          ) : (
            <div className="overflow-x-auto rounded-xl ring-1 ring-sage-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-sage-50 text-xs font-semibold text-ink/70">
                  <tr>
                    <th className="px-4 py-2.5">Patient</th>
                    <th className="px-4 py-2.5">Patient ID</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Last visit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sage-200 bg-white/60">
                  {rows.map((p) => (
                    <tr key={p.patient_id} className="hover:bg-forest-50/60">
                      <td className="px-4 py-2.5">
                        <Link to={`/hospital/patients/${p.patient_id}`} className="font-medium text-ink hover:underline">
                          {p.full_name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-ink/80">{p.mrn}</td>
                      <td className="px-4 py-2.5">
                        <StatusDot status={DOT[p.key_status]}>{KEY_STATUS_LABEL[p.key_status]}</StatusDot>
                      </td>
                      <td className="px-4 py-2.5 text-ink/80">{p.last_visit ? formatDate(p.last_visit) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-forest-50 px-3 py-2.5 text-sm text-ink/80">
          <Info size={18} className="shrink-0 text-ink/50" /> Revoked patients are removed from this list.
        </p>
      </Card>

      <div className="flex flex-col gap-4">
        <RequestAccessCard />
        <RecentRequestsCard />
      </div>
    </div>
  );
}
