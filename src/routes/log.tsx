import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  applyScheduler,
  countOps,
  isDirty,
  opsToCsv,
  QUOTA_LIMIT_DEFAULT,
  utcDay,
  withRevisedNotes,
} from "@/lib/ops";
import { useBoard } from "@/lib/use-board";
import { useCuecast } from "@/lib/store";
import { downloadText } from "@/lib/utils";
import { airStatus } from "@/lib/youtube";
import type { OpKind } from "@/lib/types";

export const Route = createFileRoute("/log")({ component: LogPage });

function LogPage() {
  const { events } = useBoard();
  const settings = useCuecast((s) => s.settings);
  const queued = useCuecast((s) => s.queued);
  const ops = useCuecast((s) => s.ops);
  const quotaUsed = useCuecast((s) => s.quotaUsed);
  const quotaDay = useCuecast((s) => s.quotaDay);
  const calendarName = useCuecast((s) => s.calendarName);
  const applyRun = useCuecast((s) => s.applyRun);
  const reviseEvent = useCuecast((s) => s.reviseEvent);
  const clearLog = useCuecast((s) => s.clearLog);

  const day = utcDay();
  const used = quotaDay === day ? quotaUsed : 0;
  const limit = settings.quotaLimit || QUOTA_LIMIT_DEFAULT;
  const remaining = Math.max(0, limit - used);
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const today = countOps(ops, day);
  const dirty = events.filter((e) => isDirty(e, queued[e.uid]));
  const csv = opsToCsv(ops);

  function run(dryRun: boolean) {
    const result = applyScheduler({
      events,
      queued,
      ops,
      quotaUsed: used,
      quotaLimit: limit,
      quotaDay: day,
      calendarName,
      dryRun,
    });
    if (!dryRun) {
      applyRun({
        queued: result.queued,
        ops: result.ops,
        quotaUsed: result.quotaUsed,
        quotaDay: result.quotaDay,
      });
      toast(`Logged ${result.inserted} inserts, ${result.updated} updates`);
    } else {
      applyRun({
        queued,
        ops: result.ops,
        quotaUsed: used,
        quotaDay: day,
      });
      toast("Dry-run appended to CSV");
    }
  }

  function simulateEdit() {
    const target =
      events.find((e) => queued[e.uid] && !isDirty(e, queued[e.uid]) && airStatus(e) !== "aired") ??
      events.find((e) => airStatus(e) === "upcoming");
    if (!target) {
      toast("Nothing to revise");
      return;
    }
    const next = withRevisedNotes(target);
    reviseEvent(target.uid, next);
    toast(`Calendar edit on ${next.title}`);
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs tracking-[0.2em] text-subtle uppercase">CSV · YouTube Data API</p>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight">Operations log</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            Every insert, update, and thumbnail is appended to a CSV with quota units. The PHP
            command writes the same file. When an iCal event changes, Cuecast updates the YouTube
            Live instead of skipping it.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => run(false)}>Run & log</Button>
          <Button variant="secondary" onClick={simulateEdit}>
            Simulate iCal edit
          </Button>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-4">
        <QuotaCard used={used} limit={limit} remaining={remaining} pct={pct} />
        <Stat label="Inserts today" value={String(today.inserts)} />
        <Stat label="Updates today" value={String(today.updates)} />
        <Stat label="Pending edits" value={String(dirty.length)} />
      </section>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            downloadText("cuecast-ops.csv", csv, "text/csv");
            toast("CSV downloaded");
          }}
          disabled={ops.length === 0}
        >
          Download CSV
        </Button>
        <Button variant="secondary" onClick={() => run(true)}>
          Dry-run to CSV
        </Button>
        <Button variant="ghost" onClick={() => { clearLog(); toast("Log cleared"); }} disabled={ops.length === 0}>
          Clear log
        </Button>
      </div>

      {ops.length === 0 ? (
        <div className="rounded-xl bg-surface px-6 py-14 text-center shadow-[var(--shadow-border)]">
          <p className="font-display text-2xl">No operations yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Run the scheduler to insert new lives. Simulate an iCal edit, run again, and the
            matching YouTube broadcast is updated. The CSV records units against the 10,000 daily
            quota.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-surface shadow-[var(--shadow-border)]">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs tracking-wide text-subtle uppercase">
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Op</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Units</th>
                <th className="px-4 py-3 font-medium">Left</th>
                <th className="px-4 py-3 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {[...ops].reverse().map((row, i) => (
                <tr key={`${row.at}-${row.op}-${row.uid}-${i}`} className="border-b border-border/70 last:border-0">
                  <td className="px-4 py-3 font-mono text-xs text-subtle tabular-nums whitespace-nowrap">
                    {row.at.slice(11, 19)}
                  </td>
                  <td className="px-4 py-3">
                    <OpPill op={row.op} />
                  </td>
                  <td className="max-w-[220px] truncate px-4 py-3">{row.title || "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums">{row.units}</td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums">{row.quotaRemaining}</td>
                  <td className="px-4 py-3 text-xs text-muted">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="space-y-2">
        <h2 className="font-display text-lg font-medium">CSV</h2>
        <p className="text-sm text-muted">
          Same columns the PHP command appends to{" "}
          <span className="font-mono text-xs">cuecast-ops.csv</span>.
        </p>
        <pre className="max-h-64 overflow-auto rounded-lg bg-elevated p-4 font-mono text-xs leading-relaxed text-fg shadow-[var(--shadow-border)]">
          {csv || CSV_EMPTY}
        </pre>
      </section>
    </div>
  );
}

const CSV_EMPTY = "at,op,uid,video_id,title,http,units,quota_used,quota_limit,quota_remaining,note";

function QuotaCard({
  used,
  limit,
  remaining,
  pct,
}: {
  used: number;
  limit: number;
  remaining: number;
  pct: number;
}) {
  return (
    <div className="rounded-lg bg-surface px-4 py-3 shadow-[var(--shadow-border)] sm:col-span-1">
      <p className="text-xs text-subtle">Daily quota</p>
      <p className="mt-1 font-mono text-2xl tabular-nums">
        {used}
        <span className="text-sm text-subtle">/{limit}</span>
      </p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-elevated">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 font-mono text-xs text-subtle tabular-nums">{remaining} remaining</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface px-4 py-3 shadow-[var(--shadow-border)]">
      <p className="text-xs text-subtle">{label}</p>
      <p className="mt-1 font-mono text-2xl tabular-nums">{value}</p>
    </div>
  );
}

function OpPill({ op }: { op: OpKind }) {
  return (
    <span className="rounded-full bg-elevated px-2 py-0.5 font-mono text-xs tracking-wide uppercase">
      {op}
    </span>
  );
}
