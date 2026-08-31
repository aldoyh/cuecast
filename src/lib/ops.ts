import { composeNotes } from "./notes.ts";
import type {
  ChangeField,
  LiveEvent,
  OpKind,
  OpRow,
  PrivacyStatus,
  QueuedBroadcast,
} from "./types.ts";

/** YouTube Data API v3 default bucket for non-search/non-upload methods. */
export const QUOTA_LIMIT_DEFAULT = 10_000;

/** Documented write costs. liveBroadcasts is billed with other write methods. */
export const QUOTA_COST = {
  insert: 50,
  update: 50,
  thumbnail: 50,
  list: 1,
  fetch: 0,
} as const;

export const CSV_HEADER = [
  "at",
  "op",
  "uid",
  "video_id",
  "title",
  "http",
  "units",
  "quota_used",
  "quota_limit",
  "quota_remaining",
  "note",
] as const;

export function utcDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function eventFingerprint(input: {
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  duration: string;
  thumbnailUrl: string | null;
  privacy: PrivacyStatus;
}): string {
  return [
    input.title.trim(),
    input.description.trim(),
    new Date(input.startAt).toISOString(),
    new Date(input.endAt).toISOString(),
    input.duration,
    input.thumbnailUrl ?? "",
    input.privacy,
  ].join("\n");
}

export function fingerprintOf(event: LiveEvent): string {
  return eventFingerprint({
    title: event.title,
    description: event.description,
    startAt: event.startAt,
    endAt: event.endAt,
    duration: event.duration,
    thumbnailUrl: event.thumbnailUrl,
    privacy: event.youtube.status.privacyStatus,
  });
}

export function changedFields(event: LiveEvent, queued?: QueuedBroadcast): ChangeField[] {
  if (!queued) return [];
  const fields: ChangeField[] = [];
  if (queued.title != null && queued.title !== event.title) fields.push("title");
  if (queued.description != null && queued.description !== event.description) fields.push("description");
  if (queued.startAt && new Date(queued.startAt).toISOString() !== new Date(event.startAt).toISOString()) {
    fields.push("startAt");
  }
  if (queued.endAt && new Date(queued.endAt).toISOString() !== new Date(event.endAt).toISOString()) {
    fields.push("endAt");
  }
  if (queued.duration && queued.duration !== event.duration) fields.push("duration");
  if (queued.thumbnailUrl !== undefined && queued.thumbnailUrl !== event.thumbnailUrl) fields.push("thumbnail");
  if (queued.privacy && queued.privacy !== event.youtube.status.privacyStatus) fields.push("privacy");
  if (fields.length) return fields;
  if (queued.fingerprint && queued.fingerprint !== event.fingerprint) {
    return ["title", "description", "startAt", "endAt", "duration", "thumbnail"];
  }
  return [];
}

export function isDirty(event: LiveEvent, queued?: QueuedBroadcast): boolean {
  if (!queued) return false;
  if (queued.fingerprint) return queued.fingerprint !== event.fingerprint;
  return changedFields(event, queued).length > 0;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function opToCsvRow(row: OpRow): string {
  const cells = [
    row.at,
    row.op,
    row.uid,
    row.videoId,
    row.title,
    row.http,
    String(row.units),
    String(row.quotaUsed),
    String(row.quotaLimit),
    String(row.quotaRemaining),
    row.note,
  ];
  return cells.map(csvEscape).join(",");
}

export function opsToCsv(rows: OpRow[]): string {
  return [CSV_HEADER.join(","), ...rows.map(opToCsvRow)].join("\n") + (rows.length ? "\n" : "");
}

export function snapshotQueued(event: LiveEvent, videoId?: string): QueuedBroadcast {
  return {
    uid: event.uid,
    queuedAt: new Date().toISOString(),
    videoId: videoId ?? undefined,
    fingerprint: event.fingerprint,
    title: event.title,
    description: event.description,
    startAt: event.startAt,
    endAt: event.endAt,
    duration: event.duration,
    thumbnailUrl: event.thumbnailUrl,
    privacy: event.youtube.status.privacyStatus,
  };
}

export type SchedulerTag = "INSERT" | "UPDATE" | "SKIP" | "PAST" | "QUOTA";

export type SchedulerStep = {
  tag: SchedulerTag;
  event: LiveEvent;
  videoId?: string;
  fields: ChangeField[];
  units: number;
  note: string;
};

export function planScheduler(
  events: LiveEvent[],
  queued: Record<string, QueuedBroadcast>,
  now = Date.now(),
  remaining = QUOTA_LIMIT_DEFAULT,
): SchedulerStep[] {
  const steps: SchedulerStep[] = [];
  let left = remaining;
  for (const event of events) {
    const start = new Date(event.startAt).getTime();
    const prev = queued[event.uid];
    const dirty = isDirty(event, prev);
    const fields = changedFields(event, prev);
    const thumbCost = event.thumbnailUrl && (!prev || prev.thumbnailUrl !== event.thumbnailUrl)
      ? QUOTA_COST.thumbnail
      : 0;

    if (prev && !dirty) {
      if (start <= now) {
        steps.push({ tag: "PAST", event, videoId: prev.videoId, fields: [], units: 0, note: "already processed" });
      } else {
        steps.push({ tag: "SKIP", event, videoId: prev.videoId, fields: [], units: 0, note: "unchanged" });
      }
      continue;
    }

    if (prev && dirty) {
      const units = QUOTA_COST.update + thumbCost;
      if (units > left) {
        steps.push({ tag: "QUOTA", event, videoId: prev.videoId, fields, units, note: "not enough quota to update" });
        continue;
      }
      left -= units;
      const note = fields.length ? fields.join(", ") + " changed" : "notes changed";
      steps.push({ tag: "UPDATE", event, videoId: prev.videoId, fields, units, note });
      continue;
    }

    if (start <= now) {
      steps.push({ tag: "PAST", event, fields: [], units: 0, note: "start is not in the future" });
      continue;
    }

    const units = QUOTA_COST.insert + (event.thumbnailUrl ? QUOTA_COST.thumbnail : 0);
    if (units > left) {
      steps.push({ tag: "QUOTA", event, fields: [], units, note: "not enough quota to insert" });
      continue;
    }
    left -= units;
    steps.push({
      tag: "INSERT",
      event,
      fields: [],
      units,
      note: event.thumbnailUrl ? "thumb attached" : "no thumbnail",
    });
  }
  return steps;
}

export type SchedulerResult = {
  queued: Record<string, QueuedBroadcast>;
  ops: OpRow[];
  quotaUsed: number;
  quotaDay: string;
  inserted: number;
  updated: number;
  skipped: number;
  lines: string[];
};

function fakeVideoId(uid: string): string {
  const compact = uid.replace(/[^a-zA-Z0-9]/g, "").slice(0, 11);
  return (compact || "cuecast00001").padEnd(11, "0");
}

function clip(text: string, width: number): string {
  const t = text.trim();
  if (t.length <= width) return t;
  return `${t.slice(0, Math.max(1, width - 1))}…`;
}

function stepLine(tag: string, event: LiveEvent, note: string): string {
  const when = event.startAt.slice(0, 16).padEnd(16);
  const title = clip(event.title, 32).padEnd(32);
  return `${tag.padEnd(5)}  ${when}  ${title}  ${event.duration}  ${note}`;
}

export function applyScheduler(input: {
  events: LiveEvent[];
  queued: Record<string, QueuedBroadcast>;
  ops: OpRow[];
  quotaUsed: number;
  quotaLimit: number;
  quotaDay: string;
  calendarName: string;
  now?: number;
  dryRun: boolean;
}): SchedulerResult {
  const now = input.now ?? Date.now();
  const day = utcDay(now);
  let used = day === input.quotaDay ? input.quotaUsed : 0;
  const limit = input.quotaLimit;
  const remaining = Math.max(0, limit - used);
  const steps = planScheduler(input.events, input.queued, now, remaining);
  const queued = { ...input.queued };
  const ops = [...input.ops];
  const lines: string[] = [];
  lines.push(`Cuecast  ·  ${input.calendarName || "Calendar"}`);
  lines.push("─".repeat(56));

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  const pushOp = (
    op: OpKind,
    event: LiveEvent,
    units: number,
    note: string,
    videoId: string,
    http: string,
  ) => {
    if (units > 0 && !input.dryRun) used += units;
    const row: OpRow = {
      at: new Date(now).toISOString(),
      op,
      uid: event.uid,
      videoId,
      title: event.title,
      http,
      units: input.dryRun ? units : units,
      quotaUsed: used,
      quotaLimit: limit,
      quotaRemaining: Math.max(0, limit - used),
      note: input.dryRun ? (note ? `dry-run · ${note}` : "dry-run") : note,
    };
    ops.push(row);
  };

  for (const step of steps) {
    const event = step.event;
    if (step.tag === "SKIP") {
      lines.push(stepLine("SKIP", event, step.note));
      skipped += 1;
      continue;
    }
    if (step.tag === "PAST") {
      lines.push(stepLine("PAST", event, step.note));
      skipped += 1;
      continue;
    }
    if (step.tag === "QUOTA") {
      lines.push(stepLine("QUOTA", event, step.note));
      pushOp("quota", event, 0, step.note, step.videoId ?? "", "403");
      skipped += 1;
      continue;
    }
    if (step.tag === "UPDATE") {
      const videoId = step.videoId || queued[event.uid]?.videoId || fakeVideoId(event.uid);
      if (input.dryRun) {
        lines.push(stepLine("EDIT", event, step.note));
        pushOp("edit", event, step.units, step.note, videoId, "");
      } else {
        lines.push(stepLine("UPD", event, `https://youtu.be/${videoId}`));
        pushOp("update", event, QUOTA_COST.update, step.note, videoId, "200");
        if (step.units > QUOTA_COST.update) {
          pushOp("thumbnail", event, QUOTA_COST.thumbnail, "thumbnail updated", videoId, "200");
        }
        queued[event.uid] = snapshotQueued(event, videoId);
      }
      updated += 1;
      continue;
    }
    const videoId = fakeVideoId(event.uid);
    if (input.dryRun) {
      lines.push(stepLine("DRY", event, step.note));
      pushOp("dry", event, step.units, step.note, "", "");
    } else {
      lines.push(stepLine("LIVE", event, `https://youtu.be/${videoId}`));
      pushOp("insert", event, QUOTA_COST.insert, "created", videoId, "200");
      if (event.thumbnailUrl) {
        pushOp("thumbnail", event, QUOTA_COST.thumbnail, "thumb attached", videoId, "200");
      }
      queued[event.uid] = snapshotQueued(event, videoId);
    }
    inserted += 1;
  }

  lines.push("─".repeat(56));
  lines.push(`queued ${inserted}  updated ${updated}  skipped ${skipped}`);
  lines.push(`quota ${used}/${limit}  remaining ${Math.max(0, limit - used)}`);
  if (input.dryRun) lines.push("dry-run — no YouTube calls were made");
  return {
    queued,
    ops: ops.slice(-500),
    quotaUsed: used,
    quotaDay: day,
    inserted,
    updated,
    skipped,
    lines,
  };
}

export function countOps(ops: OpRow[], day: string) {
  const today = ops.filter((o) => o.at.slice(0, 10) === day);
  return {
    inserts: today.filter((o) => o.op === "insert").length,
    updates: today.filter((o) => o.op === "update").length,
    thumbnails: today.filter((o) => o.op === "thumbnail").length,
    errors: today.filter((o) => o.op === "error" || o.op === "quota").length,
    units: today.reduce((sum, o) => sum + (o.op === "dry" || o.op === "edit" ? 0 : o.units), 0),
  };
}

export function withRevisedNotes(event: LiveEvent): LiveEvent {
  const title = event.title.replace(/ \(revised\)$/, "") + " (revised)";
  const description = event.description.includes("Updated from the calendar.")
    ? event.description
    : `${event.description}\n\nUpdated from the calendar.`;
  const privacy = event.youtube.status.privacyStatus;
  return {
    ...event,
    title,
    description,
    notesRaw: composeNotes({
      title,
      description,
      dateTime: event.startAt.slice(0, 16).replace("T", " "),
      duration: event.duration,
    }),
    fingerprint: eventFingerprint({
      title,
      description,
      startAt: event.startAt,
      endAt: event.endAt,
      duration: event.duration,
      thumbnailUrl: event.thumbnailUrl,
      privacy,
    }),
    youtube: {
      ...event.youtube,
      snippet: {
        ...event.youtube.snippet,
        title,
        description,
      },
    },
  };
}
