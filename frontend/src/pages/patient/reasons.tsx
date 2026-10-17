import { Ban, Clock, FileText, Info, Lock, ShieldAlert, UserX } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { Reason, ReasonKind } from "../../lib/types";

const ICON: Record<ReasonKind, LucideIcon> = {
  off_hours: Clock,
  role_mismatch: UserX,
  sensitive_record: FileText,
  revoked: Ban,
  frozen: Lock,
  no_grant: Ban,
  emergency: ShieldAlert,
  other: Info,
};

/** Plain-language reasons from the access rules, one icon per kind (P11, P12). */
export function ReasonList({ reasons }: { reasons: Reason[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {reasons.map((r) => {
        const Icon = ICON[r.kind];
        return (
          <li key={r.kind + r.text} className="flex items-center gap-3 text-[0.95rem] text-ink">
            <Icon size={20} className="shrink-0 text-ink/80" />
            {r.text}
          </li>
        );
      })}
    </ul>
  );
}
