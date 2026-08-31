import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatCuecastCli } from "@/lib/cli";
import { buildDemoIcs } from "@/lib/demo";
import { toIcs } from "@/lib/ical";
import { LIVE_SHOWS_ICAL } from "@/lib/calendar";
import {
  GITHUB_ACTIONS_URL,
  GITHUB_SECRETS_URL,
  PIPELINE,
  YOUTUBE_SECRETS,
} from "@/lib/github-secrets";
import { applyScheduler, isDirty, opsToCsv, withRevisedNotes } from "@/lib/ops";
import { useCuecast } from "@/lib/store";
import { downloadText } from "@/lib/utils";
import { airStatus, liveEventToRaw } from "@/lib/youtube";
import { useBoard } from "@/lib/use-board";

export const Route = createFileRoute("/command")({ component: CommandPage });

function CommandPage() {
  const { events } = useBoard();
  const settings = useCuecast((s) => s.settings);
  const queued = useCuecast((s) => s.queued);
  const ops = useCuecast((s) => s.ops);
  const quotaUsed = useCuecast((s) => s.quotaUsed);
  const quotaDay = useCuecast((s) => s.quotaDay);
  const calendarName = useCuecast((s) => s.calendarName);
  const applyRun = useCuecast((s) => s.applyRun);
  const reviseEvent = useCuecast((s) => s.reviseEvent);
  const ical = settings.icalUrl.trim();
  const dryCmd = `php youtube-live-scheduler.php \\\n  --ical='${ical || LIVE_SHOWS_ICAL}' \\\n  --privacy=${settings.privacy} \\\n  --log=cuecast-ops.csv \\\n  --dry-run`;
  const fileCmd = `php youtube-live-scheduler.php \\\n  --file=cuecast-board.ics \\\n  --privacy=${settings.privacy} \\\n  --log=cuecast-ops.csv \\\n  --dry-run`;
  const liveCmd = `YOUTUBE_CLIENT_ID=… \\\nYOUTUBE_CLIENT_SECRET=… \\\nYOUTUBE_REFRESH_TOKEN=… \\\nphp youtube-live-scheduler.php \\\n  --ical='${ical || LIVE_SHOWS_ICAL}' \\\n  --privacy=${settings.privacy} \\\n  --log=cuecast-ops.csv`;

  const upcoming = events.filter((e) => airStatus(e) === "upcoming");
  const dirty = events.filter((e) => isDirty(e, queued[e.uid]));
  const output = formatCuecastCli(events, calendarName || "Calendar", Date.now(), queued);

  function exportBoard() {
    const ics = events.length
      ? toIcs(events.map(liveEventToRaw), calendarName || "Cuecast")
      : buildDemoIcs();
    downloadText("cuecast-board.ics", ics, "text/calendar");
    toast("Board exported as iCal");
  }

  function runAndLog() {
    const result = applyScheduler({
      events,
      queued,
      ops,
      quotaUsed,
      quotaLimit: settings.quotaLimit,
      quotaDay,
      calendarName,
      dryRun: false,
    });
    applyRun({
      queued: result.queued,
      ops: result.ops,
      quotaUsed: result.quotaUsed,
      quotaDay: result.quotaDay,
    });
    downloadText("cuecast-ops.csv", opsToCsv(result.ops), "text/csv");
    toast(`Logged ${result.inserted} inserts, ${result.updated} updates`);
  }

  function simulateEdit() {
    const target =
      events.find((e) => queued[e.uid] && !isDirty(e, queued[e.uid]) && airStatus(e) !== "aired") ??
      events.find((e) => airStatus(e) === "upcoming");
    if (!target) {
      toast("Nothing to revise");
      return;
    }
    reviseEvent(target.uid, withRevisedNotes(target));
    toast("iCal event revised — next run will UPDATE YouTube");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <p className="text-xs tracking-[0.2em] text-subtle uppercase">Single file</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight">PHP command</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          One PHP file. GitHub Actions runs it every 30 minutes. YouTube credentials live in
          repository secrets — never in the repo, never on the command line. The runner injects them
          as environment variables; PHP exchanges the refresh token for a Bearer token and talks to
          YouTube.
        </p>
      </header>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs tracking-[0.2em] text-subtle uppercase">Vault</p>
            <h2 className="mt-1 font-display text-lg font-medium">GitHub Secrets → YouTube</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={GITHUB_SECRETS_URL} target="_blank" rel="noreferrer">
                Open secrets
              </a>
            </Button>
            <Button asChild variant="secondary">
              <a href={GITHUB_ACTIONS_URL} target="_blank" rel="noreferrer">
                Open Actions
              </a>
            </Button>
          </div>
        </div>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PIPELINE.map((step) => (
            <li
              key={step.n}
              className="rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)]"
            >
              <p className="font-mono text-[11px] tracking-[0.18em] text-subtle">{step.n}</p>
              <p className="mt-2 font-display text-base font-medium">{step.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
        <div className="overflow-x-auto rounded-xl bg-surface shadow-[var(--shadow-border)]">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs tracking-[0.14em] text-subtle uppercase">
                <th className="px-4 py-3 font-medium">Secret</th>
                <th className="px-4 py-3 font-medium">Required</th>
                <th className="px-4 py-3 font-medium">What PHP does with it</th>
              </tr>
            </thead>
            <tbody>
              {YOUTUBE_SECRETS.map((secret) => (
                <tr key={secret.name} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="font-mono text-xs text-fg underline decoration-border-strong underline-offset-4"
                      onClick={async () => {
                        await navigator.clipboard.writeText(secret.name);
                        toast(`${secret.name} copied`);
                      }}
                    >
                      {secret.name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-muted">{secret.required ? "Yes" : "No"}</td>
                  <td className="px-4 py-3 text-muted">{secret.usedFor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm leading-relaxed text-muted">
          GitHub encrypts each YouTube value at rest. At run time the workflow maps{" "}
          <span className="font-mono text-xs">${"{{ secrets.YOUTUBE_REFRESH_TOKEN }}"}</span> into{" "}
          <span className="font-mono text-xs">YOUTUBE_REFRESH_TOKEN</span>. The calendar URL is
          taken from the Feed page (<span className="font-mono text-xs">--ical</span> /{" "}
          <span className="font-mono text-xs">cuecast.config.json</span>), never from a secret.
        </p>
      </section>

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <a href="/youtube-live-scheduler.php" download="youtube-live-scheduler.php">
            Download PHP file
          </a>
        </Button>
        <Button onClick={runAndLog}>Run & log CSV</Button>
        <Button variant="secondary" onClick={simulateEdit}>
          Simulate iCal edit
        </Button>
        <Button variant="secondary" onClick={exportBoard}>
          Export board .ics
        </Button>
      </div>

      {dirty.length > 0 && (
        <p className="rounded-lg bg-elevated px-4 py-3 text-sm text-muted shadow-[var(--shadow-border)]">
          {dirty.length} event{dirty.length === 1 ? "" : "s"} changed in the calendar and will UPDATE
          YouTube on the next run.{" "}
          <Link to="/log" className="text-fg underline decoration-border-strong underline-offset-4">
            Open log
          </Link>
        </p>
      )}

      <section className="space-y-2">
        <div className="flex items-end justify-between gap-3">
          <h2 className="font-display text-lg font-medium">What it would print</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(output);
              toast("Output copied");
            }}
          >
            Copy output
          </Button>
        </div>
        <p className="text-sm text-muted">
          <span className="font-mono text-xs">EDIT</span> means the iCal event changed and YouTube
          will be patched. <span className="font-mono text-xs">DRY</span> is a new broadcast.
        </p>
        <pre className="overflow-x-auto rounded-lg bg-elevated p-4 font-mono text-xs leading-relaxed text-fg shadow-[var(--shadow-border)]">
          {output}
        </pre>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-medium">Dry run against a feed</h2>
        <pre className="overflow-x-auto rounded-lg bg-elevated p-4 font-mono text-xs leading-relaxed text-fg shadow-[var(--shadow-border)]">
          {dryCmd}
        </pre>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-medium">Dry run against a file</h2>
        <p className="text-sm text-muted">
          Export the board, then point the command at the file.
        </p>
        <pre className="overflow-x-auto rounded-lg bg-elevated p-4 font-mono text-xs leading-relaxed text-fg shadow-[var(--shadow-border)]">
          {fileCmd}
        </pre>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-medium">Go live (local env, no flags)</h2>
        <p className="text-sm text-muted">
          Same names as the GitHub secrets. Do not pass tokens as <span className="font-mono text-xs">--refresh-token</span> — they show up in process lists.
        </p>
        <pre className="overflow-x-auto rounded-lg bg-elevated p-4 font-mono text-xs leading-relaxed text-fg shadow-[var(--shadow-border)]">
          {liveCmd}
        </pre>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-medium">Actions (every 30 minutes)</h2>
        <pre className="overflow-x-auto rounded-lg bg-elevated p-4 font-mono text-xs leading-relaxed text-fg shadow-[var(--shadow-border)]">
{`env:
  YOUTUBE_CLIENT_ID: \${{ secrets.YOUTUBE_CLIENT_ID }}
  YOUTUBE_CLIENT_SECRET: \${{ secrets.YOUTUBE_CLIENT_SECRET }}
  YOUTUBE_REFRESH_TOKEN: \${{ secrets.YOUTUBE_REFRESH_TOKEN }}
run: php public/youtube-live-scheduler.php --config=cuecast.config.json --log=cuecast-ops.csv`}
        </pre>
        <p className="text-xs text-subtle">
          Workflow file: <span className="font-mono">.github/workflows/cuecast.yml</span>. State is
          cached between runs so a later calendar edit issues liveBroadcasts.update instead of a
          second insert.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-medium">What it would schedule</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted">No upcoming events on the board.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg bg-surface shadow-[var(--shadow-border)]">
            {upcoming.map((event) => (
              <li
                key={event.uid}
                className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3"
              >
                <span className="text-sm">{event.title}</span>
                <span className="font-mono text-xs text-subtle tabular-nums">
                  {event.duration}
                  {isDirty(event, queued[event.uid])
                    ? " · update"
                    : queued[event.uid]
                      ? " · queued"
                      : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
