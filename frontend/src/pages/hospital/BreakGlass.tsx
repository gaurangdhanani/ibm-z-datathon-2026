/** H7 break-glass emergency access: a justification, a confirmation, and a loud reminder that
 *  everything is logged and the patient is told at once. Physicians and nurses only. */
import { useState } from "react";
import { ShieldAlert } from "lucide-react";

import { Banner, Button, Modal, Textarea } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { hospitalApi } from "../../lib/data";
import type { EmergencyInfo } from "../../lib/types";

const MIN_REASON = 10;

export function canBreakGlass(staffRole: string | null | undefined): boolean {
  return staffRole === "physician" || staffRole === "nurse";
}

export function BreakGlassDialog({
  open,
  patientId,
  patientName,
  onClose,
  onDone,
}: {
  open: boolean;
  patientId: number;
  patientName: string;
  onClose: () => void;
  onDone: (emergency: EmergencyInfo) => void;
}) {
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const short = justification.trim().length < MIN_REASON;

  async function submit() {
    if (short || busy) return;
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
    <Modal open={open} onClose={busy ? () => undefined : onClose} labelledBy="break-glass-title">
      <div className="flex items-start gap-3">
        <ShieldAlert size={28} className="shrink-0 text-red-700" />
        <div>
          <h2 id="break-glass-title" className="font-serif text-xl text-ink">
            Emergency access to {patientName}'s records
          </h2>
          <p className="mt-1 text-sm text-ink/80">
            Use only when the patient cannot grant access themselves. Access lasts one hour, every record you
            open is logged, and {patientName} is notified immediately and can end it at any time.
          </p>
        </div>
      </div>
      <label htmlFor="justification" className="mt-4 block text-sm font-medium text-ink">
        Justification <span className="font-normal text-ink/60">(the patient sees this)</span>
      </label>
      <Textarea
        id="justification"
        className="mt-1"
        placeholder="e.g. ER: unresponsive patient, need current medication list"
        maxLength={500}
        value={justification}
        onChange={(e) => setJustification(e.target.value)}
      />
      <p className="mt-1 text-xs text-ink/50">At least {MIN_REASON} characters.</p>
      {error && (
        <div className="mt-3">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="danger" onClick={submit} disabled={short || busy}>
          {busy ? "Opening…" : "Break the glass"}
        </Button>
      </div>
    </Modal>
  );
}

/** The red button that opens the dialog; renders nothing for clerks. */
export function BreakGlassButton({ patientId, patientName, onDone, className }: { patientId: number; patientName: string; onDone: (e: EmergencyInfo) => void; className?: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  if (!canBreakGlass(user?.staff_role)) return null;
  return (
    <>
      <Button variant="danger-outline" className={className} onClick={() => setOpen(true)}>
        <ShieldAlert size={16} /> Emergency access
      </Button>
      <BreakGlassDialog
        open={open}
        patientId={patientId}
        patientName={patientName}
        onClose={() => setOpen(false)}
        onDone={(e) => {
          setOpen(false);
          onDone(e);
        }}
      />
    </>
  );
}
