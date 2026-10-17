import { useState } from "react";
import { Link } from "react-router";
import { Search, UserPlus } from "lucide-react";

import { Badge, Card, EmptyState, ErrorState, Input, LoadingCards, PageHeader, SyntheticBadge } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { hospitalApi, useResource } from "../../lib/data";
import { formatDate } from "../../lib/format";
import type { HospitalPatient } from "../../lib/types";

export const KEY_STATUS: Record<HospitalPatient["key_status"], { label: string; status: "active" | "frozen" | "pending" }> = {
  active: { label: "Active", status: "active" },
  frozen: { label: "Frozen", status: "frozen" },
  emergency: { label: "Emergency", status: "pending" },
};

/** H2: patients whose vault this hospital holds an active or frozen key for. */
export default function PatientsPage() {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const patients = useResource(() => hospitalApi.getPatients(query), [query]);
  const rows = patients.data ?? [];

  return (
    <>
      <PageHeader
        title="My patients"
        subtitle={`Patients who gave ${user?.hospital_name ?? "your hospital"} a key to their vault.`}
        actions={
          <Link
            to="/hospital/requests"
            className="inline-flex items-center gap-2 rounded-lg bg-forest-800 px-4 py-2 text-sm font-medium text-white hover:bg-forest-900"
          >
            <UserPlus size={16} /> Request access
          </Link>
        }
      />
      <Card className="p-0">
        <div className="flex items-center gap-2 border-b border-sage-200 p-4">
          <Search size={18} className="text-ink/50" />
          <Input
            type="search"
            aria-label="Search patients"
            placeholder="Search by name or MRN"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="max-w-sm"
          />
        </div>
        {patients.error && !patients.data ? (
          <div className="p-4">
            <ErrorState error={patients.error} onRetry={patients.reload} />
          </div>
        ) : !patients.data ? (
          <div className="p-4">
            <LoadingCards count={2} />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={query ? "No patients match that search" : "No patients have given you a key yet"}
              hint="Ask a patient for access; they approve it on their phone."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs tracking-wide text-ink/60 uppercase">
                <tr>
                  <th className="px-4 py-3 font-medium">Patient</th>
                  <th className="px-4 py-3 font-medium">Date of birth</th>
                  <th className="px-4 py-3 font-medium">Key status</th>
                  <th className="px-4 py-3 font-medium">Last visit</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-sage-200">
                {rows.map((p) => (
                  <tr key={p.patient_id} className="hover:bg-white/60">
                    <td className="px-4 py-3">
                      <span className="block font-medium text-ink">{p.full_name}</span>
                      <span className="text-xs text-ink/60">{p.mrn}</span>
                    </td>
                    <td className="px-4 py-3 text-ink/80">
                      {formatDate(p.date_of_birth)} <SyntheticBadge />
                    </td>
                    <td className="px-4 py-3">
                      <Badge status={KEY_STATUS[p.key_status].status}>{KEY_STATUS[p.key_status].label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-ink/80">{p.last_visit ? formatDate(p.last_visit) : "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <Link to={`/hospital/patients/${p.patient_id}`} className="font-medium text-forest-800 hover:underline">
                        Open records
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
