import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LiveBadge } from "@/components/live-badge";
import { Thumb } from "@/components/event-card";
import { changedFields, isDirty } from "@/lib/ops";
import { airStatus } from "@/lib/youtube";
import { formatDurationHuman, formatWhenLong } from "@/lib/time";
import type { LiveEvent } from "@/lib/types";
import { useCuecast } from "@/lib/store";

export function EventDetail({
  event,
  now,
  open,
  onOpenChange,
}: {
  event: LiveEvent | null;
  now: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queued = useCuecast((s) => (event ? s.queued[event.uid] : undefined));
  const queueEvent = useCuecast((s) => s.queueEvent);
  const unqueueEvent = useCuecast((s) => s.unqueueEvent);
  if (!event) return null;
  const status = airStatus(event, now);
  const dirty = isDirty(event, queued);
  const fields = changedFields(event, queued);
  const payload = JSON.stringify(event.youtube, null, 2);
  const method = queued ? "PUT liveBroadcasts" : "POST liveBroadcasts";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90dvh,760px)] overflow-y-auto p-0">
        <Thumb
          event={event}
          status={status}
          queued={Boolean(queued)}
          changed={dirty}
          className="rounded-t-xl"
        />
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <DialogTitle>{event.title}</DialogTitle>
              <DialogDescription className="mt-1">{formatWhenLong(event.startAt)}</DialogDescription>
            </div>
            <LiveBadge status={status} />
          </div>
          <p className="text-sm leading-relaxed text-muted">
            {event.description || "No description parsed from notes."}
          </p>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Meta label="Duration" value={formatDurationHuman(event.duration)} />
            <Meta label="Privacy" value={event.youtube.status.privacyStatus} />
            <Meta label="Calendar" value={event.calendarName} />
            <Meta label="Location" value={event.location ?? "—"} />
          </dl>
          <div className="flex flex-wrap gap-2">
            {dirty ? (
              <Badge variant="live">Will update YouTube</Badge>
            ) : queued ? (
              <Badge variant="cream">On YouTube</Badge>
            ) : (
              <Badge variant="outline">Not published</Badge>
            )}
            {event.parseStatus === "ok" ? (
              <Badge variant="cream">Notes parsed</Badge>
            ) : event.parseStatus === "partial" ? (
              <Badge variant="outline">Partial notes</Badge>
            ) : (
              <Badge variant="outline">Missing notes</Badge>
            )}
            {event.thumbnailUrl ? (
              <Badge variant="cream">Thumbnail attached</Badge>
            ) : (
              <Badge variant="outline">No thumbnail</Badge>
            )}
          </div>
          {dirty && fields.length > 0 && (
            <p className="text-xs text-muted">Changed in iCal: {fields.join(", ")}.</p>
          )}
          {event.parseWarnings.length > 0 && (
            <ul className="space-y-1 text-xs text-muted">
              {event.parseWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <div>
            <p className="mb-2 text-xs tracking-[0.16em] text-subtle uppercase">
              YouTube payload · {method}
            </p>
            <pre className="max-h-48 overflow-auto rounded-lg bg-elevated p-3 font-mono text-xs leading-relaxed text-muted">
              {payload}
            </pre>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={(status === "aired" || status === "all_day") && !dirty}
              onClick={() => {
                if (queued && !dirty) unqueueEvent(event.uid);
                else {
                  queueEvent(event.uid);
                  toast(dirty ? "Staged YouTube update" : "Queued for the PHP command");
                }
              }}
            >
              {dirty ? "Stage update" : queued ? "Remove from queue" : "Queue to YouTube"}
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(payload);
                toast("Payload copied");
              }}
            >
              Copy payload
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-elevated px-3 py-2">
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className="mt-0.5 capitalize">{value}</dd>
    </div>
  );
}
