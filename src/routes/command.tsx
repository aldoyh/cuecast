import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatCuecastCli } from "@/lib/cli";
import { buildDemoIcs } from "@/lib/demo";
import { toIcs } from "@/lib/ical";
import { LIVE_SHOWS_ICAL } from "@/lib/calendar";
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
  const ical = settings.icalUrl.trim() || LIVE_SHOWS_ICAL;
  const dryCmd = `php youtube-live-scheduler.php \\\n  --ical='${ical}' \\\n  --privacy=${settings.privacy} \\\n  --log=cuecast-ops.csv \\\n  --dry-run`;
  const fileCmd = `php youtube-live-scheduler.php \\\n  --file=cuecast-board.ics \\\n  --privacy=${settings.privacy} \\\n  --log=cuecast-ops.csv \\\n  --dry-run`;
  const liveCmd = `php youtube-live-scheduler.php \\\n  --ical='${ical}' \\\n  --privacy=${settings.privacy} \\\n  --log=cuecast-ops.csv \\\n  --client-id="$YOUTUBE_CLIENT_ID" \\\n  --client-secret="$YOUTUBE_CLIENT_SECRET" \\\n  --refresh-token="$YOUTUBE_REFRESH_TOKEN"`;

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
          One PHP file. Cron it. New calendar events become YouTube Lives. When notes, time, duration,
          or the thumbnail change, it updates the existing broadcast. Every call is appended to a CSV
          with quota units against the 10,000 daily limit.
        </p>
      </header>

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
        <h2 className="font-display text-lg font-medium">Go live</h2>
        <p className="text-sm text-muted">
          Create an OAuth client in Google Cloud with the YouTube Data API v3, then a refresh token
          with the <span className="font-mono text-xs">youtube</span> scope. The command inserts new
          lives, updates changed ones, uploads thumbnails, and appends{" "}
          <span className="font-mono text-xs">cuecast-ops.csv</span>.
        </p>
        <pre className="overflow-x-auto rounded-lg bg-elevated p-4 font-mono text-xs leading-relaxed text-fg shadow-[var(--shadow-border)]">
          {liveCmd}
        </pre>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-medium">Cron</h2>
        <pre className="overflow-x-auto rounded-lg bg-elevated p-4 font-mono text-xs leading-relaxed text-fg shadow-[var(--shadow-border)]">
          {`*/10 * * * * php /opt/cuecast/youtube-live-scheduler.php --ical='${ical}' --privacy=${settings.privacy} --refresh-token=… --client-id=… --client-secret=… --state=/var/lib/cuecast/state.json --log=/var/lib/cuecast/ops.csv >> /var/log/cuecast.log 2>&1`}
        </pre>
        <p className="text-xs text-subtle">
          Fingerprints of title, description, start, duration, and thumbnail are stored in the state
          file. A later calendar edit issues liveBroadcasts.update instead of skipping.
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
