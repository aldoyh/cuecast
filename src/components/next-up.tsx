import { Thumb } from "@/components/event-card";
import { Button } from "@/components/ui/button";
import { airStatus } from "@/lib/youtube";
import { formatClock, formatWhenLong, remainingLabel, secondsUntil } from "@/lib/time";
import type { LiveEvent } from "@/lib/types";

export function NextUp({
  event,
  now,
  queued,
  changed,
  onOpen,
  onQueue,
}: {
  event: LiveEvent;
  now: number;
  queued?: boolean;
  changed?: boolean;
  onOpen: () => void;
  onQueue: () => void;
}) {
  const status = airStatus(event, now);
  const seconds = secondsUntil(event.startAt, now);
  const clock =
    status === "live"
      ? remainingLabel(event.endAt, now)
      : status === "upcoming"
        ? formatClock(Math.max(0, seconds))
        : "00:00:00";
  const caption =
    status === "live" ? "On air" : status === "all_day" ? "All-day mark" : status === "upcoming" ? "Next on the board" : "Last out";

  return (
    <section className="stagger-in overflow-hidden rounded-xl bg-surface shadow-[var(--shadow-border)]">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Thumb
          event={event}
          status={status}
          queued={queued}
          changed={changed}
          className="lg:aspect-auto lg:min-h-[340px]"
        />
        <div className="flex flex-col justify-between gap-6 p-5 md:p-7">
          <div>
            <p className="text-xs tracking-[0.2em] text-subtle uppercase">
              {changed ? "Calendar changed" : caption}
            </p>
            <h1 className="mt-3 font-display text-3xl leading-[1.1] font-medium tracking-tight md:text-4xl">
              {event.title}
            </h1>
            <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted">{event.description}</p>
          </div>
          <div>
            <p className="font-mono text-4xl font-medium tracking-tight text-fg tabular-nums md:text-5xl">
              {clock}
            </p>
            <p className="mt-2 text-sm text-muted">{formatWhenLong(event.startAt)}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button onClick={onQueue} disabled={status === "aired" || status === "all_day" || (queued && !changed)}>
                {changed ? "Stage YouTube update" : queued ? "Queued" : "Queue to YouTube"}
              </Button>
              <Button variant="secondary" onClick={onOpen}>
                Open cue
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
