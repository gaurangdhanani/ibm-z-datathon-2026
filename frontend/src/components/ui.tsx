/** Shared UI kit. Small on purpose: every patient, hospital and demo screen builds from these pieces.
 *  Palette lives in index.css: forest = primary, sage = page and chips, cream = cards. */
import { useEffect, useRef } from "react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";
import { CheckCircle2, CircleMinus, CircleAlert, RefreshCw, X } from "lucide-react";

import { initials } from "../lib/format";
import type { RiskLevel } from "../lib/types";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "danger" | "danger-outline" | "warning" | "ghost";

const BUTTON: Record<ButtonVariant, string> = {
  primary: "bg-forest-800 text-white hover:bg-forest-900 focus-visible:outline-forest-800",
  secondary:
    "bg-cream text-forest-900 ring-1 ring-forest-800 hover:bg-white focus-visible:outline-forest-800",
  danger: "bg-red-700 text-white hover:bg-red-800 focus-visible:outline-red-700",
  "danger-outline":
    "bg-white/70 text-red-700 ring-1 ring-red-700 hover:bg-red-50 focus-visible:outline-red-700",
  // Emergency access in the mockups is amber, not red: urgent, but a legitimate action.
  warning:
    "bg-amber-50 font-semibold text-amber-800 ring-1 ring-amber-500 hover:bg-amber-100 focus-visible:outline-amber-600",
  ghost: "text-ink hover:bg-sage-100 focus-visible:outline-forest-800",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "md" | "lg" }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-2 font-medium transition",
        "focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        size === "lg" ? "rounded-xl px-5 py-3 text-base" : "rounded-lg px-4 py-2 text-sm",
        BUTTON[variant],
        className,
      )}
    />
  );
}

const FIELD =
  "w-full rounded-lg border border-sage-300 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/40 focus:border-forest-700 focus:outline-none focus:ring-2 focus:ring-forest-700/25";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(FIELD, className)} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(FIELD, "min-h-24", className)} />;
}

export function Card({
  title,
  children,
  className,
  actions,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <section className={cx("rounded-2xl bg-cream p-5 shadow-sm ring-1 ring-sage-200", className)}>
      {(title || actions) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

/** Status vocabulary shared by grants, requests and alerts. Frozen is amber, revoked is red. */
export type Status = "active" | "frozen" | "revoked" | "pending" | "waiting" | "neutral" | "high";

const BADGE: Record<Status, string> = {
  active: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  frozen: "bg-amber-100 text-amber-900 ring-amber-200",
  revoked: "bg-red-100 text-red-800 ring-red-200",
  pending: "bg-sky-100 text-sky-800 ring-sky-200",
  waiting: "bg-amber-100 text-amber-900 ring-amber-200",
  high: "bg-red-600 text-white ring-red-700",
  neutral: "bg-sage-100 text-ink/80 ring-sage-200",
};

export function Badge({ status = "neutral", children }: { status?: Status; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1",
        BADGE[status],
      )}
    >
      {children}
    </span>
  );
}

export function SyntheticBadge() {
  return (
    <span className="rounded border border-current px-1.5 py-px font-mono text-[10px] tracking-wider uppercase opacity-70">
      Synthetic
    </span>
  );
}

const BANNER: Record<"info" | "warning" | "danger" | "success", string> = {
  info: "border-sky-200 bg-sky-50 text-sky-900",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
  danger: "border-red-300 bg-red-50 text-red-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
};

export function Banner({
  tone = "info",
  children,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  children: ReactNode;
}) {
  return (
    <div role="status" className={cx("rounded-lg border px-4 py-3 text-sm", BANNER[tone])}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-serif text-[2rem] leading-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink/70">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cx("mt-6 mb-2 font-serif text-xl text-ink", className)}>{children}</h2>;
}

export function EmptyState({ title, hint, icon }: { title: string; hint?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-sage-400 bg-cream/60 p-6 text-center">
      {icon && <div className="mb-1 text-ink/50">{icon}</div>}
      <p className="font-medium text-ink/80">{title}</p>
      {hint && <p className="text-sm text-ink/60">{hint}</p>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-900">
      <p>
        <span className="font-medium">Something went wrong.</span> {error.message}
      </p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          <RefreshCw size={16} /> Try again
        </Button>
      )}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-ink/60" role="status" aria-live="polite">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-sage-300 border-t-forest-800" />
      {label}
    </div>
  );
}

/** Grey placeholder block with a moving shimmer (loading states and "organizing" records). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("shimmer rounded-lg", className)} />;
}

export function LoadingCards({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-20" />
      ))}
    </div>
  );
}

export function FullPage({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center p-6">{children}</div>;
}

export function Avatar({ name, className, tone = "dark" }: { name: string; className?: string; tone?: "dark" | "light" }) {
  return (
    <span
      aria-hidden
      className={cx(
        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
        tone === "light" ? "bg-forest-100 text-forest-900" : "bg-forest-800 text-white",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/** "● Active" / "● Paused" in the My patients table (mockup page 3). */
const DOT: Record<"active" | "frozen" | "pending" | "revoked", [string, string]> = {
  active: ["bg-emerald-600", "text-ink"],
  frozen: ["bg-amber-500", "text-amber-700"],
  pending: ["bg-sky-500", "text-sky-800"],
  revoked: ["bg-red-600", "text-red-700"],
};

export function StatusDot({ status, children }: { status: keyof typeof DOT; children: ReactNode }) {
  const [dot, text] = DOT[status];
  return (
    <span className={cx("inline-flex items-center gap-2 text-sm", text)}>
      <span aria-hidden className={cx("h-2.5 w-2.5 shrink-0 rounded-full", dot)} />
      {children}
    </span>
  );
}

const PILL: Record<"danger" | "warning" | "success" | "neutral", string> = {
  danger: "bg-red-100 text-red-800",
  warning: "bg-amber-100 text-amber-900",
  success: "bg-emerald-50 text-emerald-800",
  neutral: "bg-sage-100 text-ink/80",
};

/** Wide status pill with an icon: "AI risk: High", "Access paused", "Emergency access · 59:42 remaining". */
export function Pill({ tone = "neutral", icon, children }: { tone?: keyof typeof PILL; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium", PILL[tone])}>
      {icon}
      {children}
    </span>
  );
}

/** Rounded square behind a record or hospital icon. */
export function IconTile({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-sage-100 text-ink/80",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Toggle pill used for group-by and filters. */
export function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        "shrink-0 rounded-full px-4 py-2 text-sm whitespace-nowrap transition",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-800",
        selected ? "bg-forest-800 font-medium text-white" : "bg-sage-100 text-ink/80 hover:bg-sage-200",
      )}
    >
      {children}
    </button>
  );
}

/** AI tag on a record. */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md bg-sage-100 px-2 py-0.5 text-xs text-ink/80 underline decoration-ink/30 underline-offset-2">
      {children}
    </span>
  );
}

export function SensitivityBadge({ level }: { level: 1 | 2 | 3 }) {
  const [label, style] =
    level === 3
      ? ["Sensitive", "bg-rose-100 text-rose-800 ring-rose-200"]
      : level === 2
        ? ["Personal", "bg-amber-50 text-amber-900 ring-amber-200"]
        : ["Standard", "bg-sage-100 text-ink/70 ring-sage-200"];
  return (
    <span className={cx("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1", style)}>
      {label}
    </span>
  );
}

const RISK_LABEL: Record<RiskLevel, string> = { none: "None", low: "Low", medium: "Medium", high: "High" };

export function RiskBadge({ level }: { level: RiskLevel }) {
  const style =
    level === "high"
      ? "bg-red-200/70 text-red-900"
      : level === "medium"
        ? "bg-amber-200/70 text-amber-900"
        : "bg-emerald-100 text-emerald-900";
  return <span className={cx("rounded-md px-2 py-0.5 text-xs font-medium", style)}>{RISK_LABEL[level]}</span>;
}

/** The coloured result strip in Access history: "Allowed · Low" or "Denied: access revoked  High". */
export function OutcomeBar({
  outcome,
  risk,
  denyReason,
}: {
  outcome: "allowed" | "denied" | "frozen";
  risk: RiskLevel;
  denyReason: string | null;
}) {
  if (outcome !== "allowed") {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg bg-red-100 px-3 py-1.5 text-sm text-red-900">
        <span className="flex items-center gap-2">
          <CircleMinus size={18} className="shrink-0 text-red-700" />
          {outcome === "frozen" ? "Blocked and frozen" : "Denied"}
          {denyReason ? `: ${denyReason}` : ""}
        </span>
        <RiskBadge level={risk} />
      </div>
    );
  }
  const flagged = risk === "medium" || risk === "high";
  return (
    <div
      className={cx(
        "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm",
        flagged ? "bg-amber-100 text-amber-950" : "bg-emerald-100/80 text-emerald-950",
      )}
    >
      {flagged ? (
        <CircleAlert size={18} className="shrink-0 text-amber-600" />
      ) : (
        <CheckCircle2 size={18} className="shrink-0 text-emerald-700" />
      )}
      Allowed · {RISK_LABEL[risk === "none" ? "low" : risk]}
    </div>
  );
}

/** Modal shell shared by ConfirmDialog and bottom sheets. Escape and the backdrop close it. */
export function Modal({
  open,
  onClose,
  labelledBy,
  children,
  sheet = false,
  size = "sm",
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
  sheet?: boolean;
  size?: "sm" | "lg";
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("input, textarea, button, [href]")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className={cx("fixed inset-0 z-50 flex justify-center", sheet ? "items-end sm:items-center" : "items-center p-4")}>
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cx(
          "relative w-full bg-cream shadow-xl",
          sheet
            ? "max-h-[92vh] max-w-[480px] overflow-y-auto rounded-t-3xl p-5 pb-8 sm:rounded-3xl"
            : size === "lg"
              ? "max-h-[92vh] max-w-2xl overflow-y-auto rounded-2xl p-6"
              : "max-w-sm rounded-2xl p-5",
        )}
      >
        {sheet && (
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute top-4 right-4 rounded-full p-1 text-ink/60 hover:bg-sage-100"
          >
            <X size={20} />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

/** "Every action that changes access asks for confirmation." */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  tone = "primary",
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} onClose={busy ? () => undefined : onCancel} labelledBy="confirm-title">
      <h2 id="confirm-title" className="font-serif text-xl text-ink">
        {title}
      </h2>
      <div className="mt-2 text-sm text-ink/80">{children}</div>
      {error && (
        <div className="mt-3">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
          {busy ? "Working…" : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
