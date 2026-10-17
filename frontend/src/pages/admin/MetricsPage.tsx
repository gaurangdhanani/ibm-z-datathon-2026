import { Cpu, Tags } from "lucide-react";

import { Badge, Card, EmptyState, ErrorState, LoadingCards, PageHeader, SectionTitle, cx } from "../../components/ui";
import { adminApi, useResource } from "../../lib/data";
import { formatDate } from "../../lib/format";
import type { BenchReport, BenchResult, EvalReport } from "../../lib/types";

const FIELD_LABEL: Record<string, string> = {
  body_part: "Body part",
  condition: "Condition",
  record_type: "Record type",
  doctor: "Doctor",
  date_of_service: "Date of service",
};
const METRICS = ["aes_gcm_encrypt", "aes_gcm_decrypt", "record_encrypt", "broker_read", "key_swap", "audit_verify"];
/** Fixed series colours, validated for colour-vision deficiency: laptop green, LinuxONE blue. */
const SERIES = ["bg-[#15803d]", "bg-[#2563eb]", "bg-ink/50"];

const pct = (v: number) => `${(v * 100).toFixed(v === 1 ? 0 : 1)}%`;
const fmt = (r: BenchResult) =>
  r.unit === "MB/s" ? `${Math.round(r.value).toLocaleString()} MB/s` : `${r.value < 10 ? r.value.toFixed(2) : r.value.toFixed(1)} ms`;

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-white/70 p-4 ring-1 ring-sage-200">
      <p className="text-xs font-medium tracking-wide text-ink/60 uppercase">{label}</p>
      <p className="mt-1 font-serif text-3xl text-ink">{value}</p>
      {hint && <p className="text-xs text-ink/60">{hint}</p>}
    </div>
  );
}

function Bar({ fraction, color, label, title }: { fraction: number; color: string; label: string; title?: string }) {
  return (
    <div className="flex items-center gap-3" title={title}>
      <div className="h-3 flex-1 rounded-full bg-sage-100">
        <div className={cx("h-3 rounded-full", color)} style={{ width: `${Math.max(2, Math.min(100, fraction * 100))}%` }} />
      </div>
      <span className="w-28 shrink-0 text-right text-sm tabular-nums text-ink">{label}</span>
    </div>
  );
}

function Cell({ n, label, tone }: { n: number; label: string; tone: "good" | "bad" | "warn" | "neutral" }) {
  const style =
    tone === "good"
      ? "bg-emerald-50 ring-emerald-200 text-emerald-900"
      : tone === "bad"
        ? "bg-red-50 ring-red-200 text-red-900"
        : tone === "warn"
          ? "bg-amber-50 ring-amber-200 text-amber-900"
          : "bg-sage-50 ring-sage-200 text-ink/80";
  return (
    <div className={cx("rounded-lg p-3 ring-1", style)}>
      <div className="font-serif text-2xl">{n}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}

/** S2: the organizer's score on the synthetic set (ORG-5). */
function Organizer({ report }: { report: EvalReport }) {
  const s = report.sensitive_records;
  return (
    <Card>
      <div className="grid gap-3 sm:grid-cols-4">
        <Tile label="Records scored" value={String(report.records)} hint="synthetic notes with noise" />
        <Tile label="Mean field accuracy" value={pct(report.mean_accuracy)} hint="over 5 tag fields" />
        <Tile label="Sensitive-record recall" value={pct(s.recall)} hint={`${s.tp} of ${s.tp + s.fn} caught`} />
        <Tile label="Precision" value={pct(s.precision)} hint={`${s.fp} false alarm${s.fp === 1 ? "" : "s"}`} />
      </div>
      <h3 className="mt-5 mb-2 text-sm font-semibold text-ink">Accuracy per field</h3>
      <div className="space-y-2">
        {Object.entries(report.accuracy).map(([field, value]) => (
          <div key={field} className="grid items-center gap-x-3 gap-y-1 sm:grid-cols-[9rem_1fr]">
            <span className="text-sm text-ink/80">{FIELD_LABEL[field] ?? field}</span>
            <Bar fraction={value} color="bg-forest-700" label={pct(value)} />
          </div>
        ))}
      </div>
      <h3 className="mt-5 mb-2 text-sm font-semibold text-ink">Sensitive records (level 3: psychiatry, sexual health, genetics, substance use, reproductive health)</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cell n={s.tp} label="Sensitive, caught" tone="good" />
        <Cell n={s.fn} label="Sensitive, missed" tone={s.fn ? "bad" : "good"} />
        <Cell n={s.fp} label="Routine, flagged by mistake" tone={s.fp ? "warn" : "good"} />
        <Cell n={s.tn} label="Routine, left alone" tone="neutral" />
      </div>
      {report.misses.length > 0 && (
        <>
          <h3 className="mt-5 mb-2 text-sm font-semibold text-ink">Misses ({report.misses.length})</h3>
          <ul className="space-y-1 text-sm text-ink/80">
            {report.misses.map((m) => (
              <li key={m.id}>
                <span className="font-medium text-ink">
                  #{m.id} {m.title}
                </span>
                :{" "}
                {Object.entries(m.wrong)
                  .map(([f, w]) => `${FIELD_LABEL[f] ?? f} read "${w.got ?? "none"}", should be "${w.want ?? "none"}"`)
                  .join("; ")}
                {m.sensitivity.got !== m.sensitivity.want && ` sensitivity ${m.sensitivity.got}, should be ${m.sensitivity.want}`}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-4 text-xs text-ink/60">
        From reports/eval.json (`make eval`): the keyword organizer scored on 120 synthetic notes with prefix lines, trailing
        unrelated sentences and lower-cased copies. Tags are made inside the vault, before encryption, and drive the clerk rule.
      </p>
    </Card>
  );
}

type Series = { report: BenchReport; color: string };

function faster(a: Series & { res: BenchResult }, b: Series & { res: BenchResult }): string {
  const aWins = a.res.better === "higher" ? a.res.value > b.res.value : a.res.value < b.res.value;
  const [win, lose] = aWins ? [a, b] : [b, a];
  const x = win.res.better === "higher" ? win.res.value / lose.res.value : lose.res.value / win.res.value;
  return `${win.report.label} ${x.toFixed(x < 10 ? 1 : 0)}× faster`;
}

/** S4: every reports/bench-*.json side by side; the laptop first, LinuxONE second, fixed colours. */
function Benchmarks({ reports, thisMachine }: { reports: BenchReport[]; thisMachine: string }) {
  const ordered = [...reports].sort((a, b) => Number(a.machine === "s390x") - Number(b.machine === "s390x"));
  const series: Series[] = ordered.map((report, i) => ({ report, color: SERIES[i] ?? SERIES[2] }));
  const keys = METRICS.filter((k) => ordered.some((r) => r.results[k]));
  return (
    <Card>
      <ul className="flex flex-col gap-2 text-sm" aria-label="Machines">
        {series.map(({ report, color }) => (
          <li key={report.machine + report.hostname} className="flex flex-wrap items-center gap-2">
            <span aria-hidden className={cx("h-3 w-3 rounded-sm", color)} />
            <span className="font-medium text-ink">{report.label}</span>
            <span className="text-ink/60">
              {report.system} · Python {report.python} · {report.cpus ?? "?"} CPUs · {report.cryptography ? `cryptography ${report.cryptography}` : ""} ·{" "}
              {formatDate(report.ran_at)}
            </span>
            {report.machine === thisMachine && <Badge status="active">this server</Badge>}
            {report.quick && <Badge status="pending">quick run</Badge>}
          </li>
        ))}
      </ul>
      <div className="mt-5 space-y-5">
        {keys.map((key) => {
          const rows = series.filter((s) => s.report.results[key]).map((s) => ({ ...s, res: s.report.results[key]! }));
          const first = rows[0]!.res;
          const max = Math.max(...rows.map((r) => r.res.value));
          const note = rows.length === 2 ? faster(rows[0]!, rows[1]!) : null;
          return (
            <div key={key}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">{first.title}</h3>
                <span className="text-xs text-ink/60">
                  {first.better === "higher" ? "higher is better" : "median, lower is better"}
                  {note && ` · ${note}`}
                </span>
              </div>
              <div className="mt-2 space-y-1.5">
                {rows.map(({ report, color, res }) => (
                  <Bar
                    key={report.machine}
                    fraction={res.value / max}
                    color={color}
                    label={fmt(res)}
                    title={`${report.label}: p50 ${res.p50_ms} ms · p95 ${res.p95_ms} ms · ${res.iterations} runs`}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-ink/60">
        From reports/bench-*.json (`make bench` on each machine): in-process against an in-memory copy of the demo data, so the
        numbers are the machine's, not the network's. Bars show the median; hover for p95. LinuxONE runs AES-256-GCM and SHA-256 in
        hardware (CPACF).
      </p>
    </Card>
  );
}

/** S2 + S4 dashboard for Demo control: organizer accuracy and laptop-vs-LinuxONE benchmarks. */
export default function MetricsPage() {
  const reports = useResource(() => adminApi.getReports(), [], { live: false });
  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="How well the in-vault organizer tags records, and how fast the vault runs on a laptop versus IBM LinuxONE."
      />
      {reports.error && !reports.data ? (
        <ErrorState error={reports.error} onRetry={reports.reload} />
      ) : !reports.data ? (
        <LoadingCards count={2} />
      ) : (
        <>
          <SectionTitle className="flex items-center gap-2">
            <Tags size={20} /> Record organizer
          </SectionTitle>
          {reports.data.eval ? (
            <Organizer report={reports.data.eval} />
          ) : (
            <EmptyState title="No evaluation yet" hint="Run `make eval` to score the organizer into reports/eval.json." />
          )}
          <SectionTitle className="flex items-center gap-2">
            <Cpu size={20} /> Laptop vs LinuxONE
          </SectionTitle>
          {reports.data.benchmarks.length > 0 ? (
            <Benchmarks reports={reports.data.benchmarks} thisMachine={reports.data.this_machine} />
          ) : (
            <EmptyState
              title="No benchmark yet"
              hint="Run `make bench` here and on the LinuxONE VM; each writes reports/bench-<machine>.json."
            />
          )}
        </>
      )}
    </>
  );
}
