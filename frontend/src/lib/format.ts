/** Display helpers. Timestamps arrive as UTC ISO strings and render in the viewer's local time. */

const DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
const DATE_NO_YEAR = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const MONTH = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });

/** Date-only strings ("1988-04-12") are calendar dates, not UTC midnight: parse them as local. */
function toDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
}

export const formatDate = (iso: string) => DATE.format(toDate(iso));
export const formatTime = (iso: string) => TIME.format(toDate(iso));
export const formatMonth = (iso: string) => MONTH.format(toDate(iso));

/** Local calendar date as YYYY-MM-DD. */
export function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "Today", "Yesterday", or a short date. */
export function dayLabel(iso: string): string {
  const d = toDate(iso);
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.getFullYear() === new Date().getFullYear() ? DATE_NO_YEAR.format(d) : DATE.format(d);
}

/** "today at 4:15 PM" / "on Oct 18 at 9:00 AM". */
export function formatWhen(iso: string): string {
  const day = dayLabel(iso);
  const prefix = day === "Today" || day === "Yesterday" ? day.toLowerCase() : `on ${day}`;
  return `${prefix} at ${formatTime(iso)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function initials(name: string): string {
  const words = name.replace(/^Dr\.?\s+/i, "").split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
