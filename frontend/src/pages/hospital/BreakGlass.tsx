/** H7 break-glass emergency access (mockup page 4): a reason with a live character count, the
 *  one-hour / patient-notified warning, an explicit confirmation tick, and everything logged.
 *  Physicians and nurses only; clerks never see the button. */
import { useEffect, useState } from "react";
import { CircleAlert, Info, ShieldPlus } from "lucide-react";

import { Avatar, Banner, Button, Modal, SyntheticBadge, Textarea, cx } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { hospitalApi } from "../../lib/data";
import type { EmergencyInfo } from "../../lib/types";

const MIN_REASON = 10; // same floor as medvault/hospital.py

export function canBreakGlass(staffRole: string | null | undefined): boolean {
  return staffRole === "physician" || staffRole === "nurse";
}

export function BreakGlassDialog({
  open,
  patientId,
  patientName,
  mrn,
  onClose,
  onDone,
}: {
  open: boolean;
  patientId: number;
  /** Null when the hospital cannot see the name yet (no key, no lookup). */
  patientName: string | null;
  mrn?: string | null;
  onClose: () => void;
  onDone: (emergency: EmergencyInfo) => void;
}) {
  const [justification, setJustification] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const length = justification.trim().length;
  const short = length < MIN_REASON;

  useEffect(() => {
    if (open) {
      setConfirmed(false);
      setError(null);
    }
  }, [open]);

  async function submit() {
    if (short || !confirmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const emergency = await hospitalApi.breakGlass(patientId, justification.trim());
      setJustification("");
      onDone(emergency);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Emergency access could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} labelledBy="break-glass-title" size="lg">
      <div className="flex items-center gap-3 pr-6">
        {patientName && <Avatar tone="light" name={patientName} className="h-12 w-12" />}
        <div className="min-w-0">
          <h2 id="break-glass-title" className="flex flex-wrap items-center gap-2 font-serif text-xl leading-tight text-ink">
            {patientName ?? "Emergency access"} {patientName && <SyntheticBadge />}
          </h2>
          <p className="text-sm text-ink/70">{mrn ? `Patient ID: ${mrn}` : "Emergency access to this patient's vault"}</p>
        </div>
      </div>

      <label htmlFor="justification" className="mt-4 block text-sm font-medium text-ink">
        Reason for emergency access
      </label>
      <Textarea
        id="justification"
        className="mt-1 min-h-20"
        placeholder="e.g. Unconscious patient, car accident."
        maxLength={500}
        value={justification}
        onChange={(e) => setJustification(e.target.value)}
      />
      <p className={cx("mt-1 text-xs", short && length > 0 ? "text-amber-800" : "text-ink/55")}>
        Minimum {MIN_REASON} characters (current: {length}).
      </p>

      <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-950" role="note">
        <CircleAlert size={18} className="mt-0.5 shrink-0 text-amber-600" />
        <p>
          <span className="font-semibold">Access lasts 1 hour.</span> The patient is notified{" "}
          <span className="font-semibold">instantly</span>. Every read has at least MEDIUM risk.
        </p>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="h-4 w-4 accent-forest-800"
        />
        I confirm this is an emergency.
      </label>

      {error && (
        <div className="mt-3">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 rounded-md bg-sage-100 px-2 py-1 text-xs text-ink/70">
          <Info size={14} /> Clinicians only: other staff receive 403.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={short || !confirmed || busy}>
            {busy ? "Opening…" : "Confirm emergency access"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** The amber button that opens the dialog; renders nothing for clerks. */
export function BreakGlassButton({
  patientId,
  patientName,
  mrn,
  onDone,
  className,
}: {
  patientId: number;
  patientName: string | null;
  mrn?: string | null;
  onDone: (e: EmergencyInfo) => void;
  className?: string;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  if (!canBreakGlass(user?.staff_role)) return null;
  return (
    <>
      <Button variant="warning" className={className} onClick={() => setOpen(true)}>
        <ShieldPlus size={18} /> Emergency access
      </Button>
      <BreakGlassDialog
        open={open}
        patientId={patientId}
        patientName={patientName}
        mrn={mrn}
        onClose={() => setOpen(false)}
        onDone={(e) => {
          setOpen(false);
          onDone(e);
        }}
      />
    </>
  );
}
