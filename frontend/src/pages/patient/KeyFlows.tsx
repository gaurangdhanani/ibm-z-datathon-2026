/** P8 grant and P10 key swap flows, opened from Who has my key (and from approving a request). */
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Building2, CheckCircle2, KeyRound, ShieldCheck } from "lucide-react";

import { Banner, Button, Modal, cx } from "../../components/ui";
import type { Hospital } from "../../lib/types";

function HospitalPicker({
  hospitals,
  value,
  onChange,
}: {
  hospitals: Hospital[];
  value: Hospital | null;
  onChange: (h: Hospital) => void;
}) {
  if (hospitals.length === 0) return <p className="text-sm text-ink/70">No other hospitals are available.</p>;
  return (
    <div role="radiogroup" className="flex flex-col gap-2">
      {hospitals.map((h) => {
        const selected = value?.id === h.id;
        return (
          <button
            key={h.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(h)}
            className={cx(
              "flex items-center gap-3 rounded-xl p-3 text-left ring-1 transition",
              selected ? "bg-forest-50 ring-2 ring-forest-700" : "bg-white/70 ring-sage-200 hover:bg-white",
            )}
          >
            <Building2 size={22} className="shrink-0 text-ink/70" />
            <span>
              <span className="block font-medium text-ink">{h.name}</span>
              <span className="block text-xs text-ink/60">{h.city}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong. Nothing changed.");

/** P8: give a hospital the first key. `preselect` skips the picker (approving a request). */
export function GrantSheet({
  open,
  hospitals,
  preselect,
  onSubmit,
  onClose,
}: {
  open: boolean;
  hospitals: Hospital[];
  preselect: Hospital | null;
  onSubmit: (h: Hospital) => Promise<unknown>;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<Hospital | null>(preselect);
  const [step, setStep] = useState<"pick" | "confirm">(preselect ? "confirm" : "pick");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setChoice(preselect);
    setStep(preselect ? "confirm" : "pick");
    setError(null);
  }, [open, preselect]);

  async function confirm() {
    if (!choice || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(choice);
      onClose();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} labelledBy="grant-title" sheet>
      {step === "pick" ? (
        <>
          <h2 id="grant-title" className="pr-8 font-serif text-2xl text-ink">
            Give a hospital access
          </h2>
          <p className="mt-1 mb-4 text-sm text-ink/70">Pick the one hospital that should hold a key to your vault.</p>
          <HospitalPicker hospitals={hospitals} value={choice} onChange={setChoice} />
          <Button size="lg" className="mt-5 w-full" disabled={!choice} onClick={() => setStep("confirm")}>
            Continue
          </Button>
        </>
      ) : (
        <>
          <h2 id="grant-title" className="pr-8 font-serif text-2xl text-ink">
            Give {choice?.name} a key?
          </h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm text-ink/80">
            <li>They will be able to open the records in your vault.</li>
            <li>Every record they open is logged and shown in your access history.</li>
            <li>You can move to another hospital or freeze their access at any time.</li>
          </ul>
          {error && (
            <div className="mt-3">
              <Banner tone="danger">{error}</Banner>
            </div>
          )}
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={preselect ? onClose : () => setStep("pick")} disabled={busy}>
              {preselect ? "Cancel" : "Back"}
            </Button>
            <Button onClick={confirm} disabled={busy}>
              {busy ? "Giving access…" : "Give access"}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

type SwapStep = "pick" | "confirm" | "animating" | "done";

/**
 * P10: move to another hospital. The animation plays only after the API confirms the key swap;
 * a failure leaves everything as it was. A second tap while the swap runs is ignored.
 */
export function KeySwapSheet({
  open,
  from,
  hospitals,
  preselect,
  onSubmit,
  onClose,
}: {
  open: boolean;
  from: Hospital;
  hospitals: Hospital[];
  preselect: Hospital | null;
  onSubmit: (to: Hospital) => Promise<unknown>;
  onClose: () => void;
}) {
  const [to, setTo] = useState<Hospital | null>(preselect);
  const [step, setStep] = useState<SwapStep>(preselect ? "confirm" : "pick");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!open) return;
    setTo(preselect);
    setStep(preselect ? "confirm" : "pick");
    setError(null);
  }, [open, preselect]);

  useEffect(() => {
    if (step !== "animating") return;
    const timer = setTimeout(() => setStep("done"), 1600);
    return () => clearTimeout(timer);
  }, [step]);

  async function confirm() {
    if (!to || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(to);
      setStep("animating");
    } catch (err) {
      setError(message(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const locked = busy || step === "animating";
  const others = hospitals.filter((h) => h.id !== from.id);

  return (
    <Modal open={open} onClose={locked ? () => undefined : onClose} labelledBy="swap-title" sheet>
      {step === "pick" && (
        <>
          <h2 id="swap-title" className="pr-8 font-serif text-2xl text-ink">
            Move to another hospital
          </h2>
          <p className="mt-1 mb-4 text-sm text-ink/70">Your vault can have one hospital key holder at a time.</p>
          <HospitalPicker hospitals={others} value={to} onChange={setTo} />
          <Button size="lg" className="mt-5 w-full" disabled={!to} onClick={() => setStep("confirm")}>
            Continue
          </Button>
        </>
      )}

      {step === "confirm" && to && (
        <>
          <h2 id="swap-title" className="pr-8 font-serif text-2xl text-ink">
            Move your vault to {to.name}?
          </h2>
          <p className="mt-3 rounded-xl bg-sage-100 p-3 text-[0.95rem] text-ink">
            {from.name} will lose access. Your vault will be re-locked with a new key for {to.name}.
          </p>
          <ul className="mt-3 flex flex-col gap-1.5 text-sm text-ink/75">
            <li>Every record is re-encrypted with the new key.</li>
            <li>{from.name}'s old key stops working immediately, even if they kept a copy.</li>
            <li>You can move again at any time.</li>
          </ul>
          {error && (
            <div className="mt-3">
              <Banner tone="danger">{error}</Banner>
            </div>
          )}
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={preselect ? onClose : () => setStep("pick")} disabled={busy}>
              {preselect ? "Cancel" : "Back"}
            </Button>
            <Button onClick={confirm} disabled={busy}>
              {busy ? "Re-locking…" : "Move my vault"}
            </Button>
          </div>
        </>
      )}

      {(step === "animating" || step === "done") && to && (
        <div className="flex flex-col items-center text-center">
          <h2 id="swap-title" className="sr-only">
            Key swap
          </h2>
          <div className="mt-2 grid w-full grid-cols-[1fr_auto_1fr] items-center gap-2">
            <SwapNode name={from.name} tone="old">
              {step === "animating" ? (
                <KeyRound size={30} className="key-break text-red-700" />
              ) : (
                <KeyRound size={30} className="text-red-700 opacity-25" />
              )}
            </SwapNode>
            <ArrowRight className="text-ink/40" />
            <SwapNode name={to.name} tone="new">
              <KeyRound size={30} className={step === "animating" ? "key-arrive text-forest-800" : "text-forest-800"} />
            </SwapNode>
          </div>

          {step === "animating" ? (
            <p className="mt-6 text-sm text-ink/70" aria-live="polite">
              Destroying the old key and handing a new one to {to.name}…
            </p>
          ) : (
            <div className="pop-in mt-6 flex flex-col items-center">
              <CheckCircle2 size={44} className="text-emerald-700" />
              <p className="mt-2 font-serif text-2xl text-ink">Your vault moved to {to.name}</p>
              <p className="mt-1 text-sm text-ink/70">
                {from.name}'s key no longer works. Every record was re-locked with a new key.
              </p>
              <Button size="lg" className="mt-5 w-full" onClick={onClose}>
                <ShieldCheck size={20} /> Done
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function SwapNode({ name, tone, children }: { name: string; tone: "old" | "new"; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={cx(
          "relative flex h-20 w-20 items-center justify-center rounded-2xl ring-1",
          tone === "old" ? "bg-red-50 ring-red-200" : "bg-forest-50 ring-forest-100",
        )}
      >
        <Building2 size={22} className="absolute top-2 left-2 text-ink/40" />
        {children}
      </div>
      <span className="text-xs leading-tight text-ink/80">{name}</span>
    </div>
  );
}
