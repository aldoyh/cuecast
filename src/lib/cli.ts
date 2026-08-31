import { isDirty } from "./ops.ts";
import type { LiveEvent, QueuedBroadcast } from "./types.ts";

function clip(text: string, width: number): string {
  const t = text.trim();
  if (t.length <= width) return t;
  return `${t.slice(0, Math.max(1, width - 1))}…`;
}

function line(tag: string, event: LiveEvent, note: string): string {
  const when = event.startAt.slice(0, 16).padEnd(16);
  const title = clip(event.title, 32).padEnd(32);
  return `${tag.padEnd(5)}  ${when}  ${title}  ${event.duration}  ${note}`;
}

/** Matches `youtube-live-scheduler.php --dry-run` stdout. */
export function formatCuecastCli(
  events: LiveEvent[],
  calendarName: string,
  now = Date.now(),
  queued: Record<string, QueuedBroadcast> = {},
): string {
  const out: string[] = [];
  out.push(`Cuecast  ·  ${calendarName || "Calendar"}`);
  out.push("─".repeat(56));

  let queuedCount = 0;
  let updated = 0;
  let skipped = 0;

  for (const event of events) {
    const start = new Date(event.startAt).getTime();
    const prev = queued[event.uid];
    if (prev && isDirty(event, prev)) {
      out.push(line("EDIT", event, "ical changed — will update YouTube"));
      updated += 1;
      continue;
    }
    if (prev) {
      out.push(line("SKIP", event, "unchanged"));
      skipped += 1;
      continue;
    }
    if (start <= now) {
      out.push(line("PAST", event, "start is not in the future"));
      skipped += 1;
      continue;
    }
    out.push(line("DRY", event, event.thumbnailUrl ? "thumb attached" : "no thumbnail"));
    queuedCount += 1;
  }

  out.push("─".repeat(56));
  out.push(`queued ${queuedCount}  updated ${updated}  skipped ${skipped}`);
  out.push("dry-run — no YouTube calls were made");
  return out.join("\n");
}
