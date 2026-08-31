import { Clock, ImageOff } from "lucide-react";
import { LiveBadge } from "@/components/live-badge";
import { airStatus } from "@/lib/youtube";
import { formatDurationHuman, formatWhen } from "@/lib/time";
import type { LiveEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

export function EventCard({
  event,
  now,
  queued,
  changed,
  onOpen,
}: {
  event: LiveEvent;
  now: number;
  queued?: boolean;
  changed?: boolean;
  onOpen: () => void;
}) {
  const status = airStatus(event, now);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full flex-col overflow-hidden rounded-xl bg-surface text-left shadow-[var(--shadow-border)] transition-[box-shadow,transform] duration-150 hover:shadow-[var(--shadow-border-hover)]"
    >
      <Thumb event={event} status={status} queued={queued} changed={changed} />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-base leading-snug font-medium text-balance">
            {event.title}
          </h3>
          <LiveBadge status={status} />
        </div>
        <p className="line-clamp-2 text-sm text-muted">{event.description || "No description in notes."}</p>
        <div className="mt-auto flex items-center gap-3 pt-1 font-mono text-xs text-subtle tabular-nums">
          <span>{formatWhen(event.startAt)}</span>
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" />
            {formatDurationHuman(event.duration)}
          </span>
        </div>
      </div>
    </button>
  );
}

export function Thumb({
  event,
  status,
  queued,
  changed,
  className,
}: {
  event: LiveEvent;
  status: ReturnType<typeof airStatus>;
  queued?: boolean;
  changed?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative aspect-video overflow-hidden bg-elevated", className)}>
      {event.thumbnailUrl ? (
        <img
          src={event.thumbnailUrl}
          alt=""
          className="size-full object-cover outline outline-1 -outline-offset-1 outline-fg/10"
        />
      ) : (
        <div className="flex size-full items-center justify-center text-subtle">
          <ImageOff className="size-6" />
        </div>
      )}
      <div className="absolute inset-0 bg-linear-to-t from-bg/80 via-transparent to-transparent" />
      <div className="absolute top-3 left-3 flex items-center gap-2">
        {status === "live" && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-[10px] font-medium tracking-[0.16em] text-accent-fg uppercase">
            <span className="tally-dot size-1.5 rounded-full bg-accent-fg" />
            Live
          </span>
        )}
        {queued && !changed && (
          <span className="rounded-full bg-bg/80 px-2.5 py-1 text-[10px] tracking-wide text-fg uppercase">
            Queued
          </span>
        )}
        {changed && (
          <span className="rounded-full bg-accent px-2.5 py-1 text-[10px] tracking-wide text-accent-fg uppercase">
            Changed
          </span>
        )}
      </div>
      <span className="absolute right-3 bottom-3 font-mono text-xs text-fg/90 tabular-nums">
        {event.duration}
      </span>
    </div>
  );
}
