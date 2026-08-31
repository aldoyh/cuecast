import { createFileRoute, Link } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EventCard } from "@/components/event-card";
import { EventDetail } from "@/components/event-detail";
import { NextUp } from "@/components/next-up";
import { Button } from "@/components/ui/button";
import { isDirty } from "@/lib/ops";
import { airStatus } from "@/lib/youtube";
import { useBoard } from "@/lib/use-board";
import { useCuecast } from "@/lib/store";
import type { LiveEvent } from "@/lib/types";
import { toast } from "sonner";

export const Route = createFileRoute("/")({ component: BoardPage });

function BoardPage() {
  const { loading, sync, events } = useBoard();
  const settings = useCuecast((s) => s.settings);
  const calendarName = useCuecast((s) => s.calendarName);
  const lastSyncedAt = useCuecast((s) => s.lastSyncedAt);
  const lastError = useCuecast((s) => s.lastError);
  const queued = useCuecast((s) => s.queued);
  const queueEvent = useCuecast((s) => s.queueEvent);
  const selectedUid = useCuecast((s) => s.selectedUid);
  const select = useCuecast((s) => s.select);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const hero = useMemo(() => pickHero(events, now), [events, now]);
  const rest = useMemo(
    () => events.filter((e) => e.uid !== hero?.uid),
    [events, hero],
  );
  const selected = events.find((e) => e.uid === selectedUid) ?? null;
  const upcoming = events.filter((e) => {
    const status = airStatus(e, now);
    return status === "upcoming" || status === "live";
  }).length;
  const hours =
    events
      .filter((e) => !e.allDay && airStatus(e, now) !== "aired")
      .reduce((sum, e) => sum + e.durationMinutes, 0) / 60;
  const dirtyCount = events.filter((e) => isDirty(e, queued[e.uid])).length;

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs tracking-[0.2em] text-subtle uppercase">
            {sourceLabel(settings.source)} · {calendarName || "No calendar"}
          </p>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight md:text-4xl">
            The board
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void sync()} disabled={loading}>
            <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
            Sync
          </Button>
        </div>
      </header>

      {lastError && (
        <div className="rounded-lg bg-elevated px-4 py-3 text-sm text-muted shadow-[var(--shadow-border)]">
          {lastError}{" "}
          <Link to="/feed" className="text-fg underline decoration-border-strong underline-offset-4">
            Open feed
          </Link>
        </div>
      )}

      <dl className="grid grid-cols-3 gap-3">
        <Stat label="On the board" value={String(upcoming)} />
        <Stat label="Hours booked" value={hours.toFixed(1)} />
        <Stat label="Calendar edits" value={String(dirtyCount)} />
      </dl>

      {hero ? (
        <NextUp
          event={hero}
          now={now}
          queued={Boolean(queued[hero.uid])}
          changed={isDirty(hero, queued[hero.uid])}
          onOpen={() => select(hero.uid)}
          onQueue={() => {
            queueEvent(hero.uid);
            toast(isDirty(hero, queued[hero.uid]) ? "Staged YouTube update" : "Queued for the PHP command");
          }}
        />
      ) : loading ? (
        <div className="flex h-80 items-center justify-center rounded-xl bg-surface shadow-[var(--shadow-border)]">
          <p className="text-sm text-muted">Loading the board…</p>
        </div>
      ) : (
        <EmptyBoard />
      )}

      {rest.length > 0 && (
        <section>
          <h2 className="mb-4 font-display text-lg font-medium">Schedule</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {rest.map((event, i) => (
              <div key={event.uid} className="stagger-in" style={{ animationDelay: `${i * 40}ms` }}>
                <EventCard
                  event={event}
                  now={now}
                  queued={Boolean(queued[event.uid])}
                  changed={isDirty(event, queued[event.uid])}
                  onOpen={() => select(event.uid)}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {lastSyncedAt && (
        <p className="font-mono text-xs text-subtle tabular-nums">
          Last sync {new Date(lastSyncedAt).toLocaleTimeString()}
        </p>
      )}

      <EventDetail
        event={selected}
        now={now}
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) select(null);
        }}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface px-4 py-3 shadow-[var(--shadow-border)]">
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className="mt-1 font-mono text-2xl tabular-nums">{value}</dd>
    </div>
  );
}

function pickHero(events: LiveEvent[], now: number): LiveEvent | null {
  const timed = events.filter((e) => airStatus(e, now) !== "all_day");
  const live = timed.find((e) => airStatus(e, now) === "live");
  if (live) return live;
  const upcoming = timed.find((e) => airStatus(e, now) === "upcoming");
  if (upcoming) return upcoming;
  return timed[timed.length - 1] ?? events[events.length - 1] ?? null;
}

function sourceLabel(source: "demo" | "ical" | "google") {
  if (source === "google") return "Google Calendar";
  if (source === "ical") return "iCal feed";
  return "Studio demo";
}

function EmptyBoard() {
  return (
    <div className="rounded-xl bg-surface px-6 py-16 text-center shadow-[var(--shadow-border)]">
      <p className="font-display text-2xl">Nothing on the board</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">
        Connect Google Calendar or paste any iCal URL. Cuecast reads the notes block and lines up a YouTube Live.
      </p>
      <Button asChild className="mt-6">
        <Link to="/feed">Connect a feed</Link>
      </Button>
    </div>
  );
}
